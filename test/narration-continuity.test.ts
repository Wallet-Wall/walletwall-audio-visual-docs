// Speech owns conversational rhythm (docs/ARCHITECTURE.md, "Timing"): every silence between two narration lines is
// authored language (the sentence pause, the section pause, a line's explicit pauseAfterMs), never the length of a
// transition, a slide, a landing, or a settle. Visual choreography adapts around the speech: a transition may run under
// a line that has already started, and nothing visual begins before its scene is on screen.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { MAX_INTRA_SENTENCE_PAUSE_MS, narrationCadence } from '../src/timeline/continuity.ts';
import { buildTimeline, TIMING, type Timeline, type Timing } from '../src/timeline/timeline.ts';
import type { VideoSpec } from '../src/spec/types.ts';
import { clone, codes, committedSpec, config, segment, validate } from './helpers.ts';

const spec = committedSpec();
const track = estimateTrack(spec, config.voice, config.lexicon);
const timeline = buildTimeline(spec, track, config.templates);

/** Consecutive narration lines and the silence between them, in speaking order. */
function gaps(t: Timeline): { from: string; to: string; ms: number; boundary: boolean }[] {
  const out: { from: string; to: string; ms: number; boundary: boolean }[] = [];
  let prev: { id: string; endMs: number; seg: string } | null = null;
  for (const s of t.segments) {
    for (const l of s.lines) {
      if (prev) out.push({ from: prev.id, to: l.id, ms: l.startMs - prev.endMs, boundary: prev.seg !== s.id });
      prev = { id: l.id, endMs: l.endMs, seg: s.id };
    }
  }
  return out;
}

