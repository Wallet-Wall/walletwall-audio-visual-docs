// Provider-neutral pronunciation: display text stays as written (captions,
// on-screen text); the TTS input receives plain-text aliases. Providers that
// accept phonemes can additionally use the IPA entries. Isomorphic.

import type { PronunciationLexicon } from '../config/types.ts';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace lexicon terms with their spoken aliases. Longer terms win
 * ("WalletWallaby" before "WalletWall"); matching is case-sensitive and
 * whole-word so "Dune" never rewrites "dunes".
 */
export function toSpokenText(text: string, lexicon: PronunciationLexicon): string {
  const entries = [...lexicon.entries].filter((e) => e.spoken !== e.term).sort((a, b) => b.term.length - a.term.length);
  if (entries.length === 0) return text;
  const re = new RegExp(`(?<![\\w-])(${entries.map((e) => escapeRe(e.term)).join('|')})(?![\\w-])`, 'g');
  const byTerm = new Map(entries.map((e) => [e.term, e.spoken]));
  return text.replace(re, (m) => byTerm.get(m) ?? m);
}

/** Aliases that must never appear in captions (they are TTS input, not display text). */
export function aliasLeaks(captionText: string, lexicon: PronunciationLexicon): string[] {
  return lexicon.entries
    .filter((e) => e.spoken !== e.term && !e.term.includes(e.spoken) && captionText.includes(e.spoken))
    .map((e) => e.spoken);
}
