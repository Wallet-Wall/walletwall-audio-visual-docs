// Docs-change classification on the real source doc: punctuation never
// regenerates a video; a changed claim always marks it materially stale.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeDocText } from '../src/source/load.ts';
import { classifyDocChange, isTypoLevel } from '../src/staleness/classify.ts';
import { deriveFreshness, freshnessFor } from '../src/staleness/freshness.ts';
import { committedSnapshot, committedSpec, docText } from './helpers.ts';

const spec = committedSpec();
const before = committedSnapshot();
const original = docText();

function verdictFor(edit: (doc: string) => string) {
  const edited = edit(original);
  assert.notEqual(edited, original, 'the edit must change the doc');
  const after = normalizeDocText(before.docPath, edited, { domains: before.domains });
  const report = classifyDocChange(spec, before, after);
  return { report, verdict: deriveFreshness(report), categories: report.changes.map((c) => c.category) };
}

describe('docs change classification', () => {
  test('no change -> CURRENT, no action', () => {
    const after = normalizeDocText(before.docPath, original, { domains: before.domains });
    const v = deriveFreshness(classifyDocChange(spec, before, after));
    assert.equal(v.freshness, 'CURRENT');
    assert.equal(v.action, 'NONE');
  });

  test('line-ending churn is not a change', () => {
    const after = normalizeDocText(before.docPath, original.replace(/\r?\n/g, '\r\n'), { domains: before.domains });
    assert.deepEqual(classifyDocChange(spec, before, after).changes, []);
  });

  test('emphasis-only edit -> STYLE_ONLY, CURRENT', () => {
    const { categories, verdict } = verdictFor((d) => d.replace('**recommend** step', '*recommend* step'));
    assert.deepEqual(categories, ['STYLE_ONLY']);
    assert.equal(verdict.freshness, 'CURRENT');
  });

  test('link-target edit -> LINK_ONLY, CURRENT', () => {
    const { categories, verdict } = verdictFor((d) => d.replace('(/wallroom)', '(/wallroom-v2)'));
    assert.deepEqual(categories, ['LINK_ONLY']);
    assert.equal(verdict.freshness, 'CURRENT');
  });

  test('typo inside a cited claim -> TYPO_ONLY, CURRENT (no regeneration)', () => {
    const { categories, verdict } = verdictFor((d) => d.replace('architectural placeholder', 'architectual placeholder'));
    assert.ok(categories.every((c) => c === 'TYPO_ONLY'), JSON.stringify(categories));
    assert.equal(verdict.freshness, 'CURRENT');
    assert.equal(verdict.action, 'REFRESH_SOURCE_BINDING');
  });

  test('rewritten uncited explanation -> MINOR_EXPLANATION, COSMETICALLY_STALE', () => {
    const { categories, verdict } = verdictFor((d) => d.replace('Reading the tiers tells you what they are.', 'The tiers are easier to understand by experimenting with them directly.'));
    assert.deepEqual(categories, ['MINOR_EXPLANATION']);
    assert.equal(verdict.freshness, 'COSMETICALLY_STALE');
  });

  test('a changed claim the video speaks -> CLAIM_CHANGED, MATERIALLY_STALE', () => {
    const { report, verdict } = verdictFor((d) => d.replace('The Vault Simulator is **testnet-only**', 'The Vault Simulator is **mainnet-ready**'));
    const change = report.changes.find((c) => c.category === 'CLAIM_CHANGED');
    assert.ok(change, JSON.stringify(report.changes));
    assert.deepEqual(change.claimIds, ['c-testnet']);
    assert.deepEqual(change.segmentIds, ['vault-conditional']);
    assert.equal(verdict.freshness, 'MATERIALLY_STALE');
    assert.equal(verdict.action, 'NEW_REVISION');
  });

  test('a changed claim behind graph structure (a node) -> MECHANISM_CHANGED', () => {
    const { report, verdict } = verdictFor((d) => d.replace('| Prioritize concrete action. |', '| Act immediately on every wallet. |'));
    const change = report.changes.find((c) => c.category === 'MECHANISM_CHANGED');
    assert.ok(change, JSON.stringify(report.changes));
    assert.deepEqual(change.claimIds, ['c-tier-migrate']);
    assert.equal(verdict.freshness, 'MATERIALLY_STALE');
  });

  test('a changed spoken claim -> CLAIM_CHANGED', () => {
    const { categories } = verdictFor((d) => d.replace('Every assessment normalizes into one of four tiers.', 'Every assessment normalizes into one of five tiers.'));
    assert.ok(categories.includes('CLAIM_CHANGED'), JSON.stringify(categories));
  });

  test('a changed claim behind the takeaway -> CONCLUSION_CHANGED', () => {
    const { categories } = verdictFor((d) => d.replace('**Tiers are prioritization bands, not verdicts.**', '**Tiers are verdicts.**'));
    assert.ok(categories.includes('CONCLUSION_CHANGED'), JSON.stringify(categories));
  });

  test('a diagram structure change the video draws from -> DIAGRAM_CHANGED, REGENERATION_REQUIRED', () => {
    const { report, verdict } = verdictFor((d) => d.replace('    Review --> Migrate\n', '    Review --> Migrate\n    Review --> Monitor\n').replace('    Review --> Migrate\r\n', '    Review --> Migrate\r\n    Review --> Monitor\r\n'));
    const change = report.changes.find((c) => c.category === 'DIAGRAM_CHANGED');
    assert.ok(change?.affectsVideo, JSON.stringify(report.changes));
    assert.ok(change.segmentIds.includes('tiers'));
    assert.equal(verdict.freshness, 'REGENERATION_REQUIRED');
    assert.equal(verdict.action, 'RERENDER_AFFECTED_SCENES');
  });

  test('typo detection refuses meaning changes', () => {
    assert.equal(isTypoLevel('an architectural placeholder', 'an architectual placeholder'), true);
    assert.equal(isTypoLevel('one of four tiers', 'one of five tiers'), false);
    assert.equal(isTypoLevel('it is not unsafe', 'it is now unsafe'), false);
    assert.equal(isTypoLevel('mainnet writes are blocked', 'mainnet writes are allowed'), false);
    for (const [a, b] of [
      ['always conditional', 'always unconditional'],
      ['writes are blocked', 'writes are unblocked'],
      ['the proof is valid', 'the proof is invalid'],
      ['an ascending order', 'a descending order'],
      ['scores increases slowly', 'scores decreases slowly'],
      ['a ratio of 1.5', 'a ratio of 15'],
      ['costs $5 today', 'costs 5 today'],
      ['moved -5 points', 'moved 5 points'],
      ['about 5% more', 'about 5 more'],
      ['one shared tier', 'one shared tiers'],
    ]) assert.equal(isTypoLevel(a!, b!), false, `${a} -> ${b}`);
  });

  test('negating a cited claim is material, never a typo', () => {
    for (const [from, to] of [
      ['"Vault Candidate" is always conditional.', '"Vault Candidate" is always unconditional.'],
      ['mainnet writes are blocked', 'mainnet writes are unblocked'],
    ]) {
      const { verdict } = verdictFor((d) => d.replace(from!, to!));
      assert.equal(verdict.freshness, 'MATERIALLY_STALE', `${from} -> ${to}`);
    }
  });

  test('frontmatter edits are reported, never "no change"', () => {
    const { categories, verdict } = verdictFor((d) => d.replace('what actions each suggests.', 'which actions each one suggests.'));
    assert.deepEqual(categories, ['MINOR_EXPLANATION']);
    assert.equal(verdict.freshness, 'COSMETICALLY_STALE');
  });

  test('a changed Mermaid link type is a diagram change', () => {
    const { categories } = verdictFor((d) => d.replace('Review --> Migrate', 'Review --- Migrate'));
    assert.ok(categories.includes('DIAGRAM_CHANGED'), JSON.stringify(categories));
  });

  test('category -> freshness table matches the policy', () => {
    assert.equal(freshnessFor('TYPO_ONLY', true), 'CURRENT');
    assert.equal(freshnessFor('STYLE_ONLY', true), 'CURRENT');
    assert.equal(freshnessFor('LINK_ONLY', true), 'CURRENT');
    assert.equal(freshnessFor('SCREENSHOT_CHANGED', false), 'COSMETICALLY_STALE');
    assert.equal(freshnessFor('SCREENSHOT_CHANGED', true), 'REGENERATION_REQUIRED');
    for (const c of ['CLAIM_CHANGED', 'MECHANISM_CHANGED', 'CONCLUSION_CHANGED'] as const) assert.equal(freshnessFor(c, false), 'MATERIALLY_STALE');
  });
});
