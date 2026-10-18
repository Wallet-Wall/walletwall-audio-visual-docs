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

/** v3: a Rive rig compiled from code: athletic silhouette, skinned torso and tail, twelve key-pose clips. v2 was the SVG terracotta figure. */
export const RIG = { id: 'walletwallaby-rig', version: 3 } as const;
/** v3: motion intelligence (body action and phase, tail intent, ledge mantles, hard landings; config schema v2). v2 was ballistic motion alone. */
export const MOTION = { id: 'walletwallaby-motion', version: 3 } as const;

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
};
export const MOTION_PINS: Readonly<Record<number, string>> = {
  1: '4139d50ad1bc441c8f34b70fe2f1a129e013a3df76e4d3cc4c73c04a0ad56df2',
  2: '6ce427ec353f88326541fad216e3901bd4068d21bd723f116aa60c65fd8c6215',
  3: 'abdfa91a6a0475197caa516a55f59a917790a2fe0dadb34c238e3b46737f871e',
};

/**
 * The compiled rig: where it lives in this repository, where the render bundle
 * serves it from, and the sha256 of its bytes (`npm run rive:build` prints it).
 * The renderer refuses any other bytes.
 */
export const RIVE_ASSET = { path: 'assets/character/walletwallaby.riv', public: 'renderer/walletwallaby.riv', rigVersion: RIG.version, sha256: '969802c2b0d805245486656d0f86c7d0a4b91808835cae776fcd7857f3ad97b1' } as const;

/** The Rive runtime the renderer drives (the version @remotion/rive pins) and the sha256 of the WASM it loads. */
export const RIVE_RUNTIME = { package: '@rive-app/canvas-advanced', version: '2.31.5', wasm: 'rive.wasm', public: 'renderer/rive.wasm', wasmSha256: '0586b74359591e953df23b27e5d084540aa618dfcc08662beed9196109f0aa87' } as const;
