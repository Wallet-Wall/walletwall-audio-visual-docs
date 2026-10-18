// Which WalletWallaby paths the Rust/WASM Motion Intelligence engine performs, and how its plans
// meet the composition. The engine performs every hop of a selected lesson that ends in a perch on
// its anchor: the preload and push-off, the flight on the arc its surface-aware search keeps clear
// of the scene's text, the landing, and the perch. Every other move (chained skips, traces, mantles,
// push-through, drop-in, exit leaps, and a hop that runs straight into a trace) stays on the
// transitional TypeScript solver (../character/walletwallaby/motion.ts), which is also the exact
// oracle the engine's paths are checked against.
//
// Ownership on an engine path. The lesson still decides WHERE and WHEN (the clips). The engine
// decides HOW the body moves: position and velocity, phase, pitch, leg load, squash and stretch,
// tail swing, curl and tension, head, ears, landing impulse. It also states its contacts with the
// terrain, and the scene reacts to those (the platform's dip under the feet, the contact sounds), so
// the scene stays in step with the body the engine performs. The transitional motion layer still
// picks the expressive key-pose blend, expression, gaze, and support, timed by its own hop, which is
// why the composition still requires the engine to fly exactly the oracle's hop. Rive performs the
// body. Isomorphic: the composition binds and samples plans; it never runs the engine.

import motionIntelligenceJson from '../../config/motion-intelligence.json' with { type: 'json' };
import { protectedText, sampleWallaby, type BodyAction, type BodyPhase, type ClipMotion, type HopMotion, type MotionEvent, type MotionPlan as TsMotionPlan, type Surface, type WallabyState } from '../character/walletwallaby/motion.ts';
import type { Clip } from '../character/walletwallaby/choreography.ts';
import { blendPose, POSES, TAKEOFF, WALLABY_HEIGHT, type PoseParams, type Viseme } from '../character/walletwallaby/rig.ts';
import { easeOut } from '../layout/geometry.ts';
import { WALLABY_EXTENT, type SceneLayout } from '../layout/scene-layout.ts';
import type { VideoSpec } from '../spec/types.ts';
import { INPUT_SCHEMA, limitsOf, MOTION_PHASES, MotionEngineError, validateMotionPlan, type MotionAction, type MotionContact, type MotionInput, type MotionIntelligenceConfig, type MotionPhase, type MotionPlan, type MotionStance, type MotionState, type MotionSurface, type PlanExpectation } from './plan.ts';

/** config/motion-intelligence.json, as committed (the engine validates it; tests pin it to its version). */
export const MOTION_INTELLIGENCE_CONFIG = motionIntelligenceJson as MotionIntelligenceConfig;

/** A lesson whose moves the engine performs when a render selects `--motion-engine=rust-wasm`. */
export interface RustMotionVideo {
  videoId: string;
  /** HOPS_TO_PERCHES: every TRAVEL clip the transitional solver performs as a single hop that ends in a perch on its anchor. */
  paths: 'HOPS_TO_PERCHES';
}

/** The lessons whose hops the engine performs. */
export const RUST_MOTION_PATHS: readonly RustMotionVideo[] = [{ videoId: 'migration-readiness', paths: 'HOPS_TO_PERCHES' }];

/** One path a video selects for the engine. */
export interface RustPathSelection {
  videoId: string;
  segmentId: string;
  /** The TRAVEL clip's index in the video's choreography. */
  clip: number;
  /** What the engine is asked for: LAND or PERCH where the lesson says so, otherwise HOP (the traversal is a hop either way). */
  action: Extract<MotionAction, 'HOP' | 'LAND' | 'PERCH'>;
}

export interface MotionEngineProps {
  schema: 'walletwall.motion-engine-props/v2';
  engine: 'rust-wasm';
  /** One plan per selected path, in clip order. */
  paths: { segmentId: string; clip: number; action: RustPathSelection['action']; plan: MotionPlan }[];
}

/** A selected path found in the clips: a hop followed by the perch at its anchor. */
export interface RustPath {
  selection: RustPathSelection;
  travelIndex: number;
  travel: Clip;
  hold: Clip;
  hop: HopMotion;
  surfaces: TsMotionPlan['surfaces'][number];
  /** This hop's own takeoff and landing in the transitional plan: the engine produces their secondary motion and replaces them as the scene's contacts. */
  events: ReadonlySet<MotionEvent>;
}

