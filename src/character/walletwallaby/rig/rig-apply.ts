// Frame-pure posing of WalletWallaby's rig: what a frame's pose is before Blender's IK solves it.
//
// The pose resolver (../blender/pose-resolve.ts) blends the frame's pose clips from values derived from the
// frame alone; finalizePose then adds the continuous controls (pitch, spine, head, ears, tail curl, face), places
// every IK target (planted feet on the rig's ground point, paws on a ledge lip, the tail tip on the surface or
// released past an edge, a pointing paw), and refuses anything outside the hard limits. No state, no clock: the
// same frame always produces the same pose. Blender's IK (blender/walletwallaby/controls.py) then reaches for
// exactly these targets. Isomorphic.

import type { RigControls } from './rig-controls.ts';
import type { RigModel } from './rig-compile.ts';
import { DEG, apply, local, mul, sub, wrap, type Mat2D, type Vec } from './rig-math.ts';
import { POSE_CLIPS, RIG_BONES, RIG_CLIPS, RIG_CONTROLS, TAIL_BONES, TOE_PLANT, type RigBone, type RigClip, type RigControl } from './rig-source.ts';

export type TargetControl = Extract<RigControl, `target_${string}`>;
export const TARGETS = RIG_CONTROLS.filter((c): c is TargetControl => c.startsWith('target_'));

/** Every value the solver reads or writes for one frame. */
export interface PoseState {
  rot: Record<RigBone, number>;
  hipX: number;
  hipY: number;
  /** Clip-keyed carriers: far-foot offset, planted foot angle. */
  stance: number;
  heel: number;
  gazeX: number;
  gazeY: number;
  lid: number;
  brow: number;
  /** Where each IK constraint reaches, in rig space. */
  targets: Record<TargetControl, Vec>;
}

export class RigPoseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigPoseError';
  }
}

/** Hard limits on the continuous controls, in degrees or rig px. Anything outside is refused, not clamped. */
export const CONTROL_LIMITS = {
  pitchDeg: 40,
  hipShift: 40,
  spineDeg: 30,
  headDeg: 40,
  earDeg: 45,
  tailDeg: 70,
  armDeg: 120,
  jawDeg: 16,
  browDeg: 25,
  gaze: 3,
  /** IK targets stay within this distance of the feet (rig px): no reaching across the frame. */
  reach: 400,
} as const;

/** The tail tip's half thickness: its ground target sits this far above the surface line. */
export const TAIL_GROUND = -1.6;

// ── Forward kinematics (rig space, before Rive's IK) ────────────────────────

/** World transforms of every bone for a pose, exactly as the runtime composes them before constraints (T·R·S, parent first). */
export function boneWorlds(model: RigModel, s: Pick<PoseState, 'rot' | 'hipX' | 'hipY'>): Record<RigBone, Mat2D> {
  const out = {} as Record<RigBone, Mat2D>;
  for (const name of RIG_BONES) {
    const b = model.bones[name];
    const parent: Mat2D = b.parent === 'root' ? [1, 0, 0, 1, 0, 0] : out[b.parent];
    const x = name === 'hip' ? s.hipX : b.root ? b.restX : model.bones[b.parent as RigBone].length;
    const y = name === 'hip' ? s.hipY : b.root ? b.restY : 0;
    out[name] = mul(parent, local(x, y, s.rot[name]));
  }
  return out;
}

/** World transforms of the control nodes (the face nodes carry geometry), given bone transforms. */
export function controlWorlds(model: RigModel, s: Pick<PoseState, 'gazeX' | 'gazeY' | 'lid' | 'brow'>, bones: Record<RigBone, Mat2D>): Record<RigControl, Mat2D> {
  const out = {} as Record<RigControl, Mat2D>;
  for (const name of RIG_CONTROLS) {
    const c = model.controls[name];
    const parent: Mat2D = c.parent === 'root' ? [1, 0, 0, 1, 0, 0] : bones[c.parent];
    const x = name === 'gaze' ? s.gazeX : c.restX;
    const y = name === 'gaze' ? s.gazeY : c.restY;
    const rot = name === 'brow' ? s.brow : c.restRotation;
    const sy = name === 'lid' ? Math.max(1e-3, s.lid) : 1;
    out[name] = mul(parent, local(x, y, rot, 1, sy));
  }
  return out;
}

const tipOf = (m: Mat2D, length: number): Vec => apply(m, [length, 0]);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function checkFinite(s: PoseState): void {
  for (const name of RIG_BONES) if (!Number.isFinite(s.rot[name])) throw new RigPoseError(`non-finite rotation for ${name}`);
  for (const k of ['hipX', 'hipY', 'stance', 'heel', 'gazeX', 'gazeY', 'lid', 'brow'] as const) if (!Number.isFinite(s[k])) throw new RigPoseError(`non-finite ${k}`);
  for (const t of TARGETS) {
    const [x, y] = s.targets[t];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RigPoseError(`non-finite IK target ${t}`);
    if (Math.hypot(x, y) > CONTROL_LIMITS.reach) throw new RigPoseError(`IK target ${t} is ${Math.round(Math.hypot(x, y))} px from the feet`);
  }
}

