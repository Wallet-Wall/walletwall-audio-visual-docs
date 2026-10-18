// WalletWallaby choreography: semantic beats -> deterministic motion clips.
//
// The planner picks MEANING (INSPECT this, TRACE that route). This module owns
// locomotion: if WalletWallaby is not standing where an action needs it, it
// hops there first; traces follow the drawn route; exit actions are scheduled
// to finish exactly as their segment ends so they drive the transition. There
// is no physics and no pathfinding: every clip is a closed-form function of
// time, so any frame can be rendered independently. Isomorphic.

import { easeInOut, easeOut, GROUND_Y, lerp, type Point } from '../../layout/geometry.ts';
import { layoutScene, type SceneLayout } from '../../layout/scene-layout.ts';
import type { WallabyAction, WallabyExpression, WallabyPose } from '../../spec/vocabulary.ts';
import type { TimedSegment, Timeline } from '../../timeline/timeline.ts';
import { AIRBORNE, blendExpression, blendPose, EXPRESSIONS, POSES, WALLABY_HEIGHT, type ExpressionParams, type PoseParams, type Viseme } from './rig.ts';

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

// ── Sampling ────────────────────────────────────────────────────────────────

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
}

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
};

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

function pointAlong(path: Point[], f: number): Point {
  const segs = path.slice(1).map((p, i) => dist(path[i]!, p));
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let target = f * total;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i]!;
    if (target <= len) {
      const t = len === 0 ? 0 : target / len;
      return { x: lerp(path[i]!.x, path[i + 1]!.x, t), y: lerp(path[i]!.y, path[i + 1]!.y, t) };
    }
    target -= len;
  }
  return path[path.length - 1]!;
}

function gazeToward(x: number, y: number, scale: number, look: Point | null): Point {
  if (!look) return { x: 0, y: 0 };
  const eyeY = y - WALLABY_HEIGHT * scale * 0.82;
  return { x: Math.max(-1, Math.min(1, (look.x - x) / 520)), y: Math.max(-1, Math.min(1, (look.y - eyeY) / 380)) };
}

export function wallabyStateAt(clips: Clip[], ms: number, mouth: Viseme = 'REST'): WallabyState {
  const clip = clipAt(clips, ms);
  if (!clip || clip.kind === 'HIDDEN') return HIDDEN_STATE;
  const p = (ms - clip.startMs) / (clip.endMs - clip.startMs);
  const expr = EXPRESSIONS[clip.expression];
  const state = (x: number, y: number, scale: number, pose: PoseParams, opacity: number, look: Point | null, facing?: 1 | -1): WallabyState => {
    const gaze = gazeToward(x, y, scale, look);
    return {
      visible: opacity > 0.001,
      x,
      y,
      scale,
      opacity,
      facing: facing ?? (look && look.x < x - 12 ? -1 : 1),
      pose,
      expression: clip.expression,
      expr,
      gaze: facing !== undefined ? { x: Math.abs(gaze.x) * 0.5, y: gaze.y } : gaze,
      mouth,
    };
  };
  const travelFacing = (): 1 | -1 => (clip.to.x < clip.from.x - 4 ? -1 : 1);

  switch (clip.kind) {
    case 'HOLD': {
      // Settle out of a landing, then breathe (a slow, small crouch cycle).
      const settle = easeOut((ms - clip.startMs) / 280);
      const target = POSES[clip.pose];
      const posed = blendPose(POSES.LAND, target, settle);
      const breathe = Math.sin((ms / 2600) * Math.PI * 2) * 0.025;
      let look = clip.lookAt;
      if (clip.lookAlt) look = Math.floor((ms - clip.startMs) / 1100) % 2 === 0 ? clip.lookAt : clip.lookAlt;
      return state(clip.from.x, clip.from.y, clip.fromScale, { ...posed, crouch: posed.crouch + breathe }, 1, look);
    }
    case 'TRAVEL':
    case 'EXIT_JUMP': {
      const prep = clip.kind === 'EXIT_JUMP' ? 0.3 : 0.18;
      const land = clip.kind === 'EXIT_JUMP' ? 1.01 : 0.84;
      const scale = lerp(clip.fromScale, clip.toScale, easeInOut(p));
      if (p < prep) return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(POSES[clip.pose], POSES.PREPARE_JUMP, easeOut(p / prep)), 1, clip.to, travelFacing());
      if (p < land) {
        const f = easeInOut((p - prep) / (land - prep));
        const x = lerp(clip.from.x, clip.to.x, f);
        const y = lerp(clip.from.y, clip.to.y, f) - clip.arc * 4 * f * (1 - f);
        return state(x, y, scale, AIRBORNE, 1, clip.to, travelFacing());
      }
      return state(clip.to.x, clip.to.y, clip.toScale, blendPose(AIRBORNE, POSES.LAND, easeOut((p - land) / (1 - land))), 1, clip.lookAt, travelFacing());
    }
    case 'TRAVERSE': {
      const f = easeInOut(p);
      const at = pointAlong(clip.path, f);
      const travelled = f * clip.path.slice(1).reduce((n, q, i) => n + dist(clip.path[i]!, q), 0);
      const step = Math.abs(Math.sin((travelled / 120) * Math.PI));
      const pose = blendPose(POSES.LAND, AIRBORNE, step * 0.6);
      return state(at.x, at.y - step * 14, lerp(clip.fromScale, clip.toScale, f), pose, 1, clip.lookAt, travelFacing());
    }
    case 'PUSH': {
      if (p < 0.35) return state(clip.from.x, clip.from.y, clip.fromScale, blendPose(POSES[clip.pose], POSES.PREPARE_JUMP, easeOut(p / 0.35)), 1, clip.to);
      const f = easeInOut((p - 0.35) / 0.65);
      const x = lerp(clip.from.x, clip.to.x, f);
      const y = lerp(clip.from.y, clip.to.y, f) - 90 * Math.sin(f * Math.PI);
      return state(x, y, lerp(clip.fromScale, clip.toScale, f), AIRBORNE, 1 - f, clip.to);
    }
    case 'DROP_IN': {
      const f = easeInOut(Math.min(1, p / 0.8));
      const y = lerp(clip.from.y, clip.to.y, f);
      const pose = p < 0.8 ? AIRBORNE : blendPose(AIRBORNE, POSES.LAND, easeOut((p - 0.8) / 0.2));
      return state(clip.to.x, y, clip.fromScale, pose, Math.min(1, p / 0.4), clip.lookAt);
    }
  }
  return HIDDEN_STATE;
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
