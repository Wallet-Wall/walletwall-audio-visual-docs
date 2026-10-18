// The visible rock of a dedicated support in the flat teaching scenes.
//
// A formation is cut inside the declared rectangle of its support: layers from the
// top down, each its own thickness, colour, and slanted ends, so the support reads as
// sandstone strata (the same grammar as the depth views, src/blender/visual-core.ts).
// The cut only ever removes visible rock from that rectangle. Two things never move:
//
//   - the TOP edge: the first layer's top is the rectangle's top, flush, at exactly
//     the declared y (the surface feet land on, src/layout/terrain.ts);
//   - the CONTACT faces: within `contactZonePx` of the top (where a hand may brace or
//     grip the lip) a side stays within `sideJitterPx` of the declared face. Below
//     that zone the visible side may taper, because nothing touches it.
//
// Every choice is a hash of the support's own id, so the same support is the same rock
// in every frame and every render, and nothing is random. Pure and isomorphic: no
// Node built-ins, so the render bundle can use it.

import type { Rect } from './geometry.ts';

/** How one kind of formation is cut. */
export interface RockKindParams {
  capPx: number;
  bandPx: [number, number];
  /** How far a side may stray from the declared face (px), within the contact zone below the top. */
  sideJitterPx: number;
  /** How far the visible side may recede below the contact zone (px, at the bottom). */
  taperPx: number;
  /** The stretch below the top where a hand may brace: the side stays within sideJitterPx of the declared face. */
  contactZonePx: number;
  /** How far the lower edge may break upward (px); 0 keeps it flush. */
  fractureMaxPx: number;
}

/** One stratum: y offsets below the rectangle's top, and the x inset of each end at its upper and lower edge. */
export interface RockLayer {
  top: number;
  bottom: number;
  /** An index into the strata palette, or -1 for the cap stone. */
  layer: number;
  cap: boolean;
  left: { top: number; bottom: number };
  right: { top: number; bottom: number };
}

/** The whole formation: its strata, and (when its lower edge breaks) the broken edge as [x offset, y offset] points. */
export interface Rock {
  layers: RockLayer[];
  /** Left to right across the rectangle, y offsets from its top (the unbroken bottom is rect.h). Empty when the edge is flush. */
  lowerEdge: [number, number][];
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic number in [0, 1) from ids: FNV-1a into one mulberry32 step. The only variation a formation has. */
export function unit(...parts: (string | number)[]): number {
  let a = (hash32(parts.join(':')) + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const lerp = (r: [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;

/** The strata of one support, top down. `key` is the support's own id; `seed` and `layerCount` come from the shared palette. */
export function rockLayers(rect: Rect, key: string, p: RockKindParams, layerCount: number, seed: string): Rock {
  const h = rect.h;
  const zone = Math.min(p.contactZonePx, h);
  const inset = (y: number, side: 'l' | 'r', edge: 't' | 'b', idx: number, flushTop: boolean): number => {
    // Within the contact zone a side strays only by its jitter; below it, it also recedes (taper), growing to taperPx at the bottom.
    const jitter = flushTop && edge === 't' ? 0 : p.sideJitterPx * unit(seed, key, idx, side, edge);
    const taper = h > zone ? p.taperPx * Math.min(1, Math.max(0, y - zone) / (h - zone)) : 0;
    return jitter + taper;
  };
  const make = (top: number, bottom: number, layer: number, cap: boolean, idx: number): RockLayer => ({
    top,
    bottom,
    layer,
    cap,
    left: { top: inset(top, 'l', 't', idx, cap), bottom: inset(bottom, 'l', 'b', idx, false) },
    right: { top: inset(top, 'r', 't', idx, cap), bottom: inset(bottom, 'r', 'b', idx, false) },
  });

  const layers: RockLayer[] = [];
  let cursor = 0;
  let idx = 0;
  if (p.capPx > 0 && h > 0) {
    const cap = Math.min(p.capPx, h);
    layers.push(make(0, cap, -1, true, idx++));
    cursor = cap;
  }
  let prev = -1;
  while (cursor < h - 1e-6) {
    let bottom = cursor + lerp(p.bandPx, unit(seed, key, idx, 'band'));
    if (h - bottom < p.bandPx[0]) bottom = h;
    // A layer never straddles the edge of the contact zone: its side is straight, so it must be wholly inside or wholly outside.
    if (cursor < zone && bottom > zone) bottom = zone;
    bottom = Math.min(bottom, h);
    let layer = Math.floor(unit(seed, key, idx, 'layer') * layerCount) % layerCount;
    if (layer === prev) layer = (layer + 1) % layerCount;
    prev = layer;
    layers.push(make(cursor, bottom, layer, false, idx++));
    cursor = bottom;
  }

  const lowerEdge: [number, number][] = [];
  if (p.fractureMaxPx > 0 && layers.length > 0) {
    const STEP = 24;
    const n = Math.max(2, Math.ceil(rect.w / STEP));
    const last = layers[layers.length - 1]!;
    for (let k = 0; k <= n; k++) {
      const x = (rect.w * k) / n;
      // Never breaks above the last layer's own top: the edge stays inside the layer it belongs to.
      const dy = Math.min(p.fractureMaxPx * unit(seed, key, 'lower', k), Math.max(0, last.bottom - last.top - 1));
      lowerEdge.push([x, h - dy]);
    }
  }
  return { layers, lowerEdge };
}

/** x of a layer's end at one of its edges, in the rectangle's own frame (0 = the declared left face, rect.w = the right). */
export const leftX = (layer: RockLayer, edge: 'top' | 'bottom'): number => layer.left[edge];
export const rightX = (rect: Rect, layer: RockLayer, edge: 'top' | 'bottom'): number => rect.w - layer.right[edge];
