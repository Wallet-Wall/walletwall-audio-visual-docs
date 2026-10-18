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
// field fills the stomach, widest low, its courses racked back a quarter or half
// brick at a time with no border of its own; the torso carries more mass through
// the belly; each forelimb is one skinned limb whose line opens at the front of
// the shoulder, so it grows out of the chest; the muzzle's profile runs convex to
// a blunter nose; and the tail's root is fuller where it meets the rump. The
// skeleton, IK, and clips are unchanged. Isomorphic.

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

export const ARTBOARD = { name: 'WalletWallaby', width: 400, height: 340 } as const;
/** Where the rig origin (the feet) sits on the artboard. */
export const RIG_ORIGIN: Vec = [250, 310];
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

// ── Silhouette ──────────────────────────────────────────────────────────────

/** Paint slots: the coat, its derived far-side shade, the cream accents, the inner ear, and the charcoal ink. */
export type PaintSlot = 'fur' | 'furShade' | 'accent' | 'innerEar' | 'ink';

export interface PaintSpec {
  slot: PaintSlot;
  alpha?: number;
}
export interface StrokeSpec extends PaintSpec {
  width: number;
  cap?: 'butt' | 'round';
  join?: 'miter' | 'round';
}

export interface ContourSpec {
  points: readonly ContourPoint[];
  closed: boolean;
  roundness?: number;
}

export type Geometry =
  | ({ kind: 'contour' } & ContourSpec)
  /** Several paths drawn by one shape with one paint (each is skinned on its own when the shape is). */
  | { kind: 'contours'; contours: readonly ContourSpec[] }
  | { kind: 'ellipse'; center: Vec; width: number; height: number };

export interface ShapeSpec {
  name: string;
  /** Rigid parent (a bone or control node), or 'root' for skinned and ground shapes. */
  attach: RigBone | RigControl | 'root';
  /** 'rig': points are in rig space at rest; 'local': in the attached bone's own space. */
  space: 'rig' | 'local';
  geometry: Geometry;
  fill?: PaintSpec;
  stroke?: StrokeSpec;
  /** Bind the outline to a bone chain (linear-blend skinning along the chain). */
  skin?: readonly RigBone[];
}

/** Visible width of the outer silhouette line (rig px at scale 1): the emblem's bold charcoal outline. */
export const SILHOUETTE_W = 3;
/** The underlay: twice the visible width, so the fills drawn over it leave exactly SILHOUETTE_W outside the union. */
const UNDERLAY: StrokeSpec = { slot: 'ink', width: SILHOUETTE_W * 2, join: 'round', cap: 'round' };
/** Interior lines: what sits in front of the body (near forelimb, near ear, the haunch). */
const INTERIOR: StrokeSpec = { slot: 'ink', width: 2, join: 'round', cap: 'round' };
/** The brick belly's mortar: charcoal and as bold as the outline, as on WalletWallrus. */
const MORTAR: StrokeSpec = { slot: 'ink', width: 2.6, join: 'round', cap: 'round' };
const FINE: StrokeSpec = { slot: 'ink', width: 1.5, join: 'round', cap: 'round' };

/** A tapered limb along a bone's local x axis, rounded at both ends. */
function limb(length: number, w0: number, w1: number): ContourPoint[] {
  return [
    [-w0 * 0.7, 0],
    [0, -w0],
    [length * 0.5, -(w0 + w1) / 2],
    [length, -w1],
    [length + w1 * 0.75, 0],
    [length, w1],
    [length * 0.5, (w0 + w1) / 2],
    [0, w0],
  ];
}

// ── The signature tail ──────────────────────────────────────────────────────

const tailSeg = TAIL_REST.slice(1).map((p, i) => Math.hypot(p[0] - TAIL_REST[i]![0], p[1] - TAIL_REST[i]![1]));
const tailTotal = tailSeg.reduce((a, b) => a + b, 0);
/** Tail half-width along its length (u = 0 root .. 1 tip): a thick, muscular root, a long graceful taper to a point. */
export const tailHalf = (u: number): number => 1.5 + 20 * Math.pow(1 - u, 1.3);

