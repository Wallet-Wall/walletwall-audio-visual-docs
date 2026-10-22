// The publication proof receipt (src/publish/proof-receipt.ts, scripts/publication-receipt.ts). Each case starts from
// a passed proof package (the public-output gate's bundle plus Blender's and the invariants' records) and changes ONE
// thing; the receipt must refuse it, or, for a forger who recomputes the receipt's hash, the verifier must. No
// Blender, GPU, network, or full render: the package is assembled in-process (test/publication-fixtures.ts).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { canonicalJson, prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { buildReceipt, receiptIdentity, RECEIPT_FILE, REQUIRED_GATES, stageEvidence, verifyReceipt, writeReceipt, type PublicationProofReceipt, type ReceiptFindingCode } from '../src/publish/proof-receipt.ts';
import { currentPublicState, type PublicState } from '../src/publish/public-output.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { INVARIANT_THRESHOLDS } from '../src/blender/invariants-policy.ts';
import { ENVIRONMENTS, editJson, environmentRecord, invariantsReport, mp4, MP4, PASSING_COUNTS, proofFixture, readJsonFile, scratchArea, VIDEO_ID, writeDryRunPackage } from './publication-fixtures.ts';

const area = scratchArea('receipt');
after(area.cleanup);
const WRITTEN_AT = '2026-10-19T12:00:00.000Z';

let state: PublicState;
let cleanPackage: string;
before(async () => {
  const real = await currentPublicState(VIDEO_ID, {});
  state = { ...real, machineNames: ['render-host-7', 'example-user'] };
  cleanPackage = area.dir('clean-package');
  await writeDryRunPackage(cleanPackage);
});

/** A passed proof with its receipt written: the receipt's path. */
function provenProof(label: string, opts: Parameters<typeof proofFixture>[4] = {}): { receiptPath: string; bundle: string } {
  const fx = proofFixture(area.dir, state, cleanPackage, label, opts);
  stageEvidence(fx.bundle, fx.sources);
  const receiptPath = writeReceipt(fx.bundle, buildReceipt(fx.bundle, state, WRITTEN_AT), state);
  return { receiptPath, bundle: fx.bundle };
}

const codes = (r: ReturnType<typeof verifyReceipt>): ReceiptFindingCode[] => r.findings.map((f) => f.code);

/** Edit a receipt on disk. `rehash`: as a forger would, recompute its identity so that only re-derivation can catch it. */
function forge(receiptPath: string, edit: (r: PublicationProofReceipt) => void, rehash = true): void {
  const r = readJsonFile<PublicationProofReceipt>(receiptPath);
  edit(r);
  if (rehash) r.receiptSha256 = receiptIdentity(r.subject);
  writeFileSync(receiptPath, prettyJson(r));
}

function refused(receiptPath: string, code: ReceiptFindingCode, opts: { receiptOnly?: boolean } = {}): void {
  const r = verifyReceipt(receiptPath, state, opts);
  assert.equal(r.ok, false, `expected ${code}, the receipt verified`);
  assert.ok(codes(r).includes(code), `expected ${code}, got ${r.findings.map((f) => `${f.code} ${f.path}: ${f.message}`).join('\n')}`);
}

describe('a passed publication proof', () => {
  test('yields a receipt that verifies, binding the video bytes, the environment, the plan, and every gate on its evidence', () => {
    const { receiptPath, bundle } = provenProof('pass');
    const r = verifyReceipt(receiptPath, state);
    assert.deepEqual(r.findings, []);
    assert.equal(r.ok, true);
    assert.equal(r.checked.package, true);
    const receipt = readJsonFile<PublicationProofReceipt>(receiptPath);
    assert.equal(receipt.schema, 'walletwall.publication-proof-receipt/v2');
    assert.equal(receipt.subject.video.file.sha256, sha256Hex(readFileSync(path.join(bundle, VIDEO_ID, MP4))));
    assert.equal(receipt.subject.renderEnvironment.approvedClass, 'production-rtx5080');
    assert.equal(receipt.subject.renderEnvironment.purpose, 'publication');
    assert.deepEqual(receipt.subject.renderEnvironment.record, ENVIRONMENTS['production-rtx5080']);
    assert.deepEqual(receipt.subject.gates.map((g) => g.gate), [...REQUIRED_GATES]);
    const listed = new Set(receipt.subject.files.map((f) => f.path));
    for (const g of receipt.subject.gates) {
      assert.equal(g.result, 'PASS');
      assert.ok(g.evidence.length > 0, `${g.gate} names its evidence`);
      for (const e of g.evidence) assert.ok(listed.has(e), `${g.gate}: ${e} is a bound file`);
    }
    // Every file of the package is bound, and nothing else is in it but the receipt.
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(bundle, path.join(d, e.name)).split(path.sep).join('/')]));
    assert.deepEqual(walk(bundle).filter((f) => f !== RECEIPT_FILE).sort(), [...listed].sort());
  });

  test('the receipt holds no local path, secret, timing, or machine name', () => {
    const { receiptPath } = provenProof('clean-text');
    const text = readFileSync(receiptPath, 'utf8');
    for (const root of [VIDEO_ROOT, area.dir('probe')]) assert.ok(!text.toLowerCase().includes(root.toLowerCase()) && !text.toLowerCase().includes(root.split(path.sep).join('/').toLowerCase()));
    assert.ok(!/"(?:ms|seconds|firstShotMs)"/.test(text), 'no render timings');
    assert.ok(!text.includes('render-host-7') && !text.includes('example-user'));
  });
});

