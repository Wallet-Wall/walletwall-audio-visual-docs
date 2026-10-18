// Change categories -> video freshness and the action it calls for.
//
// Severity, lowest to highest:
//   CURRENT                the video still says and shows what the doc says
//   COSMETICALLY_STALE     the doc's explanation moved on; the video is still accurate
//   REGENERATION_REQUIRED  a visual the video shows (diagram, screenshot) changed;
//                          what it says is still true, but scenes must be re-rendered
//   MATERIALLY_STALE       something the video SAYS is no longer what the doc says
//
// Both of the top two mean a new upload (YouTube files are immutable); only
// MATERIALLY_STALE also means the docs must stop pointing at the current video
// until its replacement is published.

import type { ChangeCategory, VideoFreshness } from '../spec/vocabulary.ts';
import type { ChangeReport } from './classify.ts';

export type FreshnessAction = 'NONE' | 'REFRESH_SOURCE_BINDING' | 'RERENDER_AFFECTED_SCENES' | 'NEW_REVISION';

export interface FreshnessVerdict {
  freshness: VideoFreshness;
  action: FreshnessAction;
  affectedSegments: string[];
  reasons: string[];
}

const RANK: Record<VideoFreshness, number> = { CURRENT: 0, COSMETICALLY_STALE: 1, REGENERATION_REQUIRED: 2, MATERIALLY_STALE: 3 };

/** Freshness implied by one change category, given whether it touches what the video shows or says. */
export function freshnessFor(category: ChangeCategory, affectsVideo: boolean): VideoFreshness {
  switch (category) {
    case 'TYPO_ONLY':
    case 'STYLE_ONLY':
    case 'LINK_ONLY':
      return 'CURRENT';
    case 'MINOR_EXPLANATION':
      return 'COSMETICALLY_STALE';
    case 'SCREENSHOT_CHANGED':
    case 'DIAGRAM_CHANGED':
      return affectsVideo ? 'REGENERATION_REQUIRED' : 'COSMETICALLY_STALE';
    case 'CLAIM_CHANGED':
    case 'MECHANISM_CHANGED':
    case 'CONCLUSION_CHANGED':
      return 'MATERIALLY_STALE';
  }
}

export function deriveFreshness(report: ChangeReport): FreshnessVerdict {
  let freshness: VideoFreshness = 'CURRENT';
  const affected = new Set<string>();
  const reasons: string[] = [];
  for (const change of report.changes) {
    const f = freshnessFor(change.category, change.affectsVideo);
    if (RANK[f] > RANK[freshness]) freshness = f;
    if (f !== 'CURRENT') for (const s of change.segmentIds) affected.add(s);
    reasons.push(`${change.category} -> ${f}: ${change.detail}`);
  }
  const action: FreshnessAction =
    freshness === 'MATERIALLY_STALE'
      ? 'NEW_REVISION'
      : freshness === 'REGENERATION_REQUIRED'
        ? 'RERENDER_AFFECTED_SCENES'
        : report.changes.length > 0
          ? 'REFRESH_SOURCE_BINDING'
          : 'NONE';
  return { freshness, action, affectedSegments: [...affected].sort(), reasons };
}