/** A point on the tail's rest centreline by arc length, with its unit normal (toward the upper side). */
function tailAt(u: number): { p: Vec; n: Vec } {
  let d = u * tailTotal;
  for (let i = 0; i < tailSeg.length; i++) {
    if (d <= tailSeg[i]! || i === tailSeg.length - 1) {
      const a = TAIL_REST[i]!;
      const b = TAIL_REST[i + 1]!;
      const t = Math.min(1, d / tailSeg[i]!);
      const dx = (b[0] - a[0]) / tailSeg[i]!;
      const dy = (b[1] - a[1]) / tailSeg[i]!;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], n: [-dy, dx] };
    }
    d -= tailSeg[i]!;
  }
  return { p: TAIL_REST[TAIL_REST.length - 1]!, n: [0, 1] };
}

/**
 * Extra width on the tail's upper edge near the root (px): the muscle where the tail grows out of the rump,
 * filling the corner between the back and the tail so the tail reads as a counterweight the hips carry.
 * It is gone by a third of the way along; the taper beyond is unchanged.
 */
const tailRootMass = (u: number): number => 7 * Math.exp(-(((u - 0.09) / 0.09) ** 2));

const TAIL_STATIONS = [0, 0.08, 0.13, 0.18, 0.3, 0.42, 0.54, 0.66, 0.77, 0.87, 0.94] as const;
const TAIL_ROUNDNESS = 0.9;
/** A point offset from the tail's centreline by `k` half-widths (+1: the upper edge, -1: the underside); the upper side carries the root mass. */
const tailSide = (u: number, k: number): ContourPoint => {
  const { p, n } = tailAt(u);
  const d = (tailHalf(u) + (k > 0 ? tailRootMass(u) : 0)) * k;
  return [p[0] + n[0] * d, p[1] + n[1] * d];
};
const tailTip = (): ContourPoint => {
  const tip = tailAt(1).p;
  return [tip[0], tip[1], 'corner'];
};

/** Tail outline from its rest centreline. */
function tailOutline(): ContourPoint[] {
  const upper = TAIL_STATIONS.map((u) => tailSide(u, 1));
  const lower = [...TAIL_STATIONS].reverse().map((u) => tailSide(u, -1));
  // The root end is buried in the rump and the haunch, so it closes with a simple round.
  return [...upper, tailTip(), ...lower, [TAIL_REST[0]![0] + 7, TAIL_REST[0]![1] + 3]];
}

/** How far the cream underside reaches toward the tail's centreline, in half-widths from the underside edge. */
const TAIL_UNDERSIDE_REACH = 0.7;
/**
 * The tail's cream underside, the wallaby's answer to WalletWallrus's cream tusks: a band along the
 * underside from near the root to the tip. Its outer edge is the tail's own underside, vertex for vertex
 * and with the same smoothing (so it bends exactly with the tail and never spills past the outline); its
 * inner edge runs a little below the centreline and narrows to the tip.
 */
function tailUnderside(): ContourPoint[] {
  const from = TAIL_STATIONS.slice(1);
  const edge = [...from].reverse().map((u) => tailSide(u, -1));
  // It grows out of the underside from a sliver near the root (no blunt end beside the haunch) and narrows to the tip.
  const grow = (u: number): number => Math.min(1, Math.max(0, (u - 0.08) / 0.24));
  const inner = from.filter((u) => grow(u) > 0).map((u) => tailSide(u, -1 + TAIL_UNDERSIDE_REACH * grow(u) * (1 - u) ** 0.15));
  return [tailTip(), ...edge, ...inner];
}

// ── The torso and its brick belly ───────────────────────────────────────────

/**
 * The torso: an athletic back and a full stomach. The belly is the deepest part of the body (the wall
 * WalletWallaby carries, as WalletWallrus does), the chest a little narrower, the neck short and thick
 * where it runs up into the head.
 */
