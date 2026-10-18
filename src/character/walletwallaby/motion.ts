// WalletWallaby motion: HOW the guide moves, never WHERE.
//
// The choreography (./choreography.ts) resolves every destination from the
// VideoSpec and fixes each clip's endpoints and time window. This module turns
// those fixed clips into a deterministic motion plan (ballistic hops with
// anticipation, contact, compression, and settle; chained trace steps; a
// weight-shifted push into depth; a free-fall drop-in) and samples pose
// channels at any absolute time.
//
// Everything is closed-form: positions are ballistic arcs, secondary motion is
// a sum of analytic damped-spring responses to the plan's own contact events,
// and there is no integration over frame history, no clock, and no randomness.
// A clip's destination is an input the solver can only reach, never choose: the
// sampled position after contact is the authored anchor itself. Isomorphic.

import motionConfigJson from '../../../config/motion.json' with { type: 'json' };
import { easeInOut, easeOut, lerp, type Point } from '../../layout/geometry.ts';
import { intersects, type Rect } from '../../layout/geometry.ts';
import { EYEBROW_RECT, wallabyBounds, type PlatformKind, type SceneLayout } from '../../layout/scene-layout.ts';
import type { WallabyExpression } from '../../spec/vocabulary.ts';
import type { Clip } from './choreography.ts';
import { AIRBORNE, blendPose, EXPRESSIONS, POSES, WALLABY_HEIGHT, type ExpressionParams, type PoseParams, type Viseme } from './rig.ts';

// ── Configuration ───────────────────────────────────────────────────────────

export interface SpringConfig {
  freqHz: number;
  damping: number;
  windowMs: number;
}

export interface MotionConfig {
  schema: 'walletwall.motion-config/v1';
  id: string;
  version: number;
  note: string;
  gravityBodyHeightsPerS2: number;
  maxGravityBoost: number;
  hop: { peakBase: number; peakPerPx: number; peakMin: number; peakMax: number; anticipationMs: number; anticipationHoldFrac: number; orientMaxMs: number; minFlightMs: number; landingBlendMs: number };
  trace: { strideBodyHeights: number; stepPeakBodyHeights: number; contactFrac: number; stepImpulse: number; maxPitchFrac: number; skipStepMs: number };
  push: { weightBackFrac: number; driveStartFrac: number; leanBackDeg: number; arcPx: number };
  drop: { heightPx: number; fadeFrac: number };
  hold: { poseBlendMs: number; shiftImpulse: number; gazeTurnMs: number; breathePeriodMs: number; breatheCrouch: number };
  response: { compression: SpringConfig; tail: SpringConfig; ears: SpringConfig; platform: SpringConfig };
  gains: { landingCrouch: number; landingHeadTiltDeg: number; landingTailDeg: number; landingEarDeg: number; takeoffTailDeg: number; takeoffEarDeg: number; platformDipPx: number };
  limits: { maxRotationDeg: number; maxCompression: number; maxStretch: number; maxTailLagDeg: number; maxEarLagDeg: number; maxHeadStabDeg: number; platformMaxPx: number; maxSpeedBodyHeightsPerS: number };
}

/** Any refusal by the motion layer: invalid config, non-finite input, or a move that cannot fit its window. */
export class MotionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionPlanError';
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

type Range = readonly [min: number, max: number];

