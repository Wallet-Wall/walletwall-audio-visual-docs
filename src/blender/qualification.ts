// Production render host qualification (docs/PUBLICATION.md, Requalifying the production host): the verdict over the
// evidence `npm run blender:qualify-production` gathers when the production host's render environment may have
// changed (a driver, Blender, graphics runtime, or OS update), and the record a human reviews.
//
//   1. Blender: the installed build must be the one config/blender.json pins; otherwise nothing renders (BLOCKED, with
//      the change named). Every approved class must pin that same build: a class qualified on another build is a
//      source/config coherence failure (BLOCKED, naming both builds), which only a reviewed change resolves.
//   2. The committed cross-class reference (blender/proof/reference/): its PNGs are the bytes it records, it was
//      rendered in an approved publication class, and from this checkout's config, lane source, model, and plan.
//   3. The environment Blender actually rendered in, classified, with its diff against the nearest approved class. A
//      render that records another Blender build than the pinned one is never a candidate (BLOCKED).
//   4. Two builds of the character: both the pinned canonical model and materials, and one realization.
//   5. The proof set rendered twice in fresh processes: byte-identical (same-class determinism).
//   6. Against the reference: the same class must be byte-identical; another class must hold the pinned cross-class
//      tolerance, frame by frame.
//   7. The ported invariants (contacts, IK, envelope, palette) at the publication stride, in this same environment.
//   8. The pins (config/blender-environments.json and the reference) are unchanged by the time it finishes.
//
// THE TOOL NEVER APPROVES. The best verdict for a changed environment is QUALIFICATION_CANDIDATE_PASS: evidence for a
// human, who may approve the environment in a reviewed change to config/blender-environments.json. The pinned
// tolerances are inputs, read once and never written; a measure over a pin is a FAIL stating both numbers, never a
// reason to move the pin. The only thing this module writes is the record (writeQualificationRecord), under
// dist/blender/out/qualification/<run>/. Node-only.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, prettyJson } from '../core/canonical-json.ts';
import { blenderPinProblems, classifyEnvironment, environmentDifferences, environmentSummary, formatEnvironmentDiff, shownClassName, type EnvironmentClassification, type EnvironmentStatus } from './environment.ts';
import { withinTolerance, type EquivalenceMeasures } from './equivalence.ts';
import { invariantsBarProblems, PUBLICATION_STRIDE } from './invariants-policy.ts';
import type { EnvironmentsDocument, PixelTolerance, RenderEnvironment } from './identity.ts';
import { outFile, type BlenderConfig } from './toolchain.ts';

export const QUALIFICATION_SCHEMA = 'walletwall.render-qualification/v1';
export const APPROVAL_STATEMENT = 'NONE: approval is a reviewed change to config/blender-environments.json';
/** A qualification run's id: its output directory and its proof runs (<run>-a, <run>-b). */
export const QUALIFICATION_RUN = /^[a-z0-9][a-z0-9-]{0,30}$/;

export type QualificationVerdict = 'QUALIFICATION_CANDIDATE_PASS' | 'QUALIFICATION_REVERIFIED' | 'QUALIFICATION_FAIL' | 'QUALIFICATION_BLOCKED';
export type CheckResult = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

/** The parts of a proof run (scripts/blender-proof.ts proof.json) the decision reads. */
export interface ProofRun {
  environment: unknown;
  canonicalModelSha256: string;
  realizationSha256: string;
  blenderConfigSha256: string;
  blenderSceneSourceSha256: string;
  motionPlanSha256: string;
  roles: { role: string; frame: number; sha256: string; crop: unknown }[];
}

/** One character build (dist/blender/out/character/model.json). */
export interface BuildEvidence {
  modelVersion: number;
  modelSha256: string;
  materialsVersion: number;
  materialsSha256: string;
  realizationSha256: string;
}

