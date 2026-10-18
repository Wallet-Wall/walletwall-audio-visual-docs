// Conservative text-fit estimation without a browser.
//
// Validation must decide "does this text fit its bounded region?" before any
// render exists, so it uses per-face average advance widths (as a fraction of
// font size) that deliberately over-estimate real glyph widths. The renderer
// lays text out in exactly the regions defined in ./scene-layout.ts, so a pass
// here means the real render has slack, not that it is tight.
// Isomorphic.

import type { FontRole } from '../brand/tokens.ts';

/** Average advance per character as a fraction of font size (conservative upper estimates). */
const ADVANCE: Record<FontRole, number> = {
  display: 0.62, // Sora: wide geometric sans
  ui: 0.57, // Manrope
  mono: 0.6, // IBM Plex Mono: exactly 0.6em per glyph
};

/**
 * Per-glyph width classes relative to the face average, so runs of wide glyphs
 * (W, M, capitals) cannot "fit" by averaging against narrow ones. Proportional
 * faces only; monospace is exact.
 */
function glyphFactor(ch: string): number {
  if ('WMmw@%'.includes(ch)) return 1.55;
  if (/[A-Z]/.test(ch)) return 1.22;
  if (/[0-9]/.test(ch)) return 1.0;
  if ('iljI.,:;\'!|'.includes(ch)) return 0.5;
  if ('ftr()[]{}"-/ '.includes(ch)) return 0.75;
  if (/[a-z]/.test(ch)) return 1.0;
  return 1.3; // anything unusual (dashes, symbols) is assumed wide
}

export interface TextStyle {
  font: FontRole;
  size: number;
  weight: number;
  lineHeight: number;
  /** Extra tracking in px per character (eyebrows). */
  tracking?: number;
  uppercase?: boolean;
}

export interface TextBox {
  maxWidth: number;
  maxLines: number;
  style: TextStyle;
}

export function estimateWidth(text: string, style: TextStyle): number {
  const s = style.uppercase ? text.toUpperCase() : text;
  const tracking = (style.tracking ?? 0) * s.length;
  if (style.font === 'mono') return s.length * style.size * ADVANCE.mono + tracking;
  let units = 0;
  for (const ch of s) units += glyphFactor(ch);
  // Uppercase runs are already weighted per glyph; keep a small margin for kerning variance.
  return units * style.size * ADVANCE[style.font] * 1.04 + tracking;
}

/** Greedy word wrap using the conservative width estimate. */
export function wrapLines(text: string, box: TextBox): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && estimateWidth(candidate, box.style) > box.maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

export interface FitResult {
  fits: boolean;
  lines: number;
  /** A single word wider than the box can never fit, whatever the line budget. */
  overlongWord: string | null;
}

export function fitText(text: string, box: TextBox): FitResult {
  const lines = wrapLines(text, box);
  const overlongWord = text.split(/\s+/).find((w) => estimateWidth(w, box.style) > box.maxWidth) ?? null;
  return { fits: lines.length <= box.maxLines && overlongWord === null, lines: lines.length, overlongWord };
}
