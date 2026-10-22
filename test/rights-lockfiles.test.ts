// Every package the lockfiles resolve is accounted for. A package whose license is permissive needs nothing; every
// other one (a vendor license, MPL, OFL, CC-BY, a copyleft, an unreadable string, or no license at all) must be covered
// by a rule in the manifest that names exactly what the lockfile records. A rule that matches nothing, a license that
// changed, a crate that is not listed, or a checksum that moved is a finding: the record cannot drift silently.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assessedVersionFindings, cargoFindings, npmFindings, readCargoLock, readNpmLock } from '../src/rights/lockfiles.ts';
import type { Component, CrateEntry, NpmRule } from '../src/rights/manifest.ts';
import { baseManifest, component, type Json } from './rights-fixtures.ts';

const lockText = (packages: Record<string, Json>): string => JSON.stringify({ name: 'x', lockfileVersion: 3, packages: { '': { name: 'x' }, ...packages } });
const npm = (packages: Record<string, Json>) => readNpmLock(lockText(packages));
const rule = (over: Partial<NpmRule> & Json = {}): NpmRule => ({
  id: 'r',
  match: { package: 'vendor-lib' },
  version: null,
  lockLicense: 'SEE LICENSE IN LICENSE.md',
  resolvedLicense: null,
  component: 'remotion',
  evidence: [{ type: 'PACKAGE', ref: 'vendor-lib@1.0.0' }],
  ...over,
});
const codes = (found: { code: string }[]): string[] => found.map((f) => f.code);

