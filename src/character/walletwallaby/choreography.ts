// WalletWallaby choreography: semantic beats -> clips that fix WHERE and WHEN.
//
// The planner picks MEANING (INSPECT this, TRACE that route). This module turns
// it into an ordered list of clips whose endpoints are anchors resolved from the
// VideoSpec: if WalletWallaby is not standing where an action needs it, it moves
// there first; traces follow the drawn route; exit actions are scheduled to
// finish exactly as their segment ends so they drive the transition. HOW each
// clip is performed (anticipation, ballistic flight, contact, settle) is
// ./motion.ts's job, and nothing there can change a clip's endpoints or order.
// No pathfinding, no simulation. Isomorphic.

import { GROUND_Y, type Point } from '../../layout/geometry.ts';
import { layoutScene, type SceneLayout } from '../../layout/scene-layout.ts';
import type { WallabyAction, WallabyExpression, WallabyPose } from '../../spec/vocabulary.ts';
import type { TimedSegment, Timeline } from '../../timeline/timeline.ts';
import type { Viseme } from './rig.ts';

export type ClipKind = 'HIDDEN' | 'HOLD' | 'TRAVEL' | 'TRAVERSE' | 'EXIT_JUMP' | 'PUSH' | 'DROP_IN';

export interface Clip {
  kind: ClipKind;
  segmentId: string;
  startMs: number;
  endMs: number;
  from: Point;
  to: Point;
  fromScale: number;
  toScale: number;
  arc: number;
  path: Point[];
  pose: WallabyPose;
  expression: WallabyExpression;
  lookAt: Point | null;
  /** COMPARE: gaze alternates between lookAt and lookAlt. */
  lookAlt: Point | null;
  /** The semantic action this clip performs, when it performs one. */
  action: WallabyAction | null;
  /** Anchor id the action targets (e.g. the traced route), when it has one. */
  target: string | null;
}

export const ACTION_MS = {
  PUSH_THROUGH: 1500,
  DIMENSION_JUMP: 820,
  TRACE: 1500,
  TRACE_LOOP: 1300,
  REVEAL_POINT: 1300,
  DROP_IN: 900,
} as const;

/** Resting pose and expression each action leaves WalletWallaby in. */
const ACTION_REST: Record<WallabyAction, { pose: WallabyPose; expression: WallabyExpression }> = {
  HOP: { pose: 'NEUTRAL', expression: 'CURIOUS' },
  LAND: { pose: 'TEACH', expression: 'NEUTRAL' },
  PERCH: { pose: 'PERCH', expression: 'NEUTRAL' },
  INSPECT: { pose: 'INSPECT', expression: 'FOCUSED' },
  TRACE: { pose: 'TEACH', expression: 'FOCUSED' },
  REVEAL: { pose: 'TEACH', expression: 'CURIOUS' },
  COMPARE: { pose: 'TEACH', expression: 'SKEPTICAL' },
  PUSH_THROUGH: { pose: 'PREPARE_JUMP', expression: 'FOCUSED' },
  DIMENSION_JUMP: { pose: 'PREPARE_JUMP', expression: 'CURIOUS' },
  RESOLVE: { pose: 'TAKEAWAY', expression: 'SATISFIED' },
};

const OFFSCREEN_RIGHT: Point = { x: 2100, y: GROUND_Y - 30 };
const VANISHING_POINT: Point = { x: 960, y: 520 };

/** Fixed brand choreography: WalletWallaby is a guide, not a mascot, so brand moments stay still. */
const BRAND_MARKS: Partial<Record<TimedSegment['role'], { at: Point; scale: number; pose: WallabyPose; expression: WallabyExpression; lookAt: Point | null }>> = {
  CTA: { at: { x: 1420, y: GROUND_Y }, scale: 1, pose: 'CTA', expression: 'SATISFIED', lookAt: null },
  DOCS_REFERENCE: { at: { x: 1560, y: GROUND_Y }, scale: 0.95, pose: 'POINT', expression: 'NEUTRAL', lookAt: { x: 760, y: 560 } },
  OUTRO: { at: { x: 1380, y: GROUND_Y }, scale: 0.95, pose: 'PERCH', expression: 'SATISFIED', lookAt: { x: 900, y: 520 } },
  END_SCREEN: { at: { x: 1700, y: 1010 }, scale: 0.5, pose: 'PERCH', expression: 'NEUTRAL', lookAt: { x: 1300, y: 600 } },
};

export function layoutsFor(timeline: Timeline, eyebrowFor: (sectionId: string) => string): Map<string, SceneLayout> {
  const out = new Map<string, SceneLayout>();
  for (const seg of timeline.segments) if (seg.scene) out.set(seg.id, layoutScene(seg.scene, eyebrowFor(seg.scene.eyebrowSectionId)));
  return out;
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Points along a cubic Bezier given as [start, control1, control2, end]. */
function sampleCubic(pts: Point[], steps = 12): Point[] {
  const [p0, p1, p2, p3] = pts as [Point, Point, Point, Point];
  if (!p3) return pts;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  });
}

