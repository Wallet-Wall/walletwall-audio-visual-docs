// Compile WalletWallaby's rig source (./rig-source.ts) into the rest-pose model the pose resolver
// (../blender/pose-resolve.ts), the Blender rig export, and the tests share.
//
// The compiler does what a rigger does, deterministically: it derives each bone's local transform from its
// authored joints, places the control nodes, checks the IK chains, resolves paint slots to brand tokens, and turns
// every pose clip into absolute values over the same property set. Same source, same model. Isomorphic.

import { mixTokens, TOKENS } from '../../../brand/tokens.ts';
import { FAMILY_COLORS, RIG_PALETTE, type ColorToken, type RigColor } from '../rig.ts';
import { angleOf, apply, DEG, invert, local, mul, sub, type Mat2D, type Vec } from './rig-math.ts';
import { BONES, CLIPS, CONTROLS, IKS, REST_IK, RIG_BONES, RIG_CLIPS, RIG_CONTROLS, RIG_IKS, type IkGroup, type PaintSlot, type PoseSpec, type RigBone, type RigClip, type RigControl, type RigIk } from './rig-source.ts';

/** Rest state of one bone (radians, rig px). */
export interface BoneModel {
  parent: RigBone | 'root';
  root: boolean;
  /** Position in the parent's space (root bones only; a chained bone sits at its parent's tip). */
  restX: number;
  restY: number;
  restRotation: number;
  length: number;
  /** World transform at rest, in rig space (feet at the origin). */
  restWorld: Mat2D;
}

export interface ControlModel {
  parent: RigBone | 'root';
  restX: number;
  restY: number;
  restRotation: number;
  restScaleY: number;
  restWorld: Mat2D;
}

export interface RigModel {
  bones: Record<RigBone, BoneModel>;
  controls: Record<RigControl, ControlModel>;
  /** IK chains: constrained tip bone, strength group, and the control node they reach for. */
  iks: Record<RigIk, { tip: RigBone; group: IkGroup; target: RigControl }>;
  /** Each clip's duration, whether it loops, and the IK strengths it keys per group. */
  clips: Record<RigClip, { durationS: number; loop: boolean; control: boolean; ik: Partial<Record<IkGroup, number>> }>;
}

export class RigCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigCompileError';
  }
}

const FPS = 60;
const near = (a: Vec, b: Vec): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const finiteVec = (v: Vec, what: string): Vec => {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new RigCompileError(`${what} is not finite`);
  return v;
};

/** A rig colour name -> opaque #RRGGBB: the mascot family's coat, or a brand token. */
const rigColor = (name: RigColor): string => (name in FAMILY_COLORS ? FAMILY_COLORS[name as keyof typeof FAMILY_COLORS] : TOKENS[name as ColorToken]);

/** Paint slot -> opaque #RRGGBB (the shade is derived, never typed). */
export function slotColor(slot: PaintSlot): string {
  const entry = RIG_PALETTE[slot];
  return typeof entry === 'string' ? rigColor(entry) : mixTokens(rigColor(entry.from), rigColor(entry.to), entry.t);
}

function buildSkeleton(): { bones: Record<RigBone, BoneModel>; controls: Record<RigControl, ControlModel> } {
  const bones = {} as Record<RigBone, BoneModel>;
  const worldOf = (name: RigBone | 'root'): Mat2D => {
    if (name === 'root') return [1, 0, 0, 1, 0, 0];
    const b = bones[name];
    if (!b) throw new RigCompileError(`bone ${name} is used before it is defined`);
    return b.restWorld;
  };
  const seen = new Set<string>();
  for (const spec of BONES) {
    if (seen.has(spec.name)) throw new RigCompileError(`bone ${spec.name} defined twice`);
    seen.add(spec.name);
    finiteVec(spec.from, `${spec.name}.from`);
    finiteVec(spec.to, `${spec.name}.to`);
    const dir = sub(spec.to, spec.from);
    const length = Math.hypot(dir[0], dir[1]);
    if (!(length > 0.5)) throw new RigCompileError(`bone ${spec.name} is degenerate`);
    const parentWorld = worldOf(spec.parent);
    const rotation = Math.atan2(dir[1], dir[0]) - angleOf(parentWorld);
    let restX = 0;
    let restY = 0;
    if (spec.root) {
      [restX, restY] = apply(invert(parentWorld), spec.from);
    } else {
      if (spec.parent === 'root') throw new RigCompileError(`chained bone ${spec.name} needs a parent bone`);
      const parent = BONES.find((b) => b.name === spec.parent)!;
      if (!near(parent.to, spec.from)) throw new RigCompileError(`bone ${spec.name} must start at the tip of ${spec.parent}`);
      restX = bones[spec.parent].length;
    }
    bones[spec.name] = { parent: spec.parent, root: spec.root, restX, restY, restRotation: rotation, length, restWorld: mul(parentWorld, local(restX, restY, rotation)) };
  }
  for (const name of RIG_BONES) if (!bones[name]) throw new RigCompileError(`contract bone ${name} is missing`);

  const controls = {} as Record<RigControl, ControlModel>;
  for (const spec of CONTROLS) {
    if (controls[spec.name]) throw new RigCompileError(`control ${spec.name} defined twice`);
    const parentWorld = worldOf(spec.parent);
    const [restX, restY] = spec.parent === 'root' ? spec.at : apply(invert(parentWorld), spec.at);
    // Face controls are rig-aligned at rest; IK carriers store their value directly.
    const restRotation = spec.parent === 'root' ? spec.rotation : spec.rotation - angleOf(parentWorld);
    const restScaleY = spec.name === 'lid' ? 0 : 1;
    controls[spec.name] = { parent: spec.parent, restX, restY, restRotation, restScaleY, restWorld: mul(parentWorld, local(restX, restY, restRotation, 1, restScaleY || 1)) };
  }
  for (const name of RIG_CONTROLS) if (!controls[name]) throw new RigCompileError(`contract control ${name} is missing`);
  return { bones, controls };
}