describe('receipt identity', () => {
  test('is deterministic: the same package gives the same identity, whenever it is written and whatever the key order', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'determinism');
    stageEvidence(fx.bundle, fx.sources);
    const a = buildReceipt(fx.bundle, state, '2026-10-19T12:00:00.000Z');
    const b = buildReceipt(fx.bundle, state, '2031-01-01T00:00:00.000Z');
    assert.equal(a.receiptSha256, b.receiptSha256);
    assert.notEqual(a.informational.writtenAt, b.informational.writtenAt);
    // The same subject with every object's keys in reverse order.
    const reversed = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v);
    const shuffled = reversed(a.subject) as typeof a.subject;
    assert.notEqual(JSON.stringify(shuffled), JSON.stringify(a.subject));
    assert.equal(receiptIdentity(shuffled), a.receiptSha256);
    assert.equal(a.receiptSha256, contentAddress({ schema: 'walletwall.publication-proof-receipt/v2', subject: a.subject }));
  });

  test('the time it was written is not part of the identity: changing it leaves a valid receipt', () => {
    const { receiptPath } = provenProof('timestamp');
    forge(receiptPath, (r) => (r.informational.writtenAt = '2040-02-29T23:59:59.000Z'), false);
    assert.deepEqual(verifyReceipt(receiptPath, state).findings, []);
  });

  test('editing any bound field after the fact breaks the identity', () => {
    const edits: [string, (r: PublicationProofReceipt) => void][] = [
      ['the video hash', (r) => (r.subject.video.file.sha256 = 'f'.repeat(64))],
      ['the class', (r) => (r.subject.renderEnvironment.classId = '0'.repeat(16))],
      ['a gate', (r) => (r.subject.gates[1]!.evidence = [])],
      ['the plan', (r) => (r.subject.motion.planSha256 = 'e'.repeat(64))],
    ];
    for (const [what, edit] of edits) {
      const { receiptPath } = provenProof(`edit-${what.replace(/\s+/g, '-')}`);
      forge(receiptPath, edit, false);
      refused(receiptPath, 'RECEIPT_IDENTITY');
    }
  });
});

