// The publishability gate for a VideoSpec. Pure: file access is injected, so
// the same rules run in tests, CI, and the local pipeline.
//
// Rule families (each failure carries a stable IssueCode):
//   shape        strict keys, no generative / styling / code channel
//   vocabulary   scene types, Wallaby actions/expressions, sonic events
//   provenance   every claim resolves to a verbatim doc span or a hashed artifact;
//                every spoken and on-screen statement cites claims; numbers and
//                graph labels must appear in their evidence (no fabricated data)
//   structure    hook, content, takeaway, CTA, docs reference, outro, end screen
//   character    targets exist in the scene layout; exit actions drive transitions
//   depth        2D -> 3D transitions are earned, budgeted, and balanced
//   duration     class ceiling, natural pace, end-screen window
//   layout       text fits bounded regions inside the YouTube title-safe area
//   copy         neutral wallet language, no hype, one CTA
//   source       content hash current, canonical docs page published

import type { PipelineConfig } from '../config/types.ts';
import { IssueCollector, type ValidationReport } from '../core/issues.ts';
import { effectiveWpm, requestSpokenWords, voiceRequestFor } from '../audio/voice-provider.ts';
import { PROVENANCE_CHIP } from '../layout/brand-layout.ts';
import { CONTENT_BOTTOM, inside, intersects, TITLE_SAFE, type Point } from '../layout/geometry.ts';
import { eyebrowOccupied, layoutScene, wallabyBounds } from '../layout/scene-layout.ts';
import { fitText } from '../layout/text-fit.ts';
import type { PublishedPage } from '../source/docs-site.ts';
import { findSection, MIN_QUOTE_WORDS, normalizeForMatch, quantityTokens, quoteInSection, unsafeTextReason, wordIndex } from '../source/text.ts';
import type { NormalizedSource } from '../source/types.ts';
import { checkNarrationBudget, describeNarrationBudget, narrationBudgetFor } from '../spec/narration-budget.ts';
import { SPEC_SCHEMA, type Claim, type Segment, type VideoSpec, type VisualText } from '../spec/types.ts';
import {
  ASSET_KINDS,
  BRAND_ROLES,
  CLAIM_TYPES,
  CONTENT_ROLES,
  DEPTH_REASONS,
  DEPTH_TRANSITION_BUDGET,
  isOneOf,
  QUANTUM_SONIC_EVENTS,
  SCENE_PLANES,
  SCENE_TYPES,
  SEGMENT_ROLES,
  SONIC_EVENTS,
  TARGETED_ACTIONS,
  TRANSITION_TYPES,
  VIDEO_CLASS_KINDS,
  VIDEO_CLASSES,
  WALLABY_ACTIONS,
  WALLABY_EXPRESSIONS,
  type SegmentRole,
} from '../spec/vocabulary.ts';
import { buildTimeline, EXIT_ACTIONS, type NarrationTrack } from '../timeline/timeline.ts';
import { ASSET_ROOTS, isSafeRepoPath } from './paths.ts';
import { checkKeys, KEYS, scanGenerativeKeys } from './shape.ts';

export interface ValidationContext {
  source: NormalizedSource;
  config: Pick<PipelineConfig, 'templates' | 'policy' | 'voice' | 'lexicon' | 'youtube'>;
  /** Estimated (fixture) or measured (real voice) narration durations. */
  track: NarrationTrack;
  /** Published-page status of the source doc; null skips the docs-site check. */
  page: PublishedPage | null;
  /** Repo-relative path -> content hash (and text for text files), or null when the file does not exist. */
  resolveFile: (repoPath: string) => { sha256: string; text: string | null } | null;
}

const ROLE_RANK: Record<SegmentRole, number> = Object.fromEntries(SEGMENT_ROLES.map((r, i) => [r, i])) as Record<SegmentRole, number>;
const REQUIRED_ONCE: SegmentRole[] = ['HOOK', 'TAKEAWAY', 'CTA', 'DOCS_REFERENCE', 'OUTRO', 'END_SCREEN'];

export function validateSpec(spec: VideoSpec, ctx: ValidationContext): ValidationReport {
  const issues = new IssueCollector();
  try {
    runRules(spec, ctx, issues);
  } catch (err) {
    // Planner output is untrusted: input the rules cannot even evaluate fails closed.
    issues.error('SPEC_SCHEMA_INVALID', 'spec', `validator could not evaluate the document (${err instanceof Error ? err.message : String(err)})`);
  }
  return issues.report();
}

