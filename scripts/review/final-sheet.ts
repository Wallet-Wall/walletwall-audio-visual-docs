// Review-only: the final review sheet of the visual pass. Composites Blender's body over the flat scenes Remotion drew
// (characterless stills of the same frames, rendered by `npm run render:stills -- migration-readiness --frames=...`), and
// lays the cells out beside the depth reveal, the contact shadow close-up, the narrow perch, and the material palette.
//
// node scripts/review/final-sheet.ts <backgrounds dir> <reveal sequence> <reveal frame>
//   -> dist/blender-review/final/<cell>.png         every cell at full size
//   -> dist/blender-review/final/final-sheet.png    the sheet: 3 columns of 640 x 360 cells and the palette
//   -> dist/blender-review/final/palette.png        the material palette, swatch by swatch
//
// Inputs that must already exist: dist/blender/out/renders/sheet-f<frame>/f<frame>.png (npm run blender:render -- --frames=a..a
// --name=sheet-f<a>), dist/blender-review/visual/narrow-perch.png (scripts/review/narrow-perch.ts), and the reveal's frames.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { blenderRigDocument } from '../../src/character/walletwallaby/blender/rig-export.ts';
import { compileRig } from '../../src/character/walletwallaby/rig/rig-compile.ts';
import { loadVisualConfig } from '../../src/blender/visual.ts';
import { outFile } from '../../src/blender/toolchain.ts';
import { TOKENS } from '../../src/brand/tokens.ts';
import { DIST_ROOT } from '../../src/config/load.ts';
import { alphaBounds, blank, crop, hexRgba, over, readPng, resize, writePng, type Image } from './png.ts';

const args = process.argv.slice(2);
const [bgDir, revealSeq, revealFrame] = args.filter((a) => !a.startsWith('--')) as [string, string, string];
if (!bgDir || !revealSeq || !revealFrame) throw new Error('usage: final-sheet.ts <backgrounds dir> <reveal sequence> <reveal frame>');
const out = path.join(DIST_ROOT, 'blender-review', 'final');
mkdirSync(out, { recursive: true });
const pad = (f: number): string => `f${String(f).padStart(5, '0')}`;

/** The flat scenes: the lesson frame, and what it shows. */
const CELLS = [
  { name: 'flat-teaching', frame: 1804, title: 'Ordinary flat teaching frame', note: 'On a node card, layered slabs behind' },
  { name: 'broad-support', frame: 2750, title: 'Broad support', note: 'A reading card, perched' },
  { name: 'tier-support', frame: 1471, title: 'Tier support', note: 'Review node on its pillar' },
  { name: 'vault-candidate', frame: 1670, title: 'Vault Candidate support', note: 'The top tier on its pillar' },
  { name: 'summit-ledge', frame: 3710, title: 'Summit ledge', note: 'The takeaway ledge, perched' },
  { name: 'canonical-page', frame: 4243, title: 'Canonical page frame', note: 'On the ground, strata under the line' },
  { name: 'end-screen', frame: 4454, title: 'End screen', note: 'Ground clear of the reserved zones' },
] as const;

const paper = hexRgba(TOKENS.paper);
const gap = hexRgba(TOKENS.charcoal);
const full: Record<string, Image> = {};
for (const c of CELLS) {
  const bg = readPng(path.join(bgDir, `${pad(c.frame)}.characterless.png`));
  over(bg, readPng(outFile(`renders/sheet-f${c.frame}/${pad(c.frame)}.png`)), 0, 0);
  full[c.name] = bg;
  writePng(path.join(out, `${c.name}.png`), bg);
}
full['narrow-perch'] = readPng(path.join(DIST_ROOT, 'blender-review', 'visual', 'narrow-perch.png'));
writePng(path.join(out, 'narrow-perch.png'), full['narrow-perch']);

// The depth reveal: Blender's frame (full frame, transparent where the flat sheet would show) over the canvas.
{
  const r = readPng(outFile(`renders/${revealSeq}/${pad(Number(revealFrame))}.png`));
  const bg = blank(r.width, r.height, paper);
  over(bg, r, 0, 0);
  full['depth-reveal'] = bg;
  writePng(path.join(out, 'depth-reveal.png'), bg);
}

