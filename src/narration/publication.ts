// Publication narration (docs/NARRATION.md, "Publication narration").
//
// The spec decides WHAT may be spoken, the narration budget decides WHETHER it may be synthesized, and the provider
// only performs synthesis. This module holds everything about publication narration that is not a network call:
//
// - the approved binding: config/narration-providers.json names it (provider, variant, chunk policy) and
//   config/voice-identity.json approves it by pinning its content address; a binding that does not hash to the pin,
//   or names a provider outside PUBLICATION_PROVIDERS, is refused before anything runs;
// - the chunk plan (whole sentences packed up to a character budget) and the deterministic, lossless join;
// - the narration set: one WAV per narration line plus a closed, content-addressed record binding the script, the
//   binding, the chunk plan, the pronunciation entries the script speaks, and every audio byte
//   (walletwall.publication-narration/v2);
// - partial regeneration: the lines of a previous verified set (v1 or v2) whose audio is still exactly right (the same
//   spoken text, chunk plan, and binding, every byte checked against that set's own record) carry over into the next
//   set; only the rest are paid for, and the new record is built from the current script alone;
// - the replay: a VoiceProvider that reads a set from disk, verifies all of it against the current script and binding,
//   and returns a track whose durations are measured from the audio. A stale or tampered set is refused, never reused.
//
// The one credentialed step that makes a set is src/narration/providers/publication.ts, reached only from
// scripts/narration.ts. Render and publish scripts reach this module and replay; they never reach an adapter, the
// network, or a credential (test/guards.test.ts). Node-only (reads configuration and the set from disk).

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { FixtureVoiceProvider, spokenWordCount, type VoiceProvider, type VoiceRequest } from '../audio/voice-provider.ts';
import { DIST_ROOT, readJson, VIDEO_ROOT } from '../config/load.ts';
import type { VoiceIdentity } from '../config/types.ts';
import { readContainedFile } from '../core/contained-read.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import type { NarrationTrack, PublicationNarrationRef } from '../timeline/timeline.ts';
import { LOCAL_PATH_SHAPE } from './artifact.ts';
import { assertLexiconPinned, narrationLexiconBinding, type NarrationLexiconBinding } from './lexicon.ts';
import { parseWav, wrapPcm16 } from './wav.ts';

/** The providers that may be bound for publication. Promoting another (a local or R&D voice) is a separate policy decision and a code change. */
export const PUBLICATION_PROVIDERS = ['elevenlabs'] as const;
export const PUBLICATION_BINDING_SCHEMA = 'walletwall.publication-voice-binding/v1';
export const PUBLICATION_NARRATION_SCHEMA = 'walletwall.publication-narration/v2';
/** The record before it bound the lexicon: never current, but its lines can carry over (carryOverLines). */
export const PUBLICATION_NARRATION_SCHEMA_V1 = 'walletwall.publication-narration/v1';
export const PUBLICATION_RECORD_FILE = 'publication-narration.json';
/** The join's own behaviour, versioned: part of every binding, so a change to the join stales every set made with the old one. */
export const CHUNK_JOIN = Object.freeze({ version: 1, silenceDbfs: -50 } as const);
const MAX_RECORD_BYTES = 4 * 1024 * 1024;

export const NARRATION_MODES = ['fixture', 'publication'] as const;
export type NarrationMode = (typeof NARRATION_MODES)[number];

export class PublicationBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationBindingError';
  }
}

/** Why publication narration cannot be made or used: stable codes, never a secret. */
export class PublicationNarrationError extends Error {
  readonly code: 'MISSING' | 'INVALID' | 'STALE' | 'AUDIO' | 'CREDENTIAL' | 'BINDING' | 'PROVIDER';
  constructor(code: PublicationNarrationError['code'], message: string) {
    super(message);
    this.name = 'PublicationNarrationError';
    this.code = code;
  }
}

export interface PublicationChunkPolicy {
  mode: 'sentence';
  maxChars: number;
  gapMs: number;
  trimMs: number;
  join: typeof CHUNK_JOIN;
}

/** The resolved binding: everything that decides what publication audio sounds like, and nothing else. */
export interface PublicationBinding {
  schema: typeof PUBLICATION_BINDING_SCHEMA;
  id: string;
  provider: (typeof PUBLICATION_PROVIDERS)[number];
  variant: string;
  modelId: string;
  voiceId: string;
  voiceIdentityId: string;
  language: string;
  settings: Readonly<Record<string, string | number | boolean | null>>;
  chunking: PublicationChunkPolicy;
}

export interface ResolvedPublication {
  binding: PublicationBinding;
  /** Content address of the binding: what config/voice-identity.json pins. */
  bindingSha256: string;
  /** Content address of what shapes the audio: provider, validated settings, chunk policy. */
  synthesisConfigSha256: string;
  /** The PCM rate the binding's output format delivers. */
  sampleRate: number;
}

