// WalletWallaby rig v5, authored as code: skeleton, IK constraints, silhouette,
// paint slots, draw order, and the pose clips. ./rig-compile.ts turns this into
// the .riv the Rive runtime loads; ./rig-controls.ts and ./rig-apply.ts pose it
// per frame. Rive does the body performance (clip blending, IK, skinning,
// drawing); the code only chooses clip weights and places IK targets.
//
// Coordinates are rig space: the feet at the origin, facing right, y down,
// 1 unit = 1 px at character scale 1. The rest pose IS the alert idle: a slight
// forward lean, heels just off the ground, knees sprung, the tail tip resting
// on the ground behind as a third point of support, ears up, head reading the
// terrain ahead.
//
// Design brief (v4): WalletWallaby is WalletWallrus's sibling. The two share one
// mascot grammar: one unified body silhouette in WalletWallrus's own coat colour,
// charcoal linework, cream accents on the face, the WalletWall brick motif built
// into the belly, and one exaggerated signature feature. WalletWallrus's is his
// tusks; WalletWallaby's is his tail. He stays an athletic traversal specialist,
// not a plush mascot: a tapered torso, a small long-muzzled head, long
// directional limbs, a strong springy hind leg, and a long tail, thick at the
// base and tapering to a point, that does real work (balance, counterweight,
// brace) and draws the main line of action in every pose. Flat colour only: no
// gradients, highlights, or gear.
//
// One mass, not an assembly: every body part is filled without its own outline,
// and a charcoal underlay (each part's contour stroked at twice the silhouette
// width, drawn behind every fill) shows only around the union of the parts. The
// torso, tail, head, and far limbs therefore read as one shape with one outer
// line; thinner interior lines mark only what is in front of the body (the near
// forelimb, the near ear, the line of the haunch) and the face.
//
// v5 (visual language): the belly IS the wall, as WalletWallrus's is: the brick
// field fills the front of the stomach, widest low, its courses racked back a
// quarter or half brick at a time with no border of its own. The body is
// soft-massed like WalletWallrus's: a convex back that sweeps into the tail
// through a full rump, a rounded haunch, calves, a belly that rounds down over
// the thigh, a rounded nape. Each forelimb is one skinned limb whose line opens at
// the front of the shoulder, so it grows out of the chest; the muzzle's profile
// runs convex to a blunter nose over a rounded chin. The skeleton, IK, and clips
// are unchanged. Isomorphic.

import { add, len, sampleContour, scale, smoothContour, sub, type ContourPoint, type Vec } from './rig-math.ts';

// ── Contract names ──────────────────────────────────────────────────────────

export const RIG_BONES = [
  'hip',
  'chest',
  'neck',
  'head',
  'jaw',
  'ear_n',
  'ear_f',
  'tail_0',
  'tail_1',
  'tail_2',
  'tail_3',
  'tail_4',
  'thigh_n',
  'shin_n',
  'foot_n',
  'thigh_f',
  'shin_f',
  'foot_f',
  'arm_n',
  'forearm_n',
  'arm_f',
  'forearm_f',
] as const;
export type RigBone = (typeof RIG_BONES)[number];

/**
 * Invisible control nodes. `stance` and `heel` carry values the clips key (far-foot
 * offset, planted foot angle); the target_* nodes are where Rive's IK reaches;
 * gaze, lid, and brow carry the face. The pose solver reads and writes them.
 */
export const RIG_CONTROLS = ['stance', 'heel', 'target_heel_n', 'target_toe_n', 'target_heel_f', 'target_toe_f', 'target_paw_n', 'target_paw_f', 'target_tail', 'gaze', 'lid', 'brow'] as const;
export type RigControl = (typeof RIG_CONTROLS)[number];

/** Rive IK constraints in the rig. Their strengths are keyed by the clips, in three groups. */
export const RIG_IKS = ['leg_n', 'foot_n', 'leg_f', 'foot_f', 'arm_n', 'arm_f', 'tail'] as const;
export type RigIk = (typeof RIG_IKS)[number];
/** Strength groups: the clips key each group; the near arm also answers the `point_near` control clip. */
export type IkGroup = 'legs' | 'arms' | 'tail' | 'pointNear';

export interface IkSpec {
  name: RigIk;
  /** The constrained tip bone; the chain runs up through `parentBones` of its parents. */
  tip: RigBone;
  parentBones: number;
  target: RigControl;
  /** Which way the chain bends (knees forward, elbows down, tail arched up). */
  invert: boolean;
  group: IkGroup;
}

