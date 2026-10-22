// Review-only: per-frame render statistics from Blender's own render manifests (render.json of each sequence).
//
// node scripts/review/blender-bench.ts <label>=<out-relative render dir> ...
//   prints, per sequence: frames, cold (first) frame, warm median and p95, total Blender seconds, and the estimate for
//   N frames at the warm median.

import { readFileSync } from 'node:fs';
import { outFile } from '../../src/blender/toolchain.ts';

const LESSON_FRAMES = 5248;
const rows = process.argv.slice(2).map((arg) => {
  const [label, dir] = arg.split('=');
  const r = JSON.parse(readFileSync(outFile(`${dir}/render.json`), 'utf8')) as { seconds: number; shots: { ms: number }[]; environment?: { os: string; gpu: { renderer?: string } } };
  const warm = r.shots.slice(1).map((s) => s.ms).sort((a, b) => a - b);
  const q = (p: number): number => warm[Math.min(warm.length - 1, Math.floor(p * (warm.length - 1)))] ?? NaN;
  return {
    label,
    renderer: r.environment ? `${r.environment.os} / ${r.environment.gpu.renderer ?? '?'}` : '?',
    frames: r.shots.length,
    coldMs: Math.round(r.shots[0]?.ms ?? NaN),
    warmMedianMs: Math.round(q(0.5)),
    warmP95Ms: Math.round(q(0.95)),
    blenderSeconds: r.seconds,
    estimateLessonMin: Number(((q(0.5) * LESSON_FRAMES) / 60000).toFixed(1)),
  };
});
console.log(JSON.stringify(rows, null, 2));
