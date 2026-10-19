// From motion state to rig controls: the boundary between Motion Intelligence
// (what the body does: ../motion.ts) and body performance (how the Rive rig
// shows it: ./rig-apply.ts).
//
// Pure and closed-form: the same WallabyState always yields the same controls.
// Nothing here can move the character: position, scale, facing, and opacity
// stay in the motion state and only place the rig in the frame. Isomorphic.

import type { WallabyState } from '../motion.ts';
import type { Viseme } from '../rig.ts';
import type { Vec } from './rig-math.ts';
import { POSE_CLIPS, TAIL_BONES, type PoseClip } from './rig-source.ts';

export interface RigControls {
  /** The key-pose blend: pose clips with weights summing to 1, and each clip's time (looping clips only). */
  clips: { clip: PoseClip; weight: number; timeS: number }[];
  /** Additive body controls: pitch (deg), hip shift (rig px), spine bend (deg). */
  body: { pitchDeg: number; dx: number; dy: number; chestDeg: number; neckDeg: number };
  head: { deg: number };
  ears: { nearDeg: number; farDeg: number };
  /** Per tail bone, root first: added rotation (deg). Tension 0..1 straightens the curl. */
  tail: { deg: number[]; tension: number };
  arms: { nearDeg: number; nearForeDeg: number; farDeg: number; farForeDeg: number };
  face: { jawDeg: number; lid: number; browDeg: number; gazeX: number; gazeY: number };
  /** Feet on a surface (the rig plants them and lets the tail rest on it). */
  grounded: boolean;
  /** Extent of the supporting surface in rig x (feet at 0, facing +x), or null when there is none. */
  support: { minX: number; maxX: number } | null;
  /** A ledge lip the paws hold (rig space), when the body is climbing; Rive's arm IK reaches for it. */
  grip: Vec | null;
  /** A pointing gesture: the near forelimb's IK target (rig space) and how much of the arm it takes (0..1). */
  point: { target: Vec; amount: number } | null;
}

const JAW_DEG: Record<Viseme, number> = { REST: 0, CLOSED: 0, SMALL: 5, OPEN: 10 };
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Furthest a pointing target is placed from the shoulder (rig px): far subjects are pointed at, not reached for. */
const POINT_RADIUS = 300;
/** Height of the shoulder the point is aimed from, above the feet (rig px). */
const SHOULDER_UP = 146;
/** Furthest a pointing target may be from the feet (rig px): inside the rig's IK reach limit in every direction. */
const POINT_REACH = 380;

/** The near forelimb points at the subject in front of WalletWallaby, by the pose's reach. */
function pointAt(s: WallabyState): RigControls['point'] {
  if (!s.focus || s.pose.reach <= 0.01) return null;
  const x = (s.facing * (s.focus.x - s.x)) / s.scale;
  const y = (s.focus.y - s.y) / s.scale;
  if (x < 20) return null; // never point backwards through the body
  // Aim from the shoulder's height; clamp the distance so the arm reads as a point, not a lunge.
  const dx = x;
  const dy = y + SHOULDER_UP;
  const d2 = dx * dx + dy * dy;
  let k = d2 > POINT_RADIUS * POINT_RADIUS ? POINT_RADIUS / Math.sqrt(d2) : 1;
  // Along the same direction from the shoulder, stop where the target would leave the rig's reach from the
  // feet (pointing steeply up, the shoulder's own height adds to the distance): |(dx k, dy k - up)| = reach.
  const b = SHOULDER_UP * dy;
  const kReach = (b + Math.sqrt(b * b - d2 * (SHOULDER_UP * SHOULDER_UP - POINT_REACH * POINT_REACH))) / d2;
  if (kReach < k) k = kReach;
  return { target: [dx * k, dy * k - SHOULDER_UP], amount: Math.min(1, s.pose.reach) };
}

/** Map one sampled motion state to the rig's controls. */
export function rigControls(s: WallabyState): RigControls {
  const { pose, motion, expr } = s;
  // The key-pose blend, normalised, in the contract's clip order.
  const total = POSE_CLIPS.reduce((a, c) => a + Math.max(0, pose.mix[c] ?? 0), 0);
  const clips = total > 0
    ? POSE_CLIPS.flatMap((clip) => {
        const w = Math.max(0, pose.mix[clip] ?? 0) / total;
        return w > 1e-6 ? [{ clip, weight: w, timeS: clip === 'idle_alert' ? motion.idleTimeS : 0 }] : [];
      })
    : [{ clip: 'idle_alert' as const, weight: 1, timeS: motion.idleTimeS }];
  // Exact unit sum after dropping negligible weights.
  const sum = clips.reduce((a, c) => a + c.weight, 0);
  clips[0]!.weight += 1 - sum;

  const crouch = clamp(pose.crouch, 0, 1);
  const curl = motion.tail.curl;
  const f = s.facing;
  let support: RigControls['support'] = null;
  if (motion.support && motion.contact !== 'NONE') {
    const a = (f * (motion.support.x0 - s.x)) / s.scale;
    const b = (f * (motion.support.x1 - s.x)) / s.scale;
    support = { minX: Math.min(a, b), maxX: Math.max(a, b) };
  }
  return {
    clips,
    body: {
      pitchDeg: motion.rotation,
      dx: 0,
      // Compression drops the hips (the legs take it through the IK); stretch lifts them.
      dy: crouch * 16 - motion.stretch * 110,
      chestDeg: crouch * 5,
      neckDeg: -crouch * 3,
    },
    head: { deg: pose.headTilt + s.gaze.y * 5 + motion.headStab },
    ears: {
      nearDeg: 0.7 * expr.earPerk - 0.5 * expr.earSpread + 0.8 * motion.earLag + 7 * expr.asym,
      farDeg: 0.6 * expr.earPerk - 0.3 * expr.earSpread + 0.6 * motion.earLag - 4 * expr.asym,
    },
    tail: {
      // The root carries the swing and the contact springs' follow-through; the segments carry the curl, more toward the tip.
      deg: TAIL_BONES.map((_, i) => (i === 0 ? motion.tail.swing + motion.tailLag : curl * (0.6 + 0.25 * i))),
      tension: motion.tail.tension,
    },
    arms: {
      // Presenting lifts the forelimb forward and opens the forearm away from the face; pointing is Rive IK (below).
      nearDeg: -(pose.lift * 62),
      nearForeDeg: pose.lift * 16,
      farDeg: -(pose.reach * 12 + pose.lift * 20),
      farForeDeg: pose.lift * 8,
    },
    face: {
      jawDeg: JAW_DEG[s.mouth],
      lid: clamp(expr.lid, 0, 1),
      browDeg: -expr.brow * 1.1 + expr.asym * 5,
      gazeX: s.gaze.x * f * 1.8,
      gazeY: s.gaze.y * 1.4,
    },
    grounded: motion.contact !== 'NONE',
    support,
    grip: motion.grip ? [(f * (motion.grip.x - s.x)) / s.scale, (motion.grip.y - s.y) / s.scale] : null,
    point: pointAt(s),
  };
}
