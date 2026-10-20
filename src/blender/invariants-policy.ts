// The bar the ported rig invariants are judged against (scripts/blender-invariants.ts, docs/BLENDER.md Ported
// invariants): the thresholds, the coverage minimums, the tail-release limit, and the publication stride, in one place.
// The invariants script applies them; the publication proof receipt and production host qualification check that a
// report was judged against exactly this bar, so a report from a loosened copy of the script fails on a clean
// checkout. Pure.

/** Ported thresholds, as the invariants report records them. */
export const INVARIANT_THRESHOLDS = {
  /** Feet within this many px of their toe and heel targets on grounded frames. */
  footPx: 0.05,
  /** The tail tip at full strength within this many px of its target. */
  tailPx: 0.05,
  /** The tail tip within this many px of the surface while blending. */
  tailBlendPx: 2,
  /** The paw within this many rig px of its target (the lip). */
  pawPx: 3,
  lipPx: 3,
  /** No tail joint bends this far or more. */
  tailJointDeg: 70,
  /** Opaque pixels that are no mix of palette colours, per frame. */
  maxOffHull: 1e-4,
  /** Opaque pixels that are exactly a palette colour, per frame. */
  minExact: 0.3,
} as const;

/** The stride every publication proof and every qualification measures at: every 9th lesson frame, every lab frame. */
export const PUBLICATION_STRIDE = { every: 9, labEvery: 1 } as const;

/** The tail may be released on fewer than this fraction of supported holds. */
export const MAX_TAIL_RELEASE = 0.1;

/** The Rive tests' coverage minimums, scaled to the stride: how many frames of each kind a run must have checked. */
export function coverageMinimums(every: number, labEvery: number): Record<string, number> {
  const scaled = (n: number) => Math.floor((n * 9) / every);
  return {
    'lesson.grounded': Math.max(1, scaled(400)),
    'lesson.supportedHolds': Math.max(1, scaled(300)),
    'lesson.sceneHolds': Math.max(1, scaled(300)),
    'lab.unsupportedPerch': Math.max(1, Math.floor(10 / labEvery)),
    'lab.hang': Math.max(1, Math.floor(2 / labEvery)),
  };
}

/**
 * Every way an invariants report departs from this checkout's bar at the publication stride: another stride, other
 * thresholds, too little coverage, the tail released too often, a failure, or a PASS it did not earn. Empty when the
 * report passed exactly this bar.
 */
export function invariantsBarProblems(report: { every?: unknown; labEvery?: unknown; thresholds?: unknown; counts?: unknown; pass?: unknown; failureCount?: unknown }): string[] {
  const problems: string[] = [];
  if (report.every !== PUBLICATION_STRIDE.every || report.labEvery !== PUBLICATION_STRIDE.labEvery) problems.push(`measured every ${String(report.every)}th lesson frame and every ${String(report.labEvery)}th lab frame, not the publication stride (${PUBLICATION_STRIDE.every}, ${PUBLICATION_STRIDE.labEvery})`);
  const t = (report.thresholds ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(t), ...Object.keys(INVARIANT_THRESHOLDS)]);
  const off = [...keys].filter((k) => t[k] !== (INVARIANT_THRESHOLDS as Record<string, number>)[k]);
  if (off.length > 0) problems.push(`judged against other thresholds than this checkout's (${off.join(', ')})`);
  const counts = (report.counts ?? {}) as Record<string, unknown>;
  const n = (k: string): number => (typeof counts[k] === 'number' ? (counts[k] as number) : 0);
  for (const [k, min] of Object.entries(coverageMinimums(PUBLICATION_STRIDE.every, PUBLICATION_STRIDE.labEvery))) if (n(k) < min) problems.push(`${k}: ${n(k)} frames checked, at least ${min} needed`);
  if (n('lesson.supportedHolds') > 0 && n('lesson.heldClear') / n('lesson.supportedHolds') >= MAX_TAIL_RELEASE) problems.push(`the tail is released on ${n('lesson.heldClear')} of ${n('lesson.supportedHolds')} supported holds`);
  if (report.pass !== true || report.failureCount !== 0) problems.push(`${String(report.failureCount)} invariant failures`);
  return problems;
}