export const TAIL_BONES = ['tail_0', 'tail_1', 'tail_2', 'tail_3', 'tail_4'] as const satisfies readonly RigBone[];

/**
 * The clip set: a reset, one looping idle, eleven key poses, and two control
 * clips: `tail_free` releases the tail's ground IK where the surface ends, and
 * `point_near` hands the near forelimb to IK so it points at a target. Blending
 * them is Rive's job.
 */
export const RIG_CLIPS = ['base', 'idle_alert', 'crouch_preload', 'takeoff', 'airborne', 'land_soft', 'land_hard', 'perch', 'inspect', 'trace', 'mantle', 'push', 'resolve', 'tail_free', 'point_near'] as const;
export type RigClip = (typeof RIG_CLIPS)[number];
export const CONTROL_CLIPS = ['tail_free', 'point_near'] as const satisfies readonly RigClip[];
/** Clips a pose mix may weight (everything but the reset and the control clips). */
export type PoseClip = Exclude<RigClip, 'base' | (typeof CONTROL_CLIPS)[number]>;
export const POSE_CLIPS = RIG_CLIPS.filter((c): c is PoseClip => c !== 'base' && !(CONTROL_CLIPS as readonly string[]).includes(c));

/**
 * The drawn character's ink stays inside this rig-space box in every pose the
 * motion system can produce (feet at 0, facing +x, scale 1): standing, flying,
 * hanging from a ledge, or with the tail over an edge. Tests measure it on the
 * runtime's own transforms; growing it is a deliberate, versioned change.
 */
export const RIG_ENVELOPE = { minX: -224, maxX: 152, minY: -280, maxY: 92 } as const;

// ── Skeleton (rest pose, rig space) ─────────────────────────────────────────

export interface BoneSpec {
  name: RigBone;
  /** Parent bone, or 'root' for the rig root node. */
  parent: RigBone | 'root';
  /** A root bone can sit anywhere in its parent; a chained bone starts at its parent's tip. */
  root: boolean;
  from: Vec;
  to: Vec;
}

/** Offset of the far-side limbs from the near-side ones (drawn behind, in the derived shade). */
const FAR_LEG: Vec = [-9, 0];
const FAR_ARM: Vec = [-7, -2];
const off = (p: Vec, d: Vec): Vec => [p[0] + d[0], p[1] + d[1]];

const HIP_JOINT: Vec = [-14, -72];
const KNEE: Vec = [17, -43];
/** The foot bone runs ~5 px above the sole: toes on the ground, heel sprung just off it. */
const HEEL: Vec = [-22, -13];
const TOE: Vec = [42, -5.5];
/** Where the near toe joint is planted when standing (rig space). */
export const TOE_PLANT: Vec = TOE;
const SHOULDER: Vec = [14, -146];
const ELBOW: Vec = [29.3, -121.4];
const PAW: Vec = [49.7, -116.6];
/**
 * Tail centreline at rest: the signature. A thick base leaves the rump almost
 * level, sweeps back and down in one long curve, and flattens as the tip comes
 * to rest on the ground well behind the heels (the third point of the tripod).
 * About 182 px long: three quarters of the standing height.
 */
export const TAIL_REST: readonly Vec[] = [
  [-30, -72],
  [-65, -67],
  [-99, -55],
  [-131, -36],
  [-162, -16],
  [-196, -4],
];

