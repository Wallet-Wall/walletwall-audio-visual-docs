// Publication narration (docs/NARRATION.md, "Publication narration"): the approved ElevenLabs binding, the one
// credentialed synthesis step, and the verified narration set every later step replays. No test here touches the
// network or needs a credential: ElevenLabs is a counting fetch stub driving the real adapter, and every WAV is
// made in memory. The budget, the credential, the preflight, and the binding all fail closed before a paid call.

import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { estimateTrack, FixtureVoiceProvider, voiceRequestFor, type VoiceProvider, type VoiceRequest } from '../src/audio/voice-provider.ts';
import { buildCaptions, checkCaptions } from '../src/audio/captions.ts';
import { readJson, VIDEO_ROOT } from '../src/config/load.ts';
import { IssueCollector } from '../src/core/issues.ts';
import {
  joinChunks,
  loadPublicationBinding,
  narrationVoice,
  parseNarrationMode,
  planChunks,
  PUBLICATION_RECORD_FILE,
  PublicationBindingError,
  PublicationNarrationError,
  PublicationNarrationReplay,
  publicationBindingOf,
  recordIdentity,
  resolvePublicationBinding,
  validatePublicationRecord,
  type PublicationNarrationRecord,
  type ResolvedPublication,
} from '../src/narration/publication.ts';
import { wrapPcm16, parseWav } from '../src/narration/wav.ts';
import { synthesize } from '../src/pipeline/render-input.ts';
import { NarrationBudgetError } from '../src/spec/narration-budget.ts';
import type { VideoSpec } from '../src/spec/types.ts';
import { buildTimeline, narrationAudio } from '../src/timeline/timeline.ts';
import { ElevenLabsProvider } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig } from '../src/narration/providers/index.ts';
import { ElevenLabsPublicationVoice } from '../src/narration/providers/publication.ts';
import { clone, committedSpec, config } from './helpers.ts';
import { elevenlabs, KEY, pcm, publicationVoice, RATE, scratch, stubPublicationSet, VOICE } from './narration-stub.ts';

const rawProviders = (): Record<string, unknown> => readJson<Record<string, unknown>>(path.join(VIDEO_ROOT, 'config', 'narration-providers.json'));
const resolved = (): ResolvedPublication => loadPublicationBinding();

/** n plain words the lexicon leaves alone. */
const words = (n: number): string => Array.from({ length: n }, (_, i) => (i % 2 ? 'ground' : 'steady')).join(' ');

function overBudget(): VideoSpec {
  const spec = clone(committedSpec());
  assert.equal(spec.videoClass, 'QUICK');
  spec.segments.find((s) => s.narration.length > 0)!.narration[0]!.text = `${words(436)}.`;
  return spec;
}

/** Synthesize the committed spec's narration once through the stub; returns the set directory, the stub, and the spec. */
async function synthesizedSet(): Promise<{ dir: string; stub: ReturnType<typeof elevenlabs>; spec: VideoSpec }> {
  const { dir, stub } = await stubPublicationSet();
  return { dir, stub, spec: committedSpec() };
}

