// WalletWallaby rig parameters: the semantic controls the renderer exposes.
//
// Rig v3 performs through a Rive rig (./rive/): a vocabulary pose is a blend of
// the rig's pose clips plus a few continuous parameters, and expressions drive
// the ears, lid, and brow. No exaggerated cartoon faces, no squash-and-stretch
// gags. Every value here is owned by WalletWall; a planner can only pick a
// pose/expression NAME from the vocabulary. Isomorphic.

import type { TOKENS } from '../../brand/tokens.ts';
import type { WallabyExpression, WallabyPose } from '../../spec/vocabulary.ts';
import type { PoseClip } from './rig/rig-source.ts';

/**
 * WalletWallrus's coat, reused as WalletWallaby's so the two read as one family: the colour of the largest
 * area of the walrus's coat in its avatar (#BA6F38, measured from the image, not picked by eye). The docs
 * theme does not define it (the theme's terracotta is redder), so the mascot family keeps it here.
 */
export const FAMILY_COLORS = { wallrusCoat: '#BA6F38' } as const;

/** The brand tokens that are colours (not radii or alpha helpers). */
export type ColorToken = { [K in keyof typeof TOKENS]: (typeof TOKENS)[K] extends string ? K : never }[keyof typeof TOKENS];

/** A colour the rig may paint: a brand colour token, or the mascot family's own coat. */
export type RigColor = ColorToken | keyof typeof FAMILY_COLORS;

/**
 * Which colour paints each part of the figure. Names only: values live in the
 * brand contract (and, for the coat, in FAMILY_COLORS). WalletWallaby shares
 * WalletWallrus's three-colour grammar: the coat (body, tail, outer ears, and
 * the bricks of the belly) is WalletWallrus's own coat; the cream accents are on
 * the face (muzzle, chin, eye glint) and the inner ear; outline, mortar, eyes,
 * nose, and claws are charcoal. The far-side shade is the coat darkened toward
 * charcoal, derived, never typed in. Flat colour: no highlights.
 */
export const RIG_PALETTE = {
  fur: 'wallrusCoat',
  furShade: { from: 'wallrusCoat', to: 'charcoal', t: 0.2 },
  accent: 'cream',
  innerEar: 'cream',
  ink: 'charcoal',
} as const satisfies Record<string, RigColor | { from: RigColor; to: RigColor; t: number }>;

/** Weights over the rig's pose clips. Non-negative; a resolved pose sums to 1. */
export type ClipMix = Readonly<Partial<Record<PoseClip, number>>>;

export interface PoseParams {
  /** The body's key pose, as a blend of Rive pose clips. */
  mix: ClipMix;
  /** 0..1 extra compression from contact responses (the hips drop, the knees take it). */
  crouch: number;
  /** Head tilt in degrees, positive = chin down toward facing. */
  headTilt: number;
  /** 0..1 forearm extended toward the gaze target (pointing). */
  reach: number;
  /** 0..1 forearm raised (open, presenting gesture). */
  lift: number;
}

export const POSES: Readonly<Record<WallabyPose, PoseParams>> = {
  NEUTRAL: { mix: { idle_alert: 1 }, crouch: 0, headTilt: 0, reach: 0, lift: 0 },
  TEACH: { mix: { idle_alert: 0.55, resolve: 0.45 }, crouch: 0, headTilt: -2, reach: 0.3, lift: 0.2 },
  POINT: { mix: { idle_alert: 0.7, resolve: 0.3 }, crouch: 0, headTilt: -2, reach: 1, lift: 0.1 },
  INSPECT: { mix: { inspect: 1 }, crouch: 0, headTilt: 3, reach: 0.15, lift: 0 },
  PERCH: { mix: { perch: 1 }, crouch: 0, headTilt: 1, reach: 0, lift: 0 },
  PREPARE_JUMP: { mix: { crouch_preload: 1 }, crouch: 0, headTilt: -4, reach: 0, lift: 0 },
  LAND: { mix: { land_soft: 1 }, crouch: 0, headTilt: 3, reach: 0, lift: 0 },
  TAKEAWAY: { mix: { resolve: 1 }, crouch: 0, headTilt: -3, reach: 0.4, lift: 0.4 },
  CTA: { mix: { resolve: 1 }, crouch: 0, headTilt: -4, reach: 0.2, lift: 0.8 },
};

