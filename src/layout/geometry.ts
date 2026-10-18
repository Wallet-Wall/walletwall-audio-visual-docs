// Frame geometry for 1920x1080 YouTube delivery. Isomorphic.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FRAME = { width: 1920, height: 1080 } as const;

/** Broadcast title-safe area (90%): important text and marks stay inside. */
export const TITLE_SAFE: Rect = { x: 96, y: 54, w: 1728, h: 972 };

/**
 * Teaching content stays above this line so YouTube's player chrome and its own
 * caption overlay never cover it. The band below holds only the provenance chip.
 */
export const CONTENT_BOTTOM = 900;

/** The terrain baseline WalletWallaby walks on between platforms. */
export const GROUND_Y = 880;

export function inside(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Smooth, deterministic ease (cubic in-out). */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

export function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}