describe('publication narration: the approved binding', () => {
  test('resolves to ElevenLabs Multilingual v2 on the WalletWallaby voice, with the anchor settings and chunk policy', () => {
    const { binding, bindingSha256, synthesisConfigSha256 } = resolved();
    assert.equal(binding.provider, 'elevenlabs');
    assert.equal(binding.modelId, 'eleven_multilingual_v2');
    assert.equal(binding.voiceId, VOICE);
    assert.equal(binding.voiceIdentityId, 'walletwallaby-v2');
    assert.equal(binding.language, 'en-AU');
    assert.deepEqual({ ...binding.settings }, { modelId: 'eleven_multilingual_v2', outputFormat: 'pcm_24000', stability: 0.65, similarityBoost: 0.8, style: 0, useSpeakerBoost: true, speed: 0.95, seed: 7, applyTextNormalization: 'auto' });
    assert.deepEqual({ ...binding.chunking, join: { ...binding.chunking.join } }, { mode: 'sentence', maxChars: 320, gapMs: 220, trimMs: 120, join: { version: 1, silenceDbfs: -50 } });
    assert.match(bindingSha256, /^[0-9a-f]{64}$/);
    assert.match(synthesisConfigSha256, /^[0-9a-f]{64}$/);
    const pin = (config.voice.providerBindings as { publication: { bindingSha256: string; status: string } }).publication;
    assert.equal(pin.status, 'APPROVED');
    assert.equal(pin.bindingSha256, bindingSha256, 'config/voice-identity.json approves exactly this binding');
  });

  test('a binding that drifts from the pinned one fails closed: settings, model, voice, chunking, provider, identity', () => {
    const drift: [string, (p: Record<string, any>, v: Record<string, any>) => void][] = [
      ['stability', (p) => (p.providers.elevenlabs.variants.publication.stability = 0.5)],
      ['model', (p) => (p.providers.elevenlabs.variants.publication.modelId = 'eleven_v3')],
      ['voice', (p) => (p.providers.elevenlabs.voiceId = 'AAAAAAAAAAAAAAAAAAAA')],
      ['chunking', (p) => (p.publication.chunking.maxChars = 400)],
      ['variant', (p) => (p.publication.variant = 'reference')],
      ['identity', (_p, v) => (v.id = 'walletwallaby-v3')],
    ];
    for (const [what, edit] of drift) {
      const p = rawProviders() as Record<string, any>;
      const v = clone(config.voice) as unknown as Record<string, any>;
      edit(p, v);
      assert.throws(() => resolvePublicationBinding(v as never, p), PublicationBindingError, what);
    }
  });

  test('only an allowlisted publication provider can be bound: no local or R&D provider is promoted by configuration', () => {
    for (const provider of ['magpie-nemo-speech', 'chatterbox-multilingual', 'qwen3-tts', 'fixture-estimate']) {
      const p = rawProviders() as Record<string, any>;
      p.publication.provider = provider;
      assert.throws(() => resolvePublicationBinding(config.voice, p), (err: Error) => err instanceof PublicationBindingError && /not a publication provider/.test(err.message), provider);
    }
  });

  test('the identity must approve a binding: NOT_CONFIGURED, an unknown field, or no pin is refused', () => {
    const variants: [string, (b: Record<string, any>) => void][] = [
      ['not configured', (b) => (b.status = 'NOT_CONFIGURED')],
      ['unknown field', (b) => (b.voiceId = VOICE)],
      ['no pin', (b) => delete b.bindingSha256],
      ['inherited pin', (b) => { const pin = b.bindingSha256; delete b.bindingSha256; Object.setPrototypeOf(b, { bindingSha256: pin }); }],
    ];
    for (const [what, edit] of variants) {
      const v = clone(config.voice) as unknown as Record<string, any>;
      edit(v.providerBindings.publication);
      assert.throws(() => resolvePublicationBinding(v as never, rawProviders()), PublicationBindingError, what);
    }
  });
});

describe('publication narration: modes', () => {
  test('the fixture voice stays the default and needs no network, key, or narration on disk', async () => {
    assert.equal(parseNarrationMode([]), 'fixture');
    assert.equal(parseNarrationMode(['--narration=fixture']), 'fixture');
    assert.equal(parseNarrationMode(['--narration=publication']), 'publication');
    for (const bad of ['--narration=qwen3-tts', '--narration=', '--narration=elevenlabs']) assert.throws(() => parseNarrationMode([bad]), /fixture or publication/, bad);
    const voice = narrationVoice('fixture', 'migration-readiness');
    assert.ok(voice instanceof FixtureVoiceProvider);
    const spec = committedSpec();
    const track = await synthesize(spec, voice, config);
    assert.deepEqual(track, estimateTrack(spec, config.voice, config.lexicon), 'the committed fixture render is unchanged');
    assert.equal('publication' in track, false, 'a fixture track carries no publication narration identity');
  });

  test('publication mode replays the verified set from disk and never synthesizes', () => {
    const voice = narrationVoice('publication', 'migration-readiness');
    assert.ok(voice instanceof PublicationNarrationReplay);
    assert.equal(voice.synthetic, true);
  });
});

