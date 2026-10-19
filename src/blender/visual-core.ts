// The lane's visual constants (config/blender-visual.json), resolved from the brand
// contract's tokens and checked: nothing WalletWall authors may be white.
//
// The file names colours (a token, or a derived mix of two tokens), never types
// one. This module resolves them to opaque #RRGGBB, derives each stratum's shade,
// refuses a white-ish result, and returns plain data. Pure and isomorphic: the
// Blender toolchain merges the Blender part into the pinned config as `visual`,
// and the Remotion scenes read the `flat` part (cards, text, and the flat terrain
// formations), so the depth views and the flat scenes are one material family.

import { mixTokens, TOKENS } from '../brand/tokens.ts';
import type { RockKindParams } from '../layout/rock.ts';

export type { RockKindParams };

export const BLENDER_VISUAL_REL = 'config/blender-visual.json';
export const BLENDER_VISUAL_SCHEMA = 'walletwall.blender-visual/v1';

export class BlenderVisualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderVisualError';
  }
}

export type ColorExpr = string | { mix: [string, string]; t: number };

export interface WhiteGuard {
  minLuma: number;
  maxChroma: number;
}

/** The flat scenes' share of the material rule: authored cards in warm parchment, text that keeps its contrast, and the formations under the dedicated supports. */
export interface FlatMaterial {
  /** The fill of every authored card and panel. */
  surface: string;
  text: { ink: string; muted: string; link: string };
  ground: RockKindParams & { depthPx: number };
  pillar: RockKindParams;
  ledge: RockKindParams;
  slab: { fractions: number[]; opacity: { upper: number; lower: number } };
}

/** What Blender receives as `config.visual` (minus `flat`): opaque #RRGGBB colours and plain numbers only. */
export interface BlenderVisual {
  schema: typeof BLENDER_VISUAL_SCHEMA;
  whiteGuard: WhiteGuard;
  palette: { accent: string; accentShade: string; glint: string };
  terrain: {
    depthPx: number;
    edgePx: number;
    edge: string;
    line: string;
    top: string;
    topShade: string;
    strata: {
      layers: { lit: string; shade: string }[];
      bandPx: [number, number];
      insetPx: [number, number];
      setbackPx: [number, number];
      capPx: number;
      seed: string;
    };
  };
  contactShadow: { color: string; widthPx: number; heightPx: number; centerPx: [number, number]; depthPx: number; coreAlpha: number; penumbraAlpha: number; spanFadePx: number; landingGain: number };
  flat: FlatMaterial;
}

const OPAQUE = /^#[0-9a-f]{6}$/i;

/** A brand token by name, only if it is an opaque colour. */
function token(name: string): string {
  const v = (TOKENS as Record<string, unknown>)[name];
  if (typeof v !== 'string' || !OPAQUE.test(v)) throw new BlenderVisualError(`${JSON.stringify(name)} is not an opaque brand colour token`);
  return v.toUpperCase();
}

export function resolveColor(expr: ColorExpr): string {
  if (typeof expr === 'string') return token(expr);
  if (!expr || !Array.isArray(expr.mix) || expr.mix.length !== 2 || typeof expr.t !== 'number') throw new BlenderVisualError('a colour is a token name or { mix: [a, b], t }');
  return mixTokens(token(expr.mix[0]), token(expr.mix[1]), expr.t);
}