const TORSO: readonly ContourPoint[] = [
  [-46, -61],
  [-51, -83],
  [-43, -105],
  [-29.5, -125],
  [-14.5, -147],
  [0, -165],
  [13.5, -180.5],
  [27, -188],
  [40, -173],
  [46.5, -156],
  [48, -139],
  [44, -122.5],
  [35.5, -106.5],
  [24.5, -90.5],
  [12, -76.5],
  [-5, -62.5],
  [-25, -56],
];
const TORSO_SKIN: readonly RigBone[] = ['hip', 'chest', 'neck'];

/** The torso's drawn outline (the smoothed contour, finely sampled). */
const TORSO_LINE: readonly Vec[] = sampleContour(smoothContour(TORSO, true, 1), true, 24);

/** Where the ray from `p` along `d` first crosses the torso outline. */
function torsoEdge(p: Vec, d: Vec): Vec {
  let best = Infinity;
  for (let i = 0; i < TORSO_LINE.length; i++) {
    const q1 = TORSO_LINE[i]!;
    const q2 = TORSO_LINE[(i + 1) % TORSO_LINE.length]!;
    const e = sub(q2, q1);
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(q1, p);
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (t > 1e-9 && s >= 0 && s <= 1 && t < best) best = t;
  }
  if (!Number.isFinite(best)) throw new Error('rig-source: a mortar course does not meet the belly outline');
  return add(p, scale(d, best));
}

/**
 * Bed joints at rest, bottom to top (y, px): four courses up the stomach (the chest above is coat). They
 * cross the haunch's arc rather than run along it, and the lowest course runs down behind the haunch
 * with no bed under it.
 */
const BRICK_BEDS = [-77, -90.5, -104, -117.5, -131] as const;
/** Brick length (twice the course height) and the running bond: course k's head joints at BRICK_X0 + (k odd ? half a brick : 0) + n bricks. */
const BRICK_LEN = 27;
const BRICK_X0 = 2.5;
/**
 * Where each course ends at the back (x, px), bottom course first, as a wall's end is racked back:
 * each course up stops a quarter or a half brick further forward (closing with a bat where the bond
 * needs one), keeping a band of coat along the back, so the wall fills the stomach from the front of the
 * body nearly to the flank, and its back edge is the bricks' own toothed end, never a border. The lowest
 * course ends behind the haunch.
 */
const BRICK_ENDS = [-31.25, -31.25, -24.5, -11] as const;
/** A head joint closer than this to either end of its course is left out (no slivers; with BRICK_X0, every back end closes with a half or three-quarter bat or a whole brick). */
const BRICK_MIN_END = 8;
/** Mortar lines are drawn through points at most this far apart (px), so the skinning bends them with the body. */
const MORTAR_STEP = 7;

/** Where a level line at height y, from x, meets the front of the torso. */
const brickFront = (x: number, y: number): Vec => torsoEdge([x, y], [1, 0]);
/** A mortar line from a to b, through evenly spaced points (open). */
function mortarLine(a: Vec, b: Vec): ContourSpec {
  const n = Math.max(1, Math.ceil(len(sub(b, a)) / MORTAR_STEP));
  return { points: Array.from({ length: n + 1 }, (_, i): ContourPoint => add(a, scale(sub(b, a), i / n))), closed: false };
}

/**
 * The brick belly: the WalletWall brick motif built into the stomach, exactly as
 * on WalletWallrus, whose stomach IS the wall. Courses of bricks in the coat's
 * own colour, laid level in running bond and marked out only by charcoal
 * mortar: bed joints, head joints, and at the back of each course the head
 * joint where it ends. There is no outline around the field: the front of the
 * stomach cuts every course (each bed joint runs into the silhouette line), the
 * racked ends make the back, and the haunch covers the lowest course's back.
 * Every mortar line is skinned to the torso's bone chain, so the bricks bend,
 * compress, and stretch with the body that carries them instead of riding on it.
 */
