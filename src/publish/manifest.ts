// The YouTube publish manifest: everything an upload adapter needs, plus the
// provenance and review gate, with no credentials. Built and validated without
// any network access. Isomorphic.

import type { PlaylistsConfig, YoutubeChannelConfig } from '../config/types.ts';
import { IssueCollector } from '../core/issues.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { Timeline } from '../timeline/timeline.ts';
import { formatVideoTitle } from './title.ts';
import type { V1Privacy } from './upload-provider.ts';

export interface Chapter {
  atMs: number;
  title: string;
}

export interface PublishManifest {
  schema: 'walletwall.youtube-publish-manifest/v1';
  mode: 'DRY_RUN';
  videoId: string;
  revision: number;
  specHash: string;
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: {
    privacyStatus: V1Privacy;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
    license: string;
  };
  files: {
    video: { path: string; sha256: string; durationMs: number } | null;
    captions: { path: string; sha256: string; language: string; format: 'vtt' };
  };
  chapters: Chapter[];
  playlists: { playlistId: string; title: string; youtubePlaylistId: string | null; position: number }[];
  endScreen: { applyIn: 'YOUTUBE_STUDIO'; elements: { kind: string; source?: string; zone: string }[] };
  review: { required: true; gate: 'HUMAN_REVIEW_BEFORE_PUBLIC'; checklist: string[] };
  provenance: {
    docPath: string;
    docUrl: string;
    docBlob: string;
    contentHash: string;
    planner: string;
    claims: Record<string, number>;
    narration: { providerId: string; estimated: boolean };
  };
}

const MERGE_ROLES = new Set(['IDENT']);
const OUTRO_ROLES = new Set(['CTA', 'DOCS_REFERENCE', 'OUTRO', 'END_SCREEN']);

/** Chapters from scene headings; brand segments fold into neighbors; chapters under the minimum merge back. */
export function buildChapters(timeline: Timeline, minSeconds: number): Chapter[] {
  const raw: Chapter[] = [];
  for (const seg of timeline.segments) {
    if (MERGE_ROLES.has(seg.role)) continue;
    let title: string;
    if (OUTRO_ROLES.has(seg.role)) {
      if (raw.some((c) => c.title === 'Docs and next steps')) continue;
      title = 'Docs and next steps';
    } else if (seg.role === 'HOOK') title = 'The question';
    else if (seg.scene?.type === 'CARD') title = seg.scene.heading.text;
    else if (seg.scene?.type === 'GRAPH') title = seg.scene.caption?.text ?? 'How it fits together';
    else if (seg.scene?.type === 'TAKEAWAY') title = 'Takeaway';
    else if (seg.scene?.type === 'UI') title = seg.scene.caption.text;
    else continue;
    raw.push({ atMs: raw.length === 0 ? 0 : seg.startMs, title });
  }
  // Keep a chapter only if it starts at least `minSeconds` after the previous kept one;
  // fold a too-short final chapter into its predecessor.
  const min = minSeconds * 1000;
  const out: Chapter[] = [];
  for (const c of raw) if (out.length === 0 || c.atMs - out[out.length - 1]!.atMs >= min) out.push(c);
  while (out.length > 1 && timeline.totalMs - out[out.length - 1]!.atMs < min) out.pop();
  return out;
}

