// Node-side config and path resolution.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineConfig } from './types.ts';

/**
 * This repository. Spec paths name it with the `video/` workspace prefix (it was
 * born as the video/ package of the WalletWall workspace), which keeps every
 * committed spec and hash byte-stable.
 */
export const VIDEO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Byte-identical, blob-bound copies of the few canonical files the tests need. */
export const FIXTURE_SOURCE_ROOT = path.join(VIDEO_ROOT, 'fixtures', 'canonical');
/**
 * The canonical WalletWall tree every other workspace path (docs/, public/, …)
 * resolves against: a WalletWall checkout named by WALLETWALL_SOURCE_ROOT, else
 * the fixture mirror. Node-side only; the render bundle never reads it.
 */
export const SOURCE_ROOT = path.resolve(process.env.WALLETWALL_SOURCE_ROOT?.trim() || FIXTURE_SOURCE_ROOT);
/** True when no canonical checkout is configured and reads come from the fixture mirror. */
export const SOURCE_IS_FIXTURE = SOURCE_ROOT === FIXTURE_SOURCE_ROOT;
/** Workspace prefix that designates this repository. */
export const VIDEO_PREFIX = 'video/';
/** Generated, uncommitted output. */
export const DIST_ROOT = path.join(VIDEO_ROOT, 'dist');

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function loadPipelineConfig(videoRoot: string = VIDEO_ROOT): PipelineConfig {
  const c = (name: string) => readJson<never>(path.join(videoRoot, 'config', name));
  return {
    templates: c('copy-templates.json'),
    policy: c('copy-policy.json'),
    voice: c('voice-identity.json'),
    lexicon: c('pronunciation.json'),
    sonic: c('sonic-identity.json'),
    domains: c('source-domains.json'),
    youtube: c('youtube.json'),
    playlists: c('playlists.json'),
    releasePlan: c('release-plan.json'),
  };
}

/** The workspace path of a file inside this repository (`video/…`). */
export function videoWorkspacePath(abs: string): string {
  return VIDEO_PREFIX + path.relative(VIDEO_ROOT, abs).split(path.sep).join('/');
}

/** One line for CLI output: which canonical tree this run reads. */
export function describeSourceRoot(): string {
  return SOURCE_IS_FIXTURE
    ? 'canonical source: fixture mirror (fixtures/canonical, blob-verified); set WALLETWALL_SOURCE_ROOT to a WalletWall checkout for live staleness'
    : `canonical source: ${SOURCE_ROOT}`;
}
