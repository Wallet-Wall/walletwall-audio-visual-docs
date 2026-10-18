// The white-surface audit: nothing WalletWall authors may be white.
//
// Two halves. The palette half resolves every colour the material rule names (the character's
// accents, the strata, the cap stone, the shadow, the parchment of cards and panels) and counts
// the pure whites and the white-ish ones by the lane's own guard (config/blender-visual.json,
// src/blender/visual-core.ts). The source half scans the Remotion tree for the tokens that read
// as white (surface, card, cream, paper, warmStone, mortar) and for literal whites, and sorts
// every occurrence into FORBIDDEN or a named EXCEPTION. An exception is a decision on record,
// not a loophole: a new occurrence is forbidden until someone names it here.
// External captured UI (a screenshot inside a UI frame) may contain white; the audit never looks
// inside a UI frame. Node-only.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { TOKENS } from '../brand/tokens.ts';
import { VIDEO_ROOT } from '../config/load.ts';
import { isWhiteish, lumaChroma, type BlenderVisual } from './visual-core.ts';

export interface PaletteEntry {
  name: string;
  hex: string;
  luma: number;
  chroma: number;
  pureWhite: boolean;
  whiteish: boolean;
}

/** Pure white: every channel at or above 250 and no hue (a neutral near #FFFFFF). */
export const isPureWhite = (hex: string): boolean => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  return Math.min(r, g, b) >= 250 && Math.max(r, g, b) - Math.min(r, g, b) <= 6;
};

/** Every authored surface and accent colour, resolved, with the guard applied. The canvas is listed too (and is an exception). */
export function paletteEntries(m: BlenderVisual): PaletteEntry[] {
  const named: [string, string][] = [
    ['canvas (paper)', TOKENS.paper],
    ['card / panel surface (parchment)', m.flat.surface],
    ['character accent', m.palette.accent],
    ['character accent shade', m.palette.accentShade],
    ['character eye glint', m.palette.glint],
    ['cap stone', m.terrain.top],
    ['cap stone shade', m.terrain.topShade],
    ['terrain edge', m.terrain.edge],
    ['route line', m.terrain.line],
    ['contact shadow', m.contactShadow.color],
    ['link text', m.flat.text.link],
    ...m.terrain.strata.layers.flatMap((l, i): [string, string][] => [[`stratum ${i}`, l.lit], [`stratum ${i} shade`, l.shade]]),
  ];
  return named.map(([name, hex]) => {
    const { luma, chroma } = lumaChroma(hex);
    return { name, hex, luma: Number(luma.toFixed(3)), chroma: Number(chroma.toFixed(3)), pureWhite: isPureWhite(hex), whiteish: isWhiteish(hex, m.whiteGuard) };
  });
}

/** Occurrences of white-reading tokens and literals in the Remotion tree, and the decisions on record. */
export interface Occurrence {
  file: string;
  line: number;
  text: string;
  what: string;
}

/** What may stay, by (file, token, the property it paints). Everything else that matches is forbidden. */
export const EXCEPTIONS: { file: RegExp; what: string; line: RegExp; why: string }[] = [
  { file: /src\/remotion\/DocsVideo\.tsx$/, what: 'TOKENS.paper', line: /backgroundColor: TOKENS\.paper/, why: 'the canvas: the brand page colour (--ww-bg), not a card or panel; flagged to the owner' },
  { file: /src\/remotion\/DocsVideo\.tsx$/, what: 'TOKENS.cream', line: /color: TOKENS\.cream/, why: 'caption text on the dark caption pill (review renders only): light text, not a surface' },
  { file: /src\/remotion\/review\//, what: 'TOKENS.paper', line: /backgroundColor: TOKENS\.paper/, why: 'the canvas of a review-only composition' },
];

const WHITE_READING: { what: string; re: RegExp }[] = [
  { what: 'TOKENS.surface', re: /TOKENS\.surface\b/ },
  { what: 'TOKENS.card', re: /TOKENS\.card\b/ },
  { what: 'TOKENS.cream', re: /TOKENS\.cream\b/ },
  { what: 'TOKENS.paper', re: /TOKENS\.paper\b/ },
  { what: 'TOKENS.warmStone', re: /TOKENS\.warmStone\b/ },
  { what: 'TOKENS.mortar', re: /TOKENS\.mortar\b/ },
  { what: 'a literal white', re: /#fff(?:fff)?\b|['"`]white['"`]|rgba?\(\s*255\s*,\s*255\s*,\s*255/i },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

export function scanSources(root = path.join(VIDEO_ROOT, 'src', 'remotion')): { forbidden: Occurrence[]; exceptions: (Occurrence & { why: string })[] } {
  const forbidden: Occurrence[] = [];
  const exceptions: (Occurrence & { why: string })[] = [];
  for (const abs of walk(root)) {
    const file = path.relative(VIDEO_ROOT, abs).split(path.sep).join('/');
    readFileSync(abs, 'utf8').split(/\r?\n/).forEach((text, i) => {
      for (const { what, re } of WHITE_READING) {
        if (!re.test(text)) continue;
        const o = { file, line: i + 1, text: text.trim().slice(0, 140), what };
        const ex = EXCEPTIONS.find((e) => e.file.test(file) && e.what === what && e.line.test(text));
        if (ex) exceptions.push({ ...o, why: ex.why });
        else forbidden.push(o);
      }
    });
  }
  return { forbidden, exceptions };
}
