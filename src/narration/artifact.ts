// A narration artifact: the provenance record bound to one synthesized WAV.
//
// It binds the provider, the model and its content identity, the voice, the
// exact settings and seed, the language, the display and spoken text hashes,
// and the audio bytes (sha256, format, duration). Its identity is the content
// address of all of that and nothing else: the generation timestamp and the
// performance numbers ride along outside the identity, so the same text,
// settings, and bytes always name the same artifact. The shape is closed: an
// unknown field, a path that is not inside dist/narration-bakeoff/, a
// backslash or drive letter anywhere, or a credential-shaped environment value
// in the serialized record fails validation. Node-only.

import { contentAddress, sha256Hex } from '../core/hash.ts';
import { isSafeRepoPath } from '../validation/paths.ts';
import { isNarrationProviderId, NarrationContractError, PLAIN_ID, type NarrationPerformance, type NarrationProviderId, type NarrationRequest, type NarrationSettings, type SynthesisResult } from './contract.ts';
import { textHashes } from './corpus.ts';
import { spokenWordCount } from '../audio/voice-provider.ts';
import { parseWav } from './wav.ts';

export const NARRATION_ARTIFACT_SCHEMA = 'walletwall.narration-artifact/v1';
/** Every artifact's audio lives under this repository-relative prefix (generated, never committed). */
export const BAKEOFF_DIST_PREFIX = 'dist/narration-bakeoff/';

export interface NarrationArtifact {
  schema: typeof NARRATION_ARTIFACT_SCHEMA;
  identity: string;
  provider: NarrationProviderId;
  /** `adapter`: this repository synthesized it; `external`: placed by a human (for example reference audio generated elsewhere). */
  synthesis: 'adapter' | 'external';
  variant: string;
  modelId: string;
  modelVersion: string;
  modelContent: Record<string, string>;
  voiceId: string | null;
  voiceProfile: string;
  voiceIdentityId: string;
  language: string;
  settings: NarrationSettings;
  seed: number | null;
  runtime: { name: string; version: string; device: string };
  text: { corpusId: string; corpusVersion: number; passageId: string; displaySha256: string; spokenSha256: string; spokenChars: number; spokenWords: number };
  audio: { path: string; sha256: string; sampleRate: number; channels: number; bitsPerSample: number; frames: number; durationMs: number };
  generatedAt: string | null;
  performance: NarrationPerformance | null;
}

const TOP_KEYS = ['schema', 'identity', 'provider', 'synthesis', 'variant', 'modelId', 'modelVersion', 'modelContent', 'voiceId', 'voiceProfile', 'voiceIdentityId', 'language', 'settings', 'seed', 'runtime', 'text', 'audio', 'generatedAt', 'performance'] as const;
const RUNTIME_KEYS = ['name', 'version', 'device'] as const;
const TEXT_KEYS = ['corpusId', 'corpusVersion', 'passageId', 'displaySha256', 'spokenSha256', 'spokenChars', 'spokenWords'] as const;
const AUDIO_KEYS = ['path', 'sha256', 'sampleRate', 'channels', 'bitsPerSample', 'frames', 'durationMs'] as const;
const PERF_KEYS = ['wallMs', 'coldStart', 'vramPeakMiB'] as const;
const HEX64 = /^[0-9a-f]{64}$/;

/** The fields the identity covers: everything but the identity itself, the timestamp, and the measurements. */
export function identityFields(a: Omit<NarrationArtifact, 'identity'> | NarrationArtifact): Record<string, unknown> {
  const { identity: _identity, generatedAt: _at, performance: _perf, ...rest } = a as NarrationArtifact;
  return rest;
}

export const artifactIdentity = (a: Omit<NarrationArtifact, 'identity'>): string => contentAddress(identityFields(a));

