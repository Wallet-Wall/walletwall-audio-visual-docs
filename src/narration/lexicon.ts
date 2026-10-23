// The pronunciation lexicon's version and its binding into narration (config/pronunciation.json,
// src/audio/pronunciation.ts). Node-only: content addressing stays out of the isomorphic modules.
//
// Each lexicon version pins its entries, so an entry cannot change without a new version. A narration set binds the
// lexicon by the entries its script actually speaks (appliedLexicon): a changed alias for a spoken term makes the set
// stale and re-voices only the lines that say it, while an entry the script never speaks changes nothing it binds.

import { appliedEntries } from '../audio/pronunciation.ts';
import type { LexiconEntry, PronunciationLexicon } from '../config/types.ts';
import { contentAddress } from '../core/hash.ts';

/** Append-only: version -> content address of that version's entries. */
export const LEXICON_PINS: Readonly<Record<number, string>> = Object.freeze({
  // v1: the first lexicon; Sepolia was four separate words, and the voice read them as four ("say POH Lee R").
  1: '9335a69d4b103b17ed9f8375d64cfeecdd4ef23a5d0117356207fc5724e520bf',
  // v2: Sepolia as one respelled word, suh-POH-lee-uh; the voice spelled out its capitals (owner listening).
  2: '63411e49ee8b699131e6af4b7ee69fc6696eb42803c669d09853b955493c8d68',
  // v3: Sepolia as sep-oh-lee-uh (/sɛpˈoʊliə/); the voice still read it in fragments ("S Epolia").
  3: '1d423b4e75dffa5a562e057a4e00d69a8d66ea38575d2738394db8cbcc95cdad',
  // v4: Sepolia spoken as written: in the owner's listening probe the voice's own reading of the real word was right.
  4: 'c183d4cb3fdc622ecbb02411097a1d85de17bc064bff2d515d4f055e54a33fdc',
});

export const lexiconEntriesSha256 = (lexicon: PronunciationLexicon): string => contentAddress(lexicon.entries);

/**
 * A lexicon whose entries are not the ones its version pins (an entry edited without a new version and pin) is refused:
 * before any paid narration request, and on every replay. Fails closed: the version a narration set records must mean
 * exactly one set of entries.
 */
export function assertLexiconPinned(lexicon: PronunciationLexicon): void {
  const pin = LEXICON_PINS[lexicon.version];
  if (pin === undefined || pin !== lexiconEntriesSha256(lexicon)) {
    throw new Error(`the pronunciation lexicon ${lexicon.id} v${lexicon.version} is not the version it claims: its entries changed without a new version and pin (src/narration/lexicon.ts LEXICON_PINS)`);
  }
}

export interface AppliedLexicon {
  /** The entries that rewrite at least one display text (term and spoken alias): what the spoken script depends on. */
  entries: Pick<LexiconEntry, 'term' | 'spoken'>[];
  sha256: string;
}

/** What a script's spoken text depends on in the lexicon: the aliases it applies, and their content address. */
export function appliedLexicon(displayTexts: readonly string[], lexicon: PronunciationLexicon): AppliedLexicon {
  const entries = appliedEntries(displayTexts, lexicon).map((e) => ({ term: e.term, spoken: e.spoken }));
  return { entries, sha256: contentAddress(entries) };
}

/** What a narration set records about the lexicon: which one, which version, and the entries its script applies. */
export interface NarrationLexiconBinding {
  id: string;
  version: number;
  appliedSha256: string;
}

export function narrationLexiconBinding(displayTexts: readonly string[], lexicon: PronunciationLexicon): NarrationLexiconBinding {
  return { id: lexicon.id, version: lexicon.version, appliedSha256: appliedLexicon(displayTexts, lexicon).sha256 };
}
