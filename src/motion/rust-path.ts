// Which WalletWallaby paths the Rust/WASM Motion Intelligence engine performs, and how its plans
// meet the composition. v1 migrates one real path of the committed lesson: the takeaway segment's
// HOP to the statement, the landing on the summit ledge, and the perch that follows. Every other
// clip stays on the transitional TypeScript solver (../character/walletwallaby/motion.ts), which is
// also the oracle these paths are checked against, frame by frame.
//
// Ownership on an engine path. The lesson still decides WHERE and WHEN (the clips). The engine
// decides HOW the body moves: position and velocity, phase, pitch, leg load, squash and stretch,
// tail swing, curl and tension, head, ears, landing impulse. The transitional motion layer still
// picks the expressive key-pose blend, expression, gaze, and support, and Rive performs the body.
// Isomorphic: the composition binds and samples plans; it never runs the engine.

import motionIntelligenceJson from '../../config/motion-intelligence.json' with { type: 'json' };
import { planHop, sampleWallaby, type BodyAction, type BodyPhase, type HopMotion, type MotionEvent, type MotionPlan as TsMotionPlan, type Surface, type WallabyState } from '../character/walletwallaby/motion.ts';
import type { Clip } from '../character/walletwallaby/choreography.ts';
import { blendPose, POSES, TAKEOFF, WALLABY_HEIGHT, type PoseParams, type Viseme } from '../character/walletwallaby/rig.ts';
import { easeOut } from '../layout/geometry.ts';
import type { SceneLayout } from '../layout/scene-layout.ts';
import type { VideoSpec } from '../spec/types.ts';
import { INPUT_SCHEMA, limitsOf, MOTION_PHASES, MotionEngineError, validateMotionPlan, type MotionAction, type MotionContact, type MotionInput, type MotionIntelligenceConfig, type MotionPhase, type MotionPlan, type MotionStance, type MotionState, type MotionSurface, type PlanExpectation } from './plan.ts';

/** config/motion-intelligence.json, as committed (the engine validates it; tests pin it to its version). */
export const MOTION_INTELLIGENCE_CONFIG = motionIntelligenceJson as MotionIntelligenceConfig;

export interface RustPathSelection {
  videoId: string;
  segmentId: string;
  action: Extract<MotionAction, 'HOP' | 'LAND' | 'PERCH'>;
}

/** The paths the engine performs when a render selects `--motion-engine=rust-wasm`. */
export const RUST_MOTION_PATHS: readonly RustPathSelection[] = [{ videoId: 'migration-readiness', segmentId: 'takeaway', action: 'HOP' }];

export interface MotionEngineProps {
  schema: 'walletwall.motion-engine-props/v1';
  engine: 'rust-wasm';
  paths: { segmentId: string; action: RustPathSelection['action']; plan: MotionPlan }[];
}

/** A selected path found in the clips: a hop followed by the perch at its anchor. */
export interface RustPath {
  selection: RustPathSelection;
  travelIndex: number;
  travel: Clip;
  hold: Clip;
  hop: HopMotion;
  surfaces: TsMotionPlan['surfaces'][number];
  /** This hop's own takeoff and landing: the engine produces their secondary motion. */
  events: ReadonlySet<MotionEvent>;
}

const frameMs = (frame: number, fps: number): number => (frame * 1000) / fps;
/** The last video frame strictly before `ms`. */
const lastFrameBefore = (ms: number, fps: number): number => {
  let f = Math.ceil((ms * fps) / 1000);
  while (f > 0 && frameMs(f, fps) >= ms) f--;
  return f;
};

function ineligible(sel: RustPathSelection, why: string): never {
  throw new MotionEngineError('INELIGIBLE_PATH', `${sel.videoId}/${sel.segmentId} ${sel.action}: ${why}`);
}

/**
 * Find a selected path and check it is one engine v1 can perform exactly. Fails closed: a selected
 * path the engine cannot own stops the render, it never falls back to the TypeScript solver.
 */
