// config/release-rights.json is a closed schema: an unknown field, status, basis, layer, or state is refused, and a
// status cannot claim more than its basis allows (UNKNOWN never becomes CLEARED, and a vendor's license is not cleared
// without the owner's record). Each test changes exactly one thing in a valid manifest.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rightsManifestSha256, validateManifest } from '../src/rights/manifest.ts';
import { baseManifest, component, withChange, type Json } from './rights-fixtures.ts';

const problems = (m: Json): string[] => validateManifest(m).problems;
const has = (m: Json, re: RegExp): boolean => problems(m).some((p) => re.test(p));
const refuses = (change: (m: Json) => void, re: RegExp, label: string): void => assert.ok(has(withChange(change), re), `${label}: expected a problem matching ${re}, got ${JSON.stringify(problems(withChange(change)))}`);

describe('a valid manifest', () => {
  test('has no problems, and its identity is the same for any key order', () => {
    const m = baseManifest();
    assert.deepEqual(problems(m), []);
    const shuffled = JSON.parse(JSON.stringify(m, Object.keys(m).sort().reverse())) as Json;
    shuffled.components.reverse();
    assert.equal(rightsManifestSha256(m), rightsManifestSha256(JSON.parse(JSON.stringify(m))));
    // Component order is part of the document (a reviewer reads it in order), so reversing changes the identity; key order does not.
    const keysReversed: Json = {};
    for (const k of Object.keys(m).reverse()) keysReversed[k] = m[k];
    assert.equal(rightsManifestSha256(keysReversed), rightsManifestSha256(m));
    assert.match(rightsManifestSha256(m), /^[0-9a-f]{64}$/);
  });
});

describe('the schema is closed', () => {
  test('an unknown field is refused at every level', () => {
    refuses((m) => (m.extra = 1), /extra: unknown field/, 'top level');
    refuses((m) => (m.sourceCode.extra = 1), /sourceCode\.extra: unknown field/, 'sourceCode');
    refuses((m) => (component(m, 'remotion').note = 'x'), /components\[1\]\.note: unknown field/, 'component');
    refuses((m) => (m.videos[0].assets[0].price = 1), /assets\[0\]\.price: unknown field/, 'asset');
    refuses((m) => (m.videos[0].release.by = 'x'), /release\.by: unknown field/, 'release');
    refuses((m) => (m.dependencies.npm.extra = 1), /dependencies\.npm\.extra: unknown field/, 'npm');
    refuses((m) => (m.documents.extra = 'x'), /documents\.extra: unknown field/, 'documents');
  });

  test('a missing field is refused', () => {
    refuses((m) => delete m.verifiedOn, /verifiedOn: missing/, 'verifiedOn');
    refuses((m) => delete component(m, 'remotion').status, /status: missing/, 'status');
    refuses((m) => delete m.videos[0].absent, /absent: missing/, 'absent');
  });

  test('a __proto__ member cannot ride along (JSON.parse makes it an own key)', () => {
    const m = JSON.parse(JSON.stringify(baseManifest()).replace('{"schema"', '{"__proto__":{"x":1},"schema"')) as Json;
    assert.ok(Object.hasOwn(m, '__proto__'));
    assert.ok(has(m, /__proto__: unknown field/));
    const nested = JSON.parse(JSON.stringify(baseManifest()).replace('"id":"remotion"', '"id":"remotion","__proto__":{"status":"CLEARED"}')) as Json;
    assert.ok(has(nested, /__proto__: unknown field/));
  });

  test('the schema string and the types are exact', () => {
    refuses((m) => (m.schema = 'walletwall.release-rights/v2'), /schema: must be exactly/, 'schema');
    refuses((m) => (m.components = {}), /components: must be an array/, 'array');
    refuses((m) => (component(m, 'remotion').summary = 5), /summary: must be a string/, 'string');
    refuses((m) => (m.verifiedOn = '22 Oct 2026'), /verifiedOn: must be a YYYY-MM-DD date/, 'date');
    refuses((m) => (m.verifiedOn = '2026-13-45'), /verifiedOn: must be a YYYY-MM-DD date/, 'impossible date');
  });
});