function runRules(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  scanGenerativeKeys(spec, 'spec', issues);
  if (!checkKeys(spec, KEYS.spec, 'spec', issues) || spec.schema !== SPEC_SCHEMA || !Array.isArray(spec.segments) || !Array.isArray(spec.claims)) {
    issues.error('SPEC_SCHEMA_INVALID', 'spec', `expected schema ${SPEC_SCHEMA}`);
    return;
  }
  checkKeys(spec.title, KEYS.title, 'title', issues);
  checkKeys(spec.source, KEYS.source, 'source', issues);
  checkKeys(spec.planner, KEYS.planner, 'planner', issues);
  checkKeys(spec.audio, KEYS.audio, 'audio', issues);
  checkKeys(spec.output, KEYS.output, 'output', issues);
  if (spec.series !== null) checkKeys(spec.series, KEYS.series, 'series', issues);
  if (!isOneOf(VIDEO_CLASS_KINDS, spec.videoClass)) issues.error('SPEC_SCHEMA_INVALID', 'videoClass', String(spec.videoClass));
  if (!ID_RE.test(String(spec.id))) issues.error('SPEC_ID_INVALID', 'id', String(spec.id));
  if (!Number.isInteger(spec.revision) || spec.revision < 1) issues.error('SPEC_SCHEMA_INVALID', 'revision', String(spec.revision));
  // The output format is renderer-owned; every safe-area guarantee assumes it.
  const o = spec.output;
  if (o.width !== 1920 || o.height !== 1080 || o.fps !== 30 || o.captions !== 'SIDECAR') issues.error('SPEC_SCHEMA_INVALID', 'output', 'must be 1920x1080 @ 30 fps with sidecar captions');
  checkIdsTextAndTiming(spec, issues);

  const claims = checkClaims(spec, ctx, issues);
  checkAssets(spec, ctx, issues);
  checkStructure(spec, ctx, issues);
  const cited = new Set<string>();
  spec.segments.forEach((seg, i) => checkSegment(seg, i, spec, claims, cited, ctx, issues));
  for (const c of spec.claims) if (!cited.has(c.id)) issues.warn('CLAIM_UNUSED', `claims[${c.id}]`);
  checkTransitions(spec, issues);
  checkDuration(spec, ctx, issues);
  checkCopy(spec, ctx, issues);
  checkTitleAndSeries(spec, ctx, issues);
  checkSource(spec, ctx, issues);
}

// ── Ids, readable text, and numeric fields ──────────────────────────────────

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LINE_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const RESERVED_IDS = new Set(['eyebrow', 'ui-capture']);

function checkIdsTextAndTiming(spec: VideoSpec, issues: IssueCollector): void {
  const id = (value: unknown, path: string, re = ID_RE): void => {
    if (typeof value !== 'string' || !re.test(value) || RESERVED_IDS.has(value)) issues.error('SPEC_ID_INVALID', path, String(value));
  };
  const text = (value: unknown, path: string): void => {
    const reason = typeof value === 'string' ? unsafeTextReason(value) : 'not a string';
    if (reason) issues.error('TEXT_INVALID_CHARACTERS', path, reason);
  };
  const ms = (value: unknown, path: string, max: number): void => {
    if (value !== undefined && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max)) {
      issues.error('TIMING_INVALID', path, `expected an integer 0..${max} ms`);
    }
  };
  text(spec.title?.topic, 'title.topic');
  spec.claims.forEach((c, i) => {
    id(c?.id, `claims[${i}].id`);
    text(c?.statement, `claims[${i}].statement`);
  });
  spec.assets.forEach((a, i) => id(a?.id, `assets[${i}].id`));
  spec.segments.forEach((seg, i) => {
    const p = `segments[${i}]`;
    id(seg?.id, `${p}.id`);
    (seg?.narration ?? []).forEach((l, j) => {
      id(l?.id, `${p}.narration[${j}].id`, LINE_ID_RE);
      text(l?.text, `${p}.narration[${j}].text`);
      ms(l?.pauseAfterMs, `${p}.narration[${j}].pauseAfterMs`, 5000);
    });
    (seg?.wallaby ?? []).forEach((b, j) => ms(b?.delayMs, `${p}.wallaby[${j}].delayMs`, 10_000));
    (seg?.sonic ?? []).forEach((c, j) => ms(c?.delayMs, `${p}.sonic[${j}].delayMs`, 10_000));
    const scene = seg?.scene;
    if (!scene || typeof scene !== 'object') return;
    const visuals: (VisualText | undefined)[] =
      scene.type === 'CARD'
        ? [scene.heading, ...(scene.body ?? [])]
        : scene.type === 'GRAPH'
          ? [...(scene.caption ? [scene.caption] : []), ...(scene.nodes ?? []).flatMap((n) => [n, ...(n.detail ? [n.detail] : [])])]
          : scene.type === 'UI'
            ? [scene.caption]
            : scene.type === 'TAKEAWAY'
              ? [scene.statement, ...(scene.support ?? [])]
              : [];
    visuals.forEach((v, j) => {
      id(v?.id, `${p}.scene.text[${j}].id`);
      text(v?.text, `${p}.scene.text[${j}].text`);
    });
  });
}

// ── Claims ──────────────────────────────────────────────────────────────────

