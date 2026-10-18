// The Motion Intelligence boundary documents, as TypeScript sees them: the input the pipeline
// sends to the Rust/WASM engine and the plan it answers with. Types only mirror the Rust structs
// (motion-intelligence/src/state.rs); every guarantee is re-checked at runtime by
// validateMotionPlan, which fails closed. No trajectory mathematics lives here: a plan is data,
// one state per video frame. Isomorphic (used by the Node adapter and inside the composition).

import { SUPPORT_CLASSES, type SupportClass, type TerrainSurface } from '../layout/terrain.ts';
import { HAND_CODES, SUPPORT_CODES, type ContactRole, type HandCode, type HandVerdict, type SupportCode, type SupportConfig, type SupportGrade, type SupportVerdict } from '../character/walletwallaby/support.ts';

export const INPUT_SCHEMA = 'walletwall.motion-input/v3';
export const PLAN_SCHEMA = 'walletwall.motion-plan/v3';
export const CONFIG_SCHEMA = 'walletwall.motion-intelligence-config/v3';
export const SUPPORT_QUERY_SCHEMA = 'walletwall.support-query/v1';
export const SUPPORT_REPORT_SCHEMA = 'walletwall.support-report/v1';
export const ENGINE_NAME = 'motion-intelligence';

export const MOTION_PHASES = ['IDLE', 'PRELOAD', 'TAKEOFF', 'AIRBORNE', 'CONTACT', 'COMPRESSION', 'SETTLE', 'PERCH'] as const;
export type MotionPhase = (typeof MOTION_PHASES)[number];
export type MotionAction = 'IDLE' | 'HOP' | 'LAND' | 'PERCH' | 'INSPECT' | 'TRACE' | 'MANTLE' | 'VAULT' | 'PUSH_THROUGH';
export type MotionContact = 'NONE' | 'GROUND' | 'PLATFORM';
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
  /** Support plausibility: equal to config/motion.json `support` (test/rust-motion-engine.test.ts enforces it). */
  support: SupportConfig;
  limits: { maxHeadDeg: number; maxWindowMs: number; maxApexBodyHeights: number };
}

/** The lesson's authored destination: its stands (in order of preference), the subject a perch faces, and whether a narrow perch was authored. */
export interface MotionDestination {
  candidates: Vec2[];
  focus: Vec2;
  narrowAllowed: boolean;
}

/** Declared terrain: what each drawn surface offers (src/layout/terrain.ts), and the text no flight crosses and no contact touches. */
export interface MotionTerrain {
  surfaces: TerrainSurface[];
  protectedText: MotionRect[];
  /** The previous segment's terrain, on screen under the feet until `untilMs` (empty lists when there is none). */
  outgoing: { surfaces: TerrainSurface[]; protectedText: MotionRect[]; untilMs: number };
  figure: MotionFigure;
}

export interface MotionInput {
  schema: typeof INPUT_SCHEMA;
  action: MotionAction;
  start: Vec2;
  /** Where the lesson sends the feet. The engine can only choose one of its stands. */
  destination: MotionDestination;
  startScale: number;
  targetScale: number;
  timing: { startMs: number; arriveByMs: number; endMs: number };
  fps: number;
  stage: { width: number; height: number };
  terrain: MotionTerrain;
  stance: { initial: MotionStance; rest: MotionStance };
  config: MotionIntelligenceConfig;
}

/** The engine's verdict on a stance: the TypeScript judge's, without its prose (`reason`). */
export type EngineSupportVerdict = Omit<SupportVerdict, 'reason'>;

/** The engine's verdict on a hand: the TypeScript judge's, without its prose (and, for a brace, without the feet's verdict). */
export type EngineHandVerdict = Omit<HandVerdict, 'reason'>;

