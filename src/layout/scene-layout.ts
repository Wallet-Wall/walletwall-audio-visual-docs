// Deterministic scene layout: the single source of geometry for both the
// validator (text fit, safe area, Wallaby anchors) and the Remotion renderer.
//
// The terrain metaphor lives here as plain geometry: cards and graph nodes are
// platforms, edges are routes, the ground line is the path between them, and
// the depth dimension is a pair of stacked masonry slabs. There is no physics,
// no pathfinding, and no free placement: every scene type has a fixed grammar.
// Isomorphic.

import type { CardScene, GraphNode, GraphScene, SceneSpec, TakeawayScene, UiScene, VisualText } from '../spec/types.ts';
import { center, CONTENT_BOTTOM, GROUND_Y, type Point, type Rect } from './geometry.ts';
import { estimateWidth, type TextBox, type TextStyle } from './text-fit.ts';

export const TEXT_STYLES = {
  eyebrow: { font: 'ui', size: 22, weight: 700, lineHeight: 1.2, tracking: 4, uppercase: true },
  cardHeading: { font: 'display', size: 60, weight: 600, lineHeight: 1.12 },
  cardBody: { font: 'ui', size: 34, weight: 500, lineHeight: 1.3 },
  graphCaption: { font: 'display', size: 44, weight: 600, lineHeight: 1.15 },
  nodeLabel: { font: 'display', size: 32, weight: 600, lineHeight: 1.15 },
  nodeDetail: { font: 'ui', size: 22, weight: 500, lineHeight: 1.3 },
  takeawayStatement: { font: 'display', size: 68, weight: 600, lineHeight: 1.12 },
  takeawaySupport: { font: 'ui', size: 32, weight: 500, lineHeight: 1.35 },
  uiCaption: { font: 'display', size: 40, weight: 600, lineHeight: 1.15 },
  chip: { font: 'mono', size: 16, weight: 500, lineHeight: 1.2 },
} as const satisfies Record<string, TextStyle>;

export type TextStyleKey = keyof typeof TEXT_STYLES;

export interface TextRegion {
  elementId: string;
  text: string;
  rect: Rect;
  box: TextBox;
  styleKey: TextStyleKey;
  mono: boolean;
}

export type PlatformKind = 'CARD' | 'NODE' | 'PILLAR' | 'LEDGE' | 'FRAME';

export interface Platform {
  id: string;
  kind: PlatformKind;
  rect: Rect;
}

export interface Anchor {
  /** Where WalletWallaby's feet go. */
  stand: Point;
  /** What WalletWallaby looks or points at. */
  focus: Point;
  /** Character scale at this anchor (depth planes shrink with distance). */
  scale: number;
}

export interface Route {
  id: string;
  from: string;
  to: string;
  /** Polyline from origin to destination, used for drawing and TRACE motion. */
  points: Point[];
  selfLoop: boolean;
}

export interface Slab {
  id: 'upper' | 'lower';
  /** Trapezoid corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [Point, Point, Point, Point];
}

export interface SceneLayout {
  texts: TextRegion[];
  platforms: Platform[];
  anchors: Record<string, Anchor>;
  routes: Route[];
  slabs: Slab[];
  /** Hard limits the planner must respect for this scene grammar. */
  limits: { maxItems: number };
}

export const EYEBROW_RECT: Rect = { x: 160, y: 104, w: 1100, h: 32 };
/**
 * Where WalletWallaby arrives when a scene's first beat names no landing spot:
 * a clear patch of ground beside a card, or the first foothold of a route.
 */
function entryAnchor(scene: SceneSpec, layout: SceneLayout): Anchor {
  const first = (prefix: string) => Object.entries(layout.anchors).find(([id]) => id.startsWith(prefix))?.[1];
  switch (scene.type) {
    case 'CARD':
      return { stand: { x: scene.layout === 'SPLIT' ? 1700 : 1640, y: GROUND_Y }, focus: { x: 700, y: 560 }, scale: WALLABY_SCALE.surface };
    case 'GRAPH':
      return (scene.layout === 'LAYERED' ? layout.anchors[`node:${scene.nodes.find((n) => n.layer === 'LOWER')?.id}`] : first('node:')) ?? FALLBACK_ENTRY;
    case 'UI':
      return layout.anchors['ui:capture'] ?? FALLBACK_ENTRY;
    case 'TAKEAWAY':
      return layout.anchors['takeaway:statement'] ?? FALLBACK_ENTRY;
  }
}