export function buildNarrationArtifact(args: {
  request: NarrationRequest;
  corpus: { id: string; version: number };
  provider: NarrationProviderId;
  variant: string;
  synthesis: NarrationArtifact['synthesis'];
  result: SynthesisResult;
  /** Repository-relative POSIX path of the WAV, under dist/narration-bakeoff/. */
  audioPath: string;
  generatedAt: string | null;
}): NarrationArtifact {
  const { request, result } = args;
  if (!PLAIN_ID.test(args.variant)) throw new NarrationContractError(`variant ${JSON.stringify(args.variant)} is not a plain id`);
  if (!args.audioPath.startsWith(BAKEOFF_DIST_PREFIX) || !isSafeRepoPath(args.audioPath)) throw new NarrationContractError(`audio path must be a safe path under ${BAKEOFF_DIST_PREFIX}`);
  const info = parseWav(result.wav);
  const hashes = textHashes(request.displayText, request.spokenText);
  const body: Omit<NarrationArtifact, 'identity'> = {
    schema: NARRATION_ARTIFACT_SCHEMA,
    provider: args.provider,
    synthesis: args.synthesis,
    variant: args.variant,
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    modelContent: { ...result.modelContent },
    voiceId: result.voiceId,
    voiceProfile: request.voiceProfile,
    voiceIdentityId: request.identity.id,
    language: request.language,
    settings: { ...result.settings },
    seed: result.seed,
    runtime: { ...result.runtime },
    text: { corpusId: args.corpus.id, corpusVersion: args.corpus.version, passageId: request.passageId, ...hashes, spokenChars: request.spokenText.length, spokenWords: spokenWordCount(request.spokenText) },
    audio: { path: args.audioPath, sha256: sha256Hex(result.wav), sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, frames: info.frames, durationMs: info.durationMs },
    generatedAt: args.generatedAt,
    performance: result.performance ? { ...result.performance } : null,
  };
  const artifact: NarrationArtifact = { ...body, identity: artifactIdentity(body) };
  const errors = validateNarrationArtifact(artifact, {});
  if (errors.length) throw new NarrationContractError(`artifact rejected: ${errors.join('; ')}`);
  return artifact;
}

/**
 * Why an artifact is stale for the current voice identity and corpus, or null when it is current. An artifact
 * made under an earlier identity is a different narration: it must be re-synthesized, never re-labelled.
 */
export function staleFor(artifact: NarrationArtifact, current: { voiceIdentityId: string; corpusId: string; corpusVersion: number }): string | null {
  if (artifact.voiceIdentityId !== current.voiceIdentityId) return `made for voice identity ${artifact.voiceIdentityId}; the identity is now ${current.voiceIdentityId}`;
  if (artifact.text.corpusId !== current.corpusId || artifact.text.corpusVersion !== current.corpusVersion) return `made for corpus ${artifact.text.corpusId} v${artifact.text.corpusVersion}; the corpus is now ${current.corpusId} v${current.corpusVersion}`;
  return null;
}

function closedKeys(value: unknown, keys: readonly string[], where: string, errors: string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${where}: not an object`);
    return false;
  }
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!keys.includes(k)) errors.push(`${where}: unknown field ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(obj, k)) errors.push(`${where}: missing field ${JSON.stringify(k)}`);
  return true;
}

/** Any string that looks like a local filesystem location: provenance names repository paths only. */
export const LOCAL_PATH_SHAPE = /\\|^[A-Za-z]:[\\/]|(^|[\s"'(])\/(?:Users|home|mnt|tmp|var|opt)\//;

/** Every string in a value, keys included (a model file name is a key). */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* strings(v);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      yield k;
      yield* strings(v);
    }
  }
}

/**
 * Validate an artifact record. `env` is scanned for credential-shaped values
 * (names containing KEY, TOKEN, SECRET, PASSWORD, or CREDENTIAL) that must not
 * appear anywhere in the serialized record. Returns the list of problems.
 */