export const BONES: readonly BoneSpec[] = [
  { name: 'hip', parent: 'root', root: true, from: [-20, -78], to: [-2, -122] },
  { name: 'chest', parent: 'hip', root: false, from: [-2, -122], to: [16, -156] },
  { name: 'neck', parent: 'chest', root: false, from: [16, -156], to: [30, -178] },
  { name: 'head', parent: 'neck', root: false, from: [30, -178], to: [80, -172] },
  { name: 'jaw', parent: 'head', root: true, from: [58, -168], to: [82, -170] },
  { name: 'ear_n', parent: 'head', root: true, from: [30, -199], to: [15, -262] },
  { name: 'ear_f', parent: 'head', root: true, from: [41, -201], to: [38, -256] },
  { name: 'tail_0', parent: 'hip', root: true, from: TAIL_REST[0]!, to: TAIL_REST[1]! },
  { name: 'tail_1', parent: 'tail_0', root: false, from: TAIL_REST[1]!, to: TAIL_REST[2]! },
  { name: 'tail_2', parent: 'tail_1', root: false, from: TAIL_REST[2]!, to: TAIL_REST[3]! },
  { name: 'tail_3', parent: 'tail_2', root: false, from: TAIL_REST[3]!, to: TAIL_REST[4]! },
  { name: 'tail_4', parent: 'tail_3', root: false, from: TAIL_REST[4]!, to: TAIL_REST[5]! },
  { name: 'thigh_n', parent: 'hip', root: true, from: HIP_JOINT, to: KNEE },
  { name: 'shin_n', parent: 'thigh_n', root: false, from: KNEE, to: HEEL },
  { name: 'foot_n', parent: 'shin_n', root: false, from: HEEL, to: TOE },
  { name: 'thigh_f', parent: 'hip', root: true, from: off(HIP_JOINT, FAR_LEG), to: off(KNEE, FAR_LEG) },
  { name: 'shin_f', parent: 'thigh_f', root: false, from: off(KNEE, FAR_LEG), to: off(HEEL, FAR_LEG) },
  { name: 'foot_f', parent: 'shin_f', root: false, from: off(HEEL, FAR_LEG), to: off(TOE, FAR_LEG) },
  { name: 'arm_n', parent: 'chest', root: true, from: SHOULDER, to: ELBOW },
  { name: 'forearm_n', parent: 'arm_n', root: false, from: ELBOW, to: PAW },
  { name: 'arm_f', parent: 'chest', root: true, from: off(SHOULDER, FAR_ARM), to: off(ELBOW, FAR_ARM) },
  { name: 'forearm_f', parent: 'arm_f', root: false, from: off(ELBOW, FAR_ARM), to: off(PAW, FAR_ARM) },
];

export interface ControlSpec {
  name: RigControl;
  parent: RigBone | 'root';
  /** Rest position in rig space (control nodes carry values, not geometry, except the face nodes). */
  at: Vec;
  rotation: number;
}

/** Rest foot angle (radians): heel just lifted, toes planted. */
export const REST_HEEL = Math.atan2(TOE[1] - HEEL[1], TOE[0] - HEEL[0]);
/** Rest far-foot offset along the ground from the near toe (px). */
export const REST_STANCE = FAR_LEG[0];

export const CONTROLS: readonly ControlSpec[] = [
  // stance.x: far toe offset along the ground from the near toe.
  { name: 'stance', parent: 'root', at: [REST_STANCE, 0], rotation: 0 },
  // heel.rotation: foot world angle while planted (heel lift).
  { name: 'heel', parent: 'root', at: [0, 0], rotation: REST_HEEL },
  // IK targets, at rest where the chains already reach (so the rest pose is unchanged by IK).
  { name: 'target_heel_n', parent: 'root', at: HEEL, rotation: 0 },
  { name: 'target_toe_n', parent: 'root', at: TOE, rotation: 0 },
  { name: 'target_heel_f', parent: 'root', at: off(HEEL, FAR_LEG), rotation: 0 },
  { name: 'target_toe_f', parent: 'root', at: off(TOE, FAR_LEG), rotation: 0 },
  { name: 'target_paw_n', parent: 'root', at: PAW, rotation: 0 },
  { name: 'target_paw_f', parent: 'root', at: off(PAW, FAR_ARM), rotation: 0 },
  { name: 'target_tail', parent: 'root', at: TAIL_REST[TAIL_REST.length - 1]!, rotation: 0 },
  // Face controls ride the head: gaze shifts the eye, lid closes it, brow tilts.
  { name: 'gaze', parent: 'head', at: [58, -191], rotation: 0 },
  { name: 'lid', parent: 'head', at: [57.5, -197.6], rotation: 0 },
  { name: 'brow', parent: 'head', at: [58, -202.6], rotation: 0 },
];

/** Knees forward, feet aimed at their toes, elbows down, the tail arched over its ground contact. */
export const IKS: readonly IkSpec[] = [
  { name: 'leg_n', tip: 'shin_n', parentBones: 1, target: 'target_heel_n', invert: true, group: 'legs' },
  { name: 'foot_n', tip: 'foot_n', parentBones: 0, target: 'target_toe_n', invert: false, group: 'legs' },
  { name: 'leg_f', tip: 'shin_f', parentBones: 1, target: 'target_heel_f', invert: true, group: 'legs' },
  { name: 'foot_f', tip: 'foot_f', parentBones: 0, target: 'target_toe_f', invert: false, group: 'legs' },
  { name: 'arm_n', tip: 'forearm_n', parentBones: 1, target: 'target_paw_n', invert: false, group: 'pointNear' },
  { name: 'arm_f', tip: 'forearm_f', parentBones: 1, target: 'target_paw_f', invert: false, group: 'arms' },
  { name: 'tail', tip: 'tail_4', parentBones: 1, target: 'target_tail', invert: false, group: 'tail' },
];

