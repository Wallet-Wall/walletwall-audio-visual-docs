// Strict-shape checks. The VideoSpec has no extension points: an unknown key is
// an error, and a key that looks like a generative, styling, or code channel is
// a distinct error so reviewers can see an attempted bypass for what it is.
// Isomorphic.

import type { IssueCollector } from '../core/issues.ts';

/**
 * Key names that would open a path for invented visuals, styling, or code. None
 * of these exist in the contract; seeing one means a planner tried to add one.
 */
const GENERATIVE_KEY = /(prompt|negative_?prompt|style|css|class_?name|jsx|tsx|html|svg|script|shader|camera|keyframe|animation|easing|generate|diffusion|seed|b_?roll|stock|footage|avatar)/i;

export function scanGenerativeKeys(value: unknown, path: string, issues: IssueCollector): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanGenerativeKeys(v, `${path}[${i}]`, issues));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (GENERATIVE_KEY.test(k)) issues.error('SPEC_GENERATIVE_FIELD', `${path}.${k}`);
      scanGenerativeKeys(v, `${path}.${k}`, issues);
    }
  }
}

export function checkKeys(value: unknown, allowed: readonly string[], path: string, issues: IssueCollector): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.error('SPEC_SCHEMA_INVALID', path, 'expected an object');
    return false;
  }
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) issues.error('SPEC_UNKNOWN_KEY', `${path}.${k}`);
  }
  return true;
}

export const KEYS = {
  spec: ['schema', 'id', 'revision', 'locale', 'title', 'videoClass', 'series', 'source', 'planner', 'claims', 'assets', 'segments', 'audio', 'output'],
  title: ['topic'],
  series: ['seriesId', 'part', 'totalParts'],
  source: ['docPath', 'docUrl', 'blob', 'contentHash', 'normalizerVersion', 'snapshotPath'],
  planner: ['provider', 'contract', 'storyboardHash'],
  claim: ['id', 'type', 'statement', 'evidence'],
  docSpan: ['kind', 'sectionId', 'quote'],
  artifact: ['kind', 'path', 'sha256', 'note', 'quote'],
  asset: ['id', 'kind', 'path', 'sha256', 'justification'],
  segment: ['id', 'role', 'transitionIn', 'narration', 'scene', 'templateId', 'wallaby', 'sonic'],
  transition: ['type', 'reason', 'justification'],
  narration: ['id', 'text', 'role', 'claimIds', 'templateId', 'pauseAfterMs'],
  beat: ['action', 'target', 'secondaryTarget', 'cue', 'delayMs', 'expression'],
  sonic: ['event', 'cue', 'delayMs'],
  visualText: ['id', 'text', 'claimIds', 'revealCue', 'mono'],
  graphNode: ['id', 'text', 'claimIds', 'revealCue', 'mono', 'detail', 'layer'],
  graphEdge: ['from', 'to', 'claimIds', 'revealCue'],
  cardScene: ['type', 'plane', 'eyebrowSectionId', 'layout', 'heading', 'body'],
  graphScene: ['type', 'plane', 'eyebrowSectionId', 'layout', 'orderingClaimId', 'caption', 'nodes', 'edges'],
  uiScene: ['type', 'plane', 'eyebrowSectionId', 'assetId', 'caption'],
  takeawayScene: ['type', 'plane', 'eyebrowSectionId', 'statement', 'support'],
  audio: ['voiceIdentityId', 'pronunciationDictionaryId', 'sonicIdentityId', 'musicBedId'],
  output: ['width', 'height', 'fps', 'captions'],
} as const;
