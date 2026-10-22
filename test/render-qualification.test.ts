// Production render host qualification (src/blender/qualification.ts, scripts/blender-qualify.ts): the verdict over
// a qualification's evidence, the shared pixel-equivalence measure, and the guarantees that qualification never
// approves anything and never lowers the bar. No Blender, GPU, or network: the evidence below is what the tool reads
// from a real run (proof.json records, the invariants report, the reference), written by hand.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { measureEquivalence, withinTolerance } from '../src/blender/equivalence.ts';
import { classifyEnvironment, environmentsDocumentProblems } from '../src/blender/environment.ts';
import { loadEnvironments, type RenderEnvironment } from '../src/blender/identity.ts';
import { decideQualification, formatQualification, QUALIFICATION_SCHEMA, unlistedSteps, writeQualificationRecord, writesOutsideRecordWriter, type QualificationInputs, type ProofRun } from '../src/blender/qualification.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';
import { BLENDER_CHARACTER } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { canonicalJson } from '../src/core/canonical-json.ts';
import { INVARIANT_THRESHOLDS } from '../src/blender/invariants-policy.ts';
import { ENVIRONMENTS, PASSING_COUNTS, scratchArea } from './publication-fixtures.ts';

const area = scratchArea('qualification');
after(area.cleanup);
const cfg = loadBlenderConfig();
const environments = loadEnvironments();
const reference = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'blender', 'proof', 'reference', 'proof.json'), 'utf8')) as ProofRun & { environment: RenderEnvironment };

/** Deep-freeze: any attempt by the decision to change its inputs throws (modules are strict). */
function frozen<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) frozen(x);
    Object.freeze(v);
  }
  return v;
}

/** A proof run as scripts/blender-proof.ts records it, in `environment`, with the reference's frames unless changed. */
const run = (environment: RenderEnvironment, sha: (role: string, refSha: string) => string = (_r, s) => s): ProofRun => ({
  ...structuredClone(reference),
  environment: structuredClone(environment),
  roles: reference.roles.map((r) => ({ ...r, sha256: sha(r.role, r.sha256) })),
});

const PINS = { environmentsSha256: 'a'.repeat(64), referenceSha256: 'b'.repeat(64), blenderConfigSha256: 'c'.repeat(64), characterPinsSha256: 'd'.repeat(64) };

/** The invariants report of a passing publication-stride run in `env`, as qualification reads it (PASSING_COUNTS' 786 frames: 575 lesson frames at the stride and 211 lab frames). */
const invariantsOf = (env: unknown) => ({ pass: true, every: 9, labEvery: 1, failureCount: 0, thresholds: { ...INVARIANT_THRESHOLDS }, counts: { ...PASSING_COUNTS }, lessonFrames: Array.from({ length: 575 }, (_, i) => i * 9), environment: structuredClone(env) });

/** The evidence of a clean qualification on the production host itself (nothing changed). */
function inputs(over: Partial<QualificationInputs> = {}, env: RenderEnvironment = ENVIRONMENTS['production-rtx5080']): QualificationInputs {
  const build = { modelVersion: BLENDER_CHARACTER.modelVersion, modelSha256: BLENDER_CHARACTER.modelSha256, materialsVersion: BLENDER_CHARACTER.materialsVersion, materialsSha256: BLENDER_CHARACTER.materialsSha256, realizationSha256: reference.realizationSha256 };
  return frozen({
    environments: structuredClone(environments),
    cfg,
    pins: { before: PINS, after: PINS },
    blender: { pinned: { version: cfg.blender.version, buildHash: cfg.blender.buildHash }, observed: { version: cfg.blender.version, buildHash: cfg.blender.buildHash } },
    character: { modelVersion: BLENDER_CHARACTER.modelVersion, modelSha256: BLENDER_CHARACTER.modelSha256, materialsVersion: BLENDER_CHARACTER.materialsVersion, materialsSha256: BLENDER_CHARACTER.materialsSha256 },
    reference: { record: structuredClone(reference), problems: [] },
    builds: [build, { ...build }],
    runs: { a: run(env), b: run(env), problems: [] },
    versusReference: reference.roles.map((r) => ({ role: r.role, frame: r.frame, identical: true, measures: null })),
    invariants: invariantsOf(env),
    lessonStrideFrames: Array.from({ length: 575 }, (_, i) => i * 9),
    ...over,
  }) as QualificationInputs;
}