// ── The binding ───────────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function own(value: unknown, keys: readonly string[], where: string): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PublicationBindingError(`${where} must be an object`);
  const obj = value as Obj;
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw new PublicationBindingError(`${where} has an unknown field ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(obj, k)) throw new PublicationBindingError(`${where} is missing ${JSON.stringify(k)}`);
  return obj;
}

function member(value: unknown, key: string, where: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key)) throw new PublicationBindingError(`${where} has no ${JSON.stringify(key)}`);
  return (value as Obj)[key];
}

const PLAIN = /^[a-z0-9][a-z0-9-]{0,60}$/;
/** A video id, as the spec validator allows it (src/validation/validate-spec.ts). */
const VIDEO_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A voice id is an opaque provider token: never a path, a URL, or anything with separators (the adapter checks its own shape). */
const TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;

function wholeIn(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new PublicationBindingError(`${where} must be a whole number in [${min}, ${max}]`);
  return v;
}

/**
 * The binding config/narration-providers.json describes for publication, resolved against the voice identity, and its
 * content addresses. It does not consult the identity's approval: resolvePublicationBinding does.
 */
export function publicationBindingOf(voice: VoiceIdentity, providers: unknown): ResolvedPublication {
  const block = own(member(providers, 'publication', 'config/narration-providers.json'), ['id', 'note', 'provider', 'variant', 'chunking'], 'config/narration-providers.json publication');
  if (typeof block.id !== 'string' || !PLAIN.test(block.id)) throw new PublicationBindingError('the publication binding id must be a plain id');
  const provider = block.provider;
  if (!(PUBLICATION_PROVIDERS as readonly unknown[]).includes(provider)) throw new PublicationBindingError(`${JSON.stringify(provider)} is not a publication provider (allowed: ${PUBLICATION_PROVIDERS.join(', ')}); promoting another provider is a separate policy decision`);
  const adapter = member(member(providers, 'providers', 'config/narration-providers.json'), provider as string, 'config/narration-providers.json providers') as Obj;
  const voiceId = member(adapter, 'voiceId', `the ${provider as string} binding`);
  if (typeof voiceId !== 'string' || !TOKEN.test(voiceId)) throw new PublicationBindingError(`the ${provider as string} voice id is not a plain token`);
  const language = voice.direction.language;
  if (member(adapter, 'accent', `the ${provider as string} binding`) !== language) throw new PublicationBindingError(`the ${provider as string} voice is not declared ${language}, the identity's language`);
  if (typeof block.variant !== 'string' || !PLAIN.test(block.variant)) throw new PublicationBindingError('the publication variant must be a plain id');
  const raw = member(member(adapter, 'variants', `the ${provider as string} binding`), block.variant, `the ${provider as string} variants`);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicationBindingError(`variant ${block.variant} must be an object`);
  const settings: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new PublicationBindingError(`variant ${block.variant} setting ${k} must be a primitive`);
    settings[k] = v;
  }
  if (typeof settings.modelId !== 'string' || !settings.modelId) throw new PublicationBindingError(`variant ${block.variant} names no model`);
  // Raw PCM only: the join and every hash work on the samples the model produced, with no decoder in between.
  const rate = typeof settings.outputFormat === 'string' ? /^pcm_(\d{4,6})$/.exec(settings.outputFormat) : null;
  if (!rate) throw new PublicationBindingError(`variant ${block.variant} must deliver raw PCM (pcm_<rate>)`);
  const c = own(block.chunking, ['mode', 'maxChars', 'gapMs', 'trimMs'], 'the publication chunk policy');
  if (c.mode !== 'sentence') throw new PublicationBindingError('the publication chunk policy mode must be sentence');
  const chunking: PublicationChunkPolicy = { mode: 'sentence', maxChars: wholeIn(c.maxChars, 80, 5000, 'maxChars'), gapMs: wholeIn(c.gapMs, 0, 2000, 'gapMs'), trimMs: wholeIn(c.trimMs, 0, 1000, 'trimMs'), join: CHUNK_JOIN };
  const binding: PublicationBinding = {
    schema: PUBLICATION_BINDING_SCHEMA,
    id: block.id,
    provider: provider as PublicationBinding['provider'],
    variant: block.variant,
    modelId: settings.modelId,
    voiceId,
    voiceIdentityId: voice.id,
    language,
    settings: Object.freeze(settings),
    chunking,
  };
  return {
    binding,
    bindingSha256: contentAddress(binding),
    synthesisConfigSha256: contentAddress({ provider: binding.provider, settings: binding.settings, chunking: binding.chunking }),
    sampleRate: Number(rate[1]),
  };
}

/** The approved binding: the identity names it, and its content address is exactly the identity's pin. Fails closed otherwise. */
export function resolvePublicationBinding(voice: VoiceIdentity, providers: unknown): ResolvedPublication {
  const approval = own(member(voice.providerBindings, 'publication', 'config/voice-identity.json providerBindings'), ['status', 'provider', 'binding', 'bindingSha256'], 'config/voice-identity.json providerBindings.publication');
  if (approval.status !== 'APPROVED') throw new PublicationBindingError(`the identity's publication binding is ${JSON.stringify(approval.status)}, not APPROVED`);
  if (typeof approval.bindingSha256 !== 'string' || !HEX64.test(approval.bindingSha256)) throw new PublicationBindingError("the identity's publication binding pins no sha256");
  const resolved = publicationBindingOf(voice, providers);
  if (approval.provider !== resolved.binding.provider || approval.binding !== resolved.binding.id) throw new PublicationBindingError(`the identity approves ${String(approval.provider)} ${String(approval.binding)}, not ${resolved.binding.provider} ${resolved.binding.id}`);
  if (approval.bindingSha256 !== resolved.bindingSha256) {
    throw new PublicationBindingError(`the publication binding in config/narration-providers.json is not the one config/voice-identity.json approves (pinned ${approval.bindingSha256.slice(0, 12)}, resolved ${resolved.bindingSha256.slice(0, 12)}): a voice, model, setting, chunk policy, or identity changed; approving it is a reviewed change to the pin`);
  }
  return resolved;
}