/** sRGB luma (Rec. 601 weights on the encoded channels) and chroma (max - min), both 0..1. */
export function lumaChroma(hex: string): { luma: number; chroma: number } {
  if (!OPAQUE.test(hex)) throw new BlenderVisualError(`${hex} is not an opaque #RRGGBB colour`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return { luma: 0.299 * r + 0.587 * g + 0.114 * b, chroma: Math.max(r, g, b) - Math.min(r, g, b) };
}

export function isWhiteish(hex: string, guard: WhiteGuard): boolean {
  const { luma, chroma } = lumaChroma(hex);
  return luma >= guard.minLuma && chroma <= guard.maxChroma;
}

export interface RawVisual {
  schema: string;
  whiteGuard: WhiteGuard;
  palette: { accent: ColorExpr; accentShade: ColorExpr; glint: ColorExpr };
  terrain: {
    depthPx: number;
    edgePx: number;
    edge: ColorExpr;
    line: ColorExpr;
    top: ColorExpr;
    topShade: ColorExpr;
    strata: { layers: ColorExpr[]; shadeToward: ColorExpr; shadeAmount: number; bandPx: [number, number]; insetPx: [number, number]; setbackPx: [number, number]; capPx: number; seed: string };
  };
  contactShadow: { color: ColorExpr; widthPx: number; heightPx: number; centerPx: [number, number]; depthPx: number; coreAlpha: number; penumbraAlpha: number; spanFadePx: number; landingGain: number };
  flat: {
    surface: ColorExpr;
    text: { ink: { token: string; alpha: number }; muted: { token: string; alpha: number }; link: ColorExpr };
    ground: RockKindParams & { depthPx: number };
    pillar: RockKindParams;
    ledge: RockKindParams;
    slab: { fractions: number[]; opacity: { upper: number; lower: number } };
  };
}

/** A translucent token (`rgba(r,g,b,a)`) at another alpha: the same ink, more or less of it. */
function withTokenAlpha(name: string, alpha: number): string {
  const v = (TOKENS as Record<string, unknown>)[name];
  const m = typeof v === 'string' ? /^rgba\((\d+),(\d+),(\d+),[\d.]+\)$/.exec(v) : null;
  if (!m) throw new BlenderVisualError(`${JSON.stringify(name)} is not a translucent brand colour token`);
  return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
}

const rockKind = (v: RockKindParams | undefined, what: string): RockKindParams => {
  if (!v) throw new BlenderVisualError(`${what} is missing`);
  return {
    capPx: num(v.capPx, `${what}.capPx`, 0, 40),
    bandPx: range(v.bandPx, `${what}.bandPx`, 3, 200),
    sideJitterPx: num(v.sideJitterPx, `${what}.sideJitterPx`, 0, 6),
    taperPx: num(v.taperPx, `${what}.taperPx`, 0, 60),
    contactZonePx: num(v.contactZonePx ?? 0, `${what}.contactZonePx`, 0, 400),
    fractureMaxPx: num(v.fractureMaxPx, `${what}.fractureMaxPx`, 0, 20),
  };
};

const range = (v: unknown, what: string, lo: number, hi: number): [number, number] => {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)) || v[0] < lo || v[1] > hi || v[0] > v[1]) throw new BlenderVisualError(`${what} must be [min, max] within ${lo}..${hi}`);
  return [v[0], v[1]];
};

const num = (v: unknown, what: string, lo: number, hi: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new BlenderVisualError(`${what} must be a number within ${lo}..${hi}`);
  return v;
};