export function findRustPath(ts: TsMotionPlan, sel: RustPathSelection): RustPath {
  const matches = ts.clips.flatMap((c, i) => (c.segmentId === sel.segmentId && c.kind === 'TRAVEL' && c.action === sel.action ? [i] : []));
  if (matches.length !== 1) ineligible(sel, `${matches.length} matching travel clips; exactly one is required`);
  const i = matches[0]!;
  const travel = ts.clips[i]!;
  const hold = ts.clips[i + 1];
  const hop = ts.motions[i]!;
  if (hop.kind !== 'HOP') ineligible(sel, `the move is a ${hop.kind.toLowerCase()}, and engine v1 performs single hops only`);
  if (!hold || hold.kind !== 'HOLD' || hold.segmentId !== travel.segmentId || hold.from.x !== travel.to.x || hold.from.y !== travel.to.y || hold.fromScale !== travel.toScale) ineligible(sel, 'the hop does not end in a perch on its anchor');
  if (hold.lookAlt) ineligible(sel, 'a comparing perch is not performed by engine v1');
  // The surface-aware arc search is still TypeScript: engine v1 flies only the natural arc.
  const natural = planHop({ from: travel.from, to: travel.to, fromScale: travel.fromScale, toScale: travel.toScale, startMs: travel.startMs, endMs: travel.endMs }, ts.config);
  if (natural.depthPx !== hop.depthPx) ineligible(sel, 'the hop needs the surface-aware arc search, which has not moved to the engine yet');
  const surfaces = ts.surfaces[i]!;
  const narrow = surfaces.to && surfaces.to.x1 - surfaces.to.x0 < ts.config.tail.narrowWidthBodyHeights * WALLABY_HEIGHT * travel.toScale;
  if (narrow) ineligible(sel, 'balancing on a narrow perch is not performed by engine v1');
  // The engine takes over a body at rest and hands back a body at rest: no other event's secondary
  // motion may be running anywhere in the window, and this landing's must have ended by its close.
  const window = Math.max(...Object.values(ts.config.response).map((r) => r.windowMs));
  const own = ts.events.filter((e) => e.segmentId === travel.segmentId && ((e.kind === 'TAKEOFF' && e.atMs === hop.takeoffMs) || (e.kind === 'LANDING' && e.atMs === hop.contactMs)));
  if (own.length !== 2) ineligible(sel, 'the hop does not carry exactly one takeoff and one landing');
  for (const e of ts.events) {
    if (own.includes(e)) continue;
    if (e.atMs < hold.endMs && e.atMs + window > travel.startMs) ineligible(sel, `a ${e.kind} at ${Math.round(e.atMs)} ms is still settling inside the engine's window`);
  }
  if (hold.endMs - hop.contactMs < window) ineligible(sel, 'the perch ends before the landing has settled');
  return { selection: sel, travelIndex: i, travel, hold, hop, surfaces, events: new Set(own) };
}

/** The transitional layer's body at an instant, without this path's own spring responses. */
const quiet = (p: RustPath, ts: TsMotionPlan, ms: number, mouth: Viseme = 'REST'): WallabyState => sampleWallaby(ts, ms, mouth, p.events);

/** `0` for either zero: JSON cannot carry a negative zero, so the engine never sees one. */
const positiveZero = (v: number): number => (v === 0 ? 0 : v);

/** The posture the engine takes the body over in, and the one it must hand it back in. */
function handOffStances(p: RustPath, ts: TsMotionPlan, fps: number): { initial: MotionStance; rest: MotionStance } {
  const at = (state: WallabyState, where: string): MotionStance => {
    const { tail } = state.motion;
    if (tail.curl !== 0 || tail.tension !== ts.config.tail.restTension || state.motion.contact === 'NONE') ineligible(p.selection, `the body is not at rest ${where}`);
    return { crouch: positiveZero(state.pose.crouch), tailDeg: positiveZero(tail.swing) };
  };
  return {
    initial: at(quiet(p, ts, p.travel.startMs), 'when the hop begins'),
    rest: at(quiet(p, ts, frameMs(lastFrameBefore(p.hold.endMs, fps), fps)), 'when the perch ends'),
  };
}

function surfaceOf(s: Surface | null, layout: SceneLayout | undefined, sel: RustPathSelection): MotionSurface | null {
  if (!s) return null;
  const platform = layout?.platforms.find((x) => x.id === s.id);
  if (!platform || platform.kind === 'FRAME') ineligible(sel, `surface ${s.id} is not terrain in its layout`);
  return { kind: platform.kind, topY: platform.rect.y, leftX: platform.rect.x, rightX: platform.rect.x + platform.rect.w };
}