export function loadPublicationBinding(videoRoot: string = VIDEO_ROOT): ResolvedPublication {
  const voice = readJson<VoiceIdentity>(path.join(videoRoot, 'config', 'voice-identity.json'));
  return resolvePublicationBinding(voice, readJson<unknown>(path.join(videoRoot, 'config', 'narration-providers.json')));
}

// ── Chunks and the join ──────────────────────────────────────────────────────────────────────────

/** Sentences at terminal punctuation (with any closing quotes or brackets) followed by whitespace; whitespace normalized. */
export function splitSentences(text: string): string[] {
  const t = text.trim().replace(/\s+/g, ' ');
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if (!'.!?'.includes(t[i]!)) continue;
    let end = i + 1;
    while (end < t.length && `"')]`.includes(t[end]!)) end++;
    if (end < t.length && t[end] !== ' ') continue;
    out.push(t.slice(start, end));
    start = end + 1;
    i = end;
  }
  if (start < t.length) out.push(t.slice(start));
  return out.filter(Boolean);
}

/** Whole sentences packed greedily up to `maxChars` per chunk; a sentence is never split, so a longer one stands alone. */
export function planChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (current && current.length + 1 + sentence.length <= maxChars) current = `${current} ${sentence}`;
    else {
      if (current) chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Join raw PCM16 mono chunks into one line's WAV: each chunk's leading and trailing silence (every sample at or under
 * CHUNK_JOIN.silenceDbfs) is cut to at most trimMs, and chunks are separated by exactly gapMs of digital silence.
 * Integer samples are copied, never rescaled, so every speech sample survives byte for byte. A chunk with no speech fails.
 */
export function joinChunks(chunks: readonly Uint8Array[], sampleRate: number, policy: PublicationChunkPolicy): Uint8Array {
  if (chunks.length === 0) throw new PublicationNarrationError('AUDIO', 'a line has no chunks: no speech to join');
  const level = Math.round(32768 * 10 ** (policy.join.silenceDbfs / 20));
  const trim = Math.round((sampleRate * policy.trimMs) / 1000);
  const gap = Math.round((sampleRate * policy.gapMs) / 1000);
  const kept: Uint8Array[] = [];
  chunks.forEach((chunk, k) => {
    if (chunk.length % 2 !== 0) throw new PublicationNarrationError('AUDIO', `chunk ${k} is not whole 16-bit samples`);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const n = chunk.length / 2;
    let first = -1;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (Math.abs(view.getInt16(i * 2, true)) > level) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) throw new PublicationNarrationError('AUDIO', `chunk ${k} holds no speech above ${policy.join.silenceDbfs} dBFS`);
    if (k > 0) kept.push(new Uint8Array(gap * 2));
    kept.push(chunk.subarray(Math.max(0, first - trim) * 2, Math.min(n, last + 1 + trim) * 2));
  });
  const pcm = new Uint8Array(kept.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of kept) {
    pcm.set(c, at);
    at += c.length;
  }
  return wrapPcm16(pcm, sampleRate, 1);
}

// ── The narration set ────────────────────────────────────────────────────────────────────────────

/** Narration line ids become file names: plain, lowercase, no separators, never `..`. */
const LINE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/;
export const isLineId = (id: unknown): id is string => typeof id === 'string' && LINE_ID.test(id) && !id.includes('..');

export type PublicationScope = 'video' | 'proof';

export interface PublicationLineRecord {
  lineId: string;
  displaySha256: string;
  spokenSha256: string;
  spokenWords: number;
  /** sha256 of each chunk's text, in order. */
  chunks: string[];
  audio: { file: string; sha256: string; sampleRate: number; channels: number; bitsPerSample: number; frames: number; durationMs: number };
}

export interface PublicationRecordBinding {
  id: string;
  provider: string;
  modelId: string;
  voiceId: string;
  voiceIdentityId: string;
  language: string;
  bindingSha256: string;
  synthesisConfigSha256: string;
}

export interface PublicationNarrationRecord {
  schema: typeof PUBLICATION_NARRATION_SCHEMA;
  identity: string;
  subject: {
    videoId: string;
    scope: PublicationScope;
    binding: PublicationRecordBinding;
    script: { sha256: string; lines: number; spokenWords: number };
    chunkPlanSha256: string;
    /** The lexicon (src/narration/lexicon.ts): its id and version, and the content address of the entries the script speaks. */
    lexicon: NarrationLexiconBinding;
    audioSha256: string;
    lines: PublicationLineRecord[];
  };
  /** Never part of the identity: when it was made, the paid requests it took, and the lines carried from a previous set. */
  informational: { generatedAt: string | null; requests: number; carried: CarriedLine[] };
}

/**
 * A line whose audio this set carried over instead of paying for it again, and where that audio was made: the identity
 * of the set whose synthesis run made it, and that run's time (null when that record had none). Followed back through
 * any number of carries, so a set that ships can always say which run, and so which plan, made each of its lines.
 */
export interface CarriedLine {
  lineId: string;
  madeIn: string;
  madeAt: string | null;
}

/** What a set must be for the current script and binding: derived from the voice request alone, before any file is read. */
export interface PublicationExpectation {
  videoId: string | null;
  scope: PublicationScope;
  binding: PublicationRecordBinding;
  sampleRate: number;
  lines: { lineId: string; displaySha256: string; spokenSha256: string; spokenWords: number; chunks: string[]; texts: string[] }[];
  scriptSha256: string;
  chunkPlanSha256: string;
  lexicon: NarrationLexiconBinding;
}