function checkClaims(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): Map<string, Claim> {
  const byId = new Map<string, Claim>();
  spec.claims.forEach((claim, i) => {
    const path = `claims[${i}]`;
    if (!checkKeys(claim, KEYS.claim, path, issues)) return;
    if (byId.has(claim.id)) issues.error('SPEC_DUPLICATE_ID', path, claim.id);
    byId.set(claim.id, claim);
    if (!isOneOf(CLAIM_TYPES, claim.type)) issues.error('SPEC_SCHEMA_INVALID', `${path}.type`, String(claim.type));
    const spans = claim.evidence.filter((e) => e.kind === 'DOC_SPAN');
    const artifacts = claim.evidence.filter((e) => e.kind === 'ARTIFACT');
    const needsSpan = claim.type === 'DOC_DIRECT' || claim.type === 'DOC_DERIVED' || claim.type === 'INTERPRETATION';
    if (needsSpan && spans.length === 0) issues.error('CLAIM_EVIDENCE_MISSING', path, `${claim.type} needs at least one DOC_SPAN`);
    if (claim.type === 'DOC_DIRECT' && artifacts.length > 0) issues.error('CLAIM_EVIDENCE_MISSING', path, 'DOC_DIRECT evidence must be doc spans only');
    if ((claim.type === 'MEASURED' || claim.type === 'DEMONSTRATED') && artifacts.length === 0) {
      issues.error('CLAIM_EVIDENCE_MISSING', path, `${claim.type} needs a hashed ARTIFACT (a real measurement or demonstration)`);
    }
    claim.evidence.forEach((ev, j) => {
      const ep = `${path}.evidence[${j}]`;
      if (ev.kind === 'DOC_SPAN') {
        checkKeys(ev, KEYS.docSpan, ep, issues);
        if (!findSection(ctx.source, ev.sectionId)) issues.error('CLAIM_SECTION_UNKNOWN', ep, ev.sectionId);
        else if (!quoteInSection(ctx.source, ev.sectionId, ev.quote)) issues.error('CLAIM_QUOTE_NOT_IN_SOURCE', ep, `"${ev.quote}"`);
      } else if (ev.kind === 'ARTIFACT') {
        checkKeys(ev, KEYS.artifact, ep, issues);
        if (!isSafeRepoPath(ev.path)) {
          issues.error('SPEC_PATH_INVALID', `${ep}.path`, String(ev.path));
          return;
        }
        const file = ctx.resolveFile(ev.path);
        if (!file) issues.error('CLAIM_ARTIFACT_MISSING', ep, ev.path);
        else if (file.sha256 !== ev.sha256) issues.error('CLAIM_ARTIFACT_HASH_MISMATCH', ep, ev.path);
        else if (ev.quote !== undefined) {
          // The note is free text; only a verbatim excerpt of the artifact itself counts as evidence.
          const words = normalizeForMatch(ev.quote).split(' ').length;
          if (file.text === null || words < MIN_QUOTE_WORDS || wordIndex(normalizeForMatch(file.text), normalizeForMatch(ev.quote)) < 0) {
            issues.error('CLAIM_QUOTE_NOT_IN_SOURCE', ep, `artifact excerpt "${ev.quote}" not found in ${ev.path}`);
          }
        }
        if (claim.type === 'MEASURED' && ev.quote === undefined) issues.error('CLAIM_EVIDENCE_MISSING', ep, 'a MEASURED claim quotes the measured value from its artifact');
      } else issues.error('SPEC_SCHEMA_INVALID', ep, 'unknown evidence kind');
    });
  });
  return byId;
}

function evidenceText(claimIds: string[], claims: Map<string, Claim>): string {
  return claimIds
    .flatMap((id) => claims.get(id)?.evidence ?? [])
    .map((e) => (e.kind === 'DOC_SPAN' ? e.quote : (e.quote ?? '')))
    .join(' \n ');
}

function checkCitations(claimIds: unknown, path: string, claims: Map<string, Claim>, cited: Set<string>, issues: IssueCollector): string[] {
  if (!Array.isArray(claimIds)) {
    issues.error('SPEC_SCHEMA_INVALID', `${path}.claimIds`, 'expected an array');
    return [];
  }
  for (const id of claimIds as string[]) {
    if (!claims.has(id)) issues.error('CLAIM_UNKNOWN', path, id);
    cited.add(id);
  }
  return claimIds as string[];
}

function checkNumbers(text: string, claimIds: string[], claims: Map<string, Claim>, code: 'NARRATION_NUMBER_UNSOURCED' | 'VISUAL_NUMBER_UNSOURCED', path: string, issues: IssueCollector): void {
  const allowed = new Set(quantityTokens(evidenceText(claimIds, claims)));
  for (const n of quantityTokens(text)) if (!allowed.has(n)) issues.error(code, path, `"${n}" in "${text}"`);
}

// ── Assets ──────────────────────────────────────────────────────────────────

function checkAssets(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  const seen = new Set<string>();
  spec.assets.forEach((a, i) => {
    const path = `assets[${i}]`;
    if (!checkKeys(a, KEYS.asset, path, issues)) return;
    if (seen.has(a.id)) issues.error('SPEC_DUPLICATE_ID', path, a.id);
    seen.add(a.id);
    if (!isOneOf(ASSET_KINDS, a.kind)) issues.error('ASSET_KIND_PROHIBITED', path, String(a.kind));
    if (!isSafeRepoPath(a.path)) {
      issues.error('SPEC_PATH_INVALID', `${path}.path`, String(a.path));
      return;
    }
    if (isOneOf(ASSET_KINDS, a.kind) && !ASSET_ROOTS[a.kind].some((root) => a.path.startsWith(root))) {
      issues.error('ASSET_LOCATION_INVALID', `${path}.path`, `${a.kind} must live under ${ASSET_ROOTS[a.kind].join(' or ')}`);
    }
    const file = ctx.resolveFile(a.path);
    if (!file) issues.error('ASSET_MISSING', path, a.path);
    else if (file.sha256 !== a.sha256) issues.error('ASSET_HASH_MISMATCH', path, a.path);
  });
}