describe('forged or stale receipts are refused even when their hash is recomputed', () => {
  test('an MP4 whose bytes are not the ones the receipt binds', () => {
    const { receiptPath, bundle } = provenProof('mp4');
    writeFileSync(path.join(bundle, VIDEO_ID, MP4), mp4('other frames'));
    refused(receiptPath, 'PACKAGE_INVALID');
  });

  test('another build identity', () => {
    const { receiptPath } = provenProof('build');
    forge(receiptPath, (r) => ((r.subject.build.identity as { toolchain: { node: string } }).toolchain.node = 'v0.0.0'));
    refused(receiptPath, 'CHECKOUT_MISMATCH');
  });

  test('another canonical model, or other materials', () => {
    for (const key of ['walletwallabyModelSha256', 'materialsSha256'] as const) {
      const { receiptPath } = provenProof(`model-${key}`);
      forge(receiptPath, (r) => ((r.subject.character.identity as Record<string, unknown>)[key] = 'd'.repeat(64)));
      refused(receiptPath, 'CHECKOUT_MISMATCH');
    }
  });

  test('a stale MotionPlan', () => {
    const { receiptPath } = provenProof('plan');
    forge(receiptPath, (r) => {
      r.subject.motion.planSha256 = 'c'.repeat(64);
      r.subject.character.sequence.bridgeSha256 = 'c'.repeat(64);
      (r.subject.character.identity as Record<string, unknown>).motionPlanSha256 = 'c'.repeat(64);
    });
    refused(receiptPath, 'CHECKOUT_MISMATCH');
  });

  test('a forged publication class: the class is re-derived from the environment record', () => {
    const { receiptPath } = provenProof('forged-class');
    forge(receiptPath, (r) => (r.subject.renderEnvironment.record = structuredClone(ENVIRONMENTS['new-driver']) as never));
    refused(receiptPath, 'ENVIRONMENT_NOT_PUBLICATION');
  });

  test('a record with another GPU backend under the production label is refused, with or without the package', () => {
    for (const receiptOnly of [false, true]) {
      const { receiptPath } = provenProof(`backend-${receiptOnly ? 'receipt-only' : 'package'}`);
      forge(receiptPath, (r) => ((r.subject.renderEnvironment.record as { gpu: { backend: string } }).gpu.backend = 'VULKAN'));
      assert.equal(readJsonFile<PublicationProofReceipt>(receiptPath).subject.renderEnvironment.approvedClass, 'production-rtx5080', 'the label still claims the class');
      refused(receiptPath, 'ENVIRONMENT_NOT_PUBLICATION', { receiptOnly });
    }
  });

  test('a record with another Blender build under the production label is refused, with or without the package', () => {
    for (const receiptOnly of [false, true]) {
      const { receiptPath } = provenProof(`blender-build-${receiptOnly ? 'receipt-only' : 'package'}`);
      forge(receiptPath, (r) => ((r.subject.renderEnvironment.record as { blenderBuildHash: string }).blenderBuildHash = '0123456789ab'));
      refused(receiptPath, 'ENVIRONMENT_NOT_PUBLICATION', { receiptOnly });
    }
  });

  test('checked against classes whose Blender pin disagrees with config/blender.json, a receipt is refused, naming both builds', () => {
    const { receiptPath } = provenProof('incoherent-classes');
    assert.deepEqual(verifyReceipt(receiptPath, state).findings, [], 'the control: it verifies against this checkout');
    const environments = structuredClone(state.environments);
    environments.classes[0]!.match.blender.buildHash = '0123456789ab';
    const bumped = { ...state.blenderConfig, blender: { ...state.blenderConfig.blender, version: '5.2.3', buildHash: '0123456789ab' } };
    for (const [label, s, want] of [
      ['a class qualified on another build', { ...state, environments }, /publication class "production-rtx5080" was qualified with Blender build 5\.2\.2 \(0123456789ab\), but the current pinned build is 5\.2\.2 \(d13f752e3b9c\)/],
      ['config/blender.json bumped without the classes', { ...state, blenderConfig: bumped }, /publication class "production-rtx5080" was qualified with Blender build 5\.2\.2 \(d13f752e3b9c\), but the current pinned build is 5\.2\.3 \(0123456789ab\)/],
    ] as const) {
      for (const receiptOnly of [false, true]) {
        const v = verifyReceipt(receiptPath, s, { receiptOnly });
        assert.equal(v.ok, false, label);
        const f = v.findings.find((x) => x.code === 'ENVIRONMENT_NOT_PUBLICATION');
        assert.ok(f, `${label}: ${v.findings.map((x) => `${x.code} ${x.message}`).join('\n')}`);
        assert.match(f.message, want, label);
      }
    }
  });

  test("the gate, the receipt, and both verifications classify with the state's classes, never the files on disk", () => {
    // A checkout whose production class pins the new driver: a coherent, well-formed class the classes on disk do not hold.
    const environments = structuredClone(state.environments);
    environments.classes[0]!.match.gpu.version = ENVIRONMENTS['new-driver'].gpu.version;
    const s: PublicState = { ...state, environments };
    // The fixture's package must pass the gate under `s` (it throws otherwise), and the receipt is derived under `s`.
    const fx = proofFixture(area.dir, s, cleanPackage, 'state-classes', { environment: 'new-driver' });
    stageEvidence(fx.bundle, fx.sources);
    const receiptPath = writeReceipt(fx.bundle, buildReceipt(fx.bundle, s, WRITTEN_AT), s);
    assert.equal(readJsonFile<PublicationProofReceipt>(receiptPath).subject.renderEnvironment.approvedClass, 'production-rtx5080');
    for (const receiptOnly of [false, true]) assert.deepEqual(verifyReceipt(receiptPath, s, { receiptOnly }).findings, [], `receiptOnly=${receiptOnly}`);
    // The control: under the classes on disk the same receipt is refused, so the state's classes are what decided.
    refused(receiptPath, 'ENVIRONMENT_NOT_PUBLICATION', { receiptOnly: true });
  });

  test('evidence relabelled from another machine: the package records another environment than the receipt', () => {
    const { receiptPath } = provenProof('relabel');
    forge(receiptPath, (r) => ((r.subject.renderEnvironment.record as { gpu: { deviceType: string } }).gpu.deviceType = 'NVIDIA-OTHER'));
    const v = verifyReceipt(receiptPath, state);
    assert.equal(v.ok, false);
    assert.ok(codes(v).includes('FIELD_MISMATCH') || codes(v).includes('ENVIRONMENT_NOT_PUBLICATION'), codes(v).join(', '));
  });

  test('a gate missing, out of order, or without its evidence', () => {
    const cases: [string, (r: PublicationProofReceipt) => void][] = [
      ['missing', (r) => (r.subject.gates = r.subject.gates.filter((g) => g.gate !== 'blender-invariants'))],
      ['reordered', (r) => r.subject.gates.reverse()],
      ['no evidence', (r) => (r.subject.gates[0]!.evidence = [])],
      ['unbound evidence', (r) => (r.subject.gates[0]!.evidence = ['elsewhere/validation.json'])],
    ];
    for (const [label, edit] of cases) {
      const { receiptPath } = provenProof(`gates-${label.replace(/\s+/g, '-')}`);
      forge(receiptPath, edit);
      refused(receiptPath, 'GATES_INCOMPLETE');
    }
  });

  test('an unknown field fails closed, at any depth', () => {
    for (const [label, edit] of [
      ['top', (r: PublicationProofReceipt) => ((r as unknown as Record<string, unknown>).approved = true)],
      ['subject', (r: PublicationProofReceipt) => ((r.subject as unknown as Record<string, unknown>).determinismPassed = true)],
      ['environment', (r: PublicationProofReceipt) => ((r.subject.renderEnvironment.record as unknown as Record<string, unknown>).hostname = 'render-farm')],
    ] as const) {
      const { receiptPath } = provenProof(`unknown-${label}`);
      forge(receiptPath, edit);
      refused(receiptPath, 'RECEIPT_SCHEMA');
    }
  });
});

