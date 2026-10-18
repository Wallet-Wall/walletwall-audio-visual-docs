// Review-only: numbers for the visual pass, from two rendered Blender sequences (lossless RGBA PNGs).
//
// node scripts/review/visual-metrics.ts <before sequence> <after sequence> [--out=<file.json>]
//
//   whiteish   Per drawn pixel (alpha >= 250): is it white-ish by the lane's own guard (config/blender-visual.json)?
//              Reported as a count over the whole sequence, and the worst frame.
//   shadow     On grounded frames, the contact shadow's visible weight: alpha x (1 - luma) summed over a band just
//              below the feet's line, where the shadow is not hidden behind the body.
//   frames     How many frames were compared; every one must exist in both sequences.
//
// Pure measurement over files; no Blender, no Remotion.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadVisualConfig } from '../../src/blender/visual.ts';
import { outFile } from '../../src/blender/toolchain.ts';
import { validateBridge } from '../../src/character/walletwallaby/blender/bridge.ts';
import { readPng } from './png.ts';

const args = process.argv.slice(2);
const [before, after] = args.filter((a) => !a.startsWith('--')) as [string, string];
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
if (!before || !after) throw new Error('usage: visual-metrics.ts <before sequence> <after sequence> [--out=file.json]');
const guard = loadVisualConfig().whiteGuard;

interface PerFrame {
  frame: number;
  opaque: number;
  whiteish: number;
  shadow: number | null;
}

function measure(sequence: string): PerFrame[] {
  const dir = `renders/${sequence}`;
  const bridge = validateBridge(JSON.parse(readFileSync(outFile(`${dir}/bridge.json`), 'utf8')));
  const manifest = JSON.parse(readFileSync(outFile(`${dir}/render.json`), 'utf8')) as { shots: { name: string; frame: number }[] };
  const rows: PerFrame[] = [];
  for (const shot of manifest.shots) {
    const f = bridge.frames[shot.frame - bridge.range.first]!;
    const img = readPng(outFile(`${dir}/${shot.name}.png`));
    let opaque = 0;
    let whiteish = 0;
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.data[i * 4 + 3]! < 250) continue;
      opaque++;
      const r = img.data[i * 4]! / 255;
      const g = img.data[i * 4 + 1]! / 255;
      const b = img.data[i * 4 + 2]! / 255;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (luma >= guard.minLuma && chroma <= guard.maxChroma) whiteish++;
    }
    let shadow: number | null = null;
    if (f.visible && f.semantic.contact !== 'NONE' && !f.semantic.offStage) {
      // The band under the feet's line (frame px): the shadow's own, outside the sole's outline.
      const s = f.place.scale;
      const x0 = Math.max(0, Math.floor(f.place.x - 70 * s));
      const x1 = Math.min(img.width, Math.ceil(f.place.x + 90 * s));
      const y0 = Math.max(0, Math.floor(f.place.y + 5 * s));
      const y1 = Math.min(img.height, Math.ceil(f.place.y + 14 * s));
      let w = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const a = img.data[i + 3]! / 255;
          const luma = (0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!) / 255;
          w += a * (1 - luma);
        }
      shadow = w;
    }
    rows.push({ frame: shot.frame, opaque, whiteish, shadow });
  }
  return rows;
}

const a = measure(before);
const b = measure(after);
if (a.length !== b.length || a.some((r, i) => r.frame !== b[i]!.frame)) throw new Error('the two sequences cover different frames');
const sum = (rows: PerFrame[], k: 'opaque' | 'whiteish'): number => rows.reduce((n, r) => n + r[k], 0);
const grounded = a.map((r, i) => ({ frame: r.frame, before: r.shadow, after: b[i]!.shadow })).filter((r) => r.before !== null && r.after !== null) as { frame: number; before: number; after: number }[];
const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const worst = (rows: PerFrame[]): { frame: number; whiteish: number } => rows.reduce((w, r) => (r.whiteish > w.whiteish ? { frame: r.frame, whiteish: r.whiteish } : w), { frame: -1, whiteish: 0 });
const report = {
  schema: 'walletwall.blender-visual-metrics/v1',
  sequences: { before, after },
  frames: a.length,
  guard,
  whiteish: {
    before: { pixels: sum(a, 'whiteish'), ofOpaque: sum(a, 'opaque'), framesWithAny: a.filter((r) => r.whiteish > 0).length, worst: worst(a) },
    after: { pixels: sum(b, 'whiteish'), ofOpaque: sum(b, 'opaque'), framesWithAny: b.filter((r) => r.whiteish > 0).length, worst: worst(b) },
  },
  contactShadow: {
    groundedFrames: grounded.length,
    meanVisibleWeightBefore: Number(mean(grounded.map((r) => r.before)).toFixed(2)),
    meanVisibleWeightAfter: Number(mean(grounded.map((r) => r.after)).toFixed(2)),
    framesWithShadowBefore: grounded.filter((r) => r.before > 1).length,
    framesWithShadowAfter: grounded.filter((r) => r.after > 1).length,
  },
};
console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