/** A `walletwall.support-query/v1` document: stances, grips, and braces for the engine to judge against one terrain. */
export interface SupportQuery {
  schema: typeof SUPPORT_QUERY_SCHEMA;
  config: SupportConfig;
  bodyHeightPx: number;
  stage: { width: number; height: number };
  terrain: { surfaces: TerrainSurface[]; protectedText: MotionRect[] };
  stances: { at: Vec2; scale: number; facing: 1 | -1; role: ContactRole; narrowAllowed: boolean }[];
  grips: { corner: Vec2; shoulder: Vec2; scale: number }[];
  braces: { stance: SupportQuery['stances'][number]; hand: Vec2 }[];
}

/** The engine's answer to a SupportQuery: one verdict per query, in order. */
export interface SupportReport {
  schema: typeof SUPPORT_REPORT_SCHEMA;
  engine: { name: string; version: string };
  stances: EngineSupportVerdict[];
  grips: EngineHandVerdict[];
  braces: EngineHandVerdict[];
}

/** One of the engine's own contacts, judged at its instant against the terrain on screen. */
export interface MotionJudgedContact {
  atMs: number;
  terrain: 'OWN' | 'OUTGOING';
  verdict: EngineSupportVerdict;
}

/** How a plan is carried: the stand chosen among the authored ones, every stand's verdict, and the takeoff (null off stage) and landing verdicts. */
export interface MotionPlanSupport {
  candidate: number;
  candidates: EngineSupportVerdict[];
  takeoff: MotionJudgedContact | null;
  landing: MotionJudgedContact;
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
  /** The chosen stand: one of the destination's candidates, exactly. */
  target: Vec2;
  support: MotionPlanSupport;
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
  | 'IMPLAUSIBLE_SUPPORT'
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_FAULT'
  | 'INVALID_PLAN'
  | 'INELIGIBLE_PATH'
  | 'BINDING_MISMATCH'
  | 'SUPPORT_MISMATCH';

export const ENGINE_REFUSAL_CODES: readonly MotionErrorCode[] = ['INVALID_INPUT', 'NON_FINITE_VALUE', 'INVALID_DURATION', 'INVALID_TARGET', 'UNSOLVABLE_TRAJECTORY', 'OUT_OF_BOUNDS', 'INVALID_CONFIG', 'UNSUPPORTED_ACTION', 'IMPLAUSIBLE_SUPPORT'];

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
  /** The lesson's authored stands for the destination. */
  candidates: readonly Vec2[];
  /** The stand the plan must have chosen (the composition's clip), or null to accept the engine's choice among `candidates`. */
  target: Vec2 | null;
  startScale: number;
  targetScale: number;
  timing: { startMs: number; arriveByMs: number; endMs: number };
  fps: number;
  /** The visible frame: a takeoff is judged only when the start is on it. */
  stage: { width: number; height: number };
  rest: MotionStance;
  contactAtStart: MotionContact;
  /** What the feet touch at the chosen stand. */
  contactAt: (stand: Vec2) => MotionContact;
  limits: { pitchDeg: number; tailDeg: number; curlDeg: number; earDeg: number; headDeg: number };
}

/**
 * What the feet touch at `p`: a platform when a solid top that carries feet (other than the ground) is
 * level with the point and spans it, otherwise the ground (motion-intelligence/src/terrain.rs `contact_at`).
 */
export function contactAt(p: Vec2, surfaces: readonly TerrainSurface[]): 'PLATFORM' | 'GROUND' {
  const on = surfaces.some((s) => s.face === 'TOP' && (s.support === 'SUPPORTED_SURFACE' || s.support === 'LEDGE' || s.support === 'NARROW_LEDGE') && s.element !== 'ground' && Math.abs(s.y0 - p.y) <= 1 && p.x >= s.x0 && p.x <= s.x1);
  return on ? 'PLATFORM' : 'GROUND';
}

export function expectationFor(input: MotionInput): PlanExpectation {
  const c = input.config;
  return {
    action: input.action,
    start: input.start,
    candidates: input.destination.candidates,
    target: null,
    startScale: input.startScale,
    targetScale: input.targetScale,
    timing: input.timing,
    fps: input.fps,
    stage: input.stage,
    rest: input.stance.rest,
    contactAtStart: contactAt(input.start, input.terrain.surfaces),
    contactAt: (stand) => contactAt(stand, input.terrain.surfaces),
    limits: limitsOf(c),
  };
}

