// Paths in a spec come from untrusted planner output. They must be plain
// repo-relative POSIX paths: no absolute paths, drive letters, backslashes,
// parent-directory segments, hidden segments (.git, .env), or dependency
// folders. Isomorphic.

import type { AssetKind } from '../spec/vocabulary.ts';

export function isSafeRepoPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0 || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p) || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && !seg.startsWith('.') && seg !== 'node_modules');
}

/**
 * Where each asset kind may come from. The kind is declared by the planner, so
 * the location is what makes it meaningful: a "real UI capture" is only one
 * that was committed (and reviewed) into the capture directory.
 */
export const ASSET_ROOTS: Readonly<Record<AssetKind, readonly string[]>> = {
  REAL_UI_CAPTURE: ['video/assets/ui-captures/'],
  REPO_DIAGRAM: ['docs/', 'video/assets/diagrams/'],
  REPO_ARTIFACT: ['docs/', 'proofs/', 'video/assets/artifacts/'],
  DOC_EXCERPT: ['docs/'],
  CHAIN_EVIDENCE: ['video/assets/chain-evidence/'],
  ILLUSTRATION_PRIMITIVE: ['video/assets/illustrations/'],
  // Reviewed marks committed to this repository; the app's legacy raster icons are not brand marks for video.
  BRAND_MARK: ['video/assets/brand/'],
};
