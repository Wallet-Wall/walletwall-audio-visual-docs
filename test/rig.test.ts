// WalletWallaby's rig contract, renderer-neutral: the skeleton, controls, IK, and clips compile deterministically
// and completely; pose authoring and the per-frame controls refuse anything outside the hard limits; every frame's
// pose is a pure function of the frame (shuffled evaluation is bit-identical, with a positive control); and every
// pose clip is reachable. What the Rive runtime proved on its own transforms (planted feet, the tail's rest and
// release, the paws on a lip, the envelope, protected text) is proved on the frames Blender renders:
// npm run blender:invariants (scripts/blender-invariants.ts).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { resolvePose } from '../src/character/walletwallaby/blender/pose-resolve.ts';
import { choreograph, layoutsFor, mouthAt } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby, type MotionPlan } from '../src/character/walletwallaby/motion.ts';
import { FAMILY_COLORS, RIG_PALETTE } from '../src/character/walletwallaby/rig.ts';
import { checkClipMix, finalizePose, RigPoseError } from '../src/character/walletwallaby/rig/rig-apply.ts';
import { compileRig, poseValues, RigCompileError, slotColor } from '../src/character/walletwallaby/rig/rig-compile.ts';
import { rigControls, type RigControls } from '../src/character/walletwallaby/rig/rig-controls.ts';
import { POSE_CLIPS, RIG_BONES, RIG_CLIPS, RIG_CONTROLS, RIG_IKS } from '../src/character/walletwallaby/rig/rig-source.ts';
import { labPlan, LAB_DURATION_MS } from '../src/remotion/review/motion-lab-scene.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const plan = planMotion(choreograph(timeline, layouts), layouts);
const FRAME_MS = 1000 / timeline.fps;
/** Every 9th frame of the committed video, and every frame of the motion lab. */
const videoFrames = Array.from({ length: Math.floor(timeline.totalMs / FRAME_MS) }, (_, i) => i * FRAME_MS).filter((_, i) => i % 9 === 0);
const lab = labPlan();
const labFrames = Array.from({ length: Math.floor(LAB_DURATION_MS / FRAME_MS) }, (_, i) => i * FRAME_MS);
const state = (p: MotionPlan, ms: number) => sampleWallaby(p, ms, p === lab ? 'REST' : mouthAt(timeline, ms));
const { model } = compileRig();

/** Deterministic shuffle (LCG), so the order differs from timeline order but the test is reproducible. */
function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  let seed = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('rig contract', () => {
  test('compiles deterministically, with every bone, control, IK chain, and clip the contract names', () => {
    assert.deepEqual(compileRig().model, model);
    for (const b of RIG_BONES) assert.ok(model.bones[b], b);
    for (const c of RIG_CONTROLS) assert.ok(model.controls[c], c);
    for (const k of RIG_IKS) assert.ok(model.iks[k], k);
    for (const clip of RIG_CLIPS) assert.ok(model.clips[clip], clip);
  });

  test('the coat is WalletWallrus\'s coat, resolved from the mascot family (never typed)', () => {
    assert.equal(RIG_PALETTE.fur, 'wallrusCoat');
    assert.equal(slotColor('fur'), FAMILY_COLORS.wallrusCoat);
    assert.equal(slotColor('fur'), '#BA6F38');
  });

  test('pose authoring refuses non-finite deltas, unknown bones, and out-of-range IK strengths (positive controls)', () => {
    assert.throws(() => poseValues({ bones: { hip: Number.NaN } }, model.bones, model.controls), RigCompileError);
    assert.throws(() => poseValues({ bones: { wing: 3 } as never }, model.bones, model.controls), RigCompileError);
    assert.throws(() => poseValues({ ik: { legs: 1.5 } }, model.bones, model.controls), RigCompileError);
    assert.doesNotThrow(() => poseValues({ bones: { hip: 3 }, ik: { legs: 0.5 } }, model.bones, model.controls), 'control');
  });
});