function brickMortar(): ContourSpec[] {
  const lines: ContourSpec[] = [];
  const courses = BRICK_BEDS.length - 1;
  // Bed joints above the lowest course: each runs from the back end of the course below it (the further back) to the front.
  BRICK_BEDS.forEach((y, j) => {
    if (j === 0) return;
    const x = BRICK_ENDS[j - 1]!;
    lines.push(mortarLine([x, y], brickFront(x, y)));
  });
  for (let k = 0; k < courses; k++) {
    const y0 = BRICK_BEDS[k]!;
    const y1 = BRICK_BEDS[k + 1]!;
    const end = BRICK_ENDS[k]!;
    // The course's own end at the back (a stepped, toothed end, never a border line).
    lines.push(mortarLine([end, y0], [end, y1]));
    // Head joints in running bond, none that would cut a sliver at either end.
    const lo = end + BRICK_MIN_END;
    const hi = Math.min(brickFront(end, y0)[0], brickFront(end, y1)[0]) - BRICK_MIN_END;
    for (let x = BRICK_X0 + (k % 2) * (BRICK_LEN / 2) - BRICK_LEN * 4; x <= hi; x += BRICK_LEN) {
      if (x >= lo) lines.push(mortarLine([x, y0], [x, y1]));
    }
  }
  return lines;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Where the cream throat ends on the front of the chest (y, px): above the brick field, with coat between. */
const THROAT_END = -147;
/**
 * The cream throat: the inner body's cream, from under the chin down the front of the throat, narrowing to
 * a rounded point on the chest above the brick field (coat runs between them, so the bricks sit in the
 * body, not under a bib). Its front edge is the torso's drawn outline itself, so the cream runs into the
 * silhouette line; it is skinned with the torso.
 */
function creamChest(): ContourPoint[] {
  const top = -178;
  const front = TORSO_LINE.filter((p) => p[0] > 25 && p[1] >= top && p[1] < THROAT_END).map((p): ContourPoint => [p[0], p[1]]);
  const tip = brickFront(25, THROAT_END);
  // The back edge: from the point on the chest, a rounded end sweeping back across the throat, then up under the jaw (finely sampled: the shape is drawn unsmoothed).
  const guide: ContourPoint[] = [[tip[0], tip[1]], [tip[0] - 7, THROAT_END - 2], [lerp(tip[0], 27, 0.6), THROAT_END - 6.5], [27.5, THROAT_END - 13], [28.5, -166], [29.5, top]];
  const backEdge = sampleContour(smoothContour(guide, false, 1), false, 6).slice(1).map((p): ContourPoint => [p[0], p[1]]);
  return [...front, [tip[0], tip[1]], ...backEdge];
}

/** The haunch: the hind leg's big thigh, drawn over the torso. */
const THIGH_POINTS: readonly Vec[] = [
  [-46, -67],
  [-43, -85],
  [-31, -97],
  [-13, -99],
  [3, -92],
  [14, -74],
  [25, -52],
  [27, -42],
  [21, -34],
  [10, -32],
  [-4, -39],
  [-23, -49],
  [-39, -57],
];
const thighPoint = (p: Vec, d: Vec): Vec => {
  const c: Vec = [-8, -66];
  const k = 0.92;
  return [c[0] + (p[0] - c[0]) * k + d[0], c[1] + (p[1] - c[1]) * k + d[1]];
};
function thighGeometry(d: Vec): Geometry {
  return { kind: 'contour', closed: true, points: THIGH_POINTS.map((p) => thighPoint(p, d)) };
}
/**
 * The line of the haunch over the belly: exactly the thigh's own drawn outline
 * from the rump, over the top of the thigh, to where it leaves the body at the
 * knee (the rest of the thigh's edge is the silhouette).
 */
function haunchLine(): ContourPoint[] {
  const verts = smoothContour(THIGH_POINTS.map((p) => thighPoint(p, [0, 0])), true, 1);
  const steps = 8;
  const samples = sampleContour(verts, true, steps);
  // From a little past vertex 1 (the rump) to two thirds of the way from vertex 5 to vertex 6 (above the knee).
  return samples.slice(steps + 3, steps * 5 + 6).map((p): ContourPoint => [p[0], p[1]]);
}

// ── The forelimbs ───────────────────────────────────────────────────────────

/** Half-widths along a forelimb (px): the broad shoulder it grows from, the upper arm, the elbow, the forearm, the paw. */
interface LimbWidths {
  shoulder: number;
  upper: number;
  elbow: number;
  fore: number;
  paw: number;
}
const FORELIMB_N: LimbWidths = { shoulder: 9.5, upper: 6.7, elbow: 5.2, fore: 4.5, paw: 4.3 };
const FORELIMB_F: LimbWidths = { shoulder: 8.8, upper: 6.2, elbow: 4.9, fore: 4.2, paw: 4 };
/**
 * The near forelimb's line, like the haunch's over the thigh, wraps the back of the shoulder and runs down
 * the back of the limb, round the paw, and up its front to this far from the shoulder joint (px); the
 * front of the shoulder has no line, so the limb grows out of the chest.
 */
const LIMB_LINE_FRONT_FROM = 12;

const unit = (v: Vec): Vec => scale(v, 1 / len(v));
/** The left-hand normal (toward the limb's lower side when it points forward). */
const normal = (v: Vec): Vec => [-v[1], v[0]];

/**
 * A forelimb as one continuous shape from the shoulder to the paw, in rig space at rest, skinned to its
 * two bones (so it bends at the elbow as one limb, with no seam or cap there). `d` offsets the far limb.
 * Returns the closed outline and the open edge that skips the front of the shoulder (where the limb grows
 * out of the chest, there is no line).
 */
function forelimb(d: Vec, w: LimbWidths): { outline: ContourPoint[]; edge: ContourPoint[] } {
  const s = off(SHOULDER, d);
  const e = off(ELBOW, d);
  const p = off(PAW, d);
  const a = unit(sub(e, s));
  const f = unit(sub(p, e));
  const la = len(sub(e, s));
  const lf = len(sub(p, e));
  const nElbow = unit(add(normal(a), normal(f)));
  // Centreline stations: distance along the limb, point, normal, half-width.
  const stations: { at: number; c: Vec; n: Vec; hw: number }[] = [
    { at: -5, c: add(s, scale(a, -5)), n: normal(a), hw: w.shoulder },
    { at: 0, c: s, n: normal(a), hw: w.shoulder * 0.94 },
    { at: la * 0.4, c: add(s, scale(a, la * 0.4)), n: normal(a), hw: w.upper },
    { at: la * 0.75, c: add(s, scale(a, la * 0.75)), n: normal(a), hw: (w.upper + w.elbow) / 2 },
    { at: la, c: e, n: nElbow, hw: w.elbow },
    { at: la + lf * 0.35, c: add(e, scale(f, lf * 0.35)), n: normal(f), hw: w.fore },
    { at: la + lf * 0.7, c: add(e, scale(f, lf * 0.7)), n: normal(f), hw: (w.fore + w.paw) / 2 },
    { at: la + lf, c: p, n: normal(f), hw: w.paw },
  ];
  const side = (k: number) => stations.map((st) => ({ at: st.at, pt: add(st.c, scale(st.n, st.hw * k)) as Vec }));
  const upper = side(-1);
  const lower = side(1);
  const tip: Vec = add(p, scale(f, w.paw * 0.75));
  const root: Vec = add(s, scale(a, -5 - w.shoulder * 0.7));
  const outline: ContourPoint[] = [root, ...upper.map((v) => v.pt), tip, ...[...lower].reverse().map((v) => v.pt)];
  // The open edge: down the front (upper side) from LIMB_LINE_FRONT_FROM, round the paw, up the back (lower side), and halfway over the back of the shoulder.
  const k = upper.findIndex((v) => v.at >= LIMB_LINE_FRONT_FROM);
  const t = (LIMB_LINE_FRONT_FROM - upper[k - 1]!.at) / (upper[k]!.at - upper[k - 1]!.at);
  const front = [add(upper[k - 1]!.pt, scale(sub(upper[k]!.pt, upper[k - 1]!.pt), t)), ...upper.slice(k).map((v) => v.pt)];
  const overShoulder: Vec = add(stations[0]!.c, scale(unit(sub(normal(a), a)), w.shoulder));
  const edge: ContourPoint[] = [...front, tip, ...[...lower].reverse().map((v) => v.pt), overShoulder];
  return { outline, edge };
}

function footGeometry(): Geometry {
  return {
    kind: 'contour',
    closed: true,
    points: [[-6, -0.5], [-2, -5.6], [20, -6], [44, -4.2], [58, -1.8], [66.5, 1.4, 'corner'], [58, 4.2], [30, 5.2], [4, 5.6], [-4, 3.6]],
  };
}

// ── Parts and draw order ────────────────────────────────────────────────────

/** A body part: one filled mass. Its contour also joins the silhouette underlay. */
type Part = Required<Pick<ShapeSpec, 'name' | 'attach' | 'space' | 'geometry' | 'fill'>> & Pick<ShapeSpec, 'skin' | 'stroke'>;

const EAR_F: Part = {
  name: 'ear_f',
  attach: 'ear_f',
  space: 'local',
  geometry: { kind: 'contour', closed: true, points: [[-3, 8], [12, 10], [28, 9], [44, 5], [56, 0, 'corner'], [44, -5], [28, -8.5], [12, -9], [-3, -7]] },
  fill: { slot: 'furShade' },
};
const FORELIMB_F_SHAPE = forelimb(FAR_ARM, FORELIMB_F);
const FORELIMB_N_SHAPE = forelimb([0, 0], FORELIMB_N);
const FORELIMB_F_PART: Part = { name: 'forelimb_f', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: FORELIMB_F_SHAPE.outline }, fill: { slot: 'furShade' }, skin: ['arm_f', 'forearm_f'] };
const THIGH_F: Part = { name: 'thigh_f', attach: 'thigh_f', space: 'rig', geometry: thighGeometry(FAR_LEG), fill: { slot: 'furShade' } };
const SHIN_F: Part = { name: 'shin_f', attach: 'shin_f', space: 'local', geometry: { kind: 'contour', closed: true, points: limb(49.2, 7.6, 4.6) }, fill: { slot: 'furShade' } };
const FOOT_F: Part = { name: 'foot_f', attach: 'foot_f', space: 'local', geometry: footGeometry(), fill: { slot: 'furShade' } };
const TAIL: Part = { name: 'tail', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: tailOutline(), roundness: TAIL_ROUNDNESS }, fill: { slot: 'fur' }, skin: TAIL_BONES };
const TORSO_PART: Part = { name: 'torso', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: TORSO }, fill: { slot: 'fur' }, skin: TORSO_SKIN };
const THIGH_N: Part = { name: 'thigh_n', attach: 'thigh_n', space: 'rig', geometry: thighGeometry([0, 0]), fill: { slot: 'fur' } };
const SHIN_N: Part = { name: 'shin_n', attach: 'shin_n', space: 'local', geometry: { kind: 'contour', closed: true, points: limb(49.2, 7.6, 4.6) }, fill: { slot: 'fur' } };
const FOOT_N: Part = { name: 'foot_n', attach: 'foot_n', space: 'local', geometry: footGeometry(), fill: { slot: 'fur' } };
const JAW: Part = {
  name: 'jaw',
  attach: 'jaw',
  space: 'rig',
  // A short chin, tucked under the overhanging upper lip (a wallaby's, not a dog's long lower jaw).
  geometry: { kind: 'contour', closed: true, points: [[52, -170], [66, -170.6], [77, -171], [76, -167.4], [69, -163.6], [56, -162.6], [45, -163.8], [41, -167]] },
  fill: { slot: 'accent' },
  stroke: FINE,
};
/**
 * The head: a rounded crown running in one convex line (no stop, no dished bridge) down a deep muzzle to
 * a blunt nose, with a full cheek; the macropod profile rather than a canine or deer wedge.
 */
