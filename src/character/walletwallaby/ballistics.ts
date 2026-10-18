// The closed-form pieces every WalletWallaby move shares: the ballistic arc and
// the motion layer's refusal. Kept apart from ./motion.ts so the route-trace
// planner (./trace.ts) can use them without an import cycle. Isomorphic.

/** Any refusal by the motion layer: invalid config, non-finite input, or a move that cannot fit its window. */
export class MotionPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MotionPlanError';
  }
}

/**
 * Depth parameter c of the parabola y(s) = y0 + (y1 - y0)s - c·s(1 - s), s ∈ [0, 1],
 * whose apex sits h px above the higher endpoint (screen y grows downward).
 */
export function arcDepth(y0: number, y1: number, h: number): number {
  const d = y1 - y0;
  const k = y0 - Math.min(y0, y1) + h;
  return d + 2 * k + 2 * Math.sqrt(k * (k + d));
}
