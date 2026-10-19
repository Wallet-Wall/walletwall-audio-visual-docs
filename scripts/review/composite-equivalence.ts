// Composite equivalence: the final 1920x1080 frames Remotion makes from a crop sequence, against the ones it makes
// from the full-frame Blender reference of the same MotionPlan. Both are staged through the verified path; every
// frame in the range is rendered losslessly both ways and compared under the pinned crop-equivalence tolerance
// (config/blender-environments.json).
//
// node scripts/review/composite-equivalence.ts <crop sequence> <full-frame reference> [--every=n | --frames=a,b,...]
//   -> dist/blender-review/composite-<crop>[-frames]/{crop,reference}/fNNNNN.png + report.json

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../../src/audio/voice-provider.ts';
import { loadEnvironments, type PixelTolerance } from '../../src/blender/identity.ts';
import { lessonMotion } from '../../src/blender/lesson.ts';
import { clearStagedBlender, stageBlenderSequence } from '../../src/blender/stage.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../../src/config/load.ts';
import { loadCommittedSpec } from '../../src/pipeline/context.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../../src/pipeline/render-input.ts';
import { readPng, type Image } from './png.ts';

const [cropName, refName] = process.argv.slice(2);
const every = Number(process.argv.find((a) => a.startsWith('--every='))?.slice(8) ?? '1');
const picked = process.argv.find((a) => a.startsWith('--frames='))?.slice(9).split(',').map(Number);
const videoId = 'migration-readiness';
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const lesson = await lessonMotion(videoId);
clearStagedBlender();
const crop = stageBlenderSequence(cropName!, lesson, 'crop');
const ref = stageBlenderSequence(refName!, lesson, 'full-frame');
if (crop.bridgeSha256 !== ref.bridgeSha256) throw new Error('the two sequences were rendered from different MotionPlans');
stageDeclaredAssets(spec);
stageRendererAssets();
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
const overlays = { captions: true, characterless: false, guides: false };
const out = path.join(DIST_ROOT, 'blender-review', `composite-${cropName}${picked ? '-frames' : ''}`);
const cropped = crop.crops.map((c) => c.frame);
for (const f of picked ?? []) if (!cropped.includes(f)) throw new Error(`frame ${f} has no crop in ${cropName}`);
const frames = picked ?? cropped.filter((f, i) => i % every === 0);
for (const [variant, character] of [['crop', crop], ['reference', ref]] as const) {
  const inputProps = { ...buildProps(spec, source, track, config, overlays), characterRenderer: character };
  const composition = await selectComposition({ serveUrl, id: 'WalletWallDocsVideo', inputProps });
  mkdirSync(path.join(out, variant), { recursive: true });
  for (const f of frames) await renderStill({ composition, serveUrl, output: path.join(out, variant, `f${String(f).padStart(5, '0')}.png`), frame: f, inputProps });
}

/** Compare two lossless frames under a tolerance: fraction of channels over the noise level, mean |delta|, coverage. */
export function compare(a: Image, b: Image, t: PixelTolerance) {
  let over = 0;
  let sum = 0;
  let max = 0;
  let coverage = 0;
  const n = a.data.length;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.data[i]! - b.data[i]!);
    if (d > t.noiseLevel) over++;
    if (d > max) max = d;
    sum += d;
  }
  for (let i = 3; i < n; i += 4) if ((a.data[i]! > 0) !== (b.data[i]! > 0)) coverage++;
  const fractionOverNoise = over / n;
  const meanAbsDelta = sum / n;
  const pass = fractionOverNoise <= t.maxFractionOverNoise && meanAbsDelta <= t.maxMeanAbsDelta && coverage <= t.maxCoverageDeltaPx;
  return { identical: max === 0, maxDelta: max, fractionOverNoise, meanAbsDelta, coverageDeltaPx: coverage, pass };
}

const tol = loadEnvironments().cropEquivalenceTolerance;
const rows = frames.map((f) => {
  const name = `f${String(f).padStart(5, '0')}.png`;
  return { frame: f, ...compare(readPng(path.join(out, 'crop', name)), readPng(path.join(out, 'reference', name)), tol) };
});
const report = {
  schema: 'walletwall.blender-composite-equivalence/v1',
  crop: cropName,
  reference: refName,
  motionPlanSha256: crop.bridgeSha256,
  tolerance: tol,
  frames: rows.length,
  pass: rows.every((r) => r.pass),
  identicalFrames: rows.filter((r) => r.identical).length,
  worst: {
    maxDelta: Math.max(...rows.map((r) => r.maxDelta)),
    fractionOverNoise: Math.max(...rows.map((r) => r.fractionOverNoise)),
    meanAbsDelta: Math.max(...rows.map((r) => r.meanAbsDelta)),
    coverageDeltaPx: Math.max(...rows.map((r) => r.coverageDeltaPx)),
  },
  failing: rows.filter((r) => !r.pass).map((r) => r.frame),
};
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
