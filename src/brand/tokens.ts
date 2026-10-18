// WalletWall visual tokens for the audiovisual pipeline.
//
// Every value comes from the brand contract (contracts/walletwall-brand.json)
// through ./repo-constants.ts: theme colors from the canonical theme module, and
// tokens that exist only as CSS custom properties from the canonical :root block.
// Do not add a color here that the canonical app does not already define.

import { COLORS, CSS_ROOT, VAULT } from './repo-constants.ts';

/** CSS-only tokens from the canonical :root block. Key = custom property name. */
export const CSS_TOKEN_MIRROR = CSS_ROOT;

export type CssToken = keyof typeof CSS_TOKEN_MIRROR;

/**
 * A shade between two opaque #rrggbb tokens (t = 0 -> a, 1 -> b). Derived shades
 * are computed from canonical tokens, never typed in, so they move with the brand.
 */
export function mixTokens(a: string, b: string, t: number): string {
  const pa = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(a);
  const pb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(b);
  if (!pa || !pb || !Number.isFinite(t) || t < 0 || t > 1) throw new Error(`mixTokens(${a}, ${b}, ${t}): needs two opaque tokens and 0..1`);
  const ch = (k: number): string => Math.round(parseInt(pa[k]!, 16) * (1 - t) + parseInt(pb[k]!, 16) * t).toString(16).padStart(2, '0');
  return `#${ch(1)}${ch(2)}${ch(3)}`.toUpperCase();
}

/** An opaque #rrggbb token at the given alpha, formatted like the app's own rgba() tokens. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error(`withAlpha(${hex}, ${alpha}): not an opaque token and a 0..1 alpha`);
  return `rgba(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)},${alpha})`;
}

export const TOKENS = {
  paper: CSS_TOKEN_MIRROR['--ww-bg'],
  surface: CSS_TOKEN_MIRROR['--ww-surface'],
  card: CSS_TOKEN_MIRROR['--ww-card-bg'],
  cardBorder: CSS_TOKEN_MIRROR['--ww-card-border'],
  hairline: CSS_TOKEN_MIRROR['--ww-inner-border'],
  ink: COLORS.brand.ink,
  inkMuted: CSS_TOKEN_MIRROR['--ww-muted-text'],
  terracotta: COLORS.brand.terracotta,
  terracottaDark: COLORS.status.riskDark,
  tan: COLORS.brand.tan,
  charcoal: CSS_TOKEN_MIRROR['--ww-charcoal'],
  deepSlate: CSS_TOKEN_MIRROR['--ww-deep-slate'],
  warmStone: CSS_TOKEN_MIRROR['--ww-warm-stone'],
  cream: CSS_TOKEN_MIRROR['--ww-cream'],
  charcoalBorder: CSS_TOKEN_MIRROR['--ww-charcoal-border'],
  charcoalRail: CSS_TOKEN_MIRROR['--ww-charcoal-rail'],
  stone: CSS_TOKEN_MIRROR['--ww-stone'],
  stoneLow: CSS_TOKEN_MIRROR['--ww-stone-low'],
  mortar: CSS_TOKEN_MIRROR['--ww-mortar'],
  brick: CSS_TOKEN_MIRROR['--ww-brick'],
  accentWash: VAULT.accentWash as (alpha: number) => string,
  inkAlpha: VAULT.ink as (alpha: number) => string,
  radiusPanel: 2,
  radiusBadge: 1,
} as const;

/**
 * Font stacks. The app's :root uses the static "Sora"/"Manrope" families; the
 * video bundle loads the variable builds of the same faces (identical design,
 * one file per family), registered under these family names.
 */
export const FONTS = {
  display: '"Sora Variable", "Sora", system-ui, sans-serif',
  ui: '"Manrope Variable", "Manrope", system-ui, sans-serif',
  mono: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
} as const;

export type FontRole = keyof typeof FONTS;
