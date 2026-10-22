// The repository as the rights check sees it: a sorted list of files and a bounded text reader. The real view walks a
// checkout (skipping dependency, build-output, and virtual-environment directories, and never following a link) and
// reads each file through one open handle, refusing anything that resolves outside the root. Tests use an in-memory
// view. Nothing here reads the environment or the network.

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readContainedFile } from '../core/contained-read.ts';

export interface RepoView {
  /** Repo-relative POSIX paths of every file, sorted. */
  files(): string[];
  /** The file's UTF-8 text, or null when it is absent, not a regular file, too large, or outside the repository. */
  read(rel: string): string | null;
}

/**
 * What the walk skips is exactly what `.gitignore` ignores (test/rights-repo.test.ts holds the two together) plus `.git`
 * itself: dependencies, build output, coverage, and bytecode caches by name at any depth, and the Rust build directory by
 * path. Nothing else is hidden: not a virtual environment, not a directory with a marker file, not a name that merely
 * looks like build output. A file git tracks despite being ignored is still seen by `git ls-files`, and that same test
 * fails if the walk would miss one.
 */
export const EXCLUDED_ANYWHERE: ReadonlySet<string> = new Set(['.git', 'node_modules', 'dist', 'coverage', '__pycache__', '.vscode', '.idea']);
export const EXCLUDED_PATHS: ReadonlySet<string> = new Set(['motion-intelligence/target']);

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export function fsRepo(root: string): RepoView {
  const realRoot = realpathSync(root);
  let listing: string[] | null = null;

  const walk = (dirRel: string, out: string[]): void => {
    const abs = path.join(realRoot, ...dirRel.split('/').filter(Boolean));
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!EXCLUDED_ANYWHERE.has(entry.name) && !EXCLUDED_PATHS.has(rel)) walk(rel, out);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };

  return {
    files(): string[] {
      if (listing === null) {
        const out: string[] = [];
        walk('', out);
        listing = out.sort();
      }
      return listing;
    },
    read(rel: string): string | null {
      if (rel.split('/').some((s) => s === '' || s === '.' || s === '..') || rel.includes('\\') || path.isAbsolute(rel)) return null;
      const abs = path.join(realRoot, ...rel.split('/'));
      try {
        if (lstatSync(abs).isSymbolicLink()) return null;
      } catch {
        return null;
      }
      const bytes = readContainedFile(abs, (real) => {
        const inside = path.relative(realRoot, real);
        return inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
      }, MAX_FILE_BYTES);
      return bytes === null ? null : bytes.toString('utf8');
    },
  };
}