function checkControls(c: RigControls): void {
  const L = CONTROL_LIMITS;
  const within = (v: number, max: number, what: string): void => {
    if (!Number.isFinite(v)) throw new RigPoseError(`${what} is not finite`);
    if (Math.abs(v) > max + 1e-9) throw new RigPoseError(`${what}=${v} exceeds ±${max}`);
  };
  within(c.body.pitchDeg, L.pitchDeg, 'body.pitchDeg');
  within(c.body.dx, L.hipShift, 'body.dx');
  within(c.body.dy, L.hipShift, 'body.dy');
  within(c.body.chestDeg, L.spineDeg, 'body.chestDeg');
  within(c.body.neckDeg, L.spineDeg, 'body.neckDeg');
  within(c.head.deg, L.headDeg, 'head.deg');
  within(c.ears.nearDeg, L.earDeg, 'ears.nearDeg');
  within(c.ears.farDeg, L.earDeg, 'ears.farDeg');
  if (c.tail.deg.length !== TAIL_BONES.length) throw new RigPoseError('tail.deg needs one value per tail bone');
  c.tail.deg.forEach((v, i) => within(v, L.tailDeg, `tail.deg[${i}]`));
  if (!(c.tail.tension >= 0 && c.tail.tension <= 1)) throw new RigPoseError(`tail.tension=${c.tail.tension} is outside [0, 1]`);
  for (const [k, v] of Object.entries(c.arms)) within(v, L.armDeg, `arms.${k}`);
  within(c.face.jawDeg, L.jawDeg, 'face.jawDeg');
  within(c.face.browDeg, L.browDeg, 'face.browDeg');
  within(c.face.gazeX, L.gaze, 'face.gazeX');
  within(c.face.gazeY, L.gaze, 'face.gazeY');
  if (!(c.face.lid >= 0 && c.face.lid <= 1)) throw new RigPoseError(`face.lid=${c.face.lid} is outside [0, 1]`);
  if (c.support !== null && !(Number.isFinite(c.support.minX) && Number.isFinite(c.support.maxX) && c.support.minX <= c.support.maxX)) throw new RigPoseError('support span is invalid');
  if (c.grip !== null) within(Math.hypot(c.grip[0], c.grip[1]), L.reach, 'grip distance');
  if (c.point !== null) {
    within(Math.hypot(c.point.target[0], c.point.target[1]), L.reach, 'point distance');
    if (!(c.point.amount >= 0 && c.point.amount <= 1)) throw new RigPoseError(`point.amount=${c.point.amount} is outside [0, 1]`);
  }
  checkClipMix(c.clips);
}

/** A pose mix must name known pose clips once each, with finite weights in [0, 1] summing to 1, and in-range clip times. */
export function checkClipMix(clips: RigControls['clips']): void {
  if (clips.length === 0) throw new RigPoseError('a pose needs at least one clip');
  const seen = new Set<string>();
  let sum = 0;
  for (const c of clips) {
    if (!(POSE_CLIPS as readonly string[]).includes(c.clip)) throw new RigPoseError(`unknown pose clip ${String(c.clip)}`);
    if (seen.has(c.clip)) throw new RigPoseError(`clip ${c.clip} appears twice`);
    seen.add(c.clip);
    if (!(c.weight >= 0 && c.weight <= 1)) throw new RigPoseError(`clip ${c.clip} weight ${c.weight} is outside [0, 1]`);
    if (!(c.timeS >= 0) || !Number.isFinite(c.timeS)) throw new RigPoseError(`clip ${c.clip} time ${c.timeS} is invalid`);
    sum += c.weight;
  }
  if (Math.abs(sum - 1) > 1e-6) throw new RigPoseError(`clip weights sum to ${sum}, not 1`);
}

/** How much surface is under a point (rig x): 1 well inside the support span, 0 well past its edge. */
export function supportAt(c: Pick<RigControls, 'grounded' | 'support'>, x: number): number {
  if (!c.grounded || c.support === null) return 0;
  return smoothstep(-6, 6, Math.min(x - c.support.minX, c.support.maxX - x));
}

/** How far below the contact line the natural tail tip may sit before the tail is swung up (Rive's IK closes the rest). */
const TAIL_DIVE = 4;

/**
 * Add the frame's continuous controls to the blended clip pose and place the IK
 * targets Rive will reach for. Pure: the same inputs give the same pose, bit for bit.
 * Returns how much to release the tail's ground IK (the `tail_free` mix): fully
 * where there is no surface under it, and where the pose holds it well clear.
 */
