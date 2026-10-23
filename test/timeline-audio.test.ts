import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCaptions, checkCaptions, toSrt, toWebVtt } from '../src/audio/captions.ts';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { aliasLeaks, toSpokenText } from '../src/audio/pronunciation.ts';
import { effectiveWpm, estimateSpokenMs, estimateTrack, FixtureVoiceProvider, voiceRequestFor } from '../src/audio/voice-provider.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { buildTimeline, EXIT_ACTIONS, totalFrames } from '../src/timeline/timeline.ts';
import { committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const track = estimateTrack(spec, config.voice, config.lexicon);
const timeline = buildTimeline(spec, track, config.templates);

describe('timeline', () => {
  test('segments are contiguous and ordered; the first has no transition', () => {
    let cursor = 0;
    for (const s of timeline.segments) {
      assert.equal(s.startMs, cursor);
      assert.ok(s.contentStartMs >= s.startMs && s.endMs > s.contentStartMs);
      // A line may start under its segment's transition (speech owns the cadence), never before the segment begins.
      for (const l of s.lines) assert.ok(l.startMs >= s.startMs && l.endMs <= s.endMs);
      cursor = s.endMs;
    }
    assert.equal(timeline.segments[0]!.contentStartMs, 0);
    assert.equal(timeline.totalMs, cursor);
    assert.equal(totalFrames(timeline), Math.round((cursor * 30) / 1000));
  });

  test('brand segments use their template durations; the end screen is 5-20 s', () => {
    const end = timeline.segments.find((s) => s.role === 'END_SCREEN')!;
    const d = end.endMs - end.contentStartMs;
    assert.ok(d >= 5000 && d <= 20000);
  });

  test('the lesson opens with the hook and goes straight to the question: no standalone logo interlude', () => {
    assert.deepEqual(timeline.segments.slice(0, 2).map((s) => s.role), ['HOOK', 'QUESTION']);
    const hook = timeline.segments[0]!;
    const question = timeline.segments[1]!;
    assert.equal(question.startMs, hook.endMs);
    assert.equal(question.transitionIn.type, 'CUT');
  });

  test('is deterministic', () => {
    assert.deepEqual(buildTimeline(spec, track, config.templates), timeline);
  });

  test('exit actions are always the last beat of their segment', () => {
    for (const s of spec.segments) {
      s.wallaby.forEach((b, i) => {
        if (EXIT_ACTIONS.has(b.action)) assert.equal(i, s.wallaby.length - 1, `${s.id}`);
      });
    }
  });
});

describe('voice and pronunciation', () => {
  test('aliases feed the TTS input, never the display text', () => {
    assert.equal(toSpokenText('WalletWallaby reads ERC-20 and USDC on Sepolia via WalletWall.', config.lexicon), 'Wallet Wallaby reads E R C twenty and U S D C on Sepolia via Wallet Wall.');
    assert.equal(toSpokenText('Dunes are not Dune.', config.lexicon), 'Dunes are not Dune.');
  });

  test('the fixture provider is silent, estimated, synthetic, and at a natural pace', async () => {
    const t = await new FixtureVoiceProvider().synthesize(voiceRequestFor(spec, config.voice, config.lexicon));
    assert.equal(t.estimated, true);
    assert.equal(t.synthetic, true);
    assert.ok(t.lines.every((l) => l.audio === null && l.durationMs > 0));
    const wpm = effectiveWpm(voiceRequestFor(spec, config.voice, config.lexicon), t);
    assert.ok(wpm <= config.voice.pacing.maxWpm, `${wpm}`);
  });

  test('estimates grow with spoken (aliased) words', () => {
    assert.ok(estimateSpokenMs('U S D C', config.voice.pacing) > estimateSpokenMs('USDC', config.voice.pacing));
  });
});

describe('captions', () => {
  const cues = buildCaptions(timeline);
  test('reproduce the narration exactly, in cues of at most two 42-char rows', () => {
    const issues = new IssueCollector();
    checkCaptions(cues, spec, timeline, config.lexicon, issues);
    assert.deepEqual(issues.report().issues, []);
    for (const c of cues) {
      assert.ok(c.rows.length <= 2);
      for (const r of c.rows) assert.ok(r.length <= 42 || !r.includes(' '), r);
    }
  });

  test('media QA catches edited captions and alias leaks (positive controls)', () => {
    const tampered = cues.map((c, i) => (i === 0 ? { ...c, rows: ['Something the narration never said'] } : c));
    const issues = new IssueCollector();
    checkCaptions(tampered, spec, timeline, config.lexicon, issues);
    assert.ok(issues.report().issues.some((i) => i.code === 'CAPTIONS_MISMATCH'));
    assert.deepEqual(aliasLeaks('Wallet Wall explains it', config.lexicon), ['Wallet Wall']);
  });

  test('long lines are balanced: no orphan cue of a word or two', () => {
    for (const s of timeline.segments) {
      for (const line of s.lines) {
        const mine = cues.filter((c) => c.lineId === line.id);
        if (mine.length < 2) continue;
        for (const c of mine) assert.ok(c.rows.join(' ').split(' ').length >= 4, `${line.id}: "${c.rows.join(' ')}"`);
      }
    }
  });

  test('serialize to WebVTT and SRT', () => {
    const vtt = toWebVtt(cues);
    assert.ok(vtt.startsWith('WEBVTT\n\n1\n00:00:00.'));
    assert.match(toSrt(cues), /^1\n\d\d:\d\d:\d\d,\d{3} --> /);
  });
});

describe('semantic audio', () => {
  const sheet = buildCueSheet(timeline, config.sonic, spec.audio.musicBedId);
  test('cues are semantic, ordered, and silent until assets exist', () => {
    assert.ok(sheet.cues.length > 0);
    assert.ok(sheet.cues.every((c, i) => i === 0 || c.atMs >= sheet.cues[i - 1]!.atMs));
    assert.ok(sheet.cues.every((c) => c.asset === null), 'no sonic assets are produced yet');
    assert.ok(sheet.cues.some((c) => c.event === 'DIMENSION_SHIFT'), 'the push-through is heard');
    assert.ok(sheet.cues.some((c) => c.event === 'EVIDENCE_CONFIRMED' && c.reason === 'EXPLICIT'));
    assert.ok(!sheet.cues.some((c) => c.event.startsWith('SUPERPOSITION')), 'no quantum semantics for a vault doc');
  });

  test('per-event minimum gaps prevent constant repetition', () => {
    for (const event of new Set(sheet.cues.map((c) => c.event))) {
      const at = sheet.cues.filter((c) => c.event === event).map((c) => c.atMs);
      const gap = config.sonic.events[event]?.minGapMs ?? 0;
      for (let i = 1; i < at.length; i++) assert.ok(at[i]! - at[i - 1]! >= gap, `${event}`);
    }
  });

  test('INSPECT is deliberately silent', () => {
    assert.ok(!sheet.cues.some((c) => c.event === 'INSPECT'));
  });
});