export interface PoseValues {
  bones: Record<RigBone, number>;
  hipX: number;
  hipY: number;
  ik: Record<IkGroup, number>;
  stance: number;
  heel: number;
}

/** Absolute values a pose sets on every pose property (rest + deltas). */
export function poseValues(pose: PoseSpec, bones: Record<RigBone, BoneModel>, controls: Record<RigControl, ControlModel>): PoseValues {
  const out = {} as Record<RigBone, number>;
  for (const name of RIG_BONES) {
    const delta = pose.bones?.[name] ?? 0;
    if (!Number.isFinite(delta)) throw new RigCompileError(`pose delta for ${name} is not finite`);
    out[name] = bones[name].restRotation + delta * DEG;
  }
  for (const k of Object.keys(pose.bones ?? {})) if (!(RIG_BONES as readonly string[]).includes(k)) throw new RigCompileError(`pose names unknown bone ${k}`);
  const heel = pose.ik?.heelDeg;
  const arms = pose.ik?.arms ?? REST_IK.arms;
  // Both forelimbs follow `arms` in a pose; the near one's group also answers the point_near control clip.
  const ik = { legs: pose.ik?.legs ?? REST_IK.legs, arms, tail: pose.ik?.tail ?? REST_IK.tail, pointNear: arms };
  for (const [g, v] of Object.entries(ik)) if (!(v >= 0 && v <= 1)) throw new RigCompileError(`IK strength ${g}=${v} is outside [0, 1]`);
  return {
    bones: out,
    hipX: bones.hip.restX + (pose.hip?.dx ?? 0),
    hipY: bones.hip.restY + (pose.hip?.dy ?? 0),
    ik,
    stance: pose.ik?.stance ?? controls.stance.restX,
    heel: heel === undefined ? controls.heel.restRotation : heel * DEG,
  };
}

export interface CompiledRig {
  model: RigModel;
}

export function compileRig(): CompiledRig {
  const { bones, controls } = buildSkeleton();
  // IK: each chain sits on its tip bone and reaches for a control node.
  const iks = {} as RigModel['iks'];
  for (const spec of IKS) {
    if (iks[spec.name]) throw new RigCompileError(`IK ${spec.name} defined twice`);
    if (!Number.isInteger(spec.parentBones) || spec.parentBones < 0) throw new RigCompileError(`IK ${spec.name}: parentBones must be a non-negative integer`);
    let bone: RigBone = spec.tip;
    for (let k = 0; k < spec.parentBones; k++) {
      const parent = bones[bone].parent;
      if (parent === 'root') throw new RigCompileError(`IK ${spec.name}: the chain above ${spec.tip} has only ${k} bones`);
      bone = parent;
    }
    iks[spec.name] = { tip: spec.tip, group: spec.group, target: spec.target };
  }
  for (const name of RIG_IKS) if (!iks[name]) throw new RigCompileError(`contract IK ${name} is missing`);

  // Clips: every pose clip sets the full pose property set, so blending them is order-stable and history-free.
  const clips = {} as RigModel['clips'];
  const clipNames = new Set<string>();
  for (const clip of CLIPS) {
    if (clipNames.has(clip.name)) throw new RigCompileError(`clip ${clip.name} defined twice`);
    clipNames.add(clip.name);
    if (clip.keys.length === 0) throw new RigCompileError(`clip ${clip.name} has no keys`);
    const frames = clip.keys.map((k) => Math.round(k.atS * FPS));
    if (frames[0] !== 0 || frames.some((f, i) => i > 0 && f <= frames[i - 1]!)) throw new RigCompileError(`clip ${clip.name}: keys must start at 0 and strictly increase`);
    const duration = Math.max(1, frames[frames.length - 1]!);
    const values = clip.keys.map((k) => poseValues(k.pose, bones, controls));
    if (clip.only) {
      // A control clip: only the named IK strengths, so mixing it moves nothing else.
      for (const strength of Object.values(clip.only.ik)) {
        if (!(strength >= 0 && strength <= 1)) throw new RigCompileError(`clip ${clip.name}: IK strength ${strength} is outside [0, 1]`);
      }
      clips[clip.name] = { durationS: duration / FPS, loop: clip.loop, control: true, ik: { ...clip.only.ik } };
      continue;
    }
    clips[clip.name] = { durationS: duration / FPS, loop: clip.loop, control: false, ik: values[0]!.ik };
  }
  for (const name of RIG_CLIPS) if (!clips[name]) throw new RigCompileError(`contract clip ${name} is missing`);
  return { model: { bones, controls, iks, clips } };
}