const HEAD: Part = {
  name: 'head',
  attach: 'head',
  space: 'rig',
  geometry: {
    kind: 'contour',
    closed: true,
    points: [
      [17, -183],
      [21, -197],
      [31, -206],
      [45, -209.5],
      [58, -205.5],
      [69, -198],
      [79, -190],
      [86.5, -184],
      [90.5, -178.5],
      [90, -173.5],
      [85.5, -170.5],
      [74, -169.5],
      [61, -167.5],
      [48, -165],
      [34, -165.5],
      [23, -172],
    ],
  },
  fill: { slot: 'fur' },
};
const EAR_N: Part = {
  name: 'ear_n',
  attach: 'ear_n',
  space: 'local',
  geometry: { kind: 'contour', closed: true, points: [[-4, 9], [12, 11.5], [29, 10.5], [47, 6], [64.5, 0, 'corner'], [47, -6.5], [29, -10.5], [12, -10.5], [-4, -8]] },
  fill: { slot: 'fur' },
  stroke: INTERIOR,
};
const FORELIMB_N_PART: Part = { name: 'forelimb_n', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: FORELIMB_N_SHAPE.outline }, fill: { slot: 'fur' }, skin: ['arm_n', 'forearm_n'] };

/** Every part of the one silhouette, in draw order (back to front). */
const PARTS: readonly Part[] = [EAR_F, FORELIMB_F_PART, THIGH_F, SHIN_F, FOOT_F, TAIL, TORSO_PART, THIGH_N, SHIN_N, FOOT_N, JAW, HEAD, EAR_N, FORELIMB_N_PART];
/** The parts whose contour forms the silhouette underlay. */
export const SILHOUETTE_PARTS: readonly string[] = PARTS.map((p) => p.name);