const scriptAddress = (lines: readonly { lineId: string; displaySha256: string; spokenSha256: string }[]): string => contentAddress(lines.map((l) => ({ lineId: l.lineId, displaySha256: l.displaySha256, spokenSha256: l.spokenSha256 })));
const chunkAddress = (lines: readonly { lineId: string; chunks: readonly string[] }[]): string => contentAddress(lines.map((l) => ({ lineId: l.lineId, chunks: l.chunks })));

/**
 * What a set must be, from the request alone. Every constraint the record validator puts on it is checked here, so a
 * script the record could not hold is refused before the first request, never after the last.
 */
export function publicationExpectation(request: VoiceRequest, publication: ResolvedPublication, videoId: string | null, scope: PublicationScope): PublicationExpectation {
  const b = publication.binding;
  if (videoId !== null && !VIDEO_ID.test(videoId)) throw new PublicationNarrationError('INVALID', `video id ${JSON.stringify(videoId)} is not a plain id`);
  if (request.lines.length === 0) throw new PublicationNarrationError('INVALID', 'the script has no narration lines');
  const lines = request.lines.map((l) => {
    if (!isLineId(l.lineId)) throw new PublicationNarrationError('INVALID', `narration line id ${JSON.stringify(l.lineId)} is not a plain id`);
    const spokenWords = spokenWordCount(l.spokenText);
    const texts = planChunks(l.spokenText, b.chunking.maxChars);
    if (spokenWords < 1 || texts.length === 0) throw new PublicationNarrationError('INVALID', `narration line ${l.lineId} has no spoken words`);
    return { lineId: l.lineId, displaySha256: sha256Hex(l.displayText), spokenSha256: sha256Hex(l.spokenText), spokenWords, chunks: texts.map((t) => sha256Hex(t)), texts };
  });
  if (new Set(lines.map((l) => l.lineId)).size !== lines.length) throw new PublicationNarrationError('INVALID', 'narration line ids are not unique');
  return {
    videoId,
    scope,
    binding: { id: b.id, provider: b.provider, modelId: b.modelId, voiceId: b.voiceId, voiceIdentityId: request.identity.id, language: request.identity.direction.language, bindingSha256: publication.bindingSha256, synthesisConfigSha256: publication.synthesisConfigSha256 },
    sampleRate: publication.sampleRate,
    lines,
    scriptSha256: scriptAddress(lines),
    chunkPlanSha256: chunkAddress(lines),
    lexicon: narrationLexiconBinding(request.lines.map((l) => l.displayText), request.lexicon),
  };
}

export const recordIdentity = (schema: string, subject: PublicationNarrationRecord['subject']): string => contentAddress({ schema, subject });

export function buildPublicationRecord(args: { expectation: PublicationExpectation; videoId: string; audio: ReadonlyMap<string, Uint8Array>; generatedAt: string | null; requests: number; carried?: readonly CarriedLine[] }): PublicationNarrationRecord {
  const e = args.expectation;
  const lines: PublicationLineRecord[] = e.lines.map((l) => {
    const wav = args.audio.get(l.lineId);
    if (!wav) throw new PublicationNarrationError('AUDIO', `no audio for line ${l.lineId}`);
    const info = parseWav(wav);
    return { lineId: l.lineId, displaySha256: l.displaySha256, spokenSha256: l.spokenSha256, spokenWords: l.spokenWords, chunks: [...l.chunks], audio: { file: `${l.lineId}.wav`, sha256: sha256Hex(wav), sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, frames: info.frames, durationMs: info.durationMs } };
  });
  const subject: PublicationNarrationRecord['subject'] = {
    videoId: args.videoId,
    scope: e.scope,
    binding: { ...e.binding },
    script: { sha256: e.scriptSha256, lines: lines.length, spokenWords: lines.reduce((n, l) => n + l.spokenWords, 0) },
    chunkPlanSha256: e.chunkPlanSha256,
    lexicon: { ...e.lexicon },
    audioSha256: contentAddress(lines.map((l) => l.audio.sha256)),
    lines,
  };
  return { schema: PUBLICATION_NARRATION_SCHEMA, identity: recordIdentity(PUBLICATION_NARRATION_SCHEMA, subject), subject, informational: { generatedAt: args.generatedAt, requests: args.requests, carried: (args.carried ?? []).map((c) => ({ lineId: c.lineId, madeIn: c.madeIn, madeAt: c.madeAt })) } };
}

const TOP = ['schema', 'identity', 'subject', 'informational'];
const SUBJECT = ['videoId', 'scope', 'binding', 'script', 'chunkPlanSha256', 'lexicon', 'audioSha256', 'lines'];
const SUBJECT_V1 = SUBJECT.filter((k) => k !== 'lexicon');
const LEXICON = ['id', 'version', 'appliedSha256'];
const BINDING = ['id', 'provider', 'modelId', 'voiceId', 'voiceIdentityId', 'language', 'bindingSha256', 'synthesisConfigSha256'];
const SCRIPT = ['sha256', 'lines', 'spokenWords'];
const LINE = ['lineId', 'displaySha256', 'spokenSha256', 'spokenWords', 'chunks', 'audio'];
const AUDIO = ['file', 'sha256', 'sampleRate', 'channels', 'bitsPerSample', 'frames', 'durationMs'];
const INFO = ['generatedAt', 'requests', 'carried'];
const INFO_V1 = ['generatedAt', 'requests'];
const CARRIED = ['lineId', 'madeIn', 'madeAt'];

