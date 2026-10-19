// walletwall.blender-motion/v1: the MotionPlan, frame by frame, as the Blender
// presentation layer receives it.
//
// Motion Intelligence (the TypeScript solver, or the Rust/WASM engine on the
// paths it owns) has already decided everything semantic: the destination, the
// trajectory, the timing, the contacts, and which surface carries each one.
// Every frame here records those decisions (where the feet are, what the body
// is doing, what it stands on) and the pose they resolve to (./pose-resolve.ts):
// bone rotations, the hip, the IK targets and strengths, and the face. Blender
// maps those values onto its armature and draws; it has no input through which
// it could choose a destination, a contact, or a time.
//
// Coordinate contract (2.5D; docs/BLENDER.md):
//   frame px (x right, y down, 1920 x 1080)  ->  Blender units (X right, Y depth away from the camera, Z up)
//     X = (x - 960) * UNITS_PER_PX,  Z = (540 - y) * UNITS_PER_PX,  Y = scene depth (0 = the teaching plane)
//   rig px (feet at the origin, x forward, y down) -> the armature's space at scale 1:
//     X = rx * UNITS_PER_PX,  Z = -ry * UNITS_PER_PX,  Y = the body's own depth (near side negative)
//   The armature object sits at the feet's frame position, mirrored in X by `facing`, scaled by `scale`.
// Isomorphic.

import type { WallabyState } from '../motion.ts';
import type { RigModel } from '../rig/rig-compile.ts';
import { rigControls } from '../rig/rig-controls.ts';
import type { Vec } from '../rig/rig-math.ts';
import { POSE_CLIPS, RIG_BONES, type PoseClip, type RigBone } from '../rig/rig-source.ts';
import { TARGETS, type TargetControl } from '../rig/rig-apply.ts';
import { FRAME } from '../../../layout/geometry.ts';
import type { Terrain, TerrainSurface } from '../../../layout/terrain.ts';
import { IK_GROUPS, resolvePose } from './pose-resolve.ts';

export const BLENDER_MOTION_SCHEMA = 'walletwall.blender-motion/v1';
/** One frame pixel in Blender units. */
export const UNITS_PER_PX = 0.01;
/** The frame's centre in frame px: the origin of Blender's teaching plane. */
export const PLANE_ORIGIN = { x: 960, y: 540 } as const;

export type SupportSurfaceRef = { id: string; support: TerrainSurface['support']; y: number } | null;

export interface BlenderMotionFrame {
  frame: number;
  /** The segment whose terrain the frame is judged against. */
  segment: string;
  visible: boolean;
  opacity: number;
  /** Where the rig's origin (the feet) is drawn: frame px, the character's scale, and the way it faces. */
  place: { x: number; y: number; scale: number; facing: 1 | -1 };
  /** What Motion Intelligence decided this frame is: recorded for audit; the pose below already performs it. */
  semantic: {
    action: WallabyState['motion']['action'];
    phase: WallabyState['motion']['phase'];
    contact: WallabyState['motion']['contact'];
    /** The feet are outside the frame: nothing on screen to stand on, exactly as the contact audit treats it. */
    offStage: boolean;
    /** The declared terrain surface under the feet (null in the air, or off stage). */
    surface: SupportSurfaceRef;
    /** Horizontal extent of that support (frame px), as the motion state carries it. */
    support: { x0: number; x1: number } | null;
    platformDip: number;
    landingImpulse: number;
    velocity: { x: number; y: number };
    pitchDeg: number;
    stretch: number;
    tail: { swing: number; curl: number; tension: number; lag: number };
    /** What the body is looking at or pointing to (frame px), when the lesson names a subject. */
    focus: { x: number; y: number } | null;
  };
  /** The resolved pose (./pose-resolve.ts), in rig space. */
  pose: {
    /** The key-pose blend the motion state asked for (clip -> weight, summing to 1): what the body is doing, smoothly. */
    clips: Partial<Record<PoseClip, number>>;
    rot: Record<RigBone, number>;
    hip: Vec;
    stance: number;
    heel: number;
    gaze: Vec;
    lid: number;
    brow: number;
    ik: Record<(typeof IK_GROUPS)[number], number>;
    targets: Record<TargetControl, Vec>;
    tailFree: number;
  };
}

export interface BlenderMotionDocument {
  schema: typeof BLENDER_MOTION_SCHEMA;
  videoId: string;
  fps: number;
  /** Inclusive frame range; `frames` holds every frame in it, in order. */
  range: { first: number; last: number };
  /** The engine that made the motion (the TypeScript solver, or rust-wasm with its WASM and plan hashes). */
  motionEngine: string;
  coordinates: { unitsPerPx: number; planeOrigin: { x: number; y: number } };
  frames: BlenderMotionFrame[];
}

export class BlenderBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderBridgeError';
  }
}

