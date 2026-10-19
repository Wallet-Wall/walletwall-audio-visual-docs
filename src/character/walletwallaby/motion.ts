// WalletWallaby motion intelligence: HOW the guide moves, never WHERE.
//
// The choreography (./choreography.ts) resolves every destination from the
// VideoSpec and fixes each clip's endpoints and time window. This module turns
// those fixed clips into a deterministic motion plan (ballistic hops with
// anticipation, contact, compression, and settle; ledge mantles where the
// terrain calls for a climb; chained trace steps; a braced push into depth; a
// free-fall drop-in) and samples, at any absolute time, the body's behaviour:
// position, velocity, action and phase, key-pose blend, contacts, and what the
// tail is doing about all of it.
//
// The tail is a traversal tool, not decoration: it rests on the surface as a
// third support when standing, loads against the ground before a jump, holds
// straight as a lever at takeoff, counter-rotates against the body's pitch in
// flight, braces on hard landings and pushes, and hangs as a counterweight in a
// mantle. The rig (./rig/) turns these intents into bone angles and IK targets,
// and Blender's IK resolves the actual contact with the surface.
//
// Everything is closed-form: positions are ballistic arcs and eased paths,
// secondary motion is a sum of analytic damped-spring responses to the plan's
// own contact events, and there is no integration over frame history, no clock,
// and no randomness. A clip's destination is an input the solver can only
// reach, never choose: the sampled position after contact is the authored
// anchor itself. Isomorphic.

import motionConfigJson from '../../../config/motion.json' with { type: 'json' };
import { easeInOut, easeOut, lerp, type Point } from '../../layout/geometry.ts';
import { intersects, type Rect } from '../../layout/geometry.ts';
import { EYEBROW_RECT, wallabyBounds, type PlatformKind, type SceneLayout } from '../../layout/scene-layout.ts';
import type { WallabyExpression } from '../../spec/vocabulary.ts';
import { sceneTerrain } from '../../layout/terrain.ts';
import { arcDepth, MotionPlanError } from './ballistics.ts';
import type { Clip } from './choreography.ts';
import type { SupportConfig } from './support.ts';
import { boundFeet, planFootholdTrace, traceMoment, trailAt, type TraceBound } from './trace.ts';
import { AIRBORNE, blendPose, EXPRESSIONS, LAND_HARD, MANTLE, POSES, PUSH, TAKEOFF, TRACE, WALLABY_HEIGHT, type ExpressionParams, type PoseParams, type Viseme } from './rig.ts';

// ── Configuration ───────────────────────────────────────────────────────────

export interface SpringConfig {
  freqHz: number;
  damping: number;
  windowMs: number;
}

export interface MotionConfig {
  schema: 'walletwall.motion-config/v2';
  id: string;
  version: number;
  note: string;
  gravityBodyHeightsPerS2: number;
  maxGravityBoost: number;
  hop: { peakBase: number; peakPerPx: number; peakMin: number; peakMax: number; anticipationMs: number; anticipationHoldFrac: number; orientMaxMs: number; minFlightMs: number; landingBlendMs: number };
  trace: { strideBodyHeights: number; stepPeakBodyHeights: number; contactFrac: number; stepImpulse: number; maxPitchFrac: number; skipStepMs: number };
  push: { weightBackFrac: number; driveStartFrac: number; leanBackDeg: number; arcPx: number };
  drop: { heightPx: number; fadeFrac: number };
  hold: { poseBlendMs: number; shiftImpulse: number; gazeTurnMs: number };
  mantle: { minRiseBodyHeights: number; approachMarginBodyHeights: number; hangDepthBodyHeights: number; faceGapBodyHeights: number; apexAboveHangBodyHeights: number; preloadMs: number; hangMs: number; pullMs: number; settleMs: number; grabImpulse: number; topImpulse: number };
  landing: { hardFrom: number; hardFull: number; hardRecoverScale: number };
  /** What a body can stand on, grip, or brace against (./support.ts). */
  support: SupportConfig;
  tail: { restTension: number; preloadSwingDeg: number; preloadTension: number; takeoffTension: number; flightCounterGain: number; flightStreamDeg: number; flightTension: number; reachSwingDeg: number; braceSwingDeg: number; braceTension: number; hangSwingDeg: number; pullSwingDeg: number; narrowSwayDeg: number; narrowSwayPeriodMs: number; narrowWidthBodyHeights: number };
  response: { compression: SpringConfig; tail: SpringConfig; ears: SpringConfig; platform: SpringConfig };
  gains: { landingCrouch: number; landingHeadTiltDeg: number; landingTailDeg: number; landingEarDeg: number; takeoffTailDeg: number; takeoffEarDeg: number; platformDipPx: number };
  limits: { maxRotationDeg: number; maxCompression: number; maxStretch: number; maxTailLagDeg: number; maxEarLagDeg: number; maxHeadStabDeg: number; platformMaxPx: number; maxSpeedBodyHeightsPerS: number; maxTailSwingDeg: number; maxTailCurlDeg: number };
}

export { arcDepth, MotionPlanError } from './ballistics.ts';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

type Range = readonly [min: number, max: number];

/** Inclusive bounds for every numeric field; anything else (or missing, or non-finite) is refused. */
const CONFIG_BOUNDS: Record<string, Range | Record<string, Range | Record<string, Range>>> = {
  gravityBodyHeightsPerS2: [4, 80],
  maxGravityBoost: [1, 3],
  hop: { peakBase: [0, 2], peakPerPx: [0, 1], peakMin: [0.01, 2], peakMax: [0.01, 2], anticipationMs: [0, 600], anticipationHoldFrac: [0, 0.8], orientMaxMs: [0, 600], minFlightMs: [60, 2000], landingBlendMs: [0, 600] },
  trace: { strideBodyHeights: [0.1, 3], stepPeakBodyHeights: [0, 0.5], contactFrac: [0, 0.6], stepImpulse: [0, 1], maxPitchFrac: [0, 1], skipStepMs: [80, 1000] },
  push: { weightBackFrac: [0, 0.6], driveStartFrac: [0, 0.8], leanBackDeg: [-20, 0], arcPx: [0, 300] },
  drop: { heightPx: [1, 1200], fadeFrac: [0, 1] },
  hold: { poseBlendMs: [0, 2000], shiftImpulse: [0, 1], gazeTurnMs: [0, 1500] },
  mantle: {
    minRiseBodyHeights: [0.2, 3],
    approachMarginBodyHeights: [0, 2],
    hangDepthBodyHeights: [0.3, 1.2],
    faceGapBodyHeights: [0, 0.5],
    apexAboveHangBodyHeights: [0, 0.5],
    preloadMs: [40, 600],
    hangMs: [0, 600],
    pullMs: [80, 1200],
    settleMs: [40, 800],
    grabImpulse: [0, 1],
    topImpulse: [0, 1],
  },
  landing: { hardFrom: [0, 1], hardFull: [0, 1.5], hardRecoverScale: [0, 6] },
  support: {
    footprintBackBodyHeights: [0.02, 0.5],
    footprintFrontBodyHeights: [0.02, 0.5],
    comAheadBodyHeights: [-0.3, 0.3],
    comMarginBodyHeights: [0, 0.5],
    stepComMarginBodyHeights: [0, 0.5],
    narrowWidthBodyHeights: [0.1, 3],
    broadWidthBodyHeights: [0.1, 6],
    broadMarginBodyHeights: [0, 1],
    tailReachBodyHeights: [0, 1.5],
    contactHeightBodyHeights: [0, 0.5],
    shoulderHeightBodyHeights: [0.1, 1.2],
    shoulderAheadBodyHeights: [-0.5, 0.5],
    armReachBodyHeights: [0.05, 1],
    minThicknessPx: [1, 64],
    tolerancePx: [0, 4],
  },
  tail: {
    restTension: [0, 1],
    preloadSwingDeg: [-30, 30],
    preloadTension: [0, 1],
    takeoffTension: [0, 1],
    flightCounterGain: [0, 2],
    flightStreamDeg: [0, 30],
    flightTension: [0, 1],
    reachSwingDeg: [-30, 30],
    braceSwingDeg: [-30, 30],
    braceTension: [0, 1],
    hangSwingDeg: [0, 30],
    pullSwingDeg: [-30, 30],
    narrowSwayDeg: [0, 8],
    narrowSwayPeriodMs: [800, 10000],
    narrowWidthBodyHeights: [0, 4],
  },
  response: {
    compression: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    tail: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    ears: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    platform: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
  },
  gains: { landingCrouch: [0, 1], landingHeadTiltDeg: [-20, 20], landingTailDeg: [-40, 40], landingEarDeg: [-30, 30], takeoffTailDeg: [-40, 40], takeoffEarDeg: [-30, 30], platformDipPx: [0, 8] },
  limits: { maxRotationDeg: [0, 30], maxCompression: [0, 0.3], maxStretch: [0, 0.3], maxTailLagDeg: [0, 60], maxEarLagDeg: [0, 30], maxHeadStabDeg: [0, 20], platformMaxPx: [0, 8], maxSpeedBodyHeightsPerS: [1, 60], maxTailSwingDeg: [0, 45], maxTailCurlDeg: [0, 12] },
};

function checkNumbers(value: unknown, bounds: Record<string, unknown>, at: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MotionPlanError(`motion config: ${at || 'root'} must be an object`);
  const obj = value as Record<string, unknown>;
  for (const [key, bound] of Object.entries(bounds)) {
    const p = at ? `${at}.${key}` : key;
    if (Array.isArray(bound)) {
      const v = obj[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new MotionPlanError(`motion config: ${p} must be a finite number`);
      if (v < bound[0]! || v > bound[1]!) throw new MotionPlanError(`motion config: ${p}=${v} is outside [${bound[0]}, ${bound[1]}]`);
    } else checkNumbers(obj[key], bound as Record<string, unknown>, p);
  }
  for (const key of Object.keys(obj)) {
    if (!(key in bounds) && !(at === '' && ['schema', 'id', 'version', 'note'].includes(key))) throw new MotionPlanError(`motion config: unknown field ${at ? `${at}.${key}` : key}`);
  }
}

/** Validate an untrusted motion config; fails closed on any missing, non-finite, out-of-range, or unknown field. */
export function validateMotionConfig(raw: unknown): MotionConfig {
  checkNumbers(raw, CONFIG_BOUNDS, '');
  const c = raw as MotionConfig;
  if (c.schema !== 'walletwall.motion-config/v2') throw new MotionPlanError('motion config: unsupported schema');
  if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) throw new MotionPlanError('motion config: id must be a slug');
  if (!Number.isInteger(c.version) || c.version < 1) throw new MotionPlanError('motion config: version must be a positive integer');
  if (c.hop.peakMin > c.hop.peakMax) throw new MotionPlanError('motion config: hop.peakMin exceeds hop.peakMax');
  if (c.push.weightBackFrac > c.push.driveStartFrac) throw new MotionPlanError('motion config: push weight shift must end before the drive');
  if (c.gains.platformDipPx > c.limits.platformMaxPx) throw new MotionPlanError('motion config: platform dip exceeds its limit');
  if (c.landing.hardFrom >= c.landing.hardFull) throw new MotionPlanError('motion config: landing.hardFrom must be below landing.hardFull');
  if (c.support.stepComMarginBodyHeights > c.support.comMarginBodyHeights) throw new MotionPlanError('motion config: a passing step cannot need more margin than a perch');
  if (c.support.narrowWidthBodyHeights >= c.support.broadWidthBodyHeights) throw new MotionPlanError('motion config: a narrow ledge must be narrower than broad support');
  if (c.support.narrowWidthBodyHeights < c.support.footprintBackBodyHeights + c.support.footprintFrontBodyHeights) throw new MotionPlanError('motion config: the narrowest ledge must still hold both feet');
  for (const k of ['preloadSwingDeg', 'reachSwingDeg', 'braceSwingDeg', 'hangSwingDeg', 'pullSwingDeg', 'flightStreamDeg'] as const) {
    if (Math.abs(c.tail[k]) > c.limits.maxTailSwingDeg) throw new MotionPlanError(`motion config: tail.${k} exceeds limits.maxTailSwingDeg`);
  }
  return c;
}