export function stamp(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface ManifestInputs {
  spec: VideoSpec;
  specHash: string;
  timeline: Timeline;
  docDescription: string;
  youtube: YoutubeChannelConfig;
  playlists: PlaylistsConfig;
  captions: { path: string; sha256: string };
  video: { path: string; sha256: string } | null;
  narration: { providerId: string; estimated: boolean };
}

export function buildPublishManifest(inp: ManifestInputs): PublishManifest {
  const { spec, youtube } = inp;
  const memberships = inp.playlists.playlists
    .map((p) => ({ p, entry: p.entries.find((e) => e.videoId === spec.id) }))
    .filter((x) => x.entry)
    .map(({ p, entry }) => ({
      playlistId: p.id,
      title: p.title,
      youtubePlaylistId: p.youtubePlaylistId,
      position: [...p.entries].sort((a, b) => a.order - b.order).findIndex((e) => e.videoId === entry!.videoId),
    }));
  const seriesTitle = spec.series ? (inp.playlists.playlists.find((p) => p.id === spec.series!.seriesId)?.title ?? null) : null;
  const chapters = buildChapters(inp.timeline, youtube.limits.chapterMinSeconds);
  const claims: Record<string, number> = {};
  for (const c of spec.claims) claims[c.type] = (claims[c.type] ?? 0) + 1;
  const description = [
    spec.title.topic,
    '',
    inp.docDescription,
    '',
    `Canonical docs: ${spec.source.docUrl}`,
    '',
    'Chapters',
    ...chapters.map((c) => `${stamp(c.atMs)} ${c.title}`),
    '',
    `Source: ${spec.source.docPath} · doc blob ${spec.source.blob.slice(0, 7)} · content ${spec.source.contentHash.slice(0, 12)} · video r${spec.revision}`,
    ...youtube.defaults.descriptionFooter,
  ].join('\n');
  return {
    schema: 'walletwall.youtube-publish-manifest/v1',
    mode: 'DRY_RUN',
    videoId: spec.id,
    revision: spec.revision,
    specHash: inp.specHash,
    snippet: {
      title: formatVideoTitle(spec, seriesTitle),
      description,
      tags: [...youtube.defaults.baseTags, ...memberships.map((m) => m.title)],
      categoryId: youtube.defaults.categoryId,
      defaultLanguage: youtube.defaults.defaultLanguage,
      defaultAudioLanguage: youtube.defaults.defaultAudioLanguage,
    },
    status: {
      privacyStatus: youtube.defaults.privacyStatusOnUpload,
      selfDeclaredMadeForKids: youtube.defaults.selfDeclaredMadeForKids,
      containsSyntheticMedia: youtube.defaults.containsSyntheticMedia,
      license: youtube.defaults.license,
    },
    files: {
      video: inp.video ? { ...inp.video, durationMs: inp.timeline.totalMs } : null,
      captions: { ...inp.captions, language: youtube.defaults.defaultLanguage, format: 'vtt' },
    },
    chapters,
    playlists: memberships,
    endScreen: { applyIn: 'YOUTUBE_STUDIO', elements: youtube.endScreen.elements },
    review: {
      required: true,
      gate: 'HUMAN_REVIEW_BEFORE_PUBLIC',
      checklist: [
        'Watch the unlisted upload end to end with sound.',
        'Spot-check every claim against the canonical page.',
        'Confirm the characterless stills still teach the lesson.',
        'Apply the end-screen layout in YouTube Studio.',
        'Publish, then record the new version as CURRENT in the lineage manifest.',
      ],
    },
    provenance: {
      docPath: spec.source.docPath,
      docUrl: spec.source.docUrl,
      docBlob: spec.source.blob,
      contentHash: spec.source.contentHash,
      planner: `${spec.planner.provider}:${spec.planner.contract}`,
      claims,
      narration: inp.narration,
    },
  };
}

/** Manifest QA: platform limits, chapter rules, v1 privacy, and no credential material. */
export function checkPublishManifest(m: PublishManifest, youtube: YoutubeChannelConfig, env: Record<string, string | undefined>, issues: IssueCollector): void {
  if (m.snippet.title.length > youtube.limits.titleMaxChars) issues.error('TITLE_INVALID', 'snippet.title', `${m.snippet.title.length} chars`);
  if (m.snippet.description.length > youtube.limits.descriptionMaxChars) issues.error('TITLE_INVALID', 'snippet.description', 'too long');
  if (!m.snippet.description.includes(m.provenance.docUrl)) issues.error('DOCS_URL_UNPUBLISHED', 'snippet.description', 'canonical docs URL missing');
  const ch = m.chapters;
  if (ch.length < youtube.limits.chapterMinCount || ch[0]?.atMs !== 0) issues.error('MANIFEST_CHAPTERS_INVALID', 'chapters', `${ch.length} chapters`);
  const minMs = youtube.limits.chapterMinSeconds * 1000;
  ch.forEach((c, i) => {
    if (i > 0 && c.atMs - ch[i - 1]!.atMs < minMs) issues.error('MANIFEST_CHAPTERS_INVALID', `chapters[${i - 1}]`, 'shorter than the minimum');
  });
  const total = m.files.video?.durationMs;
  if (total !== undefined && ch.length > 0 && total - ch[ch.length - 1]!.atMs < minMs) issues.error('MANIFEST_CHAPTERS_INVALID', `chapters[${ch.length - 1}]`, 'final chapter too short');
  if (m.status.privacyStatus !== 'unlisted' && m.status.privacyStatus !== 'private') issues.error('MANIFEST_PRIVACY_INVALID', 'status.privacyStatus', String(m.status.privacyStatus));
  // Defense in depth: no secret-shaped environment value may ever land in a manifest.
  const serialized = JSON.stringify(m);
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 12 || !/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
    if (serialized.includes(value)) issues.error('MANIFEST_SECRET_LEAK', 'manifest', `value of ${name}`);
  }
}
