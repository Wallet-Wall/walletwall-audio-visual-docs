// `npm run rights:check`: the repository's licensing boundaries and release rights, judged from the committed files
// alone. Development mode passes with recorded owner decisions pending and never with a falsely cleared or drifted
// record; public-release mode (--public-release) fails on every item that is not CLEARED.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { checkRights, renderReport, type RightsReport } from '../src/rights/check.ts';
import { fsRepo } from '../src/rights/repo.ts';
import { RIGHTS_STATUSES, STATUSES_PERMITTED_IN } from '../src/rights/vocabulary.ts';
import { baseFiles, baseManifest, BLOB, component, component as component_, designedVoice, dropCharacter, GPL_TEXT, memoryRepo, MIT_TEXT, repoWith, withNarration, type Json } from './rights-fixtures.ts';

const dev = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'development' });
const strict = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'public-release' });
const codes = (r: RightsReport): string[] => r.findings.map((f) => f.code);
const paths = (r: RightsReport, code: string): string[] => r.findings.filter((f) => f.code === code).map((f) => f.path);

/** Every item cleared, the owner's record for the vendor license included: the one state in which the strict check can pass. */
const cleared = (r: { manifest: Json }): void => {
  Object.assign(component(r.manifest, 'remotion'), { status: 'CLEARED', clearance: { clearedBy: 'OWNER', clearedOn: '2026-11-01', basis: 'The vendor confirmed that the Free License applies to this project.' } });
  delete component(r.manifest, 'remotion').resolution;
};

describe('the Blender license boundary', () => {
  test('the committed fixture lane passes: the API file is GPL-3.0-or-later and the helper keeps MIT', () => {
    assert.deepEqual(codes(dev()), []);
  });

  test('1. a Blender-API file must carry GPL-3.0-or-later: MIT, no header, or an expression all fail', () => {
    for (const header of ['# SPDX-License-Identifier: MIT\n', '', '# SPDX-License-Identifier: GPL-3.0-or-later OR MIT\n', '# SPDX-License-Identifier: GPL-2.0-only\n']) {
      const r = dev(repoWith((x) => (x.files['blender/lane/rig.py'] = `${header}# SPDX-FileCopyrightText: 2026 WalletWall\n"""The rig."""\nimport bpy\nfrom common import UNITS\n`)));
      assert.ok(codes(r).some((c) => c === 'PYTHON_LICENSE_HEADER_MISSING' || c === 'PYTHON_LICENSE_HEADER_WRONG'), JSON.stringify(header));
      assert.equal(r.result, 'FAIL');
    }
  });

  test('1b. the copyright line must be the repository holder, not an invented one', () => {
    const r = dev(repoWith((x) => (x.files['blender/lane/rig.py'] = '# SPDX-License-Identifier: GPL-3.0-or-later\n# SPDX-FileCopyrightText: 2026 Someone Else\nimport bpy\nfrom common import UNITS\n')));
    assert.deepEqual(codes(r), ['PYTHON_COPYRIGHT_HEADER_WRONG']);
  });

  test('2. a new bpy-using file with no classification fails, and the message says it reaches the API', () => {
    const r = dev(repoWith((x) => (x.files['blender/lane/new.py'] = '# SPDX-License-Identifier: GPL-3.0-or-later\nimport bpy\n')));
    assert.deepEqual(paths(r, 'PYTHON_UNCLASSIFIED'), ['blender/lane/new.py']);
    assert.match(r.findings.find((f) => f.code === 'PYTHON_UNCLASSIFIED')!.message, /BLENDER_API_COUPLED/);
  });

  test('2b. a new file that reaches the API only through a sibling is just as unclassified', () => {
    const r = dev(repoWith((x) => (x.files['blender/lane/controls.py'] = 'from rig import f\n')));
    assert.match(r.findings.find((f) => f.code === 'PYTHON_UNCLASSIFIED')!.message, /BLENDER_API_COUPLED/);
  });

  test('3. a pure external launcher stays MIT when it really uses no Blender API', () => {
    const launcher = 'import json, subprocess\nsubprocess.run(["blender", "--background", "--python", "blender/lane/rig.py", "--", "--job", "job.json"], check=True)\n';
    const r = dev(repoWith((x) => {
      x.files['tools/launch.py'] = launcher;
      x.manifest.sourceCode.python.push({ path: 'tools/launch.py', classification: 'BLENDER_INDEPENDENT', license: 'MIT', reason: 'writes a job file and runs Blender as a subprocess; no Blender API' });
    }));
    assert.deepEqual(codes(r), []);
  });

  test('3b. the manifest cannot downgrade a coupled file to independent, nor upgrade a launcher to coupled', () => {
    const down = dev(repoWith((x) => Object.assign(x.manifest.sourceCode.python[0], { classification: 'BLENDER_INDEPENDENT', license: 'MIT' })));
    assert.ok(codes(down).includes('PYTHON_CLASSIFICATION_MISMATCH'));
    assert.match(down.findings.find((f) => f.code === 'PYTHON_CLASSIFICATION_MISMATCH')!.message, /under MIT/);
    const up = dev(repoWith((x) => Object.assign(x.manifest.sourceCode.python[1], { classification: 'BLENDER_API_COUPLED', license: 'GPL-3.0-or-later' })));
    assert.ok(codes(up).includes('PYTHON_CLASSIFICATION_MISMATCH'));
  });

  test('a helper loaded inside Blender, in a directory that mixes licenses, must say which license it keeps', () => {
    const r = dev(repoWith((x) => (x.files['blender/lane/common.py'] = 'import json\nUNITS = 0.01\n')));
    assert.deepEqual(codes(r), ['PYTHON_LICENSE_HEADER_MISSING']);
  });

  test('an independent file in a directory with no coupled file needs no header, but a wrong one is refused', () => {
    const base = (x: { files: Record<string, string>; manifest: Json }, header: string): void => {
      x.files['tools/solo.py'] = `${header}import json\n`;
      x.manifest.sourceCode.python.push({ path: 'tools/solo.py', classification: 'BLENDER_INDEPENDENT', license: 'MIT', reason: 'plain script' });
    };
    assert.deepEqual(codes(dev(repoWith((x) => base(x, '')))), []);
    assert.deepEqual(codes(dev(repoWith((x) => base(x, '# SPDX-License-Identifier: GPL-3.0-or-later\n')))), ['PYTHON_LICENSE_HEADER_WRONG']);
  });

  test('a manifest entry for a Python file that no longer exists is stale', () => {
    const r = dev(repoWith((x) => delete x.files['blender/lane/common.py']));
    assert.ok(paths(r, 'PYTHON_ENTRY_STALE').includes('blender/lane/common.py'));
  });

  test('a file the analysis cannot decide is review-required: pending in development, a blocker in a public release', () => {
    const files = (x: { files: Record<string, string>; manifest: Json }): void => {
      x.files['blender/lane/odd.py'] = '# SPDX-License-Identifier: GPL-3.0-or-later\n# SPDX-FileCopyrightText: 2026 WalletWall\nbpy.ops.mesh.primitive_cube_add()\n';
      x.manifest.sourceCode.python.push({ path: 'blender/lane/odd.py', classification: 'REVIEW_REQUIRED', license: 'GPL-3.0-or-later', reason: 'uses bpy without importing it' });
      cleared(x);
    };
    assert.deepEqual(codes(dev(repoWith(files))), []);
    assert.ok(dev(repoWith(files)).pending.some((p) => p.kind === 'python' && p.id === 'blender/lane/odd.py'));
    // The remedy is something the owner can do: rewrite the construct so the analysis can read it, or record the file as coupled.
    assert.match(dev(repoWith(files)).pending.find((p) => p.kind === 'python')!.ownerAction, /rewrite .* absolute import|record the file as BLENDER_API_COUPLED/s);
    assert.deepEqual(paths(strict(repoWith(files)), 'PYTHON_REVIEW_REQUIRED'), ['blender/lane/odd.py']);
  });

  test('Blender API use hidden in a string a script hands to Blender is found outside Python files', () => {
    const r = dev(repoWith((x) => (x.files['scripts/run.ts'] = "const code = 'import bpy; bpy.ops.wm.read_factory_settings()';\n")));
    assert.deepEqual(paths(r, 'BLENDER_PYTHON_IN_NON_PYTHON_FILE'), ['scripts/run.ts']);
    // The tests, the checker itself, and prose must be able to spell the pattern.
    const exempt = dev(repoWith((x) => { x.files['test/x.test.ts'] = "const s = 'import bpy';\n"; x.files['docs/x.md'] = 'import bpy\n'; }));
    assert.deepEqual(codes(exempt), []);
  });
});

