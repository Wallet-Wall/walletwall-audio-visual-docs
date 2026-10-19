// Attention direction: how the viewer's eye is guided, over time, to the meaning the lesson already authored.
//
//   THE LESSON DECIDES WHAT MATTERS.
//   MOTION INTELLIGENCE DECIDES HOW WALLETWALLABY MOVES.
//   ATTENTION DIRECTION DECIDES HOW THE VIEWER IS GUIDED TO THE ALREADY-AUTHORED MEANING.
//   IT NEVER CHANGES A SEMANTIC DESTINATION OR SUPPORT GEOMETRY.
//
// From the timeline's beats (meaning the planner selected), the scene layout (geometry the grammar fixed), and the
// choreography's clips (when an exit move begins), this module derives, per segment, a schedule of keys. Each key
// names a MODE, the SUBJECT(S), a visual HIERARCHY (per drawn element, an opacity and a wash / rule strength), and a
// bounded FRAMING of the whole content world: one affine transform about the frame centre that the composition
// applies to the scene and the character as a single unit, so nothing on screen moves relative to anything else.
//
// The grammar (docs/ATTENTION.md):
//   ESTABLISH   no single subject: the scene opens, or a beat rests on a whole surface. Everything even, no framing.
//   GUIDE       HOP / LAND / PERCH / REVEAL / TRACE: the destination gains clear but quiet priority.
//   INSPECT     INSPECT: one subject is primary; what is unrelated recedes a little; context stays readable.
//   COMPARE     COMPARE: two subjects share the primary hierarchy. Never alternating.
//   RESOLVE     RESOLVE: the emphasis settles into the resolved rule; nothing moves afterwards.
//   TRANSITION  an exit move (PUSH_THROUGH, DIMENSION_JUMP) or a non-cut transition owns the frame: neutral, identity.
//
// Everything here is a pure function of (timeline, layouts, clips, config, ms): no clock, no randomness, no
// environment, no DOM. Isomorphic: the Remotion bundle, the tests, and the review scripts share it.

import type { Clip } from '../character/walletwallaby/choreography.ts';
import { CONTENT_BOTTOM, easeInOut, easeOut, FRAME, lerp, TITLE_SAFE, type Point, type Rect } from '../layout/geometry.ts';
import { PROVENANCE_CHIP } from '../layout/brand-layout.ts';
import type { SceneLayout } from '../layout/scene-layout.ts';
import type { SceneSpec } from '../spec/types.ts';
import type { WallabyAction } from '../spec/vocabulary.ts';
import { EXIT_ACTIONS, visualElements, type TimedBeat, type TimedSegment, type Timeline } from '../timeline/timeline.ts';

// ── Configuration (config/attention.json) ───────────────────────────────────

export const ATTENTION_CONFIG_REL = 'config/attention.json';
export const ATTENTION_SCHEMA = 'walletwall.attention-direction/v1';

export class AttentionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttentionConfigError';
  }
}

/** What a mode does to the frame: a framing (scale about the centre, a lean toward the subject) and a hierarchy (opacities). */
export interface Treatment {
  /** Scale of the content world about the frame centre; 1 = no framing at all (a lean needs scale, see coverage). */
  scale: number;
  /** How far the world leans toward the subject: 0 = none, 1 = the subject would sit at the centre (before clamping). */
  lean: number;
  /** Opacity of subjects that are not the primary ones. */
  others: number;
  /** Opacity of structural context (a card's heading, a graph's caption, the upper plane). */
  context: number;
  /** Opacity of routes not attached to a primary subject. */
  routes: number;
}

export type TreatedMode = 'GUIDE' | 'INSPECT' | 'COMPARE' | 'RESOLVE';
export type AttentionMode = 'ESTABLISH' | TreatedMode | 'TRANSITION';
export const ATTENTION_MODES: readonly AttentionMode[] = ['ESTABLISH', 'GUIDE', 'INSPECT', 'COMPARE', 'RESOLVE', 'TRANSITION'];
const TREATED_MODES: readonly TreatedMode[] = ['GUIDE', 'INSPECT', 'COMPARE', 'RESOLVE'];