// ── Structure ───────────────────────────────────────────────────────────────

function checkStructure(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  const roles = spec.segments.map((s) => s.role);
  for (const r of REQUIRED_ONCE) {
    const n = roles.filter((x) => x === r).length;
    if (n === 0) issues.error('STRUCTURE_SEGMENT_MISSING', 'segments', r);
    if (n > 1) issues.error('STRUCTURE_SEGMENT_REPEATED', 'segments', r);
  }
  if (!roles.includes('EXPLANATION')) issues.error('STRUCTURE_SEGMENT_MISSING', 'segments', 'EXPLANATION');
  if (roles[0] !== 'HOOK') issues.error('STRUCTURE_ORDER', 'segments[0]', 'the video opens with the hook');
  let rank = -1;
  spec.segments.forEach((s, i) => {
    if (!isOneOf(SEGMENT_ROLES, s.role)) return;
    if (ROLE_RANK[s.role] < rank) issues.error('STRUCTURE_ORDER', `segments[${i}]`, `${s.role} after a later role`);
    rank = Math.max(rank, ROLE_RANK[s.role]);
  });
  const ids = new Set<string>();
  const lineIds = new Set<string>();
  spec.segments.forEach((s, i) => {
    if (ids.has(s.id)) issues.error('SPEC_DUPLICATE_ID', `segments[${i}]`, s.id);
    ids.add(s.id);
    for (const l of s.narration ?? []) {
      if (lineIds.has(l.id)) issues.error('SPEC_DUPLICATE_ID', `segments[${i}].narration`, l.id);
      lineIds.add(l.id);
    }
    if (BRAND_ROLES.has(s.role)) {
      const t = s.templateId ? ctx.config.templates.templates[s.templateId] : undefined;
      if (!t || t.role !== s.role) issues.error('TEMPLATE_UNKNOWN', `segments[${i}]`, String(s.templateId));
    }
  });
}

// ── Segments: narration, scenes, character, sonic ───────────────────────────

function checkSegment(
  seg: Segment,
  i: number,
  spec: VideoSpec,
  claims: Map<string, Claim>,
  cited: Set<string>,
  ctx: ValidationContext,
  issues: IssueCollector,
): void {
  const path = `segments[${i}]`;
  if (!checkKeys(seg, KEYS.segment, path, issues)) return;
  if (!isOneOf(SEGMENT_ROLES, seg.role)) {
    issues.error('SPEC_SCHEMA_INVALID', `${path}.role`, String(seg.role));
    return;
  }
  checkKeys(seg.transitionIn, KEYS.transition, `${path}.transitionIn`, issues);
  const isContent = CONTENT_ROLES.has(seg.role);
  if (isContent && !seg.scene) issues.error('SCENE_ROLE_MISMATCH', path, `${seg.role} needs a scene`);
  if (!isContent && seg.scene) issues.error('SCENE_ROLE_MISMATCH', path, `${seg.role} is rendered from a template`);

  const lineIds = new Set(seg.narration.map((l) => l.id));
  const interpretationMarkers = ctx.config.policy.interpretationMarkers.map((m) => m.toLowerCase());
  seg.narration.forEach((line, j) => {
    const lp = `${path}.narration[${j}]`;
    if (!checkKeys(line, KEYS.narration, lp, issues)) return;
    const ids = checkCitations(line.claimIds, lp, claims, cited, issues);
    const citedTypes = ids.map((id) => claims.get(id)?.type);
    if (line.role === 'TEMPLATE') {
      const t = line.templateId ? ctx.config.templates.templates[line.templateId] : undefined;
      if (isContent || !t || t.narration !== line.text) issues.error('NARRATION_TEMPLATE_MISMATCH', lp, String(line.templateId));
      return;
    }
    if (!isContent) issues.error('NARRATION_TEMPLATE_MISMATCH', lp, 'brand segments speak only template copy');
    if (ids.length === 0) issues.error('NARRATION_UNSUPPORTED', lp, `"${line.text}"`);
    const citesInterpretation = citedTypes.includes('INTERPRETATION');
    if (citesInterpretation && line.role !== 'INTERPRETATION') issues.error('NARRATION_ROLE_MISMATCH', lp, 'cites an INTERPRETATION claim as plain fact');
    if (line.role === 'INTERPRETATION') {
      if (!citesInterpretation) issues.error('NARRATION_ROLE_MISMATCH', lp, 'INTERPRETATION lines cite INTERPRETATION claims');
      if (!interpretationMarkers.some((m) => line.text.toLowerCase().startsWith(m))) {
        issues.error('NARRATION_INTERPRETATION_UNMARKED', lp, `start with one of: ${ctx.config.policy.interpretationMarkers.join(' | ')}`);
      }
    }
    checkNumbers(line.text, ids, claims, 'NARRATION_NUMBER_UNSOURCED', lp, issues);
  });

  if (seg.scene) checkScene(seg, path, spec, claims, cited, lineIds, ctx, issues);
  checkBeats(seg, path, lineIds, ctx, issues);

  seg.sonic.forEach((cue, j) => {
    const cp = `${path}.sonic[${j}]`;
    checkKeys(cue, KEYS.sonic, cp, issues);
    const isQuantum = isOneOf(QUANTUM_SONIC_EVENTS, cue.event);
    if (!isQuantum && !isOneOf(SONIC_EVENTS, cue.event)) issues.error('SONIC_EVENT_UNSUPPORTED', cp, String(cue.event));
    if (isQuantum && !ctx.source.domains.includes('QUANTUM')) issues.error('SONIC_QUANTUM_OUT_OF_DOMAIN', cp, cue.event);
    if (!lineIds.has(cue.cue)) issues.error('CUE_UNKNOWN', cp, cue.cue);
  });
}