/** Inclusive bounds for every numeric field; anything else (or missing, or non-finite) is refused. */
const CONFIG_BOUNDS: Record<string, Range | Record<string, Range | Record<string, Range>>> = {
  gravityBodyHeightsPerS2: [4, 80],
  maxGravityBoost: [1, 3],
  hop: { peakBase: [0, 2], peakPerPx: [0, 1], peakMin: [0.01, 2], peakMax: [0.01, 2], anticipationMs: [0, 600], anticipationHoldFrac: [0, 0.8], orientMaxMs: [0, 600], minFlightMs: [60, 2000], landingBlendMs: [0, 600] },
  trace: { strideBodyHeights: [0.1, 3], stepPeakBodyHeights: [0, 0.5], contactFrac: [0, 0.6], stepImpulse: [0, 1], maxPitchFrac: [0, 1], skipStepMs: [80, 1000] },
  push: { weightBackFrac: [0, 0.6], driveStartFrac: [0, 0.8], leanBackDeg: [-20, 0], arcPx: [0, 300] },
  drop: { heightPx: [1, 1200], fadeFrac: [0, 1] },
  hold: { poseBlendMs: [0, 2000], shiftImpulse: [0, 1], gazeTurnMs: [0, 1500], breathePeriodMs: [500, 20000], breatheCrouch: [0, 0.1] },
  response: {
    compression: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    tail: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    ears: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
    platform: { freqHz: [0.1, 20], damping: [0.05, 0.95], windowMs: [100, 3000] },
  },
  gains: { landingCrouch: [0, 1], landingHeadTiltDeg: [-20, 20], landingTailDeg: [-40, 40], landingEarDeg: [-30, 30], takeoffTailDeg: [-40, 40], takeoffEarDeg: [-30, 30], platformDipPx: [0, 8] },
  limits: { maxRotationDeg: [0, 30], maxCompression: [0, 0.3], maxStretch: [0, 0.3], maxTailLagDeg: [0, 60], maxEarLagDeg: [0, 30], maxHeadStabDeg: [0, 20], platformMaxPx: [0, 8], maxSpeedBodyHeightsPerS: [1, 60] },
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
  if (c.schema !== 'walletwall.motion-config/v1') throw new MotionPlanError('motion config: unsupported schema');
  if (typeof c.id !== 'string' || !/^[a-z0-9-]+$/.test(c.id)) throw new MotionPlanError('motion config: id must be a slug');
  if (!Number.isInteger(c.version) || c.version < 1) throw new MotionPlanError('motion config: version must be a positive integer');
  if (c.hop.peakMin > c.hop.peakMax) throw new MotionPlanError('motion config: hop.peakMin exceeds hop.peakMax');
  if (c.push.weightBackFrac > c.push.driveStartFrac) throw new MotionPlanError('motion config: push weight shift must end before the drive');
  if (c.gains.platformDipPx > c.limits.platformMaxPx) throw new MotionPlanError('motion config: platform dip exceeds its limit');
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

/**
 * Depth parameter c of the parabola y(s) = y0 + (y1 - y0)s - c·s(1 - s), s ∈ [0, 1],
 * whose apex sits h px above the higher endpoint (screen y grows downward).
 */
export function arcDepth(y0: number, y1: number, h: number): number {
  const d = y1 - y0;
  const k = y0 - Math.min(y0, y1) + h;
  return d + 2 * k + 2 * Math.sqrt(k * (k + d));
}

// ── Plans ───────────────────────────────────────────────────────────────────

export type MotionEventKind = 'TAKEOFF' | 'LANDING' | 'STEP' | 'PUSH' | 'SHIFT';

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
  surface: { id: string; kind: PlatformKind } | null;
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

export type ClipMotion = HopMotion | RiseMotion | TraceMotion | PushMotion | DropMotion | HoldMotion | { kind: 'HIDDEN' };

export type Surface = MotionEvent['surface'];

export interface MotionPlan {
  config: MotionConfig;
  clips: Clip[];
  motions: ClipMotion[];
  /** Platform under each clip's start and end point (null = open ground or air). */
  surfaces: { from: Surface; to: Surface }[];
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
/** Every move touches down at least this long before its clip ends, so the clip closes standing on its anchor. */
const SETTLE_RESERVE_MS = 40;

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

/** Platform whose top edge carries this point (the information terrain under the feet). */
function surfaceUnder(layout: SceneLayout | undefined, at: Point): MotionEvent['surface'] {
  if (!layout) return null;
  for (const p of layout.platforms) {
    if (p.kind === 'FRAME') continue; // a UI capture is evidence, not terrain
    if (Math.abs(p.rect.y - at.y) <= 1 && at.x >= p.rect.x && at.x <= p.rect.x + p.rect.w) return { id: p.id, kind: p.kind };
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

/** Pose a clip leaves WalletWallaby in: the base the next clip starts from. */
function exitPose(clip: Clip): PoseParams {
  return clip.kind === 'HOLD' ? POSES[clip.pose] : POSES.LAND;
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
        const layout = layouts.get(clip.segmentId);
        const avoid = layout ? [...layout.texts.map((t) => t.rect), EYEBROW_RECT] : undefined;
        const here = surfaces[motions.length]!;
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
        const hop = planHop({ from: clip.from, to: clip.to, fromScale: clip.fromScale, toScale: clip.toScale, startMs: clip.startMs, endMs: clip.endMs, avoid }, config);
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
        const path = clip.path.map((p) => finitePoint(p, 'trace.path'));
        const { lengths, total } = polylineLengths(path);
        const stride = config.trace.strideBodyHeights * bodyHeight(clip.fromScale);
        const steps = Math.max(1, Math.round(total / stride));
        const layout = layouts.get(clip.segmentId);
        const clear = layout ? clearanceAbove(path, clip.fromScale, [...layout.texts.map((t) => t.rect), EYEBROW_RECT]) - 1 : Infinity;
        const peakPx = Math.max(0, Math.min(config.trace.stepPeakBodyHeights * bodyHeight(clip.fromScale), clear));
        const trace: TraceMotion = { kind: 'TRACE', mode: 'ROUTE', path, steps, lengths, total, startMs: clip.startMs, endMs: clip.endMs - Math.min(SETTLE_RESERVE_MS, (clip.endMs - clip.startMs) * 0.05), peakPx };
        motions.push(trace);
        stepEvents(trace, clip);
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
        const entryPose = prev && prev.kind !== 'HIDDEN' && prev.kind !== 'PUSH' ? exitPose(prev) : POSES[clip.pose];
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

export interface MotionChannels {
  /** Whole-body pitch in degrees, positive = nose toward the facing direction. */
  rotation: number;
  /** Vertical scale offset: positive stretches, negative compresses. */
  stretch: number;
  /** Tail swing added to the pose's tail angle, degrees. */
  tailLag: number;
  /** Ear swing added to the expression's ear rotation, degrees. */
  earLag: number;
  /** Head counter-rotation that keeps the gaze steady, degrees. */
  headStab: number;
  contact: 'NONE' | 'GROUND' | 'PLATFORM';
  /** Downward displacement of the platform under the feet, px (feet follow it). */
  platformDip: number;
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
  mouth: Viseme;
  motion: MotionChannels;
}

const REST_CHANNELS: MotionChannels = { rotation: 0, stretch: 0, tailLag: 0, earLag: 0, headStab: 0, contact: 'NONE', platformDip: 0 };

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
function firstLiveEvent(events: MotionEvent[], ms: number): number {
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
}

/** Sum of every event's spring response at `ms` (closed form, independent of frame history). */
function responsesAt(plan: MotionPlan, ms: number): Responses {
  const { response, gains } = plan.config;
  const out: Responses = { crouch: 0, compression: 0, headTilt: 0, tail: 0, ears: 0 };
  for (let i = firstLiveEvent(plan.events, ms); i < plan.events.length; i++) {
    const e = plan.events[i]!;
    if (e.atMs > ms) break;
    const dt = ms - e.atMs;
    const comp = springResponse(dt, response.compression);
    const tail = springResponse(dt, response.tail);
    const ears = springResponse(dt, response.ears);
    switch (e.kind) {
      case 'LANDING':
      case 'STEP': {
        const k = e.kind === 'STEP' ? 0.55 : 1;
        out.crouch += gains.landingCrouch * e.impulse * comp * k;
        out.compression += e.impulse * comp * k;
        out.headTilt += gains.landingHeadTiltDeg * e.impulse * comp * k;
        out.tail += gains.landingTailDeg * e.impulse * tail * k;
        out.ears += gains.landingEarDeg * e.impulse * ears * k;
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

/** Platform displacement for every platform in a segment at `ms` (renderer applies it to the surface and its text). */
export function platformOffsets(plan: MotionPlan, segmentId: string, ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  const { response, gains, limits } = plan.config;
  for (let i = firstLiveEvent(plan.events, ms); i < plan.events.length; i++) {
    const e = plan.events[i]!;
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

export function sampleWallaby(plan: MotionPlan, ms: number, mouth: Viseme = 'REST'): WallabyState {
  if (!Number.isFinite(ms)) return HIDDEN_STATE;
  const idx = clipIndexAt(plan.clips, ms);
  if (idx < 0) return HIDDEN_STATE;
  const clip = plan.clips[idx]!;
  const motion = plan.motions[idx]!;
  if (clip.kind === 'HIDDEN' || motion.kind === 'HIDDEN') return HIDDEN_STATE;
  const { limits, hold } = plan.config;
  const expr = EXPRESSIONS[clip.expression];
  const r = responsesAt(plan, ms);

  type Grounding = { grounded: boolean; surface?: Surface };
  const state = (x: number, y: number, scale: number, pose: PoseParams, opacity: number, look: Point | null, ch: Partial<MotionChannels> & Grounding, facing?: 1 | -1): WallabyState => {
    const gaze = gazeToward(x, y, scale, look);
    const onSurface = ch.grounded;
    // The feet ride the exact platform they stand on, by the same displacement the renderer applies to it.
    const dip = onSurface && ch.surface ? (platformOffsets(plan, clip.segmentId, ms)[ch.surface.id] ?? 0) : 0;
    const rotation = clamp(ch.rotation ?? 0, -limits.maxRotationDeg, limits.maxRotationDeg);
    return {
      visible: opacity > 0.001,
      x,
      y: y + dip,
      scale,
      opacity,
      facing: facing ?? (look && look.x < x - 12 ? -1 : 1),
      pose: { ...pose, crouch: clamp(pose.crouch + (onSurface ? r.crouch : 0), 0, 1), headTilt: pose.headTilt + (onSurface ? r.headTilt : 0) },
      expression: clip.expression,
      expr,
      gaze: facing !== undefined ? { x: Math.abs(gaze.x) * 0.5, y: gaze.y } : gaze,
      mouth,
      motion: {
        rotation,
        stretch: clamp((ch.stretch ?? 0) - (onSurface ? r.compression * limits.maxCompression : 0), -limits.maxCompression, limits.maxStretch),
        tailLag: clamp(r.tail + (ch.tailLag ?? 0), -limits.maxTailLagDeg, limits.maxTailLagDeg),
        earLag: clamp(r.ears + (ch.earLag ?? 0), -limits.maxEarLagDeg, limits.maxEarLagDeg),
        headStab: clamp(-rotation * 0.6, -limits.maxHeadStabDeg, limits.maxHeadStabDeg),
        contact: !onSurface ? 'NONE' : ch.surface ? 'PLATFORM' : 'GROUND',
        platformDip: dip,
      },
    };
  };
  const travelFacing = (): 1 | -1 => (clip.to.x < clip.from.x - 4 ? -1 : 1);

  switch (motion.kind) {
    case 'HOLD': {
      const u = hold.poseBlendMs > 0 ? easeInOut(clamp((ms - clip.startMs) / hold.poseBlendMs, 0, 1)) : 1;
      const posed = blendPose(motion.entryPose, POSES[clip.pose], u);
      const breathe = Math.sin(((ms - clip.startMs) / hold.breathePeriodMs) * Math.PI * 2) * hold.breatheCrouch;
      let look = clip.lookAt;
      let facing: 1 | -1 | undefined;
      if (clip.lookAlt && clip.lookAt) {
        // COMPARE: the body holds its stance; the head turns between the two subjects.
        const period = 1100;
        const k = Math.floor((ms - clip.startMs) / period);
        const into = (ms - clip.startMs) - k * period;
        const [a, b] = k % 2 === 0 ? [clip.lookAlt, clip.lookAt] : [clip.lookAt, clip.lookAlt];
        const w = k === 0 ? 1 : easeInOut(clamp(into / hold.gazeTurnMs, 0, 1));
        look = { x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w) };
        facing = clip.lookAt.x < clip.from.x - 12 ? -1 : 1;
      } else if (motion.entryLook && clip.lookAt && hold.gazeTurnMs > 0) {
        const w = easeInOut(clamp((ms - clip.startMs) / hold.gazeTurnMs, 0, 1));
        look = { x: lerp(motion.entryLook.x, clip.lookAt.x, w), y: lerp(motion.entryLook.y, clip.lookAt.y, w) };
      }
      return state(clip.from.x, clip.from.y, clip.fromScale, { ...posed, crouch: posed.crouch + breathe }, 1, look, { grounded: true, surface: plan.surfaces[idx]!.from }, facing);
    }
    case 'HOP': {
      const entry = idx > 0 ? exitPose(plan.clips[idx - 1]!) : POSES[clip.pose];
      if (ms < motion.orientEndMs) return state(clip.from.x, clip.from.y, clip.fromScale, entry, 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from }, travelFacing());
      if (ms < motion.takeoffMs) {
        const u = clamp((ms - motion.orientEndMs) / (motion.takeoffMs - motion.orientEndMs), 0, 1);
        const e = easeInOut(clamp(u / (1 - plan.config.hop.anticipationHoldFrac), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e), 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.55 * e }, travelFacing());
      }
      if (ms < motion.contactMs) {
        const s = (ms - motion.takeoffMs) / (motion.contactMs - motion.takeoffMs);
        const d = clip.to.y - clip.from.y;
        const x = lerp(clip.from.x, clip.to.x, s);
        const y = clip.from.y + d * s - motion.depthPx * s * (1 - s);
        const scale = lerp(clip.fromScale, clip.toScale, s);
        // Velocity direction drives the pitch: nose up while rising, down while falling.
        const vy = d - motion.depthPx * (1 - 2 * s);
        const vx = Math.abs(clip.to.x - clip.from.x);
        const pitch = vy / Math.max(1, Math.hypot(vx, vy));
        const tuck = Math.pow(Math.sin(Math.PI * s), 0.8);
        // Low skims barely extend: a full takeoff stretch belongs to a real bound.
        const extend = (s < 0.18 ? 1 - s / 0.18 : 0) * clamp(motion.apexAbovePx / (0.3 * bodyHeight(clip.fromScale)), 0, 1);
        const pose = blendPose(blendPose(POSES.PREPARE_JUMP, AIRBORNE, clamp(s / 0.15, 0, 1)), { ...AIRBORNE, airborne: tuck }, 1);
        return state(x, y, scale, pose, 1, clip.to, { rotation: limits.maxRotationDeg * clamp(pitch * 1.3, -1, 1), stretch: limits.maxStretch * extend, grounded: false }, travelFacing());
      }
      const settle = plan.config.hop.landingBlendMs > 0 ? easeOut(clamp((ms - motion.contactMs) / plan.config.hop.landingBlendMs, 0, 1)) : 1;
      return state(clip.to.x, clip.to.y, clip.toScale, blendPose({ ...AIRBORNE, airborne: 0 }, POSES.LAND, settle), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to }, travelFacing());
    }
    case 'RISE': {
      const entry = idx > 0 ? exitPose(plan.clips[idx - 1]!) : POSES[clip.pose];
      if (ms < motion.takeoffMs) {
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.takeoffMs - clip.startMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e), 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.55 * e }, travelFacing());
      }
      const s = clamp((ms - motion.takeoffMs) / (clip.endMs - motion.takeoffMs), 0, 1);
      // Ballistic rise that reaches its apex exactly at the clip's end.
      const x = lerp(clip.from.x, clip.to.x, s);
      const y = clip.from.y + (clip.to.y - clip.from.y) * (2 * s - s * s);
      return state(x, y, lerp(clip.fromScale, clip.toScale, s), { ...AIRBORNE, airborne: Math.sin((Math.PI / 2) * s) }, 1, clip.to, { rotation: -limits.maxRotationDeg * (1 - s), stretch: limits.maxStretch * (1 - s), grounded: false }, travelFacing());
    }
    case 'TRACE': {
      if (ms < motion.startMs) {
        // Loading up for the first bound (SKIP only; a ROUTE trace starts stepping at once).
        const entry = idx > 0 ? exitPose(plan.clips[idx - 1]!) : POSES[clip.pose];
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.startMs - clip.startMs), 0, 1));
        return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(entry, POSES.PREPARE_JUMP, e * 0.6), 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.35 * e }, travelFacing());
      }
      if (ms >= motion.endMs) {
        const settle = plan.config.hop.landingBlendMs > 0 ? easeOut(clamp((ms - motion.endMs) / plan.config.hop.landingBlendMs, 0, 1)) : 1;
        return state(clip.to.x, clip.to.y, clip.toScale, blendPose({ ...AIRBORNE, airborne: 0 }, POSES.LAND, settle), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to }, travelFacing());
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
      const pose = airborne ? blendPose(POSES.LAND, { ...AIRBORNE, airborne: Math.sin(Math.PI * s) * 0.6 }, Math.sin(Math.PI * s)) : POSES.LAND;
      return state(
        at.x,
        at.y - lift,
        scale,
        pose,
        1,
        clip.lookAt,
        { rotation: limits.maxRotationDeg * plan.config.trace.maxPitchFrac * clamp(slope + hopPitch, -1, 1), grounded: !airborne, surface: motion.mode === 'SKIP' ? plan.surfaces[idx]!.from : f >= 1 ? plan.surfaces[idx]!.to : f <= 0 ? plan.surfaces[idx]!.from : null },
        travelFacing(),
      );
    }
    case 'PUSH': {
      const entry = idx > 0 ? exitPose(plan.clips[idx - 1]!) : POSES[clip.pose];
      if (ms < motion.weightEndMs) {
        // Weight shifts back onto the haunches before the push.
        const e = easeInOut(clamp((ms - clip.startMs) / (motion.weightEndMs - clip.startMs), 0, 1));
        const pose = blendPose(entry, { ...POSES.PREPARE_JUMP, lean: plan.config.push.leanBackDeg }, e);
        return state(clip.from.x, clip.from.y, clip.fromScale, pose, 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.7 * e, rotation: plan.config.push.leanBackDeg * 0.5 * e });
      }
      if (ms < motion.driveMs) {
        // Load into the push: weight rolls forward over the feet.
        const e = easeInOut(clamp((ms - motion.weightEndMs) / (motion.driveMs - motion.weightEndMs), 0, 1));
        const pose = blendPose({ ...POSES.PREPARE_JUMP, lean: plan.config.push.leanBackDeg }, POSES.PREPARE_JUMP, e);
        return state(clip.from.x, clip.from.y, clip.fromScale, pose, 1, clip.to, { grounded: true, surface: plan.surfaces[idx]!.from, stretch: -limits.maxCompression * 0.7 * (1 - e), rotation: lerp(plan.config.push.leanBackDeg * 0.5, limits.maxRotationDeg * 0.6, e) });
      }
      // Drive: constant acceleration along the force direction, into depth.
      const u = clamp((ms - motion.driveMs) / (clip.endMs - motion.driveMs), 0, 1);
      const f = u * u;
      const x = lerp(clip.from.x, clip.to.x, f);
      const y = lerp(clip.from.y, clip.to.y, f) - plan.config.push.arcPx * Math.sin(f * Math.PI);
      const dirY = clip.to.y - clip.from.y;
      const pitch = dirY / Math.max(1, Math.hypot(clip.to.x - clip.from.x, dirY));
      return state(x, y, lerp(clip.fromScale, clip.toScale, f), { ...AIRBORNE, airborne: Math.min(1, u * 2) }, 1 - f, clip.to, { rotation: limits.maxRotationDeg * clamp(0.6 + pitch, -1, 1), stretch: limits.maxStretch * (1 - u), grounded: false });
    }
    case 'DROP': {
      const fade = clamp((ms - clip.startMs) / Math.max(1, (motion.contactMs - clip.startMs) * plan.config.drop.fadeFrac), 0, 1);
      if (ms < motion.contactMs) {
        const t = (ms - clip.startMs) / 1000;
        const y = clip.from.y + 0.5 * motion.gravityPx * t * t;
        const s = (ms - clip.startMs) / (motion.contactMs - clip.startMs);
        return state(clip.to.x, Math.min(y, clip.to.y), clip.fromScale, { ...AIRBORNE, airborne: Math.sin(Math.PI * Math.min(1, s * 1.1)) }, fade, clip.lookAt, { stretch: limits.maxStretch * s * 0.6, grounded: false });
      }
      const settle = plan.config.hop.landingBlendMs > 0 ? easeOut(clamp((ms - motion.contactMs) / plan.config.hop.landingBlendMs, 0, 1)) : 1;
      return state(clip.to.x, clip.to.y, clip.fromScale, blendPose({ ...AIRBORNE, airborne: 0 }, POSES.LAND, settle), 1, clip.lookAt, { grounded: true, surface: plan.surfaces[idx]!.to });
    }
  }
  return HIDDEN_STATE;
}
