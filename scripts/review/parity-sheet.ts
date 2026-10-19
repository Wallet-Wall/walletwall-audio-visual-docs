// Review-only: side-by-side parity sheets from scripts/review/blender-parity.ts output.
//
// node scripts/review/parity-sheet.ts <sequence> <frames a,b,c> [--zoom=2] [--reference=<stills dir>]
//   -> dist/blender-review/<sequence>/parity-sheet.png (rows: frames; columns: Rive | [reference Rive] | Blender, same crop)
//   --reference: stills of the same frames from another checkout (e.g. the reviewed v5 art), named fNNNNN.png
//   -> dist/blender-review/<sequence>/silhouette-sheet.png (the two inks in charcoal, overlaid: Rive outline, Blender fill)

import path from 'node:path';
import { DIST_ROOT } from '../../src/config/load.ts';
import { outFile } from '../../src/blender/toolchain.ts';
import { alphaBounds, blank, crop, over, readPng, resize, writePng, type Image } from './png.ts';

const args = process.argv.slice(2);
const sequence = args[0]!;
const frames = args[1]!.split(',').map(Number);
const zoom = Number(args.find((a) => a.startsWith('--zoom='))?.slice(7) ?? '2');
const reference = args.find((a) => a.startsWith('--reference='))?.slice(12);
const dir = path.join(DIST_ROOT, 'blender-review', sequence);
const name = (f: number): string => `f${String(f).padStart(5, '0')}.png`;

/** Where the two renders differ from the characterless frame: the character's own pixels, as a mask. */
function inkMask(withChar: Image, without: Image): Image {
  const m = blank(withChar.width, withChar.height, [0, 0, 0, 0]);
  for (let i = 0; i < withChar.width * withChar.height; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(withChar.data[i * 4 + c]! - without.data[i * 4 + c]!);
    if (d > 24) m.data.set([40, 40, 40, 255], i * 4);
  }
  return m;
}

const cellW = 420 * zoom / 2;
const pad = 24;
const rows: { rive: Image; ref: Image | null; blender: Image; sil: Image }[] = [];
for (const f of frames) {
  const rive = readPng(path.join(dir, 'rive', name(f)));
  const blender = readPng(path.join(dir, 'blender', name(f)));
  const bare = readPng(path.join(dir, 'characterless', name(f)));
  const rMask = inkMask(rive, bare);
  const bMask = inkMask(blender, bare);
  const bb = alphaBounds(readPng(outFile(`renders/${sequence}/${name(f)}`)))!;
  const rb = alphaBounds(rMask)!;
  const x0 = Math.min(bb.x, rb.x) - pad;
  const y0 = Math.min(bb.y, rb.y) - pad;
  const x1 = Math.max(bb.x + bb.w, rb.x + rb.w) + pad;
  const y1 = Math.max(bb.y + bb.h, rb.y + rb.h) + pad;
  const side = Math.max(x1 - x0, y1 - y0);
  const cx = Math.round((x0 + x1) / 2 - side / 2);
  const cy = Math.round((y0 + y1) / 2 - side / 2);
  const take = (img: Image): Image => resize(crop(img, cx, cy, side, side), Math.round(cellW), Math.round(cellW));
  // Silhouettes: Blender's ink filled, Rive's ink as a light overlay, so both outlines read at once.
  const sil = blank(side, side, [248, 245, 238, 255]);
  const bm = crop(bMask, cx, cy, side, side);
  const rm = crop(rMask, cx, cy, side, side);
  for (let i = 0; i < side * side; i++) if (rm.data[i * 4 + 3]! > 0) rm.data.set([191, 78, 50, 255], i * 4);
  over(sil, bm, 0, 0);
  over(sil, rm, 0, 0, 0.45);
  rows.push({ rive: take(rive), ref: reference ? take(readPng(path.join(reference, name(f)))) : null, blender: take(blender), sil: resize(sil, Math.round(cellW), Math.round(cellW)) });
}
const W = Math.round(cellW);
const cols = reference ? 3 : 2;
const sheet = blank(W * cols + 12 * (cols - 1), rows.length * (W + 12), [255, 255, 255, 255]);
const silSheet = blank(W * Math.min(rows.length, 5), Math.ceil(rows.length / 5) * W, [255, 255, 255, 255]);
rows.forEach((r, i) => {
  over(sheet, r.rive, 0, i * (W + 12));
  if (r.ref) over(sheet, r.ref, W + 12, i * (W + 12));
  over(sheet, r.blender, (cols - 1) * (W + 12), i * (W + 12));
  over(silSheet, r.sil, (i % 5) * W, Math.floor(i / 5) * W);
});
writePng(path.join(dir, 'parity-sheet.png'), sheet);
writePng(path.join(dir, 'silhouette-sheet.png'), silSheet);
console.log(`[parity] ${rows.length} rows -> ${path.relative(DIST_ROOT, dir)}/parity-sheet.png, silhouette-sheet.png`);