/** IK strength of each group in the rest pose: feet planted, paws free, tail resting on the ground. */
export const REST_IK: Readonly<Record<IkGroup, number>> = { legs: 1, arms: 0, tail: 1, pointNear: 0 };

// ── Paint slots ────────────────────────────────────────────────────────────

/** Paint slots: the coat, its derived far-side shade, the cream accents, the inner ear, and the charcoal ink (src/character/walletwallaby/rig.ts resolves each to a brand colour). */
export type PaintSlot = 'fur' | 'furShade' | 'accent' | 'innerEar' | 'ink';

// ── Pose clips ──────────────────────────────────────────────────────────────

export interface PoseSpec {
  /** Bone rotation deltas from rest, degrees (positive = clockwise on screen). */
  bones?: Partial<Record<RigBone, number>>;
  /** Hip (root bone) translation from rest, rig px. */
  hip?: { dx?: number; dy?: number };
  /** IK intent: group strengths (Rive constraint strength, 0..1; `arms` drives both forelimbs), far-foot offset, planted foot angle (degrees). */
  ik?: { legs?: number; arms?: number; tail?: number; stance?: number; heelDeg?: number };
}

export interface ClipSpec {
  name: RigClip;
  /** A looping clip cycles over its keys; a pose clip is a single key. */
  loop: boolean;
  keys: readonly { atS: number; pose: PoseSpec }[];
  /** A control clip keys only these IK strengths (nothing else), so mixing it adjusts just them. */
  only?: { ik: Partial<Record<IkGroup, number>> };
}

const REST_HEEL_DEG = (REST_HEEL * 180) / Math.PI;

/** One breath: the inhale pose scaled by k (0 = rest, 1 = full inhale). */
const breath = (k: number): PoseSpec => ({ hip: { dy: -1.2 * k }, bones: { chest: -1.4 * k, neck: 0.8 * k, head: 0.6 * k, tail_0: 0.8 * k, ear_n: 1.2 * k, ear_f: 0.8 * k } });
/** Breath period (s): slow, so it reads as life rather than bounce. */
export const BREATH_S = 3.4;

