// Publication narration through the public-output gate and the publication proof receipt. The narration set is made
// once through the ElevenLabs stub (test/narration-stub.ts); every later step replays it from disk, exactly as
// render, publish:dry-run, public:check, and publication:receipt do with --narration=publication. Each case changes
// one thing and names the code that must refuse it; a fixture narration never passes where publication narration is
// required, and publication narration never passes as the fixture estimate.

import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadPublicationBinding, PUBLICATION_RECORD_FILE, PublicationNarrationReplay } from '../src/narration/publication.ts';
import { buildReceipt, stageEvidence, verifyReceipt, writeReceipt, receiptIdentity, type PublicationProofReceipt } from '../src/publish/proof-receipt.ts';
import { checkPublicOutput, currentPublicState, type PublicOutputCode, type PublicState } from '../src/publish/public-output.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { attachRender, editJson, proofFixture, readJsonFile, scratchArea, VIDEO_ID, writeDryRunPackage } from './publication-fixtures.ts';
import { naturalPace, stubPublicationSet } from './narration-stub.ts';

const area = scratchArea('pubnarr');
after(area.cleanup);
const WRITTEN_AT = '2026-10-21T12:00:00.000Z';
const MACHINE = ['render-host-7', 'example-user'];

let setDir: string;
let pub: PublicState;
let fixture: PublicState;
let pubPackage: string;
let fixturePackage: string;

before(async () => {
  // A natural pace, so the measured timeline is one the lesson's motion can carry (the support audit fails closed otherwise).
  ({ dir: setDir } = await stubPublicationSet({ toneMs: naturalPace }));
  pub = { ...(await currentPublicState(VIDEO_ID, {}, { narration: 'publication', narrationDir: setDir })), machineNames: MACHINE };
  fixture = { ...(await currentPublicState(VIDEO_ID, {})), machineNames: MACHINE };
  pubPackage = area.dir('pub-package');
  await writeDryRunPackage(pubPackage, { voice: new PublicationNarrationReplay(setDir, loadPublicationBinding(), { videoId: VIDEO_ID }), setDir });
  fixturePackage = area.dir('fixture-package');
  await writeDryRunPackage(fixturePackage);
});

/** A copy of a clean package with a render attached the way scripts/render.ts records one for `state`. */
function rendered(state: PublicState, clean: string, label: string, change?: (dir: string) => void): string {
  const dir = area.dir(label);
  cpSync(clean, dir, { recursive: true });
  attachRender(dir, state);
  change?.(dir);
  return dir;
}

const codes = (dir: string, state: PublicState): PublicOutputCode[] => checkPublicOutput(dir, state, { requireRender: true }).report.findings.map((f) => f.code);

describe('publication narration: the public-output gate', () => {
  test('a publication-narrated package passes, binding the record and every line WAV', () => {
    const { report } = checkPublicOutput(rendered(pub, pubPackage, 'pass'), pub, { requireRender: true });
    assert.deepEqual(report.findings, []);
    const narration = report.files.filter((f) => f.path.startsWith(`${VIDEO_ID}/narration/`)).map((f) => f.path);
    assert.equal(narration.length, pub.narrationPublication!.files.length);
    assert.ok(narration.includes(`${VIDEO_ID}/narration/${PUBLICATION_RECORD_FILE}`));
    assert.ok(narration.includes(`${VIDEO_ID}/narration/hook.l1.wav`));
    assert.notEqual(pub.totalMs, fixture.totalMs, 'the publication timeline follows the measured audio');
  });

  test('the same package is refused by a gate that replays the fixture voice', () => {
    const found = codes(rendered(pub, pubPackage, 'under-fixture'), fixture);
    assert.ok(found.includes('CAPTIONS_MISMATCH'), found.join(' '));
    assert.ok(found.includes('NARRATION_INVALID'), found.join(' '));
  });

  test('a fixture-narrated package never passes where publication narration is required', () => {
    const found = codes(rendered(fixture, fixturePackage, 'fixture-under-pub'), pub);
    assert.ok(found.includes('CAPTIONS_MISMATCH'), found.join(' '));
    assert.ok(found.includes('ARTIFACT_MISSING'), 'the narration set is not in the package');
    assert.ok(found.includes('NARRATION_INVALID'), 'the render names no publication narration');
  });

  test('a changed line WAV in the package is refused', () => {
    const found = codes(rendered(pub, pubPackage, 'wav', (d) => {
      const f = path.join(d, 'narration', 'hook.l1.wav');
      const b = readFileSync(f);
      b[b.length - 2] = b[b.length - 2]! ^ 1;
      writeFileSync(f, b);
    }), pub);
    assert.deepEqual(found, ['NARRATION_INVALID']);
  });

  test('a missing narration record is refused', () => {
    assert.ok(codes(rendered(pub, pubPackage, 'no-record', (d) => rmSync(path.join(d, 'narration', PUBLICATION_RECORD_FILE))), pub).includes('ARTIFACT_MISSING'));
  });

  test('a render or provenance naming another narration set is refused', () => {
    const other = (doc: { narration: { publication: { voiceId: string } } }) => (doc.narration.publication.voiceId = 'AAAAAAAAAAAAAAAAAAAA');
    assert.deepEqual(codes(rendered(pub, pubPackage, 'render-ref', (d) => editJson(path.join(d, 'render.json'), other)), pub), ['NARRATION_INVALID']);
    assert.deepEqual(codes(rendered(pub, pubPackage, 'prov-ref', (d) => editJson(path.join(d, 'provenance.json'), other)), pub), ['NARRATION_INVALID']);
  });
});

