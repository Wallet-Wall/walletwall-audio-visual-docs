// Publication narration synthesis: the one credentialed, paid step (docs/NARRATION.md, "Publication narration").
//
// A VoiceProvider, so it is reached only through synthesize() in src/pipeline/render-input.ts, which checks the
// narration budget before any provider is asked: an over-budget script never gets here. This step decides nothing
// about the script (its class, its length, its meaning) and nothing about eligibility: it performs the approved
// binding (src/narration/publication.ts) and records exactly what it did.
//
// In order, failing closed at each step:
//   1. a current, verified set already on disk is returned as is (or, left in staging by an interrupted run, put in
//      place): no key, no call, never synthesized twice; a stale set's lines whose audio is still exactly right (the
//      same spoken text, chunk plan, and binding, every byte verified) carry over, and when every line does, the set
//      is rebuilt with no key and no call;
//   2. the credential (ELEVENLABS_API_KEY, from the environment at call time) must be set;
//   3. a voice-id override in the environment that names another voice is refused: publication speaks the bound voice;
//   4. the binding's settings pass the adapter's own closed schema;
//   5. every local precondition of the write: the set directory and its staging directory hold nothing but a set,
//      so nothing paid for can be refused afterwards for a reason that was knowable before;
//   6. the read-only voice preflight (one GET): the key is accepted, the voice exists, is the identity's variety, and
//      is the voice the binding names;
//   7. one text-to-speech request per chunk of the lines that do not carry over, sequential, no retry: the first
//      failure stops the run, and nothing is left;
//   8. the set (carried and new audio, and a record built from the current script alone) is written to a staging
//      directory and verified from disk; from then on it is kept even if putting it in place fails (the next run
//      adopts it with no request), and only then does it replace the previous set.
// There is no fallback: when ElevenLabs fails, publication narration fails. Node-only.

import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VoiceProvider, VoiceRequest } from '../../audio/voice-provider.ts';
import { prettyJson } from '../../core/canonical-json.ts';
import type { NarrationTrack } from '../../timeline/timeline.ts';
import { VOICE_PROFILE, type NarrationLanguage, type NarrationRequest, type SynthesisContext } from '../contract.ts';
import {
  buildPublicationRecord,
  carryOverLines,
  stagingDirOf,
  isLineId,
  joinChunks,
  PUBLICATION_RECORD_FILE,
  publicationExpectation,
  PublicationNarrationError,
  readPublicationSet,
  trackFromSet,
  validatePublicationRecord,
  type CarriedLine,
  type PublicationExpectation,
  type PublicationScope,
  type ResolvedPublication,
} from '../publication.ts';
import { assertLexiconPinned } from '../lexicon.ts';
import { parseWav } from '../wav.ts';
import type { ElevenLabsProvider } from './elevenlabs.ts';

export interface PublicationVoiceOptions {
  videoId: string;
  scope: PublicationScope;
  /** The set's directory: dist/<videoId>/narration for a video, its own directory for the live proof. */
  dir: string;
  /** The approved binding (resolvePublicationBinding): resolved before this step is constructed. */
  publication: ResolvedPublication;
  adapter: ElevenLabsProvider;
  /** Environment reader: process.env in production, a stub in tests. Read for the credential only. */
  env: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

const isSetFile = (name: string): boolean => name === PUBLICATION_RECORD_FILE || (name.endsWith('.wav') && isLineId(name.slice(0, -4)));

/** Refuse a set directory that holds anything but a set (a record and WAVs, regular files), or is not a plain directory. */
function assertSetDir(dir: string): void {
  if (!existsSync(dir)) return;
  if (!lstatSync(dir).isDirectory()) throw new PublicationNarrationError('INVALID', `${path.basename(dir)} is not a plain directory (a file, link, or junction); move it away (nothing was requested)`);
  for (const name of readdirSync(dir)) {
    if (!isSetFile(name) || !lstatSync(path.join(dir, name)).isFile()) throw new PublicationNarrationError('INVALID', `${path.basename(dir)} holds ${JSON.stringify(name)}, which is not part of a narration set; move it away (nothing was requested)`);
  }
}

/** Remove a set directory that holds nothing but a set; anything else is refused, never deleted. */
function clearSetDir(dir: string): void {
  assertSetDir(dir);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) unlinkSync(path.join(dir, name));
  rmdirSync(dir);
}

/** Rename, retrying briefly when Windows still holds a handle on files just written (indexer, antivirus). Bounded. */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

