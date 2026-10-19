// Brand colours on rendered pixels (the ported Rive invariant; scripts/blender-invariants.ts): the character's
// materials emit only palette colours, two flat tones per surface, so every opaque pixel must be a palette colour or a
// mix of palette colours (an antialiased edge, a mortar line's soft rim, a three-way junction). Blender blends in linear
// light and encodes to sRGB afterwards, so mixes are taken in linear light; and by Carathéodory's theorem a mix of any
// number of palette colours is a mix of at most four, so the palette's convex hull is the union of its tetrahedra.
// Isomorphic.

export type Rgb = readonly [number, number, number];

const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const enc = (v: number): number => {
  const c = Math.max(0, Math.min(1, v));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
};

export const hexRgb = (h: string): Rgb => {
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) throw new Error(`${h} is not #RRGGBB`);
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
};

/** All subsets of `xs` with exactly `k` members. */
function subsets<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  return xs.flatMap((x, i) => subsets(xs.slice(i + 1), k - 1).map((s) => [x, ...s]));
}

/** Solve a 3x3 system by Cramer's rule; null when it is singular. */
function solve3(m: number[][], b: number[]): number[] | null {
  const det = (a: number[][]) => a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((v, k) => (k === c ? b[r]! : v)))) / d);
}

export interface PaletteCheck {
  /** Within `tol` sRGB levels of a palette colour. */
  exact: (r: number, g: number, b: number) => boolean;
  /** Within `tol` sRGB levels of a mix of palette colours (in linear light). */
  inHull: (r: number, g: number, b: number) => boolean;
}

export function paletteCheck(palette: readonly Rgb[], tol = 3): PaletteCheck {
  const L = palette.map((p) => p.map(lin));
  const near = (r: number, g: number, b: number, m: readonly number[]) => Math.abs(r - enc(m[0]!)) <= tol && Math.abs(g - enc(m[1]!)) <= tol && Math.abs(b - enc(m[2]!)) <= tol;
  const exact = (r: number, g: number, b: number) => palette.some((p) => Math.abs(r - p[0]) <= tol && Math.abs(g - p[1]) <= tol && Math.abs(b - p[2]) <= tol);
  const segments = subsets(L, 2);
  const tetrahedra = subsets(L, 4);
  const triangles = subsets(L, 3);
  const memo = new Map<number, boolean>();
  const inHull = (r: number, g: number, b: number): boolean => {
    const key = (r << 16) | (g << 8) | b;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const ok = (() => {
      if (exact(r, g, b)) return true;
      const x = [lin(r), lin(g), lin(b)];
      // Inside a tetrahedron (barycentric weights all non-negative): a mix of up to four.
      for (const [a, p, q, s] of tetrahedra) {
        const w = solve3([0, 1, 2].map((k) => [p![k]! - a![k]!, q![k]! - a![k]!, s![k]! - a![k]!]), [0, 1, 2].map((k) => x[k]! - a![k]!));
        if (w && w.every((v) => v >= -1e-6) && w[0]! + w[1]! + w[2]! <= 1 + 1e-6) return true;
      }
      // Otherwise the nearest point of each face and edge, within the tolerance (a hull flattened on a plane or line).
      for (const [a, p, q] of triangles) {
        const u = [0, 1, 2].map((k) => p![k]! - a![k]!);
        const v = [0, 1, 2].map((k) => q![k]! - a![k]!);
        const d = [0, 1, 2].map((k) => x[k]! - a![k]!);
        const dot = (m: number[], n: number[]) => m[0]! * n[0]! + m[1]! * n[1]! + m[2]! * n[2]!;
        const [uu, uv, vv, du, dv] = [dot(u, u), dot(u, v), dot(v, v), dot(d, u), dot(d, v)];
        const den = uu * vv - uv * uv;
        if (Math.abs(den) < 1e-12) continue;
        const s1 = (du * vv - dv * uv) / den;
        const t1 = (dv * uu - du * uv) / den;
        if (s1 >= 0 && t1 >= 0 && s1 + t1 <= 1 && near(r, g, b, [0, 1, 2].map((k) => a![k]! + s1 * u[k]! + t1 * v[k]!))) return true;
      }
      for (const [a, p] of segments) {
        const d = [0, 1, 2].map((k) => p![k]! - a![k]!);
        const l2 = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
        const t = Math.max(0, Math.min(1, ((x[0]! - a![0]!) * d[0]! + (x[1]! - a![1]!) * d[1]! + (x[2]! - a![2]!) * d[2]!) / l2));
        if (near(r, g, b, [0, 1, 2].map((k) => a![k]! + t * d[k]!))) return true;
      }
      return false;
    })();
    memo.set(key, ok);
    return ok;
  };
  return { exact, inHull };
}