export function validateNarrationArtifact(value: unknown, env: Readonly<Record<string, string | undefined>>): string[] {
  const errors: string[] = [];
  if (!closedKeys(value, TOP_KEYS, 'artifact', errors)) return errors;
  const a = value;
  if (a.schema !== NARRATION_ARTIFACT_SCHEMA) errors.push(`schema must be ${NARRATION_ARTIFACT_SCHEMA}`);
  if (!isNarrationProviderId(a.provider)) errors.push('unknown provider');
  if (a.synthesis !== 'adapter' && a.synthesis !== 'external') errors.push('synthesis must be adapter or external');
  if (typeof a.variant !== 'string' || !PLAIN_ID.test(a.variant)) errors.push('variant must be a plain id');
  for (const k of ['modelId', 'modelVersion', 'voiceProfile', 'voiceIdentityId', 'language'] as const) if (typeof a[k] !== 'string' || !(a[k] as string).length) errors.push(`${k} must be a non-empty string`);
  if (a.voiceId !== null && (typeof a.voiceId !== 'string' || !a.voiceId.length)) errors.push('voiceId must be a string or null');
  if (a.modelContent === null || typeof a.modelContent !== 'object' || Array.isArray(a.modelContent)) errors.push('modelContent must be an object');
  else for (const [k, v] of Object.entries(a.modelContent as Record<string, unknown>)) if (typeof v !== 'string' || !HEX64.test(v)) errors.push(`modelContent.${k} must be a sha256`);
  if (a.settings === null || typeof a.settings !== 'object' || Array.isArray(a.settings)) errors.push('settings must be an object');
  else for (const [k, v] of Object.entries(a.settings as Record<string, unknown>)) if (v !== null && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') errors.push(`settings.${k} must be a primitive`);
  if (a.seed !== null && (typeof a.seed !== 'number' || !Number.isInteger(a.seed) || a.seed < 0)) errors.push('seed must be a non-negative integer or null');
  if (closedKeys(a.runtime, RUNTIME_KEYS, 'runtime', errors)) for (const k of RUNTIME_KEYS) if (typeof a.runtime[k] !== 'string' || !(a.runtime[k] as string).length) errors.push(`runtime.${k} must be a non-empty string`);
  if (closedKeys(a.text, TEXT_KEYS, 'text', errors)) {
    const t = a.text;
    if (typeof t.corpusId !== 'string' || !PLAIN_ID.test(t.corpusId)) errors.push('text.corpusId must be a plain id');
    if (typeof t.corpusVersion !== 'number' || !Number.isInteger(t.corpusVersion) || t.corpusVersion < 1) errors.push('text.corpusVersion must be a positive integer');
    if (typeof t.passageId !== 'string' || !PLAIN_ID.test(t.passageId)) errors.push('text.passageId must be a plain id');
    for (const k of ['displaySha256', 'spokenSha256'] as const) if (typeof t[k] !== 'string' || !HEX64.test(t[k] as string)) errors.push(`text.${k} must be a sha256`);
    for (const k of ['spokenChars', 'spokenWords'] as const) if (typeof t[k] !== 'number' || !Number.isInteger(t[k]) || (t[k] as number) <= 0) errors.push(`text.${k} must be a positive integer`);
  }
  if (closedKeys(a.audio, AUDIO_KEYS, 'audio', errors)) {
    const au = a.audio;
    if (typeof au.path !== 'string' || !au.path.startsWith(BAKEOFF_DIST_PREFIX) || !isSafeRepoPath(au.path) || !au.path.endsWith('.wav')) errors.push(`audio.path must be a safe .wav path under ${BAKEOFF_DIST_PREFIX}`);
    if (typeof au.sha256 !== 'string' || !HEX64.test(au.sha256)) errors.push('audio.sha256 must be a sha256');
    if (typeof au.sampleRate !== 'number' || !Number.isInteger(au.sampleRate) || au.sampleRate < 8000 || au.sampleRate > 192_000) errors.push('audio.sampleRate out of range');
    if (au.channels !== 1 && au.channels !== 2) errors.push('audio.channels must be 1 or 2');
    if (au.bitsPerSample !== 16) errors.push('audio.bitsPerSample must be 16');
    if (typeof au.frames !== 'number' || !Number.isInteger(au.frames) || au.frames <= 0) errors.push('audio.frames must be a positive integer');
    if (typeof au.sampleRate === 'number' && typeof au.frames === 'number' && au.durationMs !== Math.round((au.frames * 1000) / au.sampleRate)) errors.push('audio.durationMs disagrees with frames and sampleRate');
  }
  if (a.generatedAt !== null && (typeof a.generatedAt !== 'string' || Number.isNaN(Date.parse(a.generatedAt)))) errors.push('generatedAt must be an ISO timestamp or null');
  if (a.performance !== null && closedKeys(a.performance, PERF_KEYS, 'performance', errors)) {
    const p = a.performance;
    if (typeof p.wallMs !== 'number' || p.wallMs < 0) errors.push('performance.wallMs must be a non-negative number');
    if (typeof p.coldStart !== 'boolean') errors.push('performance.coldStart must be boolean');
    if (p.vramPeakMiB !== null && (typeof p.vramPeakMiB !== 'number' || p.vramPeakMiB < 0)) errors.push('performance.vramPeakMiB must be a number or null');
  }
  for (const s of strings(identityFields(a as unknown as NarrationArtifact))) if (LOCAL_PATH_SHAPE.test(s)) errors.push(`a local path leaks into provenance: ${JSON.stringify(s.slice(0, 40))}`);
  if (errors.length === 0 && artifactIdentity(a as unknown as NarrationArtifact) !== a.identity) errors.push('identity does not match the record');
  const serialized = JSON.stringify(a);
  for (const [name, v] of Object.entries(env)) {
    if (!v || v.length < 12 || !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    if (serialized.includes(v)) errors.push(`the value of ${name} appears in the record`);
  }
  return errors;
}