function checkScene(
  seg: Segment,
  path: string,
  spec: VideoSpec,
  claims: Map<string, Claim>,
  cited: Set<string>,
  lineIds: Set<string>,
  ctx: ValidationContext,
  issues: IssueCollector,
): void {
  const scene = seg.scene!;
  const sp = `${path}.scene`;
  if (!isOneOf(SCENE_TYPES, scene.type)) {
    issues.error('SCENE_TYPE_UNSUPPORTED', sp, String((scene as { type: unknown }).type));
    return;
  }
  if (!isOneOf(SCENE_PLANES, scene.plane)) issues.error('SPEC_SCHEMA_INVALID', `${sp}.plane`, String(scene.plane));
  const eyebrow = findSection(ctx.source, scene.eyebrowSectionId);
  if (!eyebrow) issues.error('EYEBROW_SECTION_UNKNOWN', sp, scene.eyebrowSectionId);

  const elementIds = new Set<string>();
  const visual = (el: VisualText | undefined, p: string, allowedKeys: readonly string[] = KEYS.visualText): void => {
    if (!el) return;
    if (!checkKeys(el, allowedKeys, p, issues)) return;
    if (elementIds.has(el.id)) issues.error('SPEC_DUPLICATE_ID', p, el.id);
    elementIds.add(el.id);
    const ids = checkCitations(el.claimIds, p, claims, cited, issues);
    if (ids.length === 0) issues.error('VISUAL_TEXT_UNSOURCED', p, `"${el.text}"`);
    checkNumbers(el.text, ids, claims, 'VISUAL_NUMBER_UNSOURCED', p, issues);
    if (el.revealCue && !lineIds.has(el.revealCue)) issues.error('CUE_UNKNOWN', p, el.revealCue);
  };

  switch (scene.type) {
    case 'CARD': {
      checkKeys(scene, KEYS.cardScene, sp, issues);
      visual(scene.heading, `${sp}.heading`);
      scene.body.forEach((b, k) => visual(b, `${sp}.body[${k}]`));
      break;
    }
    case 'GRAPH': {
      checkKeys(scene, KEYS.graphScene, sp, issues);
      visual(scene.caption, `${sp}.caption`);
      const nodeIds = new Set(scene.nodes.map((n) => n.id));
      scene.nodes.forEach((n, k) => {
        const np = `${sp}.nodes[${k}]`;
        visual(n, np, KEYS.graphNode);
        visual(n.detail, `${np}.detail`);
        const evidence = normalizeForMatch(evidenceText(n.claimIds ?? [], claims)).toLowerCase();
        if (wordIndex(evidence, normalizeForMatch(n.text).toLowerCase()) < 0) issues.error('GRAPH_LABEL_UNSOURCED', np, `"${n.text}"`);
        const layered = scene.layout === 'LAYERED';
        if (layered !== (n.layer !== undefined)) issues.error('GRAPH_LAYER_INVALID', np);
      });
      if (scene.layout === 'LAYERED') {
        const layers = new Set(scene.nodes.map((n) => n.layer));
        if (!layers.has('UPPER') || !layers.has('LOWER')) issues.error('GRAPH_LAYER_INVALID', sp, 'needs UPPER and LOWER nodes');
      }
      scene.edges.forEach((e, k) => {
        const ep = `${sp}.edges[${k}]`;
        checkKeys(e, KEYS.graphEdge, ep, issues);
        if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) issues.error('GRAPH_EDGE_UNKNOWN_NODE', ep, `${e.from}->${e.to}`);
        const ids = checkCitations(e.claimIds, ep, claims, cited, issues);
        if (ids.length === 0) issues.error('VISUAL_TEXT_UNSOURCED', ep, 'edges are relationships and must be sourced');
        if (e.revealCue && !lineIds.has(e.revealCue)) issues.error('CUE_UNKNOWN', ep, e.revealCue);
      });
      if (scene.layout === 'ASCENDING_ROUTE') {
        const ordering = scene.orderingClaimId ? claims.get(scene.orderingClaimId) : undefined;
        if (!ordering) issues.error('GRAPH_ORDERING_UNSOURCED', sp, 'ASCENDING_ROUTE needs orderingClaimId');
        else {
          cited.add(ordering.id);
          // The cited ordering must name the nodes in the same order the layout shows them.
          const text = normalizeForMatch(evidenceText([ordering.id], claims)).toLowerCase();
          let at = -1;
          for (const n of scene.nodes) {
            const idx = wordIndex(text, normalizeForMatch(n.text).toLowerCase(), at + 1);
            if (idx < 0 || idx <= at) {
              issues.error('GRAPH_ORDERING_UNSOURCED', sp, `"${n.text}" is not in the cited order`);
              break;
            }
            at = idx;
          }
        }
      }
      break;
    }
    case 'UI': {
      checkKeys(scene, KEYS.uiScene, sp, issues);
      visual(scene.caption, `${sp}.caption`);
      const asset = spec.assets.find((a) => a.id === scene.assetId);
      if (!asset) issues.error('ASSET_UNKNOWN', sp, scene.assetId);
      else if (asset.kind !== 'REAL_UI_CAPTURE') issues.error('UI_SCENE_REQUIRES_REAL_CAPTURE', sp, asset.kind);
      break;
    }
    case 'TAKEAWAY': {
      checkKeys(scene, KEYS.takeawayScene, sp, issues);
      visual(scene.statement, `${sp}.statement`);
      scene.support.forEach((b, k) => visual(b, `${sp}.support[${k}]`));
      break;
    }
  }

  // Layout: the renderer draws exactly these regions, so fit and safety are checked here.
  const layout = layoutScene(scene, eyebrow?.heading ?? '');
  if (eyebrow && intersects(eyebrowOccupied(eyebrow.heading), PROVENANCE_CHIP)) {
    issues.error('TEXT_OVERFLOW', `${sp}.eyebrowSectionId`, `heading "${eyebrow.heading}" runs into the provenance chip`);
  }
  const items = scene.type === 'CARD' ? scene.body.length : scene.type === 'GRAPH' ? scene.nodes.length : scene.type === 'TAKEAWAY' ? scene.support.length : 1;
  if (items > layout.limits.maxItems) issues.error('TEXT_OVERFLOW', sp, `${items} items; this layout holds ${layout.limits.maxItems}`);
  for (const r of layout.texts) {
    const fit = fitText(r.text, r.box);
    if (!fit.fits) issues.error('TEXT_OVERFLOW', `${sp}#${r.elementId}`, `"${r.text}" needs ${fit.lines} lines, region holds ${r.box.maxLines}`);
    if (!inside(r.rect, TITLE_SAFE) || r.rect.y + r.rect.h > CONTENT_BOTTOM) issues.error('SAFE_AREA_VIOLATION', `${sp}#${r.elementId}`);
  }
}

