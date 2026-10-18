// Text normalization shared by the MDX parser, claim validation, and staleness
// classification. Isomorphic.

import type { NormalizedSource, SourceBlock, SourceSection } from './types.ts';

export interface InlineSink {
  links: string[];
  images: { src: string; alt: string }[];
}

const IMAGE_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const LINK_RE = /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMG_RE = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*?>/gi;
const ALT_ATTR_RE = /\balt=["']([^"']*)["']/i;

/**
 * Reduce one line (or joined lines) of Markdown/MDX inline syntax to plain
 * text. Link targets and images are recorded in `sink` and removed from the
 * text, so a link-target edit never changes the meaningful text.
 */
export function inlineText(input: string, sink?: InlineSink): string {
  let s = input;
  s = s.replace(HTML_IMG_RE, (tag: string, src: string) => {
    const alt = ALT_ATTR_RE.exec(tag)?.[1] ?? '';
    sink?.images.push({ src, alt });
    return '';
  });
  s = s.replace(IMAGE_RE, (_m: string, alt: string, src: string) => {
    sink?.images.push({ src, alt });
    return '';
  });
  s = s.replace(LINK_RE, (_m: string, text: string, href: string) => {
    sink?.links.push(href);
    return text;
  });
  // MDX comments and inline JSX/HTML tags (e.g. <br />) carry no prose.
  s = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  s = s.replace(/`+([^`]+?)`+/g, '$1');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '$1');
  s = s.replace(/__([^_]+?)__/g, '$1');
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1$2');
  s = s.replace(/(^|[^_\w])_(?!\s)([^_]+?)_(?!\w)/g, '$1$2');
  s = s.replace(/~~([^~]+?)~~/g, '$1');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, '$1');
  return collapseWhitespace(s);
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Comparison form for quote matching: whitespace collapsed, typographic quotes unified. */
export function normalizeForMatch(s: string): string {
  return collapseWhitespace(s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"'));
}

/** GitHub-style heading slug. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

export function blockText(block: SourceBlock): string {
  switch (block.kind) {
    case 'PARAGRAPH':
    case 'CALLOUT':
      return block.text;
    case 'LIST':
      return block.items.join('\n');
    case 'TABLE':
      return [block.header, ...block.rows].map((row) => row.join(' | ')).join('\n');
    case 'DIAGRAM':
      return [
        block.title,
        block.description,
        ...block.nodes.map((n) => `${n.id}: ${n.label}`),
        ...block.edges.map((e) => `${e.from} ${e.op} ${e.to}${e.label ? `: ${e.label}` : ''}`),
        ...block.notes,
      ]
        .filter(Boolean)
        .join('\n');
    case 'CODE':
      return block.text;
    case 'CARD':
      return `${block.title}: ${block.text}`;
  }
}

export function findSection(source: NormalizedSource, sectionId: string): SourceSection | undefined {
  return source.sections.find((s) => s.id === sectionId);
}

/** A section's own text plus that of its Tab/Step subsections. */
export function sectionScopeText(source: NormalizedSource, sectionId: string): string | null {
  const section = findSection(source, sectionId);
  if (!section) return null;
  const parts = [section.heading, ...section.blocks.map(blockText)];
  for (const child of source.sections) {
    if (child.id.startsWith(`${sectionId}/`)) parts.push(child.heading, ...child.blocks.map(blockText));
  }
  return parts.join('\n');
}

/** Minimum words in a claim quote: a fragment like "a" or "is safe" binds to nothing. */
export const MIN_QUOTE_WORDS = 3;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Index of `needle` in `haystack` as whole words (never inside another word), from `from`. */
export function wordIndex(haystack: string, needle: string, from = 0): number {
  if (!needle) return -1;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, 'gu');
  re.lastIndex = from;
  return re.exec(haystack)?.index ?? -1;
}

export function quoteInSection(source: NormalizedSource, sectionId: string, quote: string): boolean {
  const scope = sectionScopeText(source, sectionId);
  if (scope === null) return false;
  const needle = normalizeForMatch(quote);
  return needle.split(' ').length >= MIN_QUOTE_WORDS && wordIndex(normalizeForMatch(scope), needle) >= 0;
}

/** Decimal/number tokens (e.g. "4", "2.5", "1,000", "20%"). Used to stop fabricated figures. */
export function numberTokens(s: string): string[] {
  return (s.normalize('NFKC').match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []).map((t) => t.replace(/,/g, '').replace(/%$/, ''));
}

/** Spoken/written quantity words that must also be sourced when they quantify something. */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', dozen: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70', eighty: '80', ninety: '90',
  hundred: '100', thousand: '1000', million: '1000000', billion: '1000000000', trillion: '1000000000000',
  half: '1/2', third: '1/3', quarter: '1/4', twice: 'x2', double: 'x2', triple: 'x3', tenfold: 'x10', percent: '%',
};

export function quantityTokens(s: string): string[] {
  const words = (s.normalize('NFKC').toLowerCase().match(/[a-z]+/g) ?? []).flatMap((w) => (Object.hasOwn(NUMBER_WORDS, w) ? [NUMBER_WORDS[w] as string] : []));
  return [...numberTokens(s), ...words];
}

/**
 * Text a viewer will read or hear must be plain: NFKC-stable (no fullwidth or
 * compatibility forms), free of invisible format/control characters (no
 * zero-width joiners hiding words from the copy rules), and Latin-script only in
 * the en-US locale (no homoglyphs). Returns the offending reason, or null.
 */
export function unsafeTextReason(s: string): string | null {
  if (s !== s.normalize('NFKC')) return 'not NFKC-normalized';
  if (/[\p{Cf}\p{Cc}\p{Co}\p{Cn}]/u.test(s)) return 'contains invisible, control, or unassigned characters';
  if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(s)) return 'contains non-Latin-script characters';
  return null;
}
