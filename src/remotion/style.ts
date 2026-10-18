// Shared render helpers: text styles from the layout grammar, reveal easing.

import type { CSSProperties } from 'react';
import { FONTS, TOKENS } from '../brand/tokens.ts';
import { clamp01, easeOut, type Rect } from '../layout/geometry.ts';
import { TEXT_STYLES, type TextStyleKey } from '../layout/scene-layout.ts';

export function textStyle(key: TextStyleKey, mono = false): CSSProperties {
  const s = TEXT_STYLES[key];
  return {
    fontFamily: mono ? FONTS.mono : FONTS[s.font],
    fontSize: s.size,
    fontWeight: s.weight,
    lineHeight: s.lineHeight,
    letterSpacing: 'tracking' in s ? s.tracking : mono ? 0 : -0.2,
    textTransform: 'uppercase' in s && s.uppercase ? 'uppercase' : 'none',
    color: TOKENS.ink,
    fontVariantNumeric: 'tabular-nums',
  };
}

export function rectStyle(r: Rect): CSSProperties {
  return { position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h };
}

/** The WalletWall signature gesture: an element settles into place like a laid brick. */
export function settle(ms: number, revealMs: number | undefined, durationMs = 380): { opacity: number; transform: string } {
  if (revealMs === undefined) return { opacity: 1, transform: 'none' };
  const p = easeOut(clamp01((ms - revealMs) / durationMs));
  return { opacity: p, transform: `translateY(${((1 - p) * 10).toFixed(2)}px)` };
}

export const HAIRLINE = `1px solid ${TOKENS.cardBorder}`;
export const RAIL = `1px solid ${TOKENS.charcoalRail}`;
