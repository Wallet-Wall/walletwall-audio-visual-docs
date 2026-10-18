// Deterministic, dependency-free reader for WalletWall's Mintlify MDX pages.
//
// It is intentionally a reader, not a general MDX compiler: it understands the
// constructs the docs actually use (frontmatter, headings, paragraphs, lists,
// tables, fenced code, Mermaid diagrams, Note/Warning/Tip callouts, Tabs/Steps/
// Accordions as subsections, Cards) and reduces them to plain, comparable text.
// Unknown JSX wrappers are dropped while their inner prose is kept.
//
// Isomorphic: no Node imports. See ./load.ts for file access and hashing.

import { inlineText, slugify, type InlineSink } from './text.ts';
import type { DiagramBlock, DiagramEdge, DiagramNode, SourceBlock, SourceSection } from './types.ts';

export const NORMALIZER_VERSION = 'walletwall-mdx-normalizer/2';

export interface ParsedDoc {
  title: string;
  description: string;
  sections: SourceSection[];
  links: string[];
  images: { src: string; alt: string }[];
}

const CALLOUT_TAGS = new Set(['Note', 'Warning', 'Tip', 'Info', 'Check', 'Danger']);
const SUBSECTION_TAGS = new Set(['Tab', 'Step', 'Accordion', 'Expandable', 'Update']);
/** Attributes whose values Mintlify displays; edits to them must reach the hash. */
const DISPLAYED_ATTRS = ['title', 'label', 'description'];