/** A proof frame of run A against the reference's: byte identity, else the measures (null when the sizes differ). */
export interface RoleComparison {
  role: string;
  frame: number;
  identical: boolean;
  measures: EquivalenceMeasures | null;
}

export interface PinsSnapshot {
  /** sha256 of config/blender-environments.json's bytes: the approved classes and the tolerances. */
  environmentsSha256: string;
  /** sha256 over the reference directory's files (names and bytes). */
  referenceSha256: string;
  /** sha256 of config/blender.json's bytes: the pinned Blender build and render config. */
  blenderConfigSha256: string;
  /** sha256 of src/character/walletwallaby/versions.ts's bytes: the pinned character model and materials. */
  characterPinsSha256: string;
}

export interface QualificationInputs {
  /** The approved classes and pinned tolerances, read before anything ran. Never written. */
  environments: EnvironmentsDocument;
  cfg: BlenderConfig;
  pins: { before: PinsSnapshot; after: PinsSnapshot | null };
  blender: { pinned: { version: string; buildHash: string }; observed: { version: string | null; buildHash: string | null } | null };
  /** The pinned character (src/character/walletwallaby/versions.ts BLENDER_CHARACTER). */
  character: { modelVersion: number; modelSha256: string; materialsVersion: number; materialsSha256: string };
  /** The committed reference, and anything wrong with its bytes. */
  reference: { record: ProofRun | null; problems: string[] };
  builds: BuildEvidence[];
  /** The two proof runs, and any PNG that is not the bytes its run records. */
  runs: { a: ProofRun | null; b: ProofRun | null; problems: string[] };
  versusReference: RoleComparison[] | null;
  /** The ported invariants' report (walletwall.blender-invariants/v2), as far as the decision reads it. */
  invariants: { pass: boolean; every: number; labEvery: number; failureCount: number; thresholds: unknown; counts: unknown; lessonFrames: unknown; environment: unknown } | null;
  /** Every visible lesson frame at the publication stride, re-derived from this checkout's plan (null when it could not be). */
  lessonStrideFrames: number[] | null;
}

export interface QualificationCheck {
  id: string;
  result: CheckResult;
  detail: string;
}

