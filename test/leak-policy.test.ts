// The shared leak policy (src/core/leak-scan.ts) and the public-output gate's use of it: local machine paths,
// secret-shaped values, and this machine's own host and user names. Every rule has a positive control (the leak is
// caught) and a negative control (ordinary content is not). Secret-shaped strings are assembled at run time so that
// no committed file holds one.

import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { localPathIn, machineNameIn, machineNames, credentialPatternIn } from '../src/core/leak-scan.ts';
import { checkPublicOutput, currentPublicState, publicVocabulary, writeReviewBundle, type PublicOutputCode, type PublicState } from '../src/publish/public-output.ts';
import { attachRender, characterEvidence, editJson, ENVIRONMENTS, environmentRecord, mp4, scratchArea, VIDEO_ID, VTT, writeDryRunPackage } from './publication-fixtures.ts';

/** Secret-shaped values, built here so that the source holds none. */
const CREDENTIAL_SAMPLES: [string, string][] = [
  ['a private key', ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')],
  ['a GitHub token', `gh${'p'}_${'Ab1'.repeat(12)}`],
  ['a GitHub token', `github_${'pat'}_${'A1b2'.repeat(12)}`],
  ['an AWS access key', `AKI${'A'}${'Q7XZ'.repeat(4)}`],
  ['a Google API key', `AI${'za'}${'Sy9-'.repeat(9)}`],
  ['a Google OAuth token', `ya2${'9'}.${'a0Ab'.repeat(6)}`],
  ['a Slack token', `xox${'b'}-${'1234567890'.repeat(2)}`],
  ['an API secret key', `s${'k'}-${'proj'}-${'Ab12'.repeat(8)}`],
  ['an API secret key', `s${'k'}_${'0f'.repeat(24)}`],
  ['a JSON web token', `ey${'J'}hbGciOiJIUzI1NiJ9.ey${'J'}zdWIiOiIxMjM0In0.${'sig_ab12'.repeat(2)}`],
  ['a bearer token', `Authorization: Bear${'er'} ${'tok3n'.repeat(5)}`],
  ['credentials inside a URL', `https://deploy:${'hunter2hunter2'}@example.com/x`],
];

describe('the shared leak policy', () => {
  test('local paths are caught; repo-relative paths, workspace paths, and URLs are not', () => {
    for (const leak of ['C:\\Users\\example\\x', 'see /home/example/x', '\\\\fileserver\\share\\x', 'at ~/x', 'file:///x', '/tmp/remotion-bundle/x']) assert.ok(localPathIn(leak, []), leak);
    for (const fine of ['docs/concepts/migration-readiness.mdx', 'dist/migration-readiness/x.vtt', 'video/specs/x.json', 'https://docs.walletwall.org/home/overview']) assert.equal(localPathIn(fine, []), null, fine);
    assert.equal(localPathIn('built under d:/work/checkout', ['d:/work/checkout']), 'a Windows drive path');
  });

  test('each secret shape is caught and named', () => {
    for (const [what, value] of CREDENTIAL_SAMPLES) assert.equal(credentialPatternIn(`prefix ${value} suffix`), what, value.slice(0, 6));
  });

  test('content hashes, versions, URLs, and ordinary words about tokens and secrets are not secrets', () => {
    for (const fine of [
      'f8124e59dab3bcf578f62db4cbe20fec12be7ee78e3a13701df45d6bc0118a1a',
      'e4e6286a4fb0b3ab1a8e5cdb4ff7d9f02cdc2bd3',
      '4.6.0 NVIDIA 616.56',
      'https://docs.walletwall.org/concepts/migration-readiness',
      'Token approvals: review each token: approved spenders can move funds.',
      'The secret is that risk-assessment matters. Bearer bonds. sk-short',
      'NVIDIA GeForce RTX 5080/PCIe/SSE2',
    ]) {
      assert.equal(credentialPatternIn(fine), null, fine);
    }
  });

  test("this machine's names are whole words of three characters or more; generic CI identities are not names", () => {
    assert.deepEqual(machineNames(['Render-Host-7', 'runner', 'ab', undefined, 'root', 'example-user', 'Render-Host-7']), ['example-user', 'render-host-7']);
    assert.equal(machineNameIn('rendered on RENDER-HOST-7 today', ['render-host-7']), true);
    assert.equal(machineNameIn('render-host-77', ['render-host-7']), false);
    assert.equal(machineNameIn('xrender-host-7', ['render-host-7']), false);
  });

  test("a host's own label, the words of a user name, and non-ASCII names count too", () => {
    assert.deepEqual(machineNames(['build-07.corp.example.com', 'Jane Doe', 'Zoë']), ['build-07', 'build-07.corp.example.com', 'doe', 'jane', 'zoë']);
    assert.equal(machineNameIn('made by Zoë', ['zoë']), true);
    assert.equal(machineNameIn('Zoëy', ['zoë']), false);
    assert.equal(machineNameIn('rendered on build-07 overnight', ['build-07']), true);
  });
});

describe('the public-output gate applies the shared policy', () => {
  const area = scratchArea('leak-policy');
  after(area.cleanup);
  let state: PublicState;
  let clean: string;
  before(async () => {
    const real = await currentPublicState(VIDEO_ID, {});
    // A fixed pair of machine names, so the tests do not depend on the machine that runs them.
    state = { ...real, machineNames: ['render-host-7', 'example-user'] };
    clean = area.dir('clean');
    await writeDryRunPackage(clean);
  });
  const variant = (label: string, change: (d: string) => void): string => {
    const dir = area.dir(label);
    cpSync(clean, dir, { recursive: true });
    change(dir);
    return dir;
  };
  const codes = (dir: string, s: PublicState = state): PublicOutputCode[] => checkPublicOutput(dir, s, { requireRender: true }).report.findings.map((f) => f.code);
  const findings = (dir: string) => checkPublicOutput(dir, state, { requireRender: true }).report.findings;

  test('negative control: a consistent render from the production class passes', () => {
    const dir = variant('render-clean', (d) => attachRender(d, state));
    assert.deepEqual(findings(dir).map((f) => `${f.code} ${f.path}: ${f.message}`), []);
  });

  test('a secret-shaped value in the publish manifest is refused, and the value is not printed', () => {
    const sample = CREDENTIAL_SAMPLES[1]![1];
    const dir = variant('secret-manifest', (d) => {
      attachRender(d, state);
      editJson<{ snippet: { description: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.description += `\n${sample}`));
    });
    const f = findings(dir);
    assert.ok(f.some((x) => x.code === 'SECRET_SHAPED'), f.map((x) => x.code).join(', '));
    assert.ok(!JSON.stringify(f).includes(sample));
  });

  test('a secret-shaped value in the MP4 metadata is refused', () => {
    const dir = variant('secret-mp4', (d) => attachRender(d, state, { bytes: mp4('frames', `encoder ${CREDENTIAL_SAMPLES[2]![1]}`) }));
    assert.ok(codes(dir).includes('SECRET_SHAPED'));
  });

  test("this machine's host name in a render record is refused (MACHINE_NAME), and the name is not printed", () => {
    const dir = variant('host-render', (d) => {
      attachRender(d, state);
      editJson<{ overlays: Record<string, unknown> }>(path.join(d, 'render.json'), (r) => (r.overlays.note = 'rendered on RENDER-HOST-7'));
    });
    const f = findings(dir);
    assert.ok(f.some((x) => x.code === 'MACHINE_NAME'), f.map((x) => x.code).join(', '));
    assert.ok(!JSON.stringify(f).toLowerCase().includes('render-host-7'));
  });

  test("this machine's user name in the MP4 metadata is refused", () => {
    assert.ok(codes(variant('user-mp4', (d) => attachRender(d, state, { bytes: mp4('frames', 'Lavf61.7.100 example-user') }))).includes('MACHINE_NAME'));
  });

  test('authored copy is not scanned for machine names: a word of the narration may equal a host name', () => {
    // "urgent" is spoken (the captions and the description carry it); nothing that records machine facts does.
    const dir = variant('copy-word', (d) => attachRender(d, state));
    passesWith(dir, { ...state, machineNames: ['urgent'] });
  });

  test("a host name that is a word of this repository's committed vocabulary is not a leak signal", () => {
    // A host named like the video, an approved GPU vendor, or the engine cannot be told apart from the records themselves.
    assert.deepEqual(machineNames(['migration', 'nvidia', 'typescript', 'render-host-7'], publicVocabulary()), ['render-host-7']);
  });

  test('a render environment with an unknown field is refused, and the finding names the field', () => {
    const evidence = characterEvidence(state);
    const record = { ...ENVIRONMENTS['production-rtx5080'], hostname: 'render-farm' };
    evidence.character.sequence.environment = environmentRecord(record) as never;
    const f = findings(variant('env-unknown-field', (d) => attachRender(d, state, { character: evidence.character })));
    const env = f.filter((x) => x.code === 'RENDER_ENVIRONMENT_UNAPPROVED');
    assert.equal(env.length, 1, f.map((x) => `${x.code} ${x.message}`).join('\n'));
    assert.match(env[0]!.message, /\$\.hostname: unknown field/);
  });

  test('a render from a new driver is refused with a diff naming the driver', () => {
    const evidence = characterEvidence(state, 'typescript', 'new-driver');
    const f = findings(variant('env-new-driver', (d) => attachRender(d, state, { character: evidence.character })));
    const env = f.filter((x) => x.code === 'RENDER_ENVIRONMENT_UNAPPROVED');
    assert.ok(env.length >= 1);
    assert.match(env[0]!.message, /nearest approved class production-rtx5080 \(publication\); changed: driver 4\.6\.0 NVIDIA 616\.56 -> 4\.6\.0 NVIDIA 620\.10/);
  });

  test('a recorded class that is not a plain id or name is refused without being echoed', () => {
    const evidence = characterEvidence(state, 'typescript', 'new-driver');
    evidence.character.sequence.environment = { ...evidence.character.sequence.environment, classId: 'C:\\Users\\example\\class', approvedClass: '/home/example/prod' } as never;
    const f = findings(variant('env-odd-labels', (d) => attachRender(d, state, { character: evidence.character })));
    const env = f.filter((x) => x.code === 'RENDER_ENVIRONMENT_UNAPPROVED');
    assert.ok(env.length >= 1);
    for (const x of env) assert.ok(!/Users|home/.test(x.message), x.message);
  });

  test('a forged publication class label on a new driver is refused', () => {
    const evidence = characterEvidence(state, 'typescript', 'new-driver');
    const forged = { ...evidence.character.sequence.environment, approvedClass: 'production-rtx5080', purpose: 'publication' };
    evidence.character.sequence.environment = forged as never;
    assert.ok(codes(variant('env-forged', (d) => attachRender(d, state, { character: evidence.character }))).includes('RENDER_ENVIRONMENT_UNAPPROVED'));
  });

  test('the review bundle refuses a report that would name this machine', () => {
    const dir = variant('bundle', (d) => attachRender(d, state));
    const result = checkPublicOutput(dir, state, { requireRender: true });
    assert.equal(result.report.ok, true);
    const tainted = { ...result, report: { ...result.report, summary: { ...result.report.summary, title: `made on ${state.machineNames[0]}` } } };
    assert.throws(() => writeReviewBundle(tainted, path.join(area.dir('bundle-out'), 'out'), state.machineNames), /this machine/);
  });

  function passesWith(dir: string, s: PublicState): void {
    const { report } = checkPublicOutput(dir, s, { requireRender: true });
    assert.deepEqual(report.findings.map((f) => `${f.code} ${f.path}: ${f.message}`), []);
  }
});
