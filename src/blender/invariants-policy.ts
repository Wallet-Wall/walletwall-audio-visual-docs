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

/**
 * The lesson's coverage floors, as fractions of the lesson frames a run checked (every visible frame at the stride,
 * which the publication proof receipt re-derives from the plan): the video's own length sets them. The Rive tests'
 * absolute counts (400 grounded frames, 300 scene holds, 300 supported holds at every 9th frame), calibrated on the
 * 145 wpm fixture lesson (about 0.69 / 0.52 / 0.52 of its checked frames), refused the qualified publication narration
 * (153.6 wpm), whose holds are shorter; the owner replaced them with these fractions on 2026-10-22. Later that day the
 * single ending retired the like-and-subscribe and logo slides and cut the end screen to 7 s (55 sampled frames of
 * WalletWallaby standing on brand ground), and the speech came to own the cadence; with the teaching segments' coverage
 * unchanged, the owner set supported holds to 0.45 (the fixture-timed lesson then checks 242 of 497, 48.7%).
 */
export const LESSON_COVERAGE = { 'lesson.grounded': 0.65, 'lesson.sceneHolds': 0.5, 'lesson.supportedHolds': 0.45 } as const;
/** The lab's frames are fixed, so its floors stay counts (at every lab frame). */
const LAB_COVERAGE = { 'lab.unsupportedPerch': 10, 'lab.hang': 2 } as const;

/** How many frames of each kind a run that checked `lessonFrames` lesson frames (and every `labEvery`th lab frame) must have checked. */
export function coverageMinimums(lessonFrames: number, labEvery: number): Record<string, number> {
  const floors: Record<string, number> = {};
  // In whole percent, so a fraction of a frame count is exact (0.65 x 540 is 351, never 351.00000000000006).
  for (const [k, f] of Object.entries(LESSON_COVERAGE)) floors[k] = Math.max(1, Math.ceil((Math.round(f * 100) * lessonFrames) / 100));
  for (const [k, n] of Object.entries(LAB_COVERAGE)) floors[k] = Math.max(1, Math.floor(n / labEvery));
  return floors;
}

/**
 * Every way an invariants report departs from this checkout's bar at the publication stride: another stride, other
 * thresholds, too little coverage, the tail released too often, a failure, or a PASS it did not earn. Empty when the
 * report passed exactly this bar.
 */
export function invariantsBarProblems(report: { every?: unknown; labEvery?: unknown; thresholds?: unknown; counts?: unknown; lessonFrames?: unknown; pass?: unknown; failureCount?: unknown }): string[] {
  const problems: string[] = [];
  const lessonFrames = report.lessonFrames;
  const checked = Array.isArray(lessonFrames) && lessonFrames.length > 0 && lessonFrames.every((f, i) => Number.isSafeInteger(f) && f >= 0 && (i === 0 || f > lessonFrames[i - 1])) ? lessonFrames.length : 0;
  if (checked === 0) problems.push('it does not say which lesson frames it checked (a non-empty, strictly ascending list of frame numbers)');
  if (report.every !== PUBLICATION_STRIDE.every || report.labEvery !== PUBLICATION_STRIDE.labEvery) problems.push(`measured every ${String(report.every)}th lesson frame and every ${String(report.labEvery)}th lab frame, not the publication stride (${PUBLICATION_STRIDE.every}, ${PUBLICATION_STRIDE.labEvery})`);
  const t = (report.thresholds ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(t), ...Object.keys(INVARIANT_THRESHOLDS)]);
  const off = [...keys].filter((k) => t[k] !== (INVARIANT_THRESHOLDS as Record<string, number>)[k]);
  if (off.length > 0) problems.push(`judged against other thresholds than this checkout's (${off.join(', ')})`);
  const counts = (report.counts ?? {}) as Record<string, unknown>;
  const n = (k: string): number => (typeof counts[k] === 'number' ? (counts[k] as number) : 0);
  for (const k of Object.keys(LESSON_COVERAGE)) if (checked > 0 && n(k) > checked) problems.push(`it counts ${n(k)} ${k} frames: more lesson frames than it checked (${checked})`);
  for (const [k, min] of Object.entries(coverageMinimums(checked, PUBLICATION_STRIDE.labEvery))) if (n(k) < min) problems.push(`${k}: ${n(k)} frames checked, at least ${min} needed`);
  if (n('lesson.supportedHolds') > 0 && n('lesson.heldClear') / n('lesson.supportedHolds') >= MAX_TAIL_RELEASE) problems.push(`the tail is released on ${n('lesson.heldClear')} of ${n('lesson.supportedHolds')} supported holds`);
  if (report.pass !== true || report.failureCount !== 0) problems.push(`${String(report.failureCount)} invariant failures`);
  return problems;
}