export interface QualificationRecord {
  schema: typeof QUALIFICATION_SCHEMA;
  verdict: QualificationVerdict;
  /** Always the same statement: this tool approves nothing. */
  approval: typeof APPROVAL_STATEMENT;
  environment: {
    status: EnvironmentStatus | 'NOT_RENDERED';
    classId: string | null;
    /** The approved class it already falls in, if any (null for a candidate: a candidate stays unapproved). */
    approvedClass: string | null;
    nearest: string | null;
    changed: string[];
    /** The approved/observed/changed diff, as an operator reads it. */
    diff: string | null;
    /** The environment record, when it is a well-formed one (an invalid record is never echoed). */
    record: RenderEnvironment | null;
    problems: string[];
  };
  checks: QualificationCheck[];
  versusReference: (RoleComparison & { tolerance: 'character' | 'scene'; pass: boolean })[];
  pins: { before: PinsSnapshot; after: PinsSnapshot | null; tolerances: { crossClassTolerance: EnvironmentsDocument['crossClassTolerance']; cropEquivalenceTolerance: PixelTolerance } };
  nextSteps: string[];
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
/** A fraction as a percentage with three significant digits, so a breach of a 0.01% pin is visible as such. */
const pct = (x: number): string => `${(x * 100).toPrecision(3)}%`;
const IDENTITY_KEYS = ['canonicalModelSha256', 'motionPlanSha256', 'blenderConfigSha256', 'blenderSceneSourceSha256'] as const;

/** Each way a frame's measures exceed its pin, in words, with both numbers. */
function overPin(role: RoleComparison, t: PixelTolerance, which: string): string[] {
  const m = role.measures;
  const at = `${role.role} (frame ${role.frame})`;
  if (!m) return [`${at}: a different image size than the reference`];
  // The decision is the shared one (src/blender/equivalence.ts, as blender:proof compare applies it); this only explains it.
  if (withinTolerance(m, t)) return [];
  const out: string[] = [];
  if (m.fractionOverNoise > t.maxFractionOverNoise) out.push(`${at}: changed fraction ${pct(m.fractionOverNoise)} > approved maximum ${pct(t.maxFractionOverNoise)} (crossClassTolerance.${which}.maxFractionOverNoise)`);
  if (m.meanAbsDelta > t.maxMeanAbsDelta) out.push(`${at}: mean |delta| ${m.meanAbsDelta.toPrecision(3)} > approved maximum ${t.maxMeanAbsDelta} (crossClassTolerance.${which}.maxMeanAbsDelta)`);
  if (m.coverageDeltaPx > t.maxCoverageDeltaPx) out.push(`${at}: ${m.coverageDeltaPx} pixels appear or vanish > approved maximum ${t.maxCoverageDeltaPx} (crossClassTolerance.${which}.maxCoverageDeltaPx)`);
  return out.length > 0 ? out : [`${at}: outside the pinned tolerance (crossClassTolerance.${which})`];
}

/** The verdict over a qualification's evidence. Pure: reads its inputs, changes none of them. */
export function decideQualification(inp: QualificationInputs): QualificationRecord {
  const checks: QualificationCheck[] = [];
  const add = (id: string, result: CheckResult, detail: string) => checks.push({ id, result, detail });
  const envs = inp.environments;
  const { pinned, observed } = inp.blender;

  // 1. Blender.
  const blenderOk = observed !== null && observed.version === pinned.version && observed.buildHash === pinned.buildHash;
  add('blender-pinned', blenderOk ? 'PASS' : 'BLOCKED', observed ? `Blender ${observed.version ?? '?'} (${observed.buildHash ?? '?'}) is installed; config/blender.json pins ${pinned.version} (${pinned.buildHash})` : 'no Blender found (set WALLETWALL_BLENDER to the pinned build)');
  // Each approved class names the Blender build it was qualified on; it must be the build config/blender.json pins.
  const incoherent = blenderPinProblems(envs, inp.cfg);
  add('class-blender-pins', incoherent.length > 0 ? 'BLOCKED' : 'PASS', incoherent.length > 0 ? `${incoherent.join('; ')}: config/blender.json and config/blender-environments.json disagree, so no class approves anything until a reviewed change makes them agree (this tool never edits a class)` : `every approved class pins the pinned Blender build ${inp.cfg.blender.version} (${inp.cfg.blender.buildHash})`);

  // 2. The reference.
  const ref = inp.reference.record;
  let refClass: EnvironmentClassification | null = null;
  if (!ref) add('reference-intact', 'BLOCKED', 'blender/proof/reference/proof.json is missing or unreadable');
  else {
    refClass = classifyEnvironment(ref.environment, inp.cfg, envs);
    const problems = [...inp.reference.problems];
    if (refClass.status !== 'APPROVED' || refClass.approvedClass?.purpose !== 'publication') problems.push(`it was not rendered in an approved publication class (${environmentSummary(refClass)})`);
    add('reference-intact', problems.length > 0 ? 'BLOCKED' : 'PASS', problems.length > 0 ? problems.join('; ') : `the committed reference: ${ref.roles.length} frames in ${refClass.approvedClass!.name}, each PNG the bytes it records`);
  }

  // 3. The environment Blender rendered in.
  const a = inp.runs.a;
  const b = inp.runs.b;
  const cls = a ? classifyEnvironment(a.environment, inp.cfg, envs, { prefer: 'publication' }) : null;
  const rendered = cls && cls.status !== 'INVALID' ? (a!.environment as RenderEnvironment) : null;
  const unpinnedRender = rendered !== null && (rendered.blenderVersion.split(' ')[0] !== inp.cfg.blender.version || rendered.blenderBuildHash !== inp.cfg.blender.buildHash);
  if (!cls) add('environment', 'NOT_RUN', 'nothing was rendered');
  else if (cls.status === 'INVALID') add('environment', 'BLOCKED', `not a render-environment record (${cls.problems.join('; ')})`);
  else if (unpinnedRender) add('environment', 'BLOCKED', `rendered with Blender ${rendered!.blenderVersion.split(' ')[0]} (${rendered!.blenderBuildHash}), not the pinned ${inp.cfg.blender.version} (${inp.cfg.blender.buildHash}): an unpinned build is never qualified`);
  else if (cls.status === 'APPROVED' && cls.approvedClass!.purpose !== 'publication') add('environment', 'BLOCKED', `approved as ${cls.approvedClass!.name} (${cls.approvedClass!.purpose}): this is not a production render host`);
  else add('environment', 'PASS', environmentSummary(cls));

  // Reference freshness: the reference must have been rendered from what this checkout renders.
  if (!ref || !a) add('reference-fresh', 'NOT_RUN', 'needs the reference and a proof run');
  else {
    const stale = IDENTITY_KEYS.filter((k) => a[k] !== ref[k]);
    add('reference-fresh', stale.length > 0 ? 'BLOCKED' : 'PASS', stale.length > 0 ? `the reference was rendered with another ${stale.join(', ')} than this checkout: it cannot vouch for these frames (replacing it is a reviewed change)` : "the reference was rendered from this checkout's config, lane source, canonical model, and plan");
  }

  // 4. The character, built twice.
  const pin = inp.character;
  if (!blenderOk) add('character-pinned', 'NOT_RUN', 'Blender is not the pinned build');
  else if (inp.builds.length !== 2) add('character-pinned', 'FAIL', `${inp.builds.length} character builds, not two`);
  else {
    const off = inp.builds.filter((x) => x.modelVersion !== pin.modelVersion || x.modelSha256 !== pin.modelSha256 || x.materialsVersion !== pin.materialsVersion || x.materialsSha256 !== pin.materialsSha256);
    const realizations = new Set(inp.builds.map((x) => x.realizationSha256));
    if (off.length > 0) add('character-pinned', 'FAIL', `a build is not the pinned canonical model v${pin.modelVersion} ${pin.modelSha256.slice(0, 12)} and materials v${pin.materialsVersion} ${pin.materialsSha256.slice(0, 12)}`);
    else if (realizations.size !== 1) add('character-pinned', 'FAIL', 'two builds on this host realized the model differently');
    else add('character-pinned', 'PASS', `two builds: the pinned canonical model ${pin.modelSha256.slice(0, 12)} and materials ${pin.materialsSha256.slice(0, 12)}; one realization ${inp.builds[0]!.realizationSha256.slice(0, 12)}${ref ? (inp.builds[0]!.realizationSha256 === ref.realizationSha256 ? " (the reference host's)" : ' (not the reference host\'s)') : ''}`);
  }

  // 5. Same-class determinism: the proof set twice, fresh processes.
  if (!a || !b) add('same-class-repeat', 'NOT_RUN', 'needs two proof runs');
  else {
    const problems = [...inp.runs.problems];
    if (!same(a.environment, b.environment)) problems.push('the two runs report different environments');
    for (const ra of a.roles) {
      const rb = b.roles.find((x) => x.role === ra.role);
      if (!rb || rb.frame !== ra.frame || !same(rb.crop, ra.crop)) problems.push(`${ra.role}: the runs rendered different frames or crops`);
      else if (rb.sha256 !== ra.sha256) problems.push(`${ra.role} (frame ${ra.frame}): the PNGs differ`);
    }
    if (b.roles.length !== a.roles.length) problems.push('the runs rendered different proof sets');
    add('same-class-repeat', problems.length > 0 ? 'FAIL' : 'PASS', problems.length > 0 ? problems.join('; ') : `${a.roles.length} / ${a.roles.length} proof frames byte-identical across two builds and two fresh processes`);
  }

  // 6. Against the reference: the same proof frames and crops, then byte identity within the reference's own approved
  // class (the same class id, or the same class name with a field the class does not pin changed), else the pinned
  // cross-class tolerance.
  const rows: QualificationRecord['versusReference'] = [];
  if (!a || !ref || !inp.versusReference || !cls || cls.status === 'INVALID') add('versus-reference', 'NOT_RUN', 'needs a proof run, the reference, and a well-formed environment');
  else {
    const problems: string[] = [];
    for (const r of ref.roles) {
      const ra = a.roles.find((x) => x.role === r.role);
      if (!ra) problems.push(`${r.role}: the proof run did not render it`);
      else if (ra.frame !== r.frame || !same(ra.crop, r.crop)) problems.push(`${r.role}: the proof run rendered another frame or crop than the reference (${ra.frame} vs ${r.frame})`);
    }
    for (const ra of a.roles) if (!ref.roles.some((x) => x.role === ra.role)) problems.push(`${ra.role}: the reference has no such frame`);
    const sameId = refClass !== null && cls.classId === refClass.classId;
    const sameName = refClass?.approvedClass != null && cls.approvedClass?.name === refClass.approvedClass.name;
    const unpinned = sameName && !sameId && refClass?.status !== 'INVALID' ? environmentDifferences(a.environment as RenderEnvironment, ref.environment as RenderEnvironment) : [];
    for (const r of ref.roles) {
      const c = inp.versusReference.find((x) => x.role === r.role && x.frame === r.frame);
      const which = r.role.startsWith('transition-') ? 'scene' : 'character';
      if (!c) {
        if (a.roles.some((x) => x.role === r.role && x.frame === r.frame)) problems.push(`${r.role}: not compared`);
        continue;
      }
      const fails = c.identical ? [] : sameId || sameName ? [`${c.role} (frame ${c.frame}) differs`] : overPin(c, envs.crossClassTolerance[which], which);
      rows.push({ ...c, tolerance: which, pass: fails.length === 0 });
      problems.push(...fails);
    }
    const identical = rows.filter((x) => x.identical).length;
    if ((sameId || sameName) && problems.length > 0) add('versus-reference', 'FAIL', `${sameId ? `same class as the reference (${cls.classId})` : `approved as ${cls.approvedClass!.name}, the reference's class, though ${unpinned.join(', ') || 'a field'} changed (class ${cls.classId}, the reference's ${refClass!.classId})`}: every frame must be byte-identical (guarantee A); ${problems.join('; ')}`);
    else if (problems.length > 0) add('versus-reference', 'FAIL', `over the pinned cross-class tolerance (config/blender-environments.json, unchanged): ${problems.join('; ')}`);
    else add('versus-reference', 'PASS', `${identical} / ${rows.length} byte-identical to the reference${identical < rows.length ? `; the rest within the pinned cross-class tolerance` : ''}${sameId ? ' (same class)' : sameName ? ` (the reference's class, ${unpinned.join(', ')} changed)` : ''}`);
  }

  // 7. The ported invariants, in this environment, judged against this checkout's bar (src/blender/invariants-policy.ts).
  const inv = inp.invariants;
  if (!inv) add('contacts-and-invariants', 'NOT_RUN', 'the invariants did not run');
  else {
    const problems = invariantsBarProblems(inv);
    // The coverage floors are fractions of the frames checked, so the frames must be the plan's own (as the receipt requires).
    if (!inp.lessonStrideFrames || !same(inv.lessonFrames, inp.lessonStrideFrames)) problems.push("its lesson frames are not every visible frame at the stride of this checkout's plan");
    if (!a || !same(inv.environment, a.environment)) problems.push('measured in another environment than the proof runs');
    add('contacts-and-invariants', problems.length > 0 ? 'FAIL' : 'PASS', problems.length > 0 ? problems.join('; ') : `feet, paws, and tail on their targets and supports, the envelope, protected text, title-safe, and the palette, on every ${PUBLICATION_STRIDE.every}th lesson frame and every lab frame`);
  }

  // 8. The pins: the approved classes and tolerances, the reference, the Blender config, the character pins.
  if (!inp.pins.after) add('pins-unchanged', 'NOT_RUN', 'the run did not finish');
  else {
    const changed = (Object.keys(inp.pins.before) as (keyof PinsSnapshot)[]).filter((k) => inp.pins.before[k] !== inp.pins.after![k]);
    add('pins-unchanged', changed.length === 0 ? 'PASS' : 'FAIL', changed.length === 0 ? 'config/blender-environments.json, the reference, config/blender.json, and the character pins are byte-identical to when this started' : `changed while this ran: ${changed.join(', ')}`);
  }

  const verdict: QualificationVerdict = checks.some((c) => c.result === 'BLOCKED')
    ? 'QUALIFICATION_BLOCKED'
    : checks.some((c) => c.result === 'FAIL' || c.result === 'NOT_RUN')
      ? 'QUALIFICATION_FAIL'
      : cls?.status === 'APPROVED'
        ? 'QUALIFICATION_REVERIFIED'
        : 'QUALIFICATION_CANDIDATE_PASS';

  // A Blender that is not the pinned build is a change no render can show: name it, with the labels the diff uses.
  const blenderChange = !blenderOk && observed !== null && !cls;
  const blenderChanged = blenderChange ? [...(observed!.version !== pinned.version ? ['blender version'] : []), ...(observed!.buildHash !== pinned.buildHash ? ['blender build'] : [])] : [];
  const blenderLines = (v: { version: string | null; buildHash: string | null }) => [`  blender version: ${v.version ?? '?'}`, `  blender build: ${v.buildHash ?? '?'}`];
  const environment: QualificationRecord['environment'] = {
    status: cls?.status ?? 'NOT_RENDERED',
    classId: cls?.classId ?? null,
    approvedClass: cls?.status === 'APPROVED' ? cls.approvedClass!.name : null,
    nearest: cls?.nearest ? shownClassName(cls.nearest.name) : null,
    changed: blenderChange ? blenderChanged : (cls?.diff?.changed ?? []),
    diff: blenderChange ? ['approved:', ...blenderLines(pinned), 'observed:', ...blenderLines(observed!), 'changed:', ...blenderChanged.map((c) => `  ${c}`)].join('\n') : cls?.diff ? formatEnvironmentDiff(cls.diff) : null,
    record: cls && cls.status !== 'INVALID' && a ? (a.environment as RenderEnvironment) : null,
    problems: cls?.problems ?? [],
  };

  return {
    schema: QUALIFICATION_SCHEMA,
    verdict,
    approval: APPROVAL_STATEMENT,
    environment,
    checks,
    versusReference: rows,
    pins: { before: inp.pins.before, after: inp.pins.after, tolerances: { crossClassTolerance: envs.crossClassTolerance, cropEquivalenceTolerance: envs.cropEquivalenceTolerance } },
    nextSteps: nextSteps(verdict, environment, rows, a, checks, blenderChange, unpinnedRender),
  };
}

function nextSteps(verdict: QualificationVerdict, env: QualificationRecord['environment'], rows: QualificationRecord['versusReference'], a: ProofRun | null, checks: QualificationCheck[], blenderChange: boolean, unpinnedRender: boolean): string[] {
  const never = 'Do not raise a tolerance, replace the reference, or widen an approved class to make this pass: each is a separate source change with its own reviewed justification (docs/PUBLICATION.md).';
  if (verdict === 'QUALIFICATION_REVERIFIED') return [`This host is already approved as ${env.approvedClass}; the proof set reproduces the committed reference. Nothing to approve: npm run publication:proof.`];
  if (verdict === 'QUALIFICATION_BLOCKED') {
    const steps: string[] = [];
    if (blenderChange || unpinnedRender) steps.push('A Blender change starts with one reviewed change of config/blender.json (version, build hash, and the release archives\' SHA-256) and of every class\'s Blender pin, with a new reference; then qualification on that branch. Never render with an unpinned Blender.');
    if (checks.find((c) => c.id === 'class-blender-pins')?.result === 'BLOCKED') steps.push('Each approved class pins the Blender build it was qualified on, and config/blender.json pins the build every render uses: they must agree. Make them agree in a reviewed change (a Blender change also needs a new reference); this tool never edits a class.');
    if (checks.find((c) => c.id === 'reference-fresh')?.result === 'BLOCKED') steps.push('The committed reference was rendered from another config, lane source, model, or plan. A new reference is a reviewed change (npm run blender:proof -- export-reference, from an approved publication class), never part of qualifying a host.');
    if (checks.find((c) => c.id === 'reference-intact')?.result === 'BLOCKED') steps.push('The committed reference is not intact or not from a publication class: restore it from git before qualifying anything.');
    if (checks.find((c) => c.id === 'environment')?.result === 'BLOCKED' && !unpinnedRender) steps.push('Run this on the production render host, whose render environment is a well-formed record (no field outside the closed schema).');
    if (checks.find((c) => c.id === 'blender-pinned')?.result === 'BLOCKED' && !blenderChange) steps.push('Install the pinned Blender build (docs/BLENDER.md, Toolchain) and set WALLETWALL_BLENDER.');
    return [...steps, 'Nothing was approved.'];
  }
  if (verdict === 'QUALIFICATION_FAIL') return ['This environment does not qualify. Nothing was approved.', never];
  // A candidate: evidence for a human, never an approval.
  const identical = rows.every((x) => x.identical);
  const record = env.record;
  const gpu = record && Object.hasOwn(record.gpu, 'renderer') ? (record.gpu as Extract<RenderEnvironment['gpu'], { renderer: string }>) : null;
  // Field by field from the parsed record, in the class shape environmentsDocumentProblems requires (never a spread record).
  const proposal = record && gpu ? JSON.stringify({ name: '<name it in review>', purpose: 'publication', match: { os: record.os, blender: { version: record.blenderVersion.split(' ')[0], buildHash: record.blenderBuildHash }, engine: record.engine, gpu: { backend: gpu.backend, vendor: gpu.vendor, renderer: gpu.renderer, version: gpu.version } } }) : null;
  return [
    `This environment is NOT approved (changed: ${env.changed.join(', ') || 'nothing the class pins'}). This tool approves nothing.`,
    'Review: the diff above, the proof frames of run A, the comparison against the reference, and the invariants report.',
    identical
      ? 'Its proof frames are byte-identical to the approved reference: a reviewed PR may approve it in config/blender-environments.json, with no new reference.'
      : `Its proof frames differ from the approved reference within the pinned cross-class tolerance: a reviewed PR may approve it as a new class; making it THE production reference also needs a new reference exported from run A (npm run blender:proof -- export-reference --run=${a ? '<run>-a' : '<run A>'}), reviewed in the same PR.`,
    ...(proposal ? [`Proposal for that review (text only; not applied by this tool, which approves nothing): ${proposal}`] : []),
    'After that PR merges: npm run publication:proof.',
  ];
}

/** The record as an operator reads it on the console and in summary.txt. */
export function formatQualification(r: QualificationRecord): string {
  const head =
    r.verdict === 'QUALIFICATION_CANDIDATE_PASS'
      ? 'QUALIFICATION_CANDIDATE_PASS: candidate evidence only. This tool approves nothing.'
      : r.verdict === 'QUALIFICATION_REVERIFIED'
        ? `QUALIFICATION_REVERIFIED: already approved as ${r.environment.approvedClass}. This tool approves nothing.`
        : `${r.verdict}: nothing was approved. This tool approves nothing.`;
  return [
    head,
    `render environment: ${r.environment.status}${r.environment.classId ? ` (class ${r.environment.classId})` : ''}${r.environment.nearest ? `, nearest approved class ${r.environment.nearest}` : ''}`,
    ...(r.environment.diff ? [r.environment.diff] : []),
    ...(r.environment.problems.length ? [`problems: ${r.environment.problems.join('; ')}`] : []),
    'checks:',
    ...r.checks.map((c) => `  ${c.result.padEnd(8)} ${c.id.padEnd(24)} ${c.detail}`),
    'next steps:',
    ...r.nextSteps.map((s) => `  - ${s}`),
  ].join('\n');
}

/**
 * The only writer of qualification: the record and its summary, into dist/blender/out/qualification/<run>/ (or `root`,
 * for tests). Never config/, never the reference.
 */
export function writeQualificationRecord(record: QualificationRecord, run: string, root: string = outFile('qualification')): string {
  if (!QUALIFICATION_RUN.test(run)) throw new Error('the qualification run must be a short lowercase id');
  const dir = path.join(root, run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'qualification.json'), prettyJson(record));
  writeFileSync(path.join(dir, 'summary.txt'), `${formatQualification(record)}\n`);
  return path.join(dir, 'qualification.json');
}

const WRITE_CALL = /\b(?:writeFileSync|appendFileSync|copyFileSync|cpSync|renameSync|rmSync|rmdirSync|unlinkSync|mkdirSync|symlinkSync|linkSync|truncateSync|writeFile|appendFile|copyFile|rename|rm|rmdir|unlink|mkdir|cp|symlink|link|truncate)\s*\(/g;

/**
 * Every filesystem write call in a source text outside writeQualificationRecord's own body (comments ignored): the
 * guard test holds the qualification module and its CLI to none.
 */
export function writesOutsideRecordWriter(source: string): string[] {
  let text = source;
  const start = text.indexOf('export function writeQualificationRecord(');
  if (start >= 0) {
    const end = text.indexOf('\n}\n', start);
    text = text.slice(0, start) + (end >= 0 ? text.slice(end + 3) : '');
  }
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...text.matchAll(WRITE_CALL)].map((m) => m[0]);
}

/** The lane scripts qualification may run (scripts/blender-qualify.ts STEPS): build, render the proof set, invariants. */
export const QUALIFICATION_SCRIPTS = ['scripts/blender.ts', 'scripts/blender-proof.ts', 'scripts/blender-invariants.ts'] as const;

/**
 * Every way a qualification CLI source departs from its allowlist (comments ignored): one spawn, inside step(); every
 * step() call runs an entry of the STEPS table; the table names only QUALIFICATION_SCRIPTS and never exports or replaces
 * a reference. The guard test holds scripts/blender-qualify.ts to none.
 */
export function unlistedSteps(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const problems: string[] = [];
  const spawns = text.match(/\bspawnSync\s*\(/g)?.length ?? 0;
  if (spawns !== 1) problems.push(`${spawns} spawnSync calls: exactly one, inside step(), is allowed`);
  for (const line of text.split('\n')) {
    if (!/\bstep\(/.test(line) || /\bfunction step\(/.test(line)) continue;
    if (!/\bstep\([^\n]*,\s*STEPS\.(build|proof|invariants)\(/.test(line)) problems.push(`a step that is not an entry of STEPS: ${line.trim().slice(0, 120)}`);
  }
  const table = /const STEPS = \{([\s\S]*?)\n\};/.exec(text)?.[1];
  if (table === undefined) problems.push('no STEPS table');
  else {
    if (/export-reference/.test(table)) problems.push('the STEPS table exports a reference');
    for (const m of table.matchAll(/'(scripts\/[^']+)'/g)) if (!(QUALIFICATION_SCRIPTS as readonly string[]).includes(m[1]!)) problems.push(`the STEPS table runs ${m[1]}`);
  }
  return problems;
}
