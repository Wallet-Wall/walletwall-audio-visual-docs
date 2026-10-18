// Declared versions of WalletWallaby's performance definition, recorded in
// render and provenance metadata. Each version pins the content hash of its
// definition (test/versions.test.ts), so changing a pose, palette slot, rig
// part, clip, or motion constant without declaring a new version fails the
// build. The compiled Rive asset and the Rive runtime are pinned by the sha256
// of their bytes. Isomorphic.

import { AIRBORNE, EXPRESSIONS, LAND_HARD, MANTLE, POSES, PUSH, RIG_PALETTE, TAKEOFF, TRACE, WALLABY_HEIGHT } from './rig.ts';
import { ACTION_MS } from './choreography.ts';
import { MOTION_CONFIG } from './motion.ts';
import { ARTBOARD, BONES, CLIPS, CONTROLS, IKS, REST_IK, RIG_ENVELOPE, RIG_ORIGIN, SHAPES } from './rive/rig-source.ts';

/** v5: the belly IS the wall (a racked brick stomach, no border), a fuller torso, one-piece forelimbs that grow out of the chest, a convex muzzle, a fuller tail root. v4 was the WalletWallrus sibling; v3 the athletic Rive rig; v2 the SVG terracotta figure. */
export const RIG = { id: 'walletwallaby-rig', version: 5 } as const;
/** v4: support plausibility (semantic terrain, the support judge, foothold traces, exit leaps that land out of view; config v4 adds `support`). v3 was motion intelligence; v2 ballistic motion alone. */
export const MOTION = { id: 'walletwallaby-motion', version: 4 } as const;

/** Everything that defines the figure's look and posable range, including the whole rig source. */
export const rigDefinition = () => ({
  poses: POSES,
  transient: { airborne: AIRBORNE, takeoff: TAKEOFF, landHard: LAND_HARD, mantle: MANTLE, push: PUSH, trace: TRACE },
  expressions: EXPRESSIONS,
  heightPx: WALLABY_HEIGHT,
  palette: RIG_PALETTE,
  rive: { artboard: ARTBOARD, origin: RIG_ORIGIN, envelope: RIG_ENVELOPE, bones: BONES, controls: CONTROLS, iks: IKS, restIk: REST_IK, shapes: SHAPES, clips: CLIPS },
});

/** Motion: the choreography timing table plus the versioned physics config. */
export const motionDefinition = () => ({ model: 'motion-intelligence-ballistic-contact-tail', actionMs: ACTION_MS, config: MOTION_CONFIG });

/** version -> content address of the definition at that version. Append-only. */
export const RIG_PINS: Readonly<Record<number, string>> = {
  1: '798e7b967196970f9c12b2df2c1579e5e23a74e41c3f2dc356f4eacd13e47107',
  2: '88f1ab2eb92b8c37d638811609f1cc825cebb153c4f153e15aedcdbe9a43f855',
  3: '81c92cf6983422b18bf646f3f5e5afde0dc07dcc1659d34a72f7ce679bb2e5c6',
  4: 'a67b355fabf7de82b3696ac4d6c515c72b7da65a4f5e78272895f85ed3cf97db',
  5: '349151da6458b9ed3731b1a0463e26ccc64e241626451fd038f09b0753fa046a',
};
export const MOTION_PINS: Readonly<Record<number, string>> = {
  1: '4139d50ad1bc441c8f34b70fe2f1a129e013a3df76e4d3cc4c73c04a0ad56df2',
  2: '6ce427ec353f88326541fad216e3901bd4068d21bd723f116aa60c65fd8c6215',
  3: 'abdfa91a6a0475197caa516a55f59a917790a2fe0dadb34c238e3b46737f871e',
  4: '78a0ee97ab0804e718f502b0b91bf7b3852bf46dd9865a1cd1ac25c37128a02f',
};

/**
 * The compiled rig: where it lives in this repository, where the render bundle
 * serves it from, and the sha256 of its bytes (`npm run rive:build` prints it).
 * The renderer refuses any other bytes.
 */
export const RIVE_ASSET = { path: 'assets/character/walletwallaby.riv', public: 'renderer/walletwallaby.riv', rigVersion: RIG.version, sha256: '5bedc4d355f96da0636656fbd6fda4bf871fc1aac55a932f0f88adba1f9379ac' } as const;

/** The Rive runtime the renderer drives (the version @remotion/rive pins) and the sha256 of the WASM it loads. */
export const RIVE_RUNTIME = { package: '@rive-app/canvas-advanced', version: '2.31.5', wasm: 'rive.wasm', public: 'renderer/rive.wasm', wasmSha256: '0586b74359591e953df23b27e5d084540aa618dfcc08662beed9196109f0aa87' } as const;