describe('publication narration: the paid-call boundary', () => {
  test('over-budget narration makes zero ElevenLabs calls (the gate is upstream of the provider)', async () => {
    const stub = elevenlabs();
    const dir = path.join(scratch(), 'narration');
    await assert.rejects(synthesize(overBudget(), publicationVoice(dir, stub), config), NarrationBudgetError);
    assert.equal(stub.calls.length, 0, 'no voice lookup and no synthesis POST');
  });

  test('the budget is provider-neutral: every voice is refused before it is asked, and no voice holds a budget of its own', async () => {
    const asked: string[] = [];
    const spy = (voice: VoiceProvider): VoiceProvider => ({ id: voice.id, synthetic: voice.synthetic, synthesize: (r: VoiceRequest) => (asked.push(voice.id), voice.synthesize(r)) });
    const stub = elevenlabs();
    for (const voice of [new FixtureVoiceProvider(), narrationVoice('publication', 'migration-readiness'), publicationVoice(path.join(scratch(), 'n'), stub)]) {
      await assert.rejects(synthesize(overBudget(), spy(voice), config), NarrationBudgetError);
    }
    assert.deepEqual(asked, []);
    assert.equal(stub.calls.length, 0);
    for (const file of ['src/narration/publication.ts', 'src/narration/providers/publication.ts', 'src/narration/providers/elevenlabs.ts']) {
      assert.ok(!/narration-budget|maxWords|VIDEO_CLASSES/.test(readFileSync(path.join(VIDEO_ROOT, file), 'utf8')), `${file} holds no budget logic`);
    }
  });

  test('a missing credential fails closed with a clear error and no network call', async () => {
    const stub = elevenlabs();
    await assert.rejects(synthesize(committedSpec(), publicationVoice(path.join(scratch(), 'n'), stub, {}), config), (err: Error) => err instanceof PublicationNarrationError && /ELEVENLABS_API_KEY is not set/.test(err.message));
    assert.equal(stub.calls.length, 0);
  });

  test('a voice-id override in the environment is refused: publication speaks only the bound voice', async () => {
    const stub = elevenlabs();
    const env = { ELEVENLABS_API_KEY: KEY, WALLETWALLABY_ELEVENLABS_VOICE_ID: 'BBBBBBBBBBBBBBBBBBBB' };
    await assert.rejects(synthesize(committedSpec(), publicationVoice(path.join(scratch(), 'n'), stub, env), config), (err: Error) => err instanceof PublicationNarrationError && /WALLETWALLABY_ELEVENLABS_VOICE_ID/.test(err.message));
    assert.equal(stub.calls.length, 0);
  });

  test('the voice preflight runs once, read-only, before any synthesis POST', async () => {
    const { stub, spec } = await synthesizedSet();
    const lines = voiceRequestFor(spec, config.voice, config.lexicon).lines.length;
    assert.equal(stub.calls[0]!.method, 'GET');
    assert.equal(stub.calls[0]!.path, `/v1/voices/${VOICE}`);
    assert.equal(stub.gets().length, 1, 'one lookup for the whole set');
    assert.equal(stub.posts().length, lines, 'one POST per chunk; every committed line is one chunk');
    for (const c of stub.calls) assert.equal(c.host, 'api.elevenlabs.io');
    const body = stub.posts()[0]!.body!;
    assert.equal(body.model_id, 'eleven_multilingual_v2');
    assert.deepEqual(body.voice_settings, { stability: 0.65, similarity_boost: 0.8, style: 0, use_speaker_boost: true, speed: 0.95 });
    assert.equal(body.seed, 7);
    assert.equal(body.apply_text_normalization, 'auto');
    assert.ok(stub.posts().every((c) => c.path === `/v1/text-to-speech/${VOICE}`));
  });

  test('an inaccessible, mislabelled, or different voice fails at the preflight, before any synthesis', async () => {
    const cases: [string, Parameters<typeof elevenlabs>[0]][] = [
      ['401', { voiceStatus: 401 }],
      ['404', { voiceStatus: 404 }],
      ['american', { voice: { voice_id: VOICE, labels: { accent: 'american' } } }],
      ['other voice', { voice: { voice_id: 'CCCCCCCCCCCCCCCCCCCC', labels: { accent: 'australian' } } }],
      ['no voice id', { voice: { labels: { accent: 'australian' } } }],
    ];
    for (const [what, opts] of cases) {
      const stub = elevenlabs(opts);
      await assert.rejects(synthesize(committedSpec(), publicationVoice(path.join(scratch(), 'n'), stub), config), Error, what);
      assert.equal(stub.gets().length, 1, what);
      assert.equal(stub.posts().length, 0, `${what}: no paid call`);
    }
  });

  test('an ElevenLabs outage fails closed: no other provider, no partial set, no retry loop', async () => {
    const stub = elevenlabs({ ttsStatus: 503 });
    const dir = path.join(scratch(), 'narration');
    await assert.rejects(synthesize(committedSpec(), publicationVoice(dir, stub), config), /ElevenLabs/);
    assert.equal(stub.posts().length, 1, 'the first failure stops the run');
    assert.ok(stub.calls.every((c) => c.host === 'api.elevenlabs.io'), 'nothing else is asked');
    assert.throws(() => readdirSync(dir), /ENOENT/, 'no narration set is left behind');
    assert.deepEqual(readdirSync(path.dirname(dir)), [], 'and no staging directory either');
  });
});