describe('publication narration: the proof receipt', () => {
  /** A passed publication-narrated proof with its receipt written. */
  function proven(state: PublicState, clean: string, label: string): { receiptPath: string; bundle: string } {
    const fx = proofFixture(area.dir, state, clean, label);
    stageEvidence(fx.bundle, fx.sources);
    return { receiptPath: writeReceipt(fx.bundle, buildReceipt(fx.bundle, state, WRITTEN_AT), state), bundle: fx.bundle };
  }

  test('binds the narration set: its identity, binding, and hashes, and every file of it', () => {
    const { receiptPath } = proven(pub, pubPackage, 'receipt');
    assert.deepEqual(verifyReceipt(receiptPath, pub).findings, []);
    const r = readJsonFile<PublicationProofReceipt>(receiptPath);
    assert.equal(r.schema, 'walletwall.publication-proof-receipt/v2');
    assert.deepEqual(r.subject.narration, { providerId: 'elevenlabs', estimated: false, audio: 'PRESENT', publication: pub.narrationPublication!.ref });
    for (const f of pub.narrationPublication!.files) {
      const bound = r.subject.files.find((x) => x.path === `${VIDEO_ID}/narration/${f.name}`);
      assert.equal(bound?.sha256, f.sha256, f.name);
    }
    assert.ok(!/ELEVENLABS_API_KEY|test-key-not-real/.test(readFileSync(receiptPath, 'utf8')), 'no credential name or value');
  });

  test('verifies against the narration set held in its own proof package', async () => {
    const { receiptPath, bundle } = proven(pub, pubPackage, 'own-package');
    const fromPackage = { ...(await currentPublicState(VIDEO_ID, {}, { narration: 'publication', narrationDir: path.join(bundle, VIDEO_ID, 'narration') })), machineNames: MACHINE };
    assert.deepEqual(verifyReceipt(receiptPath, fromPackage).findings, []);
  });

  test('is refused by a checkout that replays only the fixture voice', () => {
    const { receiptPath } = proven(pub, pubPackage, 'under-fixture');
    const r = verifyReceipt(receiptPath, fixture);
    assert.equal(r.ok, false);
    assert.ok(r.findings.some((f) => f.code === 'CHECKOUT_MISMATCH' && f.path === 'subject.narration'));
  });

  test('a forged narration identity is refused even with a recomputed receipt hash', () => {
    const { receiptPath } = proven(pub, pubPackage, 'forged');
    const r = readJsonFile<PublicationProofReceipt>(receiptPath);
    r.subject.narration.publication!.modelId = 'eleven_v3';
    r.receiptSha256 = receiptIdentity(r.subject);
    writeFileSync(receiptPath, prettyJson(r));
    assert.ok(verifyReceipt(receiptPath, pub, { receiptOnly: true }).findings.some((f) => f.code === 'CHECKOUT_MISMATCH' && f.path === 'subject.narration'));
  });

  test('a fixture-narrated proof never passes as publication narration', () => {
    const { receiptPath } = proven(fixture, fixturePackage, 'fixture');
    const r = readJsonFile<PublicationProofReceipt>(receiptPath);
    assert.deepEqual(r.subject.narration, { providerId: 'fixture-estimate', estimated: true, audio: 'NONE', publication: null });
    assert.deepEqual(verifyReceipt(receiptPath, fixture).findings, []);
    assert.ok(verifyReceipt(receiptPath, pub).findings.some((f) => f.code === 'CHECKOUT_MISMATCH' && f.path === 'subject.narration'));
  });
});
