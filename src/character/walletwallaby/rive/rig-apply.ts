// Frame-pure posing of WalletWallaby's Rive rig.
//
// Every frame is posed on a FRESH artboard instance (withFreshPose), so no Rive
// state can survive from one frame to the next. That matters: Rive's IK writes
// the constrained bones' transforms, and a property re-set to an unchanged value
// does not invalidate them, so a long-lived instance would let the previous
// frame's solve leak into the next (measured: 527 of 591 shuffled frames
// differed on a reused instance, 0 on fresh ones).
//
// Within the instance, the frame is evaluated in a fixed order, from values
// derived from the Remotion frame alone:
//   1. the `base` clip at mix 1 resets every pose property, IK strength, IK
//      target, and face control (no history survives),
//   2. the frame's pose clips are applied in a fixed order with normalised
//      sequential mixes (Rive lerps from the current value, so this yields the
//      exact weighted average of the clips, IK strengths included),
//   3. the `tail_free` control clip is mixed in where there is no surface under
//      the tail, releasing its ground contact,
//   4. the blended pose is read back, the continuous controls are added, and the
//      IK targets are placed (finalizePose, pure TypeScript),
//   5. the result is written back and the artboard is advanced by 0 s: Rive runs
//      its IK constraints (planted feet, gripping paws, the tail's ground
//      contact), skins the outlines, and nothing moves any clock.
// No state machine, no play(), no elapsed time: the same frame always produces
// the same pose. Isomorphic.

import type { RigControls } from './rig-controls.ts';
import type { RigModel } from './rig-compile.ts';
import { DEG, apply, local, mul, sub, wrap, type Mat2D, type Vec } from './rig-math.ts';
import { POSE_CLIPS, RIG_BONES, RIG_CLIPS, RIG_CONTROLS, TAIL_BONES, TOE_PLANT, type RigBone, type RigClip, type RigControl } from './rig-source.ts';

// ── The slice of the Rive low-level runtime this module drives ──────────────

export interface RiveMat2D {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
  tx: number;
  ty: number;
}
export interface RiveTransform {
  rotation: number;
  scaleX: number;
  scaleY: number;
  worldTransform(): RiveMat2D;
}
export interface RiveNode extends RiveTransform {
  x: number;
  y: number;
}
export interface RiveAnimationInstance {
  time: number;
  apply(mix: number): void;
  readonly duration: number;
  delete?(): void;
}
export interface RiveArtboard {
  readonly name: string;
  animationByName(name: string): unknown;
  bone(name: string): RiveTransform;
  rootBone(name: string): RiveNode;
  node(name: string): RiveNode;
  advance(seconds: number): boolean;
}
export interface RiveRuntime {
  LinearAnimationInstance: new (animation: never, artboard: never) => RiveAnimationInstance;
}

// ── Pose state ──────────────────────────────────────────────────────────────

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

/** What the rig did, measured on the runtime's own transforms after solving. */
export interface PoseReport {
  /** The tail tip rests on the surface (within 4 px: the tip's own thickness plus its outline), as a support. */
  tailContact: boolean;
  /** 0..1: how much surface there is under the tail (1 = fully supported). */
  tailSupport: number;
  /** 0..1: how much the tail's ground contact was released (no surface, or the pose holds it clear). */
  tailFree: number;
  tailTip: Vec;
  feet: { near: Vec; far: Vec };
  paws: { near: Vec; far: Vec };
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

// ── Runtime binding ─────────────────────────────────────────────────────────

/** Drives one artboard instance. Construct once per loaded artboard; call pose() once per frame. */
export class RigPlayer {
  readonly model: RigModel;
  private readonly artboard: RiveArtboard;
  private readonly anims: Record<RigClip, RiveAnimationInstance>;
  private readonly bones: Record<RigBone, RiveTransform>;
  private readonly hip: RiveNode;
  private readonly ctl: Record<RigControl, RiveNode>;

  constructor(runtime: RiveRuntime, artboard: RiveArtboard, model: RigModel) {
    if (artboard.name !== model.artboard.name) throw new RigPoseError(`artboard ${artboard.name} is not ${model.artboard.name}`);
    this.model = model;
    this.artboard = artboard;
    this.anims = {} as Record<RigClip, RiveAnimationInstance>;
    for (const name of RIG_CLIPS) {
      const anim = artboard.animationByName(name);
      if (!anim) throw new RigPoseError(`the rig has no clip ${name}`);
      this.anims[name] = new runtime.LinearAnimationInstance(anim as never, artboard as never);
    }
    this.bones = {} as Record<RigBone, RiveTransform>;
    for (const name of RIG_BONES) {
      const b = artboard.bone(name);
      if (!b) throw new RigPoseError(`the rig has no bone ${name}`);
      this.bones[name] = b;
    }
    this.hip = artboard.rootBone('hip');
    this.ctl = {} as Record<RigControl, RiveNode>;
    for (const name of RIG_CONTROLS) {
      const n = artboard.node(name);
      if (!n) throw new RigPoseError(`the rig has no control ${name}`);
      this.ctl[name] = n;
    }
  }