describe('unknown values fail closed', () => {
  test('an unknown rights status is refused', () => {
    refuses((m) => (component(m, 'remotion').status = 'PROBABLY_FINE'), /status: must be one of/, 'status');
    refuses((m) => (m.videos[0].assets[0].status = 'cleared'), /status: must be one of/, 'case');
  });

  test('an unknown rights state, basis, layer, kind, scope, distribution, or classification is refused', () => {
    refuses((m) => (m.videos[0].release.state = 'LAUNCHED'), /release\.state: must be one of/, 'state');
    refuses((m) => (component(m, 'remotion').rightsBasis = 'HANDSHAKE'), /rightsBasis: must be one of/, 'basis');
    refuses((m) => (component(m, 'remotion').layer = 'VIBES'), /layer: must be one of/, 'layer');
    refuses((m) => (component(m, 'remotion').kind = 'magic'), /kind: must be one of/, 'kind');
    refuses((m) => (component(m, 'remotion').scope = 'EXEMPT'), /scope: must be one of/, 'scope');
    refuses((m) => (component(m, 'remotion').distribution = 'SHIPPED'), /distribution: must be one of/, 'distribution');
    refuses((m) => (m.sourceCode.python[0].classification = 'PROBABLY_GPL'), /classification: must be one of/, 'classification');
    refuses((m) => (m.videos[0].assets[0].category = 'vibes'), /category: must be one of/, 'category');
  });

  test('a missing rights basis is refused', () => {
    refuses((m) => delete component(m, 'blender-runtime').rightsBasis, /rightsBasis: missing/, 'component');
    refuses((m) => delete m.videos[0].assets[0].rightsBasis, /rightsBasis: missing/, 'asset');
    refuses((m) => (component(m, 'blender-runtime').rightsBasis = null), /rightsBasis: must be one of/, 'null');
  });

  test('a layer admits only its own kinds', () => {
    refuses((m) => (component(m, 'remotion').layer = 'GENERATED_MEDIA'), /kind rendering-tool is not a GENERATED_MEDIA kind/, 'tool as media');
    refuses((m) => (component(m, 'blender-render-output').layer = 'TOOL_RUNTIME'), /kind generated-render is not a TOOL_RUNTIME kind/, 'media as tool');
  });
});

