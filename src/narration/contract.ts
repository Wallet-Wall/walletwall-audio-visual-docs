// The provider-neutral narration contract (docs/NARRATION.md).
//
// WalletWall owns what is said: the corpus text, the pronunciation lexicon,
// and the voice identity's direction. A provider adapter owns how it is
// synthesized and returns raw audio plus the exact identity of what made it.
// Nothing in a request carries a provider setting, a path, a prompt, or code;
// settings come only from config/narration-providers.json and pass each
// adapter's closed schema before they reach a URL or an argument list, so a
// setting can never be a free-form string. Isomorphic (no Node imports).

import type { VoiceIdentity } from '../config/types.ts';

export const NARRATION_PROVIDERS = ['elevenlabs', 'magpie-nemo-speech', 'chatterbox-multilingual'] as const;
export type NarrationProviderId = (typeof NARRATION_PROVIDERS)[number];
export const isNarrationProviderId = (v: unknown): v is NarrationProviderId => typeof v === 'string' && (NARRATION_PROVIDERS as readonly string[]).includes(v);

export const NARRATION_LANGUAGES = ['en-US'] as const;
export type NarrationLanguage = (typeof NARRATION_LANGUAGES)[number];
export const VOICE_PROFILE = 'walletwallaby' as const;

/** Passage, variant, and job ids: plain lowercase slugs, never a path. */
export const PLAIN_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export interface NarrationRequest {
  passageId: string;
  /** What captions and reviewers read. */
  displayText: string;
  /** What the synthesizer receives: the display text with lexicon aliases applied. */
  spokenText: string;
  language: NarrationLanguage;
  voiceProfile: typeof VOICE_PROFILE;
  /** The repository's voice identity (direction and pacing); an adapter may read it, never a VideoSpec. */
  identity: VoiceIdentity;
}

export type SettingValue = string | number | boolean | null;
export type NarrationSettings = Readonly<Record<string, SettingValue>>;

export type SettingRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'number'; min: number; max: number; integer?: boolean; nullable?: boolean }
  | { kind: 'boolean' }
  | { kind: 'null' };
export type SettingsSchema = Readonly<Record<string, SettingRule>>;

export class NarrationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrationContractError';
  }
}

/**
 * Validate settings against a closed schema: every schema key must be present,
 * no other key may exist, strings are only ever enum members, numbers stay in
 * range. Returns a frozen copy holding exactly the schema's keys.
 */
export function validateSettings(provider: string, schema: SettingsSchema, settings: unknown): NarrationSettings {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) throw new NarrationContractError(`${provider}: settings must be an object`);
  const given = settings as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!Object.hasOwn(schema, key)) throw new NarrationContractError(`${provider}: unknown setting ${JSON.stringify(key)}`);
  const out: Record<string, SettingValue> = {};
  for (const [key, rule] of Object.entries(schema)) {
    if (!Object.hasOwn(given, key)) throw new NarrationContractError(`${provider}: missing setting ${JSON.stringify(key)}`);
    const v = given[key];
    const bad = (why: string) => new NarrationContractError(`${provider}: setting ${JSON.stringify(key)} ${why}`);
    switch (rule.kind) {
      case 'enum':
        if (typeof v !== 'string' || !rule.values.includes(v)) throw bad(`must be one of ${rule.values.join(', ')}`);
        out[key] = v;
        break;
      case 'number':
        if (v === null) {
          if (!rule.nullable) throw bad('must be a number');
          out[key] = null;
          break;
        }
        if (typeof v !== 'number' || !Number.isFinite(v) || v < rule.min || v > rule.max) throw bad(`must be a number in [${rule.min}, ${rule.max}]`);
        if (rule.integer && !Number.isInteger(v)) throw bad('must be an integer');
        out[key] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') throw bad('must be true or false');
        out[key] = v;
        break;
      case 'null':
        if (v !== null) throw bad('must be null');
        out[key] = null;
        break;
    }
  }
  return Object.freeze(out);
}

export interface NarrationPerformance {
  wallMs: number;
  /** True when the measured wall time includes loading the model (a fresh process). */
  coldStart: boolean;
  vramPeakMiB: number | null;
}

/** What an adapter returns: raw audio and the identity of what made it. Never a path outside the work directory. */
export interface SynthesisResult {
  wav: Uint8Array;
  modelId: string;
  modelVersion: string;
  /** Local model content: file name -> sha256. Empty for a hosted model, whose content is not addressable. */
  modelContent: Record<string, string>;
  voiceId: string | null;
  /** The exact effective settings (already validated). */
  settings: NarrationSettings;
  seed: number | null;
  runtime: { name: string; version: string; device: string };
  performance: NarrationPerformance | null;
}

export interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
  wallMs: number;
  vramPeakMiB: number | null;
}

/** Runs one executable with an argument list (never a shell). Injectable so adapters are testable without the tool. */
export type ChildRunner = (exe: string, args: readonly string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number; sampleVram: boolean }) => Promise<ChildResult>;

export interface SynthesisContext {
  /** Absolute directory this synthesis may write into (job files, raw output). */
  workDir: string;
  /** Environment reader: process.env in production, a stub in tests. */
  env: Readonly<Record<string, string | undefined>>;
  fetch?: typeof fetch;
  run?: ChildRunner;
}

export interface NarrationProvider {
  readonly id: NarrationProviderId;
  readonly schema: SettingsSchema;
  validateSettings(settings: unknown): NarrationSettings;
  synthesize(request: NarrationRequest, settings: NarrationSettings, ctx: SynthesisContext): Promise<SynthesisResult>;
}

export class NarrationProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrationProviderError';
  }
}

export function assertPlainId(kind: string, id: unknown): string {
  if (typeof id !== 'string' || !PLAIN_ID.test(id)) throw new NarrationContractError(`${kind} ${JSON.stringify(id)} is not a plain id`);
  return id;
}