export interface AttentionConfig {
  schema: typeof ATTENTION_SCHEMA;
  /** One settle for everything: a framing move, and the easing of every hierarchy change. */
  settleMs: number;
  /** A framing move is taken only if the camera can then stay still at least this long; otherwise it is not taken. */
  minHoldMs: number;
  modes: Record<TreatedMode, Treatment>;
  framing: { maxScale: number; maxTranslateX: number; maxTranslateY: number };
  entrance: { routeDrawMs: number };
}

/** ESTABLISH and TRANSITION: nothing is emphasised, nothing is framed. Not configurable. */
export const NEUTRAL: Treatment = Object.freeze({ scale: 1, lean: 0, others: 1, context: 1, routes: 1 });

/** Inclusive bounds. The floors on opacity are the promise that context never becomes unreadable. */
const BOUNDS = {
  settleMs: [200, 1500],
  minHoldMs: [0, 5000],
  scale: [1, 1.05],
  lean: [0, 1],
  others: [0.5, 1],
  context: [0.7, 1],
  routes: [0.5, 1],
  maxScale: [1, 1.05],
  maxTranslateX: [0, 70],
  maxTranslateY: [0, 35],
  routeDrawMs: [0, 1500],
} as const;

const num = (v: unknown, what: string, [lo, hi]: readonly [number, number]): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new AttentionConfigError(`${what} must be a number within ${lo}..${hi}`);
  return v;
};

/** Resolve and validate a parsed config. Pure; the Node loader (./config.ts) only adds the file read. */
export function resolveAttentionConfig(raw: unknown): AttentionConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.schema !== ATTENTION_SCHEMA) throw new AttentionConfigError(`${ATTENTION_CONFIG_REL} is not ${ATTENTION_SCHEMA}`);
  const modesRaw = (r.modes ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const k of Object.keys(modesRaw)) if (!(TREATED_MODES as readonly string[]).includes(k)) throw new AttentionConfigError(`modes.${k} is not a treated mode (ESTABLISH and TRANSITION are always neutral)`);
  const framingRaw = (r.framing ?? {}) as Record<string, unknown>;
  const framing = {
    maxScale: num(framingRaw.maxScale, 'framing.maxScale', BOUNDS.maxScale),
    maxTranslateX: num(framingRaw.maxTranslateX, 'framing.maxTranslateX', BOUNDS.maxTranslateX),
    maxTranslateY: num(framingRaw.maxTranslateY, 'framing.maxTranslateY', BOUNDS.maxTranslateY),
  };
  const modes = {} as Record<TreatedMode, Treatment>;
  for (const mode of TREATED_MODES) {
    const t = modesRaw[mode];
    if (!t) throw new AttentionConfigError(`modes.${mode} is missing`);
    modes[mode] = {
      scale: num(t.scale, `modes.${mode}.scale`, [1, framing.maxScale]),
      lean: num(t.lean, `modes.${mode}.lean`, BOUNDS.lean),
      others: num(t.others, `modes.${mode}.others`, BOUNDS.others),
      context: num(t.context, `modes.${mode}.context`, BOUNDS.context),
      routes: num(t.routes, `modes.${mode}.routes`, BOUNDS.routes),
    };
  }
  const entranceRaw = (r.entrance ?? {}) as Record<string, unknown>;
  return {
    schema: ATTENTION_SCHEMA,
    settleMs: num(r.settleMs, 'settleMs', BOUNDS.settleMs),
    minHoldMs: num(r.minHoldMs, 'minHoldMs', BOUNDS.minHoldMs),
    modes,
    framing,
    entrance: { routeDrawMs: num(entranceRaw.routeDrawMs, 'entrance.routeDrawMs', BOUNDS.routeDrawMs) },
  };
}

// ── Framing: one affine transform of the whole content world ────────────────

export interface Framing {
  scale: number;
  tx: number;
  ty: number;
}

export const IDENTITY_FRAMING: Framing = Object.freeze({ scale: 1, tx: 0, ty: 0 });
export const FRAME_CENTRE: Point = Object.freeze({ x: FRAME.width / 2, y: FRAME.height / 2 });

export const isIdentity = (f: Framing): boolean => f.scale === 1 && f.tx === 0 && f.ty === 0;
export const framingEquals = (a: Framing, b: Framing): boolean => a.scale === b.scale && a.tx === b.tx && a.ty === b.ty;