describe('publication narration: credentials', () => {
  test('the key never appears in an error, the record, the audio, or the track', async () => {
    const echo = elevenlabs({ ttsStatus: 401, ttsBody: (key) => `{"detail":"invalid api key ${key}"}` });
    await assert.rejects(synthesize(committedSpec(), publicationVoice(path.join(scratch(), 'n'), echo), config), (err: Error) => !err.message.includes(KEY) && /redacted/.test(err.message));
    const stub = elevenlabs();
    const dir = path.join(scratch(), 'narration');
    const track = await synthesize(committedSpec(), publicationVoice(dir, stub), config);
    assert.ok(!JSON.stringify(track).includes(KEY));
    for (const f of readdirSync(dir)) assert.ok(!readFileSync(path.join(dir, f)).includes(Buffer.from(KEY)), f);
    const record = JSON.parse(readFileSync(path.join(dir, PUBLICATION_RECORD_FILE), 'utf8')) as Record<string, unknown>;
    assert.ok(!/ELEVENLABS_API_KEY|xi-api-key/.test(JSON.stringify(record)), 'neither the key nor its name is recorded');
    assert.deepEqual(validatePublicationRecord(record, { ELEVENLABS_API_KEY: KEY }), []);
    const planted = JSON.parse(JSON.stringify(record).replace(/"generatedAt":"[^"]*"/, `"generatedAt":"${KEY}"`)) as unknown;
    assert.ok(validatePublicationRecord(planted, { ELEVENLABS_API_KEY: KEY }).some((e) => /ELEVENLABS_API_KEY/.test(e)), 'a planted key is caught');
  });
});

describe('publication narration: the verified set', () => {
  test('a matching set is replayed offline with durations measured from the audio, and reused instead of re-synthesized', async () => {
    const { dir, stub, spec } = await synthesizedSet();
    const track = await synthesize(spec, new PublicationNarrationReplay(dir, resolved()), config);
    assert.equal(track.providerId, 'elevenlabs');
    assert.equal(track.estimated, false);
    assert.equal(track.synthetic, true);
    // 250 ms lead and 400 ms tail trimmed to 120 ms each around 1000 ms of speech.
    for (const line of track.lines) assert.equal(line.durationMs, 1240, line.lineId);
    for (const line of track.lines) assert.equal(line.audio?.path, `narration/${line.lineId}.wav`);
    const again = elevenlabs();
    const reused = await synthesize(spec, publicationVoice(dir, again, {}), config);
    assert.equal(again.calls.length, 0, 'a current set is reused with no key and no call');
    assert.deepEqual(reused, track);
    assert.equal(stub.posts().length, track.lines.length);
  });

  test('provenance names the provider, model, voice, identity, language, and every hash, and no secret', async () => {
    const { dir, spec } = await synthesizedSet();
    const track = await synthesize(spec, new PublicationNarrationReplay(dir, resolved()), config);
    const ref = track.publication!;
    const r = resolved();
    assert.deepEqual(Object.keys(ref).sort(), ['audioSha256', 'bindingId', 'bindingSha256', 'chunkPlanSha256', 'identity', 'language', 'modelId', 'provider', 'scriptSha256', 'synthesisConfigSha256', 'voiceId', 'voiceIdentityId']);
    assert.equal(ref.provider, 'elevenlabs');
    assert.equal(ref.modelId, 'eleven_multilingual_v2');
    assert.equal(ref.voiceId, VOICE);
    assert.equal(ref.voiceIdentityId, 'walletwallaby-v2');
    assert.equal(ref.language, 'en-AU');
    assert.equal(ref.bindingSha256, r.bindingSha256);
    assert.equal(ref.synthesisConfigSha256, r.synthesisConfigSha256);
    for (const k of ['identity', 'scriptSha256', 'chunkPlanSha256', 'audioSha256'] as const) assert.match(ref[k], /^[0-9a-f]{64}$/);
    assert.ok(!/KEY|TOKEN|SECRET|[A-Za-z]:[\\/]|\\/.test(JSON.stringify(ref)));
  });

  test('a changed script makes the set stale: the old narration is refused, never re-labelled', async () => {
    const { dir, spec } = await synthesizedSet();
    const edited = clone(spec);
    edited.segments.find((s) => s.narration.length > 0)!.narration[0]!.text += ' Always.';
    await assert.rejects(synthesize(edited, new PublicationNarrationReplay(dir, resolved()), config), (err: Error) => err instanceof PublicationNarrationError && /stale script/.test(err.message));
    // A display-only change (the spoken chunks normalize to the same text) is caught by the script hash alone.
    const spaced = clone(spec);
    const line = spaced.segments.find((s) => s.narration.length > 0)!.narration[0]!;
    line.text = line.text.replace(' ', '  ');
    await assert.rejects(synthesize(spaced, new PublicationNarrationReplay(dir, resolved()), config), (err: Error) => err instanceof PublicationNarrationError && /stale script/.test(err.message));
  });

  test('a visual-only change leaves the set current', async () => {
    const { dir, spec } = await synthesizedSet();
    const edited = clone(spec);
    edited.title.topic = `${edited.title.topic} (revised)`;
    const track = await synthesize(edited, new PublicationNarrationReplay(dir, resolved()), config);
    assert.equal(track.lines.length, voiceRequestFor(spec, config.voice, config.lexicon).lines.length);
  });

  test('a changed model, voice, settings, chunking, or identity makes the set stale even when the new binding is approved', async () => {
    const { dir, spec } = await synthesizedSet();
    const edits: [string, (p: Record<string, any>, v: Record<string, any>) => void][] = [
      ['model', (p) => (p.providers.elevenlabs.variants.publication.modelId = 'eleven_v3')],
      ['voice', (p) => (p.providers.elevenlabs.voiceId = 'AAAAAAAAAAAAAAAAAAAA')],
      ['settings', (p) => (p.providers.elevenlabs.variants.publication.speed = 1)],
      ['chunking', (p) => (p.publication.chunking.gapMs = 300)],
      ['identity', (_p, v) => (v.id = 'walletwallaby-v3')],
    ];
    for (const [what, edit] of edits) {
      const p = rawProviders() as Record<string, any>;
      const v = clone(config.voice) as unknown as Record<string, any>;
      edit(p, v);
      // Approve the edited binding (as a reviewed change would), so only staleness can refuse it.
      v.providerBindings.publication.bindingSha256 = publicationBindingOf(v as never, p).bindingSha256;
      const next = resolvePublicationBinding(v as never, p);
      await assert.rejects(synthesize(spec, new PublicationNarrationReplay(dir, next), { ...config, voice: v as never }), (err: Error) => err instanceof PublicationNarrationError && /binding/.test(err.message), what);
    }
  });

  test('tampered audio or records are refused: a byte, the identity, a link-free path, an extra line', async () => {
    const tamper: [string, (dir: string) => void, RegExp][] = [
      ['audio byte', (dir) => { const f = path.join(dir, 'hook.l1.wav'); const b = readFileSync(f); b[b.length - 1] = b[b.length - 1]! ^ 1; writeFileSync(f, b); }, /audio/],
      ['missing audio', (dir) => rmSync(path.join(dir, 'hook.l2.wav')), /audio/],
      ['record edited', (dir) => { const f = path.join(dir, PUBLICATION_RECORD_FILE); writeFileSync(f, readFileSync(f, 'utf8').replace('"durationMs": 1240', '"durationMs": 1300')); }, /record/],
      ['record missing', (dir) => rmSync(path.join(dir, PUBLICATION_RECORD_FILE)), /no publication narration/],
    ];
    for (const [what, edit, why] of tamper) {
      const { dir, spec } = await synthesizedSet();
      edit(dir);
      await assert.rejects(synthesize(spec, new PublicationNarrationReplay(dir, resolved()), config), (err: Error) => err instanceof PublicationNarrationError && why.test(err.message), what);
    }
  });

  test('a fixture or foreign record never qualifies as publication narration', async () => {
    const { dir, spec } = await synthesizedSet();
    const file = path.join(dir, PUBLICATION_RECORD_FILE);
    const record = JSON.parse(readFileSync(file, 'utf8')) as { subject: { binding: { provider: string } } };
    record.subject.binding.provider = 'fixture-estimate';
    writeFileSync(file, JSON.stringify(record));
    await assert.rejects(synthesize(spec, new PublicationNarrationReplay(dir, resolved()), config), PublicationNarrationError);
    // Even with its identity recomputed (a forger's record), a record naming a provider outside the allowlist is invalid on its own.
    const forged = record as unknown as PublicationNarrationRecord;
    forged.identity = recordIdentity(forged.schema, forged.subject);
    assert.ok(validatePublicationRecord(forged, {}).some((e) => /not a publication provider/.test(e)));
  });

  test('a proof set never replays as a video set, even for the same script and binding', async () => {
    const dir = path.join(scratch(), 'narration');
    await synthesize(committedSpec(), publicationVoice(dir, elevenlabs(), { ELEVENLABS_API_KEY: KEY }, resolved(), 'proof'), config);
    await assert.rejects(synthesize(committedSpec(), new PublicationNarrationReplay(dir, resolved()), config), (err: Error) => err instanceof PublicationNarrationError && /proof set, not a video set/.test(err.message));
    const track = await synthesize(committedSpec(), new PublicationNarrationReplay(dir, resolved(), { scope: 'proof' }), config);
    assert.equal(track.lines.length, voiceRequestFor(committedSpec(), config.voice, config.lexicon).lines.length);
  });

  test('captions and timing run on the measured durations and pass caption QA', async () => {
    const { dir, spec } = await synthesizedSet();
    const track = await synthesize(spec, new PublicationNarrationReplay(dir, resolved()), config);
    const timeline = buildTimeline(spec, track, config.templates);
    const estimate = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
    assert.notEqual(timeline.totalMs, estimate.totalMs, 'the timeline follows the real audio, not the estimate');
    const qa = new IssueCollector();
    checkCaptions(buildCaptions(timeline), spec, timeline, config.lexicon, qa);
    assert.deepEqual(qa.report().issues, []);
    const audio = narrationAudio(timeline, track, spec.id);
    assert.equal(audio.length, track.lines.length);
    const first = timeline.segments.flatMap((s) => s.lines)[0]!;
    assert.deepEqual(audio[0], { lineId: first.id, src: `${spec.id}/narration/${first.id}.wav`, fromFrame: Math.round((first.startMs * 30) / 1000), durationInFrames: Math.ceil((1240 * 30) / 1000) });
    assert.deepEqual(narrationAudio(timeline, estimateTrack(spec, config.voice, config.lexicon), spec.id), [], 'a silent fixture track plays nothing');
  });
});

describe('publication narration: paid audio is never wasted on a local failure', () => {
  test('a set directory that cannot be replaced is refused before any paid call', async () => {
    for (const where of ['set', 'staging'] as const) {
      const { dir, spec } = await synthesizedSet();
      const edited = clone(spec);
      edited.segments.find((s) => s.narration.length > 0)!.narration[0]!.text += ' Always.';
      if (where === 'staging') mkdirSync(`${dir}.staging`);
      writeFileSync(path.join(where === 'set' ? dir : `${dir}.staging`, 'notes.txt'), 'not part of a set');
      const stub = elevenlabs();
      await assert.rejects(synthesize(edited, publicationVoice(dir, stub), config), (err: Error) => err instanceof PublicationNarrationError && /notes\.txt/.test(err.message), where);
      assert.equal(stub.calls.length, 0, `${where}: refused before the preflight and every POST`);
      assert.ok(readdirSync(dir).includes(PUBLICATION_RECORD_FILE), `${where}: the old set is untouched`);
    }
  });

  test('a verified set left in staging by an interrupted run is adopted, not paid for again', async () => {
    const { dir, spec } = await synthesizedSet();
    renameSync(dir, `${dir}.staging`);
    const stub = elevenlabs();
    const track = await synthesize(spec, publicationVoice(dir, stub, {}), config);
    assert.equal(stub.calls.length, 0, 'no key, no call');
    assert.ok(track.publication);
    assert.ok(readdirSync(dir).includes(PUBLICATION_RECORD_FILE));
    assert.throws(() => readdirSync(`${dir}.staging`), /ENOENT/);
  });

  test('a key with control characters never reaches fetch, and its value is never echoed', async () => {
    const bad = `${KEY}\nsecond-line`;
    const stub = elevenlabs();
    await assert.rejects(synthesize(committedSpec(), publicationVoice(path.join(scratch(), 'n'), stub, { ELEVENLABS_API_KEY: bad }), config), (err: Error) => !err.message.includes(KEY) && /ELEVENLABS_API_KEY/.test(err.message));
    assert.equal(stub.calls.length, 0);
  });

  test('every record constraint holds before the first request: a long video id works, a line with no words is refused unpaid', async () => {
    const longId = `v${'x'.repeat(63)}`;
    const dir = path.join(scratch(), 'narration');
    const voice = new ElevenLabsPublicationVoice({ videoId: longId, scope: 'video', dir, publication: resolved(), adapter: new ElevenLabsProvider(loadProvidersConfig().providers.elevenlabs), env: { ELEVENLABS_API_KEY: KEY }, fetch: elevenlabs().fetch });
    assert.equal((await synthesize(committedSpec(), voice, config)).publication?.provider, 'elevenlabs', 'a 64-character id the spec allows');
    const wordless = clone(committedSpec());
    wordless.segments.find((s) => s.narration.length > 0)!.narration[0]!.text = '—';
    const stub = elevenlabs();
    await assert.rejects(synthesize(wordless, publicationVoice(path.join(scratch(), 'n'), stub), config), (err: Error) => err instanceof PublicationNarrationError && /no spoken words/.test(err.message));
    assert.equal(stub.calls.length, 0);
  });
});

describe('publication narration: the boundary', () => {
  test('render and publish steps reach the offline replay, never the synthesis step, the network, or the environment', () => {
    // test/guards.test.ts proves no render or publish entry reaches an adapter; this proves they do reach the replay,
    // so --narration=publication is wired, and that the replay itself has no way to make a call or read a credential.
    const closure = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const queue = [path.join(VIDEO_ROOT, ...entry.split('/'))];
      while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) if (m[1]!.startsWith('.')) queue.push(path.resolve(path.dirname(file), m[1]!));
      }
      return seen;
    };
    const replay = path.join(VIDEO_ROOT, 'src', 'narration', 'publication.ts');
    const synthesis = path.join(VIDEO_ROOT, 'src', 'narration', 'providers', 'publication.ts');
    for (const entry of ['scripts/render.ts', 'scripts/publish-dry-run.ts', 'scripts/public-output-check.ts', 'scripts/publication-receipt.ts', 'scripts/blender-invariants.ts']) {
      const reached = closure(entry);
      assert.ok(reached.has(replay), `${entry} replays publication narration`);
      assert.ok(!reached.has(synthesis), `${entry} cannot synthesize`);
    }
    assert.ok(closure('scripts/narration.ts').has(synthesis), 'the narration step is the one that synthesizes');
    const text = readFileSync(replay, 'utf8');
    assert.ok(!/\bfetch\(|process\.env|api\.elevenlabs|child_process/.test(text), 'the replay makes no call and reads no environment');
  });
});

