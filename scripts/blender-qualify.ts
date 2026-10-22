// npm run blender:qualify-production [-- --run=<id>]
//   -> dist/blender/out/qualification/<run>/qualification.json + summary.txt: candidate evidence, never an approval
//
// Requalify the production render host after an expected environment change (an NVIDIA driver, Blender, the graphics
// runtime, or an OS update): docs/PUBLICATION.md. On the host itself, with the pinned Blender (WALLETWALL_BLENDER):
//
//   1. which Blender is installed (nothing renders unless it is the pinned build; a Blender change is named instead);
//   2. the committed reference (blender/proof/reference/) is intact, from a publication class, and fresh;
//   3. the character is built twice from code; both must be the pinned canonical model and materials;
//   4. the ten-frame proof set renders twice, in fresh processes (scripts/blender-proof.ts): byte-identical;
//   5. the environment Blender reported is classified, with its approved/observed/changed diff;
//   6. run A against the reference: the same class must be byte-identical, another class must hold the pinned
//      cross-class tolerance, read from config/blender-environments.json and never written;
//   7. the ported invariants at the publication stride (contacts, IK, envelope, palette), in this environment;
//   8. the pins are byte-identical at the end to what they were at the start.
//
// Verdicts (src/blender/qualification.ts): QUALIFICATION_CANDIDATE_PASS (a changed environment whose evidence passes:
// a human may approve it in a reviewed change to config/blender-environments.json), QUALIFICATION_REVERIFIED (already
// approved), QUALIFICATION_FAIL, QUALIFICATION_BLOCKED. Exit 0 for the first two, 1 otherwise, 2 for a usage error.
//
// Fixed steps and arguments (the STEPS table, held to an allowlist by test/render-qualification.test.ts), no shell;
// Blender runs only through src/blender/toolchain.ts (offline, factory settings, a minimal environment), and nothing a
// caller types reaches a command line but the run id, which must be a short lowercase id. It never edits config/ and
// never exports or replaces the reference. Its own code writes only its record; the steps it runs write their usual
// outputs under dist/blender/out/ (the character build, the proof runs, the invariants report).

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { measureEquivalence } from '../src/blender/equivalence.ts';
import { loadEnvironments } from '../src/blender/identity.ts';
import { PUBLICATION_STRIDE } from '../src/blender/invariants-policy.ts';
import { lessonMotion, strideFrames } from '../src/blender/lesson.ts';
import { decideQualification, formatQualification, QUALIFICATION_RUN, writeQualificationRecord, type BuildEvidence, type PinsSnapshot, type ProofRun, type QualificationInputs, type RoleComparison } from '../src/blender/qualification.ts';
import { loadBlenderConfig, outFile, probeBlender } from '../src/blender/toolchain.ts';
import { BLENDER_CHARACTER } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { canonicalJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { readPng } from './review/png.ts';

const args = process.argv.slice(2);
const unknown = args.filter((a) => !a.startsWith('--run='));
if (unknown.length > 0) {
  console.error(`[qualify] unknown argument ${unknown.join(', ')}: the only option is --run=<id> (nothing else reaches a command line)`);
  process.exit(2);
}
const run = args.find((a) => a.startsWith('--run='))?.slice('--run='.length) ?? 'production';
if (!QUALIFICATION_RUN.test(run)) {
  console.error('[qualify] --run must be a short lowercase id');
  process.exit(2);
}

/** A proof run as scripts/blender-proof.ts records it: each role's PNG by file. */
type RecordedRun = Omit<ProofRun, 'roles'> & { roles: { role: string; file: string; frame: number; sha256: string; crop: unknown }[] };

const ENVIRONMENTS_FILE = path.join(VIDEO_ROOT, 'config', 'blender-environments.json');
const BLENDER_CONFIG_FILE = path.join(VIDEO_ROOT, 'config', 'blender.json');
const CHARACTER_PINS_FILE = path.join(VIDEO_ROOT, 'src', 'character', 'walletwallaby', 'versions.ts');
const REFERENCE_DIR = path.join(VIDEO_ROOT, 'blender', 'proof', 'reference');
const PLAIN_FILE = /^[a-z0-9][a-z0-9.-]{0,80}\.png$/;

/** The only commands this runs: lane scripts with fixed arguments (src/blender/qualification.ts QUALIFICATION_SCRIPTS). */
const STEPS = {
  build: () => ['scripts/blender.ts', 'build'],
  proof: (id: string) => ['scripts/blender-proof.ts', 'render', `--run=${id}`],
  invariants: () => ['scripts/blender-invariants.ts'],
};

/** The bar, by bytes: the approved classes and tolerances, every file of the reference, the Blender pin, the character pins. */
function pins(): PinsSnapshot {
  const reference = readdirSync(REFERENCE_DIR)
    .sort()
    .map((file) => ({ file, sha256: sha256Hex(readFileSync(path.join(REFERENCE_DIR, file))) }));
  return {
    environmentsSha256: sha256Hex(readFileSync(ENVIRONMENTS_FILE)),
    referenceSha256: contentAddress(reference),
    blenderConfigSha256: sha256Hex(readFileSync(BLENDER_CONFIG_FILE)),
    characterPinsSha256: sha256Hex(readFileSync(CHARACTER_PINS_FILE)),
  };
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};
const sha = (file: string): string | null => {
  try {
    return sha256Hex(readFileSync(file));
  } catch {
    return null;
  }
};

/** One fixed step in a fresh Node process; true when it exited 0. */
function step(what: string, argv: string[]): boolean {
  console.log(`[qualify] ${what}`);
  const r = spawnSync(process.execPath, argv, { cwd: VIDEO_ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) console.log(`[qualify] ${what}: exited ${r.status ?? r.signal}`);
  return r.status === 0;
}

const cfg = loadBlenderConfig();
// Read once, before anything runs, and only ever read: the decision measures against exactly these.
const environments = loadEnvironments();
const before = pins();
const pinned = { version: cfg.blender.version, buildHash: cfg.blender.buildHash };
const inputs: QualificationInputs = {
  environments,
  cfg,
  pins: { before, after: null },
  blender: { pinned, observed: null },
  character: { modelVersion: BLENDER_CHARACTER.modelVersion, modelSha256: BLENDER_CHARACTER.modelSha256, materialsVersion: BLENDER_CHARACTER.materialsVersion, materialsSha256: BLENDER_CHARACTER.materialsSha256 },
  reference: { record: null, problems: [] },
  builds: [],
  runs: { a: null, b: null, problems: [] },
  versusReference: null,
  invariants: null,
  lessonStrideFrames: null,
};

// 1. Which Blender is installed (only `--version` runs here).
const probe = probeBlender();
inputs.blender.observed = probe ? { version: probe.version, buildHash: probe.buildHash } : null;
const blenderOk = probe !== null && probe.version === pinned.version && probe.buildHash === pinned.buildHash;
console.log(`[qualify] Blender: ${probe ? `${probe.version ?? '?'} (${probe.buildHash ?? '?'})` : 'none found'}; pinned ${pinned.version} (${pinned.buildHash})`);

// 2. The committed reference: every PNG the bytes its record names.
const reference = readJson<RecordedRun>(path.join(REFERENCE_DIR, 'proof.json'));
if (reference) {
  inputs.reference.record = reference;
  for (const r of reference.roles) {
    if (!PLAIN_FILE.test(r.file)) inputs.reference.problems.push(`${r.role}: ${JSON.stringify(r.file)} is not a plain file name`);
    else if (sha(path.join(REFERENCE_DIR, r.file)) !== r.sha256) inputs.reference.problems.push(`${r.file} is not the bytes proof.json records`);
  }
}

if (blenderOk) {
  const build = (label: string): BuildEvidence | null => {
    if (!step(`build the character from code (${label})`, STEPS.build())) return null;
    const m = readJson<{ modelVersion: number; modelSha256: string; materialsVersion: number; materialsSha256: string; modelRealizationSha256: string }>(outFile('character/model.json'));
    return m ? { modelVersion: m.modelVersion, modelSha256: m.modelSha256, materialsVersion: m.materialsVersion, materialsSha256: m.materialsSha256, realizationSha256: m.modelRealizationSha256 } : null;
  };
  const proofRun = (id: string): RecordedRun | null => {
    if (!step(`render the proof set (${id}: fresh processes, this build)`, STEPS.proof(id))) return null;
    const rec = readJson<RecordedRun>(outFile(`proof/${id}/proof.json`));
    for (const r of rec?.roles ?? []) if (sha(outFile(r.file)) !== r.sha256) inputs.runs.problems.push(`${id} ${r.role}: the PNG is not the bytes its proof record names`);
    return rec;
  };
  for (const [label, id] of [['build 1', `${run}-a`], ['build 2', `${run}-b`]] as const) {
    const b = build(label);
    if (b) inputs.builds.push(b);
    const rec = b ? proofRun(id) : null;
    if (id.endsWith('-a')) inputs.runs.a = rec;
    else inputs.runs.b = rec;
  }

  // Run A against the reference: byte identity, else the shared measure at the pinned noise level.
  const a = inputs.runs.a as RecordedRun | null;
  if (a && reference) {
    inputs.versusReference = a.roles.map((ra): RoleComparison => {
      const rr = reference.roles.find((x) => x.role === ra.role);
      if (!rr || rr.frame !== ra.frame || canonicalJson(rr.crop) !== canonicalJson(ra.crop) || !PLAIN_FILE.test(rr.file)) return { role: ra.role, frame: ra.frame, identical: false, measures: null };
      if (rr.sha256 === ra.sha256) return { role: ra.role, frame: ra.frame, identical: true, measures: null };
      const t = ra.role.startsWith('transition-') ? environments.crossClassTolerance.scene : environments.crossClassTolerance.character;
      return { role: ra.role, frame: ra.frame, identical: false, measures: measureEquivalence(readPng(outFile(ra.file)), readPng(path.join(REFERENCE_DIR, rr.file)), t.noiseLevel) };
    });
  }

  // The ported invariants, at the publication stride. A report counts only if this run wrote it: a pass needs exit 0.
  const ok = step('the ported invariants at the publication stride (contacts, IK, envelope, palette)', STEPS.invariants());
  const inv = readJson<{ schema: string; pass: boolean; every: number; labEvery: number; failureCount: number; thresholds: unknown; counts: unknown; lessonFrames?: unknown; environment?: { record?: unknown } }>(outFile('invariants/report.json'));
  if (inv && inv.schema === 'walletwall.blender-invariants/v2' && (ok || inv.pass === false)) inputs.invariants = { pass: ok && inv.pass, every: inv.every, labEvery: inv.labEvery, failureCount: inv.failureCount, thresholds: inv.thresholds, counts: inv.counts, lessonFrames: inv.lessonFrames, environment: inv.environment?.record };
  // The frames the invariants step must have checked: every visible frame of this checkout's lesson (the step's fixed
  // video, fixture voice, and default engine) at the publication stride. The coverage floors are fractions of them.
  inputs.lessonStrideFrames = strideFrames(await lessonMotion('migration-readiness'), PUBLICATION_STRIDE.every);
}

inputs.pins.after = pins();
const record = decideQualification(inputs);
const written = writeQualificationRecord(record, run);
console.log(formatQualification(record));
console.log(`[qualify] record: ${path.relative(VIDEO_ROOT, written).split(path.sep).join('/')}`);
process.exitCode = record.verdict === 'QUALIFICATION_CANDIDATE_PASS' || record.verdict === 'QUALIFICATION_REVERIFIED' ? 0 : 1;