const check = (r: ReturnType<typeof decideQualification>, id: string) => r.checks.find((c) => c.id === id)!;

describe('the qualification verdict', () => {
  test('the approved production host, nothing changed: re-verified, with nothing to approve', () => {
    const r = decideQualification(inputs());
    assert.equal(r.schema, QUALIFICATION_SCHEMA);
    assert.equal(r.verdict, 'QUALIFICATION_REVERIFIED');
    assert.equal(r.environment.approvedClass, 'production-rtx5080');
    assert.ok(r.checks.every((c) => c.result === 'PASS'), JSON.stringify(r.checks));
  });

  test('a driver update whose frames equal the reference byte for byte: a candidate, never an approval', () => {
    const r = decideQualification(inputs({}, ENVIRONMENTS['new-driver']));
    assert.equal(r.verdict, 'QUALIFICATION_CANDIDATE_PASS');
    assert.equal(r.environment.status, 'UNAPPROVED');
    assert.deepEqual(r.environment.changed, ['driver']);
    assert.match(r.environment.diff!, /changed:\n {2}driver/);
    assert.equal(r.approval, 'NONE: approval is a reviewed change to config/blender-environments.json');
    assert.ok(r.nextSteps.some((s) => /byte-identical to the approved reference/.test(s)));
    assert.ok(r.nextSteps.some((s) => /not applied/.test(s)), 'the proposal is text for review, never applied');
    assert.match(formatQualification(r), /QUALIFICATION_CANDIDATE_PASS/);
    assert.match(formatQualification(r), /This tool approves nothing/);
  });

  test('a driver update whose frames differ from the reference within the pinned tolerance: a candidate that needs a new reference to be THE production class', () => {
    const versus = reference.roles.map((x, i) => ({ role: x.role, frame: x.frame, identical: i !== 2, measures: i === 2 ? { fractionOverNoise: 0.00002, meanAbsDelta: 0.0004, coverageDeltaPx: 0, maxDelta: 9 } : null }));
    const r = decideQualification(inputs({ versusReference: versus }, ENVIRONMENTS['new-driver']));
    assert.equal(r.verdict, 'QUALIFICATION_CANDIDATE_PASS');
    assert.ok(r.nextSteps.some((s) => /export-reference/.test(s)));
  });

  test('a reveal frame over the pinned scene tolerance fails, stating the measure and the unchanged maximum', () => {
    const peak = reference.roles.find((x) => x.role === 'transition-peak')!;
    const versus = reference.roles.map((x) => ({ role: x.role, frame: x.frame, identical: x !== peak, measures: x === peak ? { fractionOverNoise: 0.0057, meanAbsDelta: 0.05, coverageDeltaPx: 0, maxDelta: 15 } : null }));
    const r = decideQualification(inputs({ versusReference: versus }, ENVIRONMENTS['new-driver']));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.match(check(r, 'versus-reference').detail, /transition-peak \(frame 1690\): changed fraction 0\.570% > approved maximum 0\.500%/);
    assert.ok(r.nextSteps.some((s) => /Do not raise a tolerance/.test(s)));
  });

  test('a breach of the tight character tolerance is stated with enough digits to see it', () => {
    const idle = reference.roles.find((x) => x.role === 'idle')!;
    const versus = reference.roles.map((x) => ({ role: x.role, frame: x.frame, identical: x !== idle, measures: x === idle ? { fractionOverNoise: 0.00012, meanAbsDelta: 0.0001, coverageDeltaPx: 0, maxDelta: 4 } : null }));
    const r = decideQualification(inputs({ versusReference: versus }, ENVIRONMENTS['new-driver']));
    assert.match(check(r, 'versus-reference').detail, /idle \(frame 39\): changed fraction 0\.0120% > approved maximum 0\.0100%/);
  });

  test('the approved class itself must reproduce the reference byte for byte: within tolerance is not enough', () => {
    const versus = reference.roles.map((x, i) => ({ role: x.role, frame: x.frame, identical: i !== 0, measures: i === 0 ? { fractionOverNoise: 0.000001, meanAbsDelta: 0.00001, coverageDeltaPx: 0, maxDelta: 1 } : null }));
    const r = decideQualification(inputs({ versusReference: versus }));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.match(check(r, 'versus-reference').detail, /same class .* byte-identical/);
  });

  test('two runs in this environment that differ by one frame fail same-class determinism', () => {
    const r = decideQualification(inputs({ runs: { a: run(ENVIRONMENTS['new-driver']), b: run(ENVIRONMENTS['new-driver'], (role, s) => (role === 'perch' ? 'f'.repeat(64) : s)), problems: [] } }, ENVIRONMENTS['new-driver']));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.equal(check(r, 'same-class-repeat').result, 'FAIL');
    assert.match(check(r, 'same-class-repeat').detail, /perch/);
  });

  test('a build whose canonical model or materials are not the pinned ones fails', () => {
    const base = inputs();
    const r = decideQualification(inputs({ builds: [base.builds[0]!, { ...base.builds[1]!, materialsSha256: 'd'.repeat(64) }] }));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.equal(check(r, 'character-pinned').result, 'FAIL');
  });

  test('failed invariants, invariants at another stride or from another environment, or judged against a looser bar, fail', () => {
    const rtx = ENVIRONMENTS['production-rtx5080'];
    for (const [label, invariants] of [
      ['failed', { ...invariantsOf(rtx), pass: false, failureCount: 3 }],
      ['stride', { ...invariantsOf(rtx), every: 270, labEvery: 6 }],
      ['environment', invariantsOf(ENVIRONMENTS['new-driver'])],
      ['looser threshold', { ...invariantsOf(rtx), thresholds: { ...INVARIANT_THRESHOLDS, footPx: 0.5 } }],
      ['too little coverage', { ...invariantsOf(rtx), counts: { ...PASSING_COUNTS, 'lab.hang': 0 } }],
      ['no lesson frames named', { ...invariantsOf(rtx), lessonFrames: undefined }],
      ['fewer lesson frames named than it counts', { ...invariantsOf(rtx), lessonFrames: Array.from({ length: 300 }, (_, i) => i * 9) }],
      // Self-consistent counts that clear the fractions on their own: only the plan's own stride frames refuse them.
      ['lesson frames other than the stride frames of the plan', { ...invariantsOf(rtx), lessonFrames: Array.from({ length: 400 }, (_, i) => i * 9), counts: { ...PASSING_COUNTS, 'lesson.grounded': 300, 'lesson.sceneHolds': 220, 'lesson.supportedHolds': 210 } }],
    ] as const) {
      const r = decideQualification(inputs({ invariants }));
      assert.equal(r.verdict, 'QUALIFICATION_FAIL', label);
      assert.equal(check(r, 'contacts-and-invariants').result, 'FAIL', label);
    }
  });

  test('an approved host in the reference\'s class by name but another class id (a field the class does not pin changed) must still be byte-identical', () => {
    // The device type is the one GPU field no class pins (Blender derives it from the vendor).
    const drifted = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), gpu: { ...ENVIRONMENTS['production-rtx5080'].gpu, deviceType: 'UNKNOWN' } } as RenderEnvironment;
    // Byte-identical to the reference: the unpinned field changed nothing this proof can see.
    assert.equal(decideQualification(inputs({}, drifted)).verdict, 'QUALIFICATION_REVERIFIED');
    // Within the cross-class tolerance, but not identical: the approved class no longer reproduces its own reference.
    const versus = reference.roles.map((x, i) => ({ role: x.role, frame: x.frame, identical: i !== 0, measures: i === 0 ? { fractionOverNoise: 0.000001, meanAbsDelta: 0.00001, coverageDeltaPx: 0, maxDelta: 1 } : null }));
    const r = decideQualification(inputs({ versusReference: versus }, drifted));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.match(check(r, 'versus-reference').detail, /production-rtx5080.*gpu device type/);
  });

  test('another GPU backend is never re-verified, even byte-identical to the reference: a candidate at best', () => {
    const vulkan = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), gpu: { ...ENVIRONMENTS['production-rtx5080'].gpu, backend: 'VULKAN' } } as RenderEnvironment;
    const identical = decideQualification(inputs({}, vulkan));
    assert.equal(identical.verdict, 'QUALIFICATION_CANDIDATE_PASS');
    assert.equal(identical.environment.status, 'UNAPPROVED');
    assert.equal(identical.environment.approvedClass, null);
    assert.deepEqual(identical.environment.changed, ['gpu backend']);
    assert.match(identical.environment.diff!, /changed:\n {2}gpu backend/);
    // Within the cross-class tolerance: still a candidate, which would also need a new reference.
    const versus = reference.roles.map((x, i) => ({ role: x.role, frame: x.frame, identical: i !== 0, measures: i === 0 ? { fractionOverNoise: 0.000001, meanAbsDelta: 0.00001, coverageDeltaPx: 0, maxDelta: 1 } : null }));
    assert.equal(decideQualification(inputs({ versusReference: versus }, vulkan)).verdict, 'QUALIFICATION_CANDIDATE_PASS');
    // Over it: a failure.
    const over = reference.roles.map((x, i) => ({ role: x.role, frame: x.frame, identical: i !== 0, measures: i === 0 ? { fractionOverNoise: 0.01, meanAbsDelta: 0.01, coverageDeltaPx: 3, maxDelta: 40 } : null }));
    assert.equal(decideQualification(inputs({ versusReference: over }, vulkan)).verdict, 'QUALIFICATION_FAIL');
  });

  test("an invalid class name never reaches qualification's record or its text", () => {
    const doc = structuredClone(environments) as unknown as { classes: { name: string }[] };
    doc.classes[0]!.name = 'C:\\Users\\example\\class';
    const r = decideQualification(inputs({ environments: doc as never }, ENVIRONMENTS['new-driver']));
    assert.equal(r.environment.nearest, '(not a class name)');
    assert.ok(!JSON.stringify(r).includes('example'), JSON.stringify(r.environment));
    assert.ok(!formatQualification(r).includes('example'));
  });

  test('the candidate proposal is a class in the shape the classes document requires, pinning the backend and the Blender build', () => {
    const r = decideQualification(inputs({}, ENVIRONMENTS['new-driver']));
    const line = r.nextSteps.find((s) => s.startsWith('Proposal for that review'))!;
    const proposal = JSON.parse(line.slice(line.indexOf('{'))) as { name: string; match: { blender: unknown; gpu: { backend: string } } };
    assert.deepEqual(proposal.match.blender, { version: cfg.blender.version, buildHash: cfg.blender.buildHash });
    assert.equal(proposal.match.gpu.backend, 'OPENGL');
    proposal.name = 'production-rtx5080-new-driver';
    const doc = { ...structuredClone(environments), classes: [...structuredClone(environments.classes), proposal] };
    assert.deepEqual(environmentsDocumentProblems(doc), []);
    assert.equal(classifyEnvironment(ENVIRONMENTS['new-driver'], cfg, doc as never).approvedClass?.name, 'production-rtx5080-new-driver');
  });

  test('a proof run that covers other frames than the reference, or fewer, fails rather than shrinking the comparison', () => {
    const missing = run(ENVIRONMENTS['production-rtx5080']);
    missing.roles = missing.roles.filter((x) => x.role !== 'perch');
    const r = decideQualification(inputs({ runs: { a: missing, b: structuredClone(missing), problems: [] }, versusReference: reference.roles.filter((x) => x.role !== 'perch').map((x) => ({ role: x.role, frame: x.frame, identical: true, measures: null })) }));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.match(check(r, 'versus-reference').detail, /perch/);
    const moved = run(ENVIRONMENTS['production-rtx5080']);
    moved.roles[0] = { ...moved.roles[0]!, frame: moved.roles[0]!.frame + 1 };
    const m = decideQualification(inputs({ runs: { a: moved, b: structuredClone(moved), problems: [] } }));
    assert.equal(m.verdict, 'QUALIFICATION_FAIL');
    assert.match(check(m, 'versus-reference').detail, /another frame or crop/);
  });

  test('an installed Blender that is not the pinned build blocks qualification before anything renders, and says what changed', () => {
    const r = decideQualification(inputs({ blender: { pinned: { version: cfg.blender.version, buildHash: cfg.blender.buildHash }, observed: { version: '5.2.3', buildHash: '0123456789ab' } }, runs: { a: null, b: null, problems: [] }, builds: [], versusReference: null, invariants: null }));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.deepEqual(r.environment.changed, ['blender version', 'blender build']);
    assert.match(r.environment.diff!, /approved:\n {2}blender version: 5\.2\.2\n {2}blender build: d13f752e3b9c\nobserved:\n {2}blender version: 5\.2\.3\n {2}blender build: 0123456789ab\nchanged:\n {2}blender version\n {2}blender build$/);
    assert.ok(r.nextSteps.some((s) => /config\/blender\.json/.test(s)));
    assert.equal(check(r, 'same-class-repeat').result, 'NOT_RUN');
  });

  test('a render that records another Blender build than the pinned one blocks, even when the installed build probes as pinned', () => {
    const unpinned = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), blenderVersion: '5.2.3 LTS', blenderBuildHash: '0123456789ab' } as RenderEnvironment;
    const r = decideQualification(inputs({}, unpinned));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.equal(check(r, 'blender-pinned').result, 'PASS');
    assert.equal(check(r, 'environment').result, 'BLOCKED');
    assert.match(check(r, 'environment').detail, /rendered with Blender 5\.2\.3 \(0123456789ab\), not the pinned 5\.2\.2 \(d13f752e3b9c\): an unpinned build is never qualified/);
    assert.ok(r.nextSteps.some((s) => /every class's Blender pin/.test(s)));
    // A build hash alone is enough.
    assert.equal(decideQualification(inputs({}, { ...unpinned, blenderVersion: '5.2.2 LTS' })).verdict, 'QUALIFICATION_BLOCKED');
  });

  test('classes qualified on another Blender build than config/blender.json pins block, naming both builds; nothing is repaired', () => {
    const doc = structuredClone(environments) as unknown as { classes: { match: { blender: { buildHash: string } } }[] };
    doc.classes[0]!.match.blender.buildHash = '0123456789ab';
    const r = decideQualification(inputs({ environments: doc as never }));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.equal(check(r, 'class-blender-pins').result, 'BLOCKED');
    assert.match(check(r, 'class-blender-pins').detail, /publication class "production-rtx5080" was qualified with Blender build 5\.2\.2 \(0123456789ab\), but the current pinned build is 5\.2\.2 \(d13f752e3b9c\)/);
    assert.equal(r.environment.approvedClass, null, 'an incoherent class approves nothing');
    assert.ok(r.nextSteps.some((s) => /they must agree/.test(s) && /never edits a class/.test(s)));
    assert.equal(r.approval, 'NONE: approval is a reviewed change to config/blender-environments.json');
    // A reviewed bump of config/blender.json without the classes (and with the new build installed): blocked as well.
    const bumped = { ...cfg, blender: { ...cfg.blender, version: '5.2.3', buildHash: '0123456789ab' } };
    const next = { ...structuredClone(ENVIRONMENTS['production-rtx5080']), blenderVersion: '5.2.3 LTS', blenderBuildHash: '0123456789ab' } as RenderEnvironment;
    const b = decideQualification(inputs({ cfg: bumped, blender: { pinned: { version: '5.2.3', buildHash: '0123456789ab' }, observed: { version: '5.2.3', buildHash: '0123456789ab' } } }, next));
    assert.equal(b.verdict, 'QUALIFICATION_BLOCKED');
    assert.equal(check(b, 'class-blender-pins').result, 'BLOCKED');
    assert.notEqual(b.verdict, 'QUALIFICATION_REVERIFIED');
  });

  test('a stale reference (another config, source, model, or plan) blocks: it cannot vouch for this checkout', () => {
    const stale = { ...structuredClone(reference), blenderConfigSha256: 'c'.repeat(64) };
    const r = decideQualification(inputs({ reference: { record: stale, problems: [] } }));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.equal(check(r, 'reference-fresh').result, 'BLOCKED');
  });

  test('a reference whose frames are not the bytes it records blocks', () => {
    const r = decideQualification(inputs({ reference: { record: structuredClone(reference), problems: ['perch.png is not the bytes proof.json records'] } }));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.equal(check(r, 'reference-intact').result, 'BLOCKED');
  });

  test('a reference that was not rendered in an approved publication class blocks', () => {
    const r = decideQualification(inputs({ reference: { record: { ...structuredClone(reference), environment: structuredClone(ENVIRONMENTS['new-driver']) }, problems: [] } }));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
  });

  test('the proof class, or a record outside the schema, is no production candidate', () => {
    assert.equal(decideQualification(inputs({}, ENVIRONMENTS['proof-linux-software-gl'])).verdict, 'QUALIFICATION_BLOCKED');
    const odd = { ...ENVIRONMENTS['production-rtx5080'], hostname: 'render-farm' } as unknown as RenderEnvironment;
    const r = decideQualification(inputs({}, odd));
    assert.equal(r.verdict, 'QUALIFICATION_BLOCKED');
    assert.deepEqual(r.environment.problems, ['$.hostname: unknown field']);
  });

  test('pins that change while the qualification runs fail it: the classes and tolerances, the reference, the Blender config, the character pins', () => {
    for (const k of ['referenceSha256', 'blenderConfigSha256', 'characterPinsSha256'] as const) assert.equal(decideQualification(inputs({ pins: { before: PINS, after: { ...PINS, [k]: 'f'.repeat(64) } } })).verdict, 'QUALIFICATION_FAIL', k);
    const r = decideQualification(inputs({ pins: { before: PINS, after: { ...PINS, environmentsSha256: 'e'.repeat(64) } } }));
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.equal(check(r, 'pins-unchanged').result, 'FAIL');
  });
});