function checkBeats(seg: Segment, path: string, lineIds: Set<string>, ctx: ValidationContext, issues: IssueCollector): void {
  const scene = seg.scene && isOneOf(SCENE_TYPES, seg.scene.type) ? seg.scene : null;
  const eyebrowText = scene ? (findSection(ctx.source, scene.eyebrowSectionId)?.heading ?? '') : '';
  const layout = scene ? layoutScene(scene, eyebrowText) : null;
  const anchors = layout?.anchors ?? {};
  // Everything WalletWallaby must never cover in this scene.
  const protectedRects = layout
    ? [eyebrowOccupied(eyebrowText), PROVENANCE_CHIP, ...layout.texts.filter((t) => t.elementId !== 'eyebrow').map((t) => t.rect)]
    : [];
  const clear = (stand: Point, scale: number, bp: string, label: string): void => {
    const box = wallabyBounds(stand, scale);
    if (protectedRects.some((r) => intersects(box, r))) issues.error('WALLABY_OCCLUDES_TEXT', bp, label);
  };
  seg.wallaby.forEach((beat, j) => {
    const bp = `${path}.wallaby[${j}]`;
    if (!checkKeys(beat, KEYS.beat, bp, issues)) return;
    if (!isOneOf(WALLABY_ACTIONS, beat.action)) {
      issues.error('WALLABY_ACTION_UNSUPPORTED', bp, String(beat.action));
      return;
    }
    if (beat.expression !== undefined && !isOneOf(WALLABY_EXPRESSIONS, beat.expression)) issues.error('WALLABY_EXPRESSION_UNSUPPORTED', bp, String(beat.expression));
    if (!lineIds.has(beat.cue)) issues.error('CUE_UNKNOWN', bp, beat.cue);
    if (TARGETED_ACTIONS.has(beat.action)) {
      if (!beat.target) issues.error('WALLABY_TARGET_REQUIRED', bp, beat.action);
      else if (!anchors[beat.target]) issues.error('WALLABY_TARGET_UNKNOWN', bp, beat.target);
      else if (beat.action === 'TRACE' && !layout?.routes.some((r) => r.id === beat.target)) {
        issues.error('WALLABY_TARGET_UNKNOWN', bp, `TRACE follows a drawn route (edge:...), not ${beat.target}`);
      }
    }
    if (beat.action === 'COMPARE') {
      if (!beat.secondaryTarget) issues.error('WALLABY_TARGET_REQUIRED', bp, 'COMPARE needs secondaryTarget');
      else if (!anchors[beat.secondaryTarget]) issues.error('WALLABY_TARGET_UNKNOWN', bp, beat.secondaryTarget);
    }
    // Where the guide comes to rest for this beat (mirrors the choreography's locomotion rules).
    const a = beat.target ? anchors[beat.target] : undefined;
    const b = beat.secondaryTarget ? anchors[beat.secondaryTarget] : undefined;
    if (beat.action === 'COMPARE' && a && b) clear({ x: (a.stand.x + b.stand.x) / 2, y: Math.min(a.stand.y, b.stand.y) }, a.scale, bp, beat.action);
    else if (beat.action === 'TRACE' && beat.target) {
      const to = anchors[`node:${beat.target.split('->')[1] ?? ''}`];
      if (to) clear(to.stand, to.scale, bp, `${beat.action} destination`);
    } else if (a && TARGETED_ACTIONS.has(beat.action)) clear(a.stand, a.scale, bp, `${beat.action} ${beat.target}`);
    if (EXIT_ACTIONS.has(beat.action) && j !== seg.wallaby.length - 1) {
      issues.error(beat.action === 'PUSH_THROUGH' ? 'TRANSITION_DEPTH_NOT_DRIVEN' : 'TRANSITION_SHIFT_NOT_DRIVEN', bp, `${beat.action} must be the segment's last beat`);
    }
  });
}