describe('a status cannot claim more than its basis allows', () => {
  test('UNKNOWN and UNVERIFIED are the only statuses of an undetermined basis; it is never CLEARED', () => {
    refuses((m) => Object.assign(component(m, 'remotion'), { rightsBasis: 'UNDETERMINED', status: 'CLEARED' }), /an UNDETERMINED basis cannot be CLEARED/, 'component');
    refuses((m) => Object.assign(m.videos[0].assets[0], { rightsBasis: 'UNDETERMINED', status: 'CLEARED' }), /an UNDETERMINED basis cannot be CLEARED/, 'asset');
    refuses((m) => Object.assign(component(m, 'remotion'), { rightsBasis: 'UNDETERMINED', status: 'OWNER_CONFIRMATION_PENDING' }), /an UNDETERMINED basis is UNKNOWN or UNVERIFIED/, 'pending');
    assert.deepEqual(problems(withChange((m) => Object.assign(component(m, 'remotion'), { rightsBasis: 'UNDETERMINED', status: 'UNKNOWN' }))), []);
  });

  test('every item that is not CLEARED carries the owner action and the reassessment trigger', () => {
    refuses((m) => delete component(m, 'remotion').resolution, /resolution: required while the status is OWNER_CONFIRMATION_PENDING/, 'component');
    refuses((m) => Object.assign(m.videos[0].assets[0], { status: 'UNVERIFIED' }), /resolution: required while the status is UNVERIFIED/, 'asset');
    refuses((m) => (component(m, 'remotion').resolution.ownerAction = ''), /ownerAction: must be a string of 1 to/, 'empty action');
  });

  test("a vendor's license, a provider's terms, or a third party's attribution is cleared only by the owner's record", () => {
    refuses((m) => { component(m, 'remotion').status = 'CLEARED'; }, /clearance: required to clear a VENDOR_LICENSE/, 'vendor');
    assert.deepEqual(
      problems(withChange((m) => { Object.assign(component(m, 'remotion'), { status: 'CLEARED', clearance: { clearedBy: 'OWNER', clearedOn: '2026-11-01', basis: 'The vendor confirmed in writing that the Free License applies.' } }); delete component(m, 'remotion').resolution; })),
      [],
    );
    refuses((m) => Object.assign(component(m, 'remotion'), { status: 'CLEARED', clearance: { clearedBy: 'A-BOT', clearedOn: '2026-11-01', basis: 'x' } }), /clearedBy: must be exactly "OWNER"/, 'not the owner');
  });

  test('an owner-authored or generated item needs no clearance record, and a stray one is refused', () => {
    refuses((m) => (component(m, 'blender-render-output').clearance = { clearedBy: 'OWNER', clearedOn: '2026-11-01', basis: 'x' }), /clearance: only a VENDOR_LICENSE, PROVIDER_TERMS, or THIRD_PARTY_ATTRIBUTION_ONLY basis, or third-party code carried in this repository's source files, takes a clearance record/, 'stray');
  });

  test('the license expression must agree with the basis', () => {
    refuses((m) => (component(m, 'blender-runtime').licenseExpression = null), /licenseExpression: an OPEN_SOURCE_LICENSE basis needs an SPDX expression/, 'missing');
    refuses((m) => (component(m, 'blender-runtime').licenseExpression = 'GNU GPL'), /licenseExpression: not a valid SPDX expression/, 'unparsable');
    refuses((m) => (component(m, 'blender-render-output').licenseExpression = 'MIT'), /licenseExpression: must be null for a GENERATED_FROM_OWNER_INPUTS basis/, 'owner basis with license');
    refuses((m) => (component(m, 'remotion').licenseExpression = 'MIT'), /licenseExpression: a VENDOR_LICENSE basis is null or a LicenseRef-/, 'vendor claiming MIT');
    assert.deepEqual(problems(withChange((m) => (component(m, 'remotion').licenseExpression = 'LicenseRef-Remotion'))), []);
  });
});

describe('an open-source basis needs a license the policy recognises', () => {
  test('a made-up identifier, a LicenseRef, or an exception cannot stand in for an open-source license', () => {
    refuses((m) => Object.assign(component(m, 'remotion'), { rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'Remotion-License', status: 'CLEARED' }), /Remotion-License is not a recognised SPDX license identifier/, 'invented id');
    refuses((m) => (component(m, 'blender-runtime').licenseExpression = 'GPL-3.0-or-later AND Totally-Free-1.0'), /Totally-Free-1\.0 is not a recognised/, 'one bad id in an expression');
    refuses((m) => (component(m, 'blender-runtime').licenseExpression = 'LicenseRef-Mine'), /LicenseRef-Mine is not a recognised/, 'a LicenseRef on an open-source basis');
    refuses((m) => (component(m, 'blender-runtime').licenseExpression = 'GPL-3.0-or-later WITH Some-exception'), /a WITH exception is not recognised/, 'an exception');
    for (const ok of ['MIT', 'GPL-3.0-or-later', 'MPL-2.0', 'OFL-1.1', 'CC-BY-4.0', '(MIT OR Apache-2.0) AND Unicode-3.0']) assert.deepEqual(problems(withChange((m) => (component(m, 'blender-runtime').licenseExpression = ok))), [], ok);
  });
});

describe('a license with a restriction cannot be the whole basis of a CLEARED item', () => {
  const restricted = ['CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'MIT AND CC-BY-NC-4.0', 'GPL-3.0-or-later AND AGPL-3.0-only'];
  const pendingResolution = { ownerAction: 'Decide whether the restriction allows this use.', reassessmentTrigger: 'A change of the license.' };

  test('a non-commercial or network-copyleft license on a CLEARED component or asset is refused', () => {
    for (const id of restricted) {
      refuses((m) => (component(m, 'blender-runtime').licenseExpression = id), /cannot be CLEARED/, `component ${id}`);
      refuses((m) => Object.assign(m.videos[0].assets[0], { rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: id }), /cannot be CLEARED/, `asset ${id}`);
    }
  });

  test('the same license is recorded honestly under a status that says why it is not cleared', () => {
    for (const status of ['NONCOMMERCIAL', 'INCOMPATIBLE', 'OWNER_CONFIRMATION_PENDING']) {
      assert.deepEqual(problems(withChange((m) => Object.assign(component(m, 'blender-runtime'), { licenseExpression: 'CC-BY-NC-4.0', status, resolution: pendingResolution }))), [], status);
    }
  });

  test('an alternative the owner can take (OR) is not a restriction, and a permissive or copyleft license is untouched', () => {
    for (const ok of ['MIT OR CC-BY-NC-4.0', 'AGPL-3.0-or-later OR GPL-3.0-or-later', 'GPL-3.0-or-later', 'MPL-2.0', 'CC-BY-4.0']) assert.deepEqual(problems(withChange((m) => (component(m, 'blender-runtime').licenseExpression = ok))), [], ok);
  });
});

describe("the owner's review of a Python file the analysis could not decide", () => {
  const review = (over: Json = {}): Json => ({ reviewedBy: 'OWNER', reviewedOn: '2026-11-01', fileSha256: 'a'.repeat(64), basis: 'The name gpu is a local variable; the file never touches Blender.', ...over });
  const entry = (m: Json): Json => m.sourceCode.python.find((e: Json) => e.path === 'blender/lane/common.py');

  test('is recorded on an independent entry, with who reviewed it, when, which bytes, and why', () => {
    assert.deepEqual(problems(withChange((m) => (entry(m).ownerReview = review()))), []);
    refuses((m) => (entry(m).ownerReview = review({ reviewedBy: 'A-BOT' })), /ownerReview\.reviewedBy: must be exactly "OWNER"/, 'not the owner');
    refuses((m) => (entry(m).ownerReview = review({ reviewedOn: 'yesterday' })), /ownerReview\.reviewedOn: must be a YYYY-MM-DD date/, 'date');
    refuses((m) => (entry(m).ownerReview = review({ fileSha256: 'abc' })), /ownerReview\.fileSha256: must be 64 lowercase hex characters/, 'hash');
    refuses((m) => (entry(m).ownerReview = review({ basis: '' })), /ownerReview\.basis: must be a string of 1 to/, 'basis');
    refuses((m) => (entry(m).ownerReview = review({ note: 'x' })), /ownerReview\.note: unknown field/, 'unknown field');
    refuses((m) => delete (entry(m).ownerReview = review()).basis, /ownerReview\.basis: missing/, 'missing field');
  });

  test('settles nothing but an independent classification: a coupled or still-undecided entry takes none', () => {
    refuses((m) => (m.sourceCode.python[0].ownerReview = review()), /ownerReview: only a BLENDER_INDEPENDENT entry takes an owner review/, 'coupled');
    refuses((m) => Object.assign(entry(m), { classification: 'REVIEW_REQUIRED', license: 'GPL-3.0-or-later', ownerReview: review() }), /ownerReview: only a BLENDER_INDEPENDENT entry takes an owner review/, 'undecided');
  });
});

describe('components that depend on one another', () => {
  test('dependsOn names other components, each once, never itself', () => {
    assert.deepEqual(problems(withChange((m) => (component(m, 'blender-render-output').dependsOn = ['remotion']))), []);
    refuses((m) => (component(m, 'blender-render-output').dependsOn = ['nothing']), /dependsOn: nothing is not a component/, 'dangling');
    refuses((m) => (component(m, 'blender-render-output').dependsOn = ['blender-render-output']), /dependsOn: a component cannot depend on itself/, 'self');
    refuses((m) => (component(m, 'blender-render-output').dependsOn = ['remotion', 'remotion']), /dependsOn: duplicate remotion/, 'duplicate');
    refuses((m) => (component(m, 'blender-render-output').dependsOn = []), /dependsOn: must have 1 to \d+ items/, 'empty');
  });
});

describe('the media file inventory', () => {
  const entry = (match: Json, covers: Json, id = 'm1'): Json => ({ id, match, covers });
  test('an entry names files by one path or one exact list of paths, and covers one component or one video asset that exists', () => {
    for (const ok of [entry({ path: 'a/b.png' }, { component: 'remotion' }), entry({ paths: ['a/b.png', 'a/c.mp3'] }, { asset: 'demo/brand-mark' })]) assert.deepEqual(problems(withChange((m) => m.mediaFiles.push(ok))), [], JSON.stringify(ok));
    refuses((m) => m.mediaFiles.push(entry({}, { component: 'remotion' })), /match: must be exactly one of path or paths/, 'no match');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png', paths: ['b.png'] }, { component: 'remotion' })), /match: must be exactly one of path or paths/, 'both');
    // A directory prefix would cover every file later dropped into it, so there is no prefix form.
    refuses((m) => m.mediaFiles.push(entry({ prefix: 'a/' }, { component: 'remotion' })), /match: must be exactly one of path or paths/, 'a prefix is not a match');
    refuses((m) => m.mediaFiles.push(entry({ paths: [] }, { component: 'remotion' })), /paths: must be a list of 1 to 200 distinct plain repo-relative paths/, 'empty list');
    refuses((m) => m.mediaFiles.push(entry({ paths: ['a.png', 'a.png'] }, { component: 'remotion' })), /paths: must be a list of 1 to 200 distinct plain repo-relative paths/, 'duplicate in list');
    refuses((m) => m.mediaFiles.push(entry({ paths: ['a.png', '../b.png'] }, { component: 'remotion' })), /paths: must be a list of 1 to 200 distinct plain repo-relative paths/, 'parent path in list');
    refuses((m) => m.mediaFiles.push(entry({ paths: 'a.png' }, { component: 'remotion' })), /paths: must be a list of 1 to 200 distinct plain repo-relative paths/, 'not a list');
    refuses((m) => m.mediaFiles.push(entry({ path: '../a.png' }, { component: 'remotion' })), /path: must be a plain repo-relative path/, 'parent path');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png' }, {})), /covers: must be exactly one of component or asset/, 'covers nothing');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png' }, { component: 'nothing' })), /covers\.component: nothing is not a component/, 'dangling component');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png' }, { asset: 'demo/ghost' })), /covers\.asset: demo\/ghost is not an asset/, 'dangling asset');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png' }, { asset: 'brand-mark' })), /covers\.asset: must be videoId\/assetId/, 'asset shape');
    refuses((m) => m.mediaFiles.push(entry({ path: 'a.png' }, { component: 'remotion' }, 'm1'), entry({ path: 'b.png' }, { component: 'remotion' }, 'm1')), /duplicate id m1/, 'duplicate id');
  });
});

