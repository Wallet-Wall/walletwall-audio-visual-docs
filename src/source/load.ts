// Node-side loading: read a doc from the canonical WalletWall tree, normalize
// it, and attach content addresses. Every canonical read goes through
// ./canonical.ts so the parser stays pure.

import path from 'node:path';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { DOCS_URL } from '../brand/repo-constants.ts';
import { canonicalBytes, canonicalText, mintignoreText } from './canonical.ts';
import { buildDocsSite, publishedPage, type DocsSite } from './docs-site.ts';
import { NORMALIZER_VERSION, normalizeEol, parseMdx } from './parse-mdx.ts';
import { NORMALIZED_SOURCE_SCHEMA, type NormalizedSource, type SourceDomain, type SourceImage } from './types.ts';

export function loadDocsSite(): DocsSite {
  return buildDocsSite(DOCS_URL, canonicalText('docs/docs.json'), mintignoreText());
}

/** Navigation group -> topic domain. Data-driven: see config/source-domains.json. */
export function domainsFor(groups: string[], groupDomains: Record<string, SourceDomain[]>): SourceDomain[] {
  const out = new Set<SourceDomain>();
  for (const g of groups) for (const d of groupDomains[g] ?? []) out.add(d);
  if (out.size === 0) out.add('GENERAL');
  return [...out].sort();
}

export function normalizeDocText(
  docPath: string,
  rawText: string,
  options: { domains: SourceDomain[]; resolveImage?: (src: string) => string | null },
): NormalizedSource {
  const parsed = parseMdx(rawText);
  const images: SourceImage[] = parsed.images.map((img) => ({ ...img, sha256: options.resolveImage?.(img.src) ?? null }));
  const meaningful = { title: parsed.title, description: parsed.description, sections: parsed.sections };
  const sectionHashes: Record<string, string> = {};
  for (const s of parsed.sections) sectionHashes[s.id] = contentAddress({ heading: s.heading, blocks: s.blocks });
  return {
    schema: NORMALIZED_SOURCE_SCHEMA,
    normalizerVersion: NORMALIZER_VERSION,
    docPath,
    title: parsed.title,
    description: parsed.description,
    sections: parsed.sections,
    links: parsed.links,
    images,
    domains: options.domains,
    hashes: {
      content: contentAddress(meaningful),
      raw: sha256Hex(normalizeEol(rawText)),
      links: contentAddress(parsed.links),
      images: contentAddress(images),
      sections: sectionHashes,
    },
  };
}

export function loadNormalizedDoc(
  docPath: string,
  groupDomains: Record<string, SourceDomain[]>,
  site: DocsSite = loadDocsSite(),
): NormalizedSource {
  const raw = canonicalText(docPath);
  const page = publishedPage(site, docPath);
  return normalizeDocText(docPath, raw, {
    domains: domainsFor(page.groups, groupDomains),
    resolveImage: (src) => {
      if (/^[a-z]+:/i.test(src)) return null;
      const rel = path.posix.normalize(src.startsWith('/') ? path.posix.join('docs', src) : path.posix.join(path.posix.dirname(docPath), src));
      const bytes = canonicalBytes(rel);
      return bytes ? sha256Hex(bytes) : null;
    },
  });
}
