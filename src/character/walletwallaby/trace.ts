// Route traces on supported footholds.
//
// A TRACE follows a drawn route (an edge between two graph nodes, or a loop
// over one) while the trail fills in behind the body. The route is information,
// not terrain, so the body never stands on it. Every contact of a trace is a
// foothold the support judge accepts (./support.ts) on the top of one of the
// route's own nodes; what the route spans between them (the gap between two
// nodes, a loop over one, a rise from a lower plane to a node above) is crossed
// in the air, as one leap, while the trail draws. A leap never passes through a
// solid block: the planner takes a higher arc or another foothold on the same
// node, and refuses the trace when nothing clears.
//
// The route decides WHERE (its two nodes, in its order); the footholds are only
// ever on those nodes, chosen from a fixed grid in a fixed order. Closed form
// and pure. Isomorphic.

import { intersects, type Point, type Rect } from '../../layout/geometry.ts';
import { wallabyBounds } from '../../layout/scene-layout.ts';
import { solidsOf, type Terrain, type TerrainSurface } from '../../layout/terrain.ts';
import { arcDepth, MotionPlanError } from './ballistics.ts';
import type { MotionConfig } from './motion.ts';
import { WALLABY_HEIGHT } from './rig.ts';
import { evaluateStance } from './support.ts';

export interface TraceBound {
  /** A low bound along one top, or the leap across what the route spans. */
  kind: 'SKIP' | 'LEAP';
  from: Point;
  to: Point;
  fromScale: number;
  toScale: number;
  takeoffMs: number;
  contactMs: number;
  /** The parabola y(s) = y0 + (y1 - y0)s - c·s(1 - s) the feet fly, and the gravity that times it, px/s². */
  depthPx: number;
  gravityPx: number;
  /** Fraction of the drawn route the trail shows at takeoff and at contact. */
  trail: readonly [number, number];
}

export interface FootholdTraceArgs {
  from: Point;
  to: Point;
  fromScale: number;
  toScale: number;
  startMs: number;
  endMs: number;
  /** The route as the clip carries it: [from stand, ...the drawn route's points, to stand]. */
  path: readonly Point[];
  terrain: Terrain;
}

/** Heights tried for a leap, as fractions of the natural one: natural, then higher (to clear a block), then lower. */
const LEAP_ARCS = [1, 1.3, 1.65, 2.2, 3, 0.75, 0.5] as const;
const LEAP_SAMPLES = 32;
/** The ground contact between bounds, and the load before the first, ms (before any spare time is shared out). */
const CONTACT_MS = 60;
const LOAD_MS = 110;
/** A foothold grid step along a top, body heights. */
const GRID_BH = 0.25;

const bodyHeight = (scale: number): number => WALLABY_HEIGHT * scale;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);

interface Leg {
  kind: 'SKIP' | 'LEAP';
  from: Point;
  to: Point;
  fromScale: number;
  toScale: number;
  depthPx: number;
  trail: readonly [number, number];
}

/** Feet on the parabola of a leg at s ∈ [0, 1]. */
const feetAt = (l: Pick<Leg, 'from' | 'to' | 'depthPx'>, s: number): Point => ({ x: lerp(l.from.x, l.to.x, s), y: l.from.y + (l.to.y - l.from.y) * s - l.depthPx * s * (1 - s) });