describe('license files and the top-level MIT license', () => {
  test('4. a missing license file fails', () => {
    const r = dev(repoWith((x) => delete x.files['LICENSES/GPL-3.0-or-later.txt']));
    assert.deepEqual(paths(r, 'LICENSE_FILE_MISSING'), ['LICENSES/GPL-3.0-or-later.txt']);
    assert.equal(r.result, 'FAIL');
  });

  test('a license text that is not the pinned bytes, or not the license it names, fails', () => {
    const edited = dev(repoWith((x) => (x.files['LICENSES/GPL-3.0-or-later.txt'] = `${GPL_TEXT}\nPlus an extra permission.\n`)));
    assert.deepEqual(codes(edited), ['LICENSE_FILE_MISMATCH']);
    const wrong = dev(repoWith((x) => { x.files['LICENSES/GPL-3.0-or-later.txt'] = MIT_TEXT; x.manifest.sourceCode.licenseFiles[2].sha256 = sha256Hex(MIT_TEXT); }));
    assert.deepEqual(codes(wrong), ['LICENSE_TEXT_UNEXPECTED']);
  });

  test('the root LICENSE stays MIT: replacing it, or letting the copy drift from it, fails', () => {
    const gpl = dev(repoWith((x) => { x.files['LICENSE'] = GPL_TEXT; x.manifest.sourceCode.licenseFiles[0].sha256 = sha256Hex(GPL_TEXT); }));
    assert.ok(codes(gpl).includes('LICENSE_TEXT_UNEXPECTED'));
    const drift = dev(repoWith((x) => { x.files['LICENSES/MIT.txt'] = `${MIT_TEXT}\n`; x.manifest.sourceCode.licenseFiles[1].sha256 = sha256Hex(`${MIT_TEXT}\n`); }));
    assert.deepEqual(codes(drift), ['LICENSE_MIT_COPY_DIFFERS']);
    const unlisted = dev(repoWith((x) => x.manifest.sourceCode.licenseFiles.splice(0, 1)));
    assert.ok(codes(unlisted).includes('LICENSE_FILE_NOT_LISTED'));
  });

  test('the default license is stated by package.json and Cargo.toml too, so one cannot be relicensed alone', () => {
    const pkg = dev(repoWith((x) => (x.files['package.json'] = JSON.stringify({ name: 'demo', license: 'GPL-3.0-or-later', dependencies: { remotion: '4.0.532' } }))));
    assert.deepEqual(codes(pkg), ['PACKAGE_LICENSE_MISMATCH']);
    const cargo = dev(repoWith((x) => (x.files['motion-intelligence/Cargo.toml'] = '[package]\nname = "mi"\nlicense = "GPL-3.0-or-later"\n')));
    assert.deepEqual(codes(cargo), ['PACKAGE_LICENSE_MISMATCH']);
  });

  test('a GPL file needs the GPL text to be listed, even if the manifest forgot it', () => {
    const r = dev(repoWith((x) => x.manifest.sourceCode.licenseFiles.splice(2, 1)));
    assert.ok(codes(r).includes('LICENSE_FILE_NOT_LISTED'));
  });
});

/** A repository whose manifest file is exactly this text (repoWith would re-serialize the manifest over it). */
const withRawManifest = (raw: string | null): ReturnType<typeof memoryRepo> => {
  const files = baseFiles();
  if (raw === null) delete files['config/release-rights.json'];
  else files['config/release-rights.json'] = raw;
  return memoryRepo(files);
};

describe('the manifest is read closed', () => {
  test('14. malformed JSON, a non-object, an extra field, or an unknown status fails closed and says nothing else passed', () => {
    for (const bad of ['{', '[]', 'null', '"x"', '']) {
      const r = dev(withRawManifest(bad));
      assert.equal(r.result, 'FAIL', JSON.stringify(bad));
      assert.equal(r.manifestSha256, null, 'no identity is claimed for a manifest that is not valid');
    }
    const m = baseManifest();
    m.surprise = true;
    const r = dev(withRawManifest(JSON.stringify(m)));
    assert.deepEqual(codes(r), ['MANIFEST_INVALID']);
    assert.equal(r.manifestSha256, null);
  });

  test('a __proto__ member in the file is an unknown field, not a prototype assignment', () => {
    const raw = JSON.stringify(baseManifest()).replace('{"schema"', '{"__proto__":{"status":"CLEARED"},"schema"');
    assert.ok(codes(dev(withRawManifest(raw))).includes('MANIFEST_INVALID'));
  });

  test('5. an unknown rights status fails', () => {
    const r = dev(repoWith((x) => (component(x.manifest, 'remotion').status = 'PROBABLY_FINE')));
    assert.ok(codes(r).includes('MANIFEST_INVALID'));
  });

  test('6. a missing rights basis fails', () => {
    const r = dev(repoWith((x) => delete component(x.manifest, 'blender-runtime').rightsBasis));
    assert.ok(codes(r).includes('MANIFEST_INVALID'));
  });

  test('a missing manifest fails; it is never a pass', () => {
    const r = dev(withRawManifest(null));
    assert.deepEqual(codes(r), ['MANIFEST_UNREADABLE']);
    assert.equal(strict(withRawManifest(null)).result, 'FAIL');
  });
});

