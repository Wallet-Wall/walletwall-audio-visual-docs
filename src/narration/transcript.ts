// Source/transcript agreement for narration candidates: a word-level alignment
// of what the synthesizer was asked to say against what a speech recognizer
// heard. Diagnostic only (missing, extra, or repeated words); ASR quality never
// decides whether a voice sounds natural. Isomorphic (no Node imports).

export interface TranscriptDiff {
  referenceWords: number;
  hypothesisWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  /** (S + D + I) / reference words. */
  wordErrorRate: number;
  /** Reference words the hypothesis lacks (deleted or substituted), in order. */
  missing: string[];
  /** Hypothesis words the reference lacks (inserted or substituted), in order. */
  extra: string[];
  /** Trigrams the hypothesis repeats more often than the reference does. */
  repeatedPhrases: string[];
}

/** Compounds the lexicon spells apart for the synthesizer, and ASR may spell either way. */
const COMPOUNDS: readonly [RegExp, string][] = [
  [/\bwallet wallaby\b/g, 'walletwallaby'],
  [/\bwallet wall\b/g, 'walletwall'],
  [/\bbig query\b/g, 'bigquery'],
  [/\bon chain\b/g, 'onchain'],
  [/\bstable coins?\b/g, 'stablecoin'],
  [/\bstablecoins\b/g, 'stablecoin'],
];

export function normalizeWords(text: string): string[] {
  let t = text.normalize('NFKC').toLowerCase();
  t = t.replace(/[’']/g, '').replace(/[-–—]/g, ' ');
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  for (const [re, word] of COMPOUNDS) t = t.replace(re, word);
  return t ? t.split(' ') : [];
}

export function compareTranscript(reference: string, hypothesis: string): TranscriptDiff {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  const n = ref.length;
  const m = hyp.length;
  // Levenshtein over words with a backtrace; passages are a few hundred words, so the table is small.
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  const missing: string[] = [];
  const extra: string[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && d[i]![j] === d[i - 1]![j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + 1) {
      substitutions++;
      missing.unshift(ref[i - 1]!);
      extra.unshift(hyp[j - 1]!);
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deletions++;
      missing.unshift(ref[i - 1]!);
      i--;
    } else {
      insertions++;
      extra.unshift(hyp[j - 1]!);
      j--;
    }
  }
  const trigrams = (words: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (let k = 0; k + 3 <= words.length; k++) {
      const key = words.slice(k, k + 3).join(' ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const refTri = trigrams(ref);
  const repeatedPhrases = [...trigrams(hyp)].filter(([key, count]) => count > (refTri.get(key) ?? 0) && count > 1).map(([key]) => key);
  return {
    referenceWords: n,
    hypothesisWords: m,
    substitutions,
    deletions,
    insertions,
    wordErrorRate: n === 0 ? (m === 0 ? 0 : 1) : (substitutions + deletions + insertions) / n,
    missing,
    extra,
    repeatedPhrases,
  };
}