  /** Reset, blend the clips, place the targets, write back, and let Rive solve with zero elapsed time. */
  pose(controls: RigControls): PoseReport {
    checkClipMix(controls.clips);
    this.anims.base.time = 0;
    this.anims.base.apply(1);
    // Fixed order (the contract's clip order), normalised sequential mixes: the result is the weighted average.
    let acc = 0;
    for (const name of POSE_CLIPS) {
      const entry = controls.clips.find((c) => c.clip === name);
      if (!entry || entry.weight <= 0) continue;
      acc += entry.weight;
      const anim = this.anims[name];
      const dur = this.model.clips[name].durationS;
      anim.time = this.model.clips[name].loop ? entry.timeS % dur : Math.min(entry.timeS, dur);
      anim.apply(acc <= entry.weight ? 1 : entry.weight / acc);
    }
    const { pose, tailSupport, tailFree } = finalizePose(this.model, this.read(), controls);
    // Control clips: release the tail where the surface ends or the pose holds it clear; hand the near forelimb to IK to point.
    if (tailFree > 0) {
      this.anims.tail_free.time = 0;
      this.anims.tail_free.apply(tailFree);
    }
    if (controls.point && controls.point.amount > 0 && !controls.grip) {
      this.anims.point_near.time = 0;
      this.anims.point_near.apply(controls.point.amount);
    }
    this.write(pose);
    // Two zero-time passes. In this runtime an IK constraint is not ordered after its target node, so the
    // first pass only brings the targets' world transforms up to date; re-dirtying the bones makes the
    // second pass rebuild them from their properties and solve against the current targets.
    this.artboard.advance(0);
    this.redirty();
    this.artboard.advance(0);
    const tip = (b: RigBone): Vec => tipOf(this.boneWorld(b), this.model.bones[b].length);
    const tailTip = tip('tail_4');
    return {
      tailContact: controls.grounded && tailFree < 0.5 && Math.abs(tailTip[1] - TAIL_GROUND) < 4,
      tailSupport,
      tailFree,
      tailTip,
      feet: { near: tip('foot_n'), far: tip('foot_f') },
      paws: { near: tip('forearm_n'), far: tip('forearm_f') },
    };
  }

  /** The current pose properties, read back from the runtime (targets are written, never read). */
  read(): Omit<PoseState, 'targets'> {
    const rot = {} as Record<RigBone, number>;
    for (const name of RIG_BONES) rot[name] = this.bones[name].rotation;
    return {
      rot,
      hipX: this.hip.x,
      hipY: this.hip.y,
      stance: this.ctl.stance.x,
      heel: this.ctl.heel.rotation,
      gazeX: this.ctl.gaze.x,
      gazeY: this.ctl.gaze.y,
      lid: this.ctl.lid.scaleY,
      brow: this.ctl.brow.rotation,
    };
  }

  private write(s: PoseState): void {
    for (const name of RIG_BONES) this.bones[name].rotation = s.rot[name];
    this.hip.x = s.hipX;
    this.hip.y = s.hipY;
    this.ctl.gaze.x = s.gazeX;
    this.ctl.gaze.y = s.gazeY;
    // A zero scale would collapse the lid's path; a hair above zero draws nothing visible.
    this.ctl.lid.scaleY = Math.max(1e-3, s.lid);
    this.ctl.brow.rotation = s.brow;
    for (const t of TARGETS) {
      this.ctl[t].x = s.targets[t][0];
      this.ctl[t].y = s.targets[t][1];
    }
  }

  /** Mark every bone (and the hip's position) changed without changing it: a same-value write is ignored, so step away and back. */
  private redirty(): void {
    for (const name of RIG_BONES) {
      const b = this.bones[name];
      const r = b.rotation;
      b.rotation = r + 1e-3;
      b.rotation = r;
    }
    const x = this.hip.x;
    this.hip.x = x + 1e-3;
    this.hip.x = x;
  }

  /** World transform of a bone from the runtime (after IK), in rig space. */
  boneWorld(name: RigBone): Mat2D {
    const m = this.bones[name].worldTransform();
    return [m.xx, m.xy, m.yx, m.yy, m.tx - this.model.origin[0], m.ty - this.model.origin[1]];
  }

  controlWorld(name: RigControl): Mat2D {
    const m = this.ctl[name].worldTransform();
    return [m.xx, m.xy, m.yx, m.yy, m.tx - this.model.origin[0], m.ty - this.model.origin[1]];
  }

  /** Free the runtime's animation instances (the artboard instance belongs to the caller). */
  dispose(): void {
    for (const anim of Object.values(this.anims)) anim.delete?.();
  }
}

/** A loaded .riv: the only thing kept between frames (it is immutable once loaded). */
export interface RiveFileLike {
  artboardByName(name: string): unknown;
}

export interface PosedFrame {
  artboard: RiveArtboard;
  player: RigPlayer;
  report: PoseReport;
  /** Free the instance and its animation instances. Call once, after drawing has been flushed. */
  release(): void;
}

/**
 * Instance a fresh artboard and pose it for one frame. The caller draws or
 * measures it, then releases it. Nothing posed here can influence any other frame.
 */
export function openFreshPose(runtime: RiveRuntime, file: RiveFileLike, model: RigModel, controls: RigControls): PosedFrame {
  const artboard = file.artboardByName(model.artboard.name) as (RiveArtboard & { delete?(): void }) | null;
  if (!artboard) throw new RigPoseError(`the rig has no artboard ${model.artboard.name}`);
  let player: RigPlayer | null = null;
  const release = (): void => {
    player?.dispose();
    artboard.delete?.();
  };
  try {
    player = new RigPlayer(runtime, artboard, model);
    const report = player.pose(controls);
    return { artboard, player, report, release };
  } catch (err) {
    release();
    throw err;
  }
}

/** openFreshPose for one use: pose, hand to `use`, release (even if `use` throws). */
export function withFreshPose<T>(runtime: RiveRuntime, file: RiveFileLike, model: RigModel, controls: RigControls, use: (frame: PosedFrame) => T): T {
  const frame = openFreshPose(runtime, file, model, controls);
  try {
    return use(frame);
  } finally {
    frame.release();
  }
}