describe('development mode and public-release mode', () => {
  test('7. development mode permits an explicitly pending owner decision, and lists it', () => {
    const r = dev();
    assert.equal(r.result, 'PASS');
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.pending.map((p) => [p.kind, p.id, p.status]), [['component', 'remotion', 'OWNER_CONFIRMATION_PENDING']]);
    assert.match(r.pending[0]!.ownerAction, /vendor/);
  });

  test('8. public-release mode rejects that same pending item', () => {
    const r = strict();
    assert.equal(r.result, 'FAIL');
    assert.deepEqual(paths(r, 'RIGHTS_BLOCKING_STATUS'), ['remotion']);
    assert.match(r.findings.find((f) => f.code === 'RIGHTS_BLOCKING_STATUS')!.message, /OWNER_CONFIRMATION_PENDING/);
  });

  test('9. NONCOMMERCIAL blocks a public release (and is only recorded in development)', () => {
    const change = (x: { manifest: Json }): void => { cleared(x); Object.assign(x.manifest.videos[0].assets[0], { rightsBasis: 'THIRD_PARTY_ATTRIBUTION_ONLY', status: 'NONCOMMERCIAL', resolution: { ownerAction: 'Replace the asset.', reassessmentTrigger: 'A new asset is supplied.' } }); };
    assert.equal(dev(repoWith(change)).result, 'PASS');
    const r = strict(repoWith(change));
    assert.deepEqual(paths(r, 'RIGHTS_BLOCKING_STATUS'), ['demo/brand-mark']);
    assert.match(r.findings[0]!.message, /NONCOMMERCIAL/);
  });

  test('10. UNKNOWN blocks a public release', () => {
    const r = strict(repoWith((x) => { cleared(x); Object.assign(x.manifest.videos[0].assets[0], { rightsBasis: 'UNDETERMINED', status: 'UNKNOWN', resolution: { ownerAction: 'Find where this came from.', reassessmentTrigger: 'The source is identified.' } }); }));
    assert.deepEqual(paths(r, 'RIGHTS_BLOCKING_STATUS'), ['demo/brand-mark']);
  });

  test('every status other than CLEARED blocks a public release, whichever one it is', () => {
    for (const status of RIGHTS_STATUSES.filter((s) => s !== 'CLEARED')) {
      const r = strict(repoWith((x) => { cleared(x); Object.assign(x.manifest.videos[0].assets[0], { rightsBasis: 'UNDETERMINED', status: status === 'UNKNOWN' || status === 'UNVERIFIED' ? status : 'UNKNOWN', resolution: { ownerAction: 'x', reassessmentTrigger: 'y' } }); if (status !== 'UNKNOWN' && status !== 'UNVERIFIED') Object.assign(x.manifest.videos[0].assets[0], { rightsBasis: 'THIRD_PARTY_ATTRIBUTION_ONLY', status }); }));
      assert.deepEqual(paths(r, 'RIGHTS_BLOCKING_STATUS'), ['demo/brand-mark'], status);
    }
  });

  test('11. everything cleared, an owner-authored asset included, passes both modes', () => {
    const repo = repoWith(cleared);
    assert.equal(dev(repo).result, 'PASS');
    const r = strict(repo);
    assert.deepEqual(r.findings, []);
    assert.equal(r.result, 'PASS');
    assert.deepEqual(r.pending, []);
  });

  test('a research-only component is out of the release path and does not block, but cannot be cleared by being listed', () => {
    const research = (x: { manifest: Json }): void => {
      cleared(x);
      x.manifest.components.push({ id: 'bakeoff-tts', layer: 'TOOL_RUNTIME', kind: 'research-tool', scope: 'RESEARCH_ONLY', rightsBasis: 'UNDETERMINED', status: 'UNVERIFIED', licenseExpression: null, distribution: 'NOT_DISTRIBUTED', summary: 'Evaluation adapters; no output reaches a release.', evidence: [{ type: 'FILE', ref: 'docs/RELEASE_RIGHTS.md' }], resolution: { ownerAction: 'Assess before any use in a release.', reassessmentTrigger: 'A research output is proposed for a release.' } });
    };
    const files = (x: { files: Record<string, string>; manifest: Json }): void => { research(x); x.files['THIRD_PARTY_NOTICES.md'] += '### `bakeoff-tts`\n'; };
    assert.equal(strict(repoWith(files)).result, 'PASS');
  });

  test('the policy table: only CLEARED is permitted from RIGHTS_CLEARED on, and nothing earlier needs more than a local proof', () => {
    assert.deepEqual(STATUSES_PERMITTED_IN.RIGHTS_CLEARED, ['CLEARED']);
    assert.deepEqual(STATUSES_PERMITTED_IN.UNLISTED, ['CLEARED']);
    assert.deepEqual(STATUSES_PERMITTED_IN.OWNER_REVIEWED, ['CLEARED']);
    assert.deepEqual(STATUSES_PERMITTED_IN.PUBLIC, ['CLEARED']);
    assert.deepEqual([...STATUSES_PERMITTED_IN.LOCAL_PROOF], [...RIGHTS_STATUSES]);
  });
});

describe('release states cannot claim more than the rights support', () => {
  test('a video recorded as RIGHTS_CLEARED (or later) while an item is pending is refused even in development mode', () => {
    for (const state of ['RIGHTS_CLEARED', 'UNLISTED', 'OWNER_REVIEWED']) {
      const r = dev(repoWith((x) => (x.manifest.videos[0].release.state = state)));
      assert.deepEqual(paths(r, 'RELEASE_STATE_UNSUPPORTED'), ['demo'], state);
    }
  });

  test('with everything cleared those states are supported; PUBLIC also needs the owner authorization record', () => {
    for (const state of ['RIGHTS_CLEARED', 'UNLISTED', 'OWNER_REVIEWED']) assert.deepEqual(codes(dev(repoWith((x) => { cleared(x); x.manifest.videos[0].release.state = state; }))), [], state);
    const pub = repoWith((x) => { cleared(x); Object.assign(x.manifest.videos[0].release, { state: 'PUBLIC', ownerAuthorization: { authorizedBy: 'OWNER', transition: 'UNLISTED->PUBLIC', receiptSha256: 'e'.repeat(64) } }); });
    assert.deepEqual(codes(strict(pub)), []);
    const noOwner = repoWith((x) => { cleared(x); x.manifest.videos[0].release.state = 'PUBLIC'; });
    assert.ok(codes(dev(noOwner)).includes('MANIFEST_INVALID'));
  });

  test('an asset cannot be CLEARED while the component it is bound to is not', () => {
    const r = dev(repoWith((x) => {
      x.manifest.videos[0].assets.push({ id: 'three-d', category: 'illustration', binding: { type: 'COMPONENT', componentId: 'remotion' }, rightsBasis: 'OWNER_AUTHORED', status: 'CLEARED', licenseExpression: null, evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }] });
      x.manifest.videos[0].absent.splice(x.manifest.videos[0].absent.indexOf('illustration'), 1);
    }));
    assert.deepEqual(paths(r, 'ASSET_ABOVE_COMPONENT'), ['demo/three-d']);
  });
});