const frameMs = (frame: number, fps: number): number => (frame * 1000) / fps;
/** The last video frame strictly before `ms`. */
const lastFrameBefore = (ms: number, fps: number): number => {
  let f = Math.ceil((ms * fps) / 1000);
  while (f > 0 && frameMs(f, fps) >= ms) f--;
  return f;
};
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function ineligible(sel: RustPathSelection, why: string): never {
  throw new MotionEngineError('INELIGIBLE_PATH', `${sel.videoId}/${sel.segmentId} clip ${sel.clip} ${sel.action}: ${why}`);
}

/** The travel ends in a perch on its own anchor: a hold in the same segment, standing exactly where and as large as the travel arrived. */
const perchesOn = (travel: Clip, next: Clip | undefined): next is Clip => next !== undefined && next.kind === 'HOLD' && next.segmentId === travel.segmentId && next.from.x === travel.to.x && next.from.y === travel.to.y && next.fromScale === travel.toScale;
const engineAction = (travel: Clip): RustPathSelection['action'] => (travel.action === 'LAND' || travel.action === 'PERCH' ? travel.action : 'HOP');
const moveName = (m: ClipMotion): string => (m.kind === 'TRACE' ? (m.mode === 'SKIP' ? 'chained skip' : 'trace') : m.kind.toLowerCase());

/** The paths a video selects, in clip order: every TRAVEL clip the transitional solver performs as a hop that ends in a perch (none for a video the engine does not perform). */
export function selectRustPaths(ts: TsMotionPlan, videoId: string): RustPathSelection[] {
  if (!RUST_MOTION_PATHS.some((v) => v.videoId === videoId)) return [];
  return ts.clips.flatMap((c, i) => (c.kind === 'TRAVEL' && ts.motions[i]!.kind === 'HOP' && perchesOn(c, ts.clips[i + 1]) ? [{ videoId, segmentId: c.segmentId, clip: i, action: engineAction(c) }] : []));
}

/** A hop's own takeoff and landing in the transitional plan. */
function hopEvents(ts: TsMotionPlan, travel: Clip, hop: HopMotion): MotionEvent[] {
  return ts.events.filter((e) => e.segmentId === travel.segmentId && ((e.kind === 'TAKEOFF' && e.atMs === hop.takeoffMs) || (e.kind === 'LANDING' && e.atMs === hop.contactMs)));
}

/**
 * Check that a selected path is one the engine can perform exactly. Fails closed: a selected path the
 * engine cannot own stops the render; it never falls back to the TypeScript solver. `engineOwned`:
 * the transitional events every selected path owns (they have no TypeScript follow-through at all).
 */
export function findRustPath(ts: TsMotionPlan, sel: RustPathSelection, engineOwned: ReadonlySet<MotionEvent> = new Set()): RustPath {
  const i = sel.clip;
  const travel = ts.clips[i];
  if (!travel || travel.kind !== 'TRAVEL' || travel.segmentId !== sel.segmentId) ineligible(sel, 'there is no such travel clip in this segment');
  const hop = ts.motions[i]!;
  if (hop.kind !== 'HOP') ineligible(sel, `the move is a ${moveName(hop)}, which stays on the TypeScript solver`);
  const hold = ts.clips[i + 1];
  if (!perchesOn(travel, hold)) ineligible(sel, 'the hop does not end in a perch on its anchor');
  if (engineAction(travel) !== sel.action) ineligible(sel, `the lesson asks for ${engineAction(travel)} here`);
  if (hold.lookAlt) ineligible(sel, 'a comparing perch is not performed by the engine');
  const surfaces = ts.surfaces[i]!;
  const narrow = surfaces.to && surfaces.to.x1 - surfaces.to.x0 < ts.config.tail.narrowWidthBodyHeights * WALLABY_HEIGHT * travel.toScale;
  if (narrow) ineligible(sel, 'balancing on a narrow perch is not performed by the engine');
  const own = hopEvents(ts, travel, hop);
  if (own.length !== 2) ineligible(sel, 'the hop does not carry exactly one takeoff and one landing');
  // The engine takes over a body at rest. Another move's follow-through may still be running when its
  // window opens only if it is a takeoff's or a push's (tail and ears only), which the composition
  // carries on on top of the engine's own; a landing's, a step's, or a weight shift's (crouch,
  // compression, head) may not. Events another engine path owns have no follow-through here at all:
  // the engine settles each of its own landings inside its own window.
  const window = Math.max(...Object.values(ts.config.response).map((r) => r.windowMs));
  for (const e of ts.events) {
    if (own.includes(e) || engineOwned.has(e) || e.kind === 'TAKEOFF' || e.kind === 'PUSH') continue;
    if (e.atMs < hold.endMs && e.atMs + window > travel.startMs) ineligible(sel, `a ${e.kind} at ${Math.round(e.atMs)} ms is still settling inside the engine's window`);
  }
  return { selection: sel, travelIndex: i, travel, hold, hop, surfaces, events: new Set(own) };
}

