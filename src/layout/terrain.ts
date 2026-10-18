// Information terrain, semantically: what each drawn element offers a body.
//
// Content is terrain, but not every pixel is. A card's top is a surface to
// stand on; a graph node's top is a platform; the ground line is ground; the
// summit is a ledge. A block's side is a face: a hand may brace on it, and a
// climbing hand may grip the lip where it meets the top, but feet never stand
// on it. A route line, a text underline, a hairline border, a divider, or a UI
// capture's frame is drawn information and is never terrain at all.
//
// This module declares, from the scene layout, every surface the renderer
// draws, with its orientation, thickness, and what it can offer. It decides
// nothing about a body: Motion Intelligence grades a declared surface for a
// body of a given size (broad support, normal ledge, narrow ledge) and decides
// which contacts are plausible (../character/walletwallaby/support.ts, and the
// Rust engine's port of it). Isomorphic.

import { BRAND_GROUND } from './brand-layout.ts';
import { GROUND_Y, type Point, type Rect } from './geometry.ts';
import { EYEBROW_RECT, type SceneLayout } from './scene-layout.ts';

/**
 * What a surface can offer, as declared by the scene grammar:
 * - SUPPORTED_SURFACE: a solid top the feet may stand on (a card, a node, the ground).
 * - LEDGE: a solid top with a drop beside it (the summit ledge): feet may stand on it.
 * - NARROW_LEDGE: a solid top only just wide enough for the feet: only an explicitly authored narrow perch may use it.
 * - DECORATIVE_EDGE: a hairline, underline, divider, or border: drawn, never terrain.
 * - SIDE_FACE: the vertical face of a solid block: a hand may brace on it, its lip may be gripped; never feet.
 * - NON_SUPPORTING: information that is not terrain (a route line, a UI capture's top): nothing touches it.
 * - OPTIONAL_BRACE: a face a hand may brace against while the feet stand elsewhere; nothing stands on it.
 */
export type SupportClass = 'SUPPORTED_SURFACE' | 'LEDGE' | 'NARROW_LEDGE' | 'DECORATIVE_EDGE' | 'SIDE_FACE' | 'NON_SUPPORTING' | 'OPTIONAL_BRACE';
export const SUPPORT_CLASSES: readonly SupportClass[] = ['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE', 'DECORATIVE_EDGE', 'SIDE_FACE', 'NON_SUPPORTING', 'OPTIONAL_BRACE'];

/** Which way a surface faces: a horizontal top, a vertical face on a block's left or right, or a drawn line (any direction). */
export type TerrainFace = 'TOP' | 'LEFT' | 'RIGHT' | 'LINE';
export const TERRAIN_FACES: readonly TerrainFace[] = ['TOP', 'LEFT', 'RIGHT', 'LINE'];

export interface TerrainSurface {
  /** Stable id: `<element>:<face>` for block surfaces, the route id (and its segment) for lines. */
  id: string;
  /** The element the surface belongs to: a platform id, a route id, or 'ground'. */
  element: string;
  face: TerrainFace;
  support: SupportClass;
  /**
   * TOP: the segment from (x0, y0) to (x1, y0), with y1 = y0.
   * LEFT / RIGHT: the vertical segment at x0 (= x1) from its top y0 down to y1.
   * LINE: the segment from (x0, y0) to (x1, y1).
   */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Visible thickness behind the surface, px: a solid block's depth, a hairline's width. */
  thicknessPx: number;
}

/** Everything a contact is judged against in one segment: the declared surfaces and the text no contact may touch. */
export interface Terrain {
  surfaces: TerrainSurface[];
  /** The scene's text blocks and its eyebrow row: exactly the list the arc search keeps clear. */
  protectedText: Rect[];
}

/** The ground: the baseline every SURFACE-plane scene draws edge to edge. */
const groundSurface = (x0: number, x1: number): TerrainSurface => ({ id: 'ground:top', element: 'ground', face: 'TOP', support: 'SUPPORTED_SURFACE', x0, y0: GROUND_Y, x1, y1: GROUND_Y, thicknessPx: 1080 - GROUND_Y });

/** The four surfaces of a solid block: its top (as `top`) and its two faces; the bottom faces the ground and is never touched. */
function blockSurfaces(element: string, rect: Rect, top: SupportClass, faces: SupportClass): TerrainSurface[] {
  const { x, y, w, h } = rect;
  return [
    { id: `${element}:top`, element, face: 'TOP', support: top, x0: x, y0: y, x1: x + w, y1: y, thicknessPx: h },
    { id: `${element}:left`, element, face: 'LEFT', support: faces, x0: x, y0: y, x1: x, y1: y + h, thicknessPx: w },
    { id: `${element}:right`, element, face: 'RIGHT', support: faces, x0: x + w, y0: y, x1: x + w, y1: y + h, thicknessPx: w },
  ];
}

