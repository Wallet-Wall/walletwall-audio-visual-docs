// Normalized source model: the provider-neutral, renderer-neutral reading of one
// authoritative doc. Planners select meaning from it; validation checks every
// claim against it; staleness classification diffs two versions of it.

export const NORMALIZED_SOURCE_SCHEMA = 'walletwall.normalized-source/v1';

export interface NormalizedSource {
  schema: typeof NORMALIZED_SOURCE_SCHEMA;
  normalizerVersion: string;
  docPath: string;
  title: string;
  description: string;
  sections: SourceSection[];
  /** Sorted, de-duplicated link targets. Excluded from the meaningful-content hash. */
  links: string[];
  images: SourceImage[];
  /** Topic domains declared for the doc (drives e.g. whether quantum audio semantics are allowed). */
  domains: SourceDomain[];
  hashes: SourceHashes;
}

export type SourceDomain = 'QUANTUM' | 'VAULT' | 'DATA_FOUNDATION' | 'WHALE_WATCHER' | 'ARCHITECTURE' | 'GENERAL';

export interface SourceHashes {
  /** Meaningful content: headings, text, tables, diagram structure. Insensitive to EOL, emphasis, link targets, diagram styling. */
  content: string;
  /** EOL-normalized raw document bytes. */
  raw: string;
  links: string;
  images: string;
  sections: Record<string, string>;
}

export interface SourceSection {
  /** GitHub-style slug; Tab/Step subsections are `<parent>/<slug>`. */
  id: string;
  heading: string;
  depth: number;
  parentId: string | null;
  blocks: SourceBlock[];
}

export type SourceBlock = ParagraphBlock | ListBlock | TableBlock | CalloutBlock | DiagramBlock | CodeBlock | CardBlock;

export interface ParagraphBlock {
  kind: 'PARAGRAPH';
  text: string;
}

export interface ListBlock {
  kind: 'LIST';
  items: string[];
}

export interface TableBlock {
  kind: 'TABLE';
  header: string[];
  rows: string[][];
}

export interface CalloutBlock {
  kind: 'CALLOUT';
  variant: string;
  text: string;
}

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  /** Mermaid link operator ("-->", "---", "-.->", "==>", "--x", "--o"): part of the meaning. */
  op: string;
  label: string;
}

export interface DiagramBlock {
  kind: 'DIAGRAM';
  language: 'mermaid';
  diagramType: string;
  title: string;
  description: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  notes: string[];
}

export interface CodeBlock {
  kind: 'CODE';
  language: string;
  text: string;
}

export interface CardBlock {
  kind: 'CARD';
  title: string;
  text: string;
  href: string;
}

export interface SourceImage {
  src: string;
  alt: string;
  /** Filled by the Node-side loader when the image resolves to a repo file. */
  sha256: string | null;
}
