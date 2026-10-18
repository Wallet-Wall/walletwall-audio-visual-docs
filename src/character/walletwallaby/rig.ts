// WalletWallaby rig parameters: the semantic controls the renderer exposes.
//
// Performance comes from posture, head, ears, eyes, and tail balance, with a
// restrained four-state mouth. No exaggerated cartoon faces, no squash-and-
// stretch gags. Every value here is owned by WalletWall; a planner can only
// pick a pose/expression NAME from the vocabulary. Isomorphic.

import type { TOKENS } from '../../brand/tokens.ts';
import type { WallabyExpression, WallabyPose } from '../../spec/vocabulary.ts';

/** Which brand token paints each part of the figure. Names only: values live in the brand contract. */
export const RIG_PALETTE = {
  fur: 'tan',
  furFar: 'stoneLow',
  belly: 'cream',
  innerEar: 'mortar',
  ink: 'charcoal',
  tag: 'terracotta',
} as const satisfies Record<string, keyof typeof TOKENS>;

export interface PoseParams {
  /** 0..1 knee bend (anticipation, landing, perching). */
  crouch: number;
  /** Body lean in degrees, positive = toward the facing direction. */
  lean: number;
  /** Head tilt in degrees, positive = chin down toward facing. */
  headTilt: number;
  /** 0..1 forearm extended toward the gaze target (pointing). */
  reach: number;
  /** 0..1 forearm raised (open, presenting gesture). */
  lift: number;
  /** Tail angle in degrees; the tail counterbalances lean and flight. */
  tail: number;
  /** 0..1 legs tucked for flight. */
  airborne: number;
}

export const POSES: Readonly<Record<WallabyPose, PoseParams>> = {
  NEUTRAL: { crouch: 0.08, lean: 0, headTilt: 0, reach: 0, lift: 0, tail: 0, airborne: 0 },
  TEACH: { crouch: 0.06, lean: 3, headTilt: -3, reach: 0.35, lift: 0.25, tail: 4, airborne: 0 },
  POINT: { crouch: 0.05, lean: 6, headTilt: -2, reach: 1, lift: 0.15, tail: 7, airborne: 0 },
  INSPECT: { crouch: 0.25, lean: 13, headTilt: 11, reach: 0.15, lift: 0, tail: 11, airborne: 0 },
  PERCH: { crouch: 0.4, lean: -2, headTilt: 1, reach: 0, lift: 0, tail: -6, airborne: 0 },
  PREPARE_JUMP: { crouch: 1, lean: 11, headTilt: -5, reach: 0, lift: 0, tail: 18, airborne: 0 },
  LAND: { crouch: 0.65, lean: 6, headTilt: 5, reach: 0, lift: 0.1, tail: -12, airborne: 0 },
  TAKEAWAY: { crouch: 0.05, lean: -3, headTilt: -4, reach: 0.45, lift: 0.45, tail: 2, airborne: 0 },
  CTA: { crouch: 0.04, lean: 0, headTilt: -5, reach: 0.25, lift: 0.85, tail: 4, airborne: 0 },
};

/** Flight is a transient state, not a vocabulary pose. */
export const AIRBORNE: PoseParams = { crouch: 0.15, lean: 5, headTilt: -4, reach: 0, lift: 0.05, tail: 24, airborne: 1 };

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

export const blendPose = (a: PoseParams, b: PoseParams, t: number): PoseParams => lerpRecord(a, b, t);
export const blendExpression = (a: ExpressionParams, b: ExpressionParams, t: number): ExpressionParams => lerpRecord(a, b, t);

/** Nominal standing height in px at scale 1 (ear tips to feet). */
export const WALLABY_HEIGHT = 236;
