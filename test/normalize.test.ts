import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadDocsSite, normalizeDocText } from '../src/source/load.ts';
import { buildDocsSite, publishedPage } from '../src/source/docs-site.ts';
import { parseMdx } from '../src/source/parse-mdx.ts';
import { inlineText, quoteInSection } from '../src/source/text.ts';
import { SOURCE_IS_FIXTURE } from '../src/config/load.ts';
import { existsSync } from 'node:fs';
import { canonicalManifest, canonicalPath, canonicalText, mintignoreText } from '../src/source/canonical.ts';
import { committedSnapshot, docText } from './helpers.ts';

const SAMPLE = `---
title: Sample Page
description: "A page used by the normalizer tests."
---

# Sample Page

Intro with **bold**, *emphasis*, \`code\`, and a [link](/elsewhere).

<Note>
  Keep this **distinct**.
</Note>

## Tiers

| Tier | Meaning |
|---|---|
| Monitor | Low urgency. |

\`\`\`mermaid
stateDiagram-v2
    accTitle: Two states
    accDescr: Monitor comes before Review.
    [*] --> Monitor
    Monitor --> Review: escalate
    Monitor: Monitor (low)
    classDef input fill:#FAF8F3
    class Monitor input
\`\`\`

<Tabs>
  <Tab title="Monitor">
    - **Action:** Keep monitoring.
  </Tab>
</Tabs>
`;

const norm = (text: string) => normalizeDocText('docs/sample.mdx', text, { domains: ['GENERAL'] });