describe('qualification never lowers the bar and never approves', () => {
  test('the pinned tolerances are inputs: the decision reads them, reports them as read, and never changes them', () => {
    const before = canonicalJson(environments);
    const peak = reference.roles.find((x) => x.role === 'transition-peak')!;
    const versus = reference.roles.map((x) => ({ role: x.role, frame: x.frame, identical: x !== peak, measures: x === peak ? { fractionOverNoise: 0.0057, meanAbsDelta: 0.05, coverageDeltaPx: 0, maxDelta: 15 } : null }));
    const given = inputs({ versusReference: versus }, ENVIRONMENTS['new-driver']);
    const r = decideQualification(given); // inputs are deep-frozen: an assignment to them would throw here
    assert.equal(r.verdict, 'QUALIFICATION_FAIL');
    assert.equal(canonicalJson(given.environments), before);
    assert.deepEqual(r.pins.tolerances, { crossClassTolerance: environments.crossClassTolerance, cropEquivalenceTolerance: environments.cropEquivalenceTolerance });
    assert.equal(canonicalJson(loadEnvironments()), before, 'config/blender-environments.json is unchanged on disk');
  });

  test('no verdict carries an approval, and an unapproved environment stays unapproved in every record', () => {
    for (const env of [ENVIRONMENTS['new-driver'], ENVIRONMENTS['production-rtx5080']]) {
      const r = decideQualification(inputs({}, env));
      assert.equal(r.approval, 'NONE: approval is a reviewed change to config/blender-environments.json');
      assert.ok(!('approved' in r));
    }
    const candidate = decideQualification(inputs({}, ENVIRONMENTS['new-driver']));
    assert.equal(candidate.environment.approvedClass, null);
  });

  test('the qualification code writes nothing but its record, and never exports or replaces a reference', () => {
    for (const rel of ['src/blender/qualification.ts', 'scripts/blender-qualify.ts']) {
      const text = readFileSync(path.join(VIDEO_ROOT, rel), 'utf8');
      assert.deepEqual(writesOutsideRecordWriter(text), [], `${rel} writes outside writeQualificationRecord`);
      assert.ok(!/export-reference|exportReference/.test(text.replace(/\/\/.*$/gm, '').replace(/'[^'\n]*export-reference[^'\n]*'|`[^`]*export-reference[^`]*`/g, '')), `${rel} must not export a reference`);
    }
  });

  test('the qualification CLI runs only its listed steps (build, proof render, invariants); the decision module spawns nothing', () => {
    assert.deepEqual(unlistedSteps(readFileSync(path.join(VIDEO_ROOT, 'scripts', 'blender-qualify.ts'), 'utf8')), []);
    assert.ok(!/child_process/.test(readFileSync(path.join(VIDEO_ROOT, 'src', 'blender', 'qualification.ts'), 'utf8')), 'the decision module spawns nothing');
  });

  test('positive control: the step guard catches an export-reference step, a widened step table, or a spawn outside step()', () => {
    const cli = readFileSync(path.join(VIDEO_ROOT, 'scripts', 'blender-qualify.ts'), 'utf8');
    const anchor = "const ok = step('the ported invariants";
    assert.ok(cli.includes(anchor) && cli.includes("invariants: () => ['scripts/blender-invariants.ts']"), 'the probes match the CLI');
    for (const bad of [
      cli.replace(anchor, `step('keep the candidate', ['scripts/blender-proof.ts', 'export-reference', '--run=x']);\n  ${anchor}`),
      cli.replace("invariants: () => ['scripts/blender-invariants.ts']", "invariants: () => ['scripts/blender-proof.ts', 'export-reference']"),
      `${cli}\nspawnSync(process.execPath, ['scripts/blender-proof.ts', 'export-reference']);\n`,
    ]) {
      assert.notDeepEqual(unlistedSteps(bad), []);
    }
  });

  test('positive control: the write guard catches a write to the approved classes, the reference, or anywhere else', () => {
    const offenders = [
      "writeFileSync(path.join(VIDEO_ROOT, 'config', 'blender-environments.json'), prettyJson(widened));",
      "copyFileSync(candidatePng, path.join(REFERENCE_DIR, 'perch.png'));",
      'renameSync(tmp, target);',
      "fs.promises.writeFile('x', 'y');",
      'rmSync(dir, { recursive: true });',
    ];
    for (const o of offenders) assert.notDeepEqual(writesOutsideRecordWriter(`const x = 1;\n${o}\n`), [], o);
  });

  test('the record writer writes only a run directory under the qualification root', () => {
    const root = area.dir('records');
    const r = decideQualification(inputs());
    const written = writeQualificationRecord(r, 'driver-620', root);
    assert.deepEqual(readdirSync(path.join(root, 'driver-620')).sort(), ['qualification.json', 'summary.txt']);
    assert.equal(path.dirname(written), path.join(root, 'driver-620'));
    for (const bad of ['../config', 'a/b', '', 'UPPER', '.hidden']) assert.throws(() => writeQualificationRecord(r, bad, root), /run/, bad);
  });
});

