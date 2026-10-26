// The lane's signed-distance code (blender/walletwallaby/geometry.py), held to the geometric facts that define it by
// the property suite in test/python/sdf_properties.py: oracles built from the definitions (a union of balls, the
// principal axes, a sphere, derivatives), never an earlier implementation's output. The suite needs a Python with
// numpy, so it runs with the Python the pinned Blender ships (found from WALLETWALL_BLENDER) or a python3 that has
// numpy; on a host with neither it is skipped, and CI's Render determinism job, which installs Blender, runs it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';

const SUITE = path.join(VIDEO_ROOT, 'test', 'python', 'sdf_properties.py');

const hasNumpy = (python: string): boolean => spawnSync(python, ['-I', '-c', 'import numpy'], { encoding: 'utf8' }).status === 0;

/** The pinned Blender's own Python (<blender dir>/<major.minor>/python/bin/python*), then a python3 or python on PATH. */
function pythonWithNumpy(): string | null {
  const blender = process.env.WALLETWALL_BLENDER;
  if (blender) {
    const series = loadBlenderConfig().blender.version.split('.').slice(0, 2).join('.');
    const bin = path.join(path.dirname(blender), series, 'python', 'bin');
    const names = existsSync(bin) ? readdirSync(bin).filter((n) => /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/.test(n)).sort() : [];
    for (const name of names) if (hasNumpy(path.join(bin, name))) return path.join(bin, name);
  }
  for (const name of ['python3', 'python']) if (hasNumpy(name)) return name;
  return null;
}

const python = pythonWithNumpy();
// Where the suite must run (CI's Render determinism job sets this), a missing Python is a failure, never a skip.
const required = process.env.WALLETWALL_REQUIRE_SDF_TESTS === '1';

test('the signed-distance primitives and operators hold their geometric properties', { skip: python === null && !required ? 'needs a Python with numpy (the pinned Blender\'s, via WALLETWALL_BLENDER, or python3)' : false }, () => {
  assert.ok(python !== null, 'WALLETWALL_REQUIRE_SDF_TESTS is set, and no Python with numpy was found (the pinned Blender\'s, via WALLETWALL_BLENDER, or python3)');
  const r = spawnSync(python, ['-I', SUITE], { cwd: VIDEO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const report = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, report);
  const ran = /^Ran (\d+) tests? /m.exec(report);
  assert.ok(ran && Number(ran[1]) >= 28, `the suite ran every property test:\n${report}`);
  assert.match(report, /^OK$/m);
});