export const MOTION_CONFIG: MotionConfig = validateMotionConfig(motionConfigJson);

// ── Closed-form building blocks ─────────────────────────────────────────────

const finite = (n: number, what: string): number => {
  if (!Number.isFinite(n)) throw new MotionPlanError(`${what} is not finite`);
  return n;
};
const finitePoint = (p: Point, what: string): Point => ({ x: finite(p.x, `${what}.x`), y: finite(p.y, `${what}.y`) });

/** Smooth fade to exactly zero over the last 30% of a response window. */
function taper(x: number): number {
  if (x <= 0.7) return 1;
  if (x >= 1) return 0;
  const u = (x - 0.7) / 0.3;
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Normalised impulse response of an underdamped spring: 0 at the event, +1 at
 * its first peak, then a decaying rebound; exactly 0 outside [0, window).
 */
export function springResponse(tMs: number, s: SpringConfig): number {
  if (!(tMs >= 0) || tMs >= s.windowMs) return 0;
  const w = 2 * Math.PI * s.freqHz;
  const wd = w * Math.sqrt(1 - s.damping * s.damping);
  const decay = s.damping * w;
  const tp = Math.atan2(wd, decay) / wd;
  const peak = Math.exp(-decay * tp) * Math.sin(wd * tp);
  const t = tMs / 1000;
  return ((Math.exp(-decay * t) * Math.sin(wd * t)) / peak) * taper(tMs / s.windowMs);
}

const bodyHeight = (scale: number): number => WALLABY_HEIGHT * scale;

// ── Plans ───────────────────────────────────────────────────────────────────

export type MotionEventKind = 'TAKEOFF' | 'LANDING' | 'STEP' | 'PUSH' | 'SHIFT';

/** A platform under the feet: which one, its kind, and its horizontal extent (frame px). */
export interface Surface {
  id: string;
  kind: PlatformKind;
  x0: number;
  x1: number;
}

export interface MotionEvent {
  kind: MotionEventKind;
  atMs: number;
  /** 0..1 strength of the contact. */
  impulse: number;
  scale: number;
  /** Where the feet are at the event (an authored anchor for every LANDING). */
  at: Point;
  segmentId: string;
  /** Platform under the feet at contact, when the contact is on one. */
  surface: Surface | null;
}

export interface HopMotion {
  kind: 'HOP';
  takeoffMs: number;
  contactMs: number;
  orientEndMs: number;
  /** Parabola depth and effective gravity actually used. */
  depthPx: number;
  gravityPx: number;
  apexAbovePx: number;
  /** Flight samples (of 32) whose figure box crosses protected text. */
  textCrossings: number;
  /**
   * The flight continues one already under way (the body enters at the apex of an exit leap): no
   * orient, no preload, no push-off and no takeoff contact; the fall starts at the clip's start.
   */
  airborneStart?: true;
}
export interface RiseMotion {
  kind: 'RISE';
  takeoffMs: number;
}
export interface TraceMotion {
  kind: 'TRACE';
  /** ROUTE follows a drawn trail (a TRACE beat); SKIP chains low bounds along one surface. */
  mode: 'ROUTE' | 'SKIP';
  path: Point[];
  steps: number;
  lengths: number[];
  total: number;
  /** Stepping window: before it WalletWallaby loads up, after it he settles. */
  startMs: number;
  endMs: number;
  /** Lift of each step, px (bounded by the clearance under any text above). */
  peakPx: number;
  /**
   * ROUTE: the body's bounds between supported footholds on the route's own nodes (./trace.ts); the
   * drawn route is never stood on. Absent for SKIP, whose steps are on the one surface it crosses.
   */
  bounds?: readonly TraceBound[];
}
export interface PushMotion {
  kind: 'PUSH';
  weightEndMs: number;
  driveMs: number;
}
export interface DropMotion {
  kind: 'DROP';
  contactMs: number;
  gravityPx: number;
}
export interface HoldMotion {
  kind: 'HOLD';
  entryPose: PoseParams;
  entryLook: Point | null;
}
/** A climb onto a platform from beside it: jump, catch the ledge, hang, pull up, settle on the anchor. */
export interface MantleMotion {
  kind: 'MANTLE';
  /** +1 climbs the platform's right face (arriving from the right), -1 its left face. */
  side: 1 | -1;
  /** The ledge corner the forelimbs catch, and where the feet hang below it. */
  corner: Point;
  hang: Point;
  orientEndMs: number;
  takeoffMs: number;
  grabMs: number;
  pullMs: number;
  topMs: number;
  /** Ballistic arc from the start to the hang point. */
  depthPx: number;
  gravityPx: number;
  /** Samples (of 48) whose figure box crosses protected text over the whole climb. */
  textCrossings: number;
}

export type ClipMotion = HopMotion | MantleMotion | RiseMotion | TraceMotion | PushMotion | DropMotion | HoldMotion | { kind: 'HIDDEN' };

export interface MotionPlan {
  config: MotionConfig;
  clips: Clip[];
  motions: ClipMotion[];
  /** Platform under each clip's start and end point (null = open ground or air). */
  surfaces: { from: Surface | null; to: Surface | null }[];
  /** Every contact, takeoff, push, and weight shift, sorted by time. */
  events: MotionEvent[];
}

export interface PlanHopArgs {
  from: Point;
  to: Point;
  fromScale: number;
  toScale: number;
  startMs: number;
  endMs: number;
  /** Text the figure should not cross in flight (surface awareness); it can only lower or raise the arc. */
  avoid?: readonly Rect[];
}

/** Candidate arc heights, as fractions of the natural one: natural first, then lower, then higher. */
const ARC_CANDIDATES = [1, 0.75, 0.5, 0.35, 0.22, 0.12, 0.05, 1.3, 1.65, 2.2, 3] as const;
const FLIGHT_SAMPLES = 32;
/**
 * A hop's flight is budgeted to end this long before its clip ends, so the clip closes standing on its
 * anchor. The orient and the extra anticipation take up to 0.55 of the slack, so touchdown comes at least
 * 0.45 x this before the clip ends (18 ms on the committed lesson's takeaway hop).
 */
export const SETTLE_RESERVE_MS = 40;

interface ArcSolution {
  depth: number;
  gravity: number;
  flightS: number;
}

/**
 * Solve a hop that leaves `from` and lands exactly on `to` inside [startMs, endMs].
 * The arc is ballistic (constant gravity, constant horizontal velocity). Its
 * natural height comes from the distance; when `avoid` is given, the solver
 * tries a fixed list of heights and keeps the one whose flight crosses the
 * least protected text (ties go to the more natural height). If a flight cannot
 * fit its window the arc is lowered, then gravity raised within its bound;
 * otherwise the hop is refused. The landing point is `to` itself, always.
 */
export function planHop(args: PlanHopArgs, config: MotionConfig = MOTION_CONFIG): HopMotion {
  const from = finitePoint(args.from, 'hop.from');
  const to = finitePoint(args.to, 'hop.to');
  const fromScale = finite(args.fromScale, 'hop.fromScale');
  const toScale = finite(args.toScale, 'hop.toScale');
  const startMs = finite(args.startMs, 'hop.startMs');
  const endMs = finite(args.endMs, 'hop.endMs');
  if (fromScale <= 0 || toScale <= 0 || fromScale > 4 || toScale > 4) throw new MotionPlanError('hop scale must be in (0, 4]');
  const dur = endMs - startMs;
  if (!(dur > 0)) throw new MotionPlanError(`hop window must be positive, got ${dur} ms`);
  const { hop, limits } = config;
  const scale = (fromScale + toScale) / 2;
  const body = bodyHeight(scale);
  const g0 = config.gravityBodyHeightsPerS2 * body;
  const dx = to.x - from.x;
  const d = to.y - from.y;
  const anticipation = Math.min(hop.anticipationMs, dur * 0.3);
  const budgetS = (dur - anticipation - SETTLE_RESERVE_MS) / 1000;
  if (!(budgetS * 1000 >= Math.min(hop.minFlightMs, dur * 0.5))) throw new MotionPlanError(`hop window of ${dur} ms leaves no time to fly`);
  const maxSpeed = limits.maxSpeedBodyHeightsPerS * body;
  const natural = clamp(hop.peakBase * body + hop.peakPerPx * Math.abs(dx), hop.peakMin * body, hop.peakMax * body);

  const solve = (apex: number, keepHeight: boolean): ArcSolution | null => {
    let gravity = g0;
    let depth = arcDepth(from.y, to.y, apex);
    let flightS = Math.sqrt((2 * depth) / gravity);
    if (flightS > budgetS && keepHeight) {
      // A deliberately higher arc keeps its height and fits the window with stronger gravity.
      gravity = (2 * depth) / (budgetS * budgetS);
      if (gravity > g0 * config.maxGravityBoost) return null;
      flightS = budgetS;
    } else if (flightS > budgetS) {
      depth = Math.max(arcDepth(from.y, to.y, 0), (gravity * budgetS * budgetS) / 2);
      flightS = Math.sqrt((2 * depth) / gravity);
      if (flightS > budgetS) {
        gravity = (2 * depth) / (budgetS * budgetS);
        if (gravity > g0 * config.maxGravityBoost) return null;
        flightS = budgetS;
      }
    }
    if (Math.abs(dx) / flightS > maxSpeed) {
      // A higher arc buys flight time, never past the window.
      const needS = Math.abs(dx) / maxSpeed;
      if (needS > budgetS) return null;
      depth = Math.max(depth, (gravity * needS * needS) / 2);
      flightS = Math.sqrt((2 * depth) / gravity);
    }
    if (flightS * 1000 < hop.minFlightMs && hop.minFlightMs / 1000 <= budgetS) {
      flightS = hop.minFlightMs / 1000;
      depth = (gravity * flightS * flightS) / 2;
    }
    return Number.isFinite(depth) && Number.isFinite(flightS) && flightS > 0 ? { depth, gravity, flightS } : null;
  };
  const crossings = (sol: ArcSolution): number => {
    if (!args.avoid?.length) return 0;
    let n = 0;
    for (let k = 1; k < FLIGHT_SAMPLES; k++) {
      const u = k / FLIGHT_SAMPLES;
      const feet = { x: lerp(from.x, to.x, u), y: from.y + d * u - sol.depth * u * (1 - u) };
      const box = wallabyBounds(feet, lerp(fromScale, toScale, u));
      if (args.avoid.some((r) => intersects(box, r))) n++;
    }
    return n;
  };

  let best: ArcSolution | null = null;
  let bestCrossings = Infinity;
  for (const fraction of args.avoid?.length ? ARC_CANDIDATES : ARC_CANDIDATES.slice(0, 1)) {
    const sol = solve(Math.min(hop.peakMax * body, natural * fraction), fraction > 1);
    if (!sol) continue;
    const n = crossings(sol);
    if (n < bestCrossings) {
      best = sol;
      bestCrossings = n;
      if (n === 0) break;
    }
  }
  if (!best) throw new MotionPlanError(`hop of ${Math.round(Math.hypot(dx, d))} px cannot land within ${dur} ms under the speed and gravity limits`);
  const { depth, gravity, flightS } = best;
  const flightMs = flightS * 1000;
  const spare = Math.max(0, dur - anticipation - flightMs);
  const orient = Math.min(hop.orientMaxMs, spare * 0.35);
  const extraAnticipation = Math.min(80, spare * 0.2);
  const takeoffMs = startMs + orient + anticipation + extraAnticipation;
  const contactMs = takeoffMs + flightMs;
  // y(s) = y0 + d·s - c·s(1-s): minimum at s* = (1 - d/c)/2 when interior.
  const sStar = clamp((1 - d / depth) / 2, 0, 1);
  const apexY = from.y + d * sStar - depth * sStar * (1 - sStar);
  return {
    kind: 'HOP',
    orientEndMs: startMs + orient,
    takeoffMs: finite(takeoffMs, 'hop.takeoff'),
    contactMs: finite(Math.min(contactMs, endMs), 'hop.contact'),
    depthPx: finite(depth, 'hop.depth'),
    gravityPx: finite(gravity, 'hop.gravity'),
    apexAbovePx: Math.min(from.y, to.y) - apexY,
    textCrossings: bestCrossings,
  };
}

/**
 * A flight already under way: the body enters at rest vertically (the apex of an exit leap) and falls on
 * to land exactly on `to`, with constant horizontal speed. No standing start: there is nothing under the
 * feet at the apex, so there is no orient, no preload, and no push-off. The fall takes as long as gravity
 * says (raised within its bound only if the window is shorter). It lands as the window closes, as a hop
 * does, so the body arrives as the scene does; the time before it falls is spent at the apex only when
 * the apex is above the frame (out of view: nothing is seen hanging in the air). On screen, it falls at once.
 */
export function planFall(args: PlanHopArgs, config: MotionConfig = MOTION_CONFIG): HopMotion {
  const from = finitePoint(args.from, 'fall.from');
  const to = finitePoint(args.to, 'fall.to');
  const fromScale = finite(args.fromScale, 'fall.fromScale');
  const toScale = finite(args.toScale, 'fall.toScale');
  const startMs = finite(args.startMs, 'fall.startMs');
  const endMs = finite(args.endMs, 'fall.endMs');
  if (fromScale <= 0 || toScale <= 0 || fromScale > 4 || toScale > 4) throw new MotionPlanError('fall scale must be in (0, 4]');
  const d = to.y - from.y;
  if (!(d > 0)) throw new MotionPlanError(`a flight entering at its apex can only fall: the target is ${-d} px above it`);
  const budgetS = (endMs - startMs - SETTLE_RESERVE_MS) / 1000;
  if (!(budgetS > 0)) throw new MotionPlanError(`fall window of ${endMs - startMs} ms leaves no time to fall`);
  const body = bodyHeight((fromScale + toScale) / 2);
  const g0 = config.gravityBodyHeightsPerS2 * body;
  let gravity = g0;
  // From rest at the apex, y(s) = y0 + d·s²: the arc's depth equals the drop.
  let flightS = Math.sqrt((2 * d) / gravity);
  if (flightS > budgetS) {
    gravity = (2 * d) / (budgetS * budgetS);
    if (gravity > g0 * config.maxGravityBoost) throw new MotionPlanError(`a ${Math.round(d)} px fall cannot land within ${Math.round(endMs - startMs)} ms under the gravity limit`);
    flightS = budgetS;
  }
  if (Math.abs(to.x - from.x) / flightS > config.limits.maxSpeedBodyHeightsPerS * body) throw new MotionPlanError('the fall would cross too far, too fast');
  let crossings = 0;
  if (args.avoid?.length) {
    for (let k = 1; k < FLIGHT_SAMPLES; k++) {
      const u = k / FLIGHT_SAMPLES;
      const box = wallabyBounds({ x: lerp(from.x, to.x, u), y: from.y + d * u * u }, lerp(fromScale, toScale, u));
      if (args.avoid.some((r) => intersects(box, r))) crossings++;
    }
  }
  // Out of view above the frame, the fall waits there to land as the window closes; in view, it starts at once.
  const takeoffMs = from.y <= 0 ? startMs + (budgetS - flightS) * 1000 : startMs;
  return {
    kind: 'HOP',
    orientEndMs: takeoffMs,
    takeoffMs: finite(takeoffMs, 'fall.takeoff'),
    contactMs: finite(takeoffMs + flightS * 1000, 'fall.contact'),
    depthPx: d,
    gravityPx: finite(gravity, 'fall.gravity'),
    apexAbovePx: 0,
    textCrossings: crossings,
    airborneStart: true,
  };
}

export interface PlanMantleArgs extends PlanHopArgs {
  /** The platform the destination stands on (the ledge to climb). */
  platform: Surface;
}

const MANTLE_SAMPLES = 48;
/** Pull-up path: the feet rise up the face for the first part, then carry over the edge to the anchor. */
const PULL_RISE_FRAC = 0.55;

/** Feet position during a mantle's pull-up, u ∈ [0, 1] (exactly the anchor at u = 1). */
function pullPath(m: Pick<MantleMotion, 'hang' | 'corner' | 'side'>, to: Point, body: number, u: number): Point {
  if (u >= 1) return to;
  const lip = { x: m.corner.x - m.side * 0.12 * body, y: m.corner.y };
  if (u < PULL_RISE_FRAC) {
    const v = u / PULL_RISE_FRAC;
    return { x: lerp(m.hang.x, lip.x, easeInOut(v)), y: lerp(m.hang.y, lip.y, easeOut(v)) };
  }
  const v = easeInOut((u - PULL_RISE_FRAC) / (1 - PULL_RISE_FRAC));
  return { x: lerp(lip.x, to.x, v), y: lerp(lip.y, to.y, v) - 0.04 * body * Math.sin(Math.PI * v) };
}

/** Feet position along the mantle's jump arc to the hang point, s ∈ [0, 1]. */
function mantleArc(from: Point, m: Pick<MantleMotion, 'hang' | 'depthPx'>, s: number): Point {
  return { x: lerp(from.x, m.hang.x, s), y: from.y + (m.hang.y - from.y) * s - m.depthPx * s * (1 - s) };
}

/**
 * A mantle onto `platform`, or null when the terrain or the window does not call
 * for one. Eligible only when the destination stands on a platform well above
 * the start, the start is beside that platform (there is a face to climb), the
 * whole sequence fits the window under the speed and gravity limits, and the
 * scale does not change. The climb ends exactly on `to`.
 */
export function planMantle(args: PlanMantleArgs, config: MotionConfig = MOTION_CONFIG): MantleMotion | null {
  const from = finitePoint(args.from, 'mantle.from');
  const to = finitePoint(args.to, 'mantle.to');
  const startMs = finite(args.startMs, 'mantle.startMs');
  const endMs = finite(args.endMs, 'mantle.endMs');
  const { mantle, limits } = config;
  const p = args.platform;
  if (p.kind === 'FRAME') return null;
  if (!(args.fromScale > 0) || args.fromScale !== args.toScale || args.fromScale > 4) return null;
  if (!(to.x >= p.x0 && to.x <= p.x1)) return null;
  const body = bodyHeight(args.toScale);
  if (from.y - to.y < mantle.minRiseBodyHeights * body) return null;
  const margin = mantle.approachMarginBodyHeights * body;
  const side: 1 | -1 | 0 = from.x > p.x1 + margin ? 1 : from.x < p.x0 - margin ? -1 : 0;
  if (side === 0) return null;
  const corner = { x: side > 0 ? p.x1 : p.x0, y: to.y };
  const hang = { x: corner.x + side * mantle.faceGapBodyHeights * body, y: corner.y + mantle.hangDepthBodyHeights * body };
  const dur = endMs - startMs;
  const fixed = mantle.preloadMs + mantle.hangMs + mantle.pullMs + mantle.settleMs;
  const budgetS = (dur - fixed) / 1000;
  if (!(budgetS > 0.08)) return null;
  // Arrive at the hang point just past the apex of the jump: catching the ledge when the climb is slowest.
  const g0 = config.gravityBodyHeightsPerS2 * body;
  const depth = arcDepth(from.y, hang.y, mantle.apexAboveHangBodyHeights * body);
  let gravity = g0;
  let flightS = Math.sqrt((2 * depth) / gravity);
  if (flightS > budgetS) {
    gravity = (2 * depth) / (budgetS * budgetS);
    if (gravity > g0 * config.maxGravityBoost) return null;
    flightS = budgetS;
  }
  if (Math.abs(hang.x - from.x) / flightS > limits.maxSpeedBodyHeightsPerS * body) return null;
  const spare = budgetS - flightS;
  const orient = Math.min(config.hop.orientMaxMs, spare * 1000 * 0.4);
  const takeoffMs = startMs + orient + mantle.preloadMs;
  const grabMs = takeoffMs + flightS * 1000;
  const pullMs = grabMs + mantle.hangMs + Math.max(0, spare * 1000 - orient) * 0.5;
  const topMs = Math.min(endMs - mantle.settleMs, pullMs + mantle.pullMs + Math.max(0, spare * 1000 - orient) * 0.5);
  if (!(topMs > pullMs)) return null;
  const plan = { side, corner, hang, depthPx: depth };
  let crossings = 0;
  if (args.avoid?.length) {
    for (let k = 1; k < MANTLE_SAMPLES; k++) {
      const u = k / MANTLE_SAMPLES;
      // Two thirds of the samples cover the jump, one third the hang and the pull.
      const feet = u < 2 / 3 ? mantleArc(from, plan, u * 1.5) : pullPath(plan, to, body, (u - 2 / 3) * 3);
      if (args.avoid.some((r) => intersects(wallabyBounds(feet, args.toScale), r))) crossings++;
    }
  }
  return {
    kind: 'MANTLE',
    side,
    corner,
    hang,
    orientEndMs: startMs + orient,
    takeoffMs: finite(takeoffMs, 'mantle.takeoff'),
    grabMs: finite(grabMs, 'mantle.grab'),
    pullMs: finite(pullMs, 'mantle.pull'),
    topMs: finite(topMs, 'mantle.top'),
    depthPx: finite(depth, 'mantle.depth'),
    gravityPx: finite(gravity, 'mantle.gravity'),
    textCrossings: crossings,
  };
}

/**
 * Text a move should not cross (surface awareness): the scene's text blocks, then its eyebrow row.
 * A segment without a scene layout protects nothing. The Rust/WASM engine receives exactly this list.
 */
export function protectedText(layout: SceneLayout | undefined): Rect[] | undefined {
  return layout ? [...layout.texts.map((t) => t.rect), EYEBROW_RECT] : undefined;
}

/** Platform whose top edge carries this point (the information terrain under the feet). */
function surfaceUnder(layout: SceneLayout | undefined, at: Point): Surface | null {
  if (!layout) return null;
  for (const p of layout.platforms) {
    if (p.kind === 'FRAME') continue; // a UI capture is evidence, not terrain
    if (Math.abs(p.rect.y - at.y) <= 1 && at.x >= p.rect.x && at.x <= p.rect.x + p.rect.w) return { id: p.id, kind: p.kind, x0: p.rect.x, x1: p.rect.x + p.rect.w };
  }
  return null;
}

function polylineLengths(path: Point[]): { lengths: number[]; total: number } {
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
  return { lengths, total: lengths.reduce((a, b) => a + b, 0) };
}

/** Smallest gap (px) between the standing figure's box and any protected text above it along a path. */
function clearanceAbove(path: Point[], scale: number, avoid: readonly Rect[]): number {
  let gap = Infinity;
  const { lengths, total } = polylineLengths(path);
  for (let k = 0; k <= 16; k++) {
    const box = wallabyBounds(pointAt(path, lengths, total, k / 16), scale);
    for (const r of avoid) {
      if (r.x >= box.x + box.w || box.x >= r.x + r.w || r.y + r.h > box.y + box.h) continue;
      gap = Math.min(gap, box.y - (r.y + r.h));
    }
  }
  return gap;
}

function pointAt(path: Point[], lengths: number[], total: number, f: number): Point {
  if (f <= 0) return path[0]!;
  if (f >= 1 || total === 0) return path[path.length - 1]!;
  let target = f * total;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (target <= len) {
      const t = len === 0 ? 0 : target / len;
      return { x: lerp(path[i]!.x, path[i + 1]!.x, t), y: lerp(path[i]!.y, path[i + 1]!.y, t) };
    }
    target -= len;
  }
  return path[path.length - 1]!;
}