/** Where a content-world point lands on the frame under a framing. */
export function applyFraming(f: Framing, p: Point): Point {
  return { x: FRAME_CENTRE.x + (p.x - FRAME_CENTRE.x) * f.scale + f.tx, y: FRAME_CENTRE.y + (p.y - FRAME_CENTRE.y) * f.scale + f.ty };
}

export function framedRect(f: Framing, r: Rect): Rect {
  const a = applyFraming(f, { x: r.x, y: r.y });
  return { x: a.x, y: a.y, w: r.w * f.scale, h: r.h * f.scale };
}

/** The CSS transform of the content world (its transform origin is the frame centre). `none` at identity, so an unframed frame is untouched. */
export function framingCss(f: Framing): string {
  if (isIdentity(f)) return 'none';
  return `translate(${f.tx.toFixed(3)}px, ${f.ty.toFixed(3)}px) scale(${f.scale.toFixed(5)})`;
}

/** Quantise a framing so that equal poses compare equal and CSS strings are stable. */
const quantise = (f: Framing): Framing => ({ scale: Math.round(f.scale * 1e5) / 1e5, tx: Math.round(f.tx * 1e3) / 1e3, ty: Math.round(f.ty * 1e3) / 1e3 });

// ── The cast of a scene: subjects, context, routes ──────────────────────────

export interface Cast {
  /** Elements a beat can make primary: card items, graph nodes (the lower plane in a layered scene), the UI capture, the takeaway lines. */
  subjects: string[];
  /** Structural context: the card heading, the graph caption, the upper plane of a layered scene. */
  context: string[];
  /** Route ids (`edge:a->b`). */
  routes: string[];
  /** A node's detail line follows its node. */
  detailOf: Record<string, string>;
  /** Route id -> the two node ids it joins. */
  routeEnds: Record<string, [string, string]>;
  /** Every element the hierarchy addresses, in draw order. */
  all: string[];
}

export function castOf(scene: SceneSpec): Cast {
  const subjects: string[] = [];
  const context: string[] = [];
  const routes: string[] = [];
  const detailOf: Record<string, string> = {};
  const routeEnds: Record<string, [string, string]> = {};
  switch (scene.type) {
    case 'CARD':
      context.push(scene.heading.id);
      subjects.push(...scene.body.map((b) => b.id));
      break;
    case 'GRAPH':
      if (scene.caption) context.push(scene.caption.id);
      for (const n of scene.nodes) {
        (scene.layout === 'LAYERED' && n.layer === 'UPPER' ? context : subjects).push(n.id);
        if (n.detail) detailOf[n.detail.id] = n.id;
      }
      for (const e of scene.edges) {
        const id = `edge:${e.from}->${e.to}`;
        routes.push(id);
        routeEnds[id] = [e.from, e.to];
      }
      break;
    case 'UI':
      context.push(scene.caption.id);
      subjects.push('ui:capture');
      break;
    case 'TAKEAWAY':
      subjects.push(scene.statement.id, ...scene.support.map((s) => s.id));
      break;
  }
  return { subjects, context, routes, detailOf, routeEnds, all: visualElements(scene).map((e) => e.id) };
}

/** The scene elements a beat's anchor designates: the subject(s), what shares its relation, and the route it follows. */
export function subjectsOfAnchor(anchor: string | undefined, scene: SceneSpec): { primary: string[]; related: string[]; routes: string[] } {
  const none = { primary: [], related: [], routes: [] };
  if (!anchor) return none;
  if (anchor === 'card:heading' && scene.type === 'CARD') return { primary: [scene.heading.id], related: [], routes: [] };
  if (anchor === 'takeaway:statement' && scene.type === 'TAKEAWAY') return { primary: [scene.statement.id], related: [], routes: [] };
  if (anchor === 'ui:capture' && scene.type === 'UI') return { primary: ['ui:capture'], related: [], routes: [] };
  for (const prefix of ['card:body:', 'node:', 'takeaway:support:']) if (anchor.startsWith(prefix)) return { primary: [anchor.slice(prefix.length)], related: [], routes: [] };
  if (anchor.startsWith('edge:')) {
    const [from, to] = anchor.slice('edge:'.length).split('->');
    if (!from || !to) return none;
    // A traced route: its destination is the subject; its source shares the relation; the route itself is emphasised.
    return { primary: [to], related: from === to ? [] : [from], routes: [anchor] };
  }
  return none;
}

