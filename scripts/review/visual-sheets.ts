// Review-only: the before/after sheets for the visual pass, from renders that already exist.
//
// node scripts/review/visual-sheets.ts <before sequence> <after sequence> <before reveal> <after reveal> [--frames=a,b,c] [--reveal=a,b,c]
//   -> dist/blender-review/visual/
//        lesson-<frame>.png   the character's neighbourhood at lesson scale, 2x: before | after (same crop)
//        feet-<frame>.png     the contact shadow, 4x: before | after
//        reveal-<frame>.png   the depth reveal, half size: before | after
//        pair-<frame>.png     the whole 1920x1080 composites, half size: before | after
//        contact-<view>-<frame>.png  the supports in perspective (--contact=<before>,<after> --contact-frames=a,b): before | after
//
// Both sides of every pair are the same frame of the same MotionPlan; only the visual constants differ. Pure image
// work over files (src/review png helpers); no Blender, no Remotion.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DIST_ROOT } from '../../src/config/load.ts';
import { outFile } from '../../src/blender/toolchain.ts';
import { TOKENS } from '../../src/brand/tokens.ts';
import { alphaBounds, blank, crop, hexRgba, over, readPng, resize, writePng, type Image } from './png.ts';

const args = process.argv.slice(2);
const [beforeSeq, afterSeq, beforeReveal, afterReveal] = args.filter((a) => !a.startsWith('--')) as [string, string, string, string];
const list = (name: string, fallback: number[]): number[] => (args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3).split(',').map(Number)) ?? fallback;
const frames = list('frames', [1812, 1850, 1904, 1916, 1928, 1960]);
const reveals = list('reveal', [1750, 1759, 1766, 1773, 1780]);
const contact = args.find((a) => a.startsWith('--contact='))?.slice(10).split(',');
const contactFrames = list('contact-frames', [1850, 1904]);
if (!beforeSeq || !afterSeq || !beforeReveal || !afterReveal) throw new Error('usage: visual-sheets.ts <before seq> <after seq> <before reveal> <after reveal> [--frames=…] [--reveal=…]');

const out = path.join(DIST_ROOT, 'blender-review', 'visual');
mkdirSync(out, { recursive: true });
const name = (f: number): string => `f${String(f).padStart(5, '0')}.png`;
const GAP = 12;

function pair(a: Image, b: Image): Image {
  const sheet = blank(a.width + GAP + b.width, Math.max(a.height, b.height), hexRgba(TOKENS.charcoal));
  over(sheet, a, 0, 0);
  over(sheet, b, a.width + GAP, 0);
  return sheet;
}

/** The same box of both composites, zoomed. Clamped to the frame. */
function zoomed(a: Image, b: Image, x: number, y: number, w: number, h: number, z: number): Image {
  const cx = Math.max(0, Math.min(a.width - w, Math.round(x)));
  const cy = Math.max(0, Math.min(a.height - h, Math.round(y)));
  const one = (i: Image): Image => resize(crop(i, cx, cy, w, h), Math.round(w * z), Math.round(h * z));
  return pair(one(a), one(b));
}

for (const f of frames) {
  const beforeFull = readPng(path.join(DIST_ROOT, 'blender-review', beforeSeq, 'blender', name(f)));
  const afterFull = readPng(path.join(DIST_ROOT, 'blender-review', afterSeq, 'blender', name(f)));
  const ink = alphaBounds(readPng(outFile(`renders/${afterSeq}/${name(f)}`)), 8);
  if (ink) {
    const w = 380;
    const h = 300;
    writePng(path.join(out, `lesson-${f}.png`), zoomed(beforeFull, afterFull, ink.x + ink.w / 2 - w / 2, ink.y + ink.h / 2 - h / 2, w, h, 2));
    // The feet: the lowest 60 px of the ink, 4x, centred on it.
    writePng(path.join(out, `feet-${f}.png`), zoomed(beforeFull, afterFull, ink.x + ink.w / 2 - 130, ink.y + ink.h - 52, 260, 70, 4));
  }
  writePng(path.join(out, `pair-${f}.png`), pair(resize(beforeFull, 960, 540), resize(afterFull, 960, 540)));
}
for (const f of reveals) {
  const b = readPng(outFile(`renders/${beforeReveal}/${name(f)}`));
  const a = readPng(outFile(`renders/${afterReveal}/${name(f)}`));
  const bg = hexRgba(TOKENS.paper);
  const flat = (i: Image): Image => {
    const c = blank(i.width, i.height, bg);
    over(c, i, 0, 0);
    return resize(c, 960, 540);
  };
  writePng(path.join(out, `reveal-${f}.png`), pair(flat(b), flat(a)));
}
if (contact && contact.length === 2) {
  for (const f of contactFrames)
    for (const view of ['close', 'wide']) {
      const file = `${view}-${name(f)}`;
      const onPaper = (seq: string): Image => {
        const img = readPng(outFile(`renders/${seq}/${file}`));
        const c = blank(img.width, img.height, hexRgba(TOKENS.paper));
        over(c, img, 0, 0);
        return view === 'wide' ? resize(c, 800, 450) : c;
      };
      writePng(path.join(out, `contact-${view}-${f}.png`), pair(onPaper(contact[0]!), onPaper(contact[1]!)));
    }
}
console.log(`[sheets] ${frames.length} lesson, ${frames.length} feet, ${frames.length} pair, ${reveals.length} reveal sheets -> ${path.relative(process.cwd(), out)}`);