function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Obj)) {
      yield k;
      yield* strings(v);
    }
  }
}

/**
 * Validate a record: the closed shape at every level (own keys only), every hash it derives (script, chunk plan, audio,
 * identity) consistent with its lines, a publication provider, no local path, and no credential-shaped environment value
 * (`env`) anywhere in it. Returns the problems; an empty list is a valid record. `legacy` also admits the v1 format
 * (no lexicon binding), which is never current but whose lines may carry over.
 */
export function validatePublicationRecord(value: unknown, env: Readonly<Record<string, string | undefined>>, opts: { legacy?: boolean } = {}): string[] {
  const errors: string[] = [];
  const shape = (v: unknown, keys: readonly string[], where: string): v is Obj => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      errors.push(`${where}: not an object`);
      return false;
    }
    for (const k of Object.keys(v)) if (!keys.includes(k)) errors.push(`${where}: unknown field ${JSON.stringify(k)}`);
    for (const k of keys) if (!Object.hasOwn(v, k)) errors.push(`${where}: missing field ${JSON.stringify(k)}`);
    return true;
  };
  const hex = (v: unknown, where: string) => typeof v === 'string' && HEX64.test(v) ? true : (errors.push(`${where} must be a sha256`), false);
  const whole = (v: unknown, where: string, min = 0) => typeof v === 'number' && Number.isInteger(v) && v >= min ? true : (errors.push(`${where} must be a whole number >= ${min}`), false);
  if (!shape(value, TOP, 'record')) return errors;
  const v1 = opts.legacy === true && value.schema === PUBLICATION_NARRATION_SCHEMA_V1;
  if (value.schema !== PUBLICATION_NARRATION_SCHEMA && !v1) errors.push(`schema must be ${PUBLICATION_NARRATION_SCHEMA}`);
  hex(value.identity, 'identity');
  const s = value.subject;
  if (shape(s, v1 ? SUBJECT_V1 : SUBJECT, 'subject')) {
    if (!v1 && shape(s.lexicon, LEXICON, 'subject.lexicon')) {
      if (typeof s.lexicon.id !== 'string' || !PLAIN.test(s.lexicon.id)) errors.push('subject.lexicon.id must be a plain id');
      whole(s.lexicon.version, 'subject.lexicon.version', 1);
      hex(s.lexicon.appliedSha256, 'subject.lexicon.appliedSha256');
    }
    if (typeof s.videoId !== 'string' || !VIDEO_ID.test(s.videoId)) errors.push('subject.videoId must be a plain id');
    if (s.scope !== 'video' && s.scope !== 'proof') errors.push('subject.scope must be video or proof');
    if (shape(s.binding, BINDING, 'subject.binding')) {
      const b = s.binding;
      if (!(PUBLICATION_PROVIDERS as readonly unknown[]).includes(b.provider)) errors.push('subject.binding.provider is not a publication provider');
      for (const k of ['id', 'modelId', 'voiceId', 'voiceIdentityId', 'language'] as const) if (typeof b[k] !== 'string' || !(b[k] as string).length) errors.push(`subject.binding.${k} must be a non-empty string`);
      hex(b.bindingSha256, 'subject.binding.bindingSha256');
      hex(b.synthesisConfigSha256, 'subject.binding.synthesisConfigSha256');
    }
    const lines = Array.isArray(s.lines) ? s.lines : (errors.push('subject.lines must be a list'), []);
    if (lines.length === 0) errors.push('subject.lines is empty');
    const seen = new Set<string>();
    let wordsTotal = 0;
    lines.forEach((l: unknown, i: number) => {
      const where = `subject.lines[${i}]`;
      if (!shape(l, LINE, where)) return;
      if (!isLineId(l.lineId) || seen.has(l.lineId)) errors.push(`${where}.lineId must be a unique plain id`);
      else seen.add(l.lineId);
      hex(l.displaySha256, `${where}.displaySha256`);
      hex(l.spokenSha256, `${where}.spokenSha256`);
      if (whole(l.spokenWords, `${where}.spokenWords`, 1)) wordsTotal += l.spokenWords as number;
      if (!Array.isArray(l.chunks) || l.chunks.length === 0) errors.push(`${where}.chunks must be a non-empty list`);
      else l.chunks.forEach((c: unknown, k: number) => hex(c, `${where}.chunks[${k}]`));
      if (shape(l.audio, AUDIO, `${where}.audio`)) {
        const a = l.audio;
        if (a.file !== `${String(l.lineId)}.wav`) errors.push(`${where}.audio.file must be the line id's .wav`);
        hex(a.sha256, `${where}.audio.sha256`);
        whole(a.sampleRate, `${where}.audio.sampleRate`, 8000);
        if (a.channels !== 1) errors.push(`${where}.audio.channels must be 1`);
        if (a.bitsPerSample !== 16) errors.push(`${where}.audio.bitsPerSample must be 16`);
        if (whole(a.frames, `${where}.audio.frames`, 1) && typeof a.sampleRate === 'number' && a.durationMs !== Math.round(((a.frames as number) * 1000) / a.sampleRate)) errors.push(`${where}.audio.durationMs disagrees with frames and sampleRate`);
      }
    });
    if (errors.length === 0) {
      const ls = lines as PublicationLineRecord[];
      if (shape(s.script, SCRIPT, 'subject.script')) {
        if (s.script.sha256 !== scriptAddress(ls)) errors.push('subject.script.sha256 is not the hash of its lines');
        if (s.script.lines !== ls.length || s.script.spokenWords !== wordsTotal) errors.push('subject.script counts disagree with its lines');
      }
      if (s.chunkPlanSha256 !== chunkAddress(ls)) errors.push('subject.chunkPlanSha256 is not the hash of its lines');
      if (s.audioSha256 !== contentAddress(ls.map((l) => l.audio.sha256))) errors.push('subject.audioSha256 is not the hash of its lines');
    }
  }
  if (shape(value.informational, v1 ? INFO_V1 : INFO, 'informational')) {
    const g = value.informational.generatedAt;
    if (g !== null && (typeof g !== 'string' || Number.isNaN(Date.parse(g)))) errors.push('informational.generatedAt must be an ISO timestamp or null');
    whole(value.informational.requests, 'informational.requests');
    if (!v1) {
      const c = value.informational.carried;
      const subjectLines = (s as { lines?: unknown } | null | undefined)?.lines;
      const lineIds = new Set(Array.isArray(subjectLines) ? (subjectLines as ({ lineId?: unknown } | null)[]).map((l) => l?.lineId) : []);
      const seenCarried = new Set<string>();
      if (!Array.isArray(c)) errors.push('informational.carried must be a list');
      else {
        c.forEach((e: unknown, k: number) => {
          const where = `informational.carried[${k}]`;
          if (!shape(e, CARRIED, where)) return;
          if (!isLineId(e.lineId) || !lineIds.has(e.lineId) || seenCarried.has(e.lineId)) errors.push(`${where}.lineId must be a line of this set, once`);
          else seenCarried.add(e.lineId);
          hex(e.madeIn, `${where}.madeIn`);
          if (e.madeAt !== null && (typeof e.madeAt !== 'string' || Number.isNaN(Date.parse(e.madeAt)))) errors.push(`${where}.madeAt must be an ISO timestamp or null`);
        });
      }
    }
  }
  for (const text of strings(value)) if (LOCAL_PATH_SHAPE.test(text)) errors.push(`a local path appears in the record: ${JSON.stringify(text.slice(0, 40))}`);
  if (errors.length === 0 && value.identity !== recordIdentity(value.schema as string, s as PublicationNarrationRecord['subject'])) errors.push('identity is not the content address of the record');
  const serialized = JSON.stringify(value);
  for (const [name, v] of Object.entries(env)) {
    if (!v || v.length < 12 || !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    if (serialized.includes(v)) errors.push(`the value of ${name} appears in the record`);
  }
  return errors;
}

