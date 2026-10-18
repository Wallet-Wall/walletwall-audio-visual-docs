// Docs-change classification for versioned video derivatives.
//
// A YouTube upload is immutable, so a doc edit must be classified before
// anything is regenerated: punctuation never triggers a new video, a changed
// claim always marks the video stale. The classifier compares the committed
// normalized snapshot (what the video was planned against) with the live doc,
// and attributes every change to the claims and segments it touches.
// Isomorphic.

import { blockText, findSection, normalizeForMatch, quoteInSection, sectionScopeText } from '../source/text.ts';
import type { DiagramBlock, NormalizedSource } from '../source/types.ts';
import type { Claim, VideoSpec } from '../spec/types.ts';
import type { ChangeCategory } from '../spec/vocabulary.ts';

export interface DocChange {
  category: ChangeCategory;
  detail: string;
  claimIds: string[];
  segmentIds: string[];
  /** True when the change touches something this video actually shows or says. */
  affectsVideo: boolean;
}

export interface ChangeReport {
  schema: 'walletwall.doc-change-report/v1';
  videoId: string;
  docPath: string;
  fromContentHash: string;
  toContentHash: string;
  changes: DocChange[];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

const tokens = (s: string): string[] => normalizeForMatch(s).split(' ').filter(Boolean);

/**
 * Typo-level: same number of words, and every differing word is a single
 * character edit of a long word. Deliberately strict, because a false "typo"
 * leaves a wrong video marked CURRENT:
 * - numbers, signs, and symbol-bearing tokens ("1.5", "-5", "$5", "5%",
 *   "testnet-only") are compared exactly;
 * - short words ("not"/"now", "four"/"five") are compared exactly;
 * - affix changes are meaning changes ("conditional"/"unconditional",
 *   "blocked"/"unblocked", "valid"/"invalid", "tier"/"tiers").
 */
export function isTypoLevel(before: string, after: string): boolean {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length !== b.length) return false;
  const core = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x === y) continue;
    diffs++;
    const symbolic = (w: string) => /[\d$%+\-−±<>=/]/.test(w.replace(/[.,;:!?"')(]+$/, '').replace(/^["'(]+/, ''));
    if (symbolic(x) || symbolic(y)) return false;
    const cx = core(x);
    const cy = core(y);
    if (cx === cy) continue; // case or trailing punctuation only
    if (cx.length <= 4 || cy.length <= 4) return false;
    if (cx.startsWith(cy) || cy.startsWith(cx) || cx.endsWith(cy) || cy.endsWith(cx)) return false;
    if (levenshtein(cx, cy) > 1) return false;
  }
  return diffs <= Math.max(1, Math.ceil(a.length * 0.1));
}

/** Best typo-level match for a quote in a section scope (same-length word windows). */
function typoMatch(scope: string, quote: string): boolean {
  const s = tokens(scope);
  const q = tokens(quote);
  for (let i = 0; i + q.length <= s.length; i++) {
    if (isTypoLevel(q.join(' '), s.slice(i, i + q.length).join(' '))) return true;
  }
  return false;
}

interface ClaimUse {
  segmentIds: Set<string>;
  graph: boolean;
  takeaway: boolean;
}

function claimUsage(spec: VideoSpec): Map<string, ClaimUse> {
  const uses = new Map<string, ClaimUse>();
  const use = (id: string, segmentId: string, graph: boolean, takeaway: boolean) => {
    const u = uses.get(id) ?? { segmentIds: new Set<string>(), graph: false, takeaway: false };
    u.segmentIds.add(segmentId);
    u.graph ||= graph;
    u.takeaway ||= takeaway;
    uses.set(id, u);
  };
  for (const seg of spec.segments) {
    const takeaway = seg.role === 'TAKEAWAY';
    for (const l of seg.narration) for (const id of l.claimIds) use(id, seg.id, false, takeaway);
    const s = seg.scene;
    if (!s) continue;
    if (s.type === 'GRAPH') {
      if (s.orderingClaimId) use(s.orderingClaimId, seg.id, true, takeaway);
      for (const n of s.nodes) for (const id of [...n.claimIds, ...(n.detail?.claimIds ?? [])]) use(id, seg.id, true, takeaway);
      for (const e of s.edges) for (const id of e.claimIds) use(id, seg.id, true, takeaway);
      for (const id of s.caption?.claimIds ?? []) use(id, seg.id, false, takeaway);
    } else {
      const texts = s.type === 'CARD' ? [s.heading, ...s.body] : s.type === 'TAKEAWAY' ? [s.statement, ...s.support] : [s.caption];
      for (const t of texts) for (const id of t.claimIds) use(id, seg.id, false, takeaway);
    }
  }
  return uses;
}

function diagrams(source: NormalizedSource): { sectionId: string; index: number; block: DiagramBlock }[] {
  return source.sections.flatMap((s) =>
    s.blocks.flatMap((b, i) => (b.kind === 'DIAGRAM' ? [{ sectionId: s.id, index: i, block: b }] : [])),
  );
}

const structure = (d: DiagramBlock): string => JSON.stringify({ n: d.nodes, e: d.edges });

export function classifyDocChange(spec: VideoSpec, before: NormalizedSource, after: NormalizedSource): ChangeReport {
  const report: ChangeReport = {
    schema: 'walletwall.doc-change-report/v1',
    videoId: spec.id,
    docPath: spec.source.docPath,
    fromContentHash: before.hashes.content,
    toContentHash: after.hashes.content,
    changes: [],
  };
  if (before.hashes.raw === after.hashes.raw) return report;
  const add = (c: DocChange) => report.changes.push(c);
  const usage = claimUsage(spec);

  // 1. Claims: the strongest signal. A cited span that no longer exists is a material change.
  const explained = new Set<string>();
  for (const claim of spec.claims) {
    const spans = claim.evidence.filter((e) => e.kind === 'DOC_SPAN');
    const broken = spans.filter((e) => !quoteInSection(after, e.sectionId, e.quote));
    if (broken.length === 0) continue;
    for (const e of broken) explained.add(e.sectionId);
    const u = usage.get(claim.id);
    const segmentIds = [...(u?.segmentIds ?? [])];
    const typo = broken.every((e) => {
      const scope = sectionScopeText(after, e.sectionId);
      return scope !== null && typoMatch(scope, e.quote);
    });
    if (typo) {
      add({ category: 'TYPO_ONLY', detail: `claim ${claim.id}: cited span changed only at typo level`, claimIds: [claim.id], segmentIds, affectsVideo: false });
      continue;
    }
    add({
      category: categoryForClaim(claim, u),
      detail: `claim ${claim.id}: cited span no longer in the source (${broken.map((e) => `"${e.quote}"`).join(', ')})`,
      claimIds: [claim.id],
      segmentIds,
      affectsVideo: true,
    });
  }

  // 2. Diagrams: structure changes regenerate the scenes that draw from them.
  const beforeDiagrams = diagrams(before);
  const afterDiagrams = diagrams(after);
  for (const d of beforeDiagrams) {
    const match = afterDiagrams.find((x) => x.sectionId === d.sectionId && x.index === d.index) ?? afterDiagrams.find((x) => x.sectionId === d.sectionId);
    if (match && structure(match.block) === structure(d.block)) continue;
    const text = normalizeForMatch(blockText(d.block));
    const dependent = spec.claims.filter((c) => c.evidence.some((e) => e.kind === 'DOC_SPAN' && text.includes(normalizeForMatch(e.quote))));
    const segmentIds = [...new Set(dependent.flatMap((c) => [...(usage.get(c.id)?.segmentIds ?? [])]))];
    explained.add(d.sectionId);
    add({ category: 'DIAGRAM_CHANGED', detail: `diagram in §${d.sectionId} changed structure`, claimIds: dependent.map((c) => c.id), segmentIds, affectsVideo: segmentIds.length > 0 });
  }

  // 3. Screenshots / images.
  if (before.hashes.images !== after.hashes.images) {
    const shown = new Set(spec.assets.map((a) => a.path));
    const changed = after.images.filter((img) => !before.images.some((b) => b.src === img.src && b.sha256 === img.sha256));
    const affects = changed.some((img) => [...shown].some((p) => p.endsWith(img.src.replace(/^\//, ''))));
    add({ category: 'SCREENSHOT_CHANGED', detail: `${changed.length} image(s) changed`, claimIds: [], segmentIds: [], affectsVideo: affects });
  }

  // 4. Everything else, by section.
  if (before.hashes.content === after.hashes.content) {
    if (before.hashes.links !== after.hashes.links) add({ category: 'LINK_ONLY', detail: 'link targets changed', claimIds: [], segmentIds: [], affectsVideo: false });
    else if (!report.changes.length) add({ category: 'STYLE_ONLY', detail: 'formatting, emphasis, or diagram styling only', claimIds: [], segmentIds: [], affectsVideo: false });
    return report;
  }
  const ids = new Set([...Object.keys(before.hashes.sections), ...Object.keys(after.hashes.sections)]);
  for (const id of ids) {
    if (before.hashes.sections[id] === after.hashes.sections[id] || explained.has(id)) continue;
    const a = findSection(before, id);
    const b = findSection(after, id);
    const typo = a && b && a.heading === b.heading && isTypoLevel(sectionScopeText(before, id) ?? '', sectionScopeText(after, id) ?? '');
    add({
      category: typo ? 'TYPO_ONLY' : 'MINOR_EXPLANATION',
      detail: `§${id} ${!a ? 'added' : !b ? 'removed' : typo ? 'typo-level edit' : 'explanation changed; no cited claim affected'}`,
      claimIds: [],
      segmentIds: [],
      affectsVideo: false,
    });
  }
  if (before.hashes.links !== after.hashes.links) add({ category: 'LINK_ONLY', detail: 'link targets changed', claimIds: [], segmentIds: [], affectsVideo: false });

  // Page-level meaning outside any section body: title (shown on the docs-reference card),
  // description (used in the YouTube description), and the outline itself.
  if (before.title !== after.title) add({ category: 'MINOR_EXPLANATION', detail: `title changed ("${before.title}" -> "${after.title}")`, claimIds: [], segmentIds: [], affectsVideo: true });
  if (before.description !== after.description) add({ category: 'MINOR_EXPLANATION', detail: 'description changed', claimIds: [], segmentIds: [], affectsVideo: false });
  const outline = (s: NormalizedSource) => JSON.stringify(s.sections.map((x) => [x.id, x.depth, x.parentId]));
  if (outline(before) !== outline(after) && !report.changes.some((c) => c.category === 'MINOR_EXPLANATION')) {
    add({ category: 'MINOR_EXPLANATION', detail: 'section outline changed', claimIds: [], segmentIds: [], affectsVideo: false });
  }
  if (before.normalizerVersion !== after.normalizerVersion) {
    add({ category: 'MINOR_EXPLANATION', detail: `normalizer ${before.normalizerVersion} -> ${after.normalizerVersion}; re-plan to rebaseline the snapshot`, claimIds: [], segmentIds: [], affectsVideo: false });
  }
  if (report.changes.length === 0) {
    // Content moved but nothing above explains it: never report "no change".
    add({ category: 'MINOR_EXPLANATION', detail: 'content changed outside any classified region', claimIds: [], segmentIds: [], affectsVideo: false });
  }
  return report;
}

function categoryForClaim(claim: Claim, use: ClaimUse | undefined): ChangeCategory {
  if (use?.takeaway) return 'CONCLUSION_CHANGED';
  if (use?.graph) return 'MECHANISM_CHANGED';
  return 'CLAIM_CHANGED';
}