describe('prototype-named fields', () => {
  /** Insert a raw JSON member after the first occurrence of `after` in the receipt's text (JS objects cannot hold an own __proto__ that serializes). */
  const inject = (receiptPath: string, after: string, member: string) => {
    const text = readFileSync(receiptPath, 'utf8');
    assert.ok(text.includes(after), after);
    writeFileSync(receiptPath, text.replace(after, `${after}\n  ${member},`));
  };
  test('canonical JSON keeps an own __proto__ member, so it is part of every content address', () => {
    const withProto = JSON.parse('{"__proto__": {"a": 1}, "b": 2}') as unknown;
    assert.equal(canonicalJson(withProto), '{"__proto__":{"a":1},"b":2}');
    assert.notEqual(contentAddress(withProto), contentAddress({ b: 2 }));
  });
  for (const [where, after] of [
    ['the top level', '{'],
    ['the subject', '"subject": {'],
    ['the video', '"video": {'],
    ['the build identity (compared whole)', '"identity": {'],
    ['the first bound file', '"files": [\n      {'],
    ['the informational block', '"informational": {'],
  ] as const) {
    for (const member of ['"__proto__": { "approved": true }', '"constructor": "approved"', '"toString": 1']) {
      test(`${member.split(':')[0]} in ${where} fails closed`, () => {
        const { receiptPath } = provenProof(`proto-${where.replace(/\W+/g, '-')}-${member.slice(1, 6)}`);
        inject(receiptPath, after, member);
        const v = verifyReceipt(receiptPath, state);
        assert.equal(v.ok, false, `${member} in ${where} verified`);
        const only = verifyReceipt(receiptPath, state, { receiptOnly: true });
        assert.equal(only.ok, false, `${member} in ${where} verified with --receipt-only`);
        // Named as what it is: a field outside the schema (inside a field compared whole, only __proto__ is named so;
        // any other extra member there fails as a mismatch with this checkout).
        if (member.startsWith('"__proto__"') || !where.includes('compared whole')) for (const r of [v, only]) assert.ok(codes(r).includes('RECEIPT_SCHEMA'), `${member} in ${where}: ${codes(r).join(', ')}`);
      });
    }
  }
});