const SUPPORTING = new Set<TerrainSurface['support']>(['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE']);

/**
 * The declared surface the feet stand on: a top that supports feet, spanning the feet, at the feet's height (the
 * platform's dip is the platform moving, not the feet leaving it). A lookup, not a decision: Motion Intelligence
 * already judged the stand; a grounded frame with no such surface is a disagreement and is refused.
 */
export function surfaceUnder(terrain: Terrain, s: WallabyState): SupportSurfaceRef {
  if (s.motion.contact === 'NONE') return null;
  const y = s.y - s.motion.platformDip;
  const found = terrain.surfaces.filter((t) => t.face === 'TOP' && SUPPORTING.has(t.support) && Math.abs(t.y0 - y) < 0.5 && s.x >= t.x0 - 0.5 && s.x <= t.x1 + 0.5);
  if (found.length === 0) return null;
  // Several declared tops at the same height under the feet (the ground runs under every platform): the platform wins.
  const best = found.find((t) => t.element !== 'ground') ?? found[0]!;
  return { id: best.id, support: best.support, y: best.y0 };
}

const round = (v: number): number => (Object.is(v, -0) ? 0 : v);

/** Off the frame, as the contact audit decides it (src/character/walletwallaby/contacts.ts). */
export const offStage = (x: number, y: number): boolean => x < 0 || x > FRAME.width || y < 0 || y > FRAME.height;

/**
 * One frame of the bridge from one sampled motion state. `terrains`: the terrain on screen at the frame, in the
 * audit's order (the frame's own segment, then the outgoing one while this one transitions in).
 */
export function bridgeFrame(model: RigModel, frame: number, segment: string, s: WallabyState, terrains: readonly Terrain[] | undefined): BlenderMotionFrame {
  const controls = rigControls(s);
  const pose = resolvePose(model, controls);
  const off = offStage(s.x, s.y - s.motion.platformDip);
  let surface: SupportSurfaceRef = null;
  if (s.visible && !off && terrains) for (const t of terrains) if ((surface = surfaceUnder(t, s))) break;
  if (s.visible && s.motion.contact !== 'NONE' && terrains && !off && surface === null) {
    throw new BlenderBridgeError(`frame ${frame} (${segment}): the motion state stands at (${s.x.toFixed(1)}, ${s.y.toFixed(1)}) but no declared supporting top is there`);
  }
  const rot = {} as Record<RigBone, number>;
  for (const b of RIG_BONES) rot[b] = round(pose.rot[b]);
  return {
    frame,
    segment,
    visible: s.visible,
    opacity: s.opacity,
    place: { x: s.x, y: s.y, scale: s.scale, facing: s.facing },
    semantic: {
      action: s.motion.action,
      phase: s.motion.phase,
      contact: s.motion.contact,
      offStage: off,
      surface,
      support: s.motion.support ? { x0: s.motion.support.x0, x1: s.motion.support.x1 } : null,
      platformDip: s.motion.platformDip,
      landingImpulse: s.motion.landingImpulse,
      velocity: { x: s.motion.velocity.x, y: s.motion.velocity.y },
      pitchDeg: s.motion.rotation,
      stretch: s.motion.stretch,
      tail: { swing: s.motion.tail.swing, curl: s.motion.tail.curl, tension: s.motion.tail.tension, lag: s.motion.tailLag },
      focus: s.focus ? { x: s.focus.x, y: s.focus.y } : null,
    },
    pose: { clips: Object.fromEntries(controls.clips.map((c) => [c.clip, c.weight])), rot, hip: pose.hip, stance: pose.stance, heel: pose.heel, gaze: pose.gaze, lid: pose.lid, brow: pose.brow, ik: pose.ik, targets: pose.targets, tailFree: pose.tailFree },
  };
}

// ── Validation: the Blender side trusts nothing it is not given in this shape ──

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function closedKeys(o: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new BlenderBridgeError(`${where} must be an object`);
  const rec = o as Record<string, unknown>;
  for (const k of Object.keys(rec)) if (!keys.includes(k)) throw new BlenderBridgeError(`${where} has an unknown field ${JSON.stringify(k)}`);
  for (const k of keys) if (!(k in rec)) throw new BlenderBridgeError(`${where} is missing ${k}`);
  return rec;
}
function vec(v: unknown, where: string, limit: number): void {
  if (!Array.isArray(v) || v.length !== 2 || !isFiniteNum(v[0]) || !isFiniteNum(v[1])) throw new BlenderBridgeError(`${where} must be two finite numbers`);
  if (Math.abs(v[0]) > limit || Math.abs(v[1]) > limit) throw new BlenderBridgeError(`${where} is outside ±${limit}`);
}
function num(v: unknown, where: string, lo: number, hi: number): void {
  if (!isFiniteNum(v) || v < lo || v > hi) throw new BlenderBridgeError(`${where}=${String(v)} is outside [${lo}, ${hi}]`);
}

