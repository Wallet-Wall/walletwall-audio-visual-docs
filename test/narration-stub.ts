// ElevenLabs as a counting stub, and a publication narration set made through it: the real publication voice
// (src/narration/providers/publication.ts) and the real adapter, with fetch replaced. No network, no credential.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ElevenLabsProvider } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig } from '../src/narration/providers/index.ts';
import { ElevenLabsPublicationVoice } from '../src/narration/providers/publication.ts';
import { loadPublicationBinding, type ResolvedPublication } from '../src/narration/publication.ts';
import { synthesize } from '../src/pipeline/render-input.ts';
import { committedSpec, config } from './helpers.ts';

export const VOICE = 'DTLT09E2cxHF0DqjKVbc';
/** Shaped like a key, so the leak checks have something to find; never a real one. */
export const KEY = 'test-key-not-real-0123456789abcdef-publication';
export const RATE = 24000;

export function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'ww-pubnarr-'));
}

/** Raw little-endian PCM16 mono: `leadMs` of silence, `toneMs` of a square tone at amplitude 8000, `tailMs` of silence (or +-`noise`). */
export function pcm(leadMs: number, toneMs: number, tailMs: number, rate = RATE, noise = 0): Uint8Array {
  const n = (ms: number) => Math.round((ms * rate) / 1000);
  const total = n(leadMs) + n(toneMs) + n(tailMs);
  const out = new Uint8Array(total * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < total; i++) {
    const inTone = i >= n(leadMs) && i < n(leadMs) + n(toneMs);
    const v = inTone ? (i % 20 < 10 ? 8000 : -8000) : noise ? (i % 2 ? noise : -noise) : 0;
    view.setInt16(i * 2, v, true);
  }
  return out;
}

export interface Call {
  method: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** Speech at a natural pace: each word of the requested text as 400 ms of tone (150 wpm). */
export const naturalPace = (text: string): number => text.split(/\s+/).filter(Boolean).length * 400;

/**
 * ElevenLabs as a counting stub: the voice lookup answers `voice`; every text-to-speech POST answers PCM of 250 ms
 * lead silence, `toneMs(text)` of tone (1000 ms by default), and 400 ms tail silence.
 */
export function elevenlabs(opts: { voiceStatus?: number; voice?: Record<string, unknown>; ttsStatus?: number; ttsBody?: (key: string) => string; toneMs?: (text: string) => number } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    calls.push({ method: init.method ?? 'GET', host: url.host, path: url.pathname, headers, body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
    if ((init.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(opts.voice ?? { voice_id: VOICE, labels: { accent: 'australian', gender: 'male' } }), { status: opts.voiceStatus ?? 200, headers: { 'content-type': 'application/json' } });
    }
    if (opts.ttsStatus && opts.ttsStatus !== 200) return new Response(opts.ttsBody ? opts.ttsBody(headers['xi-api-key'] ?? '') : 'quota exceeded', { status: opts.ttsStatus });
    const text = String((JSON.parse(String(init.body)) as { text?: unknown }).text ?? '');
    return new Response(pcm(250, opts.toneMs ? opts.toneMs(text) : 1000, 400).buffer as ArrayBuffer, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, posts: () => calls.filter((c) => c.method === 'POST'), gets: () => calls.filter((c) => c.method === 'GET') };
}

export function publicationVoice(dir: string, stub: ReturnType<typeof elevenlabs>, env: Record<string, string | undefined> = { ELEVENLABS_API_KEY: KEY }, publication: ResolvedPublication = loadPublicationBinding(), scope: 'video' | 'proof' = 'video'): ElevenLabsPublicationVoice {
  return new ElevenLabsPublicationVoice({ videoId: 'migration-readiness', scope, dir, publication, adapter: new ElevenLabsProvider(loadProvidersConfig().providers.elevenlabs), env, fetch: stub.fetch });
}

/** The committed spec's publication narration, synthesized once through the stub into `<fresh dir>/narration`. */
export async function stubPublicationSet(opts: { toneMs?: (text: string) => number } = {}): Promise<{ dir: string; stub: ReturnType<typeof elevenlabs> }> {
  const dir = path.join(scratch(), 'narration');
  const stub = elevenlabs({ toneMs: opts.toneMs });
  await synthesize(committedSpec(), publicationVoice(dir, stub), config);
  return { dir, stub };
}