export function publicationRef(record: PublicationNarrationRecord): PublicationNarrationRef {
  const s = record.subject;
  const b = s.binding;
  return { identity: record.identity, provider: b.provider, bindingId: b.id, modelId: b.modelId, voiceId: b.voiceId, voiceIdentityId: b.voiceIdentityId, language: b.language, bindingSha256: b.bindingSha256, synthesisConfigSha256: b.synthesisConfigSha256, scriptSha256: s.script.sha256, chunkPlanSha256: s.chunkPlanSha256, audioSha256: s.audioSha256 };
}

export interface VerifiedPublicationSet {
  record: PublicationNarrationRecord;
  /** sha256 of the record file's bytes as read. */
  recordSha256: string;
  ref: PublicationNarrationRef;
  lines: { lineId: string; durationMs: number; sha256: string }[];
}

interface ReadRecord {
  realDir: string;
  bytes: Buffer;
  record: PublicationNarrationRecord;
}

/** The record of the set in `dir` (one handle, no links, bounded), parsed and valid (the v1 format admitted when `legacy`). Throws PublicationNarrationError. */
function readRecordIn(dir: string, videoId: string | null, env: Readonly<Record<string, string | undefined>>, legacy: boolean): ReadRecord {
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    throw new PublicationNarrationError('MISSING', `no publication narration set${videoId ? ` for ${videoId}` : ''}: synthesize it with npm run narration -- publication`);
  }
  const bytes = readContainedFile(path.join(realDir, PUBLICATION_RECORD_FILE), (real) => real === path.join(realDir, PUBLICATION_RECORD_FILE), MAX_RECORD_BYTES);
  if (!bytes) throw new PublicationNarrationError('MISSING', `no publication narration record (${PUBLICATION_RECORD_FILE})${videoId ? ` for ${videoId}` : ''}: synthesize it with npm run narration -- publication`);
  let doc: unknown;
  try {
    doc = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PublicationNarrationError('INVALID', 'the publication narration record is not JSON');
  }
  const problems = validatePublicationRecord(doc, env, { legacy });
  if (problems.length) throw new PublicationNarrationError('INVALID', `the publication narration record is not valid: ${problems.slice(0, 6).join('; ')}`);
  return { realDir, bytes, record: doc as PublicationNarrationRecord };
}

/** Why a valid record's set was made for something else (scope, video, binding): such a set is never current and carries nothing. */
function foreignSet(s: PublicationNarrationRecord['subject'], expect: PublicationExpectation): string[] {
  const stale: string[] = [];
  if (s.scope !== expect.scope) stale.push(`it is a ${s.scope} set, not a ${expect.scope} set`);
  if (expect.videoId !== null && s.videoId !== expect.videoId) stale.push(`it was made for ${s.videoId}, not ${expect.videoId}`);
  for (const k of BINDING as (keyof PublicationRecordBinding)[]) {
    if (s.binding[k] !== expect.binding[k]) stale.push(`stale binding: made with ${k} ${String(s.binding[k]).slice(0, 24)}; the approved binding has ${String(expect.binding[k]).slice(0, 24)}`);
  }
  return stale;
}

