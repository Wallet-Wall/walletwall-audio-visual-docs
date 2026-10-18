// Title rules. The searchable question/topic comes first; series metadata second.
// One video: "How WalletWall Measures Migration Readiness" (no part label).
// Two or more: "Why Two Data Sources Can Disagree | WalletWall Vault — Part 2". Isomorphic.

import type { VideoSpec } from '../spec/types.ts';

export function formatVideoTitle(spec: Pick<VideoSpec, 'title' | 'series'>, seriesTitle: string | null): string {
  const topic = spec.title.topic.trim();
  if (!spec.series || spec.series.totalParts < 2) return topic;
  if (!seriesTitle) throw new Error(`series ${spec.series.seriesId} needs a title`);
  return `${topic} | ${seriesTitle} — Part ${spec.series.part}`;
}
