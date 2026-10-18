// Path containment across both trees, including symlinks and junctions: a
// workspace path may never reach outside this repository (`video/…`) or outside
// the canonical source root (everything else), however it is spelled or linked.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { readWorkspaceFile, resolveWorkspacePath } from '../src/pipeline/context.ts';
import { readContainedFile } from '../src/core/contained-read.ts';
import { canonicalBytes } from '../src/source/canonical.ts';

/** A directory link that works without elevation on Windows (junction) and everywhere else (symlink). */
function linkDir(t: TestContext, target: string, at: string): boolean {
  try {
    symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (err) {
    t.skip(`cannot create a directory link here: ${(err as Error).message}`);
    return false;
  }
}

function outsideDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ww-av-outside-'));
  writeFileSync(path.join(dir, 'secret.txt'), 'outside the workspace');
  return dir;
}

describe('workspace path containment', () => {
  test('spellings that climb, anchor, or hide are refused before touching the disk', () => {
    for (const bad of ['../x', 'video/../package.json', '/etc/passwd', 'C:/Windows/win.ini', 'video\\specs', 'docs/.git/config', 'video/node_modules/react/index.js', 'docs//x', './docs/x']) {
      assert.equal(resolveWorkspacePath(bad), null, bad);
      assert.equal(readWorkspaceFile(bad), null, bad);
    }
  });

  test('a link inside this repository that points outside it is refused', (t) => {
    const outside = outsideDir();
    const dist = path.join(VIDEO_ROOT, 'dist');
    mkdirSync(dist, { recursive: true });
    const link = path.join(dist, `escape-link-${process.pid}`);
    try {
      if (!linkDir(t, outside, link)) return;
      const p = `video/dist/${path.basename(link)}/secret.txt`;
      assert.equal(resolveWorkspacePath(p), null);
      assert.equal(readWorkspaceFile(p), null);
    } finally {
      rmSync(link, { force: true, recursive: false });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a contained read opens once and refuses anything but a contained regular file', () => {
    const dir = outsideDir();
    try {
      const file = path.join(dir, 'secret.txt');
      assert.equal(readContainedFile(file, () => true)?.toString(), 'outside the workspace', 'control: a contained regular file reads');
      assert.equal(readContainedFile(file, () => false), null, 'the containment verdict is enforced on the opened file');
      assert.equal(readContainedFile(dir, () => true), null, 'a directory is not a file');
      assert.equal(readContainedFile(path.join(dir, 'missing.txt'), () => true), null, 'nothing there');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the fixture mirror serves only files its manifest lists', () => {
    assert.ok(canonicalBytes('docs/concepts/migration-readiness.mdx'));
    assert.equal(canonicalBytes('MANIFEST.json'), null, 'the manifest itself is not a canonical file');
    assert.equal(canonicalBytes('docs/concepts/not-listed.mdx'), null);
  });

  test('a link inside the canonical source root that points outside it is refused', (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ww-av-canon-'));
    const outside = outsideDir();
    try {
      mkdirSync(path.join(root, 'docs'), { recursive: true });
      writeFileSync(path.join(root, 'docs', 'page.mdx'), '# Page\n');
      if (!linkDir(t, outside, path.join(root, 'docs', 'escape'))) return;
      // SOURCE_ROOT is fixed at import, so probe it in a child process with its own root.
      const canonical = pathToFileURL(path.join(VIDEO_ROOT, 'src', 'source', 'canonical.ts')).href;
      const code = `import { canonicalPath, canonicalBytes } from ${JSON.stringify(canonical)};
console.log(JSON.stringify({ ok: canonicalPath('docs/page.mdx') !== null, bytes: canonicalBytes('docs/page.mdx')?.toString(), escape: canonicalPath('docs/escape/secret.txt'), escapeBytes: canonicalBytes('docs/escape/secret.txt') }));`;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, WALLETWALL_SOURCE_ROOT: root }, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout.trim()), { ok: true, bytes: '# Page\n', escape: null, escapeBytes: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