/** Hardness of a landing: 0 soft .. 1 hard, from its impact. */
function hardness(config: MotionConfig, impulse: number): number {
  return smoothstep(config.landing.hardFrom, config.landing.hardFull, impulse);
}

/** Body pose after contact: soft or hard by impact, recovering toward the standing landing pose. */
function landedPose(config: MotionConfig, impulse: number, sinceContactMs: number): PoseParams {
  const h = hardness(config, impulse);
  const contact = blendPose(POSES.LAND, LAND_HARD, h);
  const recoverMs = config.hop.landingBlendMs * (1 + config.landing.hardRecoverScale * h);
  const settle = recoverMs > 0 ? easeOut(clamp(sinceContactMs / recoverMs, 0, 1)) : 1;
  return blendPose(contact, POSES.LAND, settle);
}

/** Pose a clip leaves WalletWallaby in: the base the next clip starts from. */
function exitPose(plan: Pick<MotionPlan, 'config' | 'events'>, clip: Clip): PoseParams {
  if (clip.kind === 'HOLD') return POSES[clip.pose];
  const landing = [...plan.events].reverse().find((e) => e.kind === 'LANDING' && e.atMs <= clip.endMs && e.atMs >= clip.startMs);
  return landing ? landedPose(plan.config, landing.impulse, clip.endMs - landing.atMs) : POSES.LAND;
}

