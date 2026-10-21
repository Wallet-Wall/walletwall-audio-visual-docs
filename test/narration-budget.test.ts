// The narration budget: a script must fit its video class at the planning pace before any voice provider,
// paid or local, is asked to speak it. Budgets are derived from the class ceiling and the pace; a budget
// that departs from that derivation is refused, and over-budget narration fails closed with the numbers.

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';
import { FixtureVoiceProvider, type VoiceProvider, type VoiceRequest } from '../src/audio/voice-provider.ts';
import { passageRequest, type CorpusPassage } from '../src/narration/corpus.ts';
import type { ElevenLabsProvider } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig, providerFor, variantSettings } from '../src/narration/providers/index.ts';
import { synthesize } from '../src/pipeline/render-input.ts';
import {
  assertNarrationWithinBudget,
  checkNarrationBudget,
  estimatedDurationSeconds,
  narrationBudgetFor,
  NarrationBudgetContractError,
  NarrationBudgetError,
  validateNarrationBudget,
} from '../src/spec/narration-budget.ts';
import type { VideoSpec } from '../src/spec/types.ts';
import type { NarrationTrack } from '../src/timeline/timeline.ts';
import { clone, codes, committedSpec, config, segment, validate } from './helpers.ts';

/** The planning pace the owner fixed for these budgets (the identity's pacing.targetWpm carries it in config). */
const PACE = { targetWpm: 145 } as const;
/** n plain words the lexicon leaves alone, so spoken and display word counts agree. */
const words = (n: number): string => Array.from({ length: n }, (_, i) => (i % 2 ? 'ground' : 'steady')).join(' ');
const round2 = (x: number): number => Math.round(x * 100) / 100;