const MODE_OF_ACTION: Partial<Record<WallabyAction, TreatedMode>> = {
  HOP: 'GUIDE',
  LAND: 'GUIDE',
  PERCH: 'GUIDE',
  REVEAL: 'GUIDE',
  TRACE: 'GUIDE',
  INSPECT: 'INSPECT',
  COMPARE: 'COMPARE',
  RESOLVE: 'RESOLVE',
};

// ── The schedule ────────────────────────────────────────────────────────────

export interface DirectionKey {
  /** When the key takes effect; every value eases toward it over `settleMs` from the value before. */
  atMs: number;
  mode: AttentionMode;
  primary: string[];
  related: string[];
  routes: string[];
  /** Element id -> target opacity (1 = untouched). Node details follow their node. */
  emphasis: Record<string, number>;
  /** Element id -> target wash / guide-rule strength (0..1). */
  wash: Record<string, number>;
  /** Element id -> target resolved-rule strength (0..1). Persists once a RESOLVE beat has settled it. */
  resolved: Record<string, number>;
  /** The framing this key asks of the content world (already clamped; identity when refused). */
  framing: Framing;
  framingNote: string;
  /** Why the key exists, in words (the review artifact prints it). */
  reason: string;
  /** The beat that produced it, if any. */
  beat?: { index: number; action: WallabyAction; target?: string; secondaryTarget?: string; cue: string };
}

export interface SegmentDirection {
  segmentId: string;
  cast: Cast;
  keys: DirectionKey[];
  /** When the exit move or the non-cut transition out begins: the frame is the transition's from here. */
  exitMs: number | null;
}

export interface CameraKey {
  atMs: number;
  framing: Framing;
  segmentId: string;
  reason: string;
  /** A required key is never dropped: the return to identity before a transition or a segment's end. */
  required: boolean;
}

export interface AttentionPlan {
  config: AttentionConfig;
  segments: Map<string, SegmentDirection>;
  /** The whole video's camera schedule, after the minimum-hold rule. */
  camera: CameraKey[];
  /** Keys the minimum-hold rule did not take (the camera stayed where it was). */
  cameraDropped: CameraKey[];
}

/** The platform whose top edge carries this point (where the subject's anchor stands), or null. */
function platformUnder(layout: SceneLayout, p: Point): Rect | null {
  for (const pl of layout.platforms) {
    if (pl.kind === 'FRAME') continue;
    if (Math.abs(pl.rect.y - p.y) <= 1 && p.x >= pl.rect.x && p.x <= pl.rect.x + pl.rect.w) return pl.rect;
  }
  return null;
}

function elementRect(layout: SceneLayout, id: string): Rect | null {
  const text = layout.texts.find((t) => t.elementId === id);
  if (text) return text.rect;
  const platform = layout.platforms.find((p) => p.id === `node:${id}` || (id === 'ui:capture' && p.kind === 'FRAME'));
  return platform ? platform.rect : null;
}

function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The framing a mode asks for a subject, bounded and fail-closed:
 *  - scale is the mode's; a lean moves the world toward the subject's rect (with the platform its anchor stands on,
 *    so the subject and the support read as one);
 *  - coverage: |tx| <= 960 (s - 1), |ty| <= 540 (s - 1), so the content world still covers the whole frame and the
 *    canvas edge is never exposed (the ground runs edge to edge);
 *  - title-safe: every text region of the layout (eyebrow and provenance chip included) stays inside TITLE_SAFE and above CONTENT_BOTTOM
 *    after the transform; the lean is clamped into the admissible interval, and if the scale alone breaks it the
 *    framing is identity.
 */