/** Every path a video selects, each checked for eligibility (fails closed on the first that is not). */
export function findRustPaths(ts: TsMotionPlan, videoId: string): RustPath[] {
  const selections = selectRustPaths(ts, videoId);
  const owned = new Set(
    selections.flatMap((sel) => {
      const m = ts.motions[sel.clip]!;
      return m.kind === 'HOP' ? hopEvents(ts, ts.clips[sel.clip]!, m) : [];
    }),
  );
  return selections.map((sel) => findRustPath(ts, sel, owned));
}

/** The transitional events whose secondary motion the engine produces on these paths. */
export const engineOwnedEvents = (paths: readonly RustPath[]): ReadonlySet<MotionEvent> => new Set(paths.flatMap((p) => [...p.events]));

/** `0` for either zero: JSON cannot carry a negative zero, so the engine never sees one. */
const positiveZero = (v: number): number => (v === 0 ? 0 : v);

/**
 * The posture the engine takes the body over in, and the one it must hand it back in: the
 * transitional layer's, without the engine paths' own follow-through (`muted`). The tail's curl and
 * tension are part of it (a perch that leans in to inspect lifts and curls the tail).
 */
function handOffStances(p: RustPath, ts: TsMotionPlan, fps: number, muted: ReadonlySet<MotionEvent>): { initial: MotionStance; rest: MotionStance } {
  const at = (ms: number, where: string): MotionStance => {
    const state = sampleWallaby(ts, ms, 'REST', muted);
    if (state.motion.contact === 'NONE') ineligible(p.selection, `the body is not standing ${where}`);
    const { tail } = state.motion;
    return { crouch: positiveZero(state.pose.crouch), tailDeg: positiveZero(tail.swing), tailCurl: positiveZero(tail.curl), tailTension: positiveZero(tail.tension) };
  };
  return {
    initial: at(p.travel.startMs, 'when the hop begins'),
    rest: at(frameMs(lastFrameBefore(p.hold.endMs, fps), fps), 'when the perch ends'),
  };
}

function surfaceOf(s: Surface | null, layout: SceneLayout | undefined, sel: RustPathSelection): MotionSurface | null {
  if (!s) return null;
  const platform = layout?.platforms.find((x) => x.id === s.id);
  if (!platform || platform.kind === 'FRAME') ineligible(sel, `surface ${s.id} is not terrain in its layout`);
  return { kind: platform.kind, topY: platform.rect.y, leftX: platform.rect.x, rightX: platform.rect.x + platform.rect.w };
}

/**
 * The lesson's motion intent for one path, as engine input. No physics here: fixed endpoints, a
 * window, the terrain (surfaces, the text the transitional solver keeps clear, the figure's box), the
 * stances. `muted`: the transitional events every engine path owns.
 */
export function motionInputForPath(p: RustPath, ts: TsMotionPlan, layouts: Map<string, SceneLayout>, output: VideoSpec['output'], muted: ReadonlySet<MotionEvent>, config: MotionIntelligenceConfig = MOTION_INTELLIGENCE_CONFIG): MotionInput {
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
    terrain: {
      start: surfaceOf(p.surfaces.from, layout, p.selection),
      target: surfaceOf(p.surfaces.to, layout, p.selection),
      // Exactly the list the transitional solver's arc search avoids, in its order.
      protectedText: (protectedText(layout) ?? []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
      figure: { left: WALLABY_EXTENT.left, right: WALLABY_EXTENT.right, top: WALLABY_EXTENT.top },
    },
    stance: handOffStances(p, ts, output.fps, muted),
    config,
  };
}