describe('account-shaped information stays out of the manifest', () => {
  test('a provider voice id, a password or key assignment, and a plan tier are refused', () => {
    refuses((m) => (component(m, 'remotion').summary = 'Voice DTLT09E2cxHF0DqjKVbc is used'), /summary: holds an identifier shaped like a provider voice or account id/, 'voice id');
    refuses((m) => (component(m, 'remotion').summary = 'login password: hunter2hunter2'), /summary: holds a password or credential assignment/, 'password');
    refuses((m) => (component(m, 'remotion').summary = 'the api_key = abcdef123456'), /summary: holds a password or credential assignment/, 'key assignment');
    refuses((m) => (component(m, 'remotion').summary = 'the Creator plan covers it'), /summary: holds a subscription plan tier/, 'plan tier');
    // Ordinary prose, hashes, versions, and kebab-case ids are not mistaken for any of these.
    assert.deepEqual(problems(withChange((m) => (component(m, 'remotion').summary = 'Paid plans may use the service commercially; token counts and OWNER_CONFIRMATION_PENDING are words, not secrets. sha256 ' + 'ab'.repeat(32)))), []);
  });
});

describe('structure inside the manifest', () => {
  test('ids are plain, unique, and referenced only where they exist', () => {
    refuses((m) => (component(m, 'remotion').id = 'Remo tion'), /id: must match/, 'shape');
    refuses((m) => (component(m, 'remotion').id = 'blender-runtime'), /duplicate id blender-runtime/, 'duplicate');
    refuses((m) => (component(m, 'blender-render-output').producedBy = ['nothing']), /producedBy: nothing is not a TOOL_RUNTIME component/, 'dangling');
    refuses((m) => (component(m, 'blender-render-output').producedBy = ['blender-render-output']), /producedBy: blender-render-output is not a TOOL_RUNTIME component/, 'self');
    refuses((m) => delete component(m, 'blender-render-output').producedBy, /producedBy: generated media names the tools that produced it/, 'media without tools');
    refuses((m) => (component(m, 'remotion').producedBy = ['blender-runtime']), /producedBy: only GENERATED_MEDIA/, 'tool with producers');
  });

  test('research-only is exactly the research-tool kind, so nothing on the release path can be exempted by a flag', () => {
    refuses((m) => (component(m, 'remotion').scope = 'RESEARCH_ONLY'), /scope: RESEARCH_ONLY is for the research-tool kind only/, 'exempting remotion');
    refuses((m) => Object.assign(component(m, 'remotion'), { kind: 'research-tool' }), /scope: a research-tool is RESEARCH_ONLY/, 'research tool on the path');
  });

  test('every policy category is either represented by an asset or declared absent, never both, never neither', () => {
    refuses((m) => m.videos[0].absent.push('logo-trademark'), /absent: logo-trademark is both an asset and declared absent/, 'both');
    refuses((m) => m.videos[0].absent.splice(m.videos[0].absent.indexOf('music'), 1), /category music is neither an asset nor declared absent/, 'neither');
    refuses((m) => m.videos[0].absent.push('music'), /absent: duplicate music/, 'duplicate absent');
  });

  test('a video must be PUBLIC only with the owner\'s authorization, and an authorization only on PUBLIC', () => {
    refuses((m) => (m.videos[0].release.state = 'PUBLIC'), /release\.ownerAuthorization: required in the PUBLIC state/, 'public without owner');
    refuses((m) => (m.videos[0].release.ownerAuthorization = { authorizedBy: 'OWNER', transition: 'UNLISTED->PUBLIC', receiptSha256: 'e'.repeat(64) }), /ownerAuthorization: only the PUBLIC state records one/, 'early authorization');
    refuses((m) => Object.assign(m.videos[0].release, { state: 'PUBLIC', ownerAuthorization: { authorizedBy: 'CI', transition: 'UNLISTED->PUBLIC', receiptSha256: 'e'.repeat(64) } }), /authorizedBy: must be exactly "OWNER"/, 'ci is not the owner');
    assert.deepEqual(problems(withChange((m) => Object.assign(m.videos[0].release, { state: 'PUBLIC', ownerAuthorization: { authorizedBy: 'OWNER', transition: 'UNLISTED->PUBLIC', receiptSha256: 'e'.repeat(64) } }))), [], 'a well-formed PUBLIC record is a valid manifest (the check, not the schema, judges the rights)');
  });

  test('a binding says exactly what the asset is bound to', () => {
    refuses((m) => (m.videos[0].assets[0].binding = { type: 'TELEPATHY' }), /binding\.type: must be one of/, 'type');
    refuses((m) => (m.videos[0].assets[0].binding.sha256 = 'XYZ'), /sha256: must be 64 lowercase hex/, 'sha');
    refuses((m) => (m.videos[0].assets[0].binding.extra = 1), /binding\.extra: unknown field/, 'extra');
  });
});

