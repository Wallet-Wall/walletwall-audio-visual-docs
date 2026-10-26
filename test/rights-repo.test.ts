// The real repository view behind `npm run rights:check`: it lists a checkout deterministically, skips what is not the
// repository's own source (dependencies, build output, Python environments), never follows a link, and reads a file
// only through one handle that resolves inside the root.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { EXCLUDED_ANYWHERE, EXCLUDED_PATHS, fsRepo } from '../src/rights/repo.ts';

let outer: string;
let root: string;
beforeEach(() => {
  outer = mkdtempSync(path.join(os.tmpdir(), 'ww-rights-'));
  root = path.join(outer, 'repo');
  mkdirSync(root);
});
afterEach(() => rmSync(outer, { recursive: true, force: true }));

const put = (rel: string, text = 'x'): void => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const link = (target: string, at: string): void => symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');

describe('listing a checkout', () => {
  test('lists every source file as sorted POSIX paths, whatever order the disk returns them in', () => {
    for (const p of ['b/z.py', 'a/y.py', 'a/x.ts', 'top.md', 'a/b/c.json']) put(p);
    assert.deepEqual(fsRepo(root).files(), ['a/b/c.json', 'a/x.ts', 'a/y.py', 'b/z.py', 'top.md']);
  });

  test('skips exactly what git ignores: dependencies, build output, bytecode caches, and version control', () => {
    put('src/keep.py');
    put('node_modules/dep/index.js');
    put('a/node_modules/dep/index.js');
    put('dist/out.py');
    put('.git/config');
    put('coverage/lcov.info');
    put('motion-intelligence/target/debug/x.rs');
    put('tools/__pycache__/x.pyc');
    assert.deepEqual(fsRepo(root).files(), ['src/keep.py']);
  });

  test('hides nothing else: a directory is never skipped by a marker file or by a name git does not ignore', () => {
    for (const p of ['blender/extras/pyvenv.cfg', 'blender/extras/add_cube.py', 'tools/venv/lib/site.py', 'tools/.venv/x.py', '.worktrees/other/a.py', '.claude/x.py', 'other/target/x.rs', 'lib/coverage-tool/y.py', 'dist-tools/z.py']) put(p);
    assert.deepEqual(fsRepo(root).files(), ['.claude/x.py', '.worktrees/other/a.py', 'blender/extras/add_cube.py', 'blender/extras/pyvenv.cfg', 'lib/coverage-tool/y.py', 'other/target/x.rs', 'tools/.venv/x.py', 'tools/venv/lib/site.py', 'dist-tools/z.py'].sort());
  });

  test('never follows a link out of the repository, so a Python file outside it is not scanned as ours', () => {
    put('src/keep.py');
    const outside = path.join(outer, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.py'), 'import bpy\n');
    link(outside, path.join(root, 'linked'));
    assert.deepEqual(fsRepo(root).files(), ['src/keep.py']);
  });
});

describe('this checkout', () => {
  const git = (...args: string[]): string | null => {
    const r = spawnSync('git', ['-C', VIDEO_ROOT, ...args], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  };

  test('the check sees every file git tracks, so a force-added file under an ignored name cannot hide', (t) => {
    const tracked = git('ls-files', '-z');
    if (tracked === null) return t.skip('not a git checkout');
    const seen = new Set(fsRepo(VIDEO_ROOT).files());
    const missing = tracked.split('\0').filter(Boolean).filter((p) => !seen.has(p));
    assert.deepEqual(missing, [], 'tracked files the rights check never looks at');
  });

  test('the directories the walk skips are the ones .gitignore names, no more and no fewer', () => {
    const ignored = readFileSync(path.join(VIDEO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith('/') && !l.startsWith('#'));
    const skipped = [...EXCLUDED_ANYWHERE, ...EXCLUDED_PATHS].filter((p) => p !== '.git');
    const named = ignored.map((l) => l.slice(0, -1));
    assert.deepEqual(skipped.sort(), named.sort());
  });
});

describe('reading a file', () => {
  test('returns the text of a regular file inside the root', () => {
    put('a/b.txt', 'hello');
    assert.equal(fsRepo(root).read('a/b.txt'), 'hello');
    put('a/u.txt', 'naïve — 496 × 496 …');
    assert.equal(fsRepo(root).read('a/u.txt'), 'naïve — 496 × 496 …', 'read as UTF-8');
  });

  test('returns null for a missing file, a directory, or a path that is not plainly relative', () => {
    put('a/b.txt');
    const repo = fsRepo(root);
    assert.equal(repo.read('nope.txt'), null);
    assert.equal(repo.read('a'), null);
    for (const bad of ['../outside.txt', 'a/../../outside.txt', '/etc/hosts', 'a\\b.txt', '', './a/b.txt', 'a//b.txt', 'C:/x']) assert.equal(repo.read(bad), null, bad);
  });

  test('refuses a link, in the file or in its directory, rather than reading through it', () => {
    const outside = path.join(outer, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    link(outside, path.join(root, 'linked'));
    assert.equal(fsRepo(root).read('linked/secret.txt'), null);
  });

  test('refuses a file link even when its target is inside the repository, and does not list it', (t) => {
    put('real.txt', 'real');
    try {
      symlinkSync(path.join(root, 'real.txt'), path.join(root, 'alias.txt'), 'file');
    } catch {
      t.skip('this host cannot create file links');
      return;
    }
    const repo = fsRepo(root);
    assert.equal(repo.read('alias.txt'), null);
    assert.deepEqual(repo.files(), ['real.txt']);
  });

  test('refuses a file larger than the bound', () => {
    put('big.txt', 'x'.repeat(17 * 1024 * 1024));
    assert.equal(fsRepo(root).read('big.txt'), null);
  });

  test('reads a file\'s exact bytes, binary ones included, under the same refusals as its text', () => {
    // Not valid UTF-8: decoding to text and encoding back would change these bytes, so a hash of the text would lie.
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0xc3]);
    mkdirSync(path.join(root, 'a'), { recursive: true });
    writeFileSync(path.join(root, 'a', 'mark.png'), bytes);
    const repo = fsRepo(root);
    assert.deepEqual([...(repo.bytes('a/mark.png') ?? [])], [...bytes]);
    assert.notDeepEqual([...new TextEncoder().encode(repo.read('a/mark.png') ?? '')], [...bytes], 'positive control: the text view is lossy for these bytes');
    const outside = path.join(outer, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'secret.png'), bytes);
    link(outside, path.join(root, 'linked'));
    for (const bad of ['nope.png', 'a', '../outside/secret.png', 'linked/secret.png', 'a\\mark.png']) assert.equal(repo.bytes(bad), null, bad);
  });
});