describe('narration budget: derivation', () => {
  test('each class budget is its ceiling times the planning pace, in whole words', () => {
    assert.deepEqual({ ...narrationBudgetFor('QUICK', PACE) }, { maxDurationSeconds: 180, targetWordsPerMinute: 145, maxWords: 435, regenerationReserve: 0.3 });
    assert.deepEqual({ ...narrationBudgetFor('FOCUSED', PACE) }, { maxDurationSeconds: 300, targetWordsPerMinute: 145, maxWords: 725, regenerationReserve: 0.3 });
    assert.deepEqual({ ...narrationBudgetFor('DEEP_DIVE', PACE) }, { maxDurationSeconds: 600, targetWordsPerMinute: 145, maxWords: 1450, regenerationReserve: 0.3 });
  });

  test('a fractional word capacity rounds down, so the cap never exceeds the ceiling', () => {
    // 180 s at 151 wpm holds 453 words exactly; at 152.5 wpm it holds 457.5, of which 457 are whole.
    assert.equal(narrationBudgetFor('QUICK', { targetWpm: 151 }).maxWords, 453);
    assert.equal(narrationBudgetFor('QUICK', { targetWpm: 152.5 }).maxWords, 457);
  });

  test('the regeneration reserve is capacity planning and never lengthens the script', () => {
    const quick = narrationBudgetFor('QUICK', PACE);
    assert.equal(quick.regenerationReserve, 0.3);
    assert.equal(quick.maxWords, 435, 'not 435 * 1.3 = 565');
    assert.throws(() => validateNarrationBudget({ ...quick, maxWords: 565 }, 'QUICK', PACE), NarrationBudgetContractError);
  });

  test('estimated duration is words / pace * 60, in seconds', () => {
    assert.equal(estimatedDurationSeconds(145, 145), 60);
    assert.equal(estimatedDurationSeconds(435, 145), 180);
    assert.equal(estimatedDurationSeconds(0, 145), 0);
    assert.equal(round2(estimatedDurationSeconds(436, 145)), 180.41);
    for (const pace of [0, -145, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => estimatedDurationSeconds(100, pace), NarrationBudgetContractError, String(pace));
  });
});

describe('narration budget: the check', () => {
  test('QUICK at budget: 435 words fit 180 s', () => {
    const check = assertNarrationWithinBudget('QUICK', 435, narrationBudgetFor('QUICK', PACE), PACE);
    assert.equal(check.withinBudget, true);
    assert.equal(check.estimatedDurationSeconds, 180);
    assert.equal(check.maxDurationSeconds, 180);
  });

  test('QUICK one word over budget fails closed with class, counts, and durations', () => {
    assert.throws(
      () => assertNarrationWithinBudget('QUICK', 436, narrationBudgetFor('QUICK', PACE), PACE),
      (err: unknown) => {
        assert.ok(err instanceof NarrationBudgetError);
        assert.equal(err.videoClass, 'QUICK');
        assert.equal(err.wordCount, 436);
        assert.equal(err.maxWords, 435);
        assert.equal(round2(err.estimatedDurationSeconds), 180.41);
        assert.equal(err.maxDurationSeconds, 180);
        for (const fact of ['QUICK', '436', '435', '180.4 s', '180 s']) assert.ok(err.message.includes(fact), `message names ${fact}: ${err.message}`);
        return true;
      },
    );
    assert.equal(checkNarrationBudget('QUICK', 436, narrationBudgetFor('QUICK', PACE), PACE).withinBudget, false);
  });

  test('FOCUSED at budget: 725 words fit 300 s', () => {
    const check = assertNarrationWithinBudget('FOCUSED', 725, narrationBudgetFor('FOCUSED', PACE), PACE);
    assert.equal(check.withinBudget, true);
    assert.equal(check.estimatedDurationSeconds, 300);
    assert.throws(() => assertNarrationWithinBudget('FOCUSED', 726, narrationBudgetFor('FOCUSED', PACE), PACE), NarrationBudgetError);
  });

  test('DEEP_DIVE at budget: 1450 words fit 600 s', () => {
    const check = assertNarrationWithinBudget('DEEP_DIVE', 1450, narrationBudgetFor('DEEP_DIVE', PACE), PACE);
    assert.equal(check.withinBudget, true);
    assert.equal(check.estimatedDurationSeconds, 600);
    assert.throws(() => assertNarrationWithinBudget('DEEP_DIVE', 1451, narrationBudgetFor('DEEP_DIVE', PACE), PACE), NarrationBudgetError);
  });

  test('a word count must be a whole, non-negative number', () => {
    const quick = narrationBudgetFor('QUICK', PACE);
    for (const n of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => checkNarrationBudget('QUICK', n, quick, PACE), NarrationBudgetContractError, String(n));
  });
});

describe('narration budget: the contract refuses anything but canonical policy', () => {
  const quick = narrationBudgetFor('QUICK', PACE);

  test('malformed or negative budget values fail closed', () => {
    const bad: [string, unknown][] = [
      ['null', null],
      ['an array', [180, 145, 435, 0.3]],
      ['a missing key', { maxDurationSeconds: 180, targetWordsPerMinute: 145, maxWords: 435 }],
      ['an extra key', { ...quick, maxWordsWithReserve: 565 }],
      ['a negative duration', { ...quick, maxDurationSeconds: -180 }],
      ['a zero pace', { ...quick, targetWordsPerMinute: 0 }],
      ['a negative pace', { ...quick, targetWordsPerMinute: -145 }],
      ['a NaN word cap', { ...quick, maxWords: Number.NaN }],
      ['an infinite word cap', { ...quick, maxWords: Number.POSITIVE_INFINITY }],
      ['a fractional word cap', { ...quick, maxWords: 434.5 }],
      ['a string word cap', { ...quick, maxWords: '435' }],
      ['a negative reserve', { ...quick, regenerationReserve: -0.3 }],
      ['a reserve of the whole budget', { ...quick, regenerationReserve: 1 }],
    ];
    for (const [why, value] of bad) assert.throws(() => validateNarrationBudget(value, 'QUICK', PACE), NarrationBudgetContractError, why);
    assert.deepEqual({ ...validateNarrationBudget({ ...quick }, 'QUICK', PACE) }, { maxDurationSeconds: 180, targetWordsPerMinute: 145, maxWords: 435, regenerationReserve: 0.3 });
  });

  test('a maxWords that does not follow from duration and pace is refused', () => {
    assert.throws(() => validateNarrationBudget({ ...quick, maxWords: 436 }, 'QUICK', PACE), (err: unknown) => err instanceof NarrationBudgetContractError && /maxWords/.test(err.message));
    assert.throws(() => validateNarrationBudget({ ...quick, maxWords: 434 }, 'QUICK', PACE), NarrationBudgetContractError);
  });

  test('an internally consistent budget that is not the policy for its class is refused', () => {
    // FOCUSED's numbers presented as QUICK's; a faster pace than the identity's; a different reserve.
    assert.throws(() => validateNarrationBudget({ maxDurationSeconds: 300, targetWordsPerMinute: 145, maxWords: 725, regenerationReserve: 0.3 }, 'QUICK', PACE), NarrationBudgetContractError);
    assert.throws(() => validateNarrationBudget({ maxDurationSeconds: 180, targetWordsPerMinute: 200, maxWords: 600, regenerationReserve: 0.3 }, 'QUICK', PACE), NarrationBudgetContractError);
    assert.throws(() => validateNarrationBudget({ ...quick, regenerationReserve: 0.5 }, 'QUICK', PACE), NarrationBudgetContractError);
    assert.throws(() => assertNarrationWithinBudget('QUICK', 500, { maxDurationSeconds: 180, targetWordsPerMinute: 200, maxWords: 600, regenerationReserve: 0.3 }, PACE), NarrationBudgetContractError);
  });

  test('an unknown class or a broken pace has no budget', () => {
    assert.throws(() => narrationBudgetFor('EPIC' as never, PACE), NarrationBudgetContractError);
    for (const targetWpm of [0, -145, Number.NaN]) assert.throws(() => narrationBudgetFor('QUICK', { targetWpm }), NarrationBudgetContractError, String(targetWpm));
  });
});

describe('narration budget: validation of a spec', () => {
  /** The committed QUICK spec with one question line lengthened past the QUICK budget. */
  const overQuick = (): VideoSpec => {
    const spec = clone(committedSpec());
    const line = segment(spec, 'question').narration[0]!;
    line.text = `${line.text} ${words(130)}.`;
    return spec;
  };

  test('narration over its class budget fails with NARRATION_OVER_BUDGET and the numbers', () => {
    const report = validate(overQuick());
    assert.ok(codes(report).includes('NARRATION_OVER_BUDGET'), JSON.stringify(codes(report)));
    const issue = report.issues.find((i) => i.code === 'NARRATION_OVER_BUDGET')!;
    for (const fact of ['QUICK', '435', '180 s']) assert.ok(issue.message.includes(fact), `${fact} in ${issue.message}`);
  });

  test('the budget follows the spec class: the same narration fits FOCUSED', () => {
    const spec = overQuick();
    spec.videoClass = 'FOCUSED';
    assert.ok(!codes(validate(spec)).includes('NARRATION_OVER_BUDGET'));
  });
});

/** A voice provider that would bill per call: it records every call it receives. */
class MeteredVoiceProvider implements VoiceProvider {
  readonly id = 'metered-test-voice';
  readonly synthetic = true;
  readonly calls: VoiceRequest[] = [];

  async synthesize(request: VoiceRequest): Promise<NarrationTrack> {
    this.calls.push(request);
    return new FixtureVoiceProvider().synthesize(request);
  }
}

describe('narration budget: no provider is reached over budget (render path)', () => {
  const long = (): VideoSpec => {
    const spec = clone(committedSpec());
    const line = segment(spec, 'question').narration[0]!;
    line.text = `${line.text} ${words(200)}.`;
    return spec;
  };

  test('over-budget narration never reaches a metered provider', async () => {
    const metered = new MeteredVoiceProvider();
    await assert.rejects(synthesize(long(), metered, config), (err: unknown) => err instanceof NarrationBudgetError && err.videoClass === 'QUICK');
    assert.equal(metered.calls.length, 0);
  });

  test('narration within budget reaches the provider once', async () => {
    const metered = new MeteredVoiceProvider();
    const track = await synthesize(committedSpec(), metered, config);
    assert.equal(metered.calls.length, 1);
    assert.equal(track.lines.length, metered.calls[0]!.lines.length);
  });

  test('provider-neutral: the fixture voice and a metered provider are refused with the same numbers', async () => {
    const refusal = async (provider: VoiceProvider): Promise<NarrationBudgetError> => {
      try {
        await synthesize(long(), provider, config);
      } catch (err) {
        if (err instanceof NarrationBudgetError) return err;
        throw err;
      }
      throw new Error(`${provider.id} was reached over budget`);
    };
    const fixture = await refusal(new FixtureVoiceProvider());
    const metered = await refusal(new MeteredVoiceProvider());
    assert.deepEqual(
      [fixture.videoClass, fixture.wordCount, fixture.maxWords, fixture.maxDurationSeconds],
      [metered.videoClass, metered.wordCount, metered.maxWords, metered.maxDurationSeconds],
    );
  });
});

describe('narration budget: no provider is reached over budget (narration layer)', () => {
  const providers = loadProvidersConfig();
  const elevenlabs = providerFor('elevenlabs', providers) as ElevenLabsProvider;
  const settings = variantSettings(providers, elevenlabs, 'reference');
  const passage = (n: number): CorpusPassage => ({ id: 'budget-probe', class: 'LONG_FORM', title: 'Budget probe', targetSeconds: { min: 1, max: 900 }, text: `${words(n)}.` });

  test('a passage longer than the longest class never reaches the ElevenLabs network', async () => {
    let fetches = 0;
    const fetchStub = (async () => {
      fetches++;
      return new Response('{}', { status: 500 });
    }) as unknown as typeof fetch;
    await assert.rejects(
      async () => elevenlabs.synthesize(passageRequest(passage(2000), config), settings, { workDir: tmpdir(), env: { ELEVENLABS_API_KEY: 'test-key-not-real-0123456789abcdef' }, fetch: fetchStub }),
      (err: unknown) => err instanceof NarrationBudgetError && err.videoClass === 'DEEP_DIVE',
    );
    assert.equal(fetches, 0);
  });

  test('a passage is bounded by the longest class, not the shortest', () => {
    // 600 words is over QUICK's budget and well within DEEP_DIVE's.
    const request = passageRequest(passage(600), config);
    assert.equal(request.passageId, 'budget-probe');
  });
});
