// The Motion Intelligence boundary documents, as TypeScript sees them: the input the pipeline
// sends to the Rust/WASM engine and the plan it answers with. Types only mirror the Rust structs
// (motion-intelligence/src/state.rs); every guarantee is re-checked at runtime by
// validateMotionPlan, which fails closed. No trajectory mathematics lives here: a plan is data,
// one state per video frame. Isomorphic (used by the Node adapter and inside the composition).

export const INPUT_SCHEMA = 'walletwall.motion-input/v2';
export const PLAN_SCHEMA = 'walletwall.motion-plan/v2';
export const CONFIG_SCHEMA = 'walletwall.motion-intelligence-config/v2';
export const ENGINE_NAME = 'motion-intelligence';

export const MOTION_PHASES = ['IDLE', 'PRELOAD', 'TAKEOFF', 'AIRBORNE', 'CONTACT', 'COMPRESSION', 'SETTLE', 'PERCH'] as const;
export type MotionPhase = (typeof MOTION_PHASES)[number];
export type MotionAction = 'IDLE' | 'HOP' | 'LAND' | 'PERCH' | 'INSPECT' | 'TRACE' | 'MANTLE' | 'VAULT' | 'PUSH_THROUGH';
export type MotionContact = 'NONE' | 'GROUND' | 'PLATFORM';
export type SurfaceKind = 'CARD' | 'NODE' | 'PILLAR' | 'LEDGE';
/** Flight samples the engine tests against the protected text (motion-intelligence/src/hop.rs). */
export const FLIGHT_SAMPLES = 32;

export interface Vec2 {
  x: number;
  y: number;
}
export interface MotionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MotionSurface {
  kind: SurfaceKind;
  topY: number;
  leftX: number;
  rightX: number;
}
/** The standing figure's layout box at scale 1, px from the feet (WALLABY_EXTENT). */
export interface MotionFigure {
  left: number;
  right: number;
  top: number;
}
export interface MotionStance {
  crouch: number;
  tailDeg: number;
  /** Degrees per segment (positive curls the tip up). */
  tailCurl: number;
  /** 0..1. */
  tailTension: number;
}

/** config/motion-intelligence.json (validated by the engine; see motion-intelligence/src/config.rs). */
export interface MotionIntelligenceConfig {
  schema: typeof CONFIG_SCHEMA;
  id: string;
  version: number;
  note: string;
  bodyHeightPx: number;
  gravityBodyHeightsPerS2: number;
  maxGravityBoost: number;
  maxSpeedBodyHeightsPerS: number;
  hop: {
    peakBase: number;
    peakPerPx: number;
    peakMin: number;
    peakMax: number;
    anticipationMs: number;
    anticipationHoldFrac: number;
    orientMaxMs: number;
    minFlightMs: number;
    settleReserveMs: number;
    pushMs: number;
    preloadSquash: number;
    extensionFrac: number;
    extensionReferenceBodyHeights: number;
    airborneCrouch: number;
  };
  landing: { contactMs: number; compressionMs: number; settleMs: number; minSettleMs: number; settleFreqHz: number; settleDamping: number; impulseReferenceBodyHeights: number; crouchBase: number; crouchGain: number; compressionGain: number; nodDeg: number };
  pitch: { maxDeg: number; velocityGain: number; headStabilization: number };
  tail: { freqHz: number; damping: number; loadDeg: number; pitchCounter: number; liftDeg: number; impactDeg: number; maxDeg: number; curlFlightDeg: number; curlLoadDeg: number; maxCurlDeg: number; tensionLoad: number; tensionLever: number; tensionFlight: number; tensionBrace: number; tensionEffort: number; tensionFollowMs: number };
  ears: { freqHz: number; damping: number; accelGainDeg: number; maxDeg: number };
  limits: { maxHeadDeg: number; maxWindowMs: number; maxApexBodyHeights: number };
}

export interface MotionInput {
  schema: typeof INPUT_SCHEMA;
  action: MotionAction;
  start: Vec2;
  /** Where the lesson decided the feet must end. The engine can only reach it. */
  target: Vec2;
  startScale: number;
  targetScale: number;
  timing: { startMs: number; arriveByMs: number; endMs: number };
  fps: number;
  stage: { width: number; height: number };
  /** The surfaces under both ends, the text the flight should not cross (empty: the natural arc), and the figure's box. */
  terrain: { start: MotionSurface | null; target: MotionSurface | null; protectedText: MotionRect[]; figure: MotionFigure };
  stance: { initial: MotionStance; rest: MotionStance };
  config: MotionIntelligenceConfig;
}

