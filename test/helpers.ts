// Hermetic test fixtures: the committed spec, its committed source snapshot,
// and the version-controlled config. No git or network reads; the canonical doc
// comes through the verified gateway (the blob-bound fixture mirror unless
// WALLETWALL_SOURCE_ROOT names a WalletWall checkout).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { loadPipelineConfig, VIDEO_ROOT } from '../src/config/load.ts';
import type { PipelineConfig } from '../src/config/types.ts';
import type { ValidationReport } from '../src/core/issues.ts';
import type { PoseParams } from '../src/character/walletwallaby/rig.ts';
import { repoFileResolver } from '../src/pipeline/context.ts';
import { canonicalText } from '../src/source/canonical.ts';
import type { NormalizedSource } from '../src/source/types.ts';
import type { VideoSpec } from '../src/spec/types.ts';
import type { NarrationTrack } from '../src/timeline/timeline.ts';
import { validateSpec, type ValidationContext } from '../src/validation/validate-spec.ts';

export const VIDEO_ID = 'migration-readiness';
export const config: PipelineConfig = loadPipelineConfig();

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(path.join(VIDEO_ROOT, rel), 'utf8')) as T;

export const committedSpec = (): VideoSpec => readJson<VideoSpec>(`specs/${VIDEO_ID}/spec.json`);
export const committedSnapshot = (): NormalizedSource => readJson<NormalizedSource>(`specs/${VIDEO_ID}/source.snapshot.json`);
export const docText = (): string => canonicalText('docs/concepts/migration-readiness.mdx');

export { repoFileResolver as repoResolver } from '../src/pipeline/context.ts';

export function context(spec: VideoSpec, overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    source: committedSnapshot(),
    config,
    track: estimateTrack(spec, config.voice, config.lexicon),
    page: { published: true, url: spec.source.docUrl, groups: ['Vault & Proof Readiness', 'Stablecoin Vault Readiness'] },
    resolveFile: repoFileResolver,
    ...overrides,
  };
}

export function validate(spec: VideoSpec, overrides: Partial<ValidationContext> = {}): ValidationReport {
  return validateSpec(spec, context(spec, overrides));
}

export function codes(report: ValidationReport, severity: 'error' | 'warning' = 'error'): string[] {
  return report.issues.filter((i) => i.severity === severity).map((i) => i.code);
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function segment(spec: VideoSpec, id: string) {
  const s = spec.segments.find((x) => x.id === id);
  if (!s) throw new Error(`no segment ${id}`);
  return s;
}

export function scaledTrack(track: NarrationTrack, factor: number): NarrationTrack {
  return { ...track, lines: track.lines.map((l) => ({ ...l, durationMs: Math.round(l.durationMs * factor) })) };
}

/** Every number a pose carries: its continuous parameters and its clip weights. */
export const poseNumbers = (p: PoseParams): number[] => [p.crouch, p.headTilt, p.reach, p.lift, ...Object.values(p.mix).map((w) => w ?? Number.NaN)];