export function planMotion(clips: Clip[], layouts: Map<string, SceneLayout>, config: MotionConfig = MOTION_CONFIG): MotionPlan {
  const motions: ClipMotion[] = [];
  const events: MotionEvent[] = [];
  const surfaces: MotionPlan['surfaces'] = clips.map((c) => ({ from: surfaceUnder(layouts.get(c.segmentId), c.from), to: surfaceUnder(layouts.get(c.segmentId), c.to) }));
  const event = (kind: MotionEventKind, atMs: number, impulse: number, scale: number, at: Point, segmentId: string): void => {
    events.push({ kind, atMs, impulse: clamp(impulse, 0, 1), scale, at, segmentId, surface: kind === 'TAKEOFF' || kind === 'PUSH' ? null : surfaceUnder(layouts.get(segmentId), at) });
  };
  /** Contacts of a stepping move: a STEP between bounds, a LANDING on arrival. */
  const stepEvents = (m: TraceMotion, clip: Clip): void => {
    const slice = (m.endMs - m.startMs) / m.steps;
    for (let k = 1; k <= m.steps; k++) {
      const frac = stepBoundary(k, m.steps);
      const at = k === m.steps ? clip.to : pointAt(m.path, m.lengths, m.total, frac);
      event(k === m.steps ? 'LANDING' : 'STEP', m.startMs + slice * k, config.trace.stepImpulse * (k === m.steps ? 1.4 : 1), lerp(clip.fromScale, clip.toScale, frac), at, clip.segmentId);
    }
  };
  let prev: Clip | undefined;
  for (const clip of clips) {
    finite(clip.startMs, 'clip.startMs');
    finite(clip.endMs, 'clip.endMs');
    if (!(clip.endMs > clip.startMs)) throw new MotionPlanError(`clip ${clip.kind} at ${clip.startMs} ms has no duration`);
    switch (clip.kind) {
      case 'HIDDEN':
        motions.push({ kind: 'HIDDEN' });
        break;
      case 'TRAVEL': {
        const avoid = protectedText(layouts.get(clip.segmentId));
        const here = surfaces[motions.length]!;
        if (clip.airborne) {
          // Entering in flight (the apex of an exit leap): the fall continues it; there is no takeoff contact.
          const fall = planFall({ from: clip.from, to: clip.to, fromScale: clip.fromScale, toScale: clip.toScale, startMs: clip.startMs, endMs: clip.endMs, avoid }, config);
          motions.push(fall);
          const body = bodyHeight((clip.fromScale + clip.toScale) / 2);
          const t = (fall.contactMs - fall.takeoffMs) / 1000;
          event('LANDING', fall.contactMs, (fall.gravityPx * t) / Math.sqrt(2 * fall.gravityPx * 0.6 * body), clip.toScale, clip.to, clip.segmentId);
          break;
        }
        const stride = config.trace.strideBodyHeights * bodyHeight(clip.fromScale);
        const dur = clip.endMs - clip.startMs;
        const along = here.from && here.to && here.from.id === here.to.id && Math.abs(clip.to.y - clip.from.y) < 1 && clip.fromScale === clip.toScale;
        if (along && Math.abs(clip.to.x - clip.from.x) >= stride) {
          // A long move along one surface: chained low bounds, never a full reset between them.
          const path = [finitePoint(clip.from, 'skip.from'), finitePoint(clip.to, 'skip.to')];
          const { lengths, total } = polylineLengths(path);
          const steps = Math.max(2, Math.round(total / stride));
          const anticipation = Math.min(config.hop.anticipationMs, dur * 0.3);
          const window = Math.min(steps * config.trace.skipStepMs, dur - anticipation - Math.max(120, SETTLE_RESERVE_MS));
          if (window > steps * 60) {
            const clear = avoid ? clearanceAbove(path, clip.fromScale, avoid) - 1 : Infinity;
            const peakPx = Math.max(0, Math.min(config.trace.stepPeakBodyHeights * 1.6 * bodyHeight(clip.fromScale), clear));
            const skip: TraceMotion = { kind: 'TRACE', mode: 'SKIP', path, steps, lengths, total, startMs: clip.startMs + anticipation, endMs: clip.startMs + anticipation + window, peakPx };
            motions.push(skip);
            event('TAKEOFF', skip.startMs, 0.45, clip.fromScale, clip.from, clip.segmentId);
            stepEvents(skip, clip);
            break;
          }
        }
        const hopArgs = { from: clip.from, to: clip.to, fromScale: clip.fromScale, toScale: clip.toScale, startMs: clip.startMs, endMs: clip.endMs, avoid };
        const hop = planHop(hopArgs, config);
        // Where the terrain calls for a climb, a mantle replaces the hop, but only if it keeps text at least as clear.
        const mantle = here.to ? planMantle({ ...hopArgs, platform: here.to }, config) : null;
        if (mantle && mantle.textCrossings <= hop.textCrossings) {
          motions.push(mantle);
          event('TAKEOFF', mantle.takeoffMs, 0.75, clip.fromScale, clip.from, clip.segmentId);
          event('STEP', mantle.grabMs, config.mantle.grabImpulse, clip.toScale, mantle.hang, clip.segmentId);
          event('LANDING', mantle.topMs, config.mantle.topImpulse, clip.toScale, clip.to, clip.segmentId);
          break;
        }
        motions.push(hop);
        const body = bodyHeight((clip.fromScale + clip.toScale) / 2);
        const vRef = Math.sqrt(2 * hop.gravityPx * 0.6 * body);
        const t = (hop.contactMs - hop.takeoffMs) / 1000;
        const d = clip.to.y - clip.from.y;
        event('TAKEOFF', hop.takeoffMs, Math.abs((d - hop.depthPx) / t) / vRef, clip.fromScale, clip.from, clip.segmentId);
        event('LANDING', hop.contactMs, ((d + hop.depthPx) / t) / vRef, clip.toScale, clip.to, clip.segmentId);
        break;
      }
      case 'EXIT_JUMP': {
        // An exit leap loads longer: it leaves the plane rather than crossing it.
        const anticipation = Math.min(Math.max(config.hop.anticipationMs, (clip.endMs - clip.startMs) * 0.3), (clip.endMs - clip.startMs) * 0.45);
        const rise: RiseMotion = { kind: 'RISE', takeoffMs: clip.startMs + anticipation };
        motions.push(rise);
        event('TAKEOFF', rise.takeoffMs, 0.9, clip.fromScale, clip.from, clip.segmentId);
        break;
      }
      case 'TRAVERSE': {
        // The drawn route is information, not terrain: the body bounds between supported footholds on the
        // route's own nodes and leaps what the route spans while the trail draws (./trace.ts).
        const path = clip.path.map((p) => finitePoint(p, 'trace.path'));
        const { lengths, total } = polylineLengths(path);
        const layout = layouts.get(clip.segmentId);
        if (!layout) throw new MotionPlanError(`trace in ${clip.segmentId}: the segment has no terrain`);
        const bounds = planFootholdTrace({ from: clip.from, to: clip.to, fromScale: clip.fromScale, toScale: clip.toScale, startMs: clip.startMs, endMs: clip.endMs, path, terrain: sceneTerrain(layout) }, config);
        const first = bounds[0]!;
        const last = bounds[bounds.length - 1]!;
        const trace: TraceMotion = { kind: 'TRACE', mode: 'ROUTE', path, steps: bounds.length, lengths, total, startMs: first.takeoffMs, endMs: last.contactMs, peakPx: 0, bounds };
        motions.push(trace);
        event('TAKEOFF', first.takeoffMs, config.trace.stepImpulse * 1.5, clip.fromScale, clip.from, clip.segmentId);
        bounds.forEach((b, k) => event(k === bounds.length - 1 ? 'LANDING' : 'STEP', b.contactMs, config.trace.stepImpulse * (k === bounds.length - 1 ? 1.4 : b.kind === 'LEAP' ? 1.2 : 1), b.toScale, k === bounds.length - 1 ? clip.to : b.to, clip.segmentId));
        break;
      }
      case 'PUSH': {
        const dur = clip.endMs - clip.startMs;
        const push: PushMotion = { kind: 'PUSH', weightEndMs: clip.startMs + dur * config.push.weightBackFrac, driveMs: clip.startMs + dur * config.push.driveStartFrac };
        motions.push(push);
        event('PUSH', push.driveMs, 1, clip.fromScale, clip.from, clip.segmentId);
        break;
      }
      case 'DROP_IN': {
        const dur = clip.endMs - clip.startMs;
        const g0 = config.gravityBodyHeightsPerS2 * bodyHeight(clip.fromScale);
        let gravity = g0;
        let fallMs = Math.sqrt((2 * config.drop.heightPx) / gravity) * 1000;
        const budget = dur * 0.75;
        if (fallMs > budget) {
          gravity = (2 * config.drop.heightPx) / Math.pow(budget / 1000, 2);
          if (gravity > g0 * config.maxGravityBoost) throw new MotionPlanError(`drop-in cannot land within ${dur} ms`);
          fallMs = budget;
        }
        const drop: DropMotion = { kind: 'DROP', contactMs: clip.startMs + fallMs, gravityPx: gravity };
        motions.push(drop);
        const body = bodyHeight(clip.fromScale);
        event('LANDING', drop.contactMs, (gravity * (fallMs / 1000)) / Math.sqrt(2 * gravity * 0.6 * body), clip.fromScale, clip.to, clip.segmentId);
        break;
      }
      case 'HOLD': {
        const entryPose = prev && prev.kind !== 'HIDDEN' && prev.kind !== 'PUSH' ? exitPose({ config, events }, prev) : POSES[clip.pose];
        const entryLook = prev?.kind === 'HOLD' ? prev.lookAt : null;
        motions.push({ kind: 'HOLD', entryPose, entryLook });
        const changed = prev?.kind === 'HOLD' && prev.pose !== clip.pose;
        if (changed) event('SHIFT', clip.startMs, config.hold.shiftImpulse, clip.fromScale, clip.from, clip.segmentId);
        break;
      }
    }
    prev = clip;
  }
  events.sort((a, b) => a.atMs - b.atMs || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return { config, clips, motions, events, surfaces };
}

// ── Sampling ────────────────────────────────────────────────────────────────

/** What the body is doing, in the vocabulary the rig and the reviews use. */
export type BodyAction = 'IDLE' | 'HOP' | 'AIRBORNE' | 'LAND' | 'PERCH' | 'INSPECT' | 'TRACE' | 'MANTLE' | 'PUSH_THROUGH';
export type BodyPhase = 'HOLD' | 'ORIENT' | 'PRELOAD' | 'TAKEOFF' | 'FLIGHT' | 'REACH' | 'CONTACT' | 'SETTLE' | 'STEP' | 'HANG' | 'PULL' | 'BRACE' | 'LOAD' | 'DRIVE' | 'FALL';

/** The tail's intent for this frame (the rig resolves its actual contact with the surface). */
export interface TailChannels {
  /** Swing of the whole tail, degrees; positive raises the tip. */
  swing: number;
  /** Curl along the tail, degrees per segment; positive curls the tip up. */
  curl: number;
  /** 0..1 stiffness: 1 holds the tail straight as a lever. */
  tension: number;
}

export interface MotionChannels {
  /** Whole-body pitch in degrees, positive = nose toward the facing direction. */
  rotation: number;
  /** Vertical scale offset: positive stretches, negative compresses. */
  stretch: number;
  /** Tail follow-through from contact springs, degrees (positive raises the tip). */
  tailLag: number;
  /** Ear swing added to the expression's ear rotation, degrees. */
  earLag: number;
  /** Head counter-rotation that keeps the gaze steady, degrees. */
  headStab: number;
  contact: 'NONE' | 'GROUND' | 'PLATFORM';
  /** Downward displacement of the platform under the feet, px (feet follow it). */
  platformDip: number;
  action: BodyAction;
  phase: BodyPhase;
  /** Feet velocity in frame px/s (closed form from the plan). */
  velocity: Point;
  /** 0..1 impact of the landing still settling (0 when none). */
  landingImpulse: number;
  tail: TailChannels;
  /** Horizontal extent of the surface under the feet (frame px); open ground is very wide; null in the air. */
  support: { x0: number; x1: number } | null;
  /** Seconds into the looping idle clip (absolute time, so the breath never jumps between holds). */
  idleTimeS: number;
  /** The ledge lip the forelimbs hold while climbing (frame px), or null. */
  grip: Point | null;
}

export interface WallabyState {
  visible: boolean;
  /** Feet position in frame coordinates. */
  x: number;
  y: number;
  scale: number;
  opacity: number;
  facing: 1 | -1;
  pose: PoseParams;
  expression: WallabyExpression;
  expr: ExpressionParams;
  /** Eye direction, each axis -1..1. */
  gaze: Point;
  /** What WalletWallaby is looking at (frame px), when the clip names a subject. */
  focus: Point | null;
  mouth: Viseme;
  motion: MotionChannels;
}

const OPEN_GROUND = { x0: -1e6, x1: 1e6 } as const;
const REST_TAIL: TailChannels = { swing: 0, curl: 0, tension: 0 };
const REST_CHANNELS: MotionChannels = {
  rotation: 0,
  stretch: 0,
  tailLag: 0,
  earLag: 0,
  headStab: 0,
  contact: 'NONE',
  platformDip: 0,
  action: 'IDLE',
  phase: 'HOLD',
  velocity: { x: 0, y: 0 },
  landingImpulse: 0,
  tail: REST_TAIL,
  support: null,
  idleTimeS: 0,
  grip: null,
};

const HIDDEN_STATE: WallabyState = {
  visible: false,
  x: 0,
  y: 0,
  scale: 1,
  opacity: 0,
  facing: 1,
  pose: POSES.NEUTRAL,
  expression: 'NEUTRAL',
  expr: EXPRESSIONS.NEUTRAL,
  gaze: { x: 0, y: 0 },
  focus: null,
  mouth: 'REST',
  motion: REST_CHANNELS,
};

function clipIndexAt(clips: Clip[], ms: number): number {
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid]!;
    if (ms < c.startMs) hi = mid - 1;
    else if (ms >= c.endMs) lo = mid + 1;
    else return mid;
  }
  return -1;
}