export class ElevenLabsPublicationVoice implements VoiceProvider {
  readonly id = 'elevenlabs';
  readonly synthetic = true;
  /** What the last call did: reused a current set, rebuilt one from carried audio alone, or synthesized (some of) a new one. */
  outcome: 'reused' | 'rebuilt' | 'synthesized' | null = null;
  private readonly o: PublicationVoiceOptions;

  constructor(options: PublicationVoiceOptions) {
    this.o = options;
  }

  async synthesize(request: VoiceRequest): Promise<NarrationTrack> {
    const o = this.o;
    const log = o.log ?? (() => {});
    const { binding } = o.publication;
    if (binding.provider !== this.id || o.adapter.id !== binding.provider || o.adapter.binding.voiceId !== binding.voiceId) throw new PublicationNarrationError('BINDING', 'the publication binding and the ElevenLabs adapter binding disagree');
    // The lexicon version a set records must mean exactly one set of entries: an unversioned edit stops here, unpaid.
    assertLexiconPinned(request.lexicon);
    const expect = publicationExpectation(request, o.publication, o.videoId, o.scope);

    // 1. A current set is never synthesized again; nor is one an interrupted run verified and left in staging.
    const staging = stagingDirOf(o.dir);
    try {
      const current = readPublicationSet(o.dir, expect);
      log(`reusing the verified narration set ${current.ref.identity.slice(0, 16)}: nothing requested`);
      this.outcome = 'reused';
      return trackFromSet(current);
    } catch (err) {
      if (!(err instanceof PublicationNarrationError)) throw err;
      log(`no current narration set (${err.code}): ${err.code === 'MISSING' ? 'none yet' : err.message}`);
    }
    let left: ReturnType<typeof readPublicationSet> | null = null;
    try {
      left = readPublicationSet(staging, expect);
    } catch (err) {
      if (!(err instanceof PublicationNarrationError)) throw err;
    }
    if (left) {
      this.putInPlace(staging);
      log(`adopted the verified narration set ${left.ref.identity.slice(0, 16)} an interrupted run left in staging: nothing requested`);
      this.outcome = 'reused';
      return trackFromSet(readPublicationSet(o.dir, expect));
    }

    // Partial regeneration: every line of an earlier set (the set directory, or a stale set an interrupted run left in
    // staging) whose audio is still exactly right (same spoken text, chunk plan, and binding, every byte verified)
    // carries over, with where and when it was made; only the rest are paid for.
    const carry = carryOverLines([o.dir, staging], expect);
    const todo = expect.lines.filter((l) => !carry.audio.has(l.lineId));
    const carried = expect.lines.flatMap((l) => carry.origins.get(l.lineId) ?? []);
    if (carry.from.length) log(`carrying ${carried.length} verified lines from ${carry.from.map((id) => id.slice(0, 16)).join(', ')}; ${todo.length} to synthesize (${todo.reduce((n, l) => n + l.texts.length, 0)} requests, ${todo.reduce((n, l) => n + l.texts.reduce((m, t) => m + t.length, 0), 0)} characters)`);
    if (todo.length === 0) {
      // Nothing to pay for: no credential, no preflight, no request. The record is rebuilt for the current script.
      assertSetDir(o.dir);
      assertSetDir(staging);
      this.assemble(expect, staging, carry.audio, 0, carried);
      this.putInPlace(staging);
      this.outcome = 'rebuilt';
      log('rebuilt the narration set from carried audio: nothing requested');
      return trackFromSet(readPublicationSet(o.dir, expect, o.env));
    }

    // 2. The credential, read here and only here; never recorded, logged, or echoed.
    const keyName = o.adapter.binding.apiKeyEnv;
    if (!o.env[keyName]) throw new PublicationNarrationError('CREDENTIAL', `${keyName} is not set: publication narration needs it for this step only (it is never written anywhere); nothing was requested`);
    // 3. Publication speaks the bound voice: an override that names another voice is a binding change, not a run option.
    const override = o.env[o.adapter.binding.voiceIdEnv]?.trim();
    if (override && override !== binding.voiceId) throw new PublicationNarrationError('BINDING', `${o.adapter.binding.voiceIdEnv} names another voice; publication narration speaks only the bound voice (unset it); nothing was requested`);
    // 4. The adapter's closed schema: the approved settings are exactly a valid ElevenLabs request.
    const settings = o.adapter.validateSettings(binding.settings);

    // 5. Everything local the write will need, checked now: nothing paid for is refused afterwards for a knowable reason.
    assertSetDir(o.dir);
    assertSetDir(staging);

    const ctx: SynthesisContext = { workDir: o.dir, env: o.env, fetch: o.fetch };
    // 6. The read-only preflight, once, before any paid call.
    const pre = await o.adapter.preflight(binding.voiceId, request.identity, ctx);
    if (pre.reportedVoiceId !== binding.voiceId) throw new PublicationNarrationError('BINDING', `the voice lookup did not report the bound voice ${binding.voiceId}: the binding is not coherent; nothing was synthesized`);
    log(`voice ${binding.voiceId} accepted (${binding.language}); synthesizing ${todo.length} lines, ${todo.reduce((n, l) => n + l.texts.length, 0)} requests`);

    // 7. The paid requests (only the lines that do not carry over); a set that does not verify is discarded.
    const spoken = await this.speakAll(request, todo, settings, ctx);
    const audio = new Map<string, Uint8Array>([...carry.audio, ...spoken.wavs]);
    this.assemble(expect, staging, audio, spoken.requests, carried);
    // 8. Verified and paid for: kept whatever happens next.
    try {
      this.putInPlace(staging);
    } catch (err) {
      throw new PublicationNarrationError('INVALID', `the new narration set is verified and kept in ${path.basename(staging)}; the next run puts it in place with no request (${(err as Error).message})`);
    }
    this.outcome = 'synthesized';
    return trackFromSet(readPublicationSet(o.dir, expect, o.env));
  }

