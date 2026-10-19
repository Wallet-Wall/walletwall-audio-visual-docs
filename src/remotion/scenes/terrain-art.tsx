// The terrain family in the flat scenes: sandstone strata under the dedicated supports.
//
// Only physical support geometry is cut as rock: the ground a scene stands on, the summit
// ledge, the pillars under tier nodes, and the layered slabs. A card or node is content and
// stays a card (parchment, text, a fine edge). The cut is src/layout/rock.ts: the top edge
// stays on the declared y, and within the contact zone a side stays within a few px of the
// declared face. Colours are the same strata, cap stone, and charcoal edge the depth views
// use, with the same two tones (a lit face, a shaded lower stretch).

import React from 'react';
import { TOKENS } from '../../brand/tokens.ts';
import { GROUND_Y, type Rect } from '../../layout/geometry.ts';
import { rockLayers, unit, type Rock, type RockKindParams } from '../../layout/rock.ts';
import type { Slab } from '../../layout/scene-layout.ts';
import { rectStyle } from '../style.ts';
import { useMaterial } from '../material.tsx';

const EDGE_PX = 1.5;
const EDGE_OPACITY = 0.55;
/** The lowest share of each stratum drawn in its shade tone: the flat answer to the depth views' two-tone light. */
const SHADE_SHARE = 0.3;

type Kind = 'ground' | 'pillar' | 'ledge';

const pts = (ps: [number, number][]): string => ps.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function polygons(rock: Rock, rect: Rect): { points: [number, number][]; shade: [number, number][]; layer: number; cap: boolean }[] {
  const out: { points: [number, number][]; shade: [number, number][]; layer: number; cap: boolean }[] = [];
  rock.layers.forEach((l, i) => {
    const lx = (e: 'top' | 'bottom'): number => l.left[e];
    const rx = (e: 'top' | 'bottom'): number => rect.w - l.right[e];
    const isLast = i === rock.layers.length - 1;
    // The lowest layer's lower edge may be the broken edge; its end x's follow the layer's slant down to the unbroken bottom.
    const bottomLeft: [number, number] = [lx('bottom'), l.bottom];
    const bottomRight: [number, number] = [rx('bottom'), l.bottom];
    let lower: [number, number][] = [bottomRight, bottomLeft];
    if (isLast && rock.lowerEdge.length > 0) {
      const edge = rock.lowerEdge.map(([x, y]): [number, number] => [Math.min(Math.max(x, lx('bottom')), rx('bottom')), y]);
      lower = [...edge].reverse();
    }
    const points: [number, number][] = [[lx('top'), l.top], [rx('top'), l.top], ...lower];
    // The shade stretch: the lower share of the layer, between the two ends' own slanted lines.
    const hh = l.bottom - l.top;
    const sy = l.bottom - hh * SHADE_SHARE;
    const at = (side: 'l' | 'r', y: number): number => {
      const f = hh === 0 ? 0 : (y - l.top) / hh;
      return side === 'l' ? lx('top') + (lx('bottom') - lx('top')) * f : rx('top') + (rx('bottom') - rx('top')) * f;
    };
    const shade: [number, number][] = [[at('l', sy), sy], [at('r', sy), sy], ...lower];
    out.push({ points, shade, layer: l.layer, cap: l.cap });
  });
  return out;
}

/** A formation cut inside `rect`, keyed by the support's own id. `extraLeft`/`extraRight` overscan an end that sits on the frame edge, so its taper is off screen. */
export const RockMass: React.FC<{ kind: Kind; id: string; rect: Rect; params: RockKindParams; extraLeft?: number; extraRight?: number; style?: React.CSSProperties }> = ({ kind, id, rect, params, extraLeft = 0, extraRight = 0, style }) => {
  const m = useMaterial();
  const s = m.terrain.strata;
  const wide: Rect = { x: rect.x - extraLeft, y: rect.y, w: rect.w + extraLeft + extraRight, h: rect.h };
  // The key is the support's id, not its position or the frame: the same support is the same rock everywhere.
  const rock = rockLayers(wide, `${kind}:${id}`, params, s.layers.length, s.seed);
  return (
    <svg style={{ ...rectStyle(wide), overflow: 'visible', ...style }} width={wide.w} height={wide.h} viewBox={`0 0 ${wide.w} ${wide.h}`}>
      {polygons(rock, wide).map((poly, i) => {
        const lit = poly.cap ? m.terrain.top : s.layers[poly.layer]!.lit;
        const shade = poly.cap ? m.terrain.topShade : s.layers[poly.layer]!.shade;
        return (
          <g key={i}>
            <polygon points={pts(poly.points)} fill={lit} />
            <polygon points={pts(poly.shade)} fill={shade} />
            <polygon points={pts(poly.points)} fill="none" stroke={m.terrain.edge} strokeOpacity={EDGE_OPACITY} strokeWidth={EDGE_PX} strokeLinejoin="round" />
          </g>
        );
      })}
    </svg>
  );
};