/** Flight is a transient state, not a vocabulary pose. */
export const AIRBORNE: PoseParams = { mix: { airborne: 1 }, crouch: 0, headTilt: -3, reach: 0, lift: 0 };
/** Takeoff extension and the two landing weights are transient too. */
export const TAKEOFF: PoseParams = { mix: { takeoff: 1 }, crouch: 0, headTilt: -4, reach: 0, lift: 0 };
export const LAND_HARD: PoseParams = { mix: { land_hard: 1 }, crouch: 0, headTilt: 4, reach: 0, lift: 0 };
export const MANTLE: PoseParams = { mix: { mantle: 1 }, crouch: 0, headTilt: -6, reach: 0, lift: 0 };
export const PUSH: PoseParams = { mix: { push: 1 }, crouch: 0, headTilt: -2, reach: 0, lift: 0 };
export const TRACE: PoseParams = { mix: { trace: 1 }, crouch: 0, headTilt: -2, reach: 0, lift: 0 };

export interface ExpressionParams {
  /** Ear spread outward, degrees. */
  earSpread: number;
  /** Ear rotation forward (+) or back (-), degrees. */
  earPerk: number;
  /** 0 open .. 1 closed upper lid. */
  lid: number;
  /** Brow angle, degrees; positive raises the inner end (curious / cautious). */
  brow: number;
  /** -1..1 mouth-corner curve. */
  smile: number;
  /** 0..1 left/right asymmetry (skepticism lives here, quietly). */
  asym: number;
}

export const EXPRESSIONS: Readonly<Record<WallabyExpression, ExpressionParams>> = {
  NEUTRAL: { earSpread: 6, earPerk: 0, lid: 0.12, brow: 0, smile: 0.1, asym: 0 },
  CURIOUS: { earSpread: 2, earPerk: 9, lid: 0, brow: 7, smile: 0.15, asym: 0 },
  FOCUSED: { earSpread: 3, earPerk: 11, lid: 0.3, brow: -5, smile: 0, asym: 0 },
  SKEPTICAL: { earSpread: 9, earPerk: 2, lid: 0.32, brow: -3, smile: -0.08, asym: 1 },
  CAUTIOUS: { earSpread: 15, earPerk: -10, lid: 0.18, brow: 6, smile: -0.12, asym: 0 },
  SATISFIED: { earSpread: 8, earPerk: 3, lid: 0.42, brow: 2, smile: 0.38, asym: 0 },
};

export type Viseme = 'REST' | 'CLOSED' | 'SMALL' | 'OPEN';

function lerpRecord<T extends object>(a: T, b: T, t: number): T {
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof T)[]) {
    (out[k] as number) = (a[k] as number) + ((b[k] as number) - (a[k] as number)) * t;
  }
  return out;
}

/** Blend two clip mixes; the result keeps only positive weights, in a stable key order. */
export function blendMix(a: ClipMix, b: ClipMix, t: number): ClipMix {
  const out: Partial<Record<PoseClip, number>> = {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort() as PoseClip[];
  for (const k of keys) {
    const v = (a[k] ?? 0) * (1 - t) + (b[k] ?? 0) * t;
    if (v > 1e-9) out[k] = v;
  }
  return out;
}

export const blendPose = (a: PoseParams, b: PoseParams, t: number): PoseParams => ({
  mix: blendMix(a.mix, b.mix, t),
  crouch: a.crouch + (b.crouch - a.crouch) * t,
  headTilt: a.headTilt + (b.headTilt - a.headTilt) * t,
  reach: a.reach + (b.reach - a.reach) * t,
  lift: a.lift + (b.lift - a.lift) * t,
});
export const blendExpression = (a: ExpressionParams, b: ExpressionParams, t: number): ExpressionParams => lerpRecord(a, b, t);

/** Nominal standing height in px at scale 1 (ear tips to feet); the unit of the motion physics. */
export const WALLABY_HEIGHT = 236;
