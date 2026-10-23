// Partial regeneration: when a script or pronunciation change makes a publication narration set stale, the next set
// carries over every line whose audio is still exactly right (the same spoken text, chunk plan, and binding, every
// byte verified against the old record) and pays only for the rest. The new record is built from the current script
// alone: no hash, identity, or label of the old set is reused. ElevenLabs is the counting stub; no network, no key.

import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { voiceRequestFor } from '../src/audio/voice-provider.ts';
import type { PronunciationLexicon } from '../src/config/types.ts';
import { sha256Hex } from '../src/core/hash.ts';
import {
  loadPublicationBinding,
  planPublicationNarration,
  PUBLICATION_RECORD_FILE,
  PUBLICATION_NARRATION_SCHEMA,
  PublicationNarrationReplay,
  publicationExpectation,
  recordIdentity,
  validatePublicationRecord,
  type PublicationNarrationRecord,
  type ResolvedPublication,
} from '../src/narration/publication.ts';
import { synthesize } from '../src/pipeline/render-input.ts';
import { clone, committedSpec, config } from './helpers.ts';
import { elevenlabs as countingStub, KEY, naturalPace, publicationVoice, scratch } from './narration-stub.ts';

/** The stub speaking at a natural pace, so a different text is different audio. */
const elevenlabs = () => countingStub({ toneMs: naturalPace });

const spec = committedSpec();
const SEPOLIA_LINE = 'vault.l3';
/** The previous lexicon version: v1's entries (Sepolia as four words), under the version its pin names. */
const oldLexicon = (): PronunciationLexicon => {
  const l = clone(config.lexicon);
  Object.assign(l.entries.find((e) => e.term === 'Sepolia')!, { spoken: 'seh POH lee uh', ipa: 'səˈpoʊliə' });
  l.version = 1;
  return l;
};
const readRecord = (dir: string): PublicationNarrationRecord => JSON.parse(readFileSync(path.join(dir, PUBLICATION_RECORD_FILE), 'utf8'));
const wavs = (dir: string, record: PublicationNarrationRecord) => new Map(record.subject.lines.map((l) => [l.lineId, readFileSync(path.join(dir, l.audio.file))]));
const expectation = (lexicon: PronunciationLexicon = config.lexicon, publication: ResolvedPublication = loadPublicationBinding()) =>
  publicationExpectation(voiceRequestFor(spec, config.voice, lexicon), publication, spec.id, 'video');

/** A set synthesized through the stub for the committed spec with the given lexicon. */
async function setWith(lexicon: PronunciationLexicon): Promise<string> {
  const dir = path.join(scratch(), 'narration');
  await synthesize(spec, publicationVoice(dir, elevenlabs()), { ...config, lexicon });
  return dir;
}

