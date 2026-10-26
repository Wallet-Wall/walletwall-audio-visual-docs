// Third-party code in this repository's sources: it is recorded for as long as any of it remains, and only the owner
// clears it. A credit or a known statement in a source file needs a third-party-derived-source component that cites the
// file (THIRD_PARTY_CODE_UNRECORDED), so the component cannot be removed or retired while the code is still there; a
// license is never borrowed from the repository or from the file the code sits in; and the generated items computed with
// the code keep their own records, which change only when their own bytes do.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkRights, type RightsReport } from '../src/rights/check.ts';
import { THIRD_PARTY_CODE_SIGNS } from '../src/rights/vocabulary.ts';
import { BODY_SOURCE, component, OWNER_CLEARANCE, ownerAttestation, repoWith, RIG_PY, type Json } from './rights-fixtures.ts';
import { sha256Hex } from '../src/core/hash.ts';

type Repo = { files: Record<string, string>; manifest: Json };
const dev = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'development' });
const strict = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'public-release' });
const codes = (r: RightsReport): string[] => r.findings.map((f) => f.code);
const paths = (r: RightsReport, code: string): string[] => r.findings.filter((f) => f.code === code).map((f) => f.path);
const problems = (r: RightsReport, re: RegExp): boolean => r.findings.some((f) => f.code === 'MANIFEST_INVALID' && re.test(f.message));

// The author's name the policy knows, assembled here so this file never reads as a credit.
const AUTHOR = ['Inigo', 'Qui' + 'lez'].join(' ');
const CREDITED_TS = `// Signed-distance primitives: ${AUTHOR}'s forms, re-expressed.\nexport const sd = (x: number): number => x;\n`;
const CREDITED_PY = `# Signed-distance primitives (${AUTHOR}'s forms, vectorised)\nimport math\n`;
// A statement of the retired translation, as it stood (the policy knows it by fingerprint).
const RETIRED_LINE = ['    return np.minimum(a, b) - h', 'h', 'k', '0.25'].join(' * ');
const INDEPENDENT_TS = 'export const sd = (x: number): number => Math.hypot(x, 1) - 1;\n';

const SDF = 'src/character/sdf.ts';
const thirdPartyCode = (cites: string, over: Json = {}): Json => ({
  id: 'sdf-forms',
  layer: 'SOURCE_CODE',
  kind: 'third-party-derived-source',
  scope: 'RELEASE_PATH',
  distribution: 'IN_REPOSITORY',
  rightsBasis: 'THIRD_PARTY_ATTRIBUTION_ONLY',
  status: 'OWNER_CONFIRMATION_PENDING',
  licenseExpression: null,
  summary: 'Signed-distance primitives credited to a third party, re-expressed in this repository.',
  evidence: [{ type: 'FILE', ref: cites }],
  resolution: { ownerAction: 'Establish the code\'s license, or replace it.', reassessmentTrigger: 'The code changes.' },
  ...over,
});
const withCredited = (x: Repo, path = SDF, text = CREDITED_TS, over: Json = {}): void => {
  x.files[path] = text;
  x.manifest.components.push(thirdPartyCode(path, over));
  x.files['THIRD_PARTY_NOTICES.md'] += '### `sdf-forms`\n';
};
const retire = (x: Repo): void => {
  x.manifest.components = x.manifest.components.filter((c: Json) => c.id !== 'sdf-forms');
};
const cleared = (over: Json = {}): Json => ({ status: 'CLEARED', resolution: undefined, ...over });
const clean = (c: Json): Json => JSON.parse(JSON.stringify(c));