type LineAudio = { problem: null; wav: Buffer; durationMs: number; sha256: string } | { problem: string };

/** A line's WAV, verified: a regular file in the set's own directory, the bytes its record names, in the binding's format. */
function verifiedLineAudio(realDir: string, l: PublicationLineRecord, sampleRate: number): LineAudio {
  const wav = readContainedFile(path.join(realDir, l.audio.file), (real) => real === path.join(realDir, l.audio.file));
  if (!wav) return { problem: `the audio for line ${l.lineId} is missing, a link, or not a regular file` };
  const sha = sha256Hex(wav);
  if (sha !== l.audio.sha256) return { problem: `the audio for line ${l.lineId} is not the bytes the record names` };
  let info;
  try {
    info = parseWav(wav);
  } catch (err) {
    return { problem: `the audio for line ${l.lineId} is not 16-bit PCM: ${(err as Error).message}` };
  }
  if (info.sampleRate !== sampleRate || info.channels !== 1 || info.frames !== l.audio.frames || info.durationMs !== l.audio.durationMs) return { problem: `the audio for line ${l.lineId} is not the format the record and binding name` };
  return { problem: null, wav, durationMs: info.durationMs, sha256: sha };
}

/**
 * Read and verify a narration set: the record (one handle, no links, bounded), its closed shape and identity, that it
 * is current for the expectation (scope, video, binding, lexicon, script, chunk plan), and every WAV (present, a regular
 * file in the set's own directory, the bytes and format the record names). Throws PublicationNarrationError otherwise.
 */
export function readPublicationSet(dir: string, expect: PublicationExpectation, env: Readonly<Record<string, string | undefined>> = {}): VerifiedPublicationSet {
  const { realDir, bytes, record } = readRecordIn(dir, expect.videoId, env, true);
  const s = record.subject;
  const stale = foreignSet(s, expect);
  if (record.schema !== PUBLICATION_NARRATION_SCHEMA) stale.push(`it is a ${record.schema} record, made before a set bound its pronunciation lexicon`);
  else if (s.lexicon.id !== expect.lexicon.id || s.lexicon.appliedSha256 !== expect.lexicon.appliedSha256) {
    stale.push(`stale pronunciation: made with ${s.lexicon.id} v${s.lexicon.version}, whose entries for this script differ from ${expect.lexicon.id} v${expect.lexicon.version}`);
  }
  if (s.script.sha256 !== expect.scriptSha256) {
    const changed = expect.lines.filter((l, i) => s.lines[i]?.lineId !== l.lineId || s.lines[i]?.displaySha256 !== l.displaySha256 || s.lines[i]?.spokenSha256 !== l.spokenSha256).map((l) => l.lineId);
    stale.push(`stale script: it was made for another script (${changed.length ? `changed: ${changed.slice(0, 5).join(', ')}` : `${s.lines.length} lines, now ${expect.lines.length}`})`);
  } else if (s.chunkPlanSha256 !== expect.chunkPlanSha256) stale.push('stale chunk plan: the same script is chunked differently now');
  if (stale.length) throw new PublicationNarrationError('STALE', `the publication narration set is stale and is never reused or re-labelled (synthesize it again): ${stale.join('; ')}`);
  const lines = s.lines.map((l) => {
    const a = verifiedLineAudio(realDir, l, expect.sampleRate);
    if (a.problem !== null) throw new PublicationNarrationError('AUDIO', a.problem);
    return { lineId: l.lineId, durationMs: a.durationMs, sha256: a.sha256 };
  });
  return { record, recordSha256: sha256Hex(bytes), ref: publicationRef(record), lines };
}

/** Where an interrupted run leaves a verified set it could not put in place (the next run adopts it, or carries from it). */
export const stagingDirOf = (dir: string): string => `${dir}.staging`;

export interface CarryOver {
  /** Verified audio for the expectation's lines that carry over, keyed by the expectation's line id. */
  audio: Map<string, Buffer>;
  /** Where each carried line's audio was made (the set whose run made it, and that run's time). */
  origins: Map<string, CarriedLine>;
  /** The identities of the sets lines were carried from. */
  from: string[];
}

/**
 * The lines of earlier sets (in `dirs`, in order: the set directory and its staging directory; v2 or v1 records) that the
 * expectation can reuse byte for byte: the same scope, video, and binding; a line with the same spoken text and the same
 * chunk texts; its WAV verified against that set's record. A missing, invalid, or foreign set carries nothing. Keyed by
 * the expectation's line id: the audio depends only on what is spoken and how, never on the line's id or display text.
 * Each carried line keeps its origin: the run that made the audio, followed back through the earlier set's own carries.
 */
