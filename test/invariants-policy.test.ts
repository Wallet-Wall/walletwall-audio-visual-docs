// The invariants bar's coverage floors (src/blender/invariants-policy.ts). The lesson's floors are fractions of the
// lesson frames a run checked (every visible frame at the publication stride, which the publication proof receipt
// re-derives from the plan), so a video's own length sets them: the Rive-era absolute counts (400 grounded, 300 scene
// holds, 300 supported holds at every 9th frame) were calibrated on the 145 wpm fixture lesson and refused the
// qualified publication narration (153.6 wpm), whose holds are shorter. Owner decision, 2026-10-22: 0.65 / 0.5 / 0.5.
// The lab's floors stay counts, and every threshold is unchanged.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { coverageMinimums, INVARIANT_THRESHOLDS, invariantsBarProblems, LESSON_COVERAGE, PUBLICATION_STRIDE } from '../src/blender/invariants-policy.ts';

const stride = (n: number): number[] => Array.from({ length: n }, (_, i) => i * PUBLICATION_STRIDE.every);
/** A passing report at the publication stride, with `lessonFrames` checked lesson frames and these counts. */
const report = (lessonFrames: number[] | undefined, counts: Record<string, number>) => ({
  every: PUBLICATION_STRIDE.every,
  labEvery: PUBLICATION_STRIDE.labEvery,
  thresholds: { ...INVARIANT_THRESHOLDS },
  counts: { 'lab.grounded': 152, 'lab.hang': 3, 'lab.unsupportedPerch': 48, ...counts },
  ...(lessonFrames ? { lessonFrames } : {}),
  pass: true,
  failureCount: 0,
});
/** The real publication narration run (2026-10-22): 540 checked lesson frames. */
const PUBLICATION = { 'lesson.grounded': 501, 'lesson.sceneHolds': 381, 'lesson.supportedHolds': 287, 'lesson.heldClear': 2 };

describe('the invariants coverage floors', () => {
  test('the lesson floors are the owner-approved fractions of the lesson frames checked; the lab floors stay counts', () => {
    assert.deepEqual(LESSON_COVERAGE, { 'lesson.grounded': 0.65, 'lesson.sceneHolds': 0.5, 'lesson.supportedHolds': 0.5 });
    assert.deepEqual(coverageMinimums(540, 1), { 'lesson.grounded': 351, 'lesson.sceneHolds': 270, 'lesson.supportedHolds': 270, 'lab.unsupportedPerch': 10, 'lab.hang': 2 });
    assert.deepEqual(coverageMinimums(578, 1), { 'lesson.grounded': 376, 'lesson.sceneHolds': 289, 'lesson.supportedHolds': 289, 'lab.unsupportedPerch': 10, 'lab.hang': 2 });
    // A fraction is a floor: a count just below it fails, never rounded in its favour.
    assert.equal(coverageMinimums(541, 1)['lesson.supportedHolds'], 271);
    for (const v of Object.values(coverageMinimums(1, 1))) assert.ok(v >= 1);
  });

  test('the qualified publication narration\'s coverage passes; the Rive-era absolute floor refused it', () => {
    assert.deepEqual(invariantsBarProblems(report(stride(540), PUBLICATION)), []);
    assert.ok(PUBLICATION['lesson.supportedHolds'] < 300, 'control: the absolute floor (300) refused this run');
  });

  test('positive controls: too little of any kind is refused, at the floor and one below it', () => {
    for (const [k, min] of Object.entries(coverageMinimums(540, 1))) {
      if (!k.startsWith('lesson.')) continue;
      assert.deepEqual(invariantsBarProblems(report(stride(540), { ...PUBLICATION, [k]: min })), [], `${k} at its floor passes`);
      assert.ok(invariantsBarProblems(report(stride(540), { ...PUBLICATION, [k]: min - 1 })).some((p) => p.startsWith(`${k}: ${min - 1} frames checked`)), `${k} one below its floor is refused`);
    }
    assert.ok(invariantsBarProblems(report(stride(540), { ...PUBLICATION, 'lab.hang': 1 })).some((p) => p.startsWith('lab.hang')));
  });

  test('a report that does not say which lesson frames it checked, or counts more of a kind than it checked, is refused', () => {
    assert.ok(invariantsBarProblems(report(undefined, PUBLICATION)).some((p) => /which lesson frames/.test(p)));
    assert.ok(invariantsBarProblems(report([], PUBLICATION)).some((p) => /which lesson frames/.test(p)));
    assert.ok(invariantsBarProblems(report([0, 9, 9.5], PUBLICATION)).some((p) => /which lesson frames/.test(p)));
    // A report that counts more frames of a kind than it names as checked is refused. (Fewer frames named with
    // consistent counts passes this bar alone: the receipt and qualification hold the frames to the plan's own.)
    assert.ok(invariantsBarProblems(report(stride(300), PUBLICATION)).some((p) => /more lesson frames than it checked/.test(p)));
  });
});
