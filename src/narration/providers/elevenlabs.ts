// ElevenLabs: the external, publication-quality REFERENCE adapter.
//
// It exists so the bakeoff can hear the bar. It is never part of the render or
// publish path (test/guards.test.ts proves it is unreachable from them), and it
// never clones, scrapes, or conditions anything on the reference voice. The
// endpoint host is a constant in this file so no configuration can send the
// key anywhere else; the key is read from the environment at call time and is
// never placed in a result, a record, a log line, or an error message.
// Node-only (fetch).

import { NarrationProviderError, validateSettings, type NarrationProvider, type NarrationRequest, type NarrationSettings, type SettingsSchema, type SynthesisContext, type SynthesisResult } from '../contract.ts';
import { wrapPcm16 } from '../wav.ts';

export const ELEVENLABS_HOST = 'api.elevenlabs.io';
export const ELEVENLABS_MODELS = ['eleven_multilingual_v2', 'eleven_v3', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'] as const;
/** Raw PCM only: the adapter wraps it in a WAV header itself, so no decoder and no lossy codec sit between the model and the hash. */
export const ELEVENLABS_OUTPUT_FORMATS = ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100'] as const;
export const ELEVENLABS_VOICE_ID = /^[A-Za-z0-9]{8,64}$/;

export const ELEVENLABS_SCHEMA: SettingsSchema = {
  modelId: { kind: 'enum', values: ELEVENLABS_MODELS },
  outputFormat: { kind: 'enum', values: ELEVENLABS_OUTPUT_FORMATS },
  stability: { kind: 'number', min: 0, max: 1 },
  similarityBoost: { kind: 'number', min: 0, max: 1 },
  style: { kind: 'number', min: 0, max: 1 },
  useSpeakerBoost: { kind: 'boolean' },
  speed: { kind: 'number', min: 0.7, max: 1.2 },
  seed: { kind: 'number', min: 0, max: 4294967295, integer: true, nullable: true },
  applyTextNormalization: { kind: 'enum', values: ['auto', 'on', 'off'] },
};

export interface ElevenLabsBinding {
  kind: 'remote';
  role: string;
  apiKeyEnv: string;
  voiceIdEnv: string;
  voiceId: string;
  variants: Record<string, unknown>;
}

export function elevenlabsUrl(voiceId: string, outputFormat: string): URL {
  if (!ELEVENLABS_VOICE_ID.test(voiceId)) throw new NarrationProviderError('voice id is not a plain ElevenLabs voice id');
  if (!(ELEVENLABS_OUTPUT_FORMATS as readonly string[]).includes(outputFormat)) throw new NarrationProviderError('unsupported output format');
  const url = new URL(`https://${ELEVENLABS_HOST}/v1/text-to-speech/${voiceId}`);
  url.searchParams.set('output_format', outputFormat);
  return url;
}

export function elevenlabsBody(request: NarrationRequest, s: NarrationSettings): Record<string, unknown> {
  return {
    text: request.spokenText,
    model_id: s.modelId,
    voice_settings: { stability: s.stability, similarity_boost: s.similarityBoost, style: s.style, use_speaker_boost: s.useSpeakerBoost, speed: s.speed },
    ...(s.seed === null ? {} : { seed: s.seed }),
    apply_text_normalization: s.applyTextNormalization,
  };
}

const redact = (text: string, secret: string): string => text.split(secret).join('<redacted>');

export class ElevenLabsProvider implements NarrationProvider {
  readonly id = 'elevenlabs' as const;
  readonly schema = ELEVENLABS_SCHEMA;
  readonly binding: ElevenLabsBinding;

  constructor(binding: ElevenLabsBinding) {
    this.binding = binding;
  }

  validateSettings(settings: unknown): NarrationSettings {
    return validateSettings(this.id, this.schema, settings);
  }

  /** The voice id: the environment override when set, else the configured default. Never a secret. */
  voiceId(env: SynthesisContext['env']): string {
    const id = env[this.binding.voiceIdEnv]?.trim() || this.binding.voiceId;
    if (!ELEVENLABS_VOICE_ID.test(id)) throw new NarrationProviderError(`${this.binding.voiceIdEnv} is not a plain ElevenLabs voice id`);
    return id;
  }

  async synthesize(request: NarrationRequest, settings: NarrationSettings, ctx: SynthesisContext): Promise<SynthesisResult> {
    const s = this.validateSettings(settings);
    const key = ctx.env[this.binding.apiKeyEnv];
    if (!key) throw new NarrationProviderError(`${this.binding.apiKeyEnv} is not set: generate the reference audio elsewhere and register it with "narration place"`);
    const voiceId = this.voiceId(ctx.env);
    const url = elevenlabsUrl(voiceId, String(s.outputFormat));
    const doFetch = ctx.fetch ?? globalThis.fetch;
    const t0 = performance.now();
    const res = await doFetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'application/octet-stream' }, body: JSON.stringify(elevenlabsBody(request, s)) });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const wallMs = performance.now() - t0;
    if (!res.ok) {
      const snippet = redact(new TextDecoder().decode(bytes.slice(0, 300)), key);
      throw new NarrationProviderError(`ElevenLabs refused the request: HTTP ${res.status} ${snippet}`);
    }
    const rate = Number(/^pcm_(\d+)$/.exec(String(s.outputFormat))![1]);
    const wav = wrapPcm16(bytes, rate, 1);
    return {
      wav,
      modelId: String(s.modelId),
      // A hosted model has no content identity this repository can verify: the audio hash is the only stable identity.
      modelVersion: 'hosted',
      modelContent: {},
      voiceId,
      settings: s,
      seed: typeof s.seed === 'number' ? s.seed : null,
      runtime: { name: 'elevenlabs-api', version: 'v1', device: 'remote' },
      performance: { wallMs, coldStart: false, vramPeakMiB: null },
    };
  }
}