/** A contact the engine makes with the terrain: the push-off from the start, the touchdown on the target. */
export interface MotionContactEvent {
  kind: 'TAKEOFF' | 'LANDING';
  atMs: number;
  /** 0..1. */
  impulse: number;
  position: Vec2;
  scale: number;
  contact: MotionContact;
}

/** One video frame of motion, renderer-neutral; angles use the Rive rig's conventions. */
export interface MotionState {
  phase: MotionPhase;
  phaseProgress: number;
  position: Vec2;
  velocity: Vec2;
  scale: number;
  contact: MotionContact;
  /** Whole-body pitch, degrees (positive = nose down toward the facing direction). */
  bodyPitch: number;
  /** Leg load, 0..1. */
  crouch: number;
  tuck: number;
  compression: number;
  stretch: number;
  /** Tail swing relative to the body, degrees (positive raises the tip). */
  tailAngle: number;
  /** Tail curl, degrees per segment (positive curls the tip up). */
  tailCurl: number;
  tailTension: number;
  headAngle: number;
  earLag: number;
  landingImpulse: number;
}

export interface MotionPlan {
  schema: typeof PLAN_SCHEMA;
  engine: { name: string; version: string };
  action: MotionAction;
  start: Vec2;
  target: Vec2;
  timing: { startMs: number; arriveByMs: number; endMs: number; orientEndMs: number; pushMs: number; liftoffMs: number; contactMs: number; settledMs: number };
  /** `arcFraction`: the arc the surface-aware search kept, as a fraction of the natural apex; `textCrossings`: flight samples (of 32) crossing protected text. */
  trajectory: { depthPx: number; gravityPxPerS2: number; gravityBoost: number; flightMs: number; apexAbovePx: number; arcFraction: number; textCrossings: number };
  /** The takeoff, then the landing. */
  events: MotionContactEvent[];
  phases: { phase: MotionPhase; startMs: number; endMs: number }[];
  frames: { fps: number; first: number; count: number };
  samples: MotionState[];
}

/** Engine refusals (the Rust codes) and adapter refusals. */
export type MotionErrorCode =
  | 'INVALID_INPUT'
  | 'NON_FINITE_VALUE'
  | 'INVALID_DURATION'
  | 'INVALID_TARGET'
  | 'UNSOLVABLE_TRAJECTORY'
  | 'OUT_OF_BOUNDS'
  | 'INVALID_CONFIG'
  | 'UNSUPPORTED_ACTION'
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_FAULT'
  | 'INVALID_PLAN'
  | 'INELIGIBLE_PATH'
  | 'BINDING_MISMATCH';

export const ENGINE_REFUSAL_CODES: readonly MotionErrorCode[] = ['INVALID_INPUT', 'NON_FINITE_VALUE', 'INVALID_DURATION', 'INVALID_TARGET', 'UNSOLVABLE_TRAJECTORY', 'OUT_OF_BOUNDS', 'INVALID_CONFIG', 'UNSUPPORTED_ACTION'];

/** Any refusal on the motion engine path. Nothing on this path falls back silently. */
export class MotionEngineError extends Error {
  readonly code: MotionErrorCode;
  constructor(code: MotionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MotionEngineError';
    this.code = code;
  }
}

// ── Runtime validation ──────────────────────────────────────────────────────

/** What a plan must agree with: the input it answers (or, in the composition, the clips it performs). */
export interface PlanExpectation {
  action: MotionAction;
  start: Vec2;
  target: Vec2;
  startScale: number;
  targetScale: number;
  timing: { startMs: number; arriveByMs: number; endMs: number };
  fps: number;
  rest: MotionStance;
  contactAtStart: MotionContact;
  contactAtTarget: MotionContact;
  limits: { pitchDeg: number; tailDeg: number; curlDeg: number; earDeg: number; headDeg: number };
}

export function expectationFor(input: MotionInput): PlanExpectation {
  const c = input.config;
  return {
    action: input.action,
    start: input.start,
    target: input.target,
    startScale: input.startScale,
    targetScale: input.targetScale,
    timing: input.timing,
    fps: input.fps,
    rest: input.stance.rest,
    contactAtStart: input.terrain.start ? 'PLATFORM' : 'GROUND',
    contactAtTarget: input.terrain.target ? 'PLATFORM' : 'GROUND',
    limits: limitsOf(c),
  };
}