/**
 * The terrain a scene layout draws. Cards, nodes, and the summit ledge are solid blocks: their tops
 * carry feet, their faces take a hand. A pillar sits under its node (its top is the node's underside),
 * so it offers only its faces. A UI capture is evidence, not terrain: its top carries nothing, its
 * sides may take a bracing hand from someone standing beside it. A route is a drawn line: nothing
 * touches it. The ground is terrain wherever the scene draws it.
 */
export function sceneTerrain(layout: SceneLayout): Terrain {
  const surfaces: TerrainSurface[] = [];
  if (layout.ground) surfaces.push(groundSurface(0, 1920));
  for (const p of layout.platforms) {
    switch (p.kind) {
      case 'CARD':
      case 'NODE':
        surfaces.push(...blockSurfaces(p.id, p.rect, 'SUPPORTED_SURFACE', 'SIDE_FACE'));
        break;
      case 'LEDGE':
        surfaces.push(...blockSurfaces(p.id, p.rect, 'LEDGE', 'SIDE_FACE'));
        break;
      case 'PILLAR':
        surfaces.push(...blockSurfaces(p.id, p.rect, 'NON_SUPPORTING', 'SIDE_FACE').filter((s) => s.face !== 'TOP'));
        break;
      case 'FRAME':
        surfaces.push(...blockSurfaces(p.id, p.rect, 'NON_SUPPORTING', 'OPTIONAL_BRACE'));
        break;
    }
  }
  for (const r of layout.routes) {
    r.points.slice(1).forEach((b, i) => {
      const a = r.points[i]!;
      surfaces.push({ id: `${r.id}#${i}`, element: r.id, face: 'LINE', support: 'NON_SUPPORTING', x0: a.x, y0: a.y, x1: b.x, y1: b.y, thicknessPx: 2 });
    });
  }
  return { surfaces, protectedText: [...layout.texts.map((t) => t.rect), EYEBROW_RECT] };
}

/** The terrain a brand segment draws (its ground, if it has one). Brand copy is placed by fixed templates, so it protects no text here. */
export function brandTerrain(ground: { x0: number; x1: number } | null): Terrain {
  return { surfaces: ground ? [groundSurface(ground.x0, ground.x1)] : [], protectedText: [] };
}

/** Every segment's terrain, keyed by segment id: scene segments from their layout, brand segments from their template. */
export function terrainsFor(segments: readonly { id: string; role: string }[], layouts: ReadonlyMap<string, SceneLayout>): Map<string, Terrain> {
  const out = new Map<string, Terrain>();
  for (const seg of segments) {
    const layout = layouts.get(seg.id);
    if (layout) out.set(seg.id, sceneTerrain(layout));
    else if (seg.role in BRAND_GROUND) out.set(seg.id, brandTerrain(BRAND_GROUND[seg.role as keyof typeof BRAND_GROUND]));
  }
  return out;
}

/** A block a body can stand on but never pass through. */
export interface Solid {
  element: string;
  rect: Rect;
}

/**
 * Every solid in a terrain, in declaration order: each element with both side faces (cards, nodes,
 * ledges, pillars, UI captures), and the ground below its line (down to the frame's bottom edge).
 */
export function solidsOf(t: Terrain): Solid[] {
  const out: Solid[] = [];
  const seen = new Set<string>();
  for (const s of t.surfaces) {
    if (seen.has(s.element)) continue;
    seen.add(s.element);
    const left = t.surfaces.find((x) => x.element === s.element && x.face === 'LEFT');
    const right = t.surfaces.find((x) => x.element === s.element && x.face === 'RIGHT');
    if (left && right) {
      const y0 = left.y0 < right.y0 ? left.y0 : right.y0;
      out.push({ element: s.element, rect: { x: left.x0, y: y0, w: right.x0 - left.x0, h: (left.y1 > right.y1 ? left.y1 : right.y1) - y0 } });
    } else if (s.element === 'ground' && s.face === 'TOP') {
      out.push({ element: 'ground', rect: { x: s.x0, y: s.y0, w: s.x1 - s.x0, h: 1080 - s.y0 } });
    }
  }
  return out;
}

/**
 * The point lies within `tol` of the segment a-b. Squares and plain arithmetic only (no hypot), so the
 * Rust/WASM engine's port decides every case the same way, bit for bit.
 */
export function nearSegment(p: Point, a: Point, b: Point, tol: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = p.x - (a.x + dx * t);
  const ey = p.y - (a.y + dy * t);
  return ex * ex + ey * ey <= tol * tol;
}