/** What a plan for this path must agree with, derived from the clips alone (no engine input needed). */
export function expectationForPath(p: RustPath, ts: TsMotionPlan, fps: number, muted: ReadonlySet<MotionEvent>, config: MotionIntelligenceConfig = MOTION_INTELLIGENCE_CONFIG): PlanExpectation {
  const contact = (s: Surface | null): MotionContact => (s ? 'PLATFORM' : 'GROUND');
  return {
    action: p.selection.action,
    start: { x: p.travel.from.x, y: p.travel.from.y },
    target: { x: p.travel.to.x, y: p.travel.to.y },
    startScale: p.travel.fromScale,
    targetScale: p.travel.toScale,
    timing: { startMs: p.travel.startMs, arriveByMs: p.travel.endMs, endMs: p.hold.endMs },
    fps,
    rest: handOffStances(p, ts, fps, muted).rest,
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
  /** The transitional plan the paths were bound to: the engine paths' own events are its event objects. */
  transitional: TsMotionPlan;
  paths: BoundRustPath[];
  /**
   * Every contact the scene reacts to (each platform's dip, the contact cues), in time order: the
   * transitional solver's, with each engine path's own takeoff and landing replaced by the engine's.
   */
  contacts: readonly MotionEvent[];
  /** The transitional events whose secondary motion the engine produces: the TypeScript layer leaves their spring responses out everywhere (its expressive layer still reads them). */
  muted: ReadonlySet<MotionEvent>;
}

function mismatch(why: string): never {
  throw new MotionEngineError('BINDING_MISMATCH', why);
}

/**
 * The scene's contacts on these engine paths: the transitional events, each engine path's own
 * takeoff and landing replaced by the contacts its plan states. A takeoff moves no platform (the
 * feet leave it, as in the transitional plan); a landing carries the surface under the target.
 */
export function engineContacts(ts: TsMotionPlan, paths: readonly (RustPath & { plan: MotionPlan })[]): MotionEvent[] {
  const replaced = engineOwnedEvents(paths);
  const stated = paths.flatMap((p) =>
    p.plan.events.map((e): MotionEvent => ({ kind: e.kind, atMs: e.atMs, impulse: e.impulse, scale: e.scale, at: { x: e.position.x, y: e.position.y }, segmentId: p.travel.segmentId, surface: e.kind === 'LANDING' ? p.surfaces.to : null })),
  );
  return [...ts.events.filter((e) => !replaced.has(e)), ...stated].sort((a, b) => a.atMs - b.atMs || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/**
 * The expressive layer on an engine path (the key-pose blend from liftoff on, the landing pose, the
 * gaze turning to the subject at touchdown) is still the transitional solver's, timed by its own
 * hop. The engine must fly exactly that hop, or the body and its expression would come apart. (The
 * scene no longer depends on this: it reacts to the engine's own contacts.)
 */
function requireOracleHop(p: RustPath, plan: MotionPlan, ts: TsMotionPlan, muted: ReadonlySet<MotionEvent>): void {
  const at = `${p.selection.segmentId} clip ${p.selection.clip}`;
  if (plan.timing.liftoffMs !== p.hop.takeoffMs || plan.timing.contactMs !== p.hop.contactMs || plan.timing.orientEndMs !== p.hop.orientEndMs) mismatch(`${at}: the engine's liftoff and contact are not the transitional solver's, which times the expressive layer`);
  if (plan.trajectory.depthPx !== p.hop.depthPx || plan.trajectory.gravityPxPerS2 !== p.hop.gravityPx) mismatch(`${at}: the engine flew a different arc from the transitional solver`);
  // And every frame, before any is drawn: a plan whose metadata names the oracle's arc but whose
  // samples fly elsewhere is refused here, not halfway through a render.
  plan.samples.forEach((s, k) => {
    const f = plan.frames.first + k;
    if (!feetAgree(ts, frameMs(f, plan.frames.fps), muted, s)) mismatch(`${at} frame ${f}: the engine and the transitional solver disagree on where the feet are`);
  });
}

const NO_CONTACTS: readonly MotionEvent[] = Object.freeze([]);

/** The oracle puts the feet exactly where the engine state does (compared without any platform dip, so nothing can round a difference away). */
function feetAgree(ts: TsMotionPlan, ms: number, muted: ReadonlySet<MotionEvent>, s: MotionState): boolean {
  const o = sampleWallaby(ts, ms, 'REST', muted, NO_CONTACTS);
  return o.x === s.position.x && o.y === s.position.y && o.scale === s.scale && o.motion.contact === s.contact;
}

/**
 * Bind engine plans to the clips the composition computed: one plan per selected path, in clip
 * order, each answering exactly the path it names and passing validateMotionPlan, each flying the
 * oracle's hop with the feet exactly where the oracle puts them on every frame (see requireOracleHop). Without engine props the video renders on the TypeScript
 * solver alone, unchanged. Fails closed on any disagreement.
 */
export function bindMotionEngine(props: MotionEngineProps | undefined, ts: TsMotionPlan, fps: number, videoId: string): BoundMotionEngine {
  if (props === undefined) return { engine: 'typescript', transitional: ts, paths: [], contacts: ts.events, muted: new Set() };
  if (!props || props.schema !== 'walletwall.motion-engine-props/v2' || props.engine !== 'rust-wasm' || !Array.isArray(props.paths)) mismatch('motion engine props are not walletwall.motion-engine-props/v2 for rust-wasm');
  const found = findRustPaths(ts, videoId);
  if (props.paths.length !== found.length) mismatch(`${videoId} selects ${found.length} engine paths; the props carry ${props.paths.length}`);
  const muted = engineOwnedEvents(found);
  const paths = found.map((p, k): BoundRustPath => {
    const entry = props.paths[k]!;
    const sel = p.selection;
    if (entry.segmentId !== sel.segmentId || entry.clip !== sel.clip || entry.action !== sel.action) mismatch(`engine plan ${k} answers ${entry.segmentId} clip ${entry.clip} ${entry.action}, not ${sel.segmentId} clip ${sel.clip} ${sel.action}`);
    const plan = validateMotionPlan(entry.plan, expectationForPath(p, ts, fps, muted));
    requireOracleHop(p, plan, ts, muted);
    return { ...p, plan, first: plan.frames.first, end: plan.frames.first + plan.frames.count, entryPose: sampleWallaby(ts, p.travel.startMs, 'REST', muted).pose };
  });
  for (let k = 1; k < paths.length; k++) if (paths[k]!.first < paths[k - 1]!.end) mismatch('engine paths overlap');
  return { engine: 'rust-wasm', transitional: ts, paths, contacts: engineContacts(ts, paths), muted };
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

/** The transitional layer's body without the engine's follow-through, standing on platforms that react to the scene's contacts. */
const quiet = (bound: BoundMotionEngine, ts: TsMotionPlan, ms: number, mouth: Viseme): WallabyState => sampleWallaby(ts, ms, mouth, bound.muted, bound.contacts);

/**
 * Perform one engine state. The transitional layer contributes the expressive parts (key-pose blend,
 * expression, gaze, focus, support) without the engine paths' own spring responses, and the platform
 * under the feet dips with the scene's contacts; the engine supplies every physical channel. Before
 * handing anything to the rig, the oracle and the engine must agree on where the feet are, exactly.
 */
function performEngineState(p: BoundRustPath, bound: BoundMotionEngine, ts: TsMotionPlan, frame: number, ms: number, mouth: Viseme): WallabyState {
  const s = p.plan.samples[frame - p.first]!;
  if (!feetAgree(ts, ms, bound.muted, s)) mismatch(`frame ${frame}: the engine and the transitional solver disagree on where the feet are`);
  const base = quiet(bound, ts, ms, mouth);
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
      // Another move's tail and ear follow-through still running when the engine took over (a
      // takeoff's, never a landing's: see findRustPath) carries on on top of the engine's own.
      tailLag: base.motion.tailLag,
      earLag: clamp(s.earLag + base.motion.earLag, -limits.maxEarLagDeg, limits.maxEarLagDeg),
      headStab: s.headAngle,
      velocity: { x: s.velocity.x, y: s.velocity.y },
      landingImpulse: s.landingImpulse,
      tail: { swing: s.tailAngle, curl: s.tailCurl, tension: s.tailTension },
    },
  };
}

/** WalletWallaby at frame `frame` (= `ms`): the engine's state on its paths, the TypeScript solver elsewhere. */
export function sampleWithEngine(bound: BoundMotionEngine, ts: TsMotionPlan, frame: number, ms: number, mouth: Viseme = 'REST'): WallabyState {
  if (bound.engine === 'typescript') return sampleWallaby(ts, ms, mouth);
  // The engine's own events are muted by identity: any other plan object would silently keep them.
  if (ts !== bound.transitional) mismatch('the engine was bound to a different transitional plan');
  for (const p of bound.paths) if (frame >= p.first && frame < p.end) return performEngineState(p, bound, ts, frame, ms, mouth);
  return quiet(bound, ts, ms, mouth);
}