const MAX_RESPONSE_MS = 3000;

/** First event index whose response could still be running at `ms`. */
function firstLiveEvent(events: readonly MotionEvent[], ms: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.atMs < ms - MAX_RESPONSE_MS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

interface Responses {
  crouch: number;
  compression: number;
  headTilt: number;
  tail: number;
  ears: number;
  /** Impact of the most recent landing whose compression is still running. */
  landingImpulse: number;
}

/**
 * Sum of every event's spring response at `ms` (closed form, independent of frame history).
 * Events in `muted` contribute nothing here: their secondary motion is produced elsewhere (the
 * Rust/WASM engine, for the paths it owns). They still drive everything else they drive.
 */
function responsesAt(plan: MotionPlan, ms: number, muted?: ReadonlySet<MotionEvent>): Responses {
  const { response, gains } = plan.config;
  const out: Responses = { crouch: 0, compression: 0, headTilt: 0, tail: 0, ears: 0, landingImpulse: 0 };
  for (let i = firstLiveEvent(plan.events, ms); i < plan.events.length; i++) {
    const e = plan.events[i]!;
    if (e.atMs > ms) break;
    if (muted?.has(e)) continue;
    const dt = ms - e.atMs;
    const comp = springResponse(dt, response.compression);
    const tail = springResponse(dt, response.tail);
    const ears = springResponse(dt, response.ears);
    switch (e.kind) {
      case 'LANDING':
      case 'STEP': {
        const k = e.kind === 'STEP' ? 0.55 : 1;
        // A hard landing compresses deeper and braces the tail harder.
        const hard = e.kind === 'LANDING' ? 1 + 0.5 * hardness(plan.config, e.impulse) : 1;
        out.crouch += gains.landingCrouch * e.impulse * comp * k * hard;
        out.compression += e.impulse * comp * k * hard;
        out.headTilt += gains.landingHeadTiltDeg * e.impulse * comp * k;
        out.tail += gains.landingTailDeg * e.impulse * tail * k * hard;
        out.ears += gains.landingEarDeg * e.impulse * ears * k;
        if (e.kind === 'LANDING' && dt < response.compression.windowMs) out.landingImpulse = e.impulse;
        break;
      }
      case 'TAKEOFF':
      case 'PUSH':
        out.tail += gains.takeoffTailDeg * e.impulse * tail;
        out.ears += gains.takeoffEarDeg * e.impulse * ears;
        break;
      case 'SHIFT':
        out.crouch += gains.landingCrouch * e.impulse * comp * 0.6;
        out.tail += gains.landingTailDeg * e.impulse * tail * 0.6;
        out.ears += gains.landingEarDeg * e.impulse * ears * 0.4;
        break;
    }
  }
  return out;
}

/**
 * Platform displacement for every platform in a segment at `ms` (renderer applies it to the surface and its text).
 * `contacts`: the contact events the scene reacts to, sorted by time. Default: the plan's own; on the paths the
 * Rust/WASM engine performs, the composition passes the engine's contacts instead.
 */
export function platformOffsets(plan: MotionPlan, segmentId: string, ms: number, contacts: readonly MotionEvent[] = plan.events): Record<string, number> {
  const out: Record<string, number> = {};
  const { response, gains, limits } = plan.config;
  for (let i = firstLiveEvent(contacts, ms); i < contacts.length; i++) {
    const e = contacts[i]!;
    if (e.atMs > ms) break;
    if (!e.surface || e.segmentId !== segmentId || (e.kind !== 'LANDING' && e.kind !== 'STEP')) continue;
    const weight = e.surface.kind === 'CARD' ? 0.5 : 1;
    const dip = gains.platformDipPx * weight * e.impulse * Math.min(1, e.scale / 0.7) * springResponse(ms - e.atMs, response.platform);
    out[e.surface.id] = clamp((out[e.surface.id] ?? 0) + dip, -limits.platformMaxPx, limits.platformMaxPx);
  }
  // Quantised to 1/100 px so the platform and the feet on it move by exactly the same amount.
  for (const id of Object.keys(out)) out[id] = Math.round(out[id]! * 100) / 100;
  return out;
}

function gazeToward(x: number, y: number, scale: number, look: Point | null): Point {
  if (!look) return { x: 0, y: 0 };
  const eyeY = y - WALLABY_HEIGHT * scale * 0.82;
  return { x: clamp((look.x - x) / 520, -1, 1), y: clamp((look.y - eyeY) / 380, -1, 1) };
}

/** Fraction of the traced route covered at `ms` (the drawn trail follows the feet). */
export function traverseProgress(plan: MotionPlan, clip: Clip, ms: number): number {
  const idx = plan.clips.indexOf(clip);
  const m = idx >= 0 ? plan.motions[idx] : undefined;
  if (!m || m.kind !== 'TRACE') return clamp((ms - clip.startMs) / (clip.endMs - clip.startMs), 0, 1);
  if (m.bounds) return trailAt(m.bounds, ms);
  return traceProgress(plan.config, m, ms).f;
}

/** Route fraction reached after k of n equal-time bounds: accelerate out, cruise, decelerate in. */
export function stepBoundary(k: number, n: number): number {
  if (k <= 0) return 0;
  if (k >= n) return 1;
  const u = k / n;
  const sine = (1 - Math.cos(Math.PI * u)) / 2;
  const cubic = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
  return (sine + cubic) / 2;
}

function traceProgress(config: MotionConfig, m: TraceMotion, ms: number): { f: number; s: number; step: number } {
  const u = clamp((ms - m.startMs) / (m.endMs - m.startMs), 0, 1);
  if (u >= 1) return { f: 1, s: 1, step: m.steps - 1 };
  const step = Math.min(m.steps - 1, Math.floor(u * m.steps));
  const local = u * m.steps - step;
  const cf = config.trace.contactFrac;
  // Each bound: a short ground contact, then a low ballistic hop at constant speed within the bound.
  const s = local < cf ? 0 : (local - cf) / (1 - cf);
  const a = stepBoundary(step, m.steps);
  const b = stepBoundary(step + 1, m.steps);
  return { f: a + (b - a) * s, s, step };
}

/** Flight posture: takeoff extension, then the long airborne body, reaching feet-first before contact. */
function flightPose(s: number, reach: PoseParams = POSES.LAND): PoseParams {
  if (s < 0.18) return blendPose(TAKEOFF, AIRBORNE, easeInOut(s / 0.18));
  if (s < 0.72) return AIRBORNE;
  return blendPose(AIRBORNE, reach, easeInOut((s - 0.72) / 0.28));
}

/**
 * `mutedResponses`: events whose spring responses (crouch, compression, head tilt, tail and ear
 * follow-through) are left out because another engine produces that secondary motion. Default: none.
 * `contacts`: the contact events the platform under the feet reacts to (see platformOffsets), so the
 * feet ride the platform by exactly the amount the scene moves it. Default: the plan's own.
 */
export function sampleWallaby(plan: MotionPlan, ms: number, mouth: Viseme = 'REST', mutedResponses?: ReadonlySet<MotionEvent>, contacts: readonly MotionEvent[] = plan.events): WallabyState {
  if (!Number.isFinite(ms)) return HIDDEN_STATE;
  const idx = clipIndexAt(plan.clips, ms);
  if (idx < 0) return HIDDEN_STATE;
  const clip = plan.clips[idx]!;
  const motion = plan.motions[idx]!;
  if (clip.kind === 'HIDDEN' || motion.kind === 'HIDDEN') return HIDDEN_STATE;
  const { limits, hold, tail: tailCfg } = plan.config;
  const expr = EXPRESSIONS[clip.expression];
  const r = responsesAt(plan, ms, mutedResponses);

  interface Behaviour {
    grounded: boolean;
    surface?: Surface | null;
    rotation?: number;
    stretch?: number;
    tailLag?: number;
    earLag?: number;
    action: BodyAction;
    phase: BodyPhase;
    velocity?: Point;
    tail?: Partial<TailChannels>;
    grip?: Point;
  }
  const state = (x: number, y: number, scale: number, pose: PoseParams, opacity: number, look: Point | null, b: Behaviour, facing?: 1 | -1): WallabyState => {
    const gaze = gazeToward(x, y, scale, look);
    const onSurface = b.grounded;
    // The feet ride the exact platform they stand on, by the same displacement the renderer applies to it.
    const dip = onSurface && b.surface ? (platformOffsets(plan, clip.segmentId, ms, contacts)[b.surface.id] ?? 0) : 0;
    const rotation = clamp(b.rotation ?? 0, -limits.maxRotationDeg, limits.maxRotationDeg);
    const face: 1 | -1 = facing ?? (look && look.x < x - 12 ? -1 : 1);
    // Narrow perches (graph nodes, pillar tops): the tail corrects the balance in a slow, small sway.
    let swing = b.tail?.swing ?? 0;
    if (onSurface && b.surface && b.phase === 'HOLD' && b.surface.x1 - b.surface.x0 < tailCfg.narrowWidthBodyHeights * bodyHeight(scale)) {
      swing += tailCfg.narrowSwayDeg * Math.sin(((ms - clip.startMs) / tailCfg.narrowSwayPeriodMs) * 2 * Math.PI);
    }
    return {
      visible: opacity > 0.001,
      x,
      y: y + dip,
      scale,
      opacity,
      facing: face,
      pose: { ...pose, crouch: clamp(pose.crouch + (onSurface ? r.crouch : 0), 0, 1), headTilt: pose.headTilt + (onSurface ? r.headTilt : 0) },
      expression: clip.expression,
      expr,
      gaze: facing !== undefined ? { x: Math.abs(gaze.x) * 0.5 * face, y: gaze.y } : gaze,
      focus: look,
      mouth,
      motion: {
        rotation,
        stretch: clamp((b.stretch ?? 0) - (onSurface ? r.compression * limits.maxCompression : 0), -limits.maxCompression, limits.maxStretch),
        tailLag: clamp(r.tail + (b.tailLag ?? 0), -limits.maxTailLagDeg, limits.maxTailLagDeg),
        earLag: clamp(r.ears + (b.earLag ?? 0), -limits.maxEarLagDeg, limits.maxEarLagDeg),
        headStab: clamp(-rotation * 0.6, -limits.maxHeadStabDeg, limits.maxHeadStabDeg),
        contact: !onSurface ? 'NONE' : b.surface ? 'PLATFORM' : 'GROUND',
        platformDip: dip,
        action: b.action,
        phase: b.phase,
        velocity: b.velocity ?? { x: 0, y: 0 },
        landingImpulse: onSurface ? r.landingImpulse : 0,
        tail: {
          swing: clamp(swing, -limits.maxTailSwingDeg, limits.maxTailSwingDeg),
          curl: clamp(b.tail?.curl ?? 0, -limits.maxTailCurlDeg, limits.maxTailCurlDeg),
          tension: clamp(b.tail?.tension ?? tailCfg.restTension, 0, 1),
        },
        support: onSurface ? (b.surface ? { x0: b.surface.x0, x1: b.surface.x1 } : OPEN_GROUND) : null,
        idleTimeS: ms / 1000,
        grip: b.grip ?? null,
      },
    };
  };
  const travelFacing = (): 1 | -1 => (clip.to.x < clip.from.x - 4 ? -1 : 1);
  const entryPose = (): PoseParams => (idx > 0 ? exitPose(plan, plan.clips[idx - 1]!) : POSES[clip.pose]);
  /** The tail in flight: counter-rotates against the pitch, streams against the vertical velocity. */
  const flightTail = (pitchDeg: number, vy: number, speed: number, s: number): Partial<TailChannels> => ({
    swing: -tailCfg.flightCounterGain * pitchDeg + tailCfg.flightStreamDeg * clamp(-vy / Math.max(1, speed), -1, 1) + (s > 0.72 ? tailCfg.reachSwingDeg * easeInOut((s - 0.72) / 0.28) : 0),
    curl: 1.5,
    tension: s < 0.18 ? lerp(tailCfg.takeoffTension, tailCfg.flightTension, s / 0.18) : tailCfg.flightTension,
  });
  /** Preload: the tail loads down and back against the ground, stiffening as the body coils. */
  const preloadTail = (e: number): Partial<TailChannels> => ({ swing: tailCfg.preloadSwingDeg * e, curl: -1 * e, tension: lerp(tailCfg.restTension, tailCfg.preloadTension, e) });
  /** After contact: the tail braces in proportion to the impact, then relaxes. */
  const landingTail = (impulse: number, sinceMs: number): Partial<TailChannels> => {
    const h = hardness(plan.config, impulse);
    const relax = easeOut(clamp(sinceMs / (plan.config.hop.landingBlendMs * (1 + plan.config.landing.hardRecoverScale * h) * 2), 0, 1));
    return { swing: tailCfg.braceSwingDeg * h * (1 - relax), curl: -1.5 * h * (1 - relax), tension: lerp(lerp(tailCfg.restTension, tailCfg.braceTension, h), tailCfg.restTension, relax) };
  };
  const holdAction = (): BodyAction => (clip.pose === 'INSPECT' ? 'INSPECT' : clip.pose === 'PERCH' ? 'PERCH' : 'IDLE');

  switch (motion.kind) {
    case 'HOLD': {
      const u = hold.poseBlendMs > 0 ? easeInOut(clamp((ms - clip.startMs) / hold.poseBlendMs, 0, 1)) : 1;
      const posed = blendPose(motion.entryPose, POSES[clip.pose], u);
      let look = clip.lookAt;
      let facing: 1 | -1 | undefined;
      if (clip.lookAlt && clip.lookAt) {
        // COMPARE: the body holds its stance; the head turns between the two subjects.
        const period = 1100;
        const k = Math.floor((ms - clip.startMs) / period);
        const into = ms - clip.startMs - k * period;
        const [a, b] = k % 2 === 0 ? [clip.lookAlt, clip.lookAt] : [clip.lookAt, clip.lookAlt];
        const w = k === 0 ? 1 : easeInOut(clamp(into / hold.gazeTurnMs, 0, 1));
        look = { x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w) };
        facing = clip.lookAt.x < clip.from.x - 12 ? -1 : 1;
      } else if (motion.entryLook && clip.lookAt && hold.gazeTurnMs > 0) {
        const w = easeInOut(clamp((ms - clip.startMs) / hold.gazeTurnMs, 0, 1));
        look = { x: lerp(motion.entryLook.x, clip.lookAt.x, w), y: lerp(motion.entryLook.y, clip.lookAt.y, w) };
      }
      // Leaning in to inspect, the tail lifts as a counterweight; otherwise it rests as a support. A landing that
      // just happened keeps bracing through the hold until it relaxes (no seam at the clip boundary).
      const inspect = posed.mix.inspect ?? 0;
      const settling = [...plan.events].reverse().find((e) => e.kind === 'LANDING' && e.atMs <= ms);
      const brace = settling ? landingTail(settling.impulse, ms - settling.atMs) : { swing: 0, curl: 0, tension: tailCfg.restTension };
      const tail = { swing: brace.swing ?? 0, curl: (brace.curl ?? 0) + 1.5 * inspect, tension: Math.max(brace.tension ?? tailCfg.restTension, lerp(tailCfg.restTension, 0.35, inspect)) };
      return state(clip.from.x, clip.from.y, clip.fromScale, posed, 1, look, { grounded: true, surface: plan.surfaces[idx]!.from, action: holdAction(), phase: 'HOLD', tail }, facing);
    }
    case 'HOP': {
      const entry = entryPose();
      const surfaceFrom = plan.surfaces[idx]!.from;
      // In flight above the frame before the fall: nothing under the feet, and out of view.
      if (motion.airborneStart && ms < motion.takeoffMs) return state(clip.from.x, clip.from.y, clip.fromScale, AIRBORNE, 1, clip.to, { grounded: false, action: 'AIRBORNE', phase: 'FLIGHT', tail: { swing: 0, curl: 1.5, tension: plan.config.tail.flightTension } }, travelFacing());
      if (ms < motion.orientEndMs) return state(clip.from.x, clip.from.y, clip.fromScale, entry, 1, clip.to, { grounded: true, surface: surfaceFrom, action: 'HOP', phase: 'ORIENT' }, travelFacing());
      if (ms < motion.takeoffMs) {
        const u = clamp((ms - motion.orientEndMs) / (motion.takeoffMs - motion.orientEndMs), 0, 1);
        const e = easeInOut(clamp(u / (1 - plan.config.hop.anticipationHoldFrac), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e), 1, clip.to, { grounded: true, surface: surfaceFrom, stretch: -limits.maxCompression * 0.55 * e, action: 'HOP', phase: 'PRELOAD', tail: preloadTail(e) }, travelFacing());
      }
      if (ms < motion.contactMs) {
        const T = (motion.contactMs - motion.takeoffMs) / 1000;
        const s = (ms - motion.takeoffMs) / (motion.contactMs - motion.takeoffMs);
        const d = clip.to.y - clip.from.y;
        const x = lerp(clip.from.x, clip.to.x, s);
        const y = clip.from.y + d * s - motion.depthPx * s * (1 - s);
        const scale = lerp(clip.fromScale, clip.toScale, s);
        // Velocity direction drives the pitch: nose up while rising, down while falling.
        const vy = d - motion.depthPx * (1 - 2 * s);
        const vx = Math.abs(clip.to.x - clip.from.x);
        const pitch = vy / Math.max(1, Math.hypot(vx, vy));
        // Low skims barely extend: a full takeoff stretch belongs to a real bound.
        const extend = (s < 0.18 ? 1 - s / 0.18 : 0) * clamp(motion.apexAbovePx / (0.3 * bodyHeight(clip.fromScale)), 0, 1);
        const rotation = limits.maxRotationDeg * clamp(pitch * 1.3, -1, 1);
        const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === motion.contactMs);
        const reach = blendPose(POSES.LAND, LAND_HARD, hardness(plan.config, landing?.impulse ?? 0) * 0.5);
        // A flight that was already under way has no push-off to extend from: it is airborne from its first instant.
        const falling = motion.airborneStart === true;
        const pose = falling ? (s < 0.72 ? AIRBORNE : blendPose(AIRBORNE, reach, easeInOut((s - 0.72) / 0.28))) : flightPose(s, reach);
        return state(x, y, scale, pose, 1, clip.to, {
          rotation,
          stretch: falling ? 0 : limits.maxStretch * extend,
          grounded: false,
          action: s < 0.18 && !falling ? 'HOP' : 'AIRBORNE',
          phase: s < 0.18 && !falling ? 'TAKEOFF' : s < 0.72 ? 'FLIGHT' : 'REACH',
          velocity: { x: (clip.to.x - clip.from.x) / T, y: vy / T },
          tail: flightTail(rotation, vy, Math.hypot(vx, vy), s),
        }, travelFacing());
      }
      const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === motion.contactMs);
      const impulse = landing?.impulse ?? 0;
      const since = ms - motion.contactMs;
      return state(clip.to.x, clip.to.y, clip.toScale, landedPose(plan.config, impulse, since), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to, action: 'LAND', phase: since < 90 ? 'CONTACT' : 'SETTLE', tail: landingTail(impulse, since) }, travelFacing());
    }
    case 'MANTLE': {
      const entry = entryPose();
      const body = bodyHeight(clip.toScale);
      const surfaceFrom = plan.surfaces[idx]!.from;
      const ledge = plan.surfaces[idx]!.to;
      if (ms < motion.orientEndMs) return state(clip.from.x, clip.from.y, clip.fromScale, entry, 1, motion.corner, { grounded: true, surface: surfaceFrom, action: 'MANTLE', phase: 'ORIENT' }, travelFacing());
      if (ms < motion.takeoffMs) {
        const e = easeInOut(clamp((ms - motion.orientEndMs) / (motion.takeoffMs - motion.orientEndMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e), 1, motion.corner, { grounded: true, surface: surfaceFrom, stretch: -limits.maxCompression * 0.55 * e, action: 'MANTLE', phase: 'PRELOAD', tail: preloadTail(e) }, travelFacing());
      }
      if (ms < motion.grabMs) {
        const T = (motion.grabMs - motion.takeoffMs) / 1000;
        const s = (ms - motion.takeoffMs) / (motion.grabMs - motion.takeoffMs);
        const at = mantleArc(clip.from, motion, s);
        const vy = motion.hang.y - clip.from.y - motion.depthPx * (1 - 2 * s);
        const vx = motion.hang.x - clip.from.x;
        const rotation = limits.maxRotationDeg * clamp((vy / Math.max(1, Math.hypot(vx, vy))) * 1.3, -1, 1) * (1 - s);
        return state(at.x, at.y, clip.toScale, flightPose(s, MANTLE), 1, motion.corner, { rotation, grounded: false, action: s < 0.18 ? 'HOP' : 'MANTLE', phase: s < 0.18 ? 'TAKEOFF' : s < 0.72 ? 'FLIGHT' : 'REACH', velocity: { x: vx / T, y: vy / T }, tail: flightTail(rotation, vy, Math.hypot(vx, vy), s), grip: s >= 0.72 ? motion.corner : undefined }, travelFacing());
      }
      if (ms < motion.pullMs) {
        // Hang: forelimbs on the ledge, the body settles a few px, the tail swings once and damps as a counterweight.
        const t = (ms - motion.grabMs) / 1000;
        const settle = 0.025 * body * Math.sin(Math.min(Math.PI, t * 14));
        const swing = tailCfg.hangSwingDeg * Math.exp(-t / 0.22) * Math.sin(2 * Math.PI * t * 2.2) - 6;
        return state(motion.hang.x, motion.hang.y + settle, clip.toScale, MANTLE, 1, motion.corner, { grounded: false, action: 'MANTLE', phase: 'HANG', tail: { swing, curl: -1, tension: 0.25 }, grip: motion.corner }, travelFacing());
      }
      if (ms < motion.topMs) {
        // Pull: hindquarters rise as the forelimbs press down; the feet clear the edge, then carry onto the anchor.
        const u = (ms - motion.pullMs) / (motion.topMs - motion.pullMs);
        const at = pullPath(motion, clip.to, body, u);
        const up = clamp(u / PULL_RISE_FRAC, 0, 1);
        const pose = u < PULL_RISE_FRAC ? blendPose(MANTLE, POSES.PREPARE_JUMP, easeInOut(up)) : blendPose(POSES.PREPARE_JUMP, POSES.LAND, easeInOut((u - PULL_RISE_FRAC) / (1 - PULL_RISE_FRAC)));
        const onTop = u >= PULL_RISE_FRAC;
        return state(at.x, at.y, clip.toScale, pose, 1, clip.lookAt ?? clip.to, { grounded: onTop, surface: onTop ? ledge : null, rotation: limits.maxRotationDeg * 0.5 * Math.sin(Math.PI * up), action: 'MANTLE', phase: 'PULL', tail: { swing: tailCfg.pullSwingDeg * Math.sin(Math.PI * up), curl: 0.5, tension: 0.35 }, grip: motion.corner }, travelFacing());
      }
      const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === motion.topMs);
      const since = ms - motion.topMs;
      return state(clip.to.x, clip.to.y, clip.toScale, landedPose(plan.config, landing?.impulse ?? 0, since), 1, clip.lookAt, { grounded: true, surface: ledge, action: 'LAND', phase: 'SETTLE', tail: landingTail(landing?.impulse ?? 0, since) }, travelFacing());
    }
    case 'RISE': {
      const entry = entryPose();
      if (ms < motion.takeoffMs) {
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.takeoffMs - clip.startMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e), 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.55 * e, action: 'HOP', phase: 'PRELOAD', tail: preloadTail(e) }, travelFacing());
      }
      const T = (clip.endMs - motion.takeoffMs) / 1000;
      const s = clamp((ms - motion.takeoffMs) / (clip.endMs - motion.takeoffMs), 0, 1);
      // Ballistic rise that reaches its apex exactly at the clip's end.
      const x = lerp(clip.from.x, clip.to.x, s);
      const y = clip.from.y + (clip.to.y - clip.from.y) * (2 * s - s * s);
      const rotation = -limits.maxRotationDeg * (1 - s);
      const vy = ((clip.to.y - clip.from.y) * (2 - 2 * s)) / T;
      const vx = (clip.to.x - clip.from.x) / T;
      return state(x, y, lerp(clip.fromScale, clip.toScale, s), blendPose(TAKEOFF, AIRBORNE, easeInOut(s / 0.4)), 1, clip.to, { rotation, stretch: limits.maxStretch * (1 - s), grounded: false, action: 'AIRBORNE', phase: s < 0.18 ? 'TAKEOFF' : 'FLIGHT', velocity: { x: vx, y: vy }, tail: flightTail(rotation, vy * T, Math.hypot(vx * T, vy * T), Math.min(s, 0.7)) }, travelFacing());
    }
    case 'TRACE': {
      if (motion.bounds) {
        // A route on footholds: load, then bound between supported footholds; the trail draws during the leap.
        const bounds = motion.bounds;
        const ends = plan.surfaces[idx]!;
        // Every foothold is on one of the route's own two tops: the start's (level with the start) or the end's.
        const under = (p: Point): Surface | null => {
          for (const [s, y] of [[ends.from, clip.from.y], [ends.to, clip.to.y]] as const) if (s && Math.abs(p.y - y) < 0.5 && p.x >= s.x0 && p.x <= s.x1) return s;
          return null;
        };
        const facingOf = (b: TraceBound): 1 | -1 => (Math.abs(b.to.x - b.from.x) > 4 ? (b.to.x < b.from.x ? -1 : 1) : travelFacing());
        const m = traceMoment(bounds, ms);
        const b = bounds[m.bound]!;
        if (m.phase === 'LOAD') {
          const e = easeInOut(clamp((ms - clip.startMs) / Math.max(1, b.takeoffMs - clip.startMs), 0, 1));
          return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entryPose(), POSES.PREPARE_JUMP, e * 0.6), 1, clip.to, { grounded: true, surface: under(clip.from), stretch: -limits.maxCompression * 0.35 * e, action: 'TRACE', phase: 'PRELOAD', tail: preloadTail(e * 0.6) }, facingOf(b));
        }
        if (m.phase === 'DONE') {
          const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === b.contactMs);
          const since = ms - b.contactMs;
          return state(clip.to.x, clip.to.y, clip.toScale, landedPose(plan.config, landing?.impulse ?? 0, since), 1, clip.lookAt, { grounded: true, surface: under(clip.to), action: 'LAND', phase: 'SETTLE', tail: landingTail(landing?.impulse ?? 0, since) }, facingOf(b));
        }
        if (m.phase === 'CONTACT') {
          return state(b.to.x, b.to.y, b.toScale, TRACE, 1, clip.lookAt, { grounded: true, surface: under(b.to), action: 'TRACE', phase: 'STEP', tail: { swing: 3, curl: 1, tension: 0.4 } }, facingOf(bounds[m.bound + 1] ?? b));
        }
        const s = m.s;
        const T = (b.contactMs - b.takeoffMs) / 1000;
        const at = boundFeet(b, s);
        const vy = (b.to.y - b.from.y - b.depthPx * (1 - 2 * s)) / T;
        const vx = (b.to.x - b.from.x) / T;
        const pitch = vy / Math.max(1, Math.hypot(vx, vy));
        const leap = b.kind === 'LEAP';
        const rotation = limits.maxRotationDeg * clamp(pitch * (leap ? 1.3 : plan.config.trace.maxPitchFrac), -1, 1);
        const pose = leap ? flightPose(s) : blendPose(TRACE, AIRBORNE, Math.sin(Math.PI * s) * 0.45);
        return state(at.x, at.y, lerp(b.fromScale, b.toScale, s), pose, 1, clip.lookAt, {
          rotation,
          grounded: false,
          action: leap ? 'AIRBORNE' : 'TRACE',
          phase: leap && s < 0.18 ? 'TAKEOFF' : leap && s >= 0.72 ? 'REACH' : 'FLIGHT',
          velocity: { x: vx, y: vy },
          tail: leap ? flightTail(rotation, vy * T, Math.hypot(vx * T, vy * T), s) : { swing: -0.6 * rotation + 3, curl: 1, tension: 0.4 },
        }, facingOf(b));
      }
      if (ms < motion.startMs) {
        // Loading up for the first bound (SKIP only; a ROUTE trace starts stepping at once).
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.startMs - clip.startMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entryPose(), POSES.PREPARE_JUMP, e * 0.6), 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.35 * e, action: 'TRACE', phase: 'PRELOAD', tail: preloadTail(e * 0.6) }, travelFacing());
      }
      if (ms >= motion.endMs) {
        const landing = plan.events.find((e) => e.kind === 'LANDING' && Math.abs(e.atMs - motion.endMs) < 1e-6);
        const since = ms - motion.endMs;
        return state(clip.to.x, clip.to.y, clip.toScale, landedPose(plan.config, landing?.impulse ?? 0, since), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to, action: 'LAND', phase: 'SETTLE', tail: landingTail(landing?.impulse ?? 0, since) }, travelFacing());
      }
      const { f, s, step } = traceProgress(plan.config, motion, ms);
      const at = pointAt(motion.path, motion.lengths, motion.total, f);
      const scale = lerp(clip.fromScale, clip.toScale, f);
      const lift = motion.peakPx * 4 * s * (1 - s);
      const airborne = s > 0 && s < 1;
      // Pitch follows the local route slope, kept small.
      const next = pointAt(motion.path, motion.lengths, motion.total, stepBoundary(step + 1, motion.steps));
      const prevPt = pointAt(motion.path, motion.lengths, motion.total, stepBoundary(step, motion.steps));
      const slope = (next.y - prevPt.y) / Math.max(1, Math.abs(next.x - prevPt.x) + Math.abs(next.y - prevPt.y));
      const hopPitch = (2 * s - 1) * 0.5;
      const pose = airborne ? blendPose(TRACE, AIRBORNE, Math.sin(Math.PI * s) * 0.45) : TRACE;
      const rotation = limits.maxRotationDeg * plan.config.trace.maxPitchFrac * clamp(slope + hopPitch, -1, 1);
      const boundMs = ((motion.endMs - motion.startMs) / motion.steps) * (1 - plan.config.trace.contactFrac);
      const v = { x: ((next.x - prevPt.x) / Math.max(1, boundMs)) * 1000, y: (((next.y - prevPt.y) - motion.peakPx * 4 * (1 - 2 * s)) / Math.max(1, boundMs)) * 1000 };
      return state(
        at.x,
        at.y - lift,
        scale,
        pose,
        1,
        clip.lookAt,
        {
          rotation,
          grounded: !airborne,
          surface: motion.mode === 'SKIP' ? plan.surfaces[idx]!.from : f >= 1 ? plan.surfaces[idx]!.to : f <= 0 ? plan.surfaces[idx]!.from : null,
          action: 'TRACE',
          phase: airborne ? 'FLIGHT' : 'STEP',
          velocity: airborne ? v : { x: 0, y: 0 },
          // Streaming behind a run of short bounds: a little lift, a little stiffness, never a reset.
          tail: { swing: -0.6 * rotation + 3, curl: 1, tension: 0.4 },
        },
        travelFacing(),
      );
    }
    case 'PUSH': {
      const entry = entryPose();
      const surface = plan.surfaces[idx]!.from;
      if (ms < motion.weightEndMs) {
        // Brace: the stance widens, the tail plants behind as a third point, the weight shifts back.
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.weightEndMs - clip.startMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, PUSH, e), 1, clip.to, { grounded: true, surface, stretch: -limits.maxCompression * 0.6 * e, rotation: plan.config.push.leanBackDeg * 0.5 * e, action: 'PUSH_THROUGH', phase: 'BRACE', tail: { swing: tailCfg.braceSwingDeg * e, curl: -1 * e, tension: lerp(tailCfg.restTension, tailCfg.braceTension, e) } });
      }
      if (ms < motion.driveMs) {
        // Load: the weight rolls forward into the forelimbs; force goes into the surface.
        const e = easeInOut(clamp((ms - motion.weightEndMs) / (motion.driveMs - motion.weightEndMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(PUSH, blendPose(PUSH, POSES.PREPARE_JUMP, 0.35), e), 1, clip.to, { grounded: true, surface, stretch: -limits.maxCompression * 0.6 * (1 - e * 0.5), rotation: lerp(plan.config.push.leanBackDeg * 0.5, limits.maxRotationDeg * 0.6, e), action: 'PUSH_THROUGH', phase: 'LOAD', tail: { swing: tailCfg.braceSwingDeg, curl: -1, tension: tailCfg.braceTension } });
      }
      // Drive: constant acceleration along the force direction, into depth; the body follows its own momentum.
      const T = (clip.endMs - motion.driveMs) / 1000;
      const u = clamp((ms - motion.driveMs) / (clip.endMs - motion.driveMs), 0, 1);
      const f = u * u;
      const x = lerp(clip.from.x, clip.to.x, f);
      const y = lerp(clip.from.y, clip.to.y, f) - plan.config.push.arcPx * Math.sin(f * Math.PI);
      const dirY = clip.to.y - clip.from.y;
      const pitch = dirY / Math.max(1, Math.hypot(clip.to.x - clip.from.x, dirY));
      const df = (2 * u) / T;
      const v = { x: (clip.to.x - clip.from.x) * df, y: dirY * df - plan.config.push.arcPx * Math.cos(f * Math.PI) * Math.PI * df };
      return state(x, y, lerp(clip.fromScale, clip.toScale, f), blendPose(blendPose(PUSH, TAKEOFF, clamp(u * 3, 0, 1)), AIRBORNE, clamp((u - 0.33) * 1.5, 0, 1)), 1 - f, clip.to, { rotation: limits.maxRotationDeg * clamp(0.6 + pitch, -1, 1), stretch: limits.maxStretch * (1 - u), grounded: false, action: 'PUSH_THROUGH', phase: 'DRIVE', velocity: v, tail: { swing: 6 * u, curl: 1, tension: lerp(tailCfg.braceTension, tailCfg.flightTension, u) } });
    }
    case 'DROP': {
      const fade = clamp((ms - clip.startMs) / Math.max(1, (motion.contactMs - clip.startMs) * plan.config.drop.fadeFrac), 0, 1);
      if (ms < motion.contactMs) {
        const t = (ms - clip.startMs) / 1000;
        const y = clip.from.y + 0.5 * motion.gravityPx * t * t;
        const s = (ms - clip.startMs) / (motion.contactMs - clip.startMs);
        const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === motion.contactMs);
        const reach = blendPose(POSES.LAND, LAND_HARD, hardness(plan.config, landing?.impulse ?? 0) * 0.5);
        const vy = motion.gravityPx * t;
        return state(clip.to.x, Math.min(y, clip.to.y), clip.fromScale, s < 0.6 ? AIRBORNE : blendPose(AIRBORNE, reach, easeInOut((s - 0.6) / 0.4)), fade, clip.lookAt, { stretch: limits.maxStretch * s * 0.6, grounded: false, action: 'AIRBORNE', phase: s < 0.6 ? 'FALL' : 'REACH', velocity: { x: 0, y: vy }, tail: { swing: tailCfg.flightStreamDeg * clamp(vy / 1200, 0, 1) + (s > 0.6 ? tailCfg.reachSwingDeg * easeInOut((s - 0.6) / 0.4) : 0), curl: 1.5, tension: tailCfg.flightTension } });
      }
      const landing = plan.events.find((e) => e.kind === 'LANDING' && e.atMs === motion.contactMs);
      const since = ms - motion.contactMs;
      return state(clip.to.x, clip.to.y, clip.fromScale, landedPose(plan.config, landing?.impulse ?? 0, since), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to, action: 'LAND', phase: since < 90 ? 'CONTACT' : 'SETTLE', tail: landingTail(landing?.impulse ?? 0, since) });
    }
  }
  return HIDDEN_STATE;
}