/** Plan a trace's bounds: footholds on the route's own nodes, the span between them crossed in one leap. Fails closed. */
export function planFootholdTrace(args: FootholdTraceArgs, config: MotionConfig): TraceBound[] {
  const sup = config.support;
  const { from, to, fromScale, toScale, terrain } = args;
  const solids = solidsOf(terrain).map((s) => s.rect);
  const accept = (at: Point, scale: number, facing: 1 | -1): boolean => evaluateStance({ at, scale, facing, role: 'STEP', narrowAllowed: true }, terrain, sup).ok;
  const topUnder = (at: Point, scale: number, facing: 1 | -1, what: string): TerrainSurface => {
    const v = evaluateStance({ at, scale, facing, role: 'STEP', narrowAllowed: true }, terrain, sup);
    const top = v.ok ? terrain.surfaces.find((s) => s.id === v.surface) : undefined;
    if (!top) throw new MotionPlanError(`trace: the ${what} (${at.x}, ${at.y}) is not a supported foothold: ${v.reason}`);
    return top;
  };
  const a = topUnder(from, fromScale, sign(to.x - from.x), 'start');
  const b = topUnder(to, toScale, sign(to.x - from.x), 'end');
  const route = args.path.slice(1, -1);
  if (route.length < 2) throw new MotionPlanError('trace: the route has no drawn points');

  /** Low bounds along one top, from p to q (each lifted no higher than the text above allows). */
  const skips = (p: Point, q: Point, scale: number, trail: number): Leg[] => {
    const bh = bodyHeight(scale);
    const dx = q.x - p.x;
    if (Math.abs(dx) <= 0.12 * bh) return [];
    const n = Math.max(1, Math.round(Math.abs(dx) / (config.trace.strideBodyHeights * bh)));
    const peak = Math.max(0, Math.min(config.trace.stepPeakBodyHeights * 1.6 * bh, clearanceAbove(p, q, scale, terrain.protectedText) - 1));
    return Array.from({ length: n }, (_, k) => ({ kind: 'SKIP' as const, from: { x: p.x + (dx * k) / n, y: p.y }, to: { x: p.x + (dx * (k + 1)) / n, y: p.y }, fromScale: scale, toScale: scale, depthPx: arcDepth(p.y, p.y, peak), trail: [trail, trail] as const }));
  };

  let legs: Leg[];
  if (a.id === b.id) {
    // Around a loop over one node: step out to where the loop leaves the top, leap the loop, step back.
    const onTop = (p: Point): boolean => Math.abs(p.y - a.y0) <= sup.tolerancePx && p.x >= a.x0 && p.x <= a.x1;
    const out = route[0]!;
    const back = route[route.length - 1]!;
    const rise = a.y0 - Math.min(...route.map((p) => p.y));
    if (!onTop(out) || !onTop(back) || !accept(out, fromScale, sign(out.x - from.x)) || !accept(back, toScale, sign(back.x - out.x))) throw new MotionPlanError('trace: a loop must leave and rejoin the top of its node at supported footholds');
    const leap: Leg = { kind: 'LEAP', from: out, to: back, fromScale, toScale, depthPx: arcDepth(out.y, back.y, Math.max(0, rise)), trail: [0, 1] };
    legs = [...skips(from, out, fromScale, 0), leap, ...skips(back, to, toScale, 1)];
  } else {
    legs = crossBetween(args, a, b, route, solids, accept, config, skips);
  }
  if (legs.length === 0) throw new MotionPlanError('trace: nothing to perform');
  return timeLegs(legs, args, config);
}