const PLAN_KEYS = ['schema', 'engine', 'action', 'start', 'target', 'support', 'timing', 'trajectory', 'events', 'phases', 'frames', 'samples'];
const VERDICT_KEYS = ['ok', 'code', 'surface', 'support', 'grade', 'widthPx', 'feet', 'comX', 'marginBackPx', 'marginFrontPx', 'comMarginPx', 'tail'];
const GRADES: readonly SupportGrade[] = ['BROAD', 'LEDGE', 'NARROW'];
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
/** An engine support verdict, structurally checked (its numbers finite, its codes known, `ok` exactly when SUPPORTED with a grade). */
function verdict(v: unknown, at: string): EngineSupportVerdict {
  const o = object(v, VERDICT_KEYS, at);
  if (typeof o.ok !== 'boolean') invalid(`${at}.ok is not a boolean`);
  if (!SUPPORT_CODES.includes(o.code as SupportCode)) invalid(`${at}.code is unknown`);
  if (o.surface !== null && typeof o.surface !== 'string') invalid(`${at}.surface is not a surface id`);
  if (o.support !== null && !SUPPORT_CLASSES.includes(o.support as SupportClass)) invalid(`${at}.support is unknown`);
  if (o.grade !== null && !GRADES.includes(o.grade as SupportGrade)) invalid(`${at}.grade is unknown`);
  if (o.tail !== 'ON_SUPPORT' && o.tail !== 'FREE') invalid(`${at}.tail is unknown`);
  if (o.ok !== (o.code === 'SUPPORTED') || o.ok !== (o.grade !== null)) invalid(`${at} is inconsistent`);
  const feet = object(o.feet, ['x0', 'x1'], `${at}.feet`);
  return {
    ok: o.ok,
    code: o.code as SupportCode,
    surface: o.surface as string | null,
    support: o.support as SupportClass | null,
    grade: o.grade as SupportGrade | null,
    widthPx: finite(o.widthPx, `${at}.widthPx`),
    feet: { x0: finite(feet.x0, `${at}.feet.x0`), x1: finite(feet.x1, `${at}.feet.x1`) },
    comX: finite(o.comX, `${at}.comX`),
    marginBackPx: finite(o.marginBackPx, `${at}.marginBackPx`),
    marginFrontPx: finite(o.marginFrontPx, `${at}.marginFrontPx`),
    comMarginPx: finite(o.comMarginPx, `${at}.comMarginPx`),
    tail: o.tail,
  };
}
function hand(v: unknown, at: string): EngineHandVerdict {
  const o = object(v, ['ok', 'code', 'surface', 'reachPx', 'limitPx'], at);
  if (typeof o.ok !== 'boolean') invalid(`${at}.ok is not a boolean`);
  if (!HAND_CODES.includes(o.code as HandCode)) invalid(`${at}.code is unknown`);
  if (o.surface !== null && typeof o.surface !== 'string') invalid(`${at}.surface is not a surface id`);
  if (o.ok !== (o.code === 'GRIPPED' || o.code === 'BRACED')) invalid(`${at} is inconsistent`);
  return { ok: o.ok, code: o.code as HandCode, surface: o.surface as string | null, reachPx: finite(o.reachPx, `${at}.reachPx`), limitPx: finite(o.limitPx, `${at}.limitPx`) };
}

/** Check a support report structurally against the query it answers (one verdict per query, every field known and finite); returns it deep-frozen. */
export function validateSupportReport(raw: unknown, query: SupportQuery): SupportReport {
  const r = object(raw, ['schema', 'engine', 'stances', 'grips', 'braces'], 'report');
  if (r.schema !== SUPPORT_REPORT_SCHEMA) invalid(`report.schema must be ${SUPPORT_REPORT_SCHEMA}`);
  const engine = object(r.engine, ['name', 'version'], 'report.engine');
  if (engine.name !== ENGINE_NAME || typeof engine.version !== 'string') invalid('report.engine is not a motion-intelligence release');
  const list = <T>(v: unknown, n: number, at: string, read: (x: unknown, at: string) => T): T[] => {
    if (!Array.isArray(v) || v.length !== n) invalid(`${at} is not one verdict per query`);
    return v.map((x, i) => read(x, `${at}[${i}]`));
  };
  return deepFreeze({
    schema: SUPPORT_REPORT_SCHEMA,
    engine: { name: engine.name as string, version: engine.version as string },
    stances: list(r.stances, query.stances.length, 'report.stances', verdict),
    grips: list(r.grips, query.grips.length, 'report.grips', hand),
    braces: list(r.braces, query.braces.length, 'report.braces', hand),
  });
}