const shapeOf = (p: Part): ShapeSpec => ({ name: p.name, attach: p.attach, space: p.space, geometry: p.geometry, fill: p.fill, ...(p.stroke ? { stroke: p.stroke } : {}), ...(p.skin ? { skin: p.skin } : {}) });
const underlayOf = (p: Part): ShapeSpec => ({ name: `${p.name}_ink`, attach: p.attach, space: p.space, geometry: p.geometry, stroke: UNDERLAY, ...(p.skin ? { skin: p.skin } : {}) });

/** Draw order, back to front. */
export const SHAPES: readonly ShapeSpec[] = [
  { name: 'shadow', attach: 'root', space: 'rig', geometry: { kind: 'ellipse', center: [8, 1], width: 112, height: 11 }, fill: { slot: 'ink', alpha: 0.12 } },

  // The silhouette: every part's contour, stroked behind every fill; only the outer line of the union survives.
  ...PARTS.map(underlayOf),

  // Far side, in the derived shade.
  ...[EAR_F, FORELIMB_F_PART, THIGH_F, SHIN_F, FOOT_F].map(shapeOf),

  // The tail and the torso: one coat, joined without a seam. The tail's underside and the throat are cream.
  shapeOf(TAIL),
  { name: 'tail_underside', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: tailUnderside(), roundness: TAIL_ROUNDNESS }, fill: { slot: 'accent' }, skin: TAIL_BONES },
  shapeOf(TORSO_PART),
  { name: 'chest', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: true, points: creamChest(), roundness: 0 }, fill: { slot: 'accent' }, skin: TORSO_SKIN },
  { name: 'brick_belly', attach: 'root', space: 'rig', geometry: { kind: 'contours', contours: brickMortar() }, stroke: MORTAR, skin: TORSO_SKIN },

  // Near hind leg: the haunch carries the weight; shin and the long foot spring.
  shapeOf(THIGH_N),
  { name: 'haunch', attach: 'thigh_n', space: 'rig', geometry: { kind: 'contour', closed: false, points: haunchLine(), roundness: 0 }, stroke: INTERIOR },
  shapeOf(SHIN_N),
  shapeOf(FOOT_N),
  { name: 'claws_n', attach: 'foot_n', space: 'local', geometry: { kind: 'contour', closed: false, points: [[60, -1.5], [64, 0.2], [67.5, 1.6]] }, stroke: { slot: 'ink', width: 1.4, cap: 'round', join: 'round' } },

  // Head: mouth interior behind the jaw, the jaw behind the upper head; a cream muzzle and a round charcoal nose.
  { name: 'mouth', attach: 'head', space: 'rig', geometry: { kind: 'contour', closed: true, points: [[56, -169], [80, -171], [77, -165], [60, -163.5]] }, fill: { slot: 'ink' } },
  shapeOf(JAW),
  shapeOf(HEAD),
  {
    name: 'muzzle',
    attach: 'head',
    space: 'rig',
    geometry: { kind: 'contour', closed: true, points: [[47, -169.4], [55, -175.6], [67, -179.4], [79, -180.4], [87, -178], [87.6, -172.6], [76, -170.4], [62, -169.4]] },
    fill: { slot: 'accent' },
  },
  { name: 'nose', attach: 'head', space: 'rig', geometry: { kind: 'contour', closed: true, points: [[83.6, -183.4], [89.4, -182.4], [92.2, -178.2], [90.8, -174], [86.4, -173.4], [83.2, -177.4]] }, fill: { slot: 'ink' } },
  { name: 'eye', attach: 'gaze', space: 'rig', geometry: { kind: 'ellipse', center: [57.5, -191.4], width: 10.4, height: 11.2 }, fill: { slot: 'ink' } },
  { name: 'glint', attach: 'gaze', space: 'rig', geometry: { kind: 'ellipse', center: [59.7, -193.5], width: 3.2, height: 3.2 }, fill: { slot: 'accent' } },
  {
    name: 'lid',
    attach: 'lid',
    space: 'local',
    geometry: { kind: 'contour', closed: true, points: [[-6.6, 3.2], [-3.6, 0.3], [3.6, 0.3], [6.6, 3.2], [6.4, 11.8], [-6.4, 11.8]] },
    fill: { slot: 'fur' },
    stroke: FINE,
  },
  { name: 'brow', attach: 'brow', space: 'local', geometry: { kind: 'contour', closed: false, points: [[-5, 0.8], [0, -0.7], [5, 0.3]] }, stroke: { slot: 'ink', width: 1.8, cap: 'round', join: 'round' } },

  // Near ear in front of the head.
  shapeOf(EAR_N),
  {
    name: 'ear_inner',
    attach: 'ear_n',
    space: 'local',
    geometry: { kind: 'contour', closed: true, points: [[7, 4.6], [27, 5.6], [47, 2.6], [57, 0, 'corner'], [45, -3], [25, -4.6], [9, -3.4]] },
    fill: { slot: 'innerEar' },
  },

  // Near forelimb in front of the body, with charcoal claws. Its line opens at the shoulder: the limb grows out of the chest.
  shapeOf(FORELIMB_N_PART),
  { name: 'forelimb_n_line', attach: 'root', space: 'rig', geometry: { kind: 'contour', closed: false, points: FORELIMB_N_SHAPE.edge }, stroke: INTERIOR, skin: ['arm_n', 'forearm_n'] },
  { name: 'paw_claws', attach: 'forearm_n', space: 'local', geometry: { kind: 'contour', closed: false, points: [[23.4, -2.6], [26.4, -0.6], [27.4, 2]] }, stroke: { slot: 'ink', width: 1.2, cap: 'round', join: 'round' } },
];

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