describe('MDX normalization', () => {
  test('reads frontmatter, outline, tables, callouts, tabs, and diagrams', () => {
    const doc = parseMdx(SAMPLE);
    assert.equal(doc.title, 'Sample Page');
    assert.equal(doc.description, 'A page used by the normalizer tests.');
    assert.deepEqual(doc.sections.map((s) => s.id), ['sample-page', 'tiers', 'tiers/monitor']);
    const intro = doc.sections[0]!;
    assert.deepEqual(intro.blocks[0], { kind: 'PARAGRAPH', text: 'Intro with bold, emphasis, code, and a link.' });
    assert.deepEqual(intro.blocks[1], { kind: 'CALLOUT', variant: 'NOTE', text: 'Keep this distinct.' });
    const tiers = doc.sections[1]!;
    assert.deepEqual(tiers.blocks[0], { kind: 'TABLE', header: ['Tier', 'Meaning'], rows: [['Monitor', 'Low urgency.']] });
    const diagram = tiers.blocks[1]!;
    assert.equal(diagram.kind, 'DIAGRAM');
    if (diagram.kind === 'DIAGRAM') {
      assert.equal(diagram.title, 'Two states');
      assert.deepEqual(diagram.nodes, [
        { id: 'Monitor', label: 'Monitor (low)' },
        { id: 'Review', label: 'Review' },
      ]);
      assert.deepEqual(diagram.edges, [{ from: 'Monitor', to: 'Review', op: '-->', label: 'escalate' }]);
    }
    assert.deepEqual(doc.sections[2]!.blocks[0], { kind: 'LIST', items: ['Action: Keep monitoring.'] });
    assert.deepEqual(doc.links, ['/elsewhere']);
  });

  test('content hash ignores line endings, emphasis, link targets, and diagram styling', () => {
    const base = norm(SAMPLE);
    assert.equal(norm(SAMPLE.replace(/\n/g, '\r\n')).hashes.content, base.hashes.content, 'CRLF');
    assert.equal(norm(SAMPLE.replace('**bold**', '__bold__')).hashes.content, base.hashes.content, 'emphasis');
    const relinked = norm(SAMPLE.replace('(/elsewhere)', '(/moved)'));
    assert.equal(relinked.hashes.content, base.hashes.content, 'link target');
    assert.notEqual(relinked.hashes.links, base.hashes.links);
    assert.equal(norm(SAMPLE.replace('fill:#FAF8F3', 'fill:#000000')).hashes.content, base.hashes.content, 'diagram styling');
    assert.notEqual(norm(SAMPLE.replace('Low urgency.', 'High urgency.')).hashes.content, base.hashes.content, 'meaning');
  });

  test('multi-line JSX opening tags are read as tags, not prose', () => {
    const doc = parseMdx(`# T\n\n<Card\n  title="Holder Wall"\n  href="/features/holder-wall"\n>\n  See who holds a token > 1 wallet.\n</Card>\n`);
    assert.deepEqual(doc.sections[0]!.blocks, [{ kind: 'CARD', title: 'Holder Wall', text: 'See who holds a token > 1 wallet.', href: '/features/holder-wall' }]);
  });

  test('displayed wrapper attributes are content', () => {
    const base = `# T\n\n<Expandable title="Factor weights">\n  Body.\n</Expandable>\n\n<Columns cols={2} title="Shown title">\n</Columns>\n`;
    assert.notEqual(norm(base).hashes.content, norm(base.replace('Factor weights', 'Factor caps')).hashes.content);
    assert.notEqual(norm(base).hashes.content, norm(base.replace('Shown title', 'Other title')).hashes.content);
  });

  test('Mermaid link operators are meaning; class shorthand and style lines are not', () => {
    const base = norm(SAMPLE);
    assert.notEqual(norm(SAMPLE.replace('Monitor --> Review', 'Monitor --- Review')).hashes.content, base.hashes.content, 'arrow -> line');
    assert.equal(norm(SAMPLE.replace('Monitor --> Review', 'Monitor:::hot --> Review')).hashes.content, base.hashes.content, ':::class');
    const withNode = parseMdx('```mermaid\nflowchart LR\n  classify --> style_guard\n```\n').sections[0]!.blocks[0]!;
    assert.ok(withNode.kind === 'DIAGRAM' && withNode.edges.length === 1, 'nodes named like keywords are not styling');
  });

  test('.mintignore patterns follow gitignore semantics', () => {
    const site = buildDocsSite('https://docs.example', JSON.stringify({ navigation: ['a/page', 'notes'] }), '/*.md\nbuild/\ndrafts\n');
    assert.equal(publishedPage(site, 'docs/notes.md').reason, 'MINTIGNORED', 'leading slash anchors at the docs root');
    assert.equal(publishedPage(site, 'docs/a/page.mdx').published, true, 'anchored root pattern does not reach subdirectories');
    assert.equal(publishedPage(site, 'docs/build/x.mdx').reason, 'MINTIGNORED', 'trailing slash = directory');
    assert.equal(publishedPage(site, 'docs/a/drafts/y.mdx').reason, 'MINTIGNORED', 'slash-less pattern matches at any depth');
  });

  test('inline text keeps prose and drops markup', () => {
    assert.equal(inlineText('Use `fresh-wallet` — see [Vault](/features/vault).'), 'Use fresh-wallet — see Vault.');
    assert.equal(inlineText('A <br /> break'), 'A break');
  });

  test('the committed snapshot is exactly what the live doc normalizes to', () => {
    const snap = committedSnapshot();
    const live = normalizeDocText(snap.docPath, docText(), { domains: snap.domains });
    // Image hashes are filled by the Node loader; this doc has none.
    assert.deepEqual(live, snap);
  });

  test('quotes resolve within a section scope including its tabs', () => {
    const snap = committedSnapshot();
    assert.ok(quoteInSection(snap, 'the-shared-risk-tiers', 'Low urgency — nothing to act on yet.'));
    assert.ok(quoteInSection(snap, 'tier-by-tier-actions', 'Keep monitoring. No migration step is needed yet.'));
    assert.ok(!quoteInSection(snap, 'the-shared-risk-tiers', 'Every assessment normalizes into one of five tiers.'));
  });

  test('published-page status follows docs.json navigation', () => {
    const site = loadDocsSite();
    const page = publishedPage(site, 'docs/concepts/migration-readiness.mdx');
    assert.equal(page.published, true);
    assert.equal(page.url, 'https://docs.walletwall.org/concepts/migration-readiness');
    assert.equal(publishedPage(site, 'docs/concepts/not-a-page.mdx').reason, 'NOT_IN_NAVIGATION');
  });

  test('the real .mintignore excludes internal pages and no navigation page', { skip: SOURCE_IS_FIXTURE && 'needs WALLETWALL_SOURCE_ROOT (the mirror withholds .mintignore)' }, () => {
    const site = buildDocsSite('https://docs.walletwall.org', canonicalText('docs/docs.json'), mintignoreText());
    assert.equal(publishedPage(site, 'docs/internal/any-page.md').reason, 'MINTIGNORED');
    let pages = 0;
    for (const slug of site.pages.keys()) {
      for (const ext of ['.mdx', '.md']) {
        if (!canonicalPath(`docs/${slug}${ext}`) || !existsSync(canonicalPath(`docs/${slug}${ext}`)!)) continue;
        pages++;
        assert.notEqual(publishedPage(site, `docs/${slug}${ext}`).reason, 'MINTIGNORED', slug);
      }
    }
    assert.ok(pages >= 40, `checked ${pages} navigation page files`);
  });

  test('the mirror withholds .mintignore and records that it excluded no navigation page', () => {
    const withheld = canonicalManifest().withheld['docs/.mintignore'];
    assert.equal(withheld?.navigationPagesExcluded, 0);
    assert.match(withheld?.blob ?? '', /^[0-9a-f]{40}$/);
    assert.ok(!Object.hasOwn(canonicalManifest().files, 'docs/.mintignore'), 'never mirrored');
  });
});