function judged(v: unknown, at: string): MotionJudgedContact {
  const o = object(v, ['atMs', 'terrain', 'verdict'], at);
  if (o.terrain !== 'OWN' && o.terrain !== 'OUTGOING') invalid(`${at}.terrain is unknown`);
  return { atMs: finite(o.atMs, `${at}.atMs`), terrain: o.terrain, verdict: verdict(o.verdict, `${at}.verdict`) };
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

  // The stand: one of the lesson's, exactly, judged a plausible perch; and the takeoff and landing carried.
  const sup = object(plan.support, ['candidate', 'candidates', 'takeoff', 'landing'], 'plan.support');
  const k = sup.candidate;
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= expect.candidates.length) invalid('plan.support.candidate is not one of the authored stands');
  const target = { x: expect.candidates[k]!.x, y: expect.candidates[k]!.y };
  if (!samePoint(point(plan.target, 'plan.target'), target)) invalid('plan.target is not the authored stand it names');
  if (expect.target && !samePoint(target, expect.target)) invalid('the engine chose another of the authored stands than the lesson performs');
  if (!Array.isArray(sup.candidates) || sup.candidates.length !== expect.candidates.length) invalid('plan.support.candidates is not one verdict per authored stand');
  const candidates = sup.candidates.map((v: unknown, i: number) => verdict(v, `plan.support.candidates[${i}]`));
  if (!candidates[k]!.ok) invalid('plan.support names a stand the terrain does not carry');
  const s0 = expect.start;
  const onStage = s0.x >= 0 && s0.x <= expect.stage.width && s0.y >= 0 && s0.y <= expect.stage.height;
  const takeoff = sup.takeoff === null ? null : judged(sup.takeoff, 'plan.support.takeoff');
  if ((takeoff === null) === onStage || (takeoff && !takeoff.verdict.ok)) invalid('plan.support.takeoff is not a carried takeoff from the stage');
  const landing = judged(sup.landing, 'plan.support.landing');
  if (!landing.verdict.ok) invalid('plan.support.landing is not carried');
  const contactAtTarget = expect.contactAt(target);

  const timing = object(plan.timing, TIMING_KEYS, 'plan.timing');
  const t = Object.fromEntries(TIMING_KEYS.map((k) => [k, finite(timing[k], `plan.timing.${k}`)])) as MotionPlan['timing'];
  if (!same(t.startMs, expect.timing.startMs) || !same(t.arriveByMs, expect.timing.arriveByMs) || !same(t.endMs, expect.timing.endMs)) invalid('plan.timing does not echo the window');
  if ((takeoff && !same(takeoff.atMs, t.liftoffMs)) || !same(landing.atMs, t.contactMs)) invalid('plan.support does not judge the takeoff and landing at their own instants');
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
    { kind: 'LANDING', atMs: t.contactMs, position: target, scale: expect.targetScale, contact: contactAtTarget },
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
  const apexY = Math.min(expect.start.y, target.y) - (trajectory.apexAbovePx as number);
  const [xLo, xHi] = [Math.min(expect.start.x, target.x), Math.max(expect.start.x, target.x)];
  const yHi = Math.max(expect.start.y, target.y);
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
      if (!samePoint(state.position, target) || state.contact !== contactAtTarget) invalid(`${at}: after touchdown the feet are not on the chosen stand`);
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
    target,
    support: { candidate: k, candidates, takeoff, landing },
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