describe('pixel equivalence (shared by blender:proof compare and qualification)', () => {
  const img = (data: number[], width = 2, height = 1) => ({ width, height, data: Uint8Array.from(data) });
  test('identical images measure zero', () => {
    assert.deepEqual(measureEquivalence(img([1, 2, 3, 255, 4, 5, 6, 255]), img([1, 2, 3, 255, 4, 5, 6, 255]), 2), { fractionOverNoise: 0, meanAbsDelta: 0, coverageDeltaPx: 0, maxDelta: 0 });
  });
  test('channels beyond the noise level, the mean delta, and coverage flips are measured exactly', () => {
    const m = measureEquivalence(img([10, 0, 0, 255, 0, 0, 0, 0]), img([13, 1, 0, 255, 0, 0, 0, 9]), 2)!;
    assert.equal(m.fractionOverNoise, 2 / 8); // 3 and 9 exceed 2; 1 does not
    assert.equal(m.meanAbsDelta, (3 + 1 + 9) / 8);
    assert.equal(m.coverageDeltaPx, 1); // the second pixel appears
    assert.equal(m.maxDelta, 9);
  });
  test('different sizes are never equivalent', () => {
    assert.equal(measureEquivalence(img([0, 0, 0, 0]), img([0, 0, 0, 0, 0, 0, 0, 0]), 2), null);
  });
  test('the pinned tolerance is applied as written', () => {
    const t = environments.crossClassTolerance.scene;
    assert.equal(withinTolerance({ fractionOverNoise: t.maxFractionOverNoise, meanAbsDelta: t.maxMeanAbsDelta, coverageDeltaPx: 0, maxDelta: 15 }, t), true);
    assert.equal(withinTolerance({ fractionOverNoise: t.maxFractionOverNoise * 1.0001, meanAbsDelta: 0, coverageDeltaPx: 0, maxDelta: 15 }, t), false);
    assert.equal(withinTolerance({ fractionOverNoise: 0, meanAbsDelta: 0, coverageDeltaPx: 1, maxDelta: 1 }, t), false);
  });
});