describe('dependencies cannot drift', () => {
  const lock = (extra: Record<string, Json> = {}, remotionVersion = '4.0.532'): string =>
    JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/remotion': { version: remotionVersion, license: 'SEE LICENSE IN LICENSE.md' }, ...extra } });

  test('a new transitive package with a copyleft or missing license fails until it is recorded', () => {
    const copyleft = dev(repoWith((x) => (x.files['package-lock.json'] = lock({ 'node_modules/deep': { version: '1.0.0', license: 'GPL-3.0-only' } }))));
    assert.deepEqual(paths(copyleft, 'NPM_LICENSE_UNCLASSIFIED'), ['deep@1.0.0']);
    const none = dev(repoWith((x) => (x.files['package-lock.json'] = lock({ 'node_modules/deep': { version: '1.0.0' } }))));
    assert.deepEqual(paths(none, 'NPM_LICENSE_UNCLASSIFIED'), ['deep@1.0.0']);
  });

  test('a permissive transitive package is fine without any record', () => {
    assert.deepEqual(codes(dev(repoWith((x) => (x.files['package-lock.json'] = lock({ 'node_modules/deep': { version: '1.0.0', license: 'MIT' } }))))), []);
  });

  test('bumping the assessed Remotion version triggers a reassessment', () => {
    const r = dev(repoWith((x) => (x.files['package-lock.json'] = lock({}, '4.0.533'))));
    assert.deepEqual(codes(r), ['REASSESSMENT_REQUIRED']);
  });

  test('a lockfile that no longer lists a direct dependency is out of sync, so its licenses prove nothing', () => {
    const r = dev(repoWith((x) => (x.files['package-lock.json'] = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' } } }))));
    assert.ok(codes(r).includes('NPM_LOCK_OUT_OF_SYNC'));
  });

  test('a crate that moved, a new crate, or a changed checksum fails', () => {
    const bumped = dev(repoWith((x) => (x.files['motion-intelligence/Cargo.lock'] = x.files['motion-intelligence/Cargo.lock']!.replace('0.2.16', '0.2.17'))));
    assert.deepEqual(codes(bumped).sort(), ['CARGO_CRATE_STALE', 'CARGO_CRATE_UNLISTED']);
    const added = dev(repoWith((x) => (x.files['motion-intelligence/Cargo.lock'] += `\n[[package]]\nname = "newdep"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${'4'.repeat(64)}"\n`)));
    assert.deepEqual(paths(added, 'CARGO_CRATE_UNLISTED'), ['newdep@1.0.0']);
  });

  test('a component the detected tooling requires cannot be left out', () => {
    const noBlender = dev(repoWith((x) => { dropCharacter(x); x.manifest.components = x.manifest.components.filter((c: Json) => c.id !== 'blender-runtime' && c.id !== 'blender-render-output'); }));
    assert.ok(paths(noBlender, 'REQUIRED_COMPONENT_MISSING').includes('blender-runtime'));
  });
});

describe('media assets are part of the rights, not only the dependencies', () => {
  test('a new spec asset with no rights entry fails, and so does one recorded against other bytes or the wrong category', () => {
    const spec = (assets: Json[]): ((x: { files: Record<string, string> }) => void) => (x) => (x.files['specs/demo/spec.json'] = JSON.stringify({ assets, source: { docPath: 'docs/demo.mdx', blob: BLOB }, audio: { voiceIdentityId: null, sonicIdentityId: 'i', musicBedId: null } }));
    const brand = { id: 'brand-mark', kind: 'BRAND_MARK', path: 'video/assets/brand/mark.png', sha256: 'c'.repeat(64) };
    const added = dev(repoWith(spec([brand, { id: 'shot', kind: 'REAL_UI_CAPTURE', path: 'video/assets/ui-captures/a.png', sha256: 'd'.repeat(64) }])));
    assert.deepEqual(paths(added, 'SPEC_ASSET_UNCOVERED'), ['demo/shot']);
    const moved = dev(repoWith(spec([{ ...brand, sha256: 'f'.repeat(64) }])));
    assert.deepEqual(paths(moved, 'SPEC_ASSET_HASH_MISMATCH'), ['demo/brand-mark']);
    const wrongKind = dev(repoWith(spec([{ ...brand, kind: 'REAL_UI_CAPTURE' }])));
    assert.deepEqual(paths(wrongKind, 'SPEC_ASSET_CATEGORY_MISMATCH'), ['demo/brand-mark']);
    const removed = dev(repoWith(spec([])));
    assert.deepEqual(paths(removed, 'ASSET_BINDING_STALE'), ['demo/brand-mark']);
  });

  test('an unknown spec asset kind is refused rather than guessed', () => {
    const r = dev(repoWith((x) => (x.files['specs/demo/spec.json'] = JSON.stringify({ assets: [{ id: 'brand-mark', kind: 'STOCK_FOOTAGE', path: 'v/a.mp4', sha256: 'c'.repeat(64) }], source: { docPath: 'docs/demo.mdx', blob: BLOB }, audio: { voiceIdentityId: null, sonicIdentityId: 'i', musicBedId: null } }))));
    assert.ok(codes(r).includes('SPEC_ASSET_KIND_UNKNOWN'));
  });

  test('assigning music or a sound effect without a rights entry fails (nothing is cleared for being available online)', () => {
    const music = dev(repoWith((x) => (x.files['config/sonic-identity.json'] = JSON.stringify({ ident: { id: 'i', asset: null }, musicBeds: { bed: { asset: 'bed-v1' } }, events: { TICK: { asset: null } } }))));
    assert.deepEqual(paths(music, 'SONIC_ASSET_UNCOVERED'), ['demo/bed-v1']);
    const sfx = dev(repoWith((x) => (x.files['config/sonic-identity.json'] = JSON.stringify({ ident: { id: 'i', asset: 'ident-v1' }, musicBeds: { bed: { asset: null } }, events: { TICK: { asset: 'tick-v1' } } }))));
    assert.deepEqual(paths(sfx, 'SONIC_ASSET_UNCOVERED'), ['demo/ident-v1', 'demo/tick-v1']);
  });

  test('a recorded sonic asset covers its id, in the category of its use', () => {
    const r = dev(repoWith((x) => {
      x.files['config/sonic-identity.json'] = JSON.stringify({ ident: { id: 'i', asset: null }, musicBeds: { bed: { asset: 'bed-v1' } }, events: { TICK: { asset: null } } });
      x.manifest.videos[0].assets.push({ id: 'bed', category: 'music', binding: { type: 'SONIC_ASSET', sonicAssetId: 'bed-v1' }, rightsBasis: 'OWNER_AUTHORED', status: 'CLEARED', licenseExpression: null, evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }] });
      x.manifest.videos[0].absent.splice(x.manifest.videos[0].absent.indexOf('music'), 1);
    }));
    assert.deepEqual(codes(r), []);
  });

  test('a provider-narrated video needs the provider component and a narration asset bound to it', () => {
    const narrated = (x: { files: Record<string, string> }): void => {
      x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: 'demo-publication-v1', provider: 'elevenlabs' }, providers: { elevenlabs: { voiceId: 'fixture-voice-0001' } } });
      x.files['specs/demo/spec.json'] = JSON.stringify({ assets: [{ id: 'brand-mark', kind: 'BRAND_MARK', path: 'p.png', sha256: 'c'.repeat(64) }], source: { docPath: 'docs/demo.mdx', blob: BLOB }, audio: { voiceIdentityId: 'v2', sonicIdentityId: 'i', musicBedId: null } });
    };
    const bare = dev(repoWith(narrated));
    assert.ok(paths(bare, 'REQUIRED_COMPONENT_MISSING').includes('elevenlabs-service'));
    assert.deepEqual(paths(bare, 'NARRATION_UNCOVERED'), ['demo']);
    // Covered: the provider service with the voice it speaks in, the audio it produces, and the video's narration asset, all still open.
    const covered = dev(repoWith((x) => withNarration(x, designedVoice(), 'OWNER_CONFIRMATION_PENDING')));
    assert.deepEqual(codes(covered), []);
    assert.equal(strict(repoWith((x) => { cleared(x); narrated(x); })).result, 'FAIL');
  });

  test('the docs the video is made from are recorded against the exact blob the spec names', () => {
    const r = dev(repoWith((x) => (x.files['specs/demo/spec.json'] = JSON.stringify({ assets: [{ id: 'brand-mark', kind: 'BRAND_MARK', path: 'p.png', sha256: 'c'.repeat(64) }], source: { docPath: 'docs/demo.mdx', blob: '2'.repeat(40) }, audio: { voiceIdentityId: null, sonicIdentityId: 'i', musicBedId: null } }))));
    assert.deepEqual(paths(r, 'DOCS_SOURCE_UNCOVERED'), ['demo']);
  });

  test('every font and generated model the tooling installs is bound by an asset of the video', () => {
    const r = dev(repoWith((x) => {
      x.manifest.components.push({ id: 'font-sora', layer: 'TOOL_RUNTIME', kind: 'font-package', scope: 'RELEASE_PATH', rightsBasis: 'OPEN_SOURCE_LICENSE', status: 'CLEARED', licenseExpression: 'OFL-1.1', distribution: 'NOT_DISTRIBUTED', summary: 'A font under the SIL Open Font License.', evidence: [{ type: 'PACKAGE', ref: 'sora@5.2.8' }] });
      x.files['THIRD_PARTY_NOTICES.md'] += '### `font-sora`\n';
    }));
    assert.deepEqual(paths(r, 'COMPONENT_UNBOUND'), ['demo/font-sora']);
  });

  test('a video in the registry without rights, or rights for a video that is gone, fails', () => {
    const missing = dev(repoWith((x) => (x.files['config/videos.json'] = JSON.stringify({ videos: [{ videoId: 'demo' }, { videoId: 'second' }] }))));
    assert.deepEqual(paths(missing, 'VIDEO_NOT_IN_MANIFEST'), ['second']);
    const stale = dev(repoWith((x) => (x.files['config/videos.json'] = JSON.stringify({ videos: [] }))));
    assert.deepEqual(paths(stale, 'VIDEO_ENTRY_STALE'), ['demo']);
  });
});