describe('evidence and what the manifest may say', () => {
  test('a URL needs https and the date it was read; a file is a repo-relative path; a package is name@version', () => {
    refuses((m) => (component(m, 'blender-runtime').evidence[0].ref = 'http://www.blender.org/'), /ref: a URL must be https/, 'http');
    refuses((m) => delete component(m, 'blender-runtime').evidence[0].retrievedOn, /retrievedOn: required for a URL/, 'undated');
    refuses((m) => (component(m, 'blender-runtime').evidence[0].ref = 'https://user:pass@example.com/'), /ref: a URL must not carry credentials/, 'credentials');
    refuses((m) => (m.videos[0].assets[0].evidence[0].ref = '../secret.txt'), /ref: a file must be a plain repo-relative path/, 'parent path');
    refuses((m) => (m.videos[0].assets[0].evidence[0].ref = '/etc/passwd'), /ref: a file must be a plain repo-relative path/, 'absolute path');
    refuses((m) => (component(m, 'remotion').evidence[0].ref = 'remotion'), /ref: a package is name@version/, 'package');
    refuses((m) => (component(m, 'remotion').evidence = []), /evidence: must have 1 to \d+ items/, 'no evidence');
  });

  test('the manifest holds no local path, secret, or personal address (it is a public file)', () => {
    refuses((m) => (component(m, 'remotion').summary = 'Checked at C:\\Users\\someone\\project'), /summary: holds a Windows drive path/, 'path');
    // Built from fragments so the file itself never holds a secret-shaped literal (push protection scans for them).
    const stripeShaped = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join('_');
    refuses((m) => (component(m, 'remotion').summary = `key ${stripeShaped}`), /summary: holds an API secret key/, 'key');
    refuses((m) => (component(m, 'remotion').summary = 'Billing contact someone@example.com'), /summary: holds an email address/, 'email');
    refuses((m) => (component(m, 'remotion').resolution.ownerAction = 'Log in at https://user:pw@vendor.example/'), /holds credentials inside a URL/, 'url credentials');
  });
});

