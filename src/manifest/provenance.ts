// The video provenance manifest: one document that ties a rendered artifact
// back to the exact doc bytes, claims, planner, voice, renderer, and validation
// outcome it came from. Written to dist/ (never committed) next to the render.

import { contentAddress, sha256Hex } from '../core/hash.ts';
import type { ValidationReport } from '../core/issues.ts';
import type { CueSheet } from '../audio/cue-sheet.ts';
import type { BuildIdentity } from './build-identity.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { NarrationTrack, Timeline } from '../timeline/timeline.ts';

export interface ProvenanceManifest {
  schema: 'walletwall.video-provenance/v2';
  videoId: string;
  revision: number;
  specHash: string;
  source: VideoSpec['source'];
  planner: VideoSpec['planner'];
  claims: { id: string; type: string; evidence: { sectionId?: string; path?: string; quoteSha256?: string; sha256?: string }[] }[];
  narration: { providerId: string; voiceIdentityId: string; synthetic: boolean; estimated: boolean; lines: number; audio: 'PRESENT' | 'NONE' };
  timeline: { totalMs: number; segments: { id: string; role: string; startMs: number; endMs: number }[] };
  audio: { identAsset: string | null; musicBed: string | null; cues: number; silentCues: number; suppressedCues: number };
  validation: { ok: boolean; errors: number; warnings: number; codes: string[] };
  render: { engine: string; version: string; output: string; sha256: string } | null;
  /** Toolchain, hashed configuration, and WalletWallaby's declared rig and motion versions. */
  identity: BuildIdentity;
}

export function buildProvenanceManifest(args: {
  spec: VideoSpec;
  track: NarrationTrack;
  timeline: Timeline;
  cueSheet: CueSheet;
  validation: ValidationReport;
  render: ProvenanceManifest['render'];
  identity: BuildIdentity;
}): ProvenanceManifest {
  const { spec, track, timeline, cueSheet, validation } = args;
  return {
    schema: 'walletwall.video-provenance/v2',
    videoId: spec.id,
    revision: spec.revision,
    specHash: contentAddress(spec),
    source: spec.source,
    planner: spec.planner,
    claims: spec.claims.map((c) => ({
      id: c.id,
      type: c.type,
      evidence: c.evidence.map((e) => (e.kind === 'DOC_SPAN' ? { sectionId: e.sectionId, quoteSha256: sha256Hex(e.quote) } : { path: e.path, sha256: e.sha256 })),
    })),
    narration: {
      providerId: track.providerId,
      voiceIdentityId: track.voiceIdentityId,
      synthetic: track.synthetic,
      estimated: track.estimated,
      lines: track.lines.length,
      audio: track.lines.some((l) => l.audio) ? 'PRESENT' : 'NONE',
    },
    timeline: { totalMs: timeline.totalMs, segments: timeline.segments.map((s) => ({ id: s.id, role: s.role, startMs: s.startMs, endMs: s.endMs })) },
    audio: {
      identAsset: cueSheet.identAsset,
      musicBed: cueSheet.musicBed.id,
      cues: cueSheet.cues.length,
      silentCues: cueSheet.cues.filter((c) => c.asset === null).length,
      suppressedCues: cueSheet.suppressed.length,
    },
    validation: { ok: validation.ok, errors: validation.errors, warnings: validation.warnings, codes: [...new Set(validation.issues.map((i) => i.code))] },
    render: args.render,
    identity: args.identity,
  };
}
