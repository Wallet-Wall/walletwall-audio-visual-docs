// Rig geometry shared by the rig compiler, the per-frame pose solver, and the
// tests: 2D affine matrices (in the layout and composition order the rig was
// authored in), forward kinematics for a bone chain, linear-blend skinning, and
// contour helpers. Pure and isomorphic.

/** Rive Mat2D layout: [xx, xy, yx, yy, tx, ty]; a point maps to (xx·x + yx·y + tx, xy·x + yy·y + ty). */
export type Mat2D = readonly [number, number, number, number, number, number];
export type Vec = readonly [number, number];

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

export function mul(a: Mat2D, b: Mat2D): Mat2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function apply(m: Mat2D, p: Vec): Vec {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function invert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('rig-math: singular transform');
  const inv = 1 / det;
  return [m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv, (m[2] * m[5] - m[3] * m[4]) * inv, (m[1] * m[4] - m[0] * m[5]) * inv];
}

/** Rive's TransformComponent local matrix: translate, then rotate, then scale (T·R·S). */
export function local(x: number, y: number, rotation: number, scaleX = 1, scaleY = 1): Mat2D {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return [c * scaleX, s * scaleX, -s * scaleY, c * scaleY, x, y];
}

/** World rotation (radians) of a matrix's x axis. */
export const angleOf = (m: Mat2D): number => Math.atan2(m[1], m[0]);

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const len = (a: Vec): number => Math.hypot(a[0], a[1]);
export const lerpV = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Wrap an angle to (-π, π]. */
export function wrap(a: number): number {
  let v = a % (2 * Math.PI);
  if (v <= -Math.PI) v += 2 * Math.PI;
  if (v > Math.PI) v -= 2 * Math.PI;
  return v;
}

export const DEG = Math.PI / 180;

/**
 * Rive's linear-blend skinning for one point: Σ wᵢ·(boneWorldᵢ · bindᵢ⁻¹), applied
 * to the point mapped by the skin's bind-time world transform. Weights are the
 * byte weights the file stores (0..255, normalised by 255, as the runtime does).
 */
export function skinPoint(p: Vec, skinWorld: Mat2D, influences: readonly { bone: Mat2D; inverseBind: Mat2D; weight: number }[]): Vec {
  const m = [0, 0, 0, 0, 0, 0];
  for (const inf of influences) {
    if (inf.weight === 0) continue;
    const t = mul(inf.bone, inf.inverseBind);
    const w = inf.weight / 255;
    for (let k = 0; k < 6; k++) m[k]! += t[k]! * w;
  }
  return apply(m as unknown as Mat2D, apply(skinWorld, p));
}

/** A contour point: a position, optionally a sharp corner (no smoothing through it). */
export type ContourPoint = readonly [number, number] | readonly [number, number, 'corner'];

export interface CubicVertexSpec {
  at: Vec;
  /** Incoming and outgoing Bezier handles (absolute positions); equal to `at` at a corner side. */
  inHandle: Vec;
  outHandle: Vec;
}

/**
 * Smooth a polygon into cubic Bezier vertices (uniform Catmull-Rom tangents
 * scaled by `roundness`; 1 = classic Catmull-Rom). Corner points keep zero-length
 * handles, so the outline turns sharply there (ear tips, claws, the nose).
 */
export function smoothContour(points: readonly ContourPoint[], closed: boolean, roundness = 1): CubicVertexSpec[] {
  const n = points.length;
  if (n < 2) throw new Error('rig-math: a contour needs at least two points');
  const pt = (i: number): Vec => {
    const k = closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    const p = points[k]!;
    return [p[0], p[1]];
  };
  return points.map((p, i) => {
    const at: Vec = [p[0], p[1]];
    for (const v of at) if (!Number.isFinite(v)) throw new Error('rig-math: non-finite contour point');
    const corner = p.length === 3 || (!closed && (i === 0 || i === n - 1));
    if (corner) return { at, inHandle: at, outHandle: at };
    const tangent = scale(sub(pt(i + 1), pt(i - 1)), roundness / 6);
    return { at, inHandle: sub(at, tangent), outHandle: add(at, tangent) };
  });
}

/** Sample a cubic Bezier contour (as built by smoothContour) into a polyline, for bounds and tests. */
export function sampleContour(vertices: readonly CubicVertexSpec[], closed: boolean, steps = 8): Vec[] {
  const out: Vec[] = [];
  const segs = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push([
        u * u * u * a.at[0] + 3 * u * u * t * a.outHandle[0] + 3 * u * t * t * b.inHandle[0] + t * t * t * b.at[0],
        u * u * u * a.at[1] + 3 * u * u * t * a.outHandle[1] + 3 * u * t * t * b.inHandle[1] + t * t * t * b.at[1],
      ]);
    }
  }
  if (!closed) out.push(vertices[vertices.length - 1]!.at);
  return out;
}
