// Crop equivalence: a crop sequence, placed back on the 1920x1080 canvas, against the full-frame Blender reference of
// the same MotionPlan. Every pixel of every frame is compared (RGBA), and the reference must carry no ink outside the
// crop (the envelope holds the whole body).
//
// node scripts/review/crop-equivalence.ts <crop sequence> <full-frame reference sequence> [--json=<out>]

import { readFileSync, writeFileSync } from 'node:fs';
import { outFile } from '../../src/blender/toolchain.ts';
import { contentAddress } from '../../src/core/hash.ts';
import { readPng } from './png.ts';

const [cropName, refName] = process.argv.slice(2);
const jsonOut = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
const crops = JSON.parse(readFileSync(outFile(`renders/${cropName}/crops.json`), 'utf8')) as { crops: { frame: number; x: number; y: number; width: number; height: number }[] };
const a = JSON.parse(readFileSync(outFile(`renders/${cropName}/bridge.json`), 'utf8'));
const b = JSON.parse(readFileSync(outFile(`renders/${refName}/bridge.json`), 'utf8'));
if (contentAddress(a) !== contentAddress(b)) throw new Error('the two sequences were rendered from different MotionPlans: not comparable');
let identicalFrames = 0;
let worstMax = 0;
let worstOver2 = 0;
let sumAbs = 0;
let channels = 0;
let inkOutside = 0;
const perFrame: { frame: number; maxDelta: number; over2: number }[] = [];
for (const c of crops.crops) {
  const name = `f${String(c.frame).padStart(5, '0')}.png`;
  const crop = readPng(outFile(`renders/${cropName}/${name}`));
  const full = readPng(outFile(`renders/${refName}/${name}`));
  if (crop.width !== c.width || crop.height !== c.height) throw new Error(`${name}: crop is ${crop.width}x${crop.height}, metadata says ${c.width}x${c.height}`);
  let max = 0;
  let over2 = 0;
  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      const o = (y * full.width + x) * 4;
      const inside = x >= c.x && x < c.x + c.width && y >= c.y && y < c.y + c.height;
      if (!inside) {
        if (full.data[o + 3]! > 0) inkOutside++;
        continue;
      }
      const q = ((y - c.y) * c.width + (x - c.x)) * 4;
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(full.data[o + k]! - crop.data[q + k]!);
        if (d > max) max = d;
        if (d > 2) over2++;
        sumAbs += d;
        channels++;
      }
    }
  }
  if (max === 0) identicalFrames++;
  worstMax = Math.max(worstMax, max);
  worstOver2 = Math.max(worstOver2, over2);
  perFrame.push({ frame: c.frame, maxDelta: max, over2 });
}
const report = {
  schema: 'walletwall.blender-crop-equivalence/v1',
  crop: cropName,
  reference: refName,
  frames: crops.crops.length,
  pixelIdenticalFrames: identicalFrames,
  worstMaxChannelDelta: worstMax,
  worstChannelsOver2InAFrame: worstOver2,
  meanAbsChannelDelta: Number((sumAbs / channels).toFixed(6)),
  referenceInkOutsideCrops: inkOutside,
  worstFrames: [...perFrame].sort((p, q) => q.maxDelta - p.maxDelta || q.over2 - p.over2).slice(0, 5),
};
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
