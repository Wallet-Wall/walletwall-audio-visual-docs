// Voice-provider boundary. A VideoSpec never names a provider; the pipeline
// hands a provider the display text, the spoken (aliased) text, and the
// provider-neutral voice identity, and receives a NarrationTrack back.
//
// Credentials are an adapter concern: a live adapter reads its key from the
// environment at call time and must never place it in the track, a manifest,
// a log line, or a rendered frame.

import type { PronunciationLexicon, VoiceIdentity, VoicePacing } from '../config/types.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { NarrationTrack } from '../timeline/timeline.ts';
import { toSpokenText } from './pronunciation.ts';

export interface VoiceLineRequest {
  lineId: string;
  displayText: string;
  spokenText: string;
}

export interface VoiceRequest {
  identity: VoiceIdentity;
  lexicon: PronunciationLexicon;
  lines: VoiceLineRequest[];
}

export interface VoiceProvider {
  readonly id: string;
  /** True when the provider produces synthetic speech (drives the platform disclosure). */
  readonly synthetic: boolean;
  synthesize(request: VoiceRequest): Promise<NarrationTrack>;
}

export function voiceRequestFor(spec: VideoSpec, identity: VoiceIdentity, lexicon: PronunciationLexicon): VoiceRequest {
  return {
    identity,
    lexicon,
    lines: spec.segments.flatMap((s) =>
      s.narration.map((l) => ({ lineId: l.id, displayText: l.text, spokenText: toSpokenText(l.text, lexicon) })),
    ),
  };
}

/** Spoken words in a line (aliases expanded, so "USDC" counts as four letters spoken). */
export function spokenWordCount(spokenText: string): number {
  return spokenText.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Spoken words across every line of a request: what the narration budget counts. */
export function requestSpokenWords(request: VoiceRequest): number {
  return request.lines.reduce((n, line) => n + spokenWordCount(line.spokenText), 0);
}

/**
 * Deterministic duration estimate at the identity's natural pace, including
 * punctuation pauses. Used for planning and for fixture tracks; a real voice
 * render replaces it with measured durations.
 */
export function estimateSpokenMs(spokenText: string, pacing: VoicePacing): number {
  const words = spokenWordCount(spokenText);
  const sentences = (spokenText.match(/[.!?](\s|$)/g) ?? []).length;
  const internalSentences = Math.max(0, sentences - 1);
  const commas = (spokenText.match(/[,;:—]/g) ?? []).length;
  const speech = (words / pacing.targetWpm) * 60_000;
  return Math.round(speech + internalSentences * pacing.sentencePauseMs + commas * pacing.commaPauseMs);
}

/**
 * Fixture provider: no audio, no network, no credentials. Produces a silent,
 * explicitly-estimated track so the full pipeline (timing, captions, render,
 * QA, manifests) runs anywhere, including CI and untrusted fork PRs.
 */
export class FixtureVoiceProvider implements VoiceProvider {
  readonly id = FIXTURE_VOICE_PROVIDER_ID;
  readonly synthetic = true;

  async synthesize(request: VoiceRequest): Promise<NarrationTrack> {
    return estimateTrackFor(request);
  }
}

export const FIXTURE_VOICE_PROVIDER_ID = 'fixture-estimate';

export function estimateTrackFor(request: VoiceRequest): NarrationTrack {
  return {
    providerId: FIXTURE_VOICE_PROVIDER_ID,
    voiceIdentityId: request.identity.id,
    synthetic: true,
    estimated: true,
    lines: request.lines.map((l) => ({ lineId: l.lineId, durationMs: estimateSpokenMs(l.spokenText, request.identity.pacing), audio: null })),
  };
}

/** Synchronous estimate for planning, validation, and Studio previews. */
export function estimateTrack(spec: VideoSpec, identity: VoiceIdentity, lexicon: PronunciationLexicon): NarrationTrack {
  return estimateTrackFor(voiceRequestFor(spec, identity, lexicon));
}

/** Effective words-per-minute of a track; used to refuse unnaturally sped-up narration. */
export function effectiveWpm(request: VoiceRequest, track: NarrationTrack): number {
  const durations = new Map(track.lines.map((l) => [l.lineId, l.durationMs]));
  let words = 0;
  let ms = 0;
  for (const line of request.lines) {
    words += spokenWordCount(line.spokenText);
    ms += durations.get(line.lineId) ?? 0;
  }
  return ms === 0 ? 0 : (words / ms) * 60_000;
}