/** Normalize line endings and strip a BOM so hashes are platform-independent. */
export function normalizeEol(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function parseMdx(rawText: string): ParsedDoc {
  const text = normalizeEol(rawText);
  const sink: InlineSink = { links: [], images: [] };
  const { frontmatter, body } = splitFrontmatter(text);

  const sections: SourceSection[] = [];
  const usedIds = new Map<string, number>();
  const uniqueId = (base: string): string => {
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  };

  const root: SourceSection = { id: 'intro', heading: frontmatter.title ?? '', depth: 0, parentId: null, blocks: [] };
  sections.push(root);
  usedIds.set('intro', 1);
  // Heading sections form the outline; Tab/Step/Accordion push a subsection onto this stack.
  const stack: SourceSection[] = [root];
  const current = (): SourceSection => stack[stack.length - 1] as SourceSection;

  const lines = joinMultilineTags(body.split('\n'));
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    const t = inlineText(paragraph.join(' '), sink);
    if (t) current().blocks.push({ kind: 'PARAGRAPH', text: t });
    paragraph = [];
  };
  const flushList = (): void => {
    if (listItems.length === 0) return;
    const items = listItems.map((i) => inlineText(i, sink)).filter(Boolean);
    if (items.length) current().blocks.push({ kind: 'LIST', items });
    listItems = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();

    // Fenced code / diagrams.
    const fence = /^(`{3,}|~{3,})\s*([\w-]*)/.exec(trimmed);
    if (fence) {
      flushAll();
      const marker = fence[1] as string;
      const language = (fence[2] ?? '').toLowerCase();
      const content: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trim().startsWith(marker)) {
        content.push(lines[i] as string);
        i++;
      }
      const block: SourceBlock = language === 'mermaid' ? parseMermaid(content) : { kind: 'CODE', language, text: content.join('\n').trimEnd() };
      current().blocks.push(block);
      continue;
    }

    if (trimmed === '') {
      flushAll();
      continue;
    }

    // MDX block comments.
    if (trimmed.startsWith('{/*')) {
      flushAll();
      while (i < lines.length && !(lines[i] as string).includes('*/}')) i++;
      continue;
    }

    // Headings start a new top-level outline section (closing any open subsections).
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed);
    if (heading) {
      flushAll();
      const depth = (heading[1] as string).length;
      const headingText = inlineText(heading[2] as string, sink);
      while (stack.length > 1 && (current().depth >= depth || current().id.includes('/'))) stack.pop();
      const section: SourceSection = {
        id: uniqueId(slugify(headingText) || 'section'),
        heading: headingText,
        depth,
        parentId: current().id,
        blocks: [],
      };
      sections.push(section);
      stack.push(section);
      continue;
    }

    // Callouts: <Note> ... </Note>, possibly on one line.
    const callout = /^<(\w+)(?:\s[^>]*)?>(.*)$/.exec(trimmed);
    if (callout && CALLOUT_TAGS.has(callout[1] as string)) {
      flushAll();
      const tag = callout[1] as string;
      const inner: string[] = [];
      let rest = callout[2] ?? '';
      const close = `</${tag}>`;
      while (!rest.includes(close)) {
        inner.push(rest);
        i++;
        if (i >= lines.length) break;
        rest = lines[i] as string;
      }
      inner.push(rest.split(close)[0] ?? '');
      const textBody = inner
        .map((l) => l.trim().replace(/^[-*]\s+|^\d+\.\s+/, ''))
        .filter(Boolean)
        .join(' ');
      current().blocks.push({ kind: 'CALLOUT', variant: tag.toUpperCase(), text: inlineText(textBody, sink) });
      continue;
    }

    // Cards: <Card title="..." href="...">text</Card>
    const card = /^<Card\b([^>]*)>(.*)$/.exec(trimmed);
    if (card) {
      flushAll();
      const attrs = card[1] ?? '';
      const inner: string[] = [];
      let rest = card[2] ?? '';
      while (!rest.includes('</Card>')) {
        inner.push(rest);
        i++;
        if (i >= lines.length) break;
        rest = lines[i] as string;
      }
      inner.push(rest.split('</Card>')[0] ?? '');
      const href = attr(attrs, 'href');
      if (href) sink.links.push(href);
      current().blocks.push({
        kind: 'CARD',
        title: inlineText(attr(attrs, 'title') ?? '', sink),
        text: inlineText(inner.join(' '), sink),
        href: href ?? '',
      });
      continue;
    }

    // Subsections: <Tab title="...">, <Step title="...">, <Accordion title="...">
    const sub = /^<(\w+)\b([^>]*)>$/.exec(trimmed);
    if (sub && SUBSECTION_TAGS.has(sub[1] as string)) {
      flushAll();
      // A previous sibling subsection is closed by its own closing tag; be lenient if it was not.
      while (current().id.includes('/')) stack.pop();
      const parent = current();
      const title = inlineText(attr(sub[2] ?? '', 'title') ?? attr(sub[2] ?? '', 'label') ?? sub[1] ?? '', sink);
      const description = attr(sub[2] ?? '', 'description');
      const section: SourceSection = {
        id: uniqueId(`${parent.id}/${slugify(title) || 'item'}`),
        heading: title,
        depth: parent.depth + 1,
        parentId: parent.id,
        blocks: [],
      };
      if (description) section.blocks.push({ kind: 'PARAGRAPH', text: inlineText(description, sink) });
      sections.push(section);
      stack.push(section);
      continue;
    }
    const subClose = /^<\/(\w+)>$/.exec(trimmed);
    if (subClose && SUBSECTION_TAGS.has(subClose[1] as string)) {
      flushAll();
      if (current().id.includes('/')) stack.pop();
      continue;
    }

    // Any other standalone JSX wrapper line (<Tabs>, <Columns cols={2}>, </Frame>, ...): no body prose,
    // but displayed attributes (title / label / description) are content.
    if (/^<\/?[A-Z][\w.]*\b[^>]*>$/.test(trimmed) || /^<\/?[A-Z][\w.]*\b[^>]*\/>$/.test(trimmed)) {
      flushAll();
      inlineText(trimmed, sink); // still record <img src> etc.
      const shown = DISPLAYED_ATTRS.map((a) => attr(trimmed, a)).filter((v): v is string => Boolean(v));
      if (shown.length) current().blocks.push({ kind: 'PARAGRAPH', text: inlineText(shown.join(' — '), sink) });
      continue;
    }

    // Tables.
    if (trimmed.startsWith('|')) {
      flushAll();
      const rows: string[] = [];
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        rows.push((lines[i] as string).trim());
        i++;
      }
      i--;
      const cells = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r)).map((r) => splitRow(r).map((c) => inlineText(c, sink)));
      const [header = [], ...body2] = cells;
      current().blocks.push({ kind: 'TABLE', header, rows: body2 });
      continue;
    }

    // Lists (nested items are flattened; continuation lines join their item).
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      listItems.push(item[1] ?? '');
      continue;
    }
    if (listItems.length > 0 && /^\s{2,}\S/.test(line)) {
      listItems[listItems.length - 1] += ` ${trimmed}`;
      continue;
    }

    // Horizontal rules and blockquote markers.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      continue;
    }
    flushList();
    paragraph.push(trimmed.replace(/^>\s?/, ''));
  }
  flushAll();

  // Drop the empty intro section when the doc opens with a heading.
  const kept = sections.filter((s) => s.id !== 'intro' || s.blocks.length > 0);
  return {
    title: frontmatter.title ?? kept.find((s) => s.depth === 1)?.heading ?? '',
    description: frontmatter.description ?? '',
    sections: kept,
    links: [...new Set(sink.links)].sort(),
    images: sink.images,
  };
}

function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: {}, body: text };
  const frontmatter: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (m) frontmatter[m[1] as string] = unquote((m[2] ?? '').trim());
  }
  const after = text.indexOf('\n', end + 4);
  return { frontmatter, body: after < 0 ? '' : text.slice(after + 1) };
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{"([^"]*)"\\})`).exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function splitRow(row: string): string[] {
  const inner = row.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

// ── Mermaid ─────────────────────────────────────────────────────────────────
// Only the meaning of a diagram is kept: title, description, nodes, edges,
// notes. classDef/class/style/linkStyle lines are styling and are ignored, so
// recoloring a diagram is a STYLE change, not a DIAGRAM change.

const STYLE_LINE = /^(?:(?:classDef|class|style|linkStyle|direction)\b|%%)/;
const EDGE_RE = /^(.+?)\s*(-->|---|-\.->|==>|--x|--o)\s*(?:\|([^|]*)\|\s*)?(.+?)$/;
const NODE_SHAPE_RE = /^([\w*[\]-]+?)\s*(?:\[\[?\(?\/?"?([^\]")]*)"?\/?\)?\]?\]|\(\(?"?([^)"]*)"?\)?\)|\{"?([^}"]*)"?\})?$/;

/**
 * Join a JSX opening tag whose attributes span several lines into one line, so
 * `<Card\n  title="x"\n  href="/y"\n>` is read as a tag, never as prose or a
 * blockquote. Fenced code is left untouched.
 */
export function joinMultilineTags(lines: string[]): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const t = line.trim();
    const f = /^(`{3,}|~{3,})/.exec(t);
    if (f) fence = fence === null ? (f[1] as string) : t.startsWith(fence) ? null : fence;
    if (fence === null && /^<[A-Z][\w.]*(\s|$)/.test(t) && !t.includes('>')) {
      const parts = [t];
      while (i + 1 < lines.length && !parts[parts.length - 1]!.includes('>')) parts.push((lines[++i] as string).trim());
      out.push(parts.join(' ').replace(/\s+>/, '>'));
      continue;
    }
    out.push(line);
  }
  return out;
}

export function parseMermaid(content: string[]): DiagramBlock {
  const lines = content.map((l) => l.trim()).filter((l) => l.length > 0);
  const diagramType = (lines[0] ?? '').split(/\s+/)[0] ?? '';
  let title = '';
  let description = '';
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const notes: string[] = [];

  const touch = (rawWithClass: string): string | null => {
    // `A:::cls` is styling shorthand, not part of the node.
    const raw = rawWithClass.replace(/:::[\w-]+/g, '');
    const m = NODE_SHAPE_RE.exec(raw.trim());
    const id = (m?.[1] ?? raw.trim()).trim();
    if (!id || id === '[*]') return null;
    const label = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim();
    const existing = nodes.get(id);
    if (!existing) nodes.set(id, { id, label: label || id });
    else if (label) existing.label = label;
    return id;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (STYLE_LINE.test(line)) continue;
    if (line.startsWith('accTitle:')) {
      title = line.slice('accTitle:'.length).trim();
      continue;
    }
    if (line.startsWith('accDescr:')) {
      description = line.slice('accDescr:'.length).trim();
      continue;
    }
    if (/^accDescr\s*\{/.test(line)) {
      const parts: string[] = [];
      while (++i < lines.length && !(lines[i] as string).startsWith('}')) parts.push(lines[i] as string);
      description = parts.join(' ');
      continue;
    }
    if (/^note\b/i.test(line)) {
      const inline = /:\s*(.+)$/.exec(line);
      if (inline) {
        notes.push(inline[1] as string);
        continue;
      }
      const parts: string[] = [];
      while (++i < lines.length && !/^end note$/i.test(lines[i] as string)) parts.push(lines[i] as string);
      notes.push(parts.join(' '));
      continue;
    }
    const edge = EDGE_RE.exec(line);
    if (edge) {
      const [, left = '', , pipeLabel, rightRaw = ''] = edge;
      const [right = '', colonLabel] = rightRaw.split(/\s*:\s*(.*)/);
      const from = touch(left);
      const to = touch(right);
      if (from && to) edges.push({ from, to, op: edge[2] ?? '-->', label: (pipeLabel ?? colonLabel ?? '').trim() });
      continue;
    }
    const decl = /^([\w-]+)\s*:\s*(.+)$/.exec(line);
    if (decl) {
      const id = decl[1] as string;
      nodes.set(id, { id, label: (decl[2] as string).trim() });
      continue;
    }
    touch(line);
  }

  return {
    kind: 'DIAGRAM',
    language: 'mermaid',
    diagramType,
    title,
    description,
    nodes: [...nodes.values()],
    edges,
    notes: notes.map((n) => n.replace(/\s+/g, ' ').trim()),
  };
}
