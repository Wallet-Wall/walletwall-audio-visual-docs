// Geometry of a posed rig: every outline's points in rig space, deformed the
// way the Rive runtime deforms them (rigid parts follow their bone; skinned
// outlines blend their control points across the bone chain, then the Bezier
// is sampled). Used by the bounds checks and the tests; the transforms can come
// from our own FK or from the runtime itself. Pure and isomorphic.

import type { Influences, OutlineModel, RigModel } from './rig-compile.ts';
import { apply, invert, mul, sampleContour, skinPoint, type CubicVertexSpec, type Mat2D, type Vec } from './rig-math.ts';
import type { RigBone, RigControl } from './rig-source.ts';

export interface PosedTransforms {
  bones: Record<RigBone, Mat2D>;
  controls: Record<RigControl, Mat2D>;
}

/** Rig space -> artboard space at bind time (the root node's translation). */
const toArtboard = (model: RigModel): Mat2D => [1, 0, 0, 1, model.origin[0], model.origin[1]];

function skin(model: RigModel, t: PosedTransforms, p: Vec, infl: Influences): Vec {
  const art = toArtboard(model);
  const back = invert(art);
  const influences = infl.map((f) => ({ bone: mul(art, t.bones[f.bone]), inverseBind: invert(mul(art, model.bones[f.bone].restWorld)), weight: f.weight }));
  return apply(back, skinPoint(p, art, influences));
}

/** One outline's sampled points in rig space for the given pose. */
export function outlinePoints(model: RigModel, outline: OutlineModel, t: PosedTransforms, steps = 6): Vec[] {
  let verts: CubicVertexSpec[];
  if (outline.skinned) {
    verts = outline.vertices.map((v) => ({ at: skin(model, t, v.at, v.skin!.at), inHandle: skin(model, t, v.inHandle, v.skin!.inHandle), outHandle: skin(model, t, v.outHandle, v.skin!.outHandle) }));
  } else {
    const m: Mat2D = outline.attach === 'root' ? [1, 0, 0, 1, 0, 0] : ((t.bones as Record<string, Mat2D>)[outline.attach] ?? (t.controls as Record<string, Mat2D>)[outline.attach])!;
    verts = outline.vertices.map((v) => ({ at: apply(m, v.at), inHandle: apply(m, v.inHandle), outHandle: apply(m, v.outHandle) }));
  }
  return sampleContour(verts, outline.closed, steps);
}

export interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The ink extent of a posed rig (outline strokes included), optionally only some shapes. */
export function poseExtent(model: RigModel, t: PosedTransforms, filter: (shape: string) => boolean = () => true): Extent {
  const e: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const o of model.outlines) {
    if (!filter(o.shape) || o.shape === 'shadow') continue;
    for (const [x, y] of outlinePoints(model, o, t)) {
      e.minX = Math.min(e.minX, x - o.inkPad);
      e.maxX = Math.max(e.maxX, x + o.inkPad);
      e.minY = Math.min(e.minY, y - o.inkPad);
      e.maxY = Math.max(e.maxY, y + o.inkPad);
    }
  }
  return e;
}