/** Refuse anything that is not exactly a v1 bridge document: unknown fields, gaps, non-finite or out-of-range values. */
export function validateBridge(doc: unknown): BlenderMotionDocument {
  const d = closedKeys(doc, ['schema', 'videoId', 'fps', 'range', 'motionEngine', 'coordinates', 'frames'], 'bridge');
  if (d.schema !== BLENDER_MOTION_SCHEMA) throw new BlenderBridgeError(`bridge schema must be ${BLENDER_MOTION_SCHEMA}`);
  if (typeof d.videoId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(d.videoId)) throw new BlenderBridgeError('bridge videoId must be a lowercase id');
  if (typeof d.motionEngine !== 'string' || !/^[a-z0-9:.-]{1,200}$/.test(d.motionEngine)) throw new BlenderBridgeError('bridge motionEngine must be an engine identifier');
  num(d.fps, 'fps', 1, 120);
  const range = closedKeys(d.range, ['first', 'last'], 'range');
  if (!Number.isInteger(range.first) || !Number.isInteger(range.last) || (range.first as number) < 0 || (range.last as number) < (range.first as number)) throw new BlenderBridgeError('range must be non-negative integers, first <= last');
  const coords = closedKeys(d.coordinates, ['unitsPerPx', 'planeOrigin'], 'coordinates');
  if (coords.unitsPerPx !== UNITS_PER_PX) throw new BlenderBridgeError(`coordinates.unitsPerPx must be ${UNITS_PER_PX}`);
  const origin = closedKeys(coords.planeOrigin, ['x', 'y'], 'coordinates.planeOrigin');
  if (origin.x !== PLANE_ORIGIN.x || origin.y !== PLANE_ORIGIN.y) throw new BlenderBridgeError('coordinates.planeOrigin must be the frame centre');
  // Every frame of the range, or a subset of it (review stills, the proof set, some frames of a depth reveal, whose
  // range stays the reveal's): strictly ascending, so no frame repeats and none lies outside the range.
  if (!Array.isArray(d.frames) || d.frames.length === 0 || d.frames.length > (range.last as number) - (range.first as number) + 1) throw new BlenderBridgeError('frames must hold the frames of the range');
  const numbers = d.frames.map((f) => (f !== null && typeof f === 'object' ? (f as { frame?: unknown }).frame : undefined));
  numbers.forEach((n, i) => {
    if (!Number.isInteger(n) || (n as number) < (range.first as number) || (n as number) > (range.last as number) || (i > 0 && (n as number) <= (numbers[i - 1] as number))) throw new BlenderBridgeError('frames must be strictly ascending frames of the range');
  });
  d.frames.forEach((f, i) => validateFrame(f, numbers[i] as number));
  return doc as BlenderMotionDocument;
}

const ACTIONS = ['IDLE', 'HOP', 'AIRBORNE', 'LAND', 'PERCH', 'INSPECT', 'TRACE', 'MANTLE', 'PUSH_THROUGH'];
const PHASES = ['HOLD', 'ORIENT', 'PRELOAD', 'TAKEOFF', 'FLIGHT', 'REACH', 'CONTACT', 'SETTLE', 'STEP', 'HANG', 'PULL', 'BRACE', 'LOAD', 'DRIVE', 'FALL'];
const CONTACTS = ['NONE', 'GROUND', 'PLATFORM'];

