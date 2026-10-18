// Declared versions of WalletWallaby's performance definition, recorded in
// render and provenance metadata. Each version pins the content hash of its
// definition (test/versions.test.ts), so changing a pose, palette slot, or
// motion constant without declaring a new version fails the build. Isomorphic.

import { AIRBORNE, EXPRESSIONS, POSES, RIG_PALETTE, WALLABY_HEIGHT } from './rig.ts';
import { ACTION_MS } from './choreography.ts';

export const RIG = { id: 'walletwallaby-rig', version: 1 } as const;
export const MOTION = { id: 'walletwallaby-motion', version: 1 } as const;

/** Everything that defines the figure's look and posable range. */
export const rigDefinition = () => ({ poses: POSES, airborne: AIRBORNE, expressions: EXPRESSIONS, heightPx: WALLABY_HEIGHT, palette: RIG_PALETTE });

/** v1 motion: the closed-form choreography; its timing table is the hashed definition. */
export const motionDefinition = () => ({ model: 'closed-form-choreography', actionMs: ACTION_MS });

/** version -> content address of the definition at that version. Append-only. */
export const RIG_PINS: Readonly<Record<number, string>> = {
  1: '798e7b967196970f9c12b2df2c1579e5e23a74e41c3f2dc356f4eacd13e47107',
};
export const MOTION_PINS: Readonly<Record<number, string>> = {
  1: '4139d50ad1bc441c8f34b70fe2f1a129e013a3df76e4d3cc4c73c04a0ad56df2',
};