describe('the sections that map the repository onto the manifest', () => {
  test('the Python map lists each file once with a licence that matches its classification', () => {
    refuses((m) => m.sourceCode.python.push({ ...m.sourceCode.python[0] }), /duplicate path blender\/lane\/rig\.py/, 'duplicate');
    refuses((m) => (m.sourceCode.python[0].license = 'MIT'), /license: a BLENDER_API_COUPLED file is GPL-3.0-or-later/, 'coupled under MIT');
    refuses((m) => (m.sourceCode.python[1].license = 'Proprietary'), /license: an independent file keeps a GPL-compatible license/, 'incompatible');
    refuses((m) => (m.sourceCode.python[0].path = '../outside.py'), /path: must be a plain repo-relative path/, 'path');
  });

  test('npm rules and cargo crates are closed records with a component or a resolved license, never both', () => {
    refuses((m) => m.dependencies.npm.rules.push({ id: 'r', match: { package: 'x' }, version: null, lockLicense: null, resolvedLicense: 'MIT', component: 'remotion', evidence: [{ type: 'PACKAGE', ref: 'x@1.0.0' }] }), /exactly one of resolvedLicense and component/, 'both');
    refuses((m) => m.dependencies.npm.rules.push({ id: 'r', match: { package: 'x' }, version: null, lockLicense: null, resolvedLicense: null, component: null, evidence: [{ type: 'PACKAGE', ref: 'x@1.0.0' }] }), /exactly one of resolvedLicense and component/, 'neither');
    refuses((m) => m.dependencies.npm.rules.push({ id: 'r', match: { package: 'x' }, version: null, lockLicense: null, resolvedLicense: 'MIT', component: null, evidence: [{ type: 'PACKAGE', ref: 'x@1.0.0' }] }), /version: required when the lockfile records no license/, 'null license needs a version');
    refuses((m) => m.dependencies.npm.rules.push({ id: 'r', match: { package: 'x' }, version: '1.0.0', lockLicense: null, resolvedLicense: null, component: 'nothing', evidence: [{ type: 'PACKAGE', ref: 'x@1.0.0' }] }), /component: nothing is not a component/, 'dangling component');
    refuses((m) => m.dependencies.cargo.crates.push({ name: 'serde', version: '1.0.0', checksum: 'zz', license: 'MIT OR Apache-2.0', linkage: 'COMPILED_INTO_COMMITTED_ARTIFACT', evidence: [{ type: 'PACKAGE', ref: 'serde@1.0.0' }] }), /checksum: must be 64 lowercase hex/, 'checksum');
  });

  test('a rule matches exactly one way: one package, one prefix, or a list of at least two distinct packages', () => {
    const rule = (match: Json): Json => ({ id: 'r2', match, version: null, lockLicense: 'SEE LICENSE IN LICENSE.md', resolvedLicense: null, component: 'remotion', evidence: [{ type: 'PACKAGE', ref: 'x@1.0.0' }] });
    for (const ok of [{ package: 'x' }, { prefix: '@scope/' }, { packages: ['a', 'b'] }]) assert.deepEqual(problems(withChange((m) => m.dependencies.npm.rules.push(rule(ok)))), [], JSON.stringify(ok));
    for (const bad of [{}, { package: 'x', prefix: 'y' }, { packages: ['a'] }, { packages: ['a', 'a'] }, { packages: [] }, { packages: 'a' }, { packages: ['a', ''] }, { suffix: 'z' }]) {
      assert.ok(has(withChange((m) => m.dependencies.npm.rules.push(rule(bad))), /match/), JSON.stringify(bad));
    }
  });
});