function validateFrame(f: unknown, expected: number): void {
  const w = `frames[${expected}]`;
  const r = closedKeys(f, ['frame', 'segment', 'visible', 'opacity', 'place', 'semantic', 'pose'], w);
  if (r.frame !== expected) throw new BlenderBridgeError(`${w}.frame must be ${expected}`);
  if (typeof r.segment !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(r.segment)) throw new BlenderBridgeError(`${w}.segment must be a segment id`);
  if (typeof r.visible !== 'boolean') throw new BlenderBridgeError(`${w}.visible must be a boolean`);
  num(r.opacity, `${w}.opacity`, 0, 1);
  const place = closedKeys(r.place, ['x', 'y', 'scale', 'facing'], `${w}.place`);
  num(place.x, `${w}.place.x`, -4000, 6000);
  num(place.y, `${w}.place.y`, -4000, 6000);
  num(place.scale, `${w}.place.scale`, 0.05, 4);
  if (place.facing !== 1 && place.facing !== -1) throw new BlenderBridgeError(`${w}.place.facing must be 1 or -1`);
  const sem = closedKeys(r.semantic, ['action', 'phase', 'contact', 'offStage', 'surface', 'support', 'platformDip', 'landingImpulse', 'velocity', 'pitchDeg', 'stretch', 'tail', 'focus'], `${w}.semantic`);
  if (!ACTIONS.includes(sem.action as string)) throw new BlenderBridgeError(`${w}.semantic.action is unknown`);
  if (!PHASES.includes(sem.phase as string)) throw new BlenderBridgeError(`${w}.semantic.phase is unknown`);
  if (!CONTACTS.includes(sem.contact as string)) throw new BlenderBridgeError(`${w}.semantic.contact is unknown`);
  if (typeof sem.offStage !== 'boolean') throw new BlenderBridgeError(`${w}.semantic.offStage must be a boolean`);
  if (sem.surface !== null) {
    const s = closedKeys(sem.surface, ['id', 'support', 'y'], `${w}.semantic.surface`);
    if (typeof s.id !== 'string' || !/^[A-Za-z0-9:#._-]{1,120}$/.test(s.id)) throw new BlenderBridgeError(`${w}.semantic.surface.id is not a surface id`);
    if (!['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE'].includes(s.support as string)) throw new BlenderBridgeError(`${w}.semantic.surface does not carry feet`);
    num(s.y, `${w}.semantic.surface.y`, -4000, 6000);
  } else if (r.visible && sem.contact !== 'NONE' && !sem.offStage) {
    throw new BlenderBridgeError(`${w} stands on nothing declared`);
  }
  if (sem.support !== null) {
    const s = closedKeys(sem.support, ['x0', 'x1'], `${w}.semantic.support`);
    num(s.x0, `${w}.semantic.support.x0`, -1e7, 1e7);
    num(s.x1, `${w}.semantic.support.x1`, -1e7, 1e7);
  }
  num(sem.platformDip, `${w}.semantic.platformDip`, -10, 10);
  num(sem.landingImpulse, `${w}.semantic.landingImpulse`, 0, 1);
  const v = closedKeys(sem.velocity, ['x', 'y'], `${w}.semantic.velocity`);
  num(v.x, `${w}.semantic.velocity.x`, -1e5, 1e5);
  num(v.y, `${w}.semantic.velocity.y`, -1e5, 1e5);
  num(sem.pitchDeg, `${w}.semantic.pitchDeg`, -90, 90);
  num(sem.stretch, `${w}.semantic.stretch`, -1, 1);
  const tail = closedKeys(sem.tail, ['swing', 'curl', 'tension', 'lag'], `${w}.semantic.tail`);
  for (const k of ['swing', 'curl', 'tension', 'lag']) num(tail[k], `${w}.semantic.tail.${k}`, -180, 180);
  if (sem.focus !== null) {
    const fo = closedKeys(sem.focus, ['x', 'y'], `${w}.semantic.focus`);
    num(fo.x, `${w}.semantic.focus.x`, -4000, 6000);
    num(fo.y, `${w}.semantic.focus.y`, -4000, 6000);
  }
  const pose = closedKeys(r.pose, ['clips', 'rot', 'hip', 'stance', 'heel', 'gaze', 'lid', 'brow', 'ik', 'targets', 'tailFree'], `${w}.pose`);
  if (pose.clips === null || typeof pose.clips !== 'object' || Array.isArray(pose.clips)) throw new BlenderBridgeError(`${w}.pose.clips must be an object`);
  let clipSum = 0;
  for (const [k, v] of Object.entries(pose.clips as Record<string, unknown>)) {
    if (!(POSE_CLIPS as readonly string[]).includes(k)) throw new BlenderBridgeError(`${w}.pose.clips names an unknown clip ${JSON.stringify(k)}`);
    num(v, `${w}.pose.clips.${k}`, 0, 1);
    clipSum += v as number;
  }
  if (Math.abs(clipSum - 1) > 1e-6) throw new BlenderBridgeError(`${w}.pose.clips must sum to 1`);
  const rot = closedKeys(pose.rot, RIG_BONES, `${w}.pose.rot`);
  for (const b of RIG_BONES) num(rot[b], `${w}.pose.rot.${b}`, -4 * Math.PI, 4 * Math.PI);
  vec(pose.hip, `${w}.pose.hip`, 400);
  num(pose.stance, `${w}.pose.stance`, -200, 200);
  num(pose.heel, `${w}.pose.heel`, -Math.PI, Math.PI);
  vec(pose.gaze, `${w}.pose.gaze`, 400);
  num(pose.lid, `${w}.pose.lid`, 0, 1);
  num(pose.brow, `${w}.pose.brow`, -Math.PI, Math.PI);
  const ik = closedKeys(pose.ik, IK_GROUPS, `${w}.pose.ik`);
  for (const g of IK_GROUPS) num(ik[g], `${w}.pose.ik.${g}`, 0, 1);
  const targets = closedKeys(pose.targets, TARGETS, `${w}.pose.targets`);
  for (const t of TARGETS) vec(targets[t], `${w}.pose.targets.${t}`, 400);
  num(pose.tailFree, `${w}.pose.tailFree`, 0, 1);
}
