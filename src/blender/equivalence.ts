// Bounded pixel equivalence of two lossless images of the same frame (RGBA, 8-bit): the measure behind guarantee B
// (different approved render-environment classes) and the crop-equivalence tolerance (docs/BLENDER.md, Determinism).
// `npm run blender:proof -- compare` and production host qualification both use it, so the tolerances pinned in
// config/blender-environments.json are applied one way, exactly as written. Pure.

import type { PixelTolerance } from './identity.ts';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface EquivalenceMeasures {
  /** Fraction of all channels that differ by more than the noise level. */
  fractionOverNoise: number;
  /** Mean absolute channel difference over all channels. */
  meanAbsDelta: number;
  /** Pixels drawn in one image and not the other (alpha > 0 in exactly one). */
  coverageDeltaPx: number;
  maxDelta: number;
}

/** The measures for two images of one frame; null when their sizes differ (never equivalent). */
export function measureEquivalence(a: RgbaImage, b: RgbaImage, noiseLevel: number): EquivalenceMeasures | null {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) return null;
  let over = 0;
  let sum = 0;
  let max = 0;
  let coverage = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i]! - b.data[i]!);
    if (d > noiseLevel) over++;
    if (d > max) max = d;
    sum += d;
  }
  for (let i = 3; i < a.data.length; i += 4) if ((a.data[i]! > 0) !== (b.data[i]! > 0)) coverage++;
  return { fractionOverNoise: over / a.data.length, meanAbsDelta: sum / a.data.length, coverageDeltaPx: coverage, maxDelta: max };
}

/** Whether the measures are within a pinned tolerance, as written (every bound inclusive). */
export const withinTolerance = (m: EquivalenceMeasures, t: PixelTolerance): boolean => m.fractionOverNoise <= t.maxFractionOverNoise && m.meanAbsDelta <= t.maxMeanAbsDelta && m.coverageDeltaPx <= t.maxCoverageDeltaPx;
