// Read a file that a containment check resolved, without a check-then-use race.
//
// The file is opened once; everything after that goes through the open handle:
// it must be a regular file, its real path must satisfy the containment check,
// and the handle must be the very file at that real path (same device and
// inode), so swapping in a link or another file between the check and the
// read is refused rather than followed. Node-only.

import { closeSync, fstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs';

export function readContainedFile(abs: string, isContained: (realPath: string) => boolean, maxBytes?: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(abs, 'r');
  } catch {
    return null;
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return null;
    // A size bound is checked on the open handle, before anything is read.
    if (maxBytes !== undefined && opened.size > maxBytes) return null;
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      return null;
    }
    if (!isContained(real)) return null;
    const resolved = statSync(real);
    if (resolved.dev !== opened.dev || resolved.ino !== opened.ino) return null;
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Real path of `abs`, or null when nothing exists there. */
export function realPathOrNull(abs: string): string | null {
  try {
    return realpathSync(abs);
  } catch {
    return null;
  }
}