/** From one node to another: the best exit foothold, the leap, the best entry foothold (fails closed). */
function crossBetween(
  args: FootholdTraceArgs,
  a: TerrainSurface,
  b: TerrainSurface,
  route: readonly Point[],
  solids: readonly Rect[],
  accept: (at: Point, scale: number, facing: 1 | -1) => boolean,
  config: MotionConfig,
  skips: (p: Point, q: Point, scale: number, trail: number) => Leg[],
): Leg[] {
  const { from, to, fromScale, toScale, terrain } = args;
  const toward = sign((b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2 || to.x - from.x);
  const grid = (top: TerrainSurface, scale: number, keep: Point, near: number, facing: (x: number) => 1 | -1): Point[] => {
    const step = GRID_BH * bodyHeight(scale);
    const xs = [keep.x];
    for (let x = top.x0; x <= top.x1; x += step) xs.push(x);
    xs.push(Math.max(top.x0, Math.min(top.x1, near)));
    const pts = xs.filter((x, i) => xs.indexOf(x) === i).map((x) => ({ x, y: top.y0 })).filter((p) => accept(p, scale, facing(p.x)));
    return pts.sort((p, q) => Math.abs(p.x - near) - Math.abs(q.x - near) || p.x - q.x);
  };
  // Leave from as near the route's start as the node allows, arrive as near its end.
  const exits = grid(a, fromScale, from, route[0]!.x, () => toward);
  const entries = grid(b, toScale, to, route[route.length - 1]!.x, () => toward);
  const scale = (fromScale + toScale) / 2;
  const bh = bodyHeight(scale);
  const { hop } = config;
  // The footholds nearest the route win; text only chooses among the arcs that clear every block from them.
  for (const exit of exits) {
    for (const entry of entries) {
      const natural = Math.min(hop.peakMax * bh, Math.max(hop.peakMin * bh, hop.peakBase * bh + hop.peakPerPx * Math.abs(entry.x - exit.x)));
      let best: { leg: Leg; crossings: number } | null = null;
      for (const f of LEAP_ARCS) {
        const leg: Leg = { kind: 'LEAP', from: exit, to: entry, fromScale, toScale, depthPx: arcDepth(exit.y, entry.y, Math.min(hop.peakMax * bh, natural * f)), trail: [0, 1] };
        // Under natural gravity a flatter arc is a faster one: it must stay inside the speed limit.
        const flightS = Math.sqrt((2 * leg.depthPx) / (config.gravityBodyHeightsPerS2 * bh));
        if (Math.abs(entry.x - exit.x) / flightS > config.limits.maxSpeedBodyHeightsPerS * bh) continue;
        if (passesThroughSolid(leg, solids, config)) continue;
        const crossings = textCrossings(leg, terrain.protectedText);
        if (!best || crossings < best.crossings) best = { leg, crossings };
        if (crossings === 0) break;
      }
      if (best) return [...skips(from, exit, fromScale, 0), best.leg, ...skips(best.leg.to, to, toScale, 1)];
    }
  }
  throw new MotionPlanError(`trace: no foothold on ${a.element} reaches ${b.element} without passing through a block`);
}

/** Solid test resolution along a leap: fine enough that a foot cannot slip past a corner between samples. */
const SOLID_SAMPLES = 96;

/**
 * Any part of the feet (heel to toes, at the scale of the moment) enters a solid block anywhere strictly
 * between takeoff and contact: a leap may pass a block's corner, never clip it.
 */
function passesThroughSolid(leg: Leg, solids: readonly Rect[], config: MotionConfig): boolean {
  const { tolerancePx: tol, footprintBackBodyHeights: back, footprintFrontBodyHeights: front } = config.support;
  const facing = sign(leg.to.x - leg.from.x);
  for (let k = 1; k < SOLID_SAMPLES; k++) {
    const s = k / SOLID_SAMPLES;
    const p = feetAt(leg, s);
    const bh = bodyHeight(lerp(leg.fromScale, leg.toScale, s));
    for (const x of [p.x - facing * back * bh, p.x, p.x + facing * front * bh]) {
      for (const r of solids) if (x > r.x + tol && x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol) return true;
    }
  }
  return false;
}

/** Interior flight samples whose figure box overlaps protected text. */
function textCrossings(leg: Leg, text: readonly Rect[]): number {
  let n = 0;
  for (let k = 1; k < LEAP_SAMPLES; k++) {
    const s = k / LEAP_SAMPLES;
    const box = wallabyBounds(feetAt(leg, s), lerp(leg.fromScale, leg.toScale, s));
    if (text.some((r) => intersects(box, r))) n++;
  }
  return n;
}

/** Smallest gap (px) between the standing figure's box and any protected text above it, along a level stretch. */
function clearanceAbove(p: Point, q: Point, scale: number, text: readonly Rect[]): number {
  let gap = Infinity;
  for (let k = 0; k <= 8; k++) {
    const box = wallabyBounds({ x: lerp(p.x, q.x, k / 8), y: p.y }, scale);
    for (const r of text) {
      if (r.x >= box.x + box.w || box.x >= r.x + r.w || r.y + r.h > box.y + box.h) continue;
      gap = Math.min(gap, box.y - (r.y + r.h));
    }
  }
  return gap;
}

/**
 * Lay the legs out in the clip's window: a load, then each leg's flight under gravity (raised within its
 * bound only if the window demands), a ground contact between legs, and any spare time shared between
 * the load, the contacts, and the settle on the anchor. Fails closed when the legs cannot fit.
 */
function timeLegs(legs: readonly Leg[], args: FootholdTraceArgs, config: MotionConfig): TraceBound[] {
  const dur = args.endMs - args.startMs;
  const window = dur - Math.min(40, dur * 0.05);
  const g0 = legs.map((l) => config.gravityBodyHeightsPerS2 * bodyHeight((l.fromScale + l.toScale) / 2));
  // A leap flies as long as gravity takes over its arc; a skip takes a stride's flight, however low the text lets it lift.
  const skipMs = config.trace.skipStepMs * (1 - config.trace.contactFrac);
  const flight0 = legs.map((l, i) => (l.kind === 'LEAP' ? Math.sqrt((2 * l.depthPx) / g0[i]!) * 1000 : skipMs));
  const fixed = LOAD_MS + (legs.length - 1) * CONTACT_MS;
  const sum = flight0.reduce((x, y) => x + y, 0);
  let k = 1;
  if (fixed + sum > window) {
    const room = window - fixed;
    if (!(room > 0)) throw new MotionPlanError(`trace: a ${Math.round(dur)} ms window leaves no time to move`);
    k = room / sum;
    // Every flight shortens by k: a leap's arc is unchanged, so its gravity rises by 1/k², within its bound.
    if (1 / (k * k) > config.maxGravityBoost) throw new MotionPlanError(`trace: ${legs.length} bounds cannot fit ${Math.round(dur)} ms under the gravity limit`);
  }
  const flight = flight0.map((t) => t * k);
  const spare = Math.max(0, window - fixed - flight.reduce((x, y) => x + y, 0));
  const load = LOAD_MS + Math.min(150, spare * 0.3);
  const contact = CONTACT_MS + (legs.length > 1 ? Math.min(90, (spare * 0.5) / (legs.length - 1)) : 0);
  let t = args.startMs + load;
  return legs.map((l, i) => {
    const bh = bodyHeight((l.fromScale + l.toScale) / 2);
    const flightS = flight[i]! / 1000;
    const takeoffMs = t;
    const contactMs = t + flight[i]!;
    if (Math.abs(l.to.x - l.from.x) / flightS > config.limits.maxSpeedBodyHeightsPerS * bh) throw new MotionPlanError('trace: a bound would exceed the speed limit');
    t = contactMs + contact;
    // The gravity that times this flight over its arc (a level skip with no lift has no fall to time: natural gravity).
    const gravityPx = l.depthPx > 0 ? (2 * l.depthPx) / (flightS * flightS) : g0[i]!;
    return { kind: l.kind, from: l.from, to: l.to, fromScale: l.fromScale, toScale: l.toScale, takeoffMs, contactMs, depthPx: l.depthPx, gravityPx, trail: l.trail };
  });
}

export type TraceMoment = { phase: 'LOAD'; bound: 0 } | { phase: 'FLIGHT'; bound: number; s: number } | { phase: 'CONTACT'; bound: number } | { phase: 'DONE'; bound: number };

/** Where a foothold trace is at `ms`: loading before its first bound, in a bound's flight, standing between bounds, or done. */
export function traceMoment(bounds: readonly TraceBound[], ms: number): TraceMoment {
  if (ms < bounds[0]!.takeoffMs) return { phase: 'LOAD', bound: 0 };
  for (let k = 0; k < bounds.length; k++) {
    const b = bounds[k]!;
    if (ms < b.contactMs) return { phase: 'FLIGHT', bound: k, s: (ms - b.takeoffMs) / (b.contactMs - b.takeoffMs) };
    const next = bounds[k + 1];
    if (next && ms < next.takeoffMs) return { phase: 'CONTACT', bound: k };
  }
  return { phase: 'DONE', bound: bounds.length - 1 };
}

/** Feet on a bound's arc at s ∈ [0, 1]. */
export const boundFeet = (b: TraceBound, s: number): Point => feetAt(b, s);

/** The trail fraction at `ms`: it draws during the leap and holds between bounds. */
export function trailAt(bounds: readonly TraceBound[], ms: number): number {
  const m = traceMoment(bounds, ms);
  const b = bounds[m.bound]!;
  if (m.phase === 'LOAD') return b.trail[0];
  if (m.phase === 'FLIGHT') return lerp(b.trail[0], b.trail[1], m.s);
  return b.trail[1];
}