describe('reading the npm lockfile', () => {
  test('the package name comes from the last node_modules segment, so a nested copy is still named', () => {
    const { packages } = npm({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/a/node_modules/@s/b': { version: '2.0.0', license: 'ISC', dev: true } });
    // Sorted by name, so the order never depends on the lockfile's own ordering.
    assert.deepEqual(packages.map((p) => [p.name, p.version, p.license, p.dev]), [['@s/b', '2.0.0', 'ISC', true], ['a', '1.0.0', 'MIT', false]]);
  });

  test('a lockfile that is not JSON, or has no packages map, is a problem, never an empty pass', () => {
    assert.ok(readNpmLock('not json').problems.length > 0);
    assert.ok(readNpmLock('{"lockfileVersion":3}').problems.length > 0);
    assert.ok(readNpmLock('{"lockfileVersion":1,"dependencies":{"a":{"version":"1.0.0"}}}').problems.length > 0, 'a v1 lockfile has no packages map');
    assert.ok(readNpmLock('[]').problems.length > 0);
  });

  test('an entry that is not a registry package (a link, a git source, a workspace) is reported with its reason, not skipped', () => {
    const cases: [string, Json][] = [
      ['a link', { 'node_modules/local': { version: '1.0.0', resolved: 'file:../local', link: true } }],
      ['a file source', { 'node_modules/local': { version: '1.0.0', resolved: 'file:../local' } }],
      ['a git source', { 'node_modules/fromgit': { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/y.git#abc' } }],
      ['a workspace', { 'packages/ws': { version: '1.0.0' } }],
    ];
    for (const [label, entries] of cases) {
      const r = npm(entries);
      assert.equal(r.problems.length, 1, label);
      assert.match(r.problems[0]!, /non-registry source/, label);
      assert.deepEqual(r.packages, [], `${label} is not listed as if its license were known`);
    }
    // A registry package is read normally.
    const ok = npm({ 'node_modules/ok': { version: '1.0.0', resolved: 'https://registry.npmjs.org/ok/-/ok-1.0.0.tgz', license: 'MIT' } });
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.packages.length, 1);
  });
});

describe('npm license coverage', () => {
  test('permissive licenses need no rule', () => {
    const { packages } = npm({ 'node_modules/a': { version: '1.0.0', license: 'MIT' }, 'node_modules/b': { version: '1.0.0', license: '(MIT OR Apache-2.0)' }, 'node_modules/c': { version: '1.0.0', license: 'BSD-3-Clause' } });
    assert.deepEqual(npmFindings(packages, []), []);
  });

  test('a license outside the permissive set, or none, or prose, is unclassified until a rule covers it', () => {
    for (const license of ['GPL-3.0-only', 'LGPL-2.1', 'MPL-2.0', 'OFL-1.1', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'UNLICENSED', 'SEE LICENSE IN LICENSE.md', 'MIT AND GPL-3.0-only']) {
      const { packages } = npm({ 'node_modules/p': { version: '1.0.0', license } });
      assert.deepEqual(codes(npmFindings(packages, [])), ['NPM_LICENSE_UNCLASSIFIED'], license);
    }
    const none = npm({ 'node_modules/p': { version: '1.0.0' } }).packages;
    assert.deepEqual(codes(npmFindings(none, [])), ['NPM_LICENSE_UNCLASSIFIED']);
  });

  test('a rule that names the recorded license covers the package', () => {
    const { packages } = npm({ 'node_modules/vendor-lib': { version: '1.0.0', license: 'SEE LICENSE IN LICENSE.md' } });
    assert.deepEqual(npmFindings(packages, [rule()]), []);
  });

  test('a rule cannot wave through a different license than the lockfile records', () => {
    const { packages } = npm({ 'node_modules/vendor-lib': { version: '1.0.0', license: 'GPL-3.0-only' } });
    assert.deepEqual(codes(npmFindings(packages, [rule()])), ['NPM_RULE_MISMATCH']);
  });

  test('a package with no recorded license is covered only by a rule for that exact version', () => {
    const { packages } = npm({ 'node_modules/@bin/linux': { version: '0.28.1' } });
    const pinned = rule({ match: { package: '@bin/linux' }, version: '0.28.1', lockLicense: null, component: null, resolvedLicense: 'MIT' });
    assert.deepEqual(npmFindings(packages, [pinned]), []);
    const bumped = npm({ 'node_modules/@bin/linux': { version: '0.29.0' } }).packages;
    assert.deepEqual(codes(npmFindings(bumped, [pinned])).sort(), ['NPM_LICENSE_UNCLASSIFIED', 'NPM_RULE_UNUSED']);
  });

  test('a prefix rule covers every package of the scope it names, and only those', () => {
    const packages = npm({ 'node_modules/@bin/a': { version: '1.0.0' }, 'node_modules/@bin/b': { version: '1.0.0' }, 'node_modules/@other/c': { version: '1.0.0' } }).packages;
    const byPrefix = rule({ match: { prefix: '@bin/' }, version: '1.0.0', lockLicense: null, component: null, resolvedLicense: 'MIT' });
    const found = npmFindings(packages, [byPrefix]);
    assert.deepEqual(found.map((f) => f.path), ['@other/c@1.0.0']);
  });

  test('a rule may name a list of packages, and a name on the list that the lockfile no longer has is stale', () => {
    const both = rule({ match: { packages: ['vendor-a', 'vendor-b'] } });
    const locked = npm({ 'node_modules/vendor-a': { version: '1.0.0', license: 'SEE LICENSE IN LICENSE.md' }, 'node_modules/vendor-b': { version: '2.0.0', license: 'SEE LICENSE IN LICENSE.md' } }).packages;
    assert.deepEqual(npmFindings(locked, [both]), []);
    const onlyA = npm({ 'node_modules/vendor-a': { version: '1.0.0', license: 'SEE LICENSE IN LICENSE.md' } }).packages;
    const found = npmFindings(onlyA, [both]);
    assert.deepEqual(codes(found), ['NPM_RULE_UNUSED']);
    assert.match(found[0]!.message, /vendor-b/);
    // A listed name that is locked with another license is not covered by the list.
    const other = npm({ 'node_modules/vendor-a': { version: '1.0.0', license: 'GPL-3.0-only' }, 'node_modules/vendor-b': { version: '2.0.0', license: 'SEE LICENSE IN LICENSE.md' } }).packages;
    assert.deepEqual(codes(npmFindings(other, [both])), ['NPM_RULE_MISMATCH']);
  });

  test('a resolved license that is not permissive is refused even when a rule names it', () => {
    const { packages } = npm({ 'node_modules/p': { version: '1.0.0' } });
    const bad = rule({ match: { package: 'p' }, version: '1.0.0', lockLicense: null, component: null, resolvedLicense: 'GPL-3.0-only' });
    assert.ok(codes(npmFindings(packages, [bad])).includes('NPM_RULE_LICENSE_NOT_ACCEPTABLE'));
  });

  test('a rule that matches no package is stale and is a finding', () => {
    const { packages } = npm({ 'node_modules/a': { version: '1.0.0', license: 'MIT' } });
    assert.deepEqual(codes(npmFindings(packages, [rule()])), ['NPM_RULE_UNUSED']);
  });

  test('two rules for one package are ambiguous', () => {
    const { packages } = npm({ 'node_modules/vendor-lib': { version: '1.0.0', license: 'SEE LICENSE IN LICENSE.md' } });
    assert.ok(codes(npmFindings(packages, [rule({ id: 'a' }), rule({ id: 'b' })])).includes('NPM_RULE_AMBIGUOUS'));
  });

  test('findings are sorted and stable', () => {
    const { packages } = npm({ 'node_modules/z': { version: '1.0.0', license: 'GPL-3.0-only' }, 'node_modules/a': { version: '1.0.0', license: 'GPL-3.0-only' } });
    assert.deepEqual(npmFindings(packages, []).map((f) => f.path), ['a@1.0.0', 'z@1.0.0']);
  });
});

const CARGO = `# generated
version = 4

[[package]]
name = "libm"
version = "0.2.16"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${'1'.repeat(64)}"

[[package]]
name = "mine"
version = "0.3.0"
dependencies = [
 "libm",
]
`;
const crate = (over: Partial<CrateEntry> = {}): CrateEntry => ({ name: 'libm', version: '0.2.16', checksum: '1'.repeat(64), license: 'MIT', linkage: 'COMPILED_INTO_COMMITTED_ARTIFACT', evidence: [{ type: 'PACKAGE', ref: 'libm@0.2.16' }], ...over });

describe('reading Cargo.lock', () => {
  test("registry crates carry their checksum; this repository's own crate has none and is not listed", () => {
    const { packages, problems } = readCargoLock(CARGO, ['mine']);
    assert.deepEqual(problems, []);
    assert.deepEqual(packages.map((p) => [p.name, p.version, p.checksum === null]), [['libm', '0.2.16', false]]);
  });

  test('a git or path source has no checksum to bind a license to, and is a problem', () => {
    const text = `${CARGO}\n[[package]]\nname = "gitdep"\nversion = "1.0.0"\nsource = "git+https://example.com/x#abc"\n`;
    assert.ok(readCargoLock(text, ['mine']).problems.some((p) => /gitdep/.test(p)));
  });

  test("a package with no source that is not this repository's own crate (a path or vendored dependency) is a problem, never silently skipped", () => {
    const text = `${CARGO}\n[[package]]\nname = "pathdep"\nversion = "1.0.0"\n`;
    const r = readCargoLock(text, ['mine']);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0]!, /pathdep/);
    // With no own crate declared, even this repository's crate is unaccounted for.
    assert.ok(readCargoLock(CARGO).problems.some((p) => /mine/.test(p)));
  });

  test('an unreadable lockfile is a problem, never an empty pass', () => {
    assert.ok(readCargoLock('').problems.length > 0);
    assert.ok(readCargoLock('this is not a lockfile').problems.length > 0);
  });
});

describe('Cargo license coverage', () => {
  const { packages } = readCargoLock(CARGO, ['mine']);
  test('a listed crate with a permissive license, the locked version, and the locked checksum passes', () => {
    assert.deepEqual(cargoFindings(packages, [crate()]), []);
  });
  test('a crate in the lockfile but not in the manifest is unlisted', () => {
    assert.deepEqual(codes(cargoFindings(packages, [])), ['CARGO_CRATE_UNLISTED']);
  });
  test('a crate in the manifest but not in the lockfile is stale', () => {
    assert.deepEqual(codes(cargoFindings(packages, [crate(), crate({ name: 'gone', version: '1.0.0' })])), ['CARGO_CRATE_STALE']);
  });
  test('a bumped version is a different crate: the old record is stale and the new one unlisted', () => {
    assert.deepEqual(codes(cargoFindings(packages, [crate({ version: '0.2.15' })])).sort(), ['CARGO_CRATE_STALE', 'CARGO_CRATE_UNLISTED']);
  });
  test('a moved checksum means the recorded license is for different bytes', () => {
    assert.deepEqual(codes(cargoFindings(packages, [crate({ checksum: '2'.repeat(64) })])), ['CARGO_CHECKSUM_MISMATCH']);
  });
  test('a license outside the permissive set is refused', () => {
    assert.deepEqual(codes(cargoFindings(packages, [crate({ license: 'GPL-3.0-only' })])), ['CARGO_LICENSE_NOT_ACCEPTABLE']);
    assert.deepEqual(codes(cargoFindings(packages, [crate({ license: 'MIT AND LGPL-2.1' })])), ['CARGO_LICENSE_NOT_ACCEPTABLE']);
    assert.deepEqual(cargoFindings(packages, [crate({ license: 'Unlicense OR MIT' })]), []);
  });
});

describe('assessments pinned to a version', () => {
  const remotion = (m: Json = baseManifest()): Component => component(m, 'remotion') as Component;
  test('the assessed version must be the one the lockfile resolves', () => {
    const { packages } = npm({ 'node_modules/remotion': { version: '4.0.532', license: 'SEE LICENSE IN LICENSE.md' } });
    assert.deepEqual(assessedVersionFindings(packages, [remotion()]), []);
    const bumped = npm({ 'node_modules/remotion': { version: '4.0.533', license: 'SEE LICENSE IN LICENSE.md' } }).packages;
    const found = assessedVersionFindings(bumped, [remotion()]);
    assert.deepEqual(codes(found), ['REASSESSMENT_REQUIRED']);
    assert.match(found[0]!.message, /remotion 4\.0\.533/);
  });
  test('every resolved copy counts: a second, different copy of the assessed package is caught', () => {
    const { packages } = npm({ 'node_modules/remotion': { version: '4.0.532' }, 'node_modules/x/node_modules/remotion': { version: '4.0.100' } });
    assert.deepEqual(codes(assessedVersionFindings(packages, [remotion()])), ['REASSESSMENT_REQUIRED']);
  });
  test('an assessed package that is no longer locked is stale', () => {
    const { packages } = npm({ 'node_modules/other': { version: '1.0.0', license: 'MIT' } });
    assert.deepEqual(codes(assessedVersionFindings(packages, [remotion()])), ['REASSESSMENT_REQUIRED']);
  });
});