/** The lesson's motion intent for one path, as engine input. No physics here: fixed endpoints, a window, the terrain, the stances. */
export function motionInputForPath(p: RustPath, ts: TsMotionPlan, layouts: Map<string, SceneLayout>, output: VideoSpec['output'], config: MotionIntelligenceConfig = MOTION_INTELLIGENCE_CONFIG): MotionInput {
  const layout = layouts.get(p.travel.segmentId);
  return {
    schema: INPUT_SCHEMA,
    action: p.selection.action,
    start: { x: p.travel.from.x, y: p.travel.from.y },
    target: { x: p.travel.to.x, y: p.travel.to.y },
    startScale: p.travel.fromScale,
    targetScale: p.travel.toScale,
    timing: { startMs: p.travel.startMs, arriveByMs: p.travel.endMs, endMs: p.hold.endMs },
    fps: output.fps,
    stage: { width: output.width, height: output.height },
    terrain: { start: surfaceOf(p.surfaces.from, layout, p.selection), target: surfaceOf(p.surfaces.to, layout, p.selection) },
    stance: handOffStances(p, ts, output.fps),
    config,
  };
}

/** What a plan for this path must agree with, derived from the clips alone (no engine input needed). */
export function expectationForPath(p: RustPath, ts: TsMotionPlan, fps: number, config: MotionIntelligenceConfig = MOTION_INTELLIGENCE_CONFIG): PlanExpectation {
  const contact = (s: Surface | null): MotionContact => (s ? 'PLATFORM' : 'GROUND');
  return {
    action: p.selection.action,
    start: { x: p.travel.from.x, y: p.travel.from.y },
    target: { x: p.travel.to.x, y: p.travel.to.y },
    timing: { startMs: p.travel.startMs, arriveByMs: p.travel.endMs, endMs: p.hold.endMs },
    fps,
    rest: handOffStances(p, ts, fps).rest,
    contactAtStart: contact(p.surfaces.from),
    contactAtTarget: contact(p.surfaces.to),
    limits: limitsOf(config),
  };
}

// ── Binding and sampling (the composition) ──────────────────────────────────

export interface BoundRustPath extends RustPath {
  plan: MotionPlan;
  /** Frames [first, end) the engine performs. */
  first: number;
  end: number;
  /** The body the engine took over (its key-pose blend), for the preload and push-off. */
  entryPose: PoseParams;
}

export interface BoundMotionEngine {
  engine: 'typescript' | 'rust-wasm';
  paths: BoundRustPath[];
}

const TYPESCRIPT_ENGINE: BoundMotionEngine = Object.freeze({ engine: 'typescript', paths: [] });

function mismatch(why: string): never {
  throw new MotionEngineError('BINDING_MISMATCH', why);
}

/**
 * Bind engine plans to the clips the composition computed: each plan must answer exactly the path
 * it names, agree with the transitional solver on liftoff and contact (the scene's platform dip and
 * contact sounds are timed to them), and pass validateMotionPlan. Without engine props the video
 * renders on the TypeScript solver alone, unchanged. Fails closed on any disagreement.
 */
export function bindMotionEngine(props: MotionEngineProps | undefined, ts: TsMotionPlan, fps: number, videoId: string): BoundMotionEngine {
  if (props === undefined) return TYPESCRIPT_ENGINE;
  if (!props || props.schema !== 'walletwall.motion-engine-props/v1' || props.engine !== 'rust-wasm' || !Array.isArray(props.paths)) mismatch('motion engine props are not walletwall.motion-engine-props/v1 for rust-wasm');
  const selected = RUST_MOTION_PATHS.filter((s) => s.videoId === videoId);
  if (props.paths.length !== selected.length) mismatch(`${videoId} selects ${selected.length} engine paths; the props carry ${props.paths.length}`);
  const paths = selected.map((sel) => {
    const entry = props.paths.find((x) => x.segmentId === sel.segmentId && x.action === sel.action);
    if (!entry) mismatch(`no engine plan for ${sel.segmentId} ${sel.action}`);
    const p = findRustPath(ts, sel);
    const plan = validateMotionPlan(entry.plan, expectationForPath(p, ts, fps));
    if (plan.timing.liftoffMs !== p.hop.takeoffMs || plan.timing.contactMs !== p.hop.contactMs || plan.timing.orientEndMs !== p.hop.orientEndMs) mismatch(`${sel.segmentId}: the engine's liftoff and contact are not the transitional solver's`);
    if (plan.trajectory.depthPx !== p.hop.depthPx || plan.trajectory.gravityPxPerS2 !== p.hop.gravityPx) mismatch(`${sel.segmentId}: the engine flew a different arc from the transitional solver`);
    return { ...p, plan, first: plan.frames.first, end: plan.frames.first + plan.frames.count, entryPose: quiet(p, ts, p.travel.startMs).pose };
  });
  paths.sort((a, b) => a.first - b.first);
  for (let k = 1; k < paths.length; k++) if (paths[k]!.first < paths[k - 1]!.end) mismatch('engine paths overlap');
  return { engine: 'rust-wasm', paths };
}

