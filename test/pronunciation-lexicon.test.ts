// The technical pronunciation lexicon (config/pronunciation.json, src/audio/pronunciation.ts): what the voice is asked
// to say for a technical term, never what anyone reads. Display text (captions, on-screen copy, the spec) stays
// canonical; only the TTS input carries the alias. The lexicon is versioned (each version pins its entries), and the
// narration set binds the entries its script actually uses, so a pronunciation change re-voices only the lines that
// speak the term.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCaptions, checkCaptions } from '../src/audio/captions.ts';
import { aliasLeaks, toSpokenText } from '../src/audio/pronunciation.ts';
import { estimateTrack, voiceRequestFor } from '../src/audio/voice-provider.ts';
import type { PronunciationLexicon } from '../src/config/types.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { appliedLexicon, LEXICON_PINS, lexiconEntriesSha256 } from '../src/narration/lexicon.ts';
import { loadPublicationBinding, publicationExpectation } from '../src/narration/publication.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { clone, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const SEPOLIA_LINE = 'vault.l3';
const withAlias = (term: string, spoken: string): PronunciationLexicon => {
  const l = clone(config.lexicon);
  l.entries.find((e) => e.term === term)!.spoken = spoken;
  return l;
};
const expectFor = (lexicon: PronunciationLexicon) => publicationExpectation(voiceRequestFor(spec, config.voice, lexicon), loadPublicationBinding(), spec.id, 'video');

