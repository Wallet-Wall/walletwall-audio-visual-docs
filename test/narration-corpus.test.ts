// The narration evaluation corpus is versioned test material: its text hashes
// are pinned here, so a passage cannot change without a visible diff, a new
// corpus version, and a re-run of every candidate.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateSpokenMs } from '../src/audio/voice-provider.ts';
import { toSpokenText } from '../src/audio/pronunciation.ts';
import { CORPUS_SCHEMA, corpusSha256, hasInvisibleCharacters, loadCorpus, parseCorpus, PASSAGE_CLASSES, passageRequest, textHashes } from '../src/narration/corpus.ts';
import { NarrationContractError } from '../src/narration/contract.ts';
import { config } from './helpers.ts';

const corpus = loadCorpus();

/** Pinned identities of corpus v1: the display text and the spoken (lexicon-aliased) text of every passage. */
const PINS: Record<string, { display: string; spoken: string }> = {
  'short-instruction': { display: 'afbdf9ee8fc331f1e346e2de3ca897503202111ebbcdc73c01bc1e7ba145a3fd', spoken: 'afbdf9ee8fc331f1e346e2de3ca897503202111ebbcdc73c01bc1e7ba145a3fd' },
  'normal-explanation': { display: '16a2ed760fd009598015946bfc56024ed4907ce551ce1ea0894eb243da8934e2', spoken: '16a2ed760fd009598015946bfc56024ed4907ce551ce1ea0894eb243da8934e2' },
  'technical-passage': { display: '448324380edec31844688d9e940d88b63ebd717c3f3f6483b9f43ce4e1e945d9', spoken: 'b607e2d70a5e3838aaf31a8371198aec301018ce99b71b7aa9c4c70a66fba60f' },
  'long-form': { display: '767c86b702c52ac2331316880fd107cf763671d3a991af88f19c60d9f287f222', spoken: '767c86b702c52ac2331316880fd107cf763671d3a991af88f19c60d9f287f222' },
};
const CORPUS_SHA256 = '6aa5e3cb7efd8379b6e9232fdc3fa6425f69c421e6ac2e2b0708db605406cf36';

describe('narration evaluation corpus', () => {
  test('is version 1 with one passage of each class, and its hashes are the pinned ones', () => {
    assert.equal(corpus.schema, CORPUS_SCHEMA);
    assert.equal(corpus.version, 1);
    assert.deepEqual(corpus.passages.map((p) => p.class), [...PASSAGE_CLASSES]);
    assert.deepEqual(corpus.passages.map((p) => p.id), Object.keys(PINS));
    for (const p of corpus.passages) {
      const r = passageRequest(p, config);
      assert.deepEqual(textHashes(r.displayText, r.spokenText), { displaySha256: PINS[p.id]!.display, spokenSha256: PINS[p.id]!.spoken }, p.id);
      assert.equal(r.spokenText, toSpokenText(p.text, config.lexicon), 'the synthesizer input is the display text with lexicon aliases only');
    }
    assert.equal(corpusSha256(corpus), CORPUS_SHA256, 'a corpus change needs a new version and new pins');
  });

  test('every passage is copy-policy compliant, NFKC-stable, visible, and in WalletWall register', () => {
    const cta = new RegExp(config.policy.callToActionPattern, 'i');
    for (const p of corpus.passages) {
      for (const rule of config.policy.forbiddenPhrases) assert.ok(!new RegExp(rule.pattern, 'i').test(p.text), `${p.id}: ${rule.reason}`);
      assert.ok(!cta.test(p.text), `${p.id}: no call to action`);
      assert.equal(p.text, p.text.normalize('NFKC'));
      assert.ok(!hasInvisibleCharacters(p.text));
      assert.ok(!/\d/.test(p.text), `${p.id}: numbers are spelled out so text normalization never differs between providers`);
    }
  });

  test('each passage sits inside its class duration target at the identity pace', () => {
    for (const p of corpus.passages) {
      const seconds = estimateSpokenMs(passageRequest(p, config).spokenText, config.voice.pacing) / 1000;
      assert.ok(seconds >= p.targetSeconds.min && seconds <= p.targetSeconds.max, `${p.id}: ${seconds.toFixed(1)} s vs ${p.targetSeconds.min}-${p.targetSeconds.max}`);
    }
  });

  test('the technical passage carries the evaluation vocabulary; the long passage has a list, an uncertainty, and a conclusion', () => {
    const technical = corpus.passages.find((p) => p.class === 'TECHNICAL_PASSAGE')!.text;
    for (const term of ['WalletWall', 'WalletWallaby', 'stablecoin', 'provenance', 'BigQuery', 'deterministic', 'migration readiness', 'wallet address', 'on-chain']) assert.ok(technical.includes(term), term);
    const long = corpus.passages.find((p) => p.class === 'LONG_FORM')!.text;
    assert.ok(/First, .*Second, .*Third, /.test(long), 'a short list');
    assert.ok(/not sure yet/.test(long), 'an uncertainty statement');
    assert.ok(/So the conclusion is simple\./.test(long), 'a conclusion');
    const sentences = long.split(/[.?!]\s/).map((s) => s.split(' ').length);
    assert.ok(Math.max(...sentences) - Math.min(...sentences) >= 10, 'varied sentence lengths');
    assert.ok(sentences.length >= 12);
  });

  test('a malformed corpus is refused: unknown keys, duplicate ids, invisible characters, double spaces', () => {
    const base = JSON.parse(JSON.stringify(corpus)) as Record<string, unknown>;
    const bad: [string, unknown][] = [
      ['unknown key', { ...base, extra: 1 }],
      ['unknown class', { ...base, passages: [{ ...(base.passages as object[])[0], class: 'POEM' }] }],
      ['duplicate id', { ...base, passages: [(base.passages as object[])[0], (base.passages as object[])[0]] }],
      ['zero-width', { ...base, passages: [{ ...(base.passages as Record<string, unknown>[])[0], text: `a${String.fromCharCode(0x200b)}b` }] }],
      ['double space', { ...base, passages: [{ ...(base.passages as Record<string, unknown>[])[0], text: 'a  b' }] }],
      ['path as id', { ...base, passages: [{ ...(base.passages as Record<string, unknown>[])[0], id: '../x' }] }],
    ];
    for (const [name, value] of bad) assert.throws(() => parseCorpus(value), NarrationContractError, name);
  });
});
