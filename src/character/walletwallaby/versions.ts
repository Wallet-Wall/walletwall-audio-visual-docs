// Declared versions of WalletWallaby's performance definition, recorded in
// render and provenance metadata. Each version pins the content hash of its
// definition (test/versions.test.ts), so changing a pose, palette slot, rig
// part, clip, or motion constant without declaring a new version fails the
// build. The Blender character the renderer builds from the rig is pinned by
// its canonical model and materials hashes (BLENDER_CHARACTER). Isomorphic.

import { AIRBORNE, EXPRESSIONS, LAND_HARD, MANTLE, POSES, PUSH, RIG_PALETTE, TAKEOFF, TRACE, WALLABY_HEIGHT } from './rig.ts';
import { ACTION_MS } from './choreography.ts';
import { MOTION_CONFIG } from './motion.ts';
import { BONES, CLIPS, CONTROLS, IKS, REST_IK, RIG_ENVELOPE } from './rig/rig-source.ts';

/** v6: the rig contract alone (skeleton, controls, IK, clips, envelope), drawn by Blender (docs/BLENDER.md); Rive's artboard and 2D silhouette shapes are retired. v5: the belly IS the wall (a racked brick stomach, no border), a soft-massed body (convex back into a full rump, rounded haunch and calves), one-piece forelimbs that grow out of the chest, a convex muzzle over a rounded chin. v4 was the WalletWallrus sibling; v3 the athletic Rive rig; v2 the SVG terracotta figure. */
export const RIG = { id: 'walletwallaby-rig', version: 6 } as const;
/** v4: support plausibility (semantic terrain, the support judge, foothold traces, exit leaps that land out of view; config v4 adds `support`). v3 was motion intelligence; v2 ballistic motion alone. */
export const MOTION = { id: 'walletwallaby-motion', version: 4 } as const;

/** Everything that defines the figure's posable range and palette, including the whole rig contract. */
export const rigDefinition = () => ({
  poses: POSES,
  transient: { airborne: AIRBORNE, takeoff: TAKEOFF, landHard: LAND_HARD, mantle: MANTLE, push: PUSH, trace: TRACE },
  expressions: EXPRESSIONS,
  heightPx: WALLABY_HEIGHT,
  palette: RIG_PALETTE,
  rig: { envelope: RIG_ENVELOPE, bones: BONES, controls: CONTROLS, iks: IKS, restIk: REST_IK, clips: CLIPS },
});

/** Motion: the choreography timing table plus the versioned physics config. */
export const motionDefinition = () => ({ model: 'motion-intelligence-ballistic-contact-tail', actionMs: ACTION_MS, config: MOTION_CONFIG });

/** version -> content address of the definition at that version. Append-only. */
export const RIG_PINS: Readonly<Record<number, string>> = {
  1: '798e7b967196970f9c12b2df2c1579e5e23a74e41c3f2dc356f4eacd13e47107',
  2: '88f1ab2eb92b8c37d638811609f1cc825cebb153c4f153e15aedcdbe9a43f855',
  3: '81c92cf6983422b18bf646f3f5e5afde0dc07dcc1659d34a72f7ce679bb2e5c6',
  4: 'a67b355fabf7de82b3696ac4d6c515c72b7da65a4f5e78272895f85ed3cf97db',
  5: '43452464145eaf642eff376dcc0e028bf670d819b48ffc49233f27256f068ac2',
  6: '765d69dfc23f9d007305266772a64c0be2dcabbfdf8425beb947edefb9affb56',
};
export const MOTION_PINS: Readonly<Record<number, string>> = {
  1: '4139d50ad1bc441c8f34b70fe2f1a129e013a3df76e4d3cc4c73c04a0ad56df2',
  2: '6ce427ec353f88326541fad216e3901bd4068d21bd723f116aa60c65fd8c6215',
  3: 'abdfa91a6a0475197caa516a55f59a917790a2fe0dadb34c238e3b46737f871e',
  4: '78a0ee97ab0804e718f502b0b91bf7b3852bf46dd9865a1cd1ac25c37128a02f',
};

/**
 * The Blender character the production renderer draws (docs/BLENDER.md): the canonical model (quantized, ordered by
 * position, the same on every host that builds this source) and its materials, as built from blender/walletwallaby/
 * by the pinned Blender. A render refuses a built character whose hashes differ, so a change to the body or its
 * materials is declared here, deliberately, together with its model or materials version.
 *
 * Model v2: the signed-distance code in geometry.py written from its definitions (docs/LICENSING.md, "Signed-distance
 * code"). Every volume and the body mesh are the same to floating-point rounding, and two things change: each eye glint
 * loses an enclosed 8-vertex shell that the old ellipsoid left at the exact centre its grid lands on (it read zero, not
 * negative, there; no frame shows it), and on eight chin grid points that lie exactly on its surface the tie between
 * inside and outside breaks the other way, so some chin vertices settle up to 0.083 px apart (three review stills
 * differ by a few pixels at the chin). Windows and Linux builds give this same canonical model. v1 was f8124e59.
 */
export const BLENDER_CHARACTER = {
  modelVersion: 2,
  modelSha256: '2c92f3c32aa06f35ec6153010e6a8a5985a0a6f585a50a3119cbf655468797e1',
  materialsVersion: 2,
  materialsSha256: 'de8c55f5725372035b3358311fe07d9096d60e8ca6cefbc9281e51222f421db3',
} as const;