describe('required tooling cannot be demoted, and rules cannot borrow another component\'s license', () => {
  test('a pinned tool must stay a RELEASE_PATH tool: relabelling Remotion research-only does not make the strict check pass', () => {
    const demote = (x: { manifest: Json }): void => {
      cleared(x);
      Object.assign(component(x.manifest, 'remotion'), { kind: 'research-tool', scope: 'RESEARCH_ONLY', rightsBasis: 'UNDETERMINED', status: 'UNVERIFIED', licenseExpression: null, resolution: { ownerAction: 'x', reassessmentTrigger: 'y' } });
      delete component(x.manifest, 'remotion').clearance;
    };
    const r = strict(repoWith(demote));
    assert.ok(paths(r, 'REQUIRED_COMPONENT_MISSING').includes('remotion'));
    assert.equal(r.result, 'FAIL');
    assert.ok(dev(repoWith(demote)).findings.some((f) => f.code === 'REQUIRED_COMPONENT_MISSING'), 'and the development check refuses it too');
  });

  test('a made-up open-source identifier cannot clear Remotion without the owner', () => {
    const r = strict(repoWith((x) => Object.assign(component(x.manifest, 'remotion'), { rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'Remotion-License', status: 'CLEARED' })));
    assert.ok(codes(r).includes('MANIFEST_INVALID'));
    assert.equal(r.result, 'FAIL');
  });

  test('a lockfile rule may point only at a component whose license covers what the lockfile records', () => {
    const lock = (license: string): string => JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/remotion': { version: '4.0.532', license: 'SEE LICENSE IN LICENSE.md' }, 'node_modules/copyleft': { version: '1.0.0', license } } });
    const rule = (component: string, lockLicense: string): Json => ({ id: 'cl', match: { package: 'copyleft' }, version: null, lockLicense, resolvedLicense: null, component, evidence: [{ type: 'PACKAGE', ref: 'copyleft@1.0.0' }] });
    const files = (x: { files: Record<string, string>; manifest: Json }, license: string, target: string): void => {
      x.files['package-lock.json'] = lock(license);
      x.manifest.components.push({ id: 'npm-permissive-dependencies', layer: 'TOOL_RUNTIME', kind: 'dependency-set', scope: 'RELEASE_PATH', rightsBasis: 'OPEN_SOURCE_LICENSE', status: 'CLEARED', licenseExpression: 'MIT', distribution: 'NOT_DISTRIBUTED', summary: 'Permissive dependencies.', evidence: [{ type: 'FILE', ref: 'package-lock.json' }] });
      x.files['THIRD_PARTY_NOTICES.md'] += '### `npm-permissive-dependencies`\n';
      x.manifest.dependencies.npm.rules.push(rule(target, license));
    };
    // AGPL parked under the permissive component: refused, in both modes.
    const agpl = repoWith((x) => files(x, 'AGPL-3.0-only', 'npm-permissive-dependencies'));
    assert.deepEqual(paths(dev(agpl), 'NPM_RULE_COMPONENT_MISMATCH'), ['rule cl']);
    // Prose parked under an open-source component: refused.
    assert.deepEqual(paths(dev(repoWith((x) => files(x, 'SEE LICENSE IN LICENSE.md', 'npm-permissive-dependencies'))), 'NPM_RULE_COMPONENT_MISMATCH'), ['rule cl']);
    // A permissive license under the permissive component is fine, and so is prose under the vendor component.
    assert.deepEqual(codes(dev(repoWith((x) => files(x, 'MIT', 'npm-permissive-dependencies')))), []);
    assert.deepEqual(codes(dev(repoWith((x) => files(x, 'SEE LICENSE IN LICENSE.md', 'remotion')))), []);
  });

  test('generated media and anything that depends on a component cannot be CLEARED above it', () => {
    const r = dev(repoWith((x) => Object.assign(component(x.manifest, 'blender-runtime'), { status: 'UNVERIFIED', rightsBasis: 'UNDETERMINED', licenseExpression: null, resolution: { ownerAction: 'x', reassessmentTrigger: 'y' } })));
    assert.deepEqual(paths(r, 'COMPONENT_ABOVE_DEPENDENCY'), ['blender-render-output', 'character-model']);
    const dependent = dev(repoWith((x) => (component(x.manifest, 'blender-render-output').dependsOn = ['remotion'])));
    assert.deepEqual(paths(dependent, 'COMPONENT_ABOVE_DEPENDENCY'), ['blender-render-output']);
    // Once the dependency is cleared (with the owner's record), the dependent may be.
    assert.deepEqual(codes(dev(repoWith((x) => { cleared(x); component(x.manifest, 'blender-render-output').dependsOn = ['remotion']; }))), []);
  });
});

describe('the files the check looks at', () => {
  test('a Python file the check cannot read is a finding and never an empty independent file', () => {
    const base = baseFiles();
    base['blender/lane/big.py'] = 'import bpy\n';
    const repo = { files: () => Object.keys(base).sort(), read: (p: string) => (p === 'blender/lane/big.py' ? null : (base[p] ?? null)) };
    const r = dev(repo);
    assert.deepEqual(paths(r, 'PYTHON_UNREADABLE'), ['blender/lane/big.py']);
    assert.equal(r.result, 'FAIL');
  });

  test('a Python file is found whatever its extension case, or with no extension and a Python shebang', () => {
    for (const [name, text] of [['blender/lane/Upper.PY', 'import bpy\n'], ['blender/lane/win.pyw', 'import bpy\n'], ['blender/lane/runner', '#!/usr/bin/env python3\nimport bpy\n'], ['blender/lane/runner2', '#!/usr/bin/python\nimport mathutils\n']] as const) {
      const r = dev(repoWith((x) => (x.files[name] = text)));
      assert.deepEqual(paths(r, 'PYTHON_UNCLASSIFIED'), [name], name);
    }
    // An extensionless file that is not Python is not.
    assert.deepEqual(codes(dev(repoWith((x) => (x.files['tools/Makefile'] = 'all:\n\techo import bpy\n')))), []);
  });

  test('Blender Python in other source types (module TypeScript, JSX, notebooks, any case) is found; only the tests and the checker may spell it', () => {
    for (const name of ['scripts/run.mts', 'scripts/run.cts', 'scripts/run.JSX', 'scripts/run.Ts', 'notebooks/x.ipynb', 'scripts/run.mjs']) {
      const r = dev(repoWith((x) => (x.files[name] = 'const code = "import bpy";\n')));
      assert.deepEqual(paths(r, 'BLENDER_PYTHON_IN_NON_PYTHON_FILE'), [name], name);
    }
    // docs/ is not exempt for source files (only Markdown is out of scope), tests and the checker are.
    assert.deepEqual(paths(dev(repoWith((x) => (x.files['docs/gen.ts'] = 'const s = "import bpy";\n'))), 'BLENDER_PYTHON_IN_NON_PYTHON_FILE'), ['docs/gen.ts']);
    assert.deepEqual(codes(dev(repoWith((x) => { x.files['test/rights-x.test.ts'] = 'const s = "import bpy";\n'; x.files['src/rights/x.ts'] = 'const s = "import bpy";\n'; }))), []);
  });
});