export function frameSubject(treatment: Treatment, primary: readonly string[], anchors: readonly string[], layout: SceneLayout, cfg: AttentionConfig['framing']): { framing: Framing; note: string } {
  const s = Math.min(treatment.scale, cfg.maxScale);
  if (s <= 1) return { framing: IDENTITY_FRAMING, note: 'identity: the mode has no framing' };
  const rects = primary.map((id) => elementRect(layout, id)).filter((r): r is Rect => r !== null);
  for (const a of anchors) {
    const stand = layout.anchors[a]?.stand;
    const under = stand ? platformUnder(layout, stand) : null;
    if (under) rects.push(under);
  }
  const target = union(rects);
  const maxTx = Math.min(cfg.maxTranslateX, FRAME_CENTRE.x * (s - 1));
  const maxTy = Math.min(cfg.maxTranslateY, FRAME_CENTRE.y * (s - 1));
  const clampTo = (v: number, m: number): number => (v < -m ? -m : v > m ? m : v);
  let tx = target ? clampTo((FRAME_CENTRE.x - (target.x + target.w / 2)) * treatment.lean, maxTx) : 0;
  let ty = target ? clampTo((FRAME_CENTRE.y - (target.y + target.h / 2)) * treatment.lean, maxTy) : 0;
  const notes: string[] = [];
  if (target && (Math.abs(tx) === maxTx || Math.abs(ty) === maxTy) && treatment.lean > 0) notes.push('lean clamped by coverage');
  // Title-safe: the admissible interval of (tx, ty) over every text region.
  let lo = { x: -Infinity, y: -Infinity };
  let hi = { x: Infinity, y: Infinity };
  let binding: string | null = null;
  // The provenance chip shares the eyebrow row and rides the content world with it: it is protected like any text.
  const protect = [...layout.texts.map((t) => ({ elementId: t.elementId, rect: t.rect })), { elementId: 'provenance', rect: PROVENANCE_CHIP }];
  for (const t of protect) {
    const r = framedRect({ scale: s, tx: 0, ty: 0 }, t.rect);
    const cand = { lox: TITLE_SAFE.x - r.x, hix: TITLE_SAFE.x + TITLE_SAFE.w - (r.x + r.w), loy: TITLE_SAFE.y - r.y, hiy: Math.min(TITLE_SAFE.y + TITLE_SAFE.h, CONTENT_BOTTOM) - (r.y + r.h) };
    if (cand.lox > lo.x) { lo = { ...lo, x: cand.lox }; if (tx < cand.lox) binding = t.elementId; }
    if (cand.hix < hi.x) { hi = { ...hi, x: cand.hix }; if (tx > cand.hix) binding = t.elementId; }
    if (cand.loy > lo.y) { lo = { ...lo, y: cand.loy }; if (ty < cand.loy) binding = t.elementId; }
    if (cand.hiy < hi.y) { hi = { ...hi, y: cand.hiy }; if (ty > cand.hiy) binding = t.elementId; }
  }
  if (lo.x > hi.x || lo.y > hi.y) return { framing: IDENTITY_FRAMING, note: `refused: at scale ${s} a text region cannot stay title-safe` };
  const cx = Math.max(lo.x, Math.min(hi.x, tx));
  const cy = Math.max(lo.y, Math.min(hi.y, ty));
  if (cx !== tx || cy !== ty) notes.push(`lean clamped by title-safe (${binding ?? 'a text region'})`);
  tx = cx;
  ty = cy;
  return { framing: quantise({ scale: s, tx, ty }), note: notes.length ? notes.join('; ') : 'lean toward the subject' };
}

function hierarchy(mode: AttentionMode, t: Treatment, cast: Cast, primary: readonly string[], related: readonly string[], routes: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const prim = new Set([...primary, ...related]);
  const touches = (routeId: string): boolean => {
    const ends = cast.routeEnds[routeId];
    return routes.includes(routeId) || (ends !== undefined && (prim.has(ends[0]) || prim.has(ends[1])));
  };
  for (const id of cast.all) {
    const owner = cast.detailOf[id] ?? id;
    if (mode === 'ESTABLISH' || mode === 'TRANSITION') out[id] = 1;
    else if (prim.has(owner)) out[id] = 1;
    else if (cast.routes.includes(id)) out[id] = touches(id) ? 1 : t.routes;
    else if (cast.context.includes(owner)) out[id] = t.context;
    else if (cast.subjects.includes(owner)) out[id] = t.others;
    else out[id] = 1;
  }
  return out;
}

const f = (ms: number, fps: number): string => `f${Math.round((ms * fps) / 1000)}`;

/** The exit move of a segment (a push into depth or a leap to the next section), if the choreography has one. */
function exitClipStart(segmentId: string, clips: readonly Clip[]): number | null {
  const exit = clips.find((c) => c.segmentId === segmentId && (c.kind === 'PUSH' || c.kind === 'EXIT_JUMP'));
  return exit ? exit.startMs : null;
}