describe('frame-pure posing', () => {
  test('every frame poses within the hard limits; weights, times, and values are in range', () => {
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) {
      for (const ms of frames) {
        const s = state(p, ms);
        if (!s.visible) continue;
        const c = rigControls(s);
        checkClipMix(c.clips);
        for (const k of c.clips) {
          const clip = model.clips[k.clip];
          assert.ok(k.timeS >= 0 && (clip.loop || k.timeS <= clip.durationS + 1e-9), `${k.clip} time ${k.timeS}`);
        }
        // Resolving runs every hard-limit and finiteness check; it must not throw on any real frame.
        const pose = resolvePose(model, c);
        for (const b of RIG_BONES) assert.ok(Number.isFinite(pose.rot[b]), `${b} at t=${Math.round(ms)}`);
      }
    }
  });

  test('the same motion input gives the same rig controls', () => {
    const again = planMotion(choreograph(timeline, layouts), layouts);
    for (const ms of videoFrames.filter((_, i) => i % 5 === 0)) assert.deepEqual(rigControls(state(plan, ms)), rigControls(state(again, ms)));
  });

  test('every frame is posed fresh: shuffled evaluation reproduces timeline order bit for bit', () => {
    const snap = (ms: number): string => {
      const s = state(plan, ms);
      return s.visible ? JSON.stringify(resolvePose(model, rigControls(s))) : 'hidden';
    };
    const inOrder = new Map(videoFrames.map((ms) => [ms, snap(ms)]));
    for (const ms of shuffled(videoFrames)) assert.equal(snap(ms), inOrder.get(ms), `t=${Math.round(ms)}`);
    // Positive control: the comparison catches a 0.01 degree change in a single frame.
    const c = rigControls(state(plan, 30_000));
    const at = (pitch: number) => JSON.stringify(resolvePose(model, { ...c, body: { ...c.body, pitchDeg: c.body.pitchDeg + pitch } }));
    assert.equal(at(0), at(0));
    assert.notEqual(at(0.01), at(0), 'bit-level comparison is sensitive');
  });

  test('adversarial controls are refused before anything reaches a renderer (positive controls)', () => {
    const good = rigControls(state(plan, 30_000));
    const rest = { rot: Object.fromEntries(RIG_BONES.map((b) => [b, model.bones[b].restRotation])) as never, hipX: -20, hipY: -78, stance: -9, heel: 0, gazeX: 0, gazeY: 0, lid: 0, brow: 0 };
    const variants: [string, (c: RigControls) => RigControls][] = [
      ['NaN pitch', (c) => ({ ...c, body: { ...c.body, pitchDeg: Number.NaN } })],
      ['Infinite hip drop', (c) => ({ ...c, body: { ...c.body, dy: Number.POSITIVE_INFINITY } })],
      ['pitch past its limit', (c) => ({ ...c, body: { ...c.body, pitchDeg: 80 } })],
      ['tail swing past its limit', (c) => ({ ...c, tail: { ...c.tail, deg: [90, 0, 0, 0, 0] } })],
      ['tail tension above 1', (c) => ({ ...c, tail: { ...c.tail, tension: 1.5 } })],
      ['missing tail bone', (c) => ({ ...c, tail: { ...c.tail, deg: [0, 0, 0, 0] } })],
      ['grip across the frame', (c) => ({ ...c, grip: [900, -40] })],
      ['point amount above 1', (c) => ({ ...c, point: { target: [80, -150], amount: 2 } })],
      ['inverted support span', (c) => ({ ...c, support: { minX: 10, maxX: -10 } })],
      ['lid past closed', (c) => ({ ...c, face: { ...c.face, lid: 1.4 } })],
    ];
    for (const [name, mutate] of variants) assert.throws(() => finalizePose(model, rest, mutate(structuredClone(good))), RigPoseError, name);
    const mixes: [string, RigControls['clips']][] = [
      ['weights not summing to 1', good.clips.map((k) => ({ ...k, weight: k.weight * 0.9 }))],
      ['negative weight', [{ clip: 'idle_alert', weight: 1.5, timeS: 0 }, { clip: 'perch', weight: -0.5, timeS: 0 }]],
      ['unknown clip', [{ clip: 'moonwalk' as never, weight: 1, timeS: 0 }]],
      ['control clip as a pose', [{ clip: 'tail_free' as never, weight: 1, timeS: 0 }]],
      ['duplicate clip', [{ clip: 'perch', weight: 0.5, timeS: 0 }, { clip: 'perch', weight: 0.5, timeS: 0 }]],
      ['negative clip time', [{ clip: 'idle_alert', weight: 1, timeS: -1 }]],
    ];
    for (const [name, clips] of mixes) assert.throws(() => checkClipMix(clips), RigPoseError, name);
    assert.doesNotThrow(() => resolvePose(model, good), 'control: the real controls pose');
    assert.doesNotThrow(() => checkClipMix(good.clips), 'control: the real clip mix');
  });

  test('every pose clip is reachable from the motion vocabulary or a transient', () => {
    const used = new Set<string>();
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) for (const ms of frames) for (const k of Object.keys(state(p, ms).pose.mix)) used.add(k);
    for (const clip of POSE_CLIPS) assert.ok(used.has(clip), `${clip} is never used`);
  });
});