// The contact shadow close-up: the feet at 4x on the flat teaching frame and on the canonical page's ground.
{
  const close = (img: Image, frame: number): Image => {
    const ink = alphaBounds(readPng(outFile(`renders/sheet-f${frame}/${pad(frame)}.png`)), 8)!;
    const cx = Math.round(ink.x + ink.w / 2 - 130);
    const cy = ink.y + ink.h - 46;
    return resize(crop(img, Math.max(0, cx), Math.max(0, cy), 260, 64), 1040, 256);
  };
  const a = close(full['flat-teaching']!, 1804);
  const b = close(full['canonical-page']!, 4243);
  const sheet = blank(a.width, a.height + 12 + b.height, gap);
  over(sheet, a, 0, 0);
  over(sheet, b, 0, a.height + 12);
  full['shadow-closeup'] = sheet;
  writePng(path.join(out, 'shadow-closeup.png'), sheet);
}

// A depth view of the same terrain (the contact view under the stand at frame 1780), over the canvas.
{
  const r = readPng(outFile('renders/after-contact/close-f01780.png'));
  const bg = blank(r.width, r.height, paper);
  over(bg, r, 0, 0);
  full['depth-contact'] = bg;
  writePng(path.join(out, 'depth-contact.png'), bg);
}

// The palette: every colour the lane draws, in swatches. Rows: coat and ink; the character's accents; the strata lit over shade; the cap stone; shadow and surfaces.
{
  const v = loadVisualConfig();
  const rig = blenderRigDocument(compileRig().model).palette;
  const rows: string[][] = [
    [rig.coat, rig.coatShade, rig.ink, v.palette.accent, v.palette.accentShade, v.palette.glint],
    v.terrain.strata.layers.map((l) => l.lit),
    v.terrain.strata.layers.map((l) => l.shade),
    [v.terrain.top, v.terrain.topShade, v.terrain.edge, v.terrain.line, v.contactShadow.color],
    [v.flat.surface, TOKENS.paper],
  ];
  const cell = 120;
  const g = 14;
  const cols = Math.max(...rows.map((r) => r.length));
  const sheet = blank(cols * (cell + g) + g, rows.length * (cell + g) + g, hexRgba(TOKENS.paper));
  rows.forEach((row, ri) => row.forEach((hex, ci) => over(sheet, blank(cell, cell, hexRgba(hex)), g + ci * (cell + g), g + ri * (cell + g))));
  full.palette = sheet;
  writePng(path.join(out, 'palette.png'), sheet);
}

// The sheet: 3 columns of 640 x 360.
const order: { name: string; label: string }[] = [
  { name: 'flat-teaching', label: CELLS[0].title },
  { name: 'broad-support', label: CELLS[1].title },
  { name: 'narrow-perch', label: 'Narrow perch (review lab)' },
  { name: 'tier-support', label: CELLS[2].title },
  { name: 'vault-candidate', label: CELLS[3].title },
  { name: 'summit-ledge', label: CELLS[4].title },
  { name: 'depth-reveal', label: 'Depth reveal' },
  { name: 'depth-contact', label: 'Depth view: the same rock' },
  { name: 'shadow-closeup', label: 'Contact shadow close-up' },
  { name: 'canonical-page', label: CELLS[5].title },
  { name: 'end-screen', label: CELLS[6].title },
  { name: 'palette', label: 'Material palette' },
];
const W = 640;
const H = 360;
const G = 10;
const cols = 3;
const rowsN = Math.ceil(order.length / cols);
const sheet = blank(cols * W + (cols + 1) * G, rowsN * H + (rowsN + 1) * G, gap);
order.forEach((o, i) => {
  const img = full[o.name]!;
  const scale = Math.min(W / img.width, H / img.height);
  const fitted = resize(img, Math.round(img.width * scale), Math.round(img.height * scale));
  const cellImg = blank(W, H, paper);
  over(cellImg, fitted, Math.round((W - fitted.width) / 2), Math.round((H - fitted.height) / 2));
  over(sheet, cellImg, G + (i % cols) * (W + G), G + Math.floor(i / cols) * (H + G));
});
writePng(path.join(out, 'final-sheet.png'), sheet);
console.log(`[final] ${order.length} cells -> ${path.relative(process.cwd(), out)}/final-sheet.png`);