// ── Transitions (the 2D -> 3D signature move is earned, budgeted, balanced) ──

function checkTransitions(spec: VideoSpec, issues: IssueCollector): void {
  let inDepth = false;
  let enters = 0;
  spec.segments.forEach((seg, i) => {
    const path = `segments[${i}].transitionIn`;
    const t = seg.transitionIn;
    if (!isOneOf(TRANSITION_TYPES, t.type)) {
      issues.error('SPEC_SCHEMA_INVALID', path, String(t.type));
      return;
    }
    const prev = spec.segments[i - 1];
    const prevExit = prev?.wallaby[prev.wallaby.length - 1]?.action;
    if (i === 0 && t.type !== 'CUT') issues.error('STRUCTURE_ORDER', path, 'the first segment opens with a CUT');
    if (t.type === 'DEPTH_ENTER') {
      enters++;
      if (!isOneOf(DEPTH_REASONS, t.reason)) issues.error('SPEC_SCHEMA_INVALID', `${path}.reason`, String(t.reason));
      if (prevExit !== 'PUSH_THROUGH') issues.error('TRANSITION_DEPTH_NOT_DRIVEN', path);
      if (inDepth) issues.error('TRANSITION_DEPTH_UNBALANCED', path, 'already in depth');
      if (enters > DEPTH_TRANSITION_BUDGET && !t.justification?.trim()) issues.error('TRANSITION_DEPTH_BUDGET', path, `budget is ${DEPTH_TRANSITION_BUDGET}`);
      inDepth = true;
    } else if (t.type === 'DEPTH_EXIT') {
      if (!inDepth) issues.error('TRANSITION_DEPTH_UNBALANCED', path, 'not in depth');
      inDepth = false;
    } else if (prevExit === 'PUSH_THROUGH') {
      issues.error('TRANSITION_DEPTH_NOT_DRIVEN', path, 'a PUSH_THROUGH must lead into DEPTH_ENTER');
    }
    if (t.type === 'SECTION_SHIFT' && prevExit !== 'DIMENSION_JUMP') issues.error('TRANSITION_SHIFT_NOT_DRIVEN', path);
    if (t.type !== 'SECTION_SHIFT' && prevExit === 'DIMENSION_JUMP') issues.error('TRANSITION_SHIFT_NOT_DRIVEN', path, 'a DIMENSION_JUMP must lead into SECTION_SHIFT');
    if (seg.scene && (seg.scene.plane === 'DEPTH') !== inDepth) issues.error('TRANSITION_PLANE_MISMATCH', `segments[${i}].scene.plane`);
    if (!seg.scene && inDepth) issues.error('TRANSITION_DEPTH_UNBALANCED', path, 'brand segments render on the surface');
  });
  if (inDepth) issues.error('TRANSITION_DEPTH_UNBALANCED', 'segments', 'the video never returns to the surface');
}

// ── Duration and pace ───────────────────────────────────────────────────────

function checkDuration(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  if (!isOneOf(VIDEO_CLASS_KINDS, spec.videoClass)) return;
  const timeline = buildTimeline(spec, ctx.track, ctx.config.templates);
  if (!Number.isFinite(timeline.totalMs) || timeline.totalMs <= 0) {
    issues.error('TIMING_INVALID', 'segments', 'runtime is not a finite positive duration');
    return;
  }
  for (const seg of timeline.segments) {
    for (const b of seg.beats) if (b.startMs >= seg.endMs) issues.error('TIMING_INVALID', `segments[${seg.id}].wallaby[${b.index}]`, 'starts after its segment ends');
    for (const c of seg.sonic) if (c.atMs >= seg.endMs) issues.error('TIMING_INVALID', `segments[${seg.id}].sonic`, `${c.event} plays after its segment ends`);
  }
  const ceiling = VIDEO_CLASSES[spec.videoClass].maxSeconds * 1000;
  if (timeline.totalMs > ceiling) issues.error('DURATION_EXCEEDS_CLASS', 'videoClass', `${(timeline.totalMs / 1000).toFixed(1)} s > ${ceiling / 1000} s`);
  const shortest = VIDEO_CLASS_KINDS.find((k) => VIDEO_CLASSES[k].maxSeconds * 1000 >= timeline.totalMs);
  if (shortest && VIDEO_CLASS_KINDS.indexOf(shortest) < VIDEO_CLASS_KINDS.indexOf(spec.videoClass)) {
    issues.warn('DURATION_CLASS_NOT_SHORTEST', 'videoClass', `${shortest} fits ${(timeline.totalMs / 1000).toFixed(1)} s`);
  }
  const request = voiceRequestFor(spec, ctx.config.voice, ctx.config.lexicon);
  // The script must fit its class at the planning pace, whatever pace a provider later reads it at.
  const pacing = ctx.config.voice.pacing;
  const budget = checkNarrationBudget(spec.videoClass, requestSpokenWords(request), narrationBudgetFor(spec.videoClass, pacing), pacing);
  if (!budget.withinBudget) issues.error('NARRATION_OVER_BUDGET', 'segments', describeNarrationBudget(budget));
  const wpm = effectiveWpm(request, ctx.track);
  if (wpm > ctx.config.voice.pacing.maxWpm) issues.error('PACE_TOO_FAST', 'audio', `${wpm.toFixed(0)} wpm > ${ctx.config.voice.pacing.maxWpm}`);
  const end = timeline.segments.find((s) => s.role === 'END_SCREEN');
  const lim = ctx.config.youtube.limits;
  if (end) {
    const d = end.endMs - end.contentStartMs;
    if (d < lim.endScreenMinMs || d > lim.endScreenMaxMs) issues.error('END_SCREEN_DURATION', 'segments', `${d} ms`);
  }
  if (timeline.totalMs < lim.videoMinMsForEndScreen) issues.error('VIDEO_TOO_SHORT', 'segments', `${timeline.totalMs} ms`);
}

