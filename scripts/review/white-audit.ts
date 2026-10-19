// Review-only: the white-surface audit (src/blender/white-audit.ts) over the palette, the source, and, when given, the
// rendered characterless stills.
//
// node scripts/review/white-audit.ts [--before=<stills dir>] [--after=<stills dir>] [--out=<file.json>]
//
//   palette   every authored surface and accent colour, resolved, with pure-white and white-ish counted by the lane's guard
//   source    every white-reading token or literal in src/remotion, forbidden or a named exception
//   pixels    over the *.characterless.png stills (no character, so nothing but authored surfaces): pure-white pixels, and
//             flat white-ish pixels (a 3x3 neighbourhood of one exact colour, so text edges never count) other than the
//             canvas and the two named exceptions below, over SETTLED stills only (a cross-fade is two settled states blended, not an
//             authored surface). External captured UI would be excluded; this lesson has none.
// Exit 0 only when no authored pure white and no authored white-ish surface other than a named exception remains.

import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TOKENS } from '../../src/brand/tokens.ts';
import { loadVisualConfig } from '../../src/blender/visual.ts';
import { paletteEntries, scanSources } from '../../src/blender/white-audit.ts';
import { readPng, type Image } from './png.ts';

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const visual = loadVisualConfig();
const guard = visual.whiteGuard;

const palette = paletteEntries(visual);
const exceptionNames = new Set(['canvas (paper)']);
const source = scanSources();

const hexOf = (img: Image, i: number): number => (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
const canvas = parseInt(TOKENS.paper.slice(1), 16);
const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** The attention wash (a 7% terracotta tint behind the element the guide points at, over the canvas), as Chrome composites it. */
const wash: [number, number, number] = (() => {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(TOKENS.accentWash(0.07))!;
  const bg = channels(TOKENS.paper);
  return [0, 1, 2].map((k) => Math.round(Number(m[k + 1]) * Number(m[4]) + bg[k]! * (1 - Number(m[4])))) as [number, number, number];
})();
const near = (c: number, rgb: [number, number, number], tol = 2): boolean => Math.abs(((c >> 16) & 255) - rgb[0]) <= tol && Math.abs(((c >> 8) & 255) - rgb[1]) <= tol && Math.abs((c & 255) - rgb[2]) <= tol;
const captionText = channels(TOKENS.cream);

function pixels(dir: string): { stills: number; pixels: number; canvas: number; exceptions: number; pureWhite: number; flatWhiteish: number; worst: { still: string; flatWhiteish: number } } {
  const files = readdirSync(dir).filter((f) => f.endsWith('.characterless.png') && !f.includes('-transition'));
  let total = 0;
  let canvasPx = 0;
  let exceptionPx = 0;
  let pure = 0;
  let flat = 0;
  let worst = { still: '', flatWhiteish: 0 };
  for (const f of files) {
    const img = readPng(path.join(dir, f));
    let flatHere = 0;
    for (let y = 1; y < img.height - 1; y++)
      for (let x = 1; x < img.width - 1; x++) {
        const i = y * img.width + x;
        const c = hexOf(img, i);
        total++;
        const r = (c >> 16) & 255;
        const g = (c >> 8) & 255;
        const b = c & 255;
        if (Math.min(r, g, b) >= 250 && Math.max(r, g, b) - Math.min(r, g, b) <= 6) pure++;
        if (c === canvas) {
          canvasPx++;
          continue;
        }
        // The two named exceptions: the attention wash, and the caption pill's light text.
        if (near(c, wash) || near(c, captionText, 0)) {
          exceptionPx++;
          continue;
        }
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        if (luma < guard.minLuma || chroma > guard.maxChroma) continue;
        // A flat fill: this pixel and all eight neighbours are one exact colour.
        let same = true;
        for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1; dx++) if (hexOf(img, i + dy * img.width + dx) !== c) { same = false; break; }
        if (same) flatHere++;
      }
    flat += flatHere;
    if (flatHere > worst.flatWhiteish) worst = { still: f, flatWhiteish: flatHere };
  }
  return { stills: files.length, pixels: total, canvas: canvasPx, exceptions: exceptionPx, pureWhite: pure, flatWhiteish: flat, worst };
}

const before = opt('before');
const after = opt('after');
const report = {
  schema: 'walletwall.white-audit/v1',
  guard,
  palette: {
    entries: palette,
    pureWhite: palette.filter((e) => e.pureWhite).length,
    whiteishOutsideExceptions: palette.filter((e) => e.whiteish && !exceptionNames.has(e.name)).map((e) => e.name),
    exceptions: palette.filter((e) => e.whiteish && exceptionNames.has(e.name)).map((e) => ({ name: e.name, hex: e.hex, luma: e.luma, chroma: e.chroma })),
  },
  source: { forbidden: source.forbidden, exceptions: source.exceptions },
  pixels: { before: before ? pixels(before) : null, after: after ? pixels(after) : null },
};

console.log(`palette: ${palette.length} authored colours; pure white ${report.palette.pureWhite}; white-ish outside exceptions ${report.palette.whiteishOutsideExceptions.length}${report.palette.whiteishOutsideExceptions.length ? ' (' + report.palette.whiteishOutsideExceptions.join(', ') + ')' : ''}`);
for (const e of report.palette.exceptions) console.log(`  exception: ${e.name} ${e.hex} (luma ${e.luma}, chroma ${e.chroma})`);
console.log(`source: ${source.forbidden.length} forbidden occurrence(s), ${source.exceptions.length} named exception(s)`);
for (const f of source.forbidden) console.log(`  FORBIDDEN ${f.file}:${f.line} ${f.what}  ${f.text}`);
for (const e of source.exceptions) console.log(`  exception ${e.file}:${e.line} ${e.what}: ${e.why}`);
for (const k of ['before', 'after'] as const) {
  const p = report.pixels[k];
  if (p) console.log(`pixels ${k}: ${p.stills} characterless stills, pure white ${p.pureWhite}, flat white-ish (not canvas) ${p.flatWhiteish} (worst ${p.worst.still || '-'} ${p.worst.flatWhiteish}), canvas ${p.canvas}, named exceptions ${p.exceptions} (wash ${wash.join(',')}; caption text) of ${p.pixels}`);
}
const out = opt('out');
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
const ok = report.palette.pureWhite === 0 && report.palette.whiteishOutsideExceptions.length === 0 && source.forbidden.length === 0 && (!report.pixels.after || (report.pixels.after.pureWhite === 0 && report.pixels.after.flatWhiteish === 0));
console.log(ok ? 'white audit: PASS' : 'white audit: FAIL');
process.exitCode = ok ? 0 : 1;