describe('media files are inventoried, not only the ones a spec names', () => {
  test('a tracked media file with no inventory entry fails, whatever its type or extension case', () => {
    for (const name of ['assets/new.png', 'assets/new.PNG', 'assets/font.woff2', 'assets/Font.TTF', 'assets/track.mp3', 'assets/clip.mp4', 'assets/clip.webm', 'assets/model.glb', 'assets/scene.blend', 'assets/pic.svg', 'assets/x.wasm']) {
      const r = dev(repoWith((x) => (x.files[name] = 'bytes')));
      assert.deepEqual(paths(r, 'MEDIA_FILE_UNRECORDED'), [name], name);
    }
  });

  test('an entry covers a path or an exact list of paths, and an entry that matches no file is stale', () => {
    const r = dev(repoWith((x) => { x.files['more/a.png'] = 'x'; x.files['more/b.mp3'] = 'x'; x.manifest.mediaFiles.push({ id: 'more', match: { paths: ['more/a.png', 'more/b.mp3'] }, covers: { component: 'blender-render-output' } }); }));
    assert.deepEqual(codes(r), []);
    const stale = dev(repoWith((x) => x.manifest.mediaFiles.push({ id: 'ghost', match: { path: 'assets/ghost.png' }, covers: { component: 'blender-render-output' } })));
    assert.deepEqual(paths(stale, 'MEDIA_ENTRY_STALE'), ['ghost']);
    // One listed path that no longer exists leaves the entry stale for that path, so a deleted file cannot linger in the record.
    const partly = dev(repoWith((x) => { x.files['more/a.png'] = 'x'; x.manifest.mediaFiles.push({ id: 'more', match: { paths: ['more/a.png', 'more/gone.png'] }, covers: { component: 'blender-render-output' } }); }));
    assert.deepEqual(paths(partly, 'MEDIA_ENTRY_STALE'), ['more']);
    assert.match(partly.findings.find((f) => f.code === 'MEDIA_ENTRY_STALE')!.message, /more\/gone\.png/);
  });

  test('a new file dropped beside inventoried ones is not covered by them: coverage is by exact path', () => {
    const r = dev(repoWith((x) => { x.files['more/a.png'] = 'x'; x.files['more/new.png'] = 'x'; x.manifest.mediaFiles.push({ id: 'more', match: { paths: ['more/a.png'] }, covers: { component: 'blender-render-output' } }); }));
    assert.deepEqual(paths(r, 'MEDIA_FILE_UNRECORDED'), ['more/new.png']);
  });

  test('importable compiled code and archives are inventoried too, whatever their extension case', () => {
    for (const name of ['lib/mod.pyc', 'lib/mod.PYD', 'lib/mod.so', 'lib/libfoo.so.1', 'lib/libfoo.so.1.2.3', 'lib/app.pyz', 'lib/vendor.zip', 'lib/dep-1.0-py3-none-any.whl', 'lib/x.dll', 'lib/x.dylib']) {
      const r = dev(repoWith((x) => (x.files[name] = 'bytes')));
      assert.deepEqual(paths(r, 'MEDIA_FILE_UNRECORDED'), [name], name);
    }
  });
});

describe("the owner's review of a Python file the analysis could not decide", () => {
  const FALSE_POSITIVE = '# plain hardware probe, nothing to do with Blender\ngpu = open_probe()\nprint(gpu.name)\n';
  const reviewOf = (source: string, over: Json = {}): Json => ({ reviewedBy: 'OWNER', reviewedOn: '2026-11-01', fileSha256: sha256Hex(source), basis: 'gpu is a local variable holding a hardware probe; the file never reaches Blender.', ...over });
  const setup = (source: string, entry: Json): ((x: { files: Record<string, string>; manifest: Json }) => void) => (x) => {
    x.files['tools/probe.py'] = source;
    x.manifest.sourceCode.python.push({ path: 'tools/probe.py', classification: 'BLENDER_INDEPENDENT', license: 'MIT', reason: 'a hardware probe', ...entry });
  };

  test('without a review, an independent entry for an undecided file is a mismatch and the file stays pending', () => {
    const r = dev(repoWith(setup(FALSE_POSITIVE, {})));
    assert.deepEqual(paths(r, 'PYTHON_CLASSIFICATION_MISMATCH'), ['tools/probe.py']);
    assert.ok(r.pending.some((p) => p.kind === 'python' && p.id === 'tools/probe.py'));
  });

  test('a review of exactly these bytes settles it as independent, in development and in a public release', () => {
    const entry = { ownerReview: reviewOf(FALSE_POSITIVE) };
    const r = dev(repoWith(setup(FALSE_POSITIVE, entry)));
    assert.deepEqual(codes(r), []);
    assert.ok(!r.pending.some((p) => p.kind === 'python'));
    const s = strict(repoWith((x) => { setup(FALSE_POSITIVE, entry)(x); cleared(x); }));
    assert.deepEqual(codes(s), []);
  });

  test('editing the file after the review re-opens it: the review is of different bytes', () => {
    const edited = `${FALSE_POSITIVE}print(gpu.vendor)\n`;
    const r = dev(repoWith(setup(edited, { ownerReview: reviewOf(FALSE_POSITIVE) })));
    assert.deepEqual(paths(r, 'PYTHON_OWNER_REVIEW_STALE'), ['tools/probe.py']);
    assert.ok(r.pending.some((p) => p.kind === 'python' && p.id === 'tools/probe.py'));
    assert.deepEqual(paths(strict(repoWith((x) => { setup(edited, { ownerReview: reviewOf(FALSE_POSITIVE) })(x); cleared(x); })), 'PYTHON_REVIEW_REQUIRED'), ['tools/probe.py']);
  });

  test('a review never overrides the analysis: a file that reaches the Blender API stays coupled whatever the owner says', () => {
    const coupled = 'import bpy\n';
    const r = dev(repoWith(setup(coupled, { ownerReview: reviewOf(coupled) })));
    assert.ok(codes(r).includes('PYTHON_CLASSIFICATION_MISMATCH'), JSON.stringify(codes(r)));
    assert.deepEqual(paths(r, 'PYTHON_OWNER_REVIEW_UNNEEDED'), ['tools/probe.py']);
  });

  test('a review of a file the analysis decides by itself is clutter that could go stale unseen, so it is refused', () => {
    const plain = 'import json\n';
    const r = dev(repoWith(setup(plain, { ownerReview: reviewOf(plain) })));
    assert.deepEqual(paths(r, 'PYTHON_OWNER_REVIEW_UNNEEDED'), ['tools/probe.py']);
  });

  test('an unreadable file cannot be settled: there are no bytes to have reviewed', () => {
    const base = baseFiles();
    const manifest = baseManifest();
    manifest.sourceCode.python.push({ path: 'tools/probe.py', classification: 'BLENDER_INDEPENDENT', license: 'MIT', reason: 'a hardware probe', ownerReview: reviewOf('') });
    base['tools/probe.py'] = FALSE_POSITIVE;
    base['config/release-rights.json'] = JSON.stringify(manifest);
    const repo = { files: () => Object.keys(base).sort(), read: (p: string) => (p === 'tools/probe.py' ? null : (base[p] ?? null)) };
    const r = dev(repo);
    assert.deepEqual(paths(r, 'PYTHON_UNREADABLE'), ['tools/probe.py']);
    assert.equal(r.result, 'FAIL');
    // The review of an empty file's bytes must not settle a file that could not be read: it stays undecided and pending.
    assert.deepEqual(paths(r, 'PYTHON_CLASSIFICATION_MISMATCH'), ['tools/probe.py']);
    assert.ok(r.pending.some((p) => p.kind === 'python' && p.id === 'tools/probe.py'));
  });
});