const FALLBACK_ENTRY: Anchor = { stand: { x: 1700, y: GROUND_Y }, focus: { x: 900, y: 560 }, scale: 0.78 };
const WALLABY_SCALE = { surface: 0.78, graph: 0.7, depthNear: 0.7, depthFar: 0.5 } as const;

function region(el: VisualText, rect: Rect, styleKey: TextStyleKey, maxLines: number): TextRegion {
  return {
    elementId: el.id,
    text: el.text,
    rect,
    box: { maxWidth: rect.w, maxLines, style: TEXT_STYLES[styleKey] },
    styleKey,
    mono: el.mono === true,
  };
}

function eyebrowRegion(text: string): TextRegion {
  return {
    elementId: 'eyebrow',
    text,
    rect: EYEBROW_RECT,
    box: { maxWidth: EYEBROW_RECT.w, maxLines: 1, style: TEXT_STYLES.eyebrow },
    styleKey: 'eyebrow',
    mono: false,
  };
}

function lineHeightPx(styleKey: TextStyleKey, lines: number): number {
  const s = TEXT_STYLES[styleKey];
  return Math.ceil(s.size * s.lineHeight * lines);
}

/** `eyebrowText` is the heading of the cited source section (provenance shown on screen). */
export function layoutScene(scene: SceneSpec, eyebrowText: string): SceneLayout {
  const base = ((): SceneLayout => {
    switch (scene.type) {
      case 'CARD':
        return scene.layout === 'SPLIT' ? layoutSplitCard(scene) : layoutStackCard(scene);
      case 'GRAPH':
        return scene.layout === 'LAYERED' ? layoutLayered(scene) : layoutRoute(scene);
      case 'UI':
        return layoutUi(scene);
      case 'TAKEAWAY':
        return layoutTakeaway(scene);
    }
  })();
  base.texts.unshift(eyebrowRegion(eyebrowText));
  base.anchors['scene:entry'] = entryAnchor(scene, base);
  return base;
}

// ── CARD ────────────────────────────────────────────────────────────────────

const CARD_RECT: Rect = { x: 160, y: 370, w: 1120, h: GROUND_Y - 370 };
const CARD_PAD = 50;

function layoutStackCard(scene: CardScene): SceneLayout {
  const inner = CARD_RECT.w - CARD_PAD * 2;
  const headingH = lineHeightPx('cardHeading', 2);
  const texts: TextRegion[] = [
    region(scene.heading, { x: CARD_RECT.x + CARD_PAD, y: CARD_RECT.y + CARD_PAD, w: inner, h: headingH }, 'cardHeading', 2),
  ];
  const anchors: Record<string, Anchor> = {};
  const standOnCard = (x: number): Point => ({ x, y: CARD_RECT.y });
  anchors['card:heading'] = { stand: standOnCard(CARD_RECT.x + CARD_RECT.w - 150), focus: center(texts[0]!.rect), scale: WALLABY_SCALE.surface };
  const itemH = lineHeightPx('cardBody', 2);
  let y = CARD_RECT.y + CARD_PAD + headingH + 28;
  scene.body.forEach((el, i) => {
    const rect = { x: CARD_RECT.x + CARD_PAD, y, w: inner, h: itemH };
    texts.push(region(el, rect, 'cardBody', 2));
    anchors[`card:body:${el.id}`] = { stand: standOnCard(CARD_RECT.x + CARD_RECT.w - 150 - i * 40), focus: center(rect), scale: WALLABY_SCALE.surface };
    y += itemH + 14;
  });
  anchors['card:top'] = { stand: standOnCard(CARD_RECT.x + CARD_RECT.w - 150), focus: center(CARD_RECT), scale: WALLABY_SCALE.surface };
  return { texts, platforms: [{ id: 'card', kind: 'CARD', rect: CARD_RECT }], anchors, routes: [], slabs: [], limits: { maxItems: 3 } };
}

const SPLIT_RECT: Rect = { x: 160, y: 370, w: 1340, h: GROUND_Y - 370 };