  /** Replace the set directory with a verified staging set. */
  private putInPlace(staging: string): void {
    clearSetDir(this.o.dir);
    mkdirSync(path.dirname(this.o.dir), { recursive: true });
    renameWithRetry(staging, this.o.dir);
  }

  /** Write every line's WAV and the record built from the current script alone into staging, and verify it from disk. */
  private assemble(expect: PublicationExpectation, staging: string, audio: ReadonlyMap<string, Uint8Array>, requests: number, carried: readonly CarriedLine[]): void {
    clearSetDir(staging);
    mkdirSync(staging, { recursive: true });
    try {
      for (const line of expect.lines) {
        const wav = audio.get(line.lineId);
        if (!wav) throw new PublicationNarrationError('AUDIO', `no audio for line ${line.lineId}`);
        writeFileSync(path.join(staging, `${line.lineId}.wav`), wav);
      }
      const record = buildPublicationRecord({ expectation: expect, videoId: this.o.videoId, audio, generatedAt: new Date().toISOString(), requests, carried });
      const problems = validatePublicationRecord(record, this.o.env);
      if (problems.length) throw new PublicationNarrationError('INVALID', `the new narration record is not valid: ${problems.slice(0, 4).join('; ')}`);
      writeFileSync(path.join(staging, PUBLICATION_RECORD_FILE), prettyJson(record));
      readPublicationSet(staging, expect, this.o.env);
    } catch (err) {
      clearSetDir(staging);
      throw err;
    }
  }

  private async speakAll(request: VoiceRequest, lines: PublicationExpectation['lines'], settings: ReturnType<ElevenLabsProvider['validateSettings']>, ctx: SynthesisContext): Promise<{ wavs: Map<string, Uint8Array>; requests: number }> {
    const { binding } = this.o.publication;
    const wavs = new Map<string, Uint8Array>();
    let requests = 0;
    for (const line of lines) {
      const pcm: Uint8Array[] = [];
      for (const text of line.texts) {
        const chunk: NarrationRequest = { passageId: line.lineId, displayText: text, spokenText: text, language: binding.language as NarrationLanguage, voiceProfile: VOICE_PROFILE, identity: request.identity };
        const result = await this.o.adapter.speak(chunk, settings, binding.voiceId, ctx);
        requests++;
        const info = parseWav(result.wav);
        if (info.sampleRate !== this.o.publication.sampleRate || info.channels !== 1) throw new PublicationNarrationError('AUDIO', `line ${line.lineId}: ElevenLabs returned ${info.sampleRate} Hz x${info.channels}, not the bound ${this.o.publication.sampleRate} Hz mono`);
        pcm.push(result.wav.subarray(info.dataOffset, info.dataOffset + info.dataLength));
      }
      wavs.set(line.lineId, joinChunks(pcm, this.o.publication.sampleRate, binding.chunking));
    }
    return { wavs, requests };
  }
}