export function carryOverLines(dirs: string | readonly string[], expect: PublicationExpectation): CarryOver {
  const out: CarryOver = { audio: new Map(), origins: new Map(), from: [] };
  for (const dir of typeof dirs === 'string' ? [dirs] : dirs) {
    let read: ReadRecord;
    try {
      read = readRecordIn(dir, expect.videoId, {}, true);
    } catch (err) {
      if (err instanceof PublicationNarrationError) continue;
      throw err;
    }
    const record = read.record;
    const s = record.subject;
    if (foreignSet(s, expect).length) continue;
    const earlier = new Map((record.schema === PUBLICATION_NARRATION_SCHEMA ? record.informational.carried : []).map((c) => [c.lineId, c]));
    let used = false;
    for (const want of expect.lines) {
      if (out.audio.has(want.lineId)) continue;
      const old = s.lines.find((l) => l.spokenSha256 === want.spokenSha256 && l.chunks.length === want.chunks.length && l.chunks.every((c, k) => c === want.chunks[k]));
      if (!old) continue;
      const a = verifiedLineAudio(read.realDir, old, expect.sampleRate);
      if (a.problem !== null) continue;
      const origin = earlier.get(old.lineId);
      out.audio.set(want.lineId, a.wav);
      out.origins.set(want.lineId, { lineId: want.lineId, madeIn: origin?.madeIn ?? record.identity, madeAt: origin ? origin.madeAt : record.informational.generatedAt });
      used = true;
    }
    if (used) out.from.push(record.identity);
  }
  return out;
}

export interface PublicationNarrationPlan {
  /** A current set is on disk (or left in staging, to be adopted): nothing to do. */
  current: boolean;
  /** Line ids whose verified audio carries over. */
  carried: string[];
  /** The lines a run would pay for, with the text of each request. */
  synthesize: { lineId: string; texts: string[]; characters: number }[];
  requests: number;
  /** Characters of text sent to the provider (what it bills). */
  characters: number;
}

/** What a publication run would do, decided offline: no credential, no network, nothing written. */
export function planPublicationNarration(dir: string, expect: PublicationExpectation): PublicationNarrationPlan {
  for (const d of [dir, stagingDirOf(dir)]) {
    try {
      readPublicationSet(d, expect);
      return { current: true, carried: expect.lines.map((l) => l.lineId), synthesize: [], requests: 0, characters: 0 };
    } catch (err) {
      if (!(err instanceof PublicationNarrationError)) throw err;
    }
  }
  const { audio } = carryOverLines([dir, stagingDirOf(dir)], expect);
  const synthesize = expect.lines.filter((l) => !audio.has(l.lineId)).map((l) => ({ lineId: l.lineId, texts: [...l.texts], characters: l.texts.reduce((n, t) => n + t.length, 0) }));
  return {
    current: false,
    carried: expect.lines.filter((l) => audio.has(l.lineId)).map((l) => l.lineId),
    synthesize,
    requests: synthesize.reduce((n, l) => n + l.texts.length, 0),
    characters: synthesize.reduce((n, l) => n + l.characters, 0),
  };
}

/** The track a verified set gives: durations measured from the audio, each line's WAV named relative to the video's package directory. */
export function trackFromSet(set: VerifiedPublicationSet): NarrationTrack {
  return {
    providerId: set.ref.provider,
    voiceIdentityId: set.ref.voiceIdentityId,
    synthetic: true,
    estimated: false,
    lines: set.lines.map((l) => ({ lineId: l.lineId, durationMs: l.durationMs, audio: { path: `narration/${l.lineId}.wav`, sha256: l.sha256 } })),
    publication: set.ref,
  };
}

/** Publication narration for the render and publish paths: a verified set replayed from disk. No network, no credential, never synthesis. */
export class PublicationNarrationReplay implements VoiceProvider {
  readonly id: string;
  readonly synthetic = true;
  readonly dir: string;
  readonly publication: ResolvedPublication;
  readonly videoId: string | null;
  readonly scope: PublicationScope;

  constructor(dir: string, publication: ResolvedPublication, opts: { videoId?: string; scope?: PublicationScope } = {}) {
    this.dir = dir;
    this.publication = publication;
    this.id = publication.binding.provider;
    this.videoId = opts.videoId ?? null;
    this.scope = opts.scope ?? 'video';
  }

  async synthesize(request: VoiceRequest): Promise<NarrationTrack> {
    return trackFromSet(this.read(request));
  }

  /** The verified set behind a request (render inputs stage its audio; the gate binds its record). */
  read(request: VoiceRequest): VerifiedPublicationSet {
    assertLexiconPinned(request.lexicon);
    return readPublicationSet(this.dir, publicationExpectation(request, this.publication, this.videoId, this.scope));
  }
}

/** Where a video's publication narration set lives (generated, never committed). */
export const publicationNarrationDir = (videoId: string): string => path.join(DIST_ROOT, videoId, 'narration');

/** `--narration=fixture|publication`; the fixture voice is the default everywhere. */
export function parseNarrationMode(args: readonly string[]): NarrationMode {
  const given = args.filter((a) => a.startsWith('--narration='));
  if (given.length === 0) return 'fixture';
  const v = given[given.length - 1]!.slice('--narration='.length);
  if (given.length > 1 || !(NARRATION_MODES as readonly string[]).includes(v)) throw new Error(`--narration must be fixture or publication, once (got ${given.map((g) => JSON.stringify(g)).join(', ')})`);
  return v as NarrationMode;
}

/** The voice a render or publish step uses: the fixture estimate, or the video's verified publication set replayed. */
export function narrationVoice(mode: NarrationMode, videoId: string, dir: string = publicationNarrationDir(videoId)): VoiceProvider {
  return mode === 'publication' ? new PublicationNarrationReplay(dir, loadPublicationBinding(), { videoId, scope: 'video' }) : new FixtureVoiceProvider();
}