/** A spec whose question opens with one sentence spoken as two lines (a clause break inside a sentence). */
function splitSentenceSpec(pauseAfterMs?: number): VideoSpec {
  const s = clone(spec);
  const q = segment(s, 'question');
  const first = q.narration[0]!;
  assert.match(first.text, /^Migration Readiness is the recommend step in WalletWall's workflow\.$/);
  q.narration.splice(0, 1, { ...first, id: 'question.l1a', text: 'Migration Readiness is the recommend step', ...(pauseAfterMs ? { pauseAfterMs } : {}) }, { ...first, id: 'question.l1b', text: "in WalletWall's workflow." });
  for (const b of q.wallaby) if (b.cue === first.id) b.cue = 'question.l1a';
  return s;
}

describe('speech owns cadence', () => {
  test('the committed lesson: every pause between lines is the authored sentence or section pause, never a transition', () => {
    assert.deepEqual(narrationCadence(spec, timeline), []);
    const all = gaps(timeline);
    assert.ok(all.length > 20);
    for (const g of all) assert.equal(g.ms, g.boundary ? TIMING.sectionPauseMs : TIMING.linePauseMs, `${g.from} -> ${g.to}`);
    assert.ok(TIMING.sectionPauseMs <= MAX_INTRA_SENTENCE_PAUSE_MS, 'even a section pause is a breath, not a wait');
  });

  test('rejects an animation-driven pause of more than 0.8 s inside a sentence (positive control)', () => {
    const s = splitSentenceSpec();
    const t = buildTimeline(s, estimateTrack(s, config.voice, config.lexicon), config.templates);
    assert.deepEqual(narrationCadence(s, t), [], 'the split sentence keeps the sentence cadence on its own');
    // A visual that delayed the second clause by a landing's worth of time: the same lines, the clause start pushed late.
    const delayed = clone(t);
    const q = delayed.segments.find((x) => x.id === 'question')!;
    const b = q.lines.find((l) => l.id === 'question.l1b')!;
    const shift = MAX_INTRA_SENTENCE_PAUSE_MS + 400 - TIMING.linePauseMs;
    b.startMs += shift;
    b.endMs += shift;
    const problems = narrationCadence(s, delayed);
    assert.ok(problems.some((p) => p.code === 'INTRA_SENTENCE_PAUSE' && p.to === 'question.l1b'), JSON.stringify(problems));
    assert.ok(problems.some((p) => p.code === 'UNAUTHORED_SILENCE' && p.to === 'question.l1b'));
    // The same delay at a sentence boundary is still unauthored silence, though not inside a sentence.
    const atBoundary = clone(timeline);
    const l2 = atBoundary.segments.find((x) => x.id === 'question')!.lines[1]!;
    l2.startMs += shift;
    l2.endMs += shift;
    const boundary = narrationCadence(spec, atBoundary);
    assert.ok(boundary.some((p) => p.code === 'UNAUTHORED_SILENCE' && p.to === l2.id));
    assert.ok(!boundary.some((p) => p.code === 'INTRA_SENTENCE_PAUSE'));
  });

  test('a silent content segment between two lines is unauthored silence: its transition and tail would hold the speech', () => {
    const s = clone(spec);
    segment(s, 'vault-conditional').narration = [];
    const t = buildTimeline(s, estimateTrack(s, config.voice, config.lexicon), config.templates);
    const problems = narrationCadence(s, t);
    assert.ok(problems.some((p) => p.code === 'UNAUTHORED_SILENCE' && p.to === 'takeaway.l1'), JSON.stringify(problems));
    // And validation says so (positive control for NARRATION_CADENCE itself).
    assert.ok(codes(validate(s)).includes('NARRATION_CADENCE'), codes(validate(s)).join(', '));
    assert.ok(!codes(validate(spec)).includes('NARRATION_CADENCE'));
  });

  test('validation refuses a spec whose timeline breaks the cadence (fails closed)', () => {
    const fixed = clone(config.templates);
    fixed.templates['docs-reference.v1']!.durationMs = 9000;
    assert.ok(codes(validate(spec, { config: { ...config, templates: fixed } })).includes('TIMING_INVALID'));
  });

  test('allows an explicitly authored rhetorical pause, and the timeline honours exactly that pause', () => {
    const s = splitSentenceSpec(1200);
    const t = buildTimeline(s, estimateTrack(s, config.voice, config.lexicon), config.templates);
    const g = gaps(t).find((x) => x.to === 'question.l1b')!;
    assert.equal(g.ms, TIMING.linePauseMs + 1200);
    assert.deepEqual(narrationCadence(s, t), []);
    assert.equal(validate(s).ok, true, codes(validate(s)).join(', '));
  });

  test('allows silence at a section boundary: the section pause, plus any pause the last line authors', () => {
    const s = clone(spec);
    const tiers = segment(s, 'tiers');
    tiers.narration.at(-1)!.pauseAfterMs = 1500;
    const t = buildTimeline(s, estimateTrack(s, config.voice, config.lexicon), config.templates);
    const g = gaps(t).find((x) => x.from === tiers.narration.at(-1)!.id)!;
    assert.equal(g.boundary, true);
    assert.equal(g.ms, TIMING.sectionPauseMs + 1500);
    assert.deepEqual(narrationCadence(s, t), []);
    // The end-screen dwell after the last line is not a pause between lines: no line follows it.
    const last = t.segments.flatMap((x) => x.lines).at(-1)!;
    assert.ok(t.totalMs - last.endMs > 5000);
    assert.deepEqual(narrationCadence(s, t), []);
  });

  test('changing slide and transition durations alone cannot stretch sentence cadence', () => {
    const slow: Timing = { ...TIMING, transitionMs: { CUT: 900, SECTION_SHIFT: 2400, DEPTH_ENTER: 4000, DEPTH_EXIT: 3000 } };
    const longEnd = clone(config.templates);
    Object.values(longEnd.templates).find((x) => x.role === 'END_SCREEN')!.durationMs = 15000;
    const t = buildTimeline(spec, track, longEnd, slow);
    assert.deepEqual(gaps(t), gaps(timeline), 'the same pauses between the same lines');
    const durations = (x: Timeline) => x.segments.flatMap((s) => s.lines.map((l) => l.endMs - l.startMs));
    assert.deepEqual(durations(t), durations(timeline));
    assert.notEqual(t.totalMs, timeline.totalMs, 'only the visuals changed length');
    assert.deepEqual(narrationCadence(spec, t, slow), []);
  });

  test('a narrated segment cannot have a fixed length that would hold the next line back', () => {
    const fixed = clone(config.templates);
    fixed.templates['docs-reference.v1']!.durationMs = 9000;
    assert.throws(() => buildTimeline(spec, track, fixed), /docs-reference.*its speech/);
  });

  test('motion and transitions overlap ongoing narration safely: nothing visual starts before its scene is on screen', () => {
    const depth = timeline.segments.find((s) => s.transitionIn.type === 'DEPTH_ENTER')!;
    assert.ok(depth.lines[0]!.startMs < depth.contentStartMs, 'the depth move runs under the first words of its section');
    assert.ok(depth.lines[0]!.startMs >= depth.startMs, 'but never before the previous scene has begun to leave');
    for (const s of timeline.segments) {
      const opened = s.contentStartMs + TIMING.establishMs;
      for (const l of s.lines) assert.ok(l.startMs >= s.startMs && l.endMs <= s.endMs, `${l.id} inside ${s.id}`);
      for (const b of s.beats) assert.ok(b.startMs >= opened, `${s.id} beat ${b.index} waits for its scene to open at rest`);
      for (const [id, at] of Object.entries(s.reveals)) assert.ok(at === s.contentStartMs || at >= opened, `${s.id} reveal ${id}`);
      for (const c of s.sonic) assert.ok(c.atMs >= opened, `${s.id} sonic ${c.event}`);
    }
    // The speech does not wait for that moment: on the depth entry the first words run ahead of the first beat.
    assert.ok(depth.lines[0]!.startMs + TIMING.establishMs < depth.beats[0]!.startMs);
    // The exits are not squeezed to make room: the push and the dimension jump keep their full length.
    const clips = choreograph(timeline, layoutsFor(timeline, () => 'Migration Readiness'));
    const push = clips.find((c) => c.kind === 'PUSH')!;
    const jump = clips.find((c) => c.kind === 'EXIT_JUMP')!;
    assert.equal(push.endMs - push.startMs, 1500);
    assert.equal(jump.endMs - jump.startMs, 820);
    for (let i = 1; i < clips.length; i++) assert.equal(clips[i]!.startMs, clips[i - 1]!.endMs, 'one continuous performance');
    assert.equal(validate(spec).ok, true, codes(validate(spec)).join(', '));
  });

  test('a scene leaves only after its last word, and the next section speaks within the section pause', () => {
    for (let i = 1; i < timeline.segments.length; i++) {
      const prev = timeline.segments[i - 1]!;
      const next = timeline.segments[i]!;
      if (!prev.lines.length || !next.lines.length) continue;
      assert.equal(next.startMs - prev.lines.at(-1)!.endMs, TIMING.exitHoldMs, `${prev.id} holds ${TIMING.exitHoldMs} ms after its last word`);
      assert.ok(TIMING.exitHoldMs <= TIMING.sectionPauseMs);
    }
  });
});