const PLAN_KEYS = ['schema', 'engine', 'action', 'start', 'target', 'timing', 'trajectory', 'events', 'phases', 'frames', 'samples'];
const TIMING_KEYS = ['startMs', 'arriveByMs', 'endMs', 'orientEndMs', 'pushMs', 'liftoffMs', 'contactMs', 'settledMs'];
const TRAJECTORY_KEYS = ['depthPx', 'gravityPxPerS2', 'gravityBoost', 'flightMs', 'apexAbovePx', 'arcFraction', 'textCrossings'];
const EVENT_KEYS = ['kind', 'atMs', 'impulse', 'position', 'scale', 'contact'];
/** The output ranges a configuration promises (the engine's soft limits never exceed them). */
export function limitsOf(c: MotionIntelligenceConfig): PlanExpectation['limits'] {
  return { pitchDeg: c.pitch.maxDeg, tailDeg: c.tail.maxDeg, curlDeg: c.tail.maxCurlDeg, earDeg: c.ears.maxDeg, headDeg: c.limits.maxHeadDeg };
}

const STATE_KEYS = ['phase', 'phaseProgress', 'position', 'velocity', 'scale', 'contact', 'bodyPitch', 'crouch', 'tuck', 'compression', 'stretch', 'tailAngle', 'tailCurl', 'tailTension', 'headAngle', 'earLag', 'landingImpulse'];
const UNIT_CHANNELS = ['crouch', 'tuck', 'compression', 'stretch', 'tailTension', 'landingImpulse'] as const;
const CONTACTS: readonly MotionContact[] = ['NONE', 'GROUND', 'PLATFORM'];

type Json = Record<string, unknown>;

function invalid(message: string): never {
  throw new MotionEngineError('INVALID_PLAN', message);
}
function object(v: unknown, keys: readonly string[], at: string): Json {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(`${at} is not an object`);
  const o = v as Json;
  const have = Object.keys(o).sort();
  const want = [...keys].sort();
  if (have.length !== want.length || have.some((k, i) => k !== want[i])) invalid(`${at} has fields [${have.join(', ')}], expected [${want.join(', ')}]`);
  return o;
}
function finite(v: unknown, at: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) invalid(`${at} is not a finite number`);
  return v;
}
function point(v: unknown, at: string): Vec2 {
  const o = object(v, ['x', 'y'], at);
  return { x: finite(o.x, `${at}.x`), y: finite(o.y, `${at}.y`) };
}
/** Exact equality: the guarantee is "the same number", not "close". */
const same = (a: number, b: number): boolean => Object.is(a, b) || (a === 0 && b === 0);
const samePoint = (a: Vec2, b: Vec2): boolean => same(a.x, b.x) && same(a.y, b.y);

/**
 * Check every guarantee a plan makes, against what it must agree with; returns the plan deep-frozen.
 * Fails closed with INVALID_PLAN on the first violation.
 */
