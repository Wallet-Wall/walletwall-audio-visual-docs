// The pose one frame asks of WalletWallaby's body, resolved without a renderer.
//
// This is the Rive player's own evaluation (../rive/rig-apply.ts RigPlayer.pose)
// up to, and not including, the IK solve: the `base` reset, the key-pose clips
// mixed in the contract's order with Rive's normalised sequential mixes (each
// step lerps from the current value, so the result is the exact weighted
// average), the continuous controls and IK targets (finalizePose, shared with
// the Rive path), and the two control clips. Every value is a closed-form
// function of the frame's RigControls.
//
// The Blender presentation layer receives this and only this: it places the
// bones, lets its native IK reach for the targets given here at the strengths
// given here, and draws. Nothing it receives lets it move a foot target, a
// support span, or a destination. Isomorphic.

import { finalizePose, TARGETS, type TargetControl } from '../rive/rig-apply.ts';
import { poseValues, type PoseValues, type RigModel } from '../rive/rig-compile.ts';
import type { RigControls } from '../rive/rig-controls.ts';
import type { Vec } from '../rive/rig-math.ts';
import { CLIPS, POSE_CLIPS, RIG_BONES, type IkGroup, type PoseClip, type RigBone } from '../rive/rig-source.ts';

/** Frames per second the rig's clips are keyed at (the .riv writer's own rate). */
const CLIP_FPS = 60;
export const IK_GROUPS: readonly IkGroup[] = ['legs', 'arms', 'tail', 'pointNear'];

export interface ResolvedPose {
  /** Local rotation of every bone in rig radians, rest included: the clip blend plus the continuous controls, before IK. */
  rot: Record<RigBone, number>;
  /** The hip root bone's position (rig px, feet at the origin). */
  hip: Vec;
  /** Far-toe offset along the ground from the near toe (rig px), and the planted foot angle (radians). */
  stance: number;
  heel: number;
  /** Face controls: the eye's position, the lid's closure (0 open .. 1 closed), the brow's rotation (radians). */
  gaze: Vec;
  lid: number;
  brow: number;
  /** IK strength of each constraint group, after the control clips (0 = the blended pose, 1 = fully solved). */
  ik: Record<IkGroup, number>;
  /** Where each IK chain reaches (rig px). Decided here, never by the renderer. */
  targets: Record<TargetControl, Vec>;
  /** 0..1: surface under the tail tip, and how much its ground contact is released. */
  tailSupport: number;
  tailFree: number;
}

interface KeyedClip {
  loop: boolean;
  durationS: number;
  frames: number[];
  values: PoseValues[];
}

const keyedClips = new WeakMap<RigModel, Record<string, KeyedClip>>();

/** Every clip's keys as absolute pose values, computed once per compiled model. */
function clipsOf(model: RigModel): Record<string, KeyedClip> {
  let out = keyedClips.get(model);
  if (out) return out;
  out = {};
  for (const clip of CLIPS) {
    if (clip.only) continue;
    out[clip.name] = {
      loop: clip.loop,
      durationS: model.clips[clip.name].durationS,
      frames: clip.keys.map((k) => Math.round(k.atS * CLIP_FPS)),
      values: clip.keys.map((k) => poseValues(k.pose, model.bones, model.controls)),
    };
  }
  keyedClips.set(model, out);
  return out;
}

/** A clip's values at a time: linear between keys (the rig's keys are linear), wrapped when the clip loops. */
function sampleClip(c: KeyedClip, timeS: number): PoseValues {
  if (c.values.length === 1) return c.values[0]!;
  const t = (c.loop ? timeS % c.durationS : Math.min(timeS, c.durationS)) * CLIP_FPS;
  let i = 0;
  while (i < c.frames.length - 2 && t >= c.frames[i + 1]!) i++;
  const a = c.values[i]!;
  const b = c.values[i + 1]!;
  const u = Math.max(0, Math.min(1, (t - c.frames[i]!) / (c.frames[i + 1]! - c.frames[i]!)));
  const lerp = (x: number, y: number): number => x + (y - x) * u;
  const bones = {} as Record<RigBone, number>;
  for (const name of RIG_BONES) bones[name] = lerp(a.bones[name], b.bones[name]);
  const ik = {} as Record<IkGroup, number>;
  for (const g of IK_GROUPS) ik[g] = lerp(a.ik[g], b.ik[g]);
  return { bones, hipX: lerp(a.hipX, b.hipX), hipY: lerp(a.hipY, b.hipY), ik, stance: lerp(a.stance, b.stance), heel: lerp(a.heel, b.heel) };
}

/** Rive's mix: lerp every keyed value from the current one toward the clip's, by `mix`. */
function mixInto(acc: PoseValues, v: PoseValues, mix: number): void {
  const step = (x: number, y: number): number => x + (y - x) * mix;
  for (const name of RIG_BONES) acc.bones[name] = step(acc.bones[name], v.bones[name]);
  for (const g of IK_GROUPS) acc.ik[g] = step(acc.ik[g], v.ik[g]);
  acc.hipX = step(acc.hipX, v.hipX);
  acc.hipY = step(acc.hipY, v.hipY);
  acc.stance = step(acc.stance, v.stance);
  acc.heel = step(acc.heel, v.heel);
}

/** Resolve one frame's controls into the pose the body must perform. Throws (RigPoseError) on any control the Rive path would refuse. */
export function resolvePose(model: RigModel, controls: RigControls): ResolvedPose {
  const clips = clipsOf(model);
  const base = clips.base!.values[0]!;
  const acc: PoseValues = { bones: { ...base.bones }, hipX: base.hipX, hipY: base.hipY, ik: { ...base.ik }, stance: base.stance, heel: base.heel };
  let total = 0;
  for (const name of POSE_CLIPS) {
    const entry = controls.clips.find((c) => c.clip === name);
    if (!entry || entry.weight <= 0) continue;
    total += entry.weight;
    mixInto(acc, sampleClip(clips[name as PoseClip]!, entry.timeS), total <= entry.weight ? 1 : entry.weight / total);
  }
  const c = model.controls;
  const { pose, tailSupport, tailFree } = finalizePose(
    model,
    { rot: acc.bones, hipX: acc.hipX, hipY: acc.hipY, stance: acc.stance, heel: acc.heel, gazeX: c.gaze.restX, gazeY: c.gaze.restY, lid: c.lid.restScaleY, brow: c.brow.restRotation },
    controls,
  );
  const ik = { ...acc.ik };
  // The control clips: `tail_free` lerps the tail's strength toward 0, `point_near` the near forelimb's toward 1.
  if (tailFree > 0) ik.tail += (0 - ik.tail) * tailFree;
  if (controls.point && controls.point.amount > 0 && !controls.grip) ik.pointNear += (1 - ik.pointNear) * controls.point.amount;
  const targets = {} as Record<TargetControl, Vec>;
  for (const t of TARGETS) targets[t] = [pose.targets[t][0], pose.targets[t][1]];
  return { rot: pose.rot, hip: [pose.hipX, pose.hipY], stance: pose.stance, heel: pose.heel, gaze: [pose.gazeX, pose.gazeY], lid: pose.lid, brow: pose.brow, ik, targets, tailSupport, tailFree };
}
