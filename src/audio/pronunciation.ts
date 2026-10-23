// Provider-neutral pronunciation: display text stays as written (captions,
// on-screen text); the TTS input receives plain-text aliases. Providers that
// accept phonemes can additionally use the IPA entries. Isomorphic.

import type { LexiconEntry, PronunciationLexicon } from '../config/types.ts';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The entries that rewrite anything, longest term first, and the whole-word matcher over them. */
function aliasMatcher(lexicon: PronunciationLexicon): { re: RegExp; byTerm: Map<string, LexiconEntry> } | null {
  const entries = [...lexicon.entries].filter((e) => e.spoken !== e.term).sort((a, b) => b.term.length - a.term.length);
  if (entries.length === 0) return null;
  const re = new RegExp(`(?<![\\w-])(${entries.map((e) => escapeRe(e.term)).join('|')})(?![\\w-])`, 'g');
  return { re, byTerm: new Map(entries.map((e) => [e.term, e])) };
}

/**
 * Replace lexicon terms with their spoken aliases. Longer terms win
 * ("WalletWallaby" before "WalletWall"); matching is case-sensitive and
 * whole-word so "Dune" never rewrites "dunes".
 */
export function toSpokenText(text: string, lexicon: PronunciationLexicon): string {
  const m = aliasMatcher(lexicon);
  return m ? text.replace(m.re, (t) => m.byTerm.get(t)?.spoken ?? t) : text;
}

/** The entries that rewrite at least one of these display texts, in lexicon order: what the spoken script depends on. */
export function appliedEntries(texts: readonly string[], lexicon: PronunciationLexicon): LexiconEntry[] {
  const m = aliasMatcher(lexicon);
  if (!m) return [];
  const used = new Set<string>();
  for (const text of texts) for (const hit of text.matchAll(m.re)) used.add(hit[1]!);
  return lexicon.entries.filter((e) => used.has(e.term));
}

/** Aliases that must never appear in captions (they are TTS input, not display text). */
export function aliasLeaks(captionText: string, lexicon: PronunciationLexicon): string[] {
  return lexicon.entries
    .filter((e) => e.spoken !== e.term && !e.term.includes(e.spoken) && captionText.includes(e.spoken))
    .map((e) => e.spoken);
}