/**
 * The ground a scene stands on: sandstone strata under the ground line, edge to edge unless a template draws only a stretch
 * of it. The line itself stays exactly where it was (GROUND_Y, one px, the surface feet land on); the rock lies under it.
 */
export const Ground: React.FC<{ x0?: number; x1?: number }> = ({ x0 = 0, x1 = 1920 }) => {
  const m = useMaterial();
  const g = m.flat.ground;
  // A stretch that ends on the frame edge overscans so its end's taper is off screen; a stretch that ends inside the frame keeps its slanted end.
  const extraLeft = x0 <= 0 ? g.taperPx : 0;
  const extraRight = x1 >= 1920 ? g.taperPx : 0;
  return (
    <>
      <RockMass kind="ground" id={`ground:${x0}-${x1}`} rect={{ x: x0, y: GROUND_Y, w: x1 - x0, h: g.depthPx }} params={g} extraLeft={extraLeft} extraRight={extraRight} />
      <div style={{ position: 'absolute', left: x0, top: GROUND_Y, width: x1 - x0, height: 1, background: TOKENS.charcoalRail }} />
    </>
  );
};

/** Pillars and the summit ledge: a dedicated support cut as strata (the declared top and faces stay on the rectangle). */
export const Formation: React.FC<{ kind: 'pillar' | 'ledge'; id: string; rect: Rect }> = ({ kind, id, rect }) => {
  const m = useMaterial();
  return <RockMass kind={kind} id={id} rect={rect} params={m.flat[kind]} />;
};

/** A layered scene's slab: the same strata as bands across the plane, in the perspective of its own edges. Decorative, behind every card. */
export const RockSlab: React.FC<{ slab: Slab }> = ({ slab }) => {
  const m = useMaterial();
  const s = m.terrain.strata;
  const [tl, tr, br, bl] = slab.corners;
  const fractions = [0, ...m.flat.slab.fractions, 1];
  const opacity = slab.id === 'upper' ? m.flat.slab.opacity.upper : m.flat.slab.opacity.lower;
  const mixPt = (a: { x: number; y: number }, b: { x: number; y: number }, f: number): [number, number] => [a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f];
  let prev = -1;
  return (
    <g>
      {fractions.slice(0, -1).map((f0, i) => {
        const f1 = fractions[i + 1]!;
        let layer = Math.floor(unit('walletwall.slab/v1', `slab:${slab.id}`, i) * s.layers.length) % s.layers.length;
        if (layer === prev) layer = (layer + 1) % s.layers.length;
        prev = layer;
        const a = mixPt(tl, bl, f0);
        const b = mixPt(tr, br, f0);
        const c = mixPt(tr, br, f1);
        const d = mixPt(tl, bl, f1);
        const sh = mixPt(tl, bl, f1 - (f1 - f0) * SHADE_SHARE);
        const sh2 = mixPt(tr, br, f1 - (f1 - f0) * SHADE_SHARE);
        return (
          <g key={i} fillOpacity={opacity}>
            <polygon points={pts([a, b, c, d])} fill={s.layers[layer]!.lit} />
            <polygon points={pts([sh, sh2, c, d])} fill={s.layers[layer]!.shade} />
            <polygon points={pts([a, b, c, d])} fill="none" stroke={m.terrain.edge} strokeOpacity={0.2} strokeWidth={1} />
          </g>
        );
      })}
    </g>
  );
};