describe('the technical pronunciation lexicon', () => {
  test('Sepolia is spoken as written: the owner chose the voice\'s own reading of the real word over every respelling', () => {
    // Every respelling came back as fragments (the pinned recognizer heard v1 "say POH Lee R", v2 "Su POH LiO", v3
    // "S Epolia"); in the owner's listening probe the real word, take 1, was right (2-4, lowercase one-word
    // respellings, were good too). The entry stays, with the owner's IPA for a provider that takes phonemes.
    const entry = config.lexicon.entries.find((e) => e.term === 'Sepolia')!;
    assert.equal(entry.spoken, 'Sepolia');
    assert.equal(entry.ipa, 'sɛpˈoʊliə');
    assert.equal(toSpokenText('on Ethereum Sepolia, and', config.lexicon), 'on Ethereum Sepolia, and');
  });

  test('no alias word carries a capital after its first letter: the voice spells capitals out', () => {
    // v2's "suh-POH-lee-uh" came back with POH spelled letter by letter (owner listening, 2026-10-23). Letters meant to
    // be spelled stand alone ("E R C twenty", "U S D C"); a word is written as it is said.
    for (const e of config.lexicon.entries) {
      for (const word of e.spoken.split(/\s+/)) assert.ok(!/[A-Z]/.test(word.slice(1)), `${e.term}: "${word}" has a capital after its first letter`);
    }
    // Positive control: the v2 alias is refused by the same rule.
    assert.ok(/[A-Z]/.test('suh-POH-lee-uh'.slice(1)));
  });

  test('display text and spoken text stay distinct: the spec, the captions, and the screen keep the canonical word', () => {
    const request = voiceRequestFor(spec, config.voice, config.lexicon);
    const line = request.lines.find((l) => l.lineId === 'hook.l1')!;
    assert.match(line.displayText, /^WalletWall's /);
    assert.match(line.spokenText, /^Wallet Wall's /);
    assert.ok(!line.displayText.includes('Wallet Wall'));
    // The Sepolia line is spoken as written, so its display and spoken text are the same words.
    const sepolia = request.lines.find((l) => l.lineId === SEPOLIA_LINE)!;
    assert.equal(sepolia.spokenText, sepolia.displayText);
    const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
    const cues = buildCaptions(timeline);
    const text = cues.map((c) => c.rows.join(' ')).join(' ');
    assert.match(text, /WalletWall/);
    assert.match(text, /Sepolia/);
    assert.deepEqual(aliasLeaks(text, config.lexicon), []);
    const issues = new IssueCollector();
    checkCaptions(cues, spec, timeline, config.lexicon, issues);
    assert.deepEqual(issues.report().issues, []);
    // Positive control: a caption that carries the alias is refused.
    const leaked = cues.map((c) => ({ ...c, rows: c.rows.map((r) => r.replace('WalletWall', 'Wallet Wall')) }));
    const qa = new IssueCollector();
    checkCaptions(leaked, spec, timeline, config.lexicon, qa);
    assert.ok(qa.report().issues.some((i) => i.code === 'CAPTIONS_PRONUNCIATION_LEAK'));
    // The canonical source and the on-screen copy never carry an alias.
    for (const s of spec.segments) for (const e of config.lexicon.entries) if (e.spoken !== e.term && !e.term.includes(e.spoken)) assert.ok(!JSON.stringify(s).includes(e.spoken), `${s.id}: ${e.spoken}`);
  });

  test('the lexicon is versioned: its entries match the pin of its version, and pins are append-only', () => {
    assert.equal(config.lexicon.schema, 'walletwall.pronunciation/v2');
    assert.equal(config.lexicon.id, 'walletwall-lexicon', 'a stable id: a pronunciation change moves the version, never the spec');
    assert.equal(spec.audio.pronunciationDictionaryId, config.lexicon.id);
    assert.equal(lexiconEntriesSha256(config.lexicon), LEXICON_PINS[config.lexicon.version], `lexicon v${config.lexicon.version}: a changed entry needs a new version and pin`);
    assert.deepEqual(Object.keys(LEXICON_PINS).map(Number), Array.from({ length: config.lexicon.version }, (_, i) => i + 1));
    assert.equal(new Set(Object.values(LEXICON_PINS)).size, config.lexicon.version, 'every version pins distinct entries');
    // Positive control: any edit to an entry is a different definition.
    assert.notEqual(lexiconEntriesSha256(withAlias('Sepolia', 'seh POH lee uh')), LEXICON_PINS[config.lexicon.version]);
    assert.equal(config.lexicon.version, 4);
  });

  test('the narration set binds the entries its script uses: the aliases it applies, and nothing it does not speak', () => {
    const applied = appliedLexicon(voiceRequestFor(spec, config.voice, config.lexicon).lines.map((l) => l.displayText), config.lexicon);
    assert.ok(!applied.entries.some((e) => e.term === 'Sepolia'), 'spoken as written: no alias applies');
    assert.ok(applied.entries.some((e) => e.term === 'WalletWall'));
    assert.ok(!applied.entries.some((e) => e.term === 'USDC' || e.term === 'Dune'), 'unused entries are not part of the binding');
    const e = expectFor(config.lexicon);
    assert.deepEqual(e.lexicon, { id: config.lexicon.id, version: config.lexicon.version, appliedSha256: applied.sha256 });
  });

  test('changing a pronunciation invalidates only the lines that speak it; display hashes never move', () => {
    const now = expectFor(config.lexicon);
    const changed = expectFor(withAlias('Sepolia', 'seh POH lee uh'));
    const moved = now.lines.filter((l, i) => l.spokenSha256 !== changed.lines[i]!.spokenSha256 || l.chunks.join() !== changed.lines[i]!.chunks.join()).map((l) => l.lineId);
    assert.deepEqual(moved, [SEPOLIA_LINE]);
    assert.deepEqual(now.lines.map((l) => l.displaySha256), changed.lines.map((l) => l.displaySha256));
    assert.notEqual(changed.lexicon.appliedSha256, now.lexicon.appliedSha256);
    assert.notEqual(changed.scriptSha256, now.scriptSha256);
    // An entry this script never speaks changes nothing the narration set binds.
    const unrelated = expectFor(withAlias('Dune', 'Doon'));
    assert.deepEqual(unrelated, now);
  });
});
