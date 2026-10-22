import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, clipAt, layoutsFor, mouthAt } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby } from '../src/character/walletwallaby/motion.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config, poseNumbers } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const clips = choreograph(timeline, layouts);
const plan = planMotion(clips, layouts);
const wallabyStateAt = (_clips: unknown, ms: number, mouth: Parameters<typeof sampleWallaby>[2] = 'REST') => sampleWallaby(plan, ms, mouth);

describe('WalletWallaby choreography', () => {
  test('clips tile the whole video with no gaps or overlaps', () => {
    assert.equal(clips[0]!.startMs, 0);
    for (let i = 1; i < clips.length; i++) assert.equal(clips[i]!.startMs, clips[i - 1]!.endMs, `gap before clip ${i}`);
    assert.equal(clips[clips.length - 1]!.endMs, timeline.totalMs);
  });

  test('after the hook the guide stays on stage: he hops on from where the hook left him, never re-entering from off-stage', () => {
    const hook = timeline.segments[0]!;
    const question = timeline.segments.find((s) => s.role === 'QUESTION')!;
    assert.equal(question.startMs, hook.endMs, 'nothing sits between the hook and the question');
    assert.ok(!clips.some((c) => c.kind === 'HIDDEN' && c.endMs > hook.endMs && c.startMs < question.contentStartMs), 'no hidden stretch between the hook and the question');
    const lastInHook = [...clips].reverse().find((c) => c.segmentId === hook.id && c.kind !== 'HIDDEN')!;
    const firstMove = clips.find((c) => c.segmentId === question.id && c.kind === 'TRAVEL')!;
    assert.deepEqual(firstMove.from, lastInHook.to, 'the first move in the question starts where the hook left him');
    for (let ms = hook.endMs; ms < question.contentStartMs; ms += 50) assert.equal(wallabyStateAt(clips, ms).visible, true, `on stage at ${ms} ms`);
  });

  test('PUSH_THROUGH ends exactly as its segment ends, fading into the plane', () => {
    const push = clips.find((c) => c.kind === 'PUSH')!;
    const seg = timeline.segments.find((s) => s.id === push.segmentId)!;
    assert.equal(push.endMs, seg.endMs);
    assert.ok(wallabyStateAt(clips, push.endMs - 1).opacity < 0.05);
    const next = timeline.segments[timeline.segments.indexOf(seg) + 1]!;
    assert.equal(next.transitionIn.type, 'DEPTH_ENTER');
    assert.ok(clips.some((c) => c.kind === 'DROP_IN' && c.segmentId === next.id), 'arrives in the depth dimension');
  });

  test('every TRACE beat becomes a traverse along its route', () => {
    const traces = spec.segments.flatMap((s) => s.wallaby.filter((b) => b.action === 'TRACE').map((b) => b.target));
    const traversed = clips.filter((c) => c.kind === 'TRAVERSE').map((c) => c.target);
    assert.deepEqual(traversed, traces);
  });

  test('every sampled frame is finite and inside the frame bounds', () => {
    for (let ms = 0; ms < timeline.totalMs; ms += 40) {
      const s = wallabyStateAt(clips, ms, mouthAt(timeline, ms));
      if (!s.visible) continue;
      for (const v of [s.x, s.y, s.scale, s.opacity, s.gaze.x, s.gaze.y, ...poseNumbers(s.pose)]) assert.ok(Number.isFinite(v), `t=${ms}`);
      assert.ok(s.scale > 0 && s.scale <= 1.2, `t=${ms} scale ${s.scale}`);
      assert.ok(Math.abs(s.gaze.x) <= 1 && Math.abs(s.gaze.y) <= 1);
    }
  });

  test('sampling is a pure function of time', () => {
    for (const ms of [0, 1234, 45678, timeline.totalMs - 1]) assert.deepEqual(wallabyStateAt(clips, ms, 'REST'), wallabyStateAt(clips, ms, 'REST'));
    assert.equal(clipAt(clips, -1), undefined);
  });

  test('the mouth moves only while narration is speaking', () => {
    const line = timeline.segments.find((s) => s.lines.length)!.lines[0]!;
    assert.equal(mouthAt(timeline, line.startMs - 1), 'REST');
    const speaking = new Set<string>();
    for (let ms = line.startMs; ms < line.endMs; ms += 30) speaking.add(mouthAt(timeline, ms));
    assert.ok(speaking.has('OPEN') && speaking.has('SMALL'));
  });
});