describe('partial regeneration of a publication narration set', () => {
  test('a pronunciation change requests only the line that speaks the term; every other line is carried byte for byte', async () => {
    const dir = await setWith(oldLexicon());
    const before = readRecord(dir);
    const old = wavs(dir, before);
    const stub = elevenlabs();
    await synthesize(spec, publicationVoice(dir, stub), config);
    assert.equal(stub.posts().length, 1, 'one paid request');
    // v1 asked for "seh POH lee uh"; the current lexicon speaks Sepolia as written, so the re-voiced line asks for the real word.
    assert.match(String(stub.posts()[0]!.body?.text), /Ethereum Sepolia,/);
    assert.ok(!String(stub.posts()[0]!.body?.text).includes('seh POH lee uh'));
    const after = readRecord(dir);
    const now = wavs(dir, after);
    for (const [id, bytes] of now) {
      if (id === SEPOLIA_LINE) assert.notEqual(sha256Hex(bytes), sha256Hex(old.get(id)!));
      else assert.equal(sha256Hex(bytes), sha256Hex(old.get(id)!), `${id} carried`);
    }
    assert.equal(after.informational.requests, 1);
    assert.deepEqual(after.informational.carried.map((c) => c.lineId).sort(), after.subject.lines.map((l) => l.lineId).filter((id) => id !== SEPOLIA_LINE).sort());
  });

  test('a carried line keeps where and when its audio was made: the set whose run made it, through any number of carries', async () => {
    const dir = await setWith(oldLexicon());
    const first = readRecord(dir);
    // Pretend the first set was made long ago, as a real one was: rewrite its time and identity consistently.
    const r = first as unknown as Record<string, any>;
    r.informational.generatedAt = '2026-10-22T02:46:17.118Z';
    writeFileSync(path.join(dir, PUBLICATION_RECORD_FILE), JSON.stringify(r));
    await synthesize(spec, publicationVoice(dir, elevenlabs()), config);
    const second = readRecord(dir);
    for (const c of second.informational.carried) assert.deepEqual({ madeIn: c.madeIn, madeAt: c.madeAt }, { madeIn: first.identity, madeAt: '2026-10-22T02:46:17.118Z' }, c.lineId);
    assert.ok(!second.informational.carried.some((c) => c.lineId === SEPOLIA_LINE), 'the re-voiced line was made by this run');
    // A second carry (a script change that re-voices another line) keeps the first run as the origin, not the middle one.
    const edited = clone(spec);
    const takeaway = edited.segments.find((s) => s.id === 'takeaway')!.narration[1]!;
    takeaway.text = takeaway.text.replace('A tier is', 'A tier is simply');
    await synthesize(edited, publicationVoice(dir, elevenlabs()), config);
    const third = readRecord(dir);
    const origin = (id: string) => third.informational.carried.find((c) => c.lineId === id);
    assert.deepEqual({ madeIn: origin('hook.l1')!.madeIn, madeAt: origin('hook.l1')!.madeAt }, { madeIn: first.identity, madeAt: '2026-10-22T02:46:17.118Z' });
    assert.deepEqual({ madeIn: origin(SEPOLIA_LINE)!.madeIn, madeAt: origin(SEPOLIA_LINE)!.madeAt }, { madeIn: second.identity, madeAt: second.informational.generatedAt });
    assert.equal(origin(takeaway.id), undefined, 'the newly voiced line is this run\'s');
    assert.deepEqual(validatePublicationRecord(third, {}), []);
  });

  test('a carried-line entry that is not a line of the set, or not a sha256 and a time, is refused', async () => {
    const dir = await setWith(oldLexicon());
    await synthesize(spec, publicationVoice(dir, elevenlabs()), config);
    const good = readRecord(dir);
    for (const [what, edit] of [
      ['an unknown line', (r: PublicationNarrationRecord) => (r.informational.carried[0]!.lineId = 'nope.l1')],
      ['a repeated line', (r: PublicationNarrationRecord) => r.informational.carried.push({ ...r.informational.carried[0]! })],
      ['not a sha256', (r: PublicationNarrationRecord) => (r.informational.carried[0]!.madeIn = 'x')],
      ['not a time', (r: PublicationNarrationRecord) => (r.informational.carried[0]!.madeAt = 'yesterday')],
      ['an extra field', (r: PublicationNarrationRecord) => Object.assign(r.informational.carried[0]!, { by: 'someone' })],
    ] as const) {
      const r = clone(good);
      edit(r);
      assert.ok(validatePublicationRecord(r, {}).length > 0, what);
    }
  });

  test('a verified staging set that went stale still carries: paid audio is never paid for twice', async () => {
    const dir = await setWith(oldLexicon());
    // Move the set into staging, as an interrupted run of an earlier script would have left it, and leave no set.
    const staging = `${dir}.staging`;
    renameSync(dir, staging);
    const plan = planPublicationNarration(dir, expectation());
    assert.deepEqual(plan.synthesize.map((l) => l.lineId), [SEPOLIA_LINE], 'the plan carries from staging too');
    const stub = elevenlabs();
    await synthesize(spec, publicationVoice(dir, stub), config);
    assert.equal(stub.posts().length, 1);
    assert.equal(readRecord(dir).informational.carried.length, expectation().lines.length - 1);
  });

  test('the plan sees a current set an interrupted run left in staging: nothing to pay for', async () => {
    const dir = await setWith(config.lexicon);
    renameSync(dir, `${dir}.staging`);
    const plan = planPublicationNarration(dir, expectation());
    assert.equal(plan.current, true);
    assert.equal(plan.requests, 0);
  });

  test('a lexicon whose entries changed without a new version is refused before any request, and on replay', async () => {
    const unpinned = clone(config.lexicon);
    unpinned.entries.find((e) => e.term === 'Sepolia')!.spoken = 'seh POH lee uh';
    const dir = path.join(scratch(), 'narration');
    const stub = elevenlabs();
    await assert.rejects(synthesize(spec, publicationVoice(dir, stub), { ...config, lexicon: unpinned }), /lexicon .*version/i);
    assert.equal(stub.calls.length, 0);
    const good = await setWith(config.lexicon);
    await assert.rejects(synthesize(spec, new PublicationNarrationReplay(good, loadPublicationBinding(), { videoId: spec.id }), { ...config, lexicon: unpinned }), /lexicon .*version/i);
  });

  test('the new record is the current script\'s alone: no hash or identity of the old set survives', async () => {
    const dir = await setWith(oldLexicon());
    const before = readRecord(dir);
    await synthesize(spec, publicationVoice(dir, elevenlabs()), config);
    const after = readRecord(dir);
    const e = expectation();
    assert.equal(after.schema, PUBLICATION_NARRATION_SCHEMA);
    assert.deepEqual(validatePublicationRecord(after, {}), []);
    assert.equal(after.subject.script.sha256, e.scriptSha256);
    assert.equal(after.subject.chunkPlanSha256, e.chunkPlanSha256);
    assert.deepEqual(after.subject.lexicon, e.lexicon);
    assert.deepEqual(after.subject.lines.map((l) => [l.lineId, l.displaySha256, l.spokenSha256, l.chunks]), e.lines.map((l) => [l.lineId, l.displaySha256, l.spokenSha256, l.chunks]));
    for (const k of ['identity'] as const) assert.notEqual(after[k], before[k]);
    assert.notEqual(after.subject.script.sha256, before.subject.script.sha256);
    assert.notEqual(after.subject.audioSha256, before.subject.audioSha256);
    assert.equal(after.identity, recordIdentity(after.schema, after.subject));
  });

  test('the plan says exactly what a run would request, with no credential and no request', async () => {
    const dir = await setWith(oldLexicon());
    const plan = planPublicationNarration(dir, expectation());
    assert.equal(plan.current, false);
    assert.deepEqual(plan.synthesize.map((l) => l.lineId), [SEPOLIA_LINE]);
    const e = expectation().lines.find((l) => l.lineId === SEPOLIA_LINE)!;
    assert.equal(plan.requests, e.texts.length);
    assert.equal(plan.characters, e.texts.reduce((n, t) => n + t.length, 0));
    assert.equal(plan.carried.length, expectation().lines.length - 1);
    // And the run then requests exactly that.
    const stub = elevenlabs();
    await synthesize(spec, publicationVoice(dir, stub), config);
    assert.equal(stub.posts().length, plan.requests);
    assert.deepEqual(stub.posts().map((p) => String(p.body?.text)), e.texts);
    assert.equal(planPublicationNarration(dir, expectation()).current, true);
  });

  test('nothing is carried across a binding change: another model, voice, setting, or chunk policy pays for every line', async () => {
    const dir = await setWith(oldLexicon());
    const real = loadPublicationBinding();
    const other: ResolvedPublication = { ...real, synthesisConfigSha256: 'f'.repeat(64), bindingSha256: 'e'.repeat(64) };
    const plan = planPublicationNarration(dir, expectation(config.lexicon, other));
    assert.deepEqual(plan.carried, []);
    assert.equal(plan.synthesize.length, expectation().lines.length);
  });

  test('a line whose audio no longer matches its old record is paid for again, never relabelled', async () => {
    const dir = await setWith(oldLexicon());
    const victim = readRecord(dir).subject.lines.find((l) => l.lineId !== SEPOLIA_LINE)!;
    const bytes = readFileSync(path.join(dir, victim.audio.file));
    bytes.writeUInt8(bytes.readUInt8(bytes.length - 2) ^ 0x01, bytes.length - 2);
    writeFileSync(path.join(dir, victim.audio.file), bytes);
    const plan = planPublicationNarration(dir, expectation());
    assert.deepEqual(plan.synthesize.map((l) => l.lineId).sort(), [SEPOLIA_LINE, victim.lineId].sort());
    assert.ok(!plan.carried.includes(victim.lineId));
  });

  test('when every line carries over (an older record format), the set is rebuilt with no key and no request', async () => {
    const dir = await setWith(config.lexicon);
    // Rewrite the record as the v1 format: no lexicon binding, the v1 schema, its own identity.
    const r = readRecord(dir) as unknown as Record<string, any>;
    delete r.subject.lexicon;
    delete r.informational.carried;
    r.schema = 'walletwall.publication-narration/v1';
    r.informational = { generatedAt: r.informational.generatedAt, requests: r.informational.requests };
    r.identity = recordIdentity(r.schema, r.subject);
    writeFileSync(path.join(dir, PUBLICATION_RECORD_FILE), JSON.stringify(r));
    const plan = planPublicationNarration(dir, expectation());
    assert.equal(plan.current, false, 'a v1 record binds no lexicon, so it is not current');
    assert.equal(plan.requests, 0);
    const stub = elevenlabs();
    await synthesize(spec, publicationVoice(dir, stub, {}), config);
    assert.equal(stub.calls.length, 0, 'no preflight, no request');
    assert.equal(readRecord(dir).schema, PUBLICATION_NARRATION_SCHEMA);
    assert.equal(readRecord(dir).informational.requests, 0);
  });

  test('a record for another video or scope carries nothing', async () => {
    const dir = await setWith(oldLexicon());
    const r = readRecord(dir);
    r.subject.videoId = 'another-video';
    r.identity = recordIdentity(r.schema, r.subject);
    writeFileSync(path.join(dir, PUBLICATION_RECORD_FILE), JSON.stringify(r));
    assert.deepEqual(planPublicationNarration(dir, expectation()).carried, []);
  });

  test('a run with lines to pay for still needs the credential, and asks for nothing without it', async () => {
    const dir = await setWith(oldLexicon());
    const stub = elevenlabs();
    await assert.rejects(synthesize(spec, publicationVoice(dir, stub, {}), config), /ELEVENLABS_API_KEY is not set/);
    assert.equal(stub.calls.length, 0);
    await synthesize(spec, publicationVoice(dir, elevenlabs(), { ELEVENLABS_API_KEY: KEY }), config);
  });
});
