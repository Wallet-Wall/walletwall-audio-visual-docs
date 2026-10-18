// Node-side orchestration helpers shared by the CLI scripts.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { estimateTrack } from '../audio/voice-provider.ts';
import { DIST_ROOT, loadPipelineConfig, readJson, VIDEO_PREFIX, VIDEO_ROOT, videoWorkspacePath } from '../config/load.ts';
import type { PipelineConfig } from '../config/types.ts';
import { readContainedFile, realPathOrNull } from '../core/contained-read.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { assembleSpec } from '../planner/assemble.ts';
import { FixtureStoryboardProvider } from '../planner/fixture-provider.ts';
import { STORYBOARD_CONTRACT } from '../planner/storyboard.ts';
import { publishedPage, type DocsSite } from '../source/docs-site.ts';
import { canonicalBytes, canonicalDocInfo, canonicalPath } from '../source/canonical.ts';
import { loadDocsSite, loadNormalizedDoc } from '../source/load.ts';
import type { NormalizedSource } from '../source/types.ts';
import type { VideoSpec } from '../spec/types.ts';
import { VIDEO_CLASSES } from '../spec/vocabulary.ts';
import type { NarrationTrack } from '../timeline/timeline.ts';
import { isSafeRepoPath } from '../validation/paths.ts';
import type { ValidationContext } from '../validation/validate-spec.ts';

export interface VideoEntry {
  videoId: string;
  docPath: string;
  storyboard: string;
  revision: number;
}

export function loadRegistry(): VideoEntry[] {
  return readJson<{ videos: VideoEntry[] }>(path.join(VIDEO_ROOT, 'config', 'videos.json')).videos;
}

export function entryFor(videoId: string): VideoEntry {
  const entry = loadRegistry().find((v) => v.videoId === videoId);
  if (!entry) throw new Error(`unknown video ${videoId}; see config/videos.json`);
  return entry;
}

export const specDir = (videoId: string): string => path.join(VIDEO_ROOT, 'specs', videoId);
export const specPath = (videoId: string): string => path.join(specDir(videoId), 'spec.json');
export const snapshotPath = (videoId: string): string => path.join(specDir(videoId), 'source.snapshot.json');
export const distDir = (videoId: string): string => path.join(DIST_ROOT, videoId);

export interface PlanResult {
  spec: VideoSpec;
  source: NormalizedSource;
  dirtyDoc: boolean;
}

/** Normalize the live doc, ask the storyboard provider, assemble the spec. */
export async function planVideo(entry: VideoEntry, config: PipelineConfig = loadPipelineConfig(), site: DocsSite = loadDocsSite()): Promise<PlanResult> {
  const source = loadNormalizedDoc(entry.docPath, config.domains.navigationGroups, site);
  const git = canonicalDocInfo(entry.docPath);
  const page = publishedPage(site, entry.docPath);
  const provider = new FixtureStoryboardProvider(path.join(VIDEO_ROOT, entry.storyboard));
  const storyboard = await provider.plan({ videoId: entry.videoId, source, maxSeconds: VIDEO_CLASSES.DEEP_DIVE.maxSeconds });
  const spec = assembleSpec(storyboard, {
    source,
    docUrl: page.url,
    blob: git.blob,
    snapshotPath: videoWorkspacePath(snapshotPath(entry.videoId)),
    providerId: provider.id,
    contract: STORYBOARD_CONTRACT,
    storyboardHash: contentAddress(storyboard),
    templates: config.templates,
    voice: config.voice,
    lexicon: config.lexicon,
    sonicIdentityId: config.sonic.ident.id,
    revision: entry.revision,
  });
  return { spec, source, dirtyDoc: git.dirty };
}

export function loadCommittedSpec(videoId: string): VideoSpec {
  return readJson<VideoSpec>(specPath(videoId));
}

const contained = (root: string, abs: string): boolean => {
  const rel = path.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Absolute path of a workspace path, or null if it is unsafe or would escape its
 * tree (symlinks included): `video/…` stays inside this repository, anything
 * else inside the canonical source tree.
 */
export function resolveWorkspacePath(workspacePath: string): string | null {
  if (!isSafeRepoPath(workspacePath)) return null;
  if (!workspacePath.startsWith(VIDEO_PREFIX)) return canonicalPath(workspacePath);
  const abs = path.resolve(VIDEO_ROOT, workspacePath.slice(VIDEO_PREFIX.length));
  if (!contained(VIDEO_ROOT, abs)) return null;
  const real = realPathOrNull(abs);
  if (real !== null && !contained(realpathSync(VIDEO_ROOT), real)) return null;
  return abs;
}

/** Bytes of a workspace file, or null. Canonical reads go through the verified canonical gateway. */
export function readWorkspaceFile(workspacePath: string): Buffer | null {
  const abs = resolveWorkspacePath(workspacePath);
  if (!abs) return null;
  if (!workspacePath.startsWith(VIDEO_PREFIX)) return canonicalBytes(workspacePath);
  return readContainedFile(abs, (real) => contained(realpathSync(VIDEO_ROOT), real));
}

const TEXT_ARTIFACT = /\.(json|md|mdx|txt|csv|tsv|ya?ml|sql|log)$/i;

export function repoFileResolver(workspacePath: string): { sha256: string; text: string | null } | null {
  const bytes = readWorkspaceFile(workspacePath);
  if (!bytes) return null;
  return { sha256: sha256Hex(bytes), text: TEXT_ARTIFACT.test(workspacePath) && bytes.length < 2_000_000 ? bytes.toString('utf8') : null };
}

export function validationContextFor(
  spec: VideoSpec,
  config: PipelineConfig = loadPipelineConfig(),
  site: DocsSite = loadDocsSite(),
  track?: NarrationTrack,
): ValidationContext {
  const source = loadNormalizedDoc(spec.source.docPath, config.domains.navigationGroups, site);
  return {
    source,
    config,
    track: track ?? estimateTrack(spec, config.voice, config.lexicon),
    page: publishedPage(site, spec.source.docPath),
    resolveFile: repoFileResolver,
  };
}