describe('the receipt carries no local information', () => {
  const leaks: [string, string][] = [
    ['a Windows user path', 'C:\\Users\\example\\render.png'],
    ['a Linux home path', '/home/example/render.png'],
    ['a secret-shaped value', `gh${'p'}_${'Ab1'.repeat(12)}`],
    ["this machine's name", 'render-host-7'],
  ];
  for (const [what, value] of leaks) {
    test(`${what} is refused`, () => {
      const { receiptPath } = provenProof(`leak-${what.replace(/\W+/g, '-')}`);
      forge(receiptPath, (r) => (r.subject.remotion.compositionId = value));
      refused(receiptPath, 'RECEIPT_LEAK');
    });
  }
});

describe('no receipt for an incomplete or failed proof', () => {
  test('a gate report with findings: the receipt step re-runs the gate and refuses', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'gate-report');
    editJson<{ ok: boolean; findings: unknown[] }>(path.join(fx.bundle, 'public-output-check.json'), (rep) => ((rep.ok = false), rep.findings.push({ code: 'LOCAL_PATH', path: 'x', message: 'x' })));
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /PACKAGE_INVALID/);
  });

  test('a package the gate never passed: a forged report claiming ok does not help', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'forged-ok');
    // The package changes after the gate passed it (a new caption line); the bundled report still says ok.
    const vtt = path.join(fx.bundle, VIDEO_ID, `${VIDEO_ID}.en.vtt`);
    writeFileSync(vtt, readFileSync(vtt, 'utf8').replace('urgent', 'pressing'));
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /PACKAGE_INVALID/);
  });

  test('a bundled gate report whose summary is not the one the gate gives now', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'report-summary');
    editJson<{ summary: { title: string } }>(path.join(fx.bundle, 'public-output-check.json'), (rep) => (rep.summary.title = 'A title nobody verified'));
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /PACKAGE_INVALID[^|]*not the report the gate gives now/);
  });

  test('a bundled gate report that lists other files than the gate verifies now', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'report-files');
    editJson<{ files: unknown[] }>(path.join(fx.bundle, 'public-output-check.json'), (rep) => rep.files.pop());
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /PACKAGE_INVALID[^|]*does not list exactly the files/);
  });

  test('a sequence and a reveal rendered in two environments, even two the gate accepts', () => {
    // A field the publication class does not pin (the device type): approved by match, but another environment.
    const other = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), gpu: { ...ENVIRONMENTS['production-rtx5080'].gpu, deviceType: 'NVIDIA-2' } };
    const fx = proofFixture(area.dir, state, cleanPackage, 'two-environments', {
      character: (c) => {
        c.reveals[0]!.environment = environmentRecord(other) as never;
      },
    });
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /one publication is rendered in one environment/);
  });

  test("render.json's environment is not the one Blender recorded in its own manifest", () => {
    const other = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), gpu: { ...ENVIRONMENTS['production-rtx5080'].gpu, deviceType: 'NVIDIA-2' } };
    const fx = proofFixture(area.dir, state, cleanPackage, 'environment-swap', {
      character: (c) => {
        c.sequence.environment = environmentRecord(other) as never;
        c.reveals[0]!.environment = environmentRecord(other) as never;
      },
    });
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID[^|]*another environment than the render/);
  });

  test('a render from the proof class cannot reach a receipt: the gate refuses it first', () => {
    assert.throws(() => proofFixture(area.dir, state, cleanPackage, 'proof-class', { environment: 'proof-linux-software-gl' }), /RENDER_ENVIRONMENT_UNAPPROVED/);
  });

  test('invariants that failed, are missing, ran at another stride, on another plan, or in another environment', () => {
    const cases: [string, unknown][] = [
      ['failed', invariantsReport(state, { pass: false })],
      ['stride', invariantsReport(state, { every: 270 })],
      ['plan', invariantsReport(state, { frames: [9, 18, 27] })],
      ['environment', invariantsReport(state, { environment: 'new-driver' })],
      ['excluded', invariantsReport(state, { excludedLesson: [18] })],
      ['realization', invariantsReport(state, { realization: 'e'.repeat(64) })],
      ['schema', { ...invariantsReport(state), schema: 'walletwall.blender-invariants/v1' }],
    ];
    for (const [label, report] of cases) {
      const fx = proofFixture(area.dir, state, cleanPackage, `invariants-${label}`, { invariants: report });
      stageEvidence(fx.bundle, fx.sources);
      assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID/, label);
    }
    const missing = proofFixture(area.dir, state, cleanPackage, 'invariants-missing');
    rmSync(missing.sources.invariantsReport);
    assert.throws(() => stageEvidence(missing.bundle, missing.sources), /invariants/);
  });

  test("invariants judged against another bar than this checkout's: a looser or extra threshold, too little coverage, the tail released too often", () => {
    const cases: [string, unknown][] = [
      ['looser', invariantsReport(state, { thresholds: { ...INVARIANT_THRESHOLDS, footPx: 0.5 } })],
      ['extra', invariantsReport(state, { thresholds: { ...INVARIANT_THRESHOLDS, ignoredPx: 1 } })],
      ['coverage', invariantsReport(state, { counts: { ...PASSING_COUNTS, 'lesson.grounded': 10 } })],
      ['tail', invariantsReport(state, { counts: { ...PASSING_COUNTS, 'lesson.heldClear': 40 } })],
    ];
    for (const [label, report] of cases) {
      const fx = proofFixture(area.dir, state, cleanPackage, `bar-${label}`, { invariants: report });
      stageEvidence(fx.bundle, fx.sources);
      assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID/, label);
    }
  });

  test('a rust-wasm proof binds invariants measured on its own plan; invariants of the TypeScript plan are refused', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'rust', { engine: 'rust-wasm' });
    stageEvidence(fx.bundle, fx.sources);
    const receipt = buildReceipt(fx.bundle, state, WRITTEN_AT);
    assert.equal(receipt.subject.motion.engine.motionEngine, 'rust-wasm');
    assert.equal(receipt.subject.invariants.motionEngine, 'rust-wasm');
    const written = writeReceipt(fx.bundle, receipt, state);
    assert.deepEqual(verifyReceipt(written, state).findings, []);
    const mixed = proofFixture(area.dir, state, cleanPackage, 'rust-ts-invariants', { engine: 'rust-wasm', invariants: invariantsReport(state, { engine: 'typescript' }) });
    stageEvidence(mixed.bundle, mixed.sources);
    assert.throws(() => buildReceipt(mixed.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID[^|]*typescript/);
  });

  test("Blender's evidence must be exactly the frames and crops this checkout's plan decides", () => {
    // Internally consistent (render.json names this manifest's content), but only three of the plan's frames.
    const fx = proofFixture(area.dir, state, cleanPackage, 'truncated', { truncateShots: true });
    stageEvidence(fx.bundle, fx.sources);
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID[^|]*frames and crops/);
  });

  test('a shot in the evidence carries nothing but its name, frame, hash, crop, and contact error (no timings ride along)', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'shot-extra');
    stageEvidence(fx.bundle, fx.sources);
    editJson<{ shots: Record<string, unknown>[] }>(path.join(fx.bundle, 'evidence', 'blender', `${fx.evidence.character.sequence.name}.json`), (d) => (d.shots[0]!.ms = 191.3));
    assert.throws(() => buildReceipt(fx.bundle, state, WRITTEN_AT), /EVIDENCE_INVALID/);
  });

  test("Blender's manifest is not the one the render recorded", () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'manifest');
    const name = fx.evidence.character.sequence.name;
    editJson<{ shots: { sha256: string }[] }>(fx.sources.blenderManifest(name), (m) => (m.shots[0]!.sha256 = '9'.repeat(64)));
    assert.throws(() => stageEvidence(fx.bundle, fx.sources), /EVIDENCE_INVALID|not the render/);
  });

  test('a file in the package that the receipt does not bind', () => {
    const { receiptPath, bundle } = provenProof('extra-file');
    writeFileSync(path.join(bundle, VIDEO_ID, 'notes.txt'), 'left over');
    refused(receiptPath, 'PACKAGE_INVALID');
  });

  test('a receipt is verified before it is published: one that does not verify is never written, not even as a temporary file', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'unverified');
    stageEvidence(fx.bundle, fx.sources);
    const receipt = buildReceipt(fx.bundle, state, WRITTEN_AT);
    // The package changes between the receipt's derivation and its write.
    editJson<{ cues: { reason?: string }[] }>(path.join(fx.bundle, VIDEO_ID, 'cue-sheet.json'), (c) => (c.cues[0]!.reason = 'edited after the proof'));
    assert.throws(() => writeReceipt(fx.bundle, receipt, state), /does not verify, so it was not written/);
    assert.equal(existsSync(path.join(fx.bundle, RECEIPT_FILE)), false);
    assert.deepEqual(readdirSync(fx.bundle).filter((f) => f.includes('receipt')), [], 'no temporary or partial receipt either');
  });

  test('a verification that throws leaves no receipt behind either', () => {
    const fx = proofFixture(area.dir, state, cleanPackage, 'throws');
    stageEvidence(fx.bundle, fx.sources);
    const receipt = buildReceipt(fx.bundle, state, WRITTEN_AT);
    const broken: PublicState = { ...state, lesson: () => { throw new Error('the plan cannot be solved here'); } };
    assert.throws(() => writeReceipt(fx.bundle, receipt, broken), /cannot be solved/);
    assert.deepEqual(readdirSync(fx.bundle).filter((f) => f.includes('receipt')), []);
  });

  test('a receipt is written only once, and never over an existing one', () => {
    const { receiptPath, bundle } = provenProof('once');
    const again = buildReceipt(bundle, state, WRITTEN_AT);
    assert.throws(() => writeReceipt(bundle, again, state), /already/);
    assert.ok(existsSync(receiptPath));
  });
});