export const CLIPS: readonly ClipSpec[] = [
  { name: 'base', loop: false, keys: [{ atS: 0, pose: {} }] },
  {
    // Alert idle: the rest pose with a slow, small breath (sin² sampled at quarter periods).
    name: 'idle_alert',
    loop: true,
    keys: [0, 0.25, 0.5, 0.75, 1].map((u) => ({ atS: u * BREATH_S, pose: breath(Math.sin(Math.PI * u) ** 2) })),
  },
  {
    // Preload: haunches drop, torso pitches over the feet, the tail loads down and back along the ground.
    name: 'crouch_preload',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dx: 3, dy: 22 }, bones: { hip: 16, chest: 5, neck: -9, head: -10, tail_0: -3, tail_1: -3, tail_2: -2, tail_3: -1, ear_n: -12, ear_f: -10, arm_n: 26, forearm_n: -34, arm_f: 26, forearm_f: -34 }, ik: { heelDeg: 1 } } }],
  },
  {
    // Takeoff: full extension, rear-leg thrust behind, tail straight back as the counter-lever.
    name: 'takeoff',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: -10 }, bones: { hip: 30, chest: 4, neck: -14, head: -14, tail_0: -14, tail_1: -2, tail_2: -1, thigh_n: -48, shin_n: 34, foot_n: 38, thigh_f: -48, shin_f: 34, foot_f: 38, arm_n: 36, forearm_n: -40, arm_f: 36, forearm_f: -40, ear_n: -18, ear_f: -16 }, ik: { legs: 0, tail: 0 } } }],
  },
  {
    // Flight: body long, legs tucked forward, the tail streaming straight back as the long opposing line (its tip lifts a little).
    name: 'airborne',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: -6 }, bones: { hip: 34, chest: 2, neck: -16, head: -14, tail_0: -18, tail_1: 3, tail_2: 3, tail_3: 2, tail_4: 2, thigh_n: 22, shin_n: -26, foot_n: 14, thigh_f: 18, shin_f: -22, foot_f: 14, arm_n: 30, forearm_n: -44, arm_f: 30, forearm_f: -44, ear_n: -20, ear_f: -18 }, ik: { legs: 0, tail: 0 } } }],
  },
  {
    // Soft landing: feet first, light compression, tail lowering toward the ground.
    name: 'land_soft',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: 12 }, bones: { hip: 10, chest: 2, neck: -4, head: -4, tail_0: -4, tail_1: -2, arm_n: 8, forearm_n: -12, arm_f: 8, forearm_f: -12, ear_n: 4, ear_f: 3 }, ik: { heelDeg: 2 } } }],
  },
  {
    // Hard landing: deep compression, wide stance, tail braced flat, forelimbs out for balance.
    name: 'land_hard',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dx: -2, dy: 30 }, bones: { hip: 15, chest: 8, neck: -12, head: -8, tail_0: 4, tail_1: -5, tail_2: -3, tail_3: -2, arm_n: -14, forearm_n: -8, arm_f: -10, forearm_f: -6, ear_n: -6, ear_f: -5 }, ik: { stance: -20, heelDeg: 0 } } }],
  },
  {
    // Perch: a controlled, narrow stance with the tail resting on the surface as a support.
    name: 'perch',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: 6 }, bones: { hip: -4, chest: -2, neck: 2, head: 4, tail_0: 8, tail_1: -1, tail_2: -1, arm_n: 10, forearm_n: -6, arm_f: 10, forearm_f: -6, ear_n: 2, ear_f: 2 }, ik: { stance: -4, heelDeg: 4 } } }],
  },
  {
    // Inspect: lean in over the subject; the tail lifts off the ground to counter the lean.
    name: 'inspect',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dx: 2, dy: 8 }, bones: { hip: 12, chest: 6, neck: 0, head: 12, tail_0: 7, tail_1: 7, tail_2: 7, tail_3: 6, tail_4: 5, arm_n: -14, forearm_n: 14, arm_f: 6, forearm_f: -8, ear_n: -4, ear_f: -3 }, ik: { heelDeg: 9, tail: 0 } } }],
  },
  {
    // Trace: low and forward between the short bounds of a route.
    name: 'trace',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: 10 }, bones: { hip: 25, chest: 4, neck: -8, head: -8, tail_0: 2, tail_1: 1, tail_2: 1, arm_n: 22, forearm_n: -28, arm_f: 22, forearm_f: -28, ear_n: -8, ear_f: -7 }, ik: { heelDeg: 6, tail: 0 } } }],
  },
  {
    // Mantle (hang): forelimbs up on the ledge, body long beneath them, tail hanging as a counterweight.
    name: 'mantle',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dx: -6, dy: -2 }, bones: { hip: -8, chest: 2, neck: -10, head: -12, tail_0: -30, tail_1: 3, tail_2: 4, tail_3: 3, tail_4: 2, thigh_n: 25, shin_n: -49, foot_n: -44, thigh_f: 20, shin_f: -44, foot_f: -44, arm_n: -90, forearm_n: 78, arm_f: -84, forearm_f: 72, ear_n: 10, ear_f: 9 }, ik: { legs: 0, tail: 0, arms: 1 } } }],
  },
  {
    // Push: stance wide, tail braced on the ground behind, forelimbs pressing ahead.
    name: 'push',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dx: 4, dy: 16 }, bones: { hip: 27, chest: 6, neck: -6, head: -6, tail_0: -19, tail_1: -3, tail_2: -2, arm_n: -58, forearm_n: -8, arm_f: -52, forearm_f: -8, ear_n: -6, ear_f: -5 }, ik: { stance: -22, heelDeg: 0 } } }],
  },
  {
    // Resolve: upright, open, a presenting forelimb; the teaching stance.
    name: 'resolve',
    loop: false,
    keys: [{ atS: 0, pose: { hip: { dy: -2 }, bones: { hip: -6, chest: -4, neck: -2, head: -4, tail_0: 5, arm_n: -30, forearm_n: -22, arm_f: 4, forearm_f: -4, ear_n: 4, ear_f: 3 }, ik: { heelDeg: REST_HEEL_DEG } } }],
  },
  // Control: releases the tail's ground contact where there is no surface under it (mixed by the solver).
  { name: 'tail_free', loop: false, keys: [{ atS: 0, pose: {} }], only: { ik: { tail: 0 } } },
  // Control: the near forelimb reaches for its IK target (a pointing gesture at what the lesson shows).
  { name: 'point_near', loop: false, keys: [{ atS: 0, pose: {} }], only: { ik: { pointNear: 1 } } },
];
