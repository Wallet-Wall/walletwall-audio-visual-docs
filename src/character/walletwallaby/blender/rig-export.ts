// What the Blender character build needs from the rig contract: the skeleton,
// the IK chains and their bend directions, the rest pose's planted toe, the
// tail's rest line, the envelope the drawn body must stay inside, and the
// palette resolved from the brand contract (the coat is WalletWallrus's own,
// FAMILY_COLORS). One skeleton drives both renderers, so the same resolved pose
// (./pose-resolve.ts) means the same body on either.
//
// The 3D body's own shape (volumes, depth, the brick belly's relief, the
// outline) is presentation and lives in blender/walletwallaby/*.py; it is built
// around this skeleton and never changes it. Isomorphic.

import { mixTokens } from '../../../brand/tokens.ts';
import { WALLABY_HEIGHT } from '../rig.ts';
import { slotColor, type RigModel } from '../rive/rig-compile.ts';
import type { Vec } from '../rive/rig-math.ts';
import { BONES, IKS, RIG_ENVELOPE, TAIL_BONES, TAIL_REST, TOE_PLANT, type IkGroup, type RigBone } from '../rive/rig-source.ts';
import { UNITS_PER_PX } from './bridge.ts';

export const BLENDER_RIG_SCHEMA = 'walletwall.blender-rig/v1';

/** Which side of the body a bone belongs to: the near side faces the camera (Blender -Y), the far side away. */
export type BoneSide = 'center' | 'near' | 'far';
const sideOf = (name: RigBone): BoneSide => (name.endsWith('_n') ? 'near' : name.endsWith('_f') ? 'far' : 'center');

export interface BlenderRigDocument {
  schema: typeof BLENDER_RIG_SCHEMA;
  unitsPerPx: number;
  heightPx: number;
  bones: { name: RigBone; parent: RigBone | 'root'; connected: boolean; side: BoneSide; head: Vec; tail: Vec; restRotation: number; length: number }[];
  /** Face control rest values, in the head bone's own space (the bridge's pose.gaze and pose.brow are in it too). */
  face: { gaze: Vec; browRotation: number };
  iks: { name: string; tip: RigBone; chain: number; target: string; invert: boolean; group: IkGroup }[];
  toePlant: Vec;
  tail: { bones: readonly RigBone[]; rest: readonly Vec[] };
  envelope: typeof RIG_ENVELOPE;
  /** Opaque sRGB colours, resolved from the brand contract and the mascot family. */
  palette: { coat: string; coatShade: string; cream: string; creamShade: string; ink: string };
}

export function blenderRigDocument(model: RigModel): BlenderRigDocument {
  const ink = slotColor('ink');
  const cream = slotColor('accent');
  return {
    schema: BLENDER_RIG_SCHEMA,
    unitsPerPx: UNITS_PER_PX,
    heightPx: WALLABY_HEIGHT,
    bones: BONES.map((b) => ({
      name: b.name,
      parent: b.parent,
      connected: !b.root,
      side: sideOf(b.name),
      head: [b.from[0], b.from[1]],
      tail: [b.to[0], b.to[1]],
      restRotation: model.bones[b.name].restRotation,
      length: model.bones[b.name].length,
    })),
    face: { gaze: [model.controls.gaze.restX, model.controls.gaze.restY], browRotation: model.controls.brow.restRotation },
    iks: IKS.map((k) => ({ name: k.name, tip: k.tip, chain: k.parentBones + 1, target: k.target, invert: k.invert, group: k.group })),
    toePlant: [TOE_PLANT[0], TOE_PLANT[1]],
    tail: { bones: TAIL_BONES, rest: TAIL_REST.map((p): Vec => [p[0], p[1]]) },
    envelope: RIG_ENVELOPE,
    // The shades are derived (20% toward charcoal, as the rig's own far-side shade), never typed.
    palette: { coat: slotColor('fur'), coatShade: slotColor('furShade'), cream, creamShade: mixTokens(cream, ink, 0.2), ink },
  };
}