export function finalizePose(model: RigModel, blended: Omit<PoseState, 'targets'>, c: RigControls): { pose: PoseState; tailSupport: number; tailFree: number } {
  checkControls(c);
  const s = { ...blended, rot: { ...blended.rot } };
  s.rot.hip += c.body.pitchDeg * DEG;
  s.hipX += c.body.dx;
  s.hipY += c.body.dy;
  s.rot.chest += c.body.chestDeg * DEG;
  s.rot.neck += c.body.neckDeg * DEG;
  s.rot.head += c.head.deg * DEG;
  s.rot.ear_n += c.ears.nearDeg * DEG;
  s.rot.ear_f += c.ears.farDeg * DEG;
  s.rot.arm_n += c.arms.nearDeg * DEG;
  s.rot.forearm_n += c.arms.nearForeDeg * DEG;
  s.rot.arm_f += c.arms.farDeg * DEG;
  s.rot.forearm_f += c.arms.farForeDeg * DEG;
  s.rot.jaw = model.bones.jaw.restRotation + c.face.jawDeg * DEG;
  s.gazeX = model.controls.gaze.restX + c.face.gazeX;
  s.gazeY = model.controls.gaze.restY + c.face.gazeY;
  s.lid = c.face.lid;
  s.brow = model.controls.brow.restRotation + c.face.browDeg * DEG;

  // Tail intent: swing at the root, curl along the length, tension straightening the curl.
  TAIL_BONES.forEach((name, i) => {
    s.rot[name] += c.tail.deg[i]! * DEG;
    if (i > 0) s.rot[name] *= 1 - 0.65 * c.tail.tension;
  });

  // The tail never dives through a surface it rests on: swing it up about its root until the tip sits just at the
  // contact line, so Rive's IK only has to close a few pixels (a deep correction would fold the tip).
  const tailLen = model.bones.tail_4.length;
  let fk = boneWorlds(model, s);
  let naturalTip = tipOf(fk.tail_4, tailLen);
  const tailSupport = supportAt(c, naturalTip[0]);
  if (tailSupport > 0 && naturalTip[1] > TAIL_GROUND + TAIL_DIVE) {
    const root = apply(fk.tail_0, [0, 0]);
    const rel = sub(naturalTip, root);
    const r = Math.hypot(rel[0], rel[1]);
    const phi = Math.atan2(rel[1], rel[0]);
    const want = Math.max(-1, Math.min(1, (TAIL_GROUND + TAIL_DIVE - root[1]) / r));
    const options = [Math.asin(want) - phi, Math.PI - Math.asin(want) - phi].map(wrap);
    const delta = Math.abs(options[0]!) <= Math.abs(options[1]!) ? options[0]! : options[1]!;
    s.rot.tail_0 += Math.max(-60 * DEG, Math.min(60 * DEG, delta)) * tailSupport;
    fk = boneWorlds(model, s);
    naturalTip = tipOf(fk.tail_4, tailLen);
  }
  // The contact point is on the surface line under the tip, pulled within reach of the last two segments
  // (a nearly straight tail cannot stretch to a point past its own length).
  const joint = apply(fk.tail_3, [0, 0]);
  const reach = (model.bones.tail_3.length + tailLen) * 0.985;
  const dy = TAIL_GROUND - joint[1];
  const span = Math.sqrt(Math.max(0, reach * reach - dy * dy));
  const contactX = Math.max(joint[0] - span, Math.min(joint[0] + span, naturalTip[0]));
  // A pose that holds the tail well clear of the surface keeps it there: the contact is released, not forced.
  const lifted = smoothstep(10, 30, TAIL_GROUND - naturalTip[1]);
  const tailFree = Math.max(1 - tailSupport, lifted);

  // IK targets. Feet: toes planted at the rig's ground point, heels set back along the planted foot angle.
  const footN = model.bones.foot_n.length;
  const footF = model.bones.foot_f.length;
  const toeN: Vec = TOE_PLANT;
  const toeF: Vec = [TOE_PLANT[0] + s.stance, TOE_PLANT[1]];
  // Paws: on the grip point when there is one (a ledge lip), else the pointing target, else exactly where the arms already are.
  const pawN = c.grip ? ([c.grip[0] + 6, c.grip[1] - 4] as Vec) : c.point ? c.point.target : tipOf(fk.forearm_n, model.bones.forearm_n.length);
  const pawF = c.grip ? ([c.grip[0] + 2, c.grip[1] - 4] as Vec) : tipOf(fk.forearm_f, model.bones.forearm_f.length);
  // Tail: its ground contact point straight below (or above) where the tip would hang; Rive bends the chain to it.
  const pose: PoseState = {
    ...s,
    targets: {
      target_heel_n: [toeN[0] - footN * Math.cos(s.heel), toeN[1] - footN * Math.sin(s.heel)],
      target_toe_n: toeN,
      target_heel_f: [toeF[0] - footF * Math.cos(s.heel), toeF[1] - footF * Math.sin(s.heel)],
      target_toe_f: toeF,
      target_paw_n: pawN,
      target_paw_f: pawF,
      target_tail: [contactX, TAIL_GROUND],
    },
  };
  checkFinite(pose);
  return { pose, tailSupport, tailFree };
}