describe('third-party code is recorded until it is gone, and only the owner clears it', () => {
  test('the policy knows the retired code by a credit and by fingerprints of its statements', () => {
    const sign = THIRD_PARTY_CODE_SIGNS.find((s) => s.source === AUTHOR);
    assert.ok(sign, 'the author whose code this repository carried is in the policy');
    assert.ok(sign.credits.some((re) => re.test(CREDITED_TS)) && sign.credits.some((re) => re.test('see https://iquilezles.org/articles/')));
    assert.ok(sign.fingerprints.includes(sha256Hex(RETIRED_LINE.replace(/\s+/g, ''))));
    for (const f of sign.fingerprints) assert.match(f, /^[0-9a-f]{64}$/);
  });

  test('1. attribution without a license does not clear third-party source', () => {
    // The credited code is recorded honestly: development passes, and it blocks a public release.
    assert.deepEqual(codes(dev(repoWith((x) => withCredited(x)))), []);
    assert.deepEqual(paths(strict(repoWith((x) => withCredited(x))), 'RIGHTS_BLOCKING_STATUS'), ['remotion', 'sdf-forms']);
    // CLEARED on the attribution (the credit, the article's URL), with no owner record: refused.
    const byCredit = dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, clean(cleared({ evidence: [{ type: 'FILE', ref: SDF }, { type: 'URL', ref: 'https://iquilezles.org/articles/distfunctions/', retrievedOn: '2026-10-26' }] })))));
    assert.ok(problems(byCredit, /third-party code carried in this repository's source files is CLEARED only on the owner's clearance record/));
    // Positive control: the owner's clearance record is what clears it.
    assert.deepEqual(codes(dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, clean(cleared({ clearance: OWNER_CLEARANCE })))))), []);
  });

  test('2. the repository\'s MIT license does not absorb a third party\'s rights', () => {
    const asMit = (over: Json) => clean(cleared({ rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'MIT', ...over }));
    // MIT because the repository is MIT, citing only the repository's own LICENSE: such a record does not even cite the
    // code, which therefore stays unrecorded.
    const borrowed = dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, asMit({ evidence: [{ type: 'FILE', ref: 'LICENSE' }] }))));
    assert.deepEqual(paths(borrowed, 'THIRD_PARTY_CODE_UNRECORDED'), [SDF]);
    // Citing the code and the repository's LICENSE: refused twice over.
    const borrowedCiting = dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, asMit({ evidence: [{ type: 'FILE', ref: SDF }, { type: 'FILE', ref: 'LICENSE' }] }))));
    assert.ok(problems(borrowedCiting, /third-party code carried in this repository's source files is CLEARED only on the owner's clearance record/));
    assert.ok(problems(borrowedCiting, /the third party's own statement/));
    // Even with the owner's record, the license must be the third party's, cited where it is published.
    const noStatement = dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, asMit({ evidence: [{ type: 'FILE', ref: SDF }], clearance: OWNER_CLEARANCE }))));
    assert.ok(problems(noStatement, /the third party's own statement/));
    // Positive control: the owner's record on the third party's published statement.
    const stated = asMit({ evidence: [{ type: 'FILE', ref: SDF }, { type: 'URL', ref: 'https://example.org/license', retrievedOn: '2026-10-26' }], clearance: OWNER_CLEARANCE });
    assert.deepEqual(codes(dev(repoWith((x) => withCredited(x, SDF, CREDITED_TS, stated)))), []);
  });

  test('2b. packages compiled into a committed artifact keep their package licenses; code in a source file does not', () => {
    // Crates compiled into the committed .wasm are recorded against the lockfile and the artifact, and each crate's license
    // is read from its registry record by the lockfile check: that item is CLEARED on those licenses, without an owner record.
    const compiled = (cites: string[]): Json => thirdPartyCode('motion-intelligence/Cargo.lock', clean({ ...cleared({ rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'MIT' }), id: 'crates-in-wasm', evidence: cites.map((ref) => ({ type: 'FILE', ref })) }));
    const withCompiled = (cites: string[]) => repoWith((x) => {
      x.files['motion-intelligence/wasm/artifact.json'] = '{}';
      x.files['motion-intelligence/src/lib.rs'] = 'pub fn f() {}\n';
      x.manifest.components.push(compiled(cites));
      x.files['THIRD_PARTY_NOTICES.md'] += '### `crates-in-wasm`\n';
    });
    assert.deepEqual(codes(dev(withCompiled(['motion-intelligence/Cargo.lock', 'motion-intelligence/wasm/artifact.json']))), []);
    // The same record citing a source file is third-party code carried in this repository's sources: the owner's rule.
    const inSource = dev(withCompiled(['motion-intelligence/Cargo.lock', 'motion-intelligence/src/lib.rs']));
    assert.ok(problems(inSource, /third-party code carried in this repository's source files is CLEARED only on the owner's clearance record/));
    assert.ok(problems(inSource, /the third party's own statement/));
  });

  test('3. moving the code into a GPL Blender file does not clear it', () => {
    const intoGpl = (x: Repo): void => void (x.files['blender/lane/rig.py'] = RIG_PY + CREDITED_PY);
    // Unrecorded in the GPL file: refused, the same as anywhere else.
    assert.deepEqual(paths(dev(repoWith(intoGpl)), 'THIRD_PARTY_CODE_UNRECORDED'), ['blender/lane/rig.py']);
    // Recorded, it still blocks a public release: the file's license is not the code's.
    const recorded = repoWith((x) => { intoGpl(x); x.manifest.components.push(thirdPartyCode('blender/lane/rig.py')); x.files['THIRD_PARTY_NOTICES.md'] += '### `sdf-forms`\n'; });
    assert.deepEqual(codes(dev(recorded)), []);
    assert.ok(paths(strict(recorded), 'RIGHTS_BLOCKING_STATUS').includes('sdf-forms'));
    // Claiming the file's GPL for the code, without the owner and the third party's statement: refused.
    const asGpl = dev(repoWith((x) => { intoGpl(x); x.manifest.components.push(thirdPartyCode('blender/lane/rig.py', clean(cleared({ rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'GPL-3.0-or-later' })))); x.files['THIRD_PARTY_NOTICES.md'] += '### `sdf-forms`\n'; }));
    assert.ok(problems(asGpl, /third-party code carried in this repository's source files is CLEARED only on the owner's clearance record/));
    assert.ok(problems(asGpl, /the third party's own statement/));
  });

  test('4. renaming a file does not take it out of its record', () => {
    // The credited file moved: its component's evidence is gone, and the file at its new path is unrecorded.
    const moved = dev(repoWith((x) => { withCredited(x); x.files['src/character/shapes.ts'] = x.files[SDF]!; delete x.files[SDF]; }));
    assert.deepEqual(paths(moved, 'EVIDENCE_FILE_MISSING'), [SDF]);
    assert.deepEqual(paths(moved, 'THIRD_PARTY_CODE_UNRECORDED'), ['src/character/shapes.ts']);
    // A source an owner record binds moved: the record no longer has its bytes.
    const boundMoved = dev(repoWith((x) => { x.files['src/character/body2.ts'] = BODY_SOURCE; delete x.files['src/character/body.ts']; }));
    assert.deepEqual(paths(boundMoved, 'PROVENANCE_FILE_MISSING').sort(), ['character-model', 'demo/character']);
  });

  test('5. the record cannot be removed while the credited code remains, even with the credit stripped', () => {
    assert.deepEqual(paths(dev(repoWith((x) => { withCredited(x); retire(x); })), 'THIRD_PARTY_CODE_UNRECORDED'), [SDF]);
    // The credit stripped, a statement of the retired code left behind: still the third party's code.
    const stripped = `export const smin = (a, b, k) => {\n${RETIRED_LINE}\n};\n`;
    assert.deepEqual(paths(dev(repoWith((x) => { withCredited(x, SDF, stripped); retire(x); })), 'THIRD_PARTY_CODE_UNRECORDED'), [SDF]);
    // A Python copy, the same, and a trailing comment does not hide a statement.
    assert.deepEqual(paths(dev(repoWith((x) => { x.files['blender/lane/common.py'] += `${RETIRED_LINE}\n`; })), 'THIRD_PARTY_CODE_UNRECORDED'), ['blender/lane/common.py']);
    assert.deepEqual(paths(dev(repoWith((x) => { x.files['blender/lane/common.py'] += `${RETIRED_LINE}  # the blend\n`; })), 'THIRD_PARTY_CODE_UNRECORDED'), ['blender/lane/common.py']);
    assert.deepEqual(paths(dev(repoWith((x) => { withCredited(x, SDF, `const s = (a, b, k) => {\n${RETIRED_LINE} // the blend\n};\n`); retire(x); })), 'THIRD_PARTY_CODE_UNRECORDED'), [SDF]);
  });

  test('5b. only a third-party-derived-source item records the code, and a credit is a credit in any case', () => {
    // A tool's or a generated item's evidence that happens to cite the file records nothing about the code in it.
    const citedElsewhere = dev(repoWith((x) => {
      x.files[SDF] = CREDITED_TS;
      component(x.manifest, 'blender-runtime').evidence.push({ type: 'FILE', ref: SDF });
      component(x.manifest, 'character-model').evidence.push({ type: 'FILE', ref: SDF });
    }));
    assert.deepEqual(paths(citedElsewhere, 'THIRD_PARTY_CODE_UNRECORDED'), [SDF]);
    // The author's name or site in another case is the same credit.
    for (const text of [CREDITED_TS.toLowerCase(), `// see ${'IQUI' + 'LEZLES'}.ORG/ARTICLES\nexport const sd = 1;\n`]) {
      assert.deepEqual(paths(dev(repoWith((x) => void (x.files[SDF] = text))), 'THIRD_PARTY_CODE_UNRECORDED'), [SDF], text);
    }
  });

  test('6. a changed source reopens what was cleared on it', () => {
    for (const mode of ['development', 'public-release'] as const) {
      const r = checkRights(repoWith((x) => void (x.files['src/character/body.ts'] += '// edited\n')), { mode });
      assert.deepEqual(paths(r, 'PROVENANCE_STALE').sort(), ['character-model', 'demo/character']);
    }
  });

  test('7. an independent replacement retires the component only when none of the code remains', () => {
    // Replaced with code written here and the component retired: nothing is owed and nothing is hidden.
    const replaced = repoWith((x) => { withCredited(x); x.files[SDF] = INDEPENDENT_TS; retire(x); });
    assert.deepEqual(codes(dev(replaced)), []);
    assert.deepEqual(paths(strict(replaced), 'RIGHTS_BLOCKING_STATUS'), ['remotion']);
    // The same, with one statement of the old code left in a test helper: refused (fingerprints are not exempted).
    const leftover = repoWith((x) => { withCredited(x); x.files[SDF] = INDEPENDENT_TS; retire(x); x.files['test/helpers.ts'] = `export const old = () => {\n${RETIRED_LINE}\n};\n`; });
    assert.deepEqual(paths(dev(leftover), 'THIRD_PARTY_CODE_UNRECORDED'), ['test/helpers.ts']);
  });

  test('8. the generated items keep their records when the third-party code they are computed with changes', () => {
    // The model and the character name third-party code cited in a file they bind. Only the component's own record
    // changes here (its status and summary, then its retirement once they stop naming it); their bound bytes do not,
    // so they stay CLEARED with nothing reported against them.
    const named = (x: Repo): void => {
      x.manifest.components.push(thirdPartyCode('src/character/body.ts'));
      x.files['THIRD_PARTY_NOTICES.md'] += '### `sdf-forms`\n';
      component(x.manifest, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms'];
      x.manifest.videos[0].assets.find((a: Json) => a.id === 'character').provenance.thirdPartyCodeInSources = ['sdf-forms'];
    };
    const untouched = (r: RightsReport): void => {
      assert.ok(!r.findings.some((f) => /character-model|demo\/character/.test(f.path)), JSON.stringify(r.findings));
      assert.ok(!r.pending.some((p) => p.id === 'character-model' || p.id === 'demo/character'));
    };
    untouched(dev(repoWith(named)));
    untouched(dev(repoWith((x) => { named(x); Object.assign(component(x.manifest, 'sdf-forms'), { status: 'UNKNOWN', rightsBasis: 'UNDETERMINED', summary: 'Reassessed.' }); })));
    // Retired once the records stop naming it (and the bound source never credited it): the generated items are unaffected.
    untouched(dev(repoWith((x) => { named(x); retire(x); delete component(x.manifest, 'character-model').provenance.thirdPartyCodeInSources; delete x.manifest.videos[0].assets.find((a: Json) => a.id === 'character').provenance.thirdPartyCodeInSources; })));
  });

  test('9. new bytes need a new attestation, which the record states and the repository pins', () => {
    const edited = BODY_SOURCE + '// edited\n';
    // The record re-pointed at the new bytes under a NEW attestation clears again...
    const reattested = repoWith((x) => {
      x.files['src/character/body.ts'] = edited;
      for (const rec of [component(x.manifest, 'character-model').provenance, x.manifest.videos[0].assets.find((a: Json) => a.id === 'character').provenance]) {
        rec.files[0].sha256 = sha256Hex(edited);
        rec.attestation = ownerAttestation('The owner states, 2026-10-27, that the edited source is still WalletWall\'s own.');
        rec.attestation.attestedOn = '2026-10-27';
      }
    });
    assert.deepEqual(codes(dev(reattested)), []);
    // ...and until then the old record is stale in both modes (test 6). The checker cannot tell a new hash recorded under
    // the old attestation from a re-attestation, so test/rights-owner-assets.test.ts pins each real record's attestation
    // together with its bytes: changing either alone fails there, in review.
  });

  test('10. Remotion and its output are untouched by any of this', () => {
    const remotion = (r: RightsReport) => r.pending.filter((p) => p.id === 'remotion');
    const base = strict(repoWith());
    for (const r of [strict(repoWith((x) => withCredited(x))), strict(repoWith((x) => { withCredited(x); x.files[SDF] = INDEPENDENT_TS; retire(x); }))]) {
      assert.deepEqual(remotion(r), remotion(base));
      assert.ok(paths(r, 'RIGHTS_BLOCKING_STATUS').includes('remotion'));
    }
  });
});
