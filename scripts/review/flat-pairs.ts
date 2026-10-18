// Review-only: the flat scenes before and after the material pass, as Remotion draws them (characterless: nothing but authored
// surfaces). Left is the baseline's still (main), right is this checkout's.
//
// node scripts/review/flat-pairs.ts <before stills dir> <after stills dir> [name,name,...]
//   -> dist/blender-review/final/flat-<name>.png   each side at 960 x 540

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { TOKENS } from '../../src/brand/tokens.ts';
import { DIST_ROOT } from '../../src/config/load.ts';
import { blank, hexRgba, over, readPng, resize, writePng } from './png.ts';

const args = process.argv.slice(2);
const [beforeDir, afterDir, names] = args as [string, string, string | undefined];
if (!beforeDir || !afterDir) throw new Error('usage: flat-pairs.ts <before stills dir> <after stills dir> [name,name,...]');
const picks = (names ?? '03-tiers,05-signals,10-takeaway,12-docs-reference,14-end-screen').split(',');
const out = path.join(DIST_ROOT, 'blender-review', 'final');
mkdirSync(out, { recursive: true });
for (const n of picks) {
  const a = resize(readPng(path.join(beforeDir, `${n}.characterless.png`)), 960, 540);
  const b = resize(readPng(path.join(afterDir, `${n}.characterless.png`)), 960, 540);
  const sheet = blank(960 * 2 + 12, 540, hexRgba(TOKENS.charcoal));
  over(sheet, a, 0, 0);
  over(sheet, b, 972, 0);
  writePng(path.join(out, `flat-${n}.png`), sheet);
}
console.log(`[flat-pairs] ${picks.length} pairs -> ${path.relative(process.cwd(), out)}`);
