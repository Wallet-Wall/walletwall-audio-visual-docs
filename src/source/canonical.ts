// The one gateway to the canonical WalletWall tree (see SOURCE_ROOT).
//
// A real WalletWall checkout is read as-is and git supplies blob identity. The
// fixture mirror (fixtures/canonical/) is verified on every read against
// MANIFEST.json: a listed copy whose bytes drift from its recorded git blob is
// an error, and an unlisted file does not exist as far as the pipeline is
// concerned. The mirror never stands in silently for the canonical source.
// Node-only.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_SOURCE_ROOT, readJson, SOURCE_IS_FIXTURE, SOURCE_ROOT } from '../config/load.ts';
import { sha256Hex } from '../core/hash.ts';
import { isSafeRepoPath } from '../validation/paths.ts';

export interface CanonicalFixture {
  blob: string;
  sha256: string;
  bytes: number;
  role: string;
}

/** A canonical file the pipeline depends on but which is deliberately not mirrored. */
export interface WithheldFile {
  blob: string;
  reason: string;
  /** For docs/.mintignore: existing navigation page files it excluded at that blob (must be 0). */
  navigationPagesExcluded?: number;
}

export interface CanonicalManifest {
  schema: 'walletwall.canonical-fixtures/v1';
  note: string;
  files: Record<string, CanonicalFixture>;
  withheld: Record<string, WithheldFile>;
}

export const MANIFEST_PATH = path.join(FIXTURE_SOURCE_ROOT, 'MANIFEST.json');

let manifest: CanonicalManifest | undefined;
export function canonicalManifest(): CanonicalManifest {
  manifest ??= readJson<CanonicalManifest>(MANIFEST_PATH);
  return manifest;
}

/** git's blob id for these bytes (what `git hash-object` prints). */
export function gitBlobId(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

const within = (root: string, abs: string): boolean => {
  const rel = path.relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Absolute path of a canonical-tree path, or null if it is unsafe or escapes the tree (symlinks included). */
export function canonicalPath(rel: string): string | null {
  if (!isSafeRepoPath(rel)) return null;
  const abs = path.resolve(SOURCE_ROOT, rel);
  if (!within(SOURCE_ROOT, abs)) return null;
  if (existsSync(abs) && !within(realpathSync(SOURCE_ROOT), realpathSync(abs))) return null;
  return abs;
}

/** Bytes of a canonical file, or null when it does not exist. Fixture reads are verified and throw on drift. */
export function canonicalBytes(rel: string): Buffer | null {
  const abs = canonicalPath(rel);
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) return null;
  if (!SOURCE_IS_FIXTURE) return readFileSync(abs);
  const files = canonicalManifest().files;
  const entry = Object.hasOwn(files, rel) ? files[rel] : undefined;
  if (!entry) return null;
  const bytes = readFileSync(abs);
  if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256 || gitBlobId(bytes) !== entry.blob) {
    throw new Error(`canonical fixture ${rel} no longer matches its recorded blob ${entry.blob}`);
  }
  return bytes;
}

export function canonicalText(rel: string): string {
  const bytes = canonicalBytes(rel);
  if (!bytes) throw new Error(`canonical file ${rel} not found in ${SOURCE_IS_FIXTURE ? 'the fixture mirror' : SOURCE_ROOT}`);
  return bytes.toString('utf8');
}

/**
 * The docs-site exclusion list. The mirror withholds it (it names internal,
 * unpublished material) and records instead that it excluded no navigation
 * page, so an empty list resolves every navigation page identically.
 */
export function mintignoreText(): string {
  // A fixed, trusted path: read directly, since the planner-path policy rightly refuses hidden segments.
  if (!SOURCE_IS_FIXTURE) return readFileSync(path.join(SOURCE_ROOT, 'docs', '.mintignore'), 'utf8');
  const withheld = canonicalManifest().withheld['docs/.mintignore'];
  if (!withheld || withheld.navigationPagesExcluded !== 0) throw new Error('fixture mirror: docs/.mintignore attestation is missing or not zero');
  return '';
}

export interface GitDocInfo {
  blob: string;
  /** True when the working-tree bytes differ from the committed blob (uncommitted doc edit). */
  dirty: boolean;
}

/** Blob identity of a canonical doc: from git in a checkout, from the verified bytes in the mirror. */
export function canonicalDocInfo(docPath: string): GitDocInfo {
  if (SOURCE_IS_FIXTURE) {
    const bytes = canonicalBytes(docPath);
    if (!bytes) throw new Error(`canonical doc ${docPath} is not in the fixture mirror`);
    return { blob: gitBlobId(bytes), dirty: false };
  }
  if (!canonicalPath(docPath)) throw new Error(`unsafe canonical doc path ${JSON.stringify(docPath)}`);
  const git = (...args: string[]): string => execFileSync('git', ['-C', SOURCE_ROOT, ...args], { encoding: 'utf8' }).trim();
  return { blob: git('rev-parse', `HEAD:${docPath}`), dirty: git('status', '--porcelain', '--', docPath) !== '' };
}