describe('publication narration: chunks and joins', () => {
  test('sentences are packed whole, greedily, up to the character budget; a long sentence stands alone', () => {
    assert.deepEqual(planChunks('One two three. Four five six! Seven?', 40), ['One two three. Four five six! Seven?']);
    assert.deepEqual(planChunks('One two three. Four five six! Seven?', 20), ['One two three.', 'Four five six!', 'Seven?']);
    assert.deepEqual(planChunks('One two three. Four five six! Seven?', 30), ['One two three. Four five six!', 'Seven?']);
    assert.deepEqual(planChunks('A sentence much longer than the budget allows. Short.', 20), ['A sentence much longer than the budget allows.', 'Short.']);
    assert.deepEqual(planChunks('No terminator at all', 320), ['No terminator at all']);
  });

  test('a join trims edge silence to the bound, inserts the fixed gap, and keeps every speech sample', () => {
    const policy = resolved().binding.chunking;
    const one = joinChunks([pcm(250, 500, 400)], RATE, policy);
    assert.equal(parseWav(one).durationMs, 120 + 500 + 120);
    const two = joinChunks([pcm(250, 500, 400), pcm(50, 500, 60)], RATE, policy);
    assert.equal(parseWav(two).durationMs, 120 + 500 + 120 + 220 + 50 + 500 + 60);
    const quiet = joinChunks([pcm(250, 500, 400, RATE, 50)], RATE, policy);
    assert.equal(parseWav(quiet).durationMs, 740, 'noise under -50 dBFS is silence');
    assert.deepEqual(joinChunks([pcm(250, 500, 400)], RATE, policy), joinChunks([pcm(250, 500, 400)], RATE, policy), 'deterministic');
    assert.deepEqual(parseWav(one).sampleRate, RATE);
    assert.throws(() => joinChunks([pcm(500, 0, 500)], RATE, policy), /no speech/);
    assert.throws(() => joinChunks([], RATE, policy), /no speech/);
    assert.equal(wrapPcm16(new Uint8Array(4), RATE, 1).length, 48, 'header sanity');
  });
});