/** Resolve and validate a parsed config. Pure: the loader below only adds the file read. */
export function resolveVisual(raw: RawVisual): BlenderVisual {
  if (raw.schema !== BLENDER_VISUAL_SCHEMA) throw new BlenderVisualError(`${BLENDER_VISUAL_REL} is not ${BLENDER_VISUAL_SCHEMA}`);
  const guard: WhiteGuard = { minLuma: num(raw.whiteGuard?.minLuma, 'whiteGuard.minLuma', 0.5, 1), maxChroma: num(raw.whiteGuard?.maxChroma, 'whiteGuard.maxChroma', 0, 0.5) };
  const st = raw.terrain.strata;
  const shadeToward = resolveColor(st.shadeToward);
  const shadeAmount = num(st.shadeAmount, 'terrain.strata.shadeAmount', 0, 0.6);
  if (!Array.isArray(st.layers) || st.layers.length < 2) throw new BlenderVisualError('terrain.strata.layers needs at least two strata');
  const layers = st.layers.map((e) => {
    const lit = resolveColor(e);
    return { lit, shade: mixTokens(lit, shadeToward, shadeAmount) };
  });
  const visual: BlenderVisual = {
    schema: BLENDER_VISUAL_SCHEMA,
    whiteGuard: guard,
    palette: { accent: resolveColor(raw.palette.accent), accentShade: resolveColor(raw.palette.accentShade), glint: resolveColor(raw.palette.glint) },
    terrain: {
      depthPx: num(raw.terrain.depthPx, 'terrain.depthPx', 10, 400),
      edgePx: num(raw.terrain.edgePx, 'terrain.edgePx', 0, 10),
      edge: resolveColor(raw.terrain.edge),
      line: resolveColor(raw.terrain.line),
      top: resolveColor(raw.terrain.top),
      topShade: resolveColor(raw.terrain.topShade),
      strata: {
        layers,
        bandPx: range(st.bandPx, 'terrain.strata.bandPx', 4, 200),
        insetPx: range(st.insetPx, 'terrain.strata.insetPx', 0, 20),
        setbackPx: range(st.setbackPx, 'terrain.strata.setbackPx', 0, 40),
        capPx: num(st.capPx, 'terrain.strata.capPx', 2, 40),
        seed: typeof st.seed === 'string' && /^[a-z0-9.\-_/]{1,64}$/i.test(st.seed) ? st.seed : (() => { throw new BlenderVisualError('terrain.strata.seed must be a short plain id'); })(),
      },
    },
    contactShadow: {
      color: resolveColor(raw.contactShadow.color),
      widthPx: num(raw.contactShadow.widthPx, 'contactShadow.widthPx', 10, 400),
      heightPx: num(raw.contactShadow.heightPx, 'contactShadow.heightPx', 2, 100),
      centerPx: [num(raw.contactShadow.centerPx?.[0], 'contactShadow.centerPx[0]', -200, 200), num(raw.contactShadow.centerPx?.[1], 'contactShadow.centerPx[1]', -50, 100)],
      depthPx: num(raw.contactShadow.depthPx, 'contactShadow.depthPx', 0, 400),
      coreAlpha: num(raw.contactShadow.coreAlpha, 'contactShadow.coreAlpha', 0, 1),
      penumbraAlpha: num(raw.contactShadow.penumbraAlpha, 'contactShadow.penumbraAlpha', 0, 1),
      spanFadePx: num(raw.contactShadow.spanFadePx, 'contactShadow.spanFadePx', 0, 80),
      landingGain: num(raw.contactShadow.landingGain, 'contactShadow.landingGain', 0, 2),
    },
    flat: {
      surface: resolveColor(raw.flat.surface),
      text: {
        ink: withTokenAlpha(raw.flat.text.ink.token, num(raw.flat.text.ink.alpha, 'flat.text.ink.alpha', 0.5, 1)),
        muted: withTokenAlpha(raw.flat.text.muted.token, num(raw.flat.text.muted.alpha, 'flat.text.muted.alpha', 0.3, 1)),
        link: resolveColor(raw.flat.text.link),
      },
      ground: { ...rockKind(raw.flat.ground, 'flat.ground'), depthPx: num(raw.flat.ground.depthPx, 'flat.ground.depthPx', 8, 60) },
      pillar: rockKind(raw.flat.pillar, 'flat.pillar'),
      ledge: rockKind(raw.flat.ledge, 'flat.ledge'),
      slab: {
        fractions: raw.flat.slab.fractions.map((f, i) => num(f, `flat.slab.fractions[${i}]`, 0.05, 0.95)),
        opacity: { upper: num(raw.flat.slab.opacity.upper, 'flat.slab.opacity.upper', 0.05, 1), lower: num(raw.flat.slab.opacity.lower, 'flat.slab.opacity.lower', 0.05, 1) },
      },
    },
  };
  // Nothing the lane draws is white: every resolved colour passes the guard (the edge and the route line are dark by
  // construction; the guard still names them if a token ever changes).
  const drawn: [string, string][] = [
    ['palette.accent', visual.palette.accent],
    ['palette.accentShade', visual.palette.accentShade],
    ['palette.glint', visual.palette.glint],
    ['terrain.edge', visual.terrain.edge],
    ['terrain.line', visual.terrain.line],
    ['terrain.top', visual.terrain.top],
    ['terrain.topShade', visual.terrain.topShade],
    ['contactShadow.color', visual.contactShadow.color],
    ['flat.surface', visual.flat.surface],
    ['flat.text.link', visual.flat.text.link],
    ...visual.terrain.strata.layers.flatMap((l, i): [string, string][] => [[`terrain.strata.layers[${i}].lit`, l.lit], [`terrain.strata.layers[${i}].shade`, l.shade]]),
  ];
  for (const [what, hex] of drawn) if (isWhiteish(hex, guard)) throw new BlenderVisualError(`${what} (${hex}) is white-ish: the lane's palette has no white`);
  return visual;
}