function layoutSplitCard(scene: CardScene): SceneLayout {
  const inner = SPLIT_RECT.w - CARD_PAD * 2;
  const headingH = lineHeightPx('cardHeading', 2);
  const texts: TextRegion[] = [
    region(scene.heading, { x: SPLIT_RECT.x + CARD_PAD, y: SPLIT_RECT.y + CARD_PAD, w: inner, h: headingH }, 'cardHeading', 2),
  ];
  const anchors: Record<string, Anchor> = {
    'card:heading': { stand: { x: SPLIT_RECT.x + SPLIT_RECT.w / 2, y: SPLIT_RECT.y }, focus: center(texts[0]!.rect), scale: WALLABY_SCALE.surface },
    'card:top': { stand: { x: SPLIT_RECT.x + SPLIT_RECT.w / 2, y: SPLIT_RECT.y }, focus: center(SPLIT_RECT), scale: WALLABY_SCALE.surface },
  };
  const colGap = 80;
  const colW = (inner - colGap) / 2;
  const colY = SPLIT_RECT.y + CARD_PAD + headingH + 40;
  scene.body.slice(0, 2).forEach((el, i) => {
    const rect = { x: SPLIT_RECT.x + CARD_PAD + i * (colW + colGap), y: colY, w: colW, h: lineHeightPx('cardBody', 5) };
    texts.push(region(el, rect, 'cardBody', 5));
    anchors[`card:body:${el.id}`] = { stand: { x: rect.x + rect.w / 2, y: SPLIT_RECT.y }, focus: center(rect), scale: WALLABY_SCALE.surface };
  });
  return { texts, platforms: [{ id: 'card', kind: 'CARD', rect: SPLIT_RECT }], anchors, routes: [], slabs: [], limits: { maxItems: 2 } };
}

// ── GRAPH: ROUTE / ASCENDING_ROUTE ──────────────────────────────────────────

const NODE_W = 300;
const NODE_H = 200;
const ROUTE_SPAN = { x0: 160, x1: 1760 };
const CAPTION_RECT: Rect = { x: 160, y: 168, w: 900, h: 0 };

/** Label (up to labelLines) and optional detail (up to detailLines) stacked inside a node platform. */
function nodeTexts(node: GraphNode, rect: Rect, labelLines: number, detailLines: number, pad = 22): TextRegion[] {
  const labelH = lineHeightPx('nodeLabel', labelLines);
  const out = [region(node, { x: rect.x + pad, y: rect.y + pad, w: rect.w - pad * 2, h: labelH }, 'nodeLabel', labelLines)];
  if (node.detail) {
    const detailRect = { x: rect.x + pad, y: rect.y + pad + labelH + 8, w: rect.w - pad * 2, h: lineHeightPx('nodeDetail', detailLines) };
    out.push(region(node.detail, detailRect, 'nodeDetail', detailLines));
  }
  return out;
}