// ── Copy ────────────────────────────────────────────────────────────────────

function checkCopy(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  const forbidden = ctx.config.policy.forbiddenPhrases.map((f) => ({ re: new RegExp(f.pattern, 'i'), reason: f.reason }));
  const cta = new RegExp(ctx.config.policy.callToActionPattern, 'i');
  const texts: { text: string; path: string; inCta: boolean }[] = [{ text: spec.title.topic, path: 'title.topic', inCta: false }];
  spec.segments.forEach((s, i) => {
    s.narration.forEach((l, j) => texts.push({ text: l.text, path: `segments[${i}].narration[${j}]`, inCta: s.role === 'CTA' }));
    if (s.scene) for (const el of sceneTexts(s)) texts.push({ text: el.text, path: `segments[${i}].scene#${el.id}`, inCta: false });
  });
  for (const t of texts) {
    for (const f of forbidden) if (f.re.test(t.text)) issues.error('COPY_FORBIDDEN_PHRASE', t.path, `${f.reason} ("${t.text}")`);
    if (!t.inCta && cta.test(t.text)) issues.error('COPY_CTA_REPEATED', t.path, `"${t.text}"`);
  }
}

function sceneTexts(seg: Segment): VisualText[] {
  const s = seg.scene;
  if (!s) return [];
  switch (s.type) {
    case 'CARD':
      return [s.heading, ...s.body];
    case 'GRAPH':
      return [...(s.caption ? [s.caption] : []), ...s.nodes.flatMap((n) => [n, ...(n.detail ? [n.detail] : [])])];
    case 'UI':
      return [s.caption];
    case 'TAKEAWAY':
      return [s.statement, ...s.support];
  }
}

// ── Title / series ──────────────────────────────────────────────────────────

function checkTitleAndSeries(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  const topic = spec.title.topic ?? '';
  if (!topic.trim()) issues.error('TITLE_INVALID', 'title.topic', 'empty');
  if (/\bpart\s*\d+\b/i.test(topic)) issues.error('TITLE_INVALID', 'title.topic', 'part labels are added by the publisher, never typed into the topic');
  // Reserve room for " | <series> — Part N" when the video belongs to a series.
  const reserve = spec.series ? 40 : 0;
  if (topic.length + reserve > ctx.config.youtube.limits.titleMaxChars) issues.error('TITLE_INVALID', 'title.topic', `${topic.length} chars`);
  if (spec.series) {
    const { part, totalParts } = spec.series;
    if (totalParts < 2) issues.error('SERIES_INVALID', 'series', 'a single video is not a series: drop the part label');
    if (part < 1 || part > totalParts) issues.error('SERIES_INVALID', 'series.part', `${part}/${totalParts}`);
  }
}

// ── Source binding ──────────────────────────────────────────────────────────

function checkSource(spec: VideoSpec, ctx: ValidationContext, issues: IssueCollector): void {
  for (const key of ['docPath', 'snapshotPath'] as const) {
    if (!isSafeRepoPath(spec.source[key])) issues.error('SPEC_PATH_INVALID', `source.${key}`, String(spec.source[key]));
  }
  if (spec.source.docPath !== ctx.source.docPath) issues.error('SOURCE_DOC_MISMATCH', 'source.docPath', `${spec.source.docPath} != ${ctx.source.docPath}`);
  if (spec.source.normalizerVersion !== ctx.source.normalizerVersion) issues.error('SOURCE_DOC_MISMATCH', 'source.normalizerVersion');
  if (spec.source.contentHash !== ctx.source.hashes.content) issues.error('SOURCE_HASH_STALE', 'source.contentHash', 'run `npm run freshness` to classify the doc change');
  if (ctx.page) {
    if (!ctx.page.published) issues.error('DOCS_URL_UNPUBLISHED', 'source.docUrl', ctx.page.reason);
    if (spec.source.docUrl !== ctx.page.url) issues.error('DOCS_URL_UNPUBLISHED', 'source.docUrl', `expected ${ctx.page.url}`);
  }
}