export function validateMotionPlan(raw: unknown, expect: PlanExpectation): MotionPlan {
  const plan = object(raw, PLAN_KEYS, 'plan');
  if (plan.schema !== PLAN_SCHEMA) invalid(`plan.schema must be ${PLAN_SCHEMA}`);
  const engine = object(plan.engine, ['name', 'version'], 'plan.engine');
  if (engine.name !== ENGINE_NAME || typeof engine.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(engine.version)) invalid('plan.engine is not a motion-intelligence release');
  if (plan.action !== expect.action) invalid(`plan.action ${String(plan.action)} is not ${expect.action}`);
  if (!samePoint(point(plan.start, 'plan.start'), expect.start)) invalid('plan.start is not the input start');
  if (!samePoint(point(plan.target, 'plan.target'), expect.target)) invalid('plan.target is not the authored target');

  const timing = object(plan.timing, TIMING_KEYS, 'plan.timing');
  const t = Object.fromEntries(TIMING_KEYS.map((k) => [k, finite(timing[k], `plan.timing.${k}`)])) as MotionPlan['timing'];
  if (!same(t.startMs, expect.timing.startMs) || !same(t.arriveByMs, expect.timing.arriveByMs) || !same(t.endMs, expect.timing.endMs)) invalid('plan.timing does not echo the window');
  if (!(t.startMs <= t.orientEndMs && t.orientEndMs < t.pushMs && t.pushMs < t.liftoffMs && t.liftoffMs < t.contactMs && t.contactMs <= t.arriveByMs && t.contactMs < t.settledMs && t.settledMs < t.endMs)) invalid('plan.timing instants are out of order');
  const trajectory = object(plan.trajectory, TRAJECTORY_KEYS, 'plan.trajectory');
  for (const k of TRAJECTORY_KEYS) finite(trajectory[k], `plan.trajectory.${k}`);
  if (!same(trajectory.flightMs as number, t.contactMs - t.liftoffMs) || !((trajectory.depthPx as number) > 0) || !((trajectory.gravityPxPerS2 as number) > 0)) invalid('plan.trajectory is inconsistent');
  const crossings = trajectory.textCrossings as number;
  if (!((trajectory.arcFraction as number) > 0) || !Number.isInteger(crossings) || crossings < 0 || crossings >= FLIGHT_SAMPLES) invalid('plan.trajectory does not name an arc the search can choose');

  // The plan's contacts: exactly the takeoff from the start at liftoff, then the landing on the target at touchdown.
  if (!Array.isArray(plan.events) || plan.events.length !== 2) invalid('plan.events is not one takeoff and one landing');
  const ends = [
    { kind: 'TAKEOFF', atMs: t.liftoffMs, position: expect.start, scale: expect.startScale, contact: expect.contactAtStart },
    { kind: 'LANDING', atMs: t.contactMs, position: expect.target, scale: expect.targetScale, contact: expect.contactAtTarget },
  ] as const;
  const events = plan.events.map((raw: unknown, i: number): MotionContactEvent => {
    const at = `plan.events[${i}]`;
    const e = object(raw, EVENT_KEYS, at);
    const end = ends[i]!;
    const event: MotionContactEvent = { kind: end.kind, atMs: finite(e.atMs, `${at}.atMs`), impulse: finite(e.impulse, `${at}.impulse`), position: point(e.position, `${at}.position`), scale: finite(e.scale, `${at}.scale`), contact: end.contact };
    if (e.kind !== end.kind || !same(event.atMs, end.atMs)) invalid(`${at} is not the ${end.kind} at its own instant`);
    if (event.impulse < 0 || event.impulse > 1) invalid(`${at}.impulse is outside [0, 1]`);
    if (!samePoint(event.position, end.position) || !same(event.scale, end.scale) || e.contact !== end.contact) invalid(`${at} is not where the feet are`);
    return event;
  });

  if (!Array.isArray(plan.phases) || plan.phases.length === 0) invalid('plan.phases is empty');
  const phases = plan.phases.map((w: unknown, i: number) => {
    const o = object(w, ['phase', 'startMs', 'endMs'], `plan.phases[${i}]`);
    if (!MOTION_PHASES.includes(o.phase as MotionPhase)) invalid(`plan.phases[${i}].phase is unknown`);
    const startMs = finite(o.startMs, `plan.phases[${i}].startMs`);
    const endMs = finite(o.endMs, `plan.phases[${i}].endMs`);
    if (!(startMs < endMs)) invalid(`plan.phases[${i}] is empty`);
    return { phase: o.phase as MotionPhase, startMs, endMs };
  });
  if (!same(phases[0]!.startMs, t.startMs) || !same(phases.at(-1)!.endMs, t.endMs)) invalid('plan.phases do not cover the window');
  for (let i = 1; i < phases.length; i++) {
    if (!same(phases[i - 1]!.endMs, phases[i]!.startMs) || MOTION_PHASES.indexOf(phases[i - 1]!.phase) >= MOTION_PHASES.indexOf(phases[i]!.phase)) invalid(`plan.phases[${i}] is not a contiguous, ordered hand-off`);
  }
  if (MOTION_PHASES.slice(1).some((p) => !phases.some((w) => w.phase === p))) invalid('plan.phases skip part of the traversal');

  const frames = object(plan.frames, ['fps', 'first', 'count'], 'plan.frames');
  const { fps, first, count } = frames as MotionPlan['frames'];
  if (fps !== expect.fps || !Number.isInteger(first) || first < 0 || !Number.isInteger(count) || count < 1) invalid('plan.frames is not this video\'s frame grid');
  const frameMs = (f: number): number => (f * 1000) / fps;
  if (frameMs(first) < t.startMs || (first > 0 && frameMs(first - 1) >= t.startMs) || frameMs(first + count) < t.endMs || frameMs(first + count - 1) >= t.endMs) invalid('plan.frames does not match the window on this frame grid');
  if (!Array.isArray(plan.samples) || plan.samples.length !== count) invalid('plan.samples does not have one state per frame');

  const order = (p: MotionPhase): number => MOTION_PHASES.indexOf(p);
  const apexY = Math.min(expect.start.y, expect.target.y) - (trajectory.apexAbovePx as number);
  const [xLo, xHi] = [Math.min(expect.start.x, expect.target.x), Math.max(expect.start.x, expect.target.x)];
  const yHi = Math.max(expect.start.y, expect.target.y);
  let w = 0;
  const samples = plan.samples.map((raw: unknown, k: number): MotionState => {
    const at = `plan.samples[${k}]`;
    const s = object(raw, STATE_KEYS, at);
    const ms = frameMs(first + k);
    while (w < phases.length - 1 && ms >= phases[w]!.endMs) w++;
    if (s.phase !== phases[w]!.phase) invalid(`${at} is ${String(s.phase)} inside the ${phases[w]!.phase} window`);
    const phase = s.phase as MotionPhase;
    const state = {
      phase,
      phaseProgress: finite(s.phaseProgress, `${at}.phaseProgress`),
      position: point(s.position, `${at}.position`),
      velocity: point(s.velocity, `${at}.velocity`),
      scale: finite(s.scale, `${at}.scale`),
      contact: s.contact as MotionContact,
      bodyPitch: finite(s.bodyPitch, `${at}.bodyPitch`),
      crouch: finite(s.crouch, `${at}.crouch`),
      tuck: finite(s.tuck, `${at}.tuck`),
      compression: finite(s.compression, `${at}.compression`),
      stretch: finite(s.stretch, `${at}.stretch`),
      tailAngle: finite(s.tailAngle, `${at}.tailAngle`),
      tailCurl: finite(s.tailCurl, `${at}.tailCurl`),
      tailTension: finite(s.tailTension, `${at}.tailTension`),
      headAngle: finite(s.headAngle, `${at}.headAngle`),
      earLag: finite(s.earLag, `${at}.earLag`),
      landingImpulse: finite(s.landingImpulse, `${at}.landingImpulse`),
    };
    if (!CONTACTS.includes(state.contact)) invalid(`${at}.contact is unknown`);
    if (state.phaseProgress < 0 || state.phaseProgress >= 1) invalid(`${at}.phaseProgress is outside [0, 1)`);
    for (const c of UNIT_CHANNELS) if (state[c] < 0 || state[c] > 1) invalid(`${at}.${c} is outside [0, 1]`);
    if (!(state.scale > 0 && state.scale <= 4)) invalid(`${at}.scale is out of range`);
    const { limits } = expect;
    if (Math.abs(state.bodyPitch) > limits.pitchDeg || Math.abs(state.tailAngle) > limits.tailDeg || Math.abs(state.tailCurl) > limits.curlDeg || Math.abs(state.earLag) > limits.earDeg || Math.abs(state.headAngle) > limits.headDeg) invalid(`${at}: an angle exceeds its range of motion`);
    if (order(phase) < order('AIRBORNE')) {
      if (!samePoint(state.position, expect.start) || state.contact !== expect.contactAtStart) invalid(`${at}: the feet left the start before liftoff`);
    } else if (order(phase) > order('AIRBORNE')) {
      if (!samePoint(state.position, expect.target) || state.contact !== expect.contactAtTarget) invalid(`${at}: after touchdown the feet are not on the authored target`);
    } else {
      const p = state.position;
      if (state.contact !== 'NONE' || p.x < xLo || p.x > xHi || p.y < apexY - 1e-6 || p.y > yHi + 1e-6) invalid(`${at}: the flight leaves its arc`);
    }
    return state;
  });
  const last = samples.at(-1)!;
  const atRest =
    last.phase === 'PERCH' &&
    same(last.crouch, expect.rest.crouch) &&
    same(last.tailAngle, expect.rest.tailDeg) &&
    same(last.tailCurl, expect.rest.tailCurl) &&
    same(last.tailTension, expect.rest.tailTension) &&
    [last.tuck, last.compression, last.stretch, last.bodyPitch, last.headAngle, last.earLag, last.landingImpulse, last.velocity.x, last.velocity.y].every((v) => v === 0);
  if (!atRest) invalid('the plan closes before the body is at rest in its stance');

  return deepFreeze({
    schema: PLAN_SCHEMA,
    engine: { name: engine.name as string, version: engine.version as string },
    action: expect.action,
    start: { ...expect.start },
    target: { ...expect.target },
    timing: t,
    trajectory: Object.fromEntries(TRAJECTORY_KEYS.map((k) => [k, trajectory[k]])) as MotionPlan['trajectory'],
    events,
    phases,
    frames: { fps, first, count },
    samples,
  });
}

/** Refuse anything the JSON boundary would silently corrupt: NaN and Infinity become null, undefined vanishes. */
export function assertJsonSafe(value: unknown, at = 'input'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MotionEngineError('NON_FINITE_VALUE', `${at} is not finite`);
    return;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${at}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Json)) {
      if (v === undefined) throw new MotionEngineError('INVALID_INPUT', `${at}.${k} is undefined`);
      assertJsonSafe(v, `${at}.${k}`);
    }
    return;
  }
  throw new MotionEngineError('INVALID_INPUT', `${at} is a ${typeof value}, which JSON cannot carry`);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Json)) deepFreeze(v);
  }
  return value;
}
