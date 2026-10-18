// Declared versions of WalletWallaby's performance definition, recorded in
// render and provenance metadata. Each version pins the content hash of its
// definition (test/versions.test.ts), so changing a pose, palette slot, or
// motion constant without declaring a new version fails the build. Isomorphic.

import { AIRBORNE, EXPRESSIONS, POSES, RIG_PALETTE, WALLABY_HEIGHT } from './rig.ts';
import { ACTION_MS } from './choreography.ts';
import { MOTION_CONFIG } from './motion.ts';

/** v2: WalletWall terracotta coat, derived shade, claws, and motion channels. */
export const RIG = { id: 'walletwallaby-rig', version: 2 } as const;
/** v2: deterministic ballistic motion (config/motion.json); v1 was the closed-form choreography alone. */
export const MOTION = { id: 'walletwallaby-motion', version: 2 } as const;

/** Everything that defines the figure's look and posable range. */
export const rigDefinition = () => ({ poses: POSES, airborne: AIRBORNE, expressions: EXPRESSIONS, heightPx: WALLABY_HEIGHT, palette: RIG_PALETTE });

/** Motion: the choreography timing table plus the versioned physics config. */
export const motionDefinition = () => ({ model: 'ballistic-hop-with-contact-response', actionMs: ACTION_MS, config: MOTION_CONFIG });

/** version -> content address of the definition at that version. Append-only. */
export const RIG_PINS: Readonly<Record<number, string>> = {
  1: '798e7b967196970f9c12b2df2c1579e5e23a74e41c3f2dc356f4eacd13e47107',
  2: '88f1ab2eb92b8c37d638811609f1cc825cebb153c4f153e15aedcdbe9a43f855',
};
export const MOTION_PINS: Readonly<Record<number, string>> = {
  1: '4139d50ad1bc441c8f34b70fe2f1a129e013a3df76e4d3cc4c73c04a0ad56df2',
  2: '6ce427ec353f88326541fad216e3901bd4068d21bd723f116aa60c65fd8c6215',
};