describe('the character the Blender lane builds is a recorded generated model', () => {
  test('a repository with a Blender toolchain must record a generated-model component on the release path', () => {
    const r = dev(repoWith(dropCharacter));
    assert.deepEqual(paths(r, 'CHARACTER_UNRECORDED'), ['config/blender.json']);
    assert.match(r.findings.find((f) => f.code === 'CHARACTER_UNRECORDED')!.message, /generated-model/);
  });

  test('a generated-model component recorded as research-only does not count', () => {
    const r = dev(repoWith((x) => {
      Object.assign(component_(x.manifest, 'character-model'), { scope: 'RESEARCH_ONLY', kind: 'research-tool', layer: 'TOOL_RUNTIME' });
      delete component_(x.manifest, 'character-model').producedBy;
    }));
    assert.ok(codes(r).includes('CHARACTER_UNRECORDED'), JSON.stringify(codes(r)));
  });

  test('the asset that binds the character is a 3D asset, and the asset that binds a font package is a font: the video cannot file it elsewhere and declare the category absent', () => {
    const refiled = dev(repoWith((x) => {
      const asset = x.manifest.videos[0].assets.find((a: Json) => a.id === 'character');
      asset.category = 'illustration';
      x.manifest.videos[0].absent = x.manifest.videos[0].absent.filter((c: string) => c !== 'illustration');
      x.manifest.videos[0].absent.push('three-d-asset');
    }));
    assert.deepEqual(paths(refiled, 'COMPONENT_CATEGORY_MISMATCH'), ['demo/character']);
    assert.match(refiled.findings.find((f) => f.code === 'COMPONENT_CATEGORY_MISMATCH')!.message, /three-d-asset/);
  });

  test('without a Blender toolchain there is no character to record', () => {
    const r = dev(repoWith((x) => { dropCharacter(x); delete x.files['config/blender.json']; }));
    assert.deepEqual(codes(r), []);
  });
});

describe('fonts and sonic assets are found wherever they are declared', () => {
  const withFont = (x: { files: Record<string, string>; manifest: Json }, rule: boolean, kind = 'font-package'): void => {
    x.files['package.json'] = JSON.stringify({ name: 'demo', license: 'MIT', dependencies: { remotion: '4.0.532', '@fontsource/roboto': '5.0.0' } });
    x.files['package-lock.json'] = JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/remotion': { version: '4.0.532', license: 'SEE LICENSE IN LICENSE.md' }, 'node_modules/@fontsource/roboto': { version: '5.0.0', license: 'Apache-2.0' } } });
    if (!rule) return;
    x.manifest.components.push({ id: 'font-roboto', layer: 'TOOL_RUNTIME', kind, scope: 'RELEASE_PATH', rightsBasis: 'OPEN_SOURCE_LICENSE', status: 'CLEARED', licenseExpression: 'Apache-2.0', distribution: 'NOT_DISTRIBUTED', summary: 'Roboto.', evidence: [{ type: 'PACKAGE', ref: 'roboto@5.0.0' }] });
    x.files['THIRD_PARTY_NOTICES.md'] += '### `font-roboto`\n';
    x.manifest.dependencies.npm.rules.push({ id: 'roboto', match: { package: '@fontsource/roboto' }, version: null, lockLicense: 'Apache-2.0', resolvedLicense: null, component: 'font-roboto', evidence: [{ type: 'PACKAGE', ref: 'roboto@5.0.0' }] });
  };

  test('a new font package needs a font component, even when its license is permissive', () => {
    assert.deepEqual(paths(dev(repoWith((x) => withFont(x, false))), 'FONT_PACKAGE_UNRECORDED'), ['@fontsource/roboto@5.0.0']);
    assert.deepEqual(paths(dev(repoWith((x) => withFont(x, true, 'data-package'))), 'FONT_PACKAGE_UNRECORDED'), ['@fontsource/roboto@5.0.0']);
    // Recorded as a font, it must also be bound by an asset of every video that renders with it.
    assert.deepEqual(paths(dev(repoWith((x) => withFont(x, true))), 'COMPONENT_UNBOUND'), ['demo/font-roboto']);
  });

  test('the asset that binds a font package is recorded as a font, not filed under another category', () => {
    const bind = (category: string) => (x: { files: Record<string, string>; manifest: Json }): void => {
      withFont(x, true);
      x.manifest.videos[0].assets.push({ id: 'roboto', category, binding: { type: 'COMPONENT', componentId: 'font-roboto' }, rightsBasis: 'OPEN_SOURCE_LICENSE', status: 'CLEARED', licenseExpression: 'Apache-2.0', evidence: [{ type: 'PACKAGE', ref: 'roboto@5.0.0' }] });
      x.manifest.videos[0].absent = x.manifest.videos[0].absent.filter((c: string) => c !== category);
    };
    const wrong = dev(repoWith(bind('illustration')));
    assert.deepEqual(paths(wrong, 'COMPONENT_CATEGORY_MISMATCH'), ['demo/roboto']);
    assert.match(wrong.findings.find((f) => f.code === 'COMPONENT_CATEGORY_MISMATCH')!.message, /must be recorded as font/);
    assert.deepEqual(paths(dev(repoWith(bind('font'))), 'COMPONENT_CATEGORY_MISMATCH'), []);
  });

  test('a sonic asset in any section of the sonic identity needs a rights entry', () => {
    const sonic = (doc: Json) => (x: { files: Record<string, string> }): void => void (x.files['config/sonic-identity.json'] = JSON.stringify(doc));
    assert.deepEqual(paths(dev(repoWith(sonic({ ident: { asset: null }, stingers: { win: { asset: 'win-v1' } } }))), 'SONIC_ASSET_UNCOVERED'), ['demo/win-v1']);
    assert.deepEqual(paths(dev(repoWith(sonic({ ident: { asset: null }, nested: { deeper: [{ asset: 'deep-v1' }] } }))), 'SONIC_ASSET_UNCOVERED'), ['demo/deep-v1']);
    assert.deepEqual(codes(dev(repoWith(sonic({ ident: { asset: null }, musicBeds: {}, events: {} })))), []);
  });
});

describe('notices and what the manifest may say', () => {
  test('a component with no entry in THIRD_PARTY_NOTICES.md, or a compiled crate without its notice, fails', () => {
    const noComponent = dev(repoWith((x) => (x.files['THIRD_PARTY_NOTICES.md'] = '### `blender-runtime`\n### `character-model`\n### `blender-render-output`\n`libm@0.2.16`\n')));
    assert.deepEqual(paths(noComponent, 'NOTICE_MISSING'), ['remotion']);
    const noCrate = dev(repoWith((x) => (x.files['THIRD_PARTY_NOTICES.md'] = '### `blender-runtime`\n### `remotion`\n### `character-model`\n### `blender-render-output`\n')));
    assert.deepEqual(paths(noCrate, 'NOTICE_MISSING'), ['libm@0.2.16']);
  });

  test('a file the manifest cites as evidence must exist, wherever it is cited', () => {
    const asset = dev(repoWith((x) => delete x.files['assets/brand/mark.png']));
    assert.deepEqual(paths(asset, 'EVIDENCE_FILE_MISSING'), ['assets/brand/mark.png']);
    const docs = dev(repoWith((x) => delete x.files['fixtures/canonical/MANIFEST.json']));
    assert.deepEqual(paths(docs, 'EVIDENCE_FILE_MISSING'), ['fixtures/canonical/MANIFEST.json']);
    const component = dev(repoWith((x) => component_(x.manifest, 'blender-runtime').evidence.push({ type: 'FILE', ref: 'config/never-existed.json' })));
    assert.deepEqual(paths(component, 'EVIDENCE_FILE_MISSING'), ['config/never-existed.json']);
    assert.match(component.findings[0]!.message, /blender-runtime/);
  });

  test('a document the manifest names must exist', () => {
    const r = dev(repoWith((x) => delete x.files['docs/RELEASE_RIGHTS.md']));
    assert.deepEqual(paths(r, 'DOCUMENT_MISSING'), ['docs/RELEASE_RIGHTS.md']);
  });

  test('a manifest that leaks a local path, a key, or an address is refused', () => {
    const stripeShaped = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'); // built from fragments: no secret-shaped literal in the file
    const r = dev(repoWith((x) => (component(x.manifest, 'remotion').summary = `Checked from C:\\Users\\someone\\work with ${stripeShaped} and someone@example.com`)));
    assert.ok(r.findings.filter((f) => f.code === 'MANIFEST_INVALID').length >= 3);
  });
});