const ORDER = (p: MotionPhase): number => MOTION_PHASES.indexOf(p);

/** The engine's phase in the vocabulary the rig and the reviews use. */
function vocabulary(s: MotionState, hold: BodyAction): { action: BodyAction; phase: BodyPhase } {
  switch (s.phase) {
    case 'IDLE':
      return { action: 'HOP', phase: 'ORIENT' };
    case 'PRELOAD':
      return { action: 'HOP', phase: 'PRELOAD' };
    case 'TAKEOFF':
      return { action: 'HOP', phase: 'TAKEOFF' };
    case 'AIRBORNE':
      return { action: 'AIRBORNE', phase: s.phaseProgress < 0.72 ? 'FLIGHT' : 'REACH' };
    case 'CONTACT':
    case 'COMPRESSION':
      return { action: 'LAND', phase: 'CONTACT' };
    case 'SETTLE':
      return { action: 'LAND', phase: 'SETTLE' };
    case 'PERCH':
      return { action: hold, phase: 'HOLD' };
  }
}

/**
 * Perform one engine state. The transitional layer contributes the expressive parts (key-pose
 * blend, expression, gaze, focus, support, platform dip) without this hop's spring responses; the
 * engine supplies every physical channel. Before handing anything to the rig, the oracle and the
 * engine must agree on where the feet are, exactly.
 */
function performEngineState(p: BoundRustPath, ts: TsMotionPlan, frame: number, ms: number, mouth: Viseme): WallabyState {
  const s = p.plan.samples[frame - p.first]!;
  const base = quiet(p, ts, ms, mouth);
  if (base.x !== s.position.x || base.y !== s.position.y + base.motion.platformDip || base.scale !== s.scale || base.motion.contact !== s.contact) mismatch(`frame ${frame}: the engine and the transitional solver disagree on where the feet are`);
  const { limits } = ts.config;
  // The engine's preload and push-off timing drives the key-pose blend before liftoff; from liftoff
  // on the two agree on every instant, so the transitional blend stands.
  const load = p.entryPose.crouch < 1 ? (s.crouch - p.entryPose.crouch) / (1 - p.entryPose.crouch) : 1;
  const pose: PoseParams =
    s.phase === 'PRELOAD' ? blendPose(p.entryPose, POSES.PREPARE_JUMP, Math.min(1, Math.max(0, load)))
    : s.phase === 'TAKEOFF' ? blendPose(POSES.PREPARE_JUMP, TAKEOFF, easeOut(s.phaseProgress))
    : s.phase === 'IDLE' ? p.entryPose
    : base.pose;
  const landed = ORDER(s.phase) > ORDER('AIRBORNE');
  return {
    ...base,
    pose: { ...pose, crouch: landed ? s.crouch : base.pose.crouch },
    motion: {
      ...base.motion,
      ...vocabulary(s, base.motion.action),
      rotation: s.bodyPitch,
      stretch: s.stretch * limits.maxStretch - s.compression * limits.maxCompression,
      tailLag: 0,
      earLag: s.earLag,
      headStab: s.headAngle,
      velocity: { x: s.velocity.x, y: s.velocity.y },
      landingImpulse: s.landingImpulse,
      tail: { swing: s.tailAngle, curl: s.tailCurl, tension: s.tailTension },
    },
  };
}

/** WalletWallaby at frame `frame` (= `ms`): the engine's state on its paths, the TypeScript solver elsewhere. */
export function sampleWithEngine(bound: BoundMotionEngine, ts: TsMotionPlan, frame: number, ms: number, mouth: Viseme = 'REST'): WallabyState {
  for (const p of bound.paths) if (frame >= p.first && frame < p.end) return performEngineState(p, ts, frame, ms, mouth);
  return sampleWallaby(ts, ms, mouth);
}
