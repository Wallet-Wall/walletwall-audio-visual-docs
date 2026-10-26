// Owner-authored and owner-generated items (docs/RELEASE_RIGHTS.md, "Owner-authored and generated items"). An item
// WalletWall authored (OWNER_AUTHORED) or generated from what it authored (GENERATED_FROM_OWNER_INPUTS) is CLEARED only on
// a provenance record: the owner's statement, and the exact bytes it is about, which the check hashes. Nothing rides on
// it: a third party's file, the license of the tool that rendered it, the third-party code its generator runs, and another
// item's open question each keep their own record. The numbered tests are the lane's twelve properties, each with its
// controls; the last block is this repository's own record.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { checkRights, type RightsReport } from '../src/rights/check.ts';
import { validateManifest } from '../src/rights/manifest.ts';
import { scanPython } from '../src/rights/python-boundary.ts';
import { fsRepo } from '../src/rights/repo.ts';
import { BODY_SOURCE, bound, BRAND_SHA, component, GPL_TEXT, ownerAttestation, repoWith, SCENE_SOURCE, withChange, withNarration, type Json } from './rights-fixtures.ts';

const dev = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'development' });
const strict = (repo = repoWith()): RightsReport => checkRights(repo, { mode: 'public-release' });
const codes = (r: RightsReport): string[] => r.findings.map((f) => f.code);
const paths = (r: RightsReport, code: string): string[] => r.findings.filter((f) => f.code === code).map((f) => f.path);
const refused = (change: (m: Json) => void, re: RegExp): void => {
  const found = validateManifest(withChange(change)).problems;
  assert.ok(found.some((p) => re.test(p)), `expected a problem matching ${re}, got ${JSON.stringify(found)}`);
};
type Repo = { files: Record<string, string>; manifest: Json };
const asset = (m: Json, id: string): Json => m.videos[0].assets.find((a: Json) => a.id === id);
const pend = (item: Json): void => {
  item.status = 'OWNER_CONFIRMATION_PENDING';
  item.resolution = { ownerAction: 'Establish its rights.', reassessmentTrigger: 'Its inputs change.' };
};
/** Remotion cleared with the owner's record: the one fixture item an owner record, not provenance, clears. */
const clearRemotion = (x: Repo): void => {
  Object.assign(component(x.manifest, 'remotion'), { status: 'CLEARED', clearance: { clearedBy: 'OWNER', clearedOn: '2026-11-01', basis: 'The vendor confirmed that the Free License applies to this project.' } });
  delete component(x.manifest, 'remotion').resolution;
};

/**
 * Each owner provenance record as attested: its attestation and its bound bytes, together, by content address. A new
 * sha256 is recorded with a new attestation, so this changes only in an edit that also changes the record's attestation.
 */
const PINNED_OWNER_RECORDS: Record<string, string> = {
  'brand-mark': '1e1b42b98edbf122d4a60178dbcacfbcbc328d6c3a166ada8791f8731b6bc9c3', // attested 2026-10-25
  character: '1835672d1d7abb26c2b016d5c9cd7ad83ac2e580930e5fb45e8360beca7d166f', // attested 2026-10-26
  'walletwallaby-character-model': '9e707196844b508583470e3b49062ce33e9bcb8ed2369ff7e7b294edc5b479e3', // attested 2026-10-26
  'blender-render-output': 'd1a6bbd452c9c24c30516e43f200cd7fd361e1bae8e53f19203414a82a82f702', // attested 2026-10-26
};

/** Third-party-derived code inside a source file, as quilez-sdf-forms was inside geometry.py until 2026-10-26. */
const sdfForms = (cites: string): Json => ({
  id: 'sdf-forms',
  layer: 'SOURCE_CODE',
  kind: 'third-party-derived-source',
  scope: 'RELEASE_PATH',
  distribution: 'IN_REPOSITORY',
  rightsBasis: 'THIRD_PARTY_ATTRIBUTION_ONLY',
  status: 'OWNER_CONFIRMATION_PENDING',
  licenseExpression: null,
  summary: 'Two signed-distance primitives credited to a third party, re-expressed in this repository.',
  evidence: [{ type: 'FILE', ref: cites }],
  resolution: { ownerAction: 'Decide whether the attribution is enough, or replace the primitives.', reassessmentTrigger: 'The primitives change.' },
});
const withSdfForms = (x: Repo): void => {
  x.manifest.components.push(sdfForms('src/character/body.ts'));
  x.files['THIRD_PARTY_NOTICES.md'] += '### `sdf-forms`\n';
  component(x.manifest, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms'];
  asset(x.manifest, 'character').provenance.thirdPartyCodeInSources = ['sdf-forms'];
};

/** The depth reveal: Blender frames that project Remotion's frames, beside the character frames Blender renders alone. */
const withReveal = (x: Repo): void => {
  x.files['blender/proof/idle.png'] = 'a character frame';
  x.files['blender/proof/peak.png'] = 'a reveal frame';
  x.files['THIRD_PARTY_NOTICES.md'] += '### `remotion-render-output`\n### `reveal-output`\n';
  x.manifest.components.push(
    { id: 'remotion-render-output', layer: 'GENERATED_MEDIA', kind: 'generated-render', scope: 'RELEASE_PATH', distribution: 'IN_RELEASE_OUTPUT', rightsBasis: 'VENDOR_LICENSE', status: 'OWNER_CONFIRMATION_PENDING', licenseExpression: null, summary: 'What Remotion renders.', evidence: [{ type: 'PACKAGE', ref: 'remotion@4.0.532' }], producedBy: ['remotion'], resolution: { ownerAction: 'Resolve the remotion item.', reassessmentTrigger: 'It changes.' } },
    { id: 'reveal-output', layer: 'GENERATED_MEDIA', kind: 'generated-render', scope: 'RELEASE_PATH', distribution: 'IN_REPOSITORY_AND_RELEASE_OUTPUT', rightsBasis: 'GENERATED_FROM_OWNER_INPUTS', status: 'OWNER_CONFIRMATION_PENDING', licenseExpression: null, summary: "Blender frames that project Remotion's frames.", evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }], producedBy: ['blender-runtime'], dependsOn: ['character-model', 'remotion-render-output'], resolution: { ownerAction: 'Resolve remotion-render-output first.', reassessmentTrigger: 'It changes.' } },
  );
  component(x.manifest, 'blender-render-output').provenance.files.push(bound('blender/proof/idle.png', 'a character frame', 'OUTPUT'));
  x.manifest.mediaFiles.push({ id: 'character-frames', match: { path: 'blender/proof/idle.png' }, covers: { component: 'blender-render-output' } }, { id: 'reveal-frames', match: { path: 'blender/proof/peak.png' }, covers: { component: 'reveal-output' } });
};