function layoutRoute(scene: GraphScene): SceneLayout {
  const n = scene.nodes.length;
  const gap = n > 1 ? (ROUTE_SPAN.x1 - ROUTE_SPAN.x0 - n * NODE_W) / (n - 1) : 0;
  const step = scene.layout === 'ASCENDING_ROUTE' && n > 1 ? Math.min(90, 270 / (n - 1)) : 0;
  const texts: TextRegion[] = [];
  const platforms: Platform[] = [];
  const anchors: Record<string, Anchor> = {};
  const rects = new Map<string, Rect>();
  if (scene.caption) {
    texts.push(region(scene.caption, { ...CAPTION_RECT, h: lineHeightPx('graphCaption', 2) }, 'graphCaption', 2));
  }
  scene.nodes.forEach((node, i) => {
    const top = scene.layout === 'ASCENDING_ROUTE' ? 640 - i * step : 560;
    const rect: Rect = { x: ROUTE_SPAN.x0 + i * (NODE_W + gap), y: top, w: NODE_W, h: Math.min(NODE_H, GROUND_Y - top - 40) };
    rects.set(node.id, rect);
    platforms.push({ id: `pillar:${node.id}`, kind: 'PILLAR', rect: { x: rect.x + 40, y: rect.y + rect.h, w: rect.w - 80, h: GROUND_Y - rect.y - rect.h } });
    platforms.push({ id: `node:${node.id}`, kind: 'NODE', rect });
    texts.push(...nodeTexts(node, rect, 2, 3));
    anchors[`node:${node.id}`] = { stand: { x: rect.x + rect.w / 2, y: rect.y }, focus: center(rect), scale: WALLABY_SCALE.graph };
  });
  const routes = scene.edges.flatMap((edge): Route[] => {
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) return [];
    const id = `edge:${edge.from}->${edge.to}`;
    let points: Point[];
    if (edge.from === edge.to) {
      // Cubic loop over the node: start, two control points, end.
      points = [
        { x: a.x + 70, y: a.y },
        { x: a.x + 40, y: a.y - 120 },
        { x: a.x + a.w - 40, y: a.y - 120 },
        { x: a.x + a.w - 70, y: a.y },
      ];
    } else {
      const forward = b.x > a.x;
      const start = { x: forward ? a.x + a.w : a.x, y: a.y + 46 };
      const end = { x: forward ? b.x : b.x + b.w, y: b.y + 46 };
      points = [start, { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 18 }, end];
    }
    const mid = points[Math.floor(points.length / 2)]!;
    anchors[id] = { stand: { x: mid.x, y: Math.min(a.y, b.y) }, focus: mid, scale: WALLABY_SCALE.graph };
    return [{ id, from: edge.from, to: edge.to, points, selfLoop: edge.from === edge.to }];
  });
  return { texts, platforms, anchors, routes, slabs: [], limits: { maxItems: 5 } };
}

// ── GRAPH: LAYERED (the depth dimension) ────────────────────────────────────

const UPPER_SLAB: Slab = {
  id: 'upper',
  corners: [
    { x: 620, y: 330 },
    { x: 1300, y: 330 },
    { x: 1440, y: 450 },
    { x: 480, y: 450 },
  ],
};
const LOWER_SLAB: Slab = {
  id: 'lower',
  corners: [
    { x: 300, y: 640 },
    { x: 1620, y: 640 },
    { x: 1780, y: 860 },
    { x: 140, y: 860 },
  ],
};

function layoutLayered(scene: GraphScene): SceneLayout {
  const texts: TextRegion[] = [];
  const platforms: Platform[] = [];
  const anchors: Record<string, Anchor> = {};
  const rects = new Map<string, Rect>();
  if (scene.caption) {
    texts.push(region(scene.caption, { x: 160, y: 168, w: 420, h: lineHeightPx('graphCaption', 3) }, 'graphCaption', 3));
  }
  const upper = scene.nodes.filter((nd) => nd.layer === 'UPPER');
  const lower = scene.nodes.filter((nd) => nd.layer === 'LOWER');
  const upperW = upper.length > 1 ? 360 : 420;
  upper.forEach((node, i) => {
    const cx = upper.length > 1 ? 760 + i * 400 : 960;
    const rect: Rect = { x: cx - upperW / 2, y: 290, w: upperW, h: 160 };
    rects.set(node.id, rect);
    platforms.push({ id: `node:${node.id}`, kind: 'NODE', rect });
    texts.push(...nodeTexts(node, rect, 1, 2));
    anchors[`node:${node.id}`] = { stand: { x: rect.x + 60, y: rect.y }, focus: center(rect), scale: WALLABY_SCALE.depthFar };
  });
  const lowerW = 270;
  const span = { x0: 200, x1: 1720 };
  const gap = lower.length > 1 ? (span.x1 - span.x0 - lower.length * lowerW) / (lower.length - 1) : 0;
  lower.forEach((node, i) => {
    const rect: Rect = { x: span.x0 + i * (lowerW + gap), y: 650, w: lowerW, h: 170 };
    rects.set(node.id, rect);
    platforms.push({ id: `node:${node.id}`, kind: 'NODE', rect });
    texts.push(...nodeTexts(node, rect, 2, 2, 20));
    anchors[`node:${node.id}`] = { stand: { x: rect.x + rect.w / 2, y: rect.y }, focus: center(rect), scale: WALLABY_SCALE.depthNear };
  });
  const routes = scene.edges.flatMap((edge): Route[] => {
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    if (!a || !b) return [];
    const id = `edge:${edge.from}->${edge.to}`;
    // Evidence rises from the lower plane to the result it supports.
    const aIsLower = a.y > b.y;
    const start = aIsLower ? { x: a.x + a.w / 2, y: a.y } : { x: a.x + a.w / 2, y: a.y + a.h };
    const end = aIsLower ? { x: b.x + b.w / 2, y: b.y + b.h } : { x: b.x + b.w / 2, y: b.y };
    const points = [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, end];
    anchors[id] = { stand: { x: start.x, y: aIsLower ? a.y : b.y }, focus: points[1]!, scale: WALLABY_SCALE.depthNear };
    return [{ id, from: edge.from, to: edge.to, points, selfLoop: false }];
  });
  return { texts, platforms, anchors, routes, slabs: [UPPER_SLAB, LOWER_SLAB], limits: { maxItems: 6 } };
}