describe('verifying without the package', () => {
  test('checks everything this checkout can derive, and says the package was not checked', () => {
    const { receiptPath } = provenProof('receipt-only');
    const alone = path.join(area.dir('receipt-alone'), RECEIPT_FILE);
    cpSync(receiptPath, alone);
    const strict = verifyReceipt(alone, state);
    assert.equal(strict.ok, false, 'without its package a receipt does not verify unless asked to verify it alone');
    const r = verifyReceipt(alone, state, { receiptOnly: true });
    assert.deepEqual(r.findings, []);
    assert.equal(r.checked.package, false);
    // A forged plan is still caught from the checkout alone.
    forge(alone, (x) => ((x.subject.motion.planSha256 = 'c'.repeat(64)), (x.subject.character.sequence.bridgeSha256 = 'c'.repeat(64))));
    refused(alone, 'CHECKOUT_MISMATCH', { receiptOnly: true });
  });

  test('frame counts and the narration are derived from the checkout too', () => {
    for (const [label, edit] of [
      ['sequence frames', (x: PublicationProofReceipt) => (x.subject.character.sequence.frames -= 1)],
      ['reveal frames', (x: PublicationProofReceipt) => (x.subject.character.reveals[0]!.frames += 1)],
      ['estimated', (x: PublicationProofReceipt) => (x.subject.narration.estimated = false)],
    ] as const) {
      const { receiptPath } = provenProof(`receipt-only-${label.replace(/\s+/g, '-')}`);
      const alone = path.join(area.dir(`alone-${label.replace(/\s+/g, '-')}`), RECEIPT_FILE);
      cpSync(receiptPath, alone);
      forge(alone, edit);
      refused(alone, 'CHECKOUT_MISMATCH', { receiptOnly: true });
    }
  });
});

describe('the receipt CLI', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(VIDEO_ROOT, 'scripts', 'publication-receipt.ts'), ...args], { cwd: VIDEO_ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } });

  test('verify exits 0 for a valid receipt and 1 for a tampered one; an unknown option is a usage error', () => {
    const { receiptPath } = provenProof('cli');
    const ok = cli('verify', receiptPath);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /PASS/);
    forge(receiptPath, (r) => (r.subject.video.file.sha256 = 'f'.repeat(64)), false);
    const bad = cli('verify', receiptPath);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /RECEIPT_IDENTITY/);
    assert.equal(cli('verify', receiptPath, '--trust-me').status, 2);
    assert.equal(cli('approve', receiptPath).status, 2);
  });

  test('write refuses a proof package outside dist/ as a usage error and writes nothing', () => {
    const dir = area.dir('outside-dist');
    const r = cli('write', `--bundle=${dir}`);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /inside dist/);
    assert.deepEqual(readdirSync(dir), []);
  });
});