describe('an owner item is CLEARED on its provenance record, never on a status edit', () => {
  test('1. an owner-authored brand mark is CLEARED on the owner\'s record, bound to the bytes the spec uses', () => {
    assert.equal(asset(withChange(() => {}), 'brand-mark').status, 'CLEARED');
    assert.deepEqual(codes(dev()), []);
    refused((m) => delete asset(m, 'brand-mark').provenance, /assets\[0\]\.provenance: required to clear an item on the OWNER_AUTHORED basis/);
    refused((m) => (asset(m, 'brand-mark').provenance.attestation.attestedBy = 'MAINTAINER'), /provenance\.attestation\.attestedBy: must be exactly "OWNER"/);
    refused((m) => delete asset(m, 'brand-mark').provenance.attestation.basis, /provenance\.attestation\.basis: missing/);
    refused((m) => (asset(m, 'brand-mark').provenance.files = []), /provenance\.files: must have 1 to 64 items/);
    // The record is about the bytes the spec binds, not some other file.
    refused((m) => (asset(m, 'brand-mark').provenance.files[0].sha256 = sha256Hex('another mark')), /assets\[0\]\.binding\.sha256: the provenance binds no ASSET or OUTPUT file with these bytes/);
    // An owner decision still open needs no record yet: only CLEARED rests on one.
    assert.deepEqual(codes(dev(repoWith((x) => { pend(asset(x.manifest, 'brand-mark')); delete asset(x.manifest, 'brand-mark').provenance; }))), []);
  });

  test('2. an owner-authored character asset is CLEARED on its own record, never above the model it is bound to', () => {
    assert.deepEqual([asset(withChange(() => {}), 'character').rightsBasis, asset(withChange(() => {}), 'character').status], ['OWNER_AUTHORED', 'CLEARED']);
    assert.deepEqual(codes(dev()), []);
    refused((m) => delete asset(m, 'character').provenance, /assets\[1\]\.provenance: required to clear an item on the OWNER_AUTHORED basis/);
    const above = dev(repoWith((x) => pend(component(x.manifest, 'character-model'))));
    assert.deepEqual(paths(above, 'ASSET_ABOVE_COMPONENT'), ['demo/character']);
  });

  test('3. an owner-generated model is CLEARED only on the source it is generated from, and the source must be there', () => {
    assert.deepEqual(codes(dev()), []);
    refused((m) => delete component(m, 'character-model').provenance, /components\[2\]\.provenance: required to clear an item on the GENERATED_FROM_OWNER_INPUTS basis/);
    // An output alone says nothing about where the model came from.
    refused((m) => (component(m, 'character-model').provenance.files = [bound('renders/x.json', '{}', 'OUTPUT')]), /provenance\.files: a GENERATED_FROM_OWNER_INPUTS item names at least one SOURCE file it is generated from/);
    // The roles follow the basis: a generated item has no "asset" bytes of its own, an authored one no outputs.
    refused((m) => (component(m, 'character-model').provenance.files[0].role = 'ASSET'), /provenance\.files\[0\]\.role: must be one of SOURCE, OUTPUT/);
    refused((m) => (asset(m, 'brand-mark').provenance.files[0].role = 'OUTPUT'), /provenance\.files\[0\]\.role: must be one of ASSET, SOURCE/);
    refused((m) => component(m, 'character-model').provenance.files.push(bound('src/character/body.ts', BODY_SOURCE, 'SOURCE')), /provenance\.files: duplicate path src\/character\/body\.ts/);
    // A source that is not in the repository is no provenance.
    const gone = dev(repoWith((x) => delete x.files['src/character/body.ts']));
    assert.deepEqual(paths(gone, 'PROVENANCE_FILE_MISSING'), ['character-model', 'demo/character']);
    assert.match(gone.findings.find((f) => f.code === 'PROVENANCE_FILE_MISSING')!.message, /src\/character\/body\.ts/);
    // Readable is not enough: build output and other files outside the repository's listing are never provenance.
    const base = repoWith();
    const unlisted = dev({ files: () => base.files().filter((p) => p !== 'src/character/body.ts'), read: (p) => base.read(p) });
    assert.deepEqual(paths(unlisted, 'PROVENANCE_FILE_MISSING'), ['character-model', 'demo/character']);
  });

  test('4. an imported third-party model or texture cannot ride on the owner clearance', () => {
    const texture = 'blender/lane/fur.png';
    // Dropped in and inventoried under the cleared model: refused, the record was not made for it.
    const riding = dev(repoWith((x) => {
      x.files[texture] = 'downloaded fur';
      x.manifest.mediaFiles.push({ id: 'fur', match: { path: texture }, covers: { component: 'character-model' } });
    }));
    assert.deepEqual(paths(riding, 'PROVENANCE_MEDIA_UNBOUND'), [texture]);
    // An inventory entry for a file that is not there is stale, and nothing rides on it.
    const ghost = dev(repoWith((x) => x.manifest.mediaFiles.push({ id: 'fur', match: { path: texture }, covers: { component: 'character-model' } })));
    assert.deepEqual(codes(ghost), ['MEDIA_ENTRY_STALE']);
    // A second inventory entry cannot overrule the first: a file is inventoried once.
    refused((m) => m.mediaFiles.push({ id: 'fur', match: { path: texture }, covers: { component: 'character-model' } }, { id: 'fur-again', match: { path: texture }, covers: { asset: 'demo/docs-page' } }), /mediaFiles\[2\]\.match: blender\/lane\/fur\.png is already inventoried by fur/);
    // An item cleared without a record of its own (the docs page) carries no media either.
    const docs = dev(repoWith((x) => { x.files[texture] = 'downloaded fur'; x.manifest.mediaFiles.push({ id: 'fur', match: { path: texture }, covers: { asset: 'demo/docs-page' } }); }));
    assert.deepEqual(paths(docs, 'PROVENANCE_MEDIA_UNBOUND'), [texture]);
    // Relabelled as something the model generated: a model's outputs are model files, and a texture is not one.
    refused((m) => component(m, 'character-model').provenance.files.push(bound(texture, 'downloaded fur', 'OUTPUT')), /blender\/lane\/fur\.png is not a file a generated-model makes/);
    // Texture, material, and mesh formats beyond the common ones are inventoried, and none is a source.
    for (const name of ['blender/lane/fur.tga', 'blender/lane/fur.dds', 'blender/lane/fur.psd', 'blender/lane/fur.ktx2', 'blender/lane/body.ply', 'blender/lane/body.dae', 'blender/lane/body.abc', 'blender/lane/fur.mtl', 'blender/lane/fur.sbsar', 'blender/lane/body.npy']) {
      assert.deepEqual(paths(dev(repoWith((x) => (x.files[name] = 'bytes'))), 'MEDIA_FILE_UNRECORDED'), [name], name);
      refused((m) => component(m, 'character-model').provenance.files.push(bound(name, 'bytes', 'SOURCE')), /is a media file, which is never a SOURCE/);
    }
    // Bound into the model's record as something it is generated from: a media file is never an owner source.
    refused((m) => component(m, 'character-model').provenance.files.push(bound(texture, 'downloaded fur', 'SOURCE')), /blender\/lane\/fur\.png is a media file, which is never a SOURCE/);
    // Recorded honestly, as third-party material the model incorporates: the model cannot be CLEARED above it.
    const pack = (x: Repo, status: 'OWNER_CONFIRMATION_PENDING' | 'CLEARED'): void => {
      x.files[texture] = 'downloaded fur';
      x.files['THIRD_PARTY_NOTICES.md'] += '### `fur-pack`\n';
      x.manifest.components.push({ id: 'fur-pack', layer: 'TOOL_RUNTIME', kind: 'data-package', scope: 'RELEASE_PATH', distribution: 'IN_REPOSITORY', rightsBasis: 'THIRD_PARTY_ATTRIBUTION_ONLY', status, licenseExpression: null, summary: 'A downloaded texture pack.', evidence: [{ type: 'FILE', ref: texture }], ...(status === 'CLEARED' ? { clearance: { clearedBy: 'OWNER', clearedOn: '2026-11-01', basis: 'The author granted use with attribution.' } } : { resolution: { ownerAction: 'Find the license.', reassessmentTrigger: 'The pack changes.' } }) });
      x.manifest.mediaFiles.push({ id: 'fur', match: { path: texture }, covers: { component: 'fur-pack' } });
      component(x.manifest, 'character-model').dependsOn = ['fur-pack'];
    };
    assert.deepEqual(paths(dev(repoWith((x) => pack(x, 'OWNER_CONFIRMATION_PENDING'))), 'COMPONENT_ABOVE_DEPENDENCY'), ['character-model']);
    // Control: once the pack has its own clearance, the model may carry it.
    assert.deepEqual(codes(dev(repoWith((x) => pack(x, 'CLEARED')))), []);
  });

  test('5. a Blender render is classified apart from the license of the tool and the scripts that render it', () => {
    const m = withChange(() => {});
    const frames = component(m, 'blender-render-output');
    // The scripts that call the Blender API are GPL; the frames are the owner's, with no license expression: both hold.
    assert.equal(m.sourceCode.python[0].license, 'GPL-3.0-or-later');
    assert.deepEqual([frames.rightsBasis, frames.licenseExpression, frames.status], ['GENERATED_FROM_OWNER_INPUTS', null, 'CLEARED']);
    assert.deepEqual(codes(dev()), []);
    // Frames recorded under the tool's GPL, or as authored rather than generated, are refused.
    refused((m) => Object.assign(component(m, 'blender-render-output'), { rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'GPL-3.0-or-later' }), /components\[3\]\.rightsBasis: generated media takes its rights from its inputs/);
    refused((m) => (component(m, 'blender-render-output').rightsBasis = 'OWNER_AUTHORED'), /components\[3\]\.rightsBasis: generated media takes its rights from its inputs/);
    // Nor can the video's asset for the generated character be filed under the tool's license.
    refused((m) => { Object.assign(asset(m, 'character'), { rightsBasis: 'OPEN_SOURCE_LICENSE', licenseExpression: 'GPL-3.0-or-later' }); delete asset(m, 'character').provenance; }, /assets\[1\]\.rightsBasis: an asset bound to generated media is never recorded under an open-source license/);
    // The tool is still judged as a tool: frames are not CLEARED above a Blender whose license is not established.
    const tool = dev(repoWith((x) => Object.assign(component(x.manifest, 'blender-runtime'), { rightsBasis: 'UNDETERMINED', licenseExpression: null, status: 'UNVERIFIED', resolution: { ownerAction: 'Read the license.', reassessmentTrigger: 'A new build.' } })));
    assert.ok(paths(tool, 'COMPONENT_ABOVE_DEPENDENCY').includes('blender-render-output'));
  });

  test('6. GPL on the Blender-API scripts leaves the repository MIT, and clearing their output relabels none of them', () => {
    assert.equal(withChange(() => {}).sourceCode.defaultLicense, 'MIT');
    refused((m) => (m.sourceCode.defaultLicense = 'GPL-3.0-or-later'), /sourceCode\.defaultLicense: must be one of MIT/);
    const root = dev(repoWith((x) => { x.files['LICENSE'] = GPL_TEXT; x.manifest.sourceCode.licenseFiles[0].sha256 = sha256Hex(GPL_TEXT); }));
    assert.ok(codes(root).includes('LICENSE_TEXT_UNEXPECTED'));
    const pkg = dev(repoWith((x) => (x.files['package.json'] = JSON.stringify({ name: 'demo', license: 'GPL-3.0-or-later', dependencies: { remotion: '4.0.532' } }))));
    assert.deepEqual(codes(pkg), ['PACKAGE_LICENSE_MISMATCH']);
    // With every output cleared, a GPL script recorded as MIT is still refused.
    const relabel = dev(repoWith((x) => Object.assign(x.manifest.sourceCode.python[0], { classification: 'BLENDER_INDEPENDENT', license: 'MIT' })));
    assert.ok(codes(relabel).includes('PYTHON_CLASSIFICATION_MISMATCH'));
  });
});