// ── UI ──────────────────────────────────────────────────────────────────────

const UI_FRAME: Rect = { x: 160, y: 370, w: 1280, h: GROUND_Y - 370 };

function layoutUi(scene: UiScene): SceneLayout {
  const caption = region(scene.caption, { x: 160, y: 168, w: 1000, h: lineHeightPx('uiCaption', 2) }, 'uiCaption', 2);
  return {
    texts: [caption],
    platforms: [{ id: 'ui:frame', kind: 'FRAME', rect: UI_FRAME }],
    anchors: { 'ui:capture': { stand: { x: UI_FRAME.x + UI_FRAME.w - 120, y: UI_FRAME.y }, focus: center(UI_FRAME), scale: WALLABY_SCALE.surface } },
    routes: [],
    slabs: [],
    limits: { maxItems: 1 },
  };
}

// ── TAKEAWAY ────────────────────────────────────────────────────────────────

/** The summit ledge: the end of the route, where the takeaway is delivered. */
export const SUMMIT_LEDGE: Rect = { x: 1440, y: 600, w: 320, h: GROUND_Y - 600 };

function layoutTakeaway(scene: TakeawayScene): SceneLayout {
  const statementRect: Rect = { x: 160, y: 250, w: 1180, h: lineHeightPx('takeawayStatement', 3) };
  const texts: TextRegion[] = [region(scene.statement, statementRect, 'takeawayStatement', 3)];
  const stand = { x: SUMMIT_LEDGE.x + SUMMIT_LEDGE.w / 2, y: SUMMIT_LEDGE.y };
  const anchors: Record<string, Anchor> = {
    'takeaway:statement': { stand, focus: center(statementRect), scale: WALLABY_SCALE.surface },
  };
  let y = statementRect.y + statementRect.h + 44;
  const supportH = lineHeightPx('takeawaySupport', 2);
  for (const el of scene.support) {
    const rect = { x: 160, y, w: 1180, h: supportH };
    texts.push(region(el, rect, 'takeawaySupport', 2));
    anchors[`takeaway:support:${el.id}`] = { stand, focus: center(rect), scale: WALLABY_SCALE.surface };
    y += supportH + 20;
  }
  return { texts, platforms: [{ id: 'ledge', kind: 'LEDGE', rect: SUMMIT_LEDGE }], anchors, routes: [], slabs: [], limits: { maxItems: 2 } };
}

/** WalletWallaby's drawn extent at scale 1, relative to the feet (tail tip to nose, ear tips). */
export const WALLABY_EXTENT = { left: 150, right: 100, top: 292 } as const;

/** The frame region WalletWallaby occupies when standing at an anchor. */
export function wallabyBounds(stand: Point, scale: number): Rect {
  return {
    x: stand.x - WALLABY_EXTENT.left * scale,
    y: stand.y - WALLABY_EXTENT.top * scale,
    w: (WALLABY_EXTENT.left + WALLABY_EXTENT.right) * scale,
    h: WALLABY_EXTENT.top * scale,
  };
}

/** The part of the eyebrow row the eyebrow text actually occupies. */
export function eyebrowOccupied(text: string): Rect {
  return { ...EYEBROW_RECT, w: Math.min(EYEBROW_RECT.w, estimateWidth(text, TEXT_STYLES.eyebrow)) };
}

/** Bottom boundary every teaching layout must respect (player chrome and captions below). */
export const LAYOUT_CONTENT_BOTTOM = CONTENT_BOTTOM;