describe('the result depends on the committed files and nothing else', () => {
  test('12. no environment variable, credential, or clock changes the report', () => {
    const before = JSON.stringify(strict());
    const keys = ['ELEVENLABS_API_KEY', 'WALLETWALL_BLENDER', 'CI', 'GITHUB_ACTIONS', 'GITHUB_TOKEN', 'NODE_ENV', 'WALLETWALL_SOURCE_ROOT', 'TZ', 'LANG'];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) process.env[k] = k === 'ELEVENLABS_API_KEY' ? ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz0123'].join('_') : 'x';
      assert.equal(JSON.stringify(strict()), before);
      assert.equal(JSON.stringify(dev()), JSON.stringify(dev()));
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  test('12b. the checker cannot read the environment, the network, a clock, or a child process: its sources never name them', () => {
    const forbidden = [/process\.env/, /\bfetch\s*\(/, /node:(?:http|https|http2|net|dns|tls|dgram|child_process|worker_threads|cluster)/, /\bchild_process\b/, /Date\.now\s*\(/, /new Date\s*\(\s*\)/, /Math\.random/, /performance\.now/, /\bXMLHttpRequest\b/, /\bWebSocket\b/];
    const files = ['spdx', 'python-boundary', 'manifest', 'lockfiles', 'findings', 'vocabulary', 'check', 'repo'].map((n) => `src/rights/${n}.ts`).concat('scripts/rights-check.ts');
    for (const rel of files) {
      const text = readFileSync(path.join(VIDEO_ROOT, ...rel.split('/')), 'utf8');
      for (const re of forbidden) assert.ok(!re.test(text), `${rel}: ${re}`);
    }
    // Positive control: the patterns do catch what they name.
    assert.ok(forbidden.every((re) => re.test(['process.env.X', 'fetch(1)', "from 'node:https'", 'child_process', 'Date.now()', 'new Date()', 'Math.random()', 'performance.now', 'XMLHttpRequest', 'WebSocket'].join('\n'))));
  });

  test('13. the report is deterministic: the same files give byte-identical output, in either mode, in any insertion order', () => {
    const a = JSON.stringify(strict());
    assert.equal(JSON.stringify(strict()), a);
    const reversed = baseFiles();
    const files = Object.fromEntries(Object.entries(reversed).reverse());
    const b = checkRights({ files: () => Object.keys(files).reverse(), read: (p) => files[p] ?? null }, { mode: 'public-release' });
    assert.equal(JSON.stringify(b), a);
    assert.deepEqual(renderReport(strict()), renderReport(strict()));
  });

  test('the rendered report says the mode, the result, and every finding and pending item', () => {
    const lines = renderReport(strict()).join('\n');
    assert.match(lines, /public-release/);
    assert.match(lines, /FAIL/);
    assert.match(lines, /RIGHTS_BLOCKING_STATUS/);
    const devLines = renderReport(dev()).join('\n');
    assert.match(devLines, /PASS/);
    assert.match(devLines, /pending/i);
    assert.match(devLines, /remotion/);
  });

  test('findings come out sorted by code, path, and message', () => {
    const r = dev(repoWith((x) => { delete x.files['LICENSES/GPL-3.0-or-later.txt']; delete x.files['docs/LICENSING.md']; x.files['package.json'] = JSON.stringify({ name: 'demo', license: 'ISC', dependencies: { remotion: '4.0.532' } }); }));
    const keys = r.findings.map((f) => `${f.code}|${f.path}`);
    assert.deepEqual(keys, [...keys].sort());
  });
});

describe('this repository', () => {
  const repo = fsRepo(VIDEO_ROOT);

  test('passes the development check: the Blender boundary, the lockfiles, and the media agree with the committed manifest', () => {
    const r = dev(repo);
    assert.deepEqual(r.findings, []);
    assert.equal(r.result, 'PASS');
    assert.match(r.manifestSha256 ?? '', /^[0-9a-f]{64}$/);
    assert.deepEqual(r.counts, { components: r.counts.components, assets: r.counts.assets, videos: 1, npmPackages: r.counts.npmPackages, cargoCrates: 12, pythonFiles: 11 });
    assert.ok(r.counts.npmPackages > 250, 'the whole lockfile is accounted for, not a sample');
  });

  test('the strict check fails only on open rights items, never on a structural problem, and each open item is one finding', () => {
    const d = dev(repo);
    const s = strict(repo);
    assert.ok(s.findings.every((f) => f.code === 'RIGHTS_BLOCKING_STATUS' || f.code === 'PYTHON_REVIEW_REQUIRED'), JSON.stringify(s.findings.map((f) => f.code)));
    assert.equal(s.findings.length, d.pending.length);
    assert.equal(s.result, d.pending.length === 0 ? 'PASS' : 'FAIL');
  });

  test('nothing the repository cannot establish is marked CLEARED: every vendor, provider, or attribution-only item either is open or carries the owner record', () => {
    const manifest = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'config', 'release-rights.json'), 'utf8')) as Json;
    const items: Json[] = [...manifest.components, ...manifest.videos.flatMap((v: Json) => v.assets)];
    for (const i of items) {
      if (['VENDOR_LICENSE', 'PROVIDER_TERMS', 'THIRD_PARTY_ATTRIBUTION_ONLY', 'UNDETERMINED'].includes(i.rightsBasis) && i.status === 'CLEARED') {
        assert.equal(i.clearance?.clearedBy, 'OWNER', `${i.id} is CLEARED without the owner's record`);
      }
    }
    // The ones this lane found open, by id: if the owner clears one, this list shrinks with the clearance record present.
    const open = new Set(items.filter((i) => i.status !== 'CLEARED').map((i) => i.id));
    for (const id of ['remotion', 'elevenlabs-service', 'quilez-sdf-forms']) {
      const item = items.find((i) => i.id === id)!;
      assert.ok(open.has(id) || item.clearance?.clearedBy === 'OWNER', `${id} was left open for the owner`);
    }
  });

  test('the top-level MIT license is intact and is the default', () => {
    const license = readFileSync(path.join(VIDEO_ROOT, 'LICENSE'), 'utf8');
    assert.match(license, /^MIT License\n/);
    assert.equal(license, readFileSync(path.join(VIDEO_ROOT, 'LICENSES', 'MIT.txt'), 'utf8'));
    assert.equal(JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'package.json'), 'utf8')).license, 'MIT');
  });

  test('exactly the eight Blender-API files are GPL-3.0-or-later; every other file of the repository is not', () => {
    const gpl = repo.files().filter((p) => /\.pyw?$/.test(p) && /^# SPDX-License-Identifier: GPL-3\.0-or-later$/m.test(repo.read(p) ?? ''));
    assert.deepEqual(gpl.map((p) => path.posix.basename(p)).sort(), ['build.py', 'controls.py', 'materials.py', 'render.py', 'rig.py', 'scene.py', 'terrain.py', 'transition.py']);
    // No TypeScript, Rust, JSON, or Markdown file claims the GPL: the repository stays MIT around the eight.
    const claimed = repo.files().filter((p) => !/\.pyw?$/.test(p) && !p.startsWith('LICENSES/') && /SPDX-License-Identifier:\s*GPL/.test(repo.read(p) ?? ''));
    assert.deepEqual(claimed.filter((p) => !p.startsWith('test/') && !p.startsWith('src/rights/') && !p.startsWith('docs/') && p !== 'THIRD_PARTY_NOTICES.md' && p !== 'config/release-rights.json'), []);
  });
});