describe('a clearance carries nothing it did not establish', () => {
  test('7. clearing the character clears nothing of the third-party code it is computed with', () => {
    const r = dev(repoWith(withSdfForms));
    assert.deepEqual(codes(r), []);
    assert.deepEqual(r.pending.map((p) => p.id), ['remotion', 'sdf-forms']);
    assert.deepEqual(paths(strict(repoWith((x) => { withSdfForms(x); clearRemotion(x); })), 'RIGHTS_BLOCKING_STATUS'), ['sdf-forms']);
    // It cannot be hidden: a record whose sources carry third-party code names it.
    refused((m) => m.components.push(sdfForms('src/character/body.ts')), /components\[2\]\.provenance\.thirdPartyCodeInSources: sdf-forms credits third-party code in src\/character\/body\.ts, a file this record binds/);
    refused((m) => m.components.push(sdfForms('src/character/body.ts')), /assets\[1\]\.provenance\.thirdPartyCodeInSources: sdf-forms credits third-party code in src\/character\/body\.ts/);
    // It cannot be named where it is not: an acknowledgement is grounded in a source the record binds.
    refused((m) => { m.components.push(sdfForms('docs/LICENSING.md')); component(m, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms']; }, /thirdPartyCodeInSources: sdf-forms cites none of the files this record binds/);
    // Only third-party source code is "computed with": a tool, an output, or a missing id never is.
    for (const id of ['remotion', 'blender-render-output']) refused((m) => (component(m, 'character-model').provenance.thirdPartyCodeInSources = [id]), new RegExp(`thirdPartyCodeInSources: ${id} is not third-party-derived source`));
    refused((m) => (component(m, 'character-model').provenance.thirdPartyCodeInSources = ['nothing']), /thirdPartyCodeInSources: nothing is not a component/);
    refused((m) => (component(m, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms', 'sdf-forms']), /thirdPartyCodeInSources: duplicate sdf-forms/);
    // Recorded as part of the model instead (dependsOn), the open question keeps the model from CLEARED.
    const inside = dev(repoWith((x) => { withSdfForms(x); delete component(x.manifest, 'character-model').provenance.thirdPartyCodeInSources; component(x.manifest, 'character-model').dependsOn = ['sdf-forms']; }));
    assert.deepEqual(paths(inside, 'COMPONENT_ABOVE_DEPENDENCY'), ['character-model']);
    // No label hides it: code is never an output, and a file bound under any role still names the code it carries.
    refused((m) => (component(m, 'character-model').provenance.files[0].role = 'OUTPUT'), /src\/character\/body\.ts is not a file a generated-model makes/);
    refused((m) => { m.components.push(sdfForms('src/character/body.ts')); component(m, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms']; asset(m, 'character').provenance.files[0].role = 'ASSET'; }, /assets\[1\]\.provenance\.thirdPartyCodeInSources: sdf-forms credits third-party code in src\/character\/body\.ts/);
    // The third-party code itself can never be refiled as WalletWall's, nor name itself.
    refused((m) => { m.components.push({ ...sdfForms('src/character/body.ts'), rightsBasis: 'OWNER_AUTHORED', status: 'CLEARED', provenance: { attestation: ownerAttestation(), files: [bound('src/character/body.ts', BODY_SOURCE, 'SOURCE')], thirdPartyCodeInSources: ['sdf-forms'] } }); }, /rightsBasis: third-party-derived source is never OWNER_AUTHORED/);
    refused((m) => { m.components.push(sdfForms('src/character/body.ts')); component(m, 'character-model').provenance.thirdPartyCodeInSources = ['sdf-forms', 'character-model']; }, /thirdPartyCodeInSources: character-model is this item itself/);
  });

  test('8. clearing the Blender character frames clears nothing Remotion rendered', () => {
    const r = dev(repoWith(withReveal));
    assert.deepEqual(codes(r), []);
    assert.deepEqual(r.pending.map((p) => p.id), ['remotion', 'remotion-render-output', 'reveal-output']);
    assert.deepEqual(paths(strict(repoWith((x) => { withReveal(x); clearRemotion(x); })), 'RIGHTS_BLOCKING_STATUS'), ['remotion-render-output', 'reveal-output']);
    // A reveal frame filed under the cleared character class is refused...
    const filed = dev(repoWith((x) => { withReveal(x); x.manifest.mediaFiles.find((e: Json) => e.id === 'reveal-frames').covers = { component: 'blender-render-output' }; }));
    assert.deepEqual(paths(filed, 'PROVENANCE_MEDIA_UNBOUND'), ['blender/proof/peak.png']);
    // ...so is a character-class record that claims it while the inventory gives it to the reveal...
    const claimed = dev(repoWith((x) => { withReveal(x); component(x.manifest, 'blender-render-output').provenance.files.push(bound('blender/proof/peak.png', 'a reveal frame', 'OUTPUT')); }));
    assert.deepEqual(paths(claimed, 'PROVENANCE_MEDIA_ELSEWHERE'), ['blender/proof/peak.png']);
    // ...and the reveal class is not CLEARED above Remotion's output, whatever its own record says.
    const early = dev(repoWith((x) => {
      withReveal(x);
      const reveal = component(x.manifest, 'reveal-output');
      Object.assign(reveal, { status: 'CLEARED', provenance: { attestation: ownerAttestation(), files: [bound('src/character/scene.ts', SCENE_SOURCE, 'SOURCE'), bound('blender/proof/peak.png', 'a reveal frame', 'OUTPUT')] } });
      delete reveal.resolution;
    }));
    assert.deepEqual(paths(early, 'COMPONENT_ABOVE_DEPENDENCY'), ['reveal-output']);
  });

  test('9. an incorporated item of unknown provenance keeps a public release blocked', () => {
    const found = (x: Repo): void => {
      x.files['THIRD_PARTY_NOTICES.md'] += '### `found-mesh`\n';
      x.manifest.components.push({ id: 'found-mesh', layer: 'TOOL_RUNTIME', kind: 'data-package', scope: 'RELEASE_PATH', distribution: 'IN_REPOSITORY', rightsBasis: 'UNDETERMINED', status: 'UNKNOWN', licenseExpression: null, summary: 'A mesh nobody can say the origin of.', evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }], resolution: { ownerAction: 'Find where it came from.', reassessmentTrigger: 'Its origin is found.' } });
      component(x.manifest, 'character-model').dependsOn = ['found-mesh'];
    };
    // Claimed CLEARED anyway: refused, even in development.
    assert.deepEqual(paths(dev(repoWith(found)), 'COMPONENT_ABOVE_DEPENDENCY'), ['character-model']);
    // Recorded honestly, development passes and a public release is blocked by the mesh and by what carries it.
    const honest = repoWith((x) => { found(x); clearRemotion(x); pend(component(x.manifest, 'character-model')); pend(asset(x.manifest, 'character')); });
    assert.deepEqual(codes(dev(honest)), []);
    assert.deepEqual(paths(strict(honest), 'RIGHTS_BLOCKING_STATUS'), ['character-model', 'demo/character', 'found-mesh']);
  });

  test('10. tampering with a bound file or its recorded hash takes the clearance away', () => {
    assert.deepEqual(codes(dev()), []);
    const art = dev(repoWith((x) => (x.files['assets/brand/mark.png'] = 'a different mark')));
    assert.deepEqual(paths(art, 'PROVENANCE_STALE'), ['demo/brand-mark']);
    assert.match(art.findings.find((f) => f.code === 'PROVENANCE_STALE')!.message, /assets\/brand\/mark\.png/);
    const source = dev(repoWith((x) => (x.files['src/character/body.ts'] += '// edited\n')));
    assert.deepEqual(paths(source, 'PROVENANCE_STALE'), ['character-model', 'demo/character']);
    const hash = dev(repoWith((x) => (component(x.manifest, 'character-model').provenance.files[0].sha256 = 'e'.repeat(64))));
    assert.deepEqual(paths(hash, 'PROVENANCE_STALE'), ['character-model']);
    // New bytes recorded in the provenance while the spec still binds the old ones: the record is not about what the video uses.
    const swapped = dev(repoWith((x) => { x.files['assets/brand/mark.png'] = 'a different mark'; asset(x.manifest, 'brand-mark').provenance.files[0].sha256 = sha256Hex('a different mark'); }));
    assert.ok(swapped.findings.some((f) => f.code === 'MANIFEST_INVALID' && /binding\.sha256: the provenance binds no ASSET or OUTPUT file with these bytes/.test(f.message)));
    // A stale record is a finding in a public release too, not a pass.
    assert.deepEqual(paths(strict(repoWith((x) => { clearRemotion(x); x.files['assets/brand/mark.png'] = 'a different mark'; })), 'PROVENANCE_STALE'), ['demo/brand-mark']);
    // And the remedy is the owner's: a new attestation, never only a new hash.
    assert.match(art.findings.find((f) => f.code === 'PROVENANCE_STALE')!.message, /the owner re-establishes them \(a new attestation\)/);
    // Until then, the remedy the message names must work: back to pending AND without the record. Pending alone is not
    // enough, because a record is checked whatever the status.
    const reopened = (keepRecord: boolean) => repoWith((x) => {
      x.files['src/character/body.ts'] += '// edited\n';
      for (const item of [component(x.manifest, 'character-model'), asset(x.manifest, 'character')]) {
        pend(item);
        if (!keepRecord) delete item.provenance;
      }
    });
    assert.deepEqual(paths(dev(reopened(true)), 'PROVENANCE_STALE'), ['character-model', 'demo/character']);
    assert.deepEqual(codes(dev(reopened(false))), []);
    assert.match(source.findings.find((f) => f.code === 'PROVENANCE_STALE')!.message, /set the item back to OWNER_CONFIRMATION_PENDING and remove this record/);
  });

  test('a docs page is cleared on its published blob only when it is the page the video is made from, and only as authored content', () => {
    const second = (x: Repo, over: Json = {}): void => {
      x.manifest.videos[0].assets.push({ id: 'other-page', category: 'authored-content', binding: { type: 'CANONICAL_DOCS', docPath: 'docs/nowhere.mdx', blob: '0'.repeat(40) }, rightsBasis: 'OWNER_AUTHORED', status: 'CLEARED', licenseExpression: null, evidence: [{ type: 'FILE', ref: 'fixtures/canonical/MANIFEST.json' }], ...over });
    };
    assert.deepEqual(paths(dev(repoWith((x) => second(x))), 'ASSET_BINDING_STALE'), ['demo/other-page']);
    refused((m) => { m.videos[0].assets.push({ id: 'other-page', category: 'third-party-media', binding: { type: 'CANONICAL_DOCS', docPath: 'docs/demo.mdx', blob: '1'.repeat(40) }, rightsBasis: 'OWNER_AUTHORED', status: 'CLEARED', licenseExpression: null, evidence: [{ type: 'FILE', ref: 'fixtures/canonical/MANIFEST.json' }] }); m.videos[0].absent = m.videos[0].absent.filter((c: string) => c !== 'third-party-media'); }, /assets\[3\]\.category: a docs page is authored-content/);
  });

  test('a generated spec asset is cleared on the spec\'s bytes bound as its output, and only on those bytes', () => {
    const generated = (x: Repo, bytes: string): void => {
      x.files['assets/brand/mark.png'] = 'a generated mark';
      x.files['specs/demo/spec.json'] = x.files['specs/demo/spec.json']!.replace(BRAND_SHA, sha256Hex('a generated mark'));
      Object.assign(asset(x.manifest, 'brand-mark'), { rightsBasis: 'GENERATED_FROM_OWNER_INPUTS', binding: { type: 'SPEC_ASSET', specAssetId: 'brand-mark', sha256: sha256Hex('a generated mark') }, provenance: { attestation: ownerAttestation(), files: [bound('src/character/scene.ts', SCENE_SOURCE, 'SOURCE'), bound('assets/brand/mark.png', bytes, 'OUTPUT')] } });
    };
    assert.deepEqual(codes(dev(repoWith((x) => generated(x, 'a generated mark')))), []);
    assert.ok(dev(repoWith((x) => generated(x, 'another mark'))).findings.some((f) => /binding\.sha256: the provenance binds no ASSET or OUTPUT file with these bytes/.test(f.message)));
    // An asset's output is media it generated: code bound as one is refused.
    refused((m) => Object.assign(asset(m, 'brand-mark'), { rightsBasis: 'GENERATED_FROM_OWNER_INPUTS', provenance: { attestation: ownerAttestation(), files: [bound('src/character/body.ts', BODY_SOURCE, 'SOURCE'), bound('src/character/scene.ts', SCENE_SOURCE, 'OUTPUT')] } }), /src\/character\/scene\.ts is not a media file: an OUTPUT is media the item generated/);
  });

  test('11. an owner record never stands in for a provider\'s terms, and the voice clearances are untouched', () => {
    assert.deepEqual(codes(dev(repoWith((x) => withNarration(x)))), []);
    const provenanced = dev(repoWith((x) => { withNarration(x); component(x.manifest, 'elevenlabs-service').provenance = { attestation: ownerAttestation(), files: [bound('src/character/body.ts', BODY_SOURCE, 'SOURCE')] }; }));
    assert.ok(provenanced.findings.some((f) => f.code === 'MANIFEST_INVALID' && /provenance: only an OWNER_AUTHORED or GENERATED_FROM_OWNER_INPUTS item carries one/.test(f.message)), JSON.stringify(provenanced.findings));
  });

  test('12. the strict check still fails on every item that is not CLEARED, one finding each, and passes only when none is left', () => {
    assert.deepEqual(paths(strict(), 'RIGHTS_BLOCKING_STATUS'), ['remotion']);
    for (const status of ['OWNER_CONFIRMATION_PENDING', 'BLOCKED', 'NONCOMMERCIAL', 'INCOMPATIBLE']) {
      const r = strict(repoWith((x) => { withSdfForms(x); clearRemotion(x); component(x.manifest, 'sdf-forms').status = status; }));
      assert.deepEqual(paths(r, 'RIGHTS_BLOCKING_STATUS'), ['sdf-forms'], status);
    }
    assert.equal(strict(repoWith(clearRemotion)).result, 'PASS');
  });
});

describe('this repository: the owner-authored and owner-generated items', () => {
  const repo = fsRepo(VIDEO_ROOT);
  const manifest = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'config', 'release-rights.json'), 'utf8')) as Json;
  const item = (id: string): Json => manifest.components.find((c: Json) => c.id === id) ?? manifest.videos[0].assets.find((a: Json) => a.id === id);
  const sources = (id: string): string[] => item(id).provenance.files.filter((f: Json) => f.role === 'SOURCE').map((f: Json) => f.path).sort();
  const LANE = 'blender/walletwallaby';
  /** A lane entry script and every lane module it loads, derived from the code by the import scanner, not from the record. */
  const closure = (entry: string): string[] => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const i of scanPython(file, readFileSync(path.join(VIDEO_ROOT, ...file.split('/')), 'utf8')).imports) {
        const sibling = `${LANE}/${i.module.split('.')[0]}.py`;
        if (i.level === 0 && repo.read(sibling) !== null) visit(sibling);
      }
    };
    visit(`${LANE}/${entry}`);
    return [...seen].sort();
  };

  test('the four items are CLEARED, each on the owner\'s record and nothing else (the brand mark of 2026-10-25; the character, model, and frames re-established 2026-10-26, when their signed-distance code was replaced)', () => {
    const attestedOn: Record<string, string> = { 'brand-mark': '2026-10-25', character: '2026-10-26', 'walletwallaby-character-model': '2026-10-26', 'blender-render-output': '2026-10-26' };
    for (const id of ['brand-mark', 'character', 'walletwallaby-character-model', 'blender-render-output']) {
      const i = item(id);
      assert.equal(i.status, 'CLEARED', id);
      assert.equal(i.resolution, undefined, id);
      assert.equal(i.clearance, undefined, `${id}: an owner item is not cleared by a vendor-style clearance record`);
      assert.deepEqual(Object.keys(i.provenance.attestation).sort(), ['attestedBy', 'attestedOn', 'basis'], id);
      assert.deepEqual([i.provenance.attestation.attestedBy, i.provenance.attestation.attestedOn], ['OWNER', attestedOn[id]], id);
    }
    assert.deepEqual(['brand-mark', 'character', 'walletwallaby-character-model', 'blender-render-output'].map((id) => item(id).rightsBasis), ['OWNER_AUTHORED', 'OWNER_AUTHORED', 'GENERATED_FROM_OWNER_INPUTS', 'GENERATED_FROM_OWNER_INPUTS']);
  });

  test('the brand mark is bound to the committed mark, the bytes the spec stages for the footer', () => {
    assert.deepEqual(item('brand-mark').provenance.files, [{ path: 'assets/brand/walletwall-brick-wallet.png', sha256: '91926a2eebc1777194ecf491049b8a7af3cf0892b09b363c5b2a17cd17d5dbad', role: 'ASSET' }]);
    const spec = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'specs', 'migration-readiness', 'spec.json'), 'utf8')) as Json;
    assert.equal(spec.assets.find((a: Json) => a.id === 'brand-mark').sha256, '91926a2eebc1777194ecf491049b8a7af3cf0892b09b363c5b2a17cd17d5dbad');
  });

  test('the model binds every lane module its build loads and the pinned character, and its sources carry no third-party code', () => {
    assert.deepEqual(closure('build.py'), [`${LANE}/build.py`, `${LANE}/common.py`, `${LANE}/geometry.py`, `${LANE}/materials.py`, `${LANE}/rig.py`]);
    assert.deepEqual(sources('walletwallaby-character-model'), [...closure('build.py'), 'src/character/walletwallaby/versions.ts'].sort());
    assert.equal(item('walletwallaby-character-model').provenance.thirdPartyCodeInSources, undefined);
    assert.equal(item('walletwallaby-character-model').dependsOn, undefined, 'nothing third-party is inside the model');
    assert.deepEqual(item('walletwallaby-character-model').producedBy, ['blender-runtime']);
  });

  test('the character asset binds the rig contract, the body design, and the declared versions', () => {
    assert.deepEqual(sources('character'), [`${LANE}/geometry.py`, `${LANE}/materials.py`, 'src/character/walletwallaby/rig.ts', 'src/character/walletwallaby/rig/rig-source.ts', 'src/character/walletwallaby/versions.ts']);
    assert.equal(item('character').provenance.thirdPartyCodeInSources, undefined);
    assert.deepEqual(item('character').binding, { type: 'COMPONENT', componentId: 'walletwallaby-character-model' });
  });

  test('the character frames bind every lane module a render loads and the seven committed character frames, at the hashes proof.json records', () => {
    assert.deepEqual(closure('render.py'), ['common.py', 'controls.py', 'geometry.py', 'materials.py', 'render.py', 'rig.py', 'scene.py', 'terrain.py', 'transition.py'].map((f) => `${LANE}/${f}`));
    // ...and the two job writers that decide which Blender jobs load an image (only a depth reveal does).
    assert.deepEqual(sources('blender-render-output'), [...closure('render.py'), 'scripts/blender-proof.ts', 'src/blender/production.ts'].sort());
    const proof = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'blender', 'proof', 'reference', 'proof.json'), 'utf8')) as Json;
    const character = proof.roles.filter((r: Json) => !r.role.startsWith('transition-')).map((r: Json) => ({ path: `blender/proof/reference/${r.file}`, sha256: r.sha256, role: 'OUTPUT' }));
    assert.equal(character.length, 7);
    const outputs = item('blender-render-output').provenance.files.filter((f: Json) => f.role === 'OUTPUT');
    assert.deepEqual([...outputs].sort((a: Json, b: Json) => (a.path < b.path ? -1 : 1)), [...character].sort((a: Json, b: Json) => (a.path < b.path ? -1 : 1)));
    assert.deepEqual(item('blender-render-output').dependsOn, ['walletwallaby-character-model']);
  });

  test('the depth-reveal frames are their own item, pending until Remotion\'s output is cleared', () => {
    const reveal = item('blender-depth-reveal-output');
    assert.deepEqual([reveal.layer, reveal.kind, reveal.scope, reveal.rightsBasis, reveal.status], ['GENERATED_MEDIA', 'generated-render', 'RELEASE_PATH', 'GENERATED_FROM_OWNER_INPUTS', 'OWNER_CONFIRMATION_PENDING']);
    assert.deepEqual(reveal.dependsOn, ['walletwallaby-character-model', 'remotion-render-output']);
    const covering = (file: string): string => manifest.mediaFiles.find((e: Json) => ('path' in e.match ? [e.match.path] : e.match.paths).includes(file)).covers.component;
    for (const role of ['transition-entry', 'transition-peak', 'transition-exit']) assert.equal(covering(`blender/proof/reference/${role}.png`), 'blender-depth-reveal-output', role);
    for (const role of ['idle', 'crouch', 'airborne', 'landing', 'perch', 'inspect', 'tail-brace']) assert.equal(covering(`blender/proof/reference/${role}.png`), 'blender-render-output', role);
  });

  test('development passes, and the strict check fails on exactly the items this lane does not clear', () => {
    const d = dev(repo);
    assert.deepEqual(d.findings, []);
    const open = ['blender-depth-reveal-output', 'remotion', 'remotion-render-output'];
    assert.deepEqual(d.pending.map((p) => p.id).sort(), open);
    const s = strict(repo);
    assert.equal(s.result, 'FAIL');
    assert.deepEqual(s.findings.map((f) => f.path).sort(), open);
    assert.ok(s.findings.every((f) => f.code === 'RIGHTS_BLOCKING_STATUS'));
  });

  test('the records this lane leaves alone are byte-for-byte as main had them (content addresses computed on main d013c06)', () => {
    const pinned: Record<string, string> = {
      'elevenlabs-service': 'a28343defd4fa0783d851599bb3b9dd35e2634cc77ce389327f8e004918389ca',
      'elevenlabs-narration-audio': 'e8fd3d5cfac21001b03cdb56fb2a539f86411246637105f22d0efe640351e717',
      narration: 'e27324c291de12333252407c98f65c5aec18c2f99d2b2fc4f7d9cb812ca7514e',
      remotion:'cfe09d27ceac7101994c3cf18e075877fa7e236fe58ec2caf4aed50b03f93aa3',
      'remotion-render-output': '7e37d1cc1601dc1cb9f3fd681a621279e9da5c0f9ba0522c4abc3e467b6a14ef',
      'blender-runtime': 'c0c694c2c243d35e95cb17e01d401a77f071f05620f6fdb358b9188d69244e32',
      'docs-page': 'd18ff46509e6efa74e57ee6c165ece57da948515d6d9e73c63cc268b1c1d92ad',
    };
    for (const [id, sha] of Object.entries(pinned)) assert.equal(contentAddress(item(id)), sha, id);
    // quilez-sdf-forms (main d013c06: 39929253…) is retired: the code it recorded was replaced (docs/LICENSING.md).
    assert.equal(item('quilez-sdf-forms'), undefined);
  });

  test('each owner record is pinned with its attestation and its bytes together, so new bytes need a new attestation', () => {
    // The checker cannot tell a new sha256 recorded under the old attestation from a re-attestation; this pin can, in
    // review: changing a record's files without its attestation, or the other way round, fails here.
    const pinned: Record<string, string> = PINNED_OWNER_RECORDS;
    const records: Record<string, Json> = {
      'brand-mark': item('brand-mark').provenance,
      character: item('character').provenance,
      'walletwallaby-character-model': item('walletwallaby-character-model').provenance,
      'blender-render-output': item('blender-render-output').provenance,
    };
    for (const [id, rec] of Object.entries(records)) assert.equal(contentAddress(rec), pinned[id], `${id} (attested ${rec.attestation.attestedOn})`);
  });

  test('no vendor, provider, or third-party item carries an owner provenance record', () => {
    const items: Json[] = [...manifest.components, ...manifest.videos.flatMap((v: Json) => v.assets)];
    for (const i of items.filter((x) => x.provenance !== undefined)) assert.ok(['OWNER_AUTHORED', 'GENERATED_FROM_OWNER_INPUTS'].includes(i.rightsBasis), i.id);
    // No owner record names third-party code: the lane's sources carry none since 2026-10-26.
    for (const i of items.filter((x) => x.provenance !== undefined)) assert.equal(i.provenance.thirdPartyCodeInSources, undefined, i.id);
  });
});