function segmentDirection(seg: TimedSegment, next: TimedSegment | undefined, layout: SceneLayout, clips: readonly Clip[], config: AttentionConfig, fps: number): SegmentDirection {
  const scene = seg.scene!;
  const cast = castOf(scene);
  const keys: DirectionKey[] = [];
  const resolvedSoFar: Record<string, number> = {};
  const neutralKey = (atMs: number, mode: 'ESTABLISH' | 'TRANSITION', reason: string): DirectionKey => ({
    atMs,
    mode,
    primary: [],
    related: [],
    routes: [],
    emphasis: hierarchy(mode, NEUTRAL, cast, [], [], []),
    wash: {},
    resolved: { ...resolvedSoFar },
    framing: IDENTITY_FRAMING,
    framingNote: 'identity',
    reason,
  });
  keys.push(neutralKey(seg.contentStartMs, 'ESTABLISH', 'the scene opens: the terrain is shown evenly, no forced subject'));

  // Beats in the order they happen (ties: the later-authored beat wins); exit beats shape the transition, not the hierarchy.
  const beats = [...seg.beats].filter((b) => !EXIT_ACTIONS.has(b.beat.action)).sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  for (const tb of beats) {
    const key = keyForBeat(tb, scene, cast, layout, config, resolvedSoFar, fps);
    if (key.mode === 'RESOLVE') for (const id of key.primary) resolvedSoFar[id] = 1;
    const prev = keys[keys.length - 1]!;
    if (prev.atMs === key.atMs) keys.pop();
    else if (prev.mode === key.mode && sameList(prev.primary, key.primary) && sameList(prev.related, key.related) && sameList(prev.routes, key.routes)) continue;
    keys.push(key);
  }

  // The transition out: an exit move, or a non-cut transition into the next segment. Effects and framing are neutral
  // by the time it begins; a cut keeps the scene as it is while it fades.
  const exitAt = exitClipStart(seg.id, clips);
  const exitMs = exitAt ?? (next && next.transitionIn.type !== 'CUT' ? seg.endMs : null);
  if (exitMs !== null) {
    const at = exitMs - config.settleMs;
    const why = exitAt !== null ? `the exit move begins at ${f(exitMs, fps)}: the transition owns the frame` : `the ${next!.transitionIn.type} transition begins at ${f(exitMs, fps)}: it owns the frame`;
    const kept = keys.filter((k) => k.atMs < at);
    kept.push(neutralKey(at, 'TRANSITION', why));
    keys.splice(0, keys.length, ...kept);
  }
  return { segmentId: seg.id, cast, keys, exitMs };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function keyForBeat(tb: TimedBeat, scene: SceneSpec, cast: Cast, layout: SceneLayout, config: AttentionConfig, resolvedSoFar: Record<string, number>, fps: number): DirectionKey {
  const { beat } = tb;
  const treated = MODE_OF_ACTION[beat.action];
  const first = subjectsOfAnchor(beat.target, scene);
  const second = beat.action === 'COMPARE' ? subjectsOfAnchor(beat.secondaryTarget, scene) : { primary: [], related: [], routes: [] };
  const known = new Set(cast.all);
  const primary = [...first.primary, ...second.primary].filter((id) => known.has(id));
  const related = [...first.related, ...second.related].filter((id) => known.has(id) && !primary.includes(id));
  const routes = [...first.routes, ...second.routes].filter((id) => known.has(id));
  const label = `beat #${tb.index} ${beat.action} ${beat.target ?? ''}${beat.secondaryTarget ? ` vs ${beat.secondaryTarget}` : ''} at ${f(tb.startMs, fps)} (cue ${beat.cue})`;
  const base = { atMs: tb.startMs, related, routes, resolved: { ...resolvedSoFar }, beat: { index: tb.index, action: beat.action, ...(beat.target ? { target: beat.target } : {}), ...(beat.secondaryTarget ? { secondaryTarget: beat.secondaryTarget } : {}), cue: beat.cue } };
  if (!treated || primary.length === 0) {
    return { ...base, mode: 'ESTABLISH', primary: [], related: [], routes: [], emphasis: hierarchy('ESTABLISH', NEUTRAL, cast, [], [], []), wash: {}, framing: IDENTITY_FRAMING, framingNote: 'identity', reason: `${label}: no single subject, the whole surface is read` };
  }
  const t = config.modes[treated];
  const anchors = [beat.target, beat.secondaryTarget].filter((a): a is string => typeof a === 'string');
  const { framing, note } = treated === 'COMPARE' ? { framing: IDENTITY_FRAMING, note: 'identity: two subjects share the frame as it is' } : frameSubject(t, primary, anchors, layout, config.framing);
  const wash: Record<string, number> = {};
  for (const id of primary) wash[id] = 1;
  const resolved = { ...resolvedSoFar };
  if (treated === 'RESOLVE') for (const id of primary) resolved[id] = 1;
  const why =
    treated === 'GUIDE' ? `${label}: the destination gains quiet priority` :
    treated === 'INSPECT' ? `${label}: one subject is primary, the unrelated recedes` :
    treated === 'COMPARE' ? `${label}: both alternatives share the primary hierarchy` :
    `${label}: the emphasis settles into the resolved rule and holds`;
  return { ...base, mode: treated, primary, emphasis: hierarchy(treated, t, cast, primary, related, routes), wash, resolved, framing, framingNote: note, reason: why };
}

/**
 * The camera schedule of the whole video. Scene keys ask for their framing; every scene segment ends with a
 * REQUIRED return to identity before its exit move, its non-cut transition, or its end, so every segment boundary
 * and every brand segment is at identity. The minimum-hold rule then drops any non-required key the camera could
 * not hold for `minHoldMs` after its settle (it stays where it was), and a key that asks for the pose the camera
 * already holds is a no-op.
 */
function cameraSchedule(segments: Map<string, SegmentDirection>, timeline: Timeline, config: AttentionConfig): { camera: CameraKey[]; dropped: CameraKey[] } {
  const asked: CameraKey[] = [];
  for (const seg of timeline.segments) {
    const d = segments.get(seg.id);
    if (!d) continue;
    for (const k of d.keys) {
      if (k.mode === 'TRANSITION') asked.push({ atMs: k.atMs, framing: IDENTITY_FRAMING, segmentId: seg.id, reason: k.reason, required: true });
      else asked.push({ atMs: k.atMs, framing: k.framing, segmentId: seg.id, reason: k.reason, required: false });
    }
    if (d.exitMs === null) asked.push({ atMs: seg.endMs - config.settleMs, framing: IDENTITY_FRAMING, segmentId: seg.id, reason: `the segment ends at ${f(seg.endMs, timeline.fps)}: back to identity before the cut`, required: true });
  }
  asked.sort((a, b) => a.atMs - b.atMs || Number(a.required) - Number(b.required));
  const kept: CameraKey[] = [];
  const dropped: CameraKey[] = [];
  const gap = config.settleMs + config.minHoldMs;
  for (const k of asked) {
    while (kept.length && !kept[kept.length - 1]!.required && k.atMs - kept[kept.length - 1]!.atMs < gap) dropped.push(kept.pop()!);
    const last = kept[kept.length - 1];
    if (last && last.required && !k.required && k.atMs - last.atMs < gap) {
      dropped.push(k);
      continue;
    }
    if (framingEquals(k.framing, last ? last.framing : IDENTITY_FRAMING)) continue;
    kept.push(k);
  }
  return { camera: kept, dropped };
}

export function planAttention(timeline: Timeline, layouts: ReadonlyMap<string, SceneLayout>, clips: readonly Clip[], config: AttentionConfig): AttentionPlan {
  const segments = new Map<string, SegmentDirection>();
  timeline.segments.forEach((seg, i) => {
    const layout = layouts.get(seg.id);
    if (!seg.scene || !layout) return;
    segments.set(seg.id, segmentDirection(seg, timeline.segments[i + 1], layout, clips, config, timeline.fps));
  });
  const { camera, dropped } = cameraSchedule(segments, timeline, config);
  return { config, segments, camera, cameraDropped: dropped };
}

// ── Sampling ────────────────────────────────────────────────────────────────

export interface SceneDirection {
  mode: AttentionMode;
  primary: readonly string[];
  related: readonly string[];
  routes: readonly string[];
  /** Element id -> opacity multiplier, eased. Missing = 1. */
  emphasis: Record<string, number>;
  /** Element id -> wash / guide-rule strength, eased. Missing = 0. */
  wash: Record<string, number>;
  /** Element id -> resolved-rule strength, eased. Missing = 0. */
  resolved: Record<string, number>;
  /** The key in effect (null before the scene's content starts). */
  key: DirectionKey | null;
}

/** Before a scene's content starts, the transition owns the frame; a brand segment has no direction at all (fixed, even). */
const IN_TRANSITION: SceneDirection = Object.freeze({ mode: 'TRANSITION', primary: [], related: [], routes: [], emphasis: {}, wash: {}, resolved: {}, key: null });
const UNDIRECTED: SceneDirection = Object.freeze({ mode: 'ESTABLISH', primary: [], related: [], routes: [], emphasis: {}, wash: {}, resolved: {}, key: null });

/** A value eased through a chain of keys: at key i, the value eases from what it was when key i began toward key i's target. */
function eased(keys: readonly DirectionKey[], i: number, ms: number, settleMs: number, pick: (k: DirectionKey) => number, initial: number): number {
  if (i < 0) return initial;
  const k = keys[i]!;
  const from = eased(keys, i - 1, k.atMs, settleMs, pick, initial);
  const p = easeInOut((ms - k.atMs) / settleMs);
  return lerp(from, pick(k), p);
}

export function directionAt(plan: AttentionPlan, segmentId: string, ms: number): SceneDirection {
  const seg = plan.segments.get(segmentId);
  if (!seg) return UNDIRECTED;
  let i = -1;
  for (let j = 0; j < seg.keys.length; j++) if (seg.keys[j]!.atMs <= ms) i = j;
  if (i < 0) return IN_TRANSITION;
  const key = seg.keys[i]!;
  const settle = plan.config.settleMs;
  const emphasis: Record<string, number> = {};
  const wash: Record<string, number> = {};
  const resolved: Record<string, number> = {};
  for (const id of seg.cast.all) {
    emphasis[id] = round(eased(seg.keys, i, ms, settle, (k) => k.emphasis[id] ?? 1, 1));
    const w = round(eased(seg.keys, i, ms, settle, (k) => k.wash[id] ?? 0, 0));
    if (w > 0) wash[id] = w;
    const r = round(eased(seg.keys, i, ms, settle, (k) => k.resolved[id] ?? 0, 0));
    if (r > 0) resolved[id] = r;
  }
  return { mode: key.mode, primary: key.primary, related: key.related, routes: key.routes, emphasis, wash, resolved, key };
}

const round = (v: number): number => Math.round(v * 1e4) / 1e4;

/** The content world's framing at `ms`: eased through the camera schedule, identity before its first key. */
export function cameraAt(plan: AttentionPlan, ms: number): Framing {
  const keys = plan.camera;
  let i = -1;
  for (let j = 0; j < keys.length; j++) if (keys[j]!.atMs <= ms) i = j;
  if (i < 0) return IDENTITY_FRAMING;
  const settle = plan.config.settleMs;
  const at = (j: number, t: number): Framing => {
    if (j < 0) return IDENTITY_FRAMING;
    const k = keys[j]!;
    const from = at(j - 1, k.atMs);
    const p = easeInOut((t - k.atMs) / settle);
    return { scale: lerp(from.scale, k.framing.scale, p), tx: lerp(from.tx, k.framing.tx, p), ty: lerp(from.ty, k.framing.ty, p) };
  };
  return covered(quantise(at(i, ms)));
}

/** The coverage rule at every sampled frame, quantisation included: the world never exposes the canvas edge. */
function covered(f: Framing): Framing {
  const mx = FRAME_CENTRE.x * (f.scale - 1);
  const my = FRAME_CENTRE.y * (f.scale - 1);
  // Clamp, then round toward zero, so the rounded lean can never exceed the coverage of the rounded scale.
  const toward0 = (v: number): number => Math.trunc(v * 1e3) / 1e3;
  const tx = toward0(f.tx < -mx ? -mx : f.tx > mx ? mx : f.tx);
  const ty = toward0(f.ty < -my ? -my : f.ty > my ? my : f.ty);
  return tx === f.tx && ty === f.ty ? f : { scale: f.scale, tx, ty };
}

/** The route entrance: the fraction of a route drawn from its source toward its destination (0 before its reveal, 1 once drawn). */
export function routeDrawn(ms: number, revealMs: number | undefined, drawMs: number): number {
  if (revealMs === undefined) return 1;
  if (ms < revealMs) return 0;
  if (drawMs <= 0) return 1;
  const p = (ms - revealMs) / drawMs;
  return p >= 1 ? 1 : easeOut(p);
}