export function choreograph(timeline: Timeline, layouts: Map<string, SceneLayout>): Clip[] {
  const clips: Clip[] = [];
  let pos: Point | null = null;
  let scale = 1;
  let cursor = 0;
  let rest: { pose: WallabyPose; expression: WallabyExpression; lookAt: Point | null; lookAlt: Point | null } = {
    pose: 'NEUTRAL',
    expression: 'NEUTRAL',
    lookAt: null,
    lookAlt: null,
  };

  const base = (segmentId: string, kind: ClipKind, startMs: number, endMs: number): Clip => ({
    kind,
    segmentId,
    startMs,
    endMs,
    from: pos ?? OFFSCREEN_RIGHT,
    to: pos ?? OFFSCREEN_RIGHT,
    fromScale: scale,
    toScale: scale,
    arc: 0,
    path: [],
    pose: rest.pose,
    expression: rest.expression,
    lookAt: rest.lookAt,
    lookAlt: rest.lookAlt,
    action: null,
    target: null,
  });
  const push = (clip: Clip): void => {
    if (clip.endMs <= clip.startMs) return;
    clips.push(clip);
    cursor = clip.endMs;
  };
  const holdUntil = (segmentId: string, until: number): void => {
    if (until <= cursor) return;
    push(pos ? base(segmentId, 'HOLD', cursor, until) : base(segmentId, 'HIDDEN', cursor, until));
  };
  const travel = (segmentId: string, to: Point, toScale: number, startMs: number, action: WallabyAction | null, minMs = 0): void => {
    holdUntil(segmentId, startMs);
    const from = pos ?? OFFSCREEN_RIGHT;
    const d = dist(from, to);
    const dur = Math.max(minMs, Math.min(950, Math.max(560, 520 + d * 0.28)));
    push({ ...base(segmentId, 'TRAVEL', startMs, startMs + dur), from, to, fromScale: pos ? scale : toScale, toScale, arc: Math.min(240, 60 + d * 0.18), action });
    pos = to;
    scale = toScale;
  };
  const ensureAt = (segmentId: string, to: Point, toScale: number, startMs: number, action: WallabyAction | null): void => {
    holdUntil(segmentId, startMs);
    if (!pos || dist(pos, to) > 24 || Math.abs(scale - toScale) > 0.01) travel(segmentId, to, toScale, Math.max(startMs, cursor), action);
  };

  for (const seg of timeline.segments) {
    holdUntil(seg.id, seg.startMs);
    if (seg.role === 'IDENT') {
      push(base(seg.id, 'HIDDEN', seg.startMs, seg.endMs));
      pos = null;
      continue;
    }

    const brand = BRAND_MARKS[seg.role];
    if (brand) {
      ensureAt(seg.id, brand.at, brand.scale, seg.startMs, null);
      rest = { pose: brand.pose, expression: brand.expression, lookAt: brand.lookAt, lookAlt: null };
      holdUntil(seg.id, seg.endMs);
      continue;
    }

    const layout = layouts.get(seg.id);
    if (!layout) continue;
    const anchor = (id: string | undefined) => (id ? layout.anchors[id] : undefined) ?? layout.anchors['scene:entry']!;

    // Arrival: the first LAND/HOP beat is where the guide arrives; otherwise the scene entry.
    const first = seg.beats[0];
    const arrivalBeat = first && (first.beat.action === 'LAND' || first.beat.action === 'HOP') ? first : undefined;
    const arrival = anchor(arrivalBeat?.beat.target);
    if (seg.transitionIn.type === 'DEPTH_ENTER') {
      const start = Math.max(cursor, seg.contentStartMs - 300);
      holdUntil(seg.id, start);
      pos = { x: arrival.stand.x, y: arrival.stand.y - 420 };
      scale = arrival.scale;
      push({ ...base(seg.id, 'DROP_IN', start, start + ACTION_MS.DROP_IN), to: arrival.stand, action: arrivalBeat ? arrivalBeat.beat.action : null });
      pos = arrival.stand;
    } else {
      travel(seg.id, arrival.stand, arrival.scale, Math.max(cursor, seg.transitionIn.type === 'CUT' && seg.startMs === 0 ? 200 : seg.startMs), arrivalBeat?.beat.action ?? null, seg.contentStartMs - seg.startMs);
    }
    rest = { pose: 'LAND', expression: arrivalBeat?.beat.expression ?? 'NEUTRAL', lookAt: arrival.focus, lookAlt: null };
    if (arrivalBeat) rest = { ...ACTION_REST[arrivalBeat.beat.action], lookAt: arrival.focus, lookAlt: null, ...(arrivalBeat.beat.expression ? { expression: arrivalBeat.beat.expression } : {}) };

    for (const tb of seg.beats) {
      if (tb === arrivalBeat) continue;
      const { beat } = tb;
      const t = Math.max(tb.startMs, cursor);
      const restFor = (lookAt: Point | null, lookAlt: Point | null = null) => {
        const r = ACTION_REST[beat.action];
        rest = { pose: r.pose, expression: beat.expression ?? r.expression, lookAt, lookAlt };
      };
      switch (beat.action) {
        case 'HOP':
        case 'LAND':
        case 'PERCH':
        case 'INSPECT':
        case 'RESOLVE': {
          const a = anchor(beat.target);
          ensureAt(seg.id, a.stand, a.scale, t, beat.action);
          restFor(a.focus);
          break;
        }
        case 'REVEAL': {
          const a = anchor(beat.target);
          // Reveals point from where the guide stands unless the target is out of reach.
          if (!pos || Math.abs(pos.x - a.stand.x) > 260) ensureAt(seg.id, a.stand, a.scale, t, beat.action);
          else holdUntil(seg.id, t);
          rest = { pose: 'POINT', expression: beat.expression ?? 'CURIOUS', lookAt: a.focus, lookAlt: null };
          push({ ...base(seg.id, 'HOLD', cursor, cursor + ACTION_MS.REVEAL_POINT), action: 'REVEAL' });
          restFor(a.focus);
          break;
        }
        case 'COMPARE': {
          const a = anchor(beat.target);
          const b = anchor(beat.secondaryTarget);
          ensureAt(seg.id, { x: (a.stand.x + b.stand.x) / 2, y: Math.min(a.stand.y, b.stand.y) }, a.scale, t, 'COMPARE');
          restFor(a.focus, b.focus);
          break;
        }
        case 'TRACE': {
          const route = layout.routes.find((r) => r.id === beat.target);
          if (!route) break;
          const fromA = anchor(`node:${route.from}`);
          const toA = anchor(`node:${route.to}`);
          ensureAt(seg.id, fromA.stand, fromA.scale, t, null);
          const dur = route.selfLoop ? ACTION_MS.TRACE_LOOP : ACTION_MS.TRACE;
          const path = route.selfLoop ? [fromA.stand, ...sampleCubic(route.points), toA.stand] : [fromA.stand, ...route.points, toA.stand];
          rest = { pose: 'TEACH', expression: beat.expression ?? 'FOCUSED', lookAt: toA.focus, lookAlt: null };
          push({ ...base(seg.id, 'TRAVERSE', cursor, cursor + dur), from: fromA.stand, to: toA.stand, fromScale: fromA.scale, toScale: toA.scale, path, action: 'TRACE', target: route.id });
          pos = toA.stand;
          scale = toA.scale;
          restFor(toA.focus);
          break;
        }
        case 'PUSH_THROUGH': {
          const start = Math.max(t, seg.endMs - ACTION_MS.PUSH_THROUGH);
          holdUntil(seg.id, start);
          rest = { ...rest, expression: beat.expression ?? 'FOCUSED' };
          push({ ...base(seg.id, 'PUSH', start, seg.endMs), to: VANISHING_POINT, toScale: scale * 0.3, action: 'PUSH_THROUGH' });
          pos = null;
          break;
        }
        case 'DIMENSION_JUMP': {
          const start = Math.max(t, seg.endMs - ACTION_MS.DIMENSION_JUMP);
          holdUntil(seg.id, start);
          const from = pos ?? OFFSCREEN_RIGHT;
          const apex = { x: Math.min(from.x + 300, 1820), y: from.y - 300 };
          push({ ...base(seg.id, 'EXIT_JUMP', start, seg.endMs), from, to: apex, arc: 120, action: 'DIMENSION_JUMP' });
          pos = apex;
          break;
        }
      }
    }
    holdUntil(seg.id, seg.endMs);
  }
  holdUntil('end', timeline.totalMs);
  return clips;
}

// ── Lookup ──────────────────────────────────────────────────────────────────

export function clipAt(clips: Clip[], ms: number): Clip | undefined {
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = clips[mid]!;
    if (ms < c.startMs) hi = mid - 1;
    else if (ms >= c.endMs) lo = mid + 1;
    else return c;
  }
  return undefined;
}

/**
 * Restrained mouth: four states derived from the narration text at the current
 * time. Deliberately not lip sync; just enough to read as speech.
 */
export function mouthAt(timeline: Timeline, ms: number): Viseme {
  for (const seg of timeline.segments) {
    if (ms < seg.startMs || ms >= seg.endMs) continue;
    for (const line of seg.lines) {
      if (ms < line.startMs || ms >= line.endMs) continue;
      const idx = Math.floor(((ms - line.startMs) / (line.endMs - line.startMs)) * line.text.length);
      const ch = (line.text[idx] ?? ' ').toLowerCase();
      const step = Math.floor((ms - line.startMs) / 110) % 2;
      if ('aeiou'.includes(ch)) return step === 0 ? 'OPEN' : 'SMALL';
      if ('mbp .,:;?!'.includes(ch)) return 'CLOSED';
      return 'SMALL';
    }
    return 'REST';
  }
  return 'REST';
}
