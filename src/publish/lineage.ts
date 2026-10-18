// Version lineage. A YouTube video file is never overwritten: a materially
// updated video is a new upload, and the previous one is retained as
// SUPERSEDED (normally switched to unlisted by a human), never auto-deleted.
// The docs always point at `currentYoutubeId`. Isomorphic, pure.

export type LineageStatus = 'UNLISTED_REVIEW' | 'CURRENT' | 'SUPERSEDED' | 'WITHDRAWN';

export interface LineageVersion {
  revision: number;
  youtubeId: string;
  status: LineageStatus;
  specHash: string;
  docBlob: string;
  contentHash: string;
}

export interface Lineage {
  schema: 'walletwall.video-lineage/v1';
  videoId: string;
  currentYoutubeId: string | null;
  versions: LineageVersion[];
}

export function emptyLineage(videoId: string): Lineage {
  return { schema: 'walletwall.video-lineage/v1', videoId, currentYoutubeId: null, versions: [] };
}

/** A new upload enters review; it does not become CURRENT until a human publishes it. */
export function recordUpload(lineage: Lineage, v: Omit<LineageVersion, 'status'>): Lineage {
  if (lineage.versions.some((x) => x.youtubeId === v.youtubeId)) throw new Error(`upload ${v.youtubeId} already recorded`);
  if (lineage.versions.some((x) => x.revision >= v.revision)) throw new Error(`revision ${v.revision} must exceed every recorded revision`);
  return { ...lineage, versions: [...lineage.versions, { ...v, status: 'UNLISTED_REVIEW' }] };
}

/** Human publish: the reviewed version becomes CURRENT; the previous CURRENT is retained as SUPERSEDED. */
export function markPublished(lineage: Lineage, youtubeId: string): Lineage {
  const target = lineage.versions.find((v) => v.youtubeId === youtubeId);
  if (!target) throw new Error(`unknown upload ${youtubeId}`);
  if (target.status !== 'UNLISTED_REVIEW') throw new Error(`upload ${youtubeId} is ${target.status}, not awaiting review`);
  return {
    ...lineage,
    currentYoutubeId: youtubeId,
    versions: lineage.versions.map((v) => {
      if (v.youtubeId === youtubeId) return { ...v, status: 'CURRENT' };
      if (v.status === 'CURRENT') return { ...v, status: 'SUPERSEDED' };
      return v;
    }),
  };
}
