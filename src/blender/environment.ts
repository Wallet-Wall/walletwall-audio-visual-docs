// The render environment Blender records for every render (render.py render_environment()), as a CLOSED schema;
// the approved class it falls in (config/blender-environments.json); and, when it falls in none, a deterministic
// diff against the nearest approved class, so an operator reads "changed: driver" rather than "unapproved".
//
// A class approves an environment exactly when the diff against it has no changed field: the decision and the
// explanation are one computation and cannot disagree. Every class pins the Blender build it was qualified on and the
// GPU backend, so another Blender or another graphics backend is another environment even where the GPU fields match.
// The class's Blender pin must equal config/blender.json's: when one changed without the other, the class approves
// nothing (a source/config coherence failure the diff names; no command repairs it). A pin every class must carry is
// never a wildcard: a class without it, in an older shape or a document that skipped validation, approves nothing.
//
// A record with any field outside the schema is not an environment and is never approved. A problem names the
// field, never its value: the value may be the very thing that must not leak. The leak checks here are patterns
// only (src/core/leak-scan.ts), so a classification never depends on the machine that checks it. Node-only.

import { contentAddress } from '../core/hash.ts';
import { localPathIn, credentialPatternIn } from '../core/leak-scan.ts';
import type { EnvironmentClassSpec, EnvironmentsDocument, RenderEnvironment } from './identity.ts';
import { blenderConfigSha256, type BlenderConfig } from './toolchain.ts';

const TOP_FIELDS = ['os', 'blenderVersion', 'blenderBuildHash', 'engine', 'gpu'] as const;
const GPU_FIELDS = ['backend', 'vendor', 'renderer', 'version', 'deviceType'] as const;
/** Longer than any GPU, driver, or Mesa string Blender reports; short enough that a record is never a dump. */
export const MAX_FIELD_LENGTH = 160;
const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const PRINTABLE = /^[\x20-\x7e]+$/;

type Shape = { re: RegExp; what: string };
const SHAPES: Record<string, Shape> = {
  os: { re: /^[a-z][a-z0-9]{0,31}$/, what: 'not an OS family' },
  blenderVersion: { re: /^\d+\.\d+\.\d+(?: [A-Za-z]+)?$/, what: 'not a Blender version' },
  blenderBuildHash: { re: /^[0-9a-f]{12}$/, what: 'not a 12-digit build hash' },
  engine: { re: /^[A-Z][A-Z0-9_]{0,31}$/, what: 'not a render engine' },
  unavailable: { re: /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/, what: 'not an error name' },
};

export type EnvironmentParse = { ok: true; env: RenderEnvironment } | { ok: false; problems: string[] };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** An own member of an object (never one inherited through its prototype), or undefined. */
const own = (o: unknown, k: string): unknown => (isObject(o) && Object.hasOwn(o, k) ? o[k] : undefined);

/** The record, if it is exactly the closed schema; otherwise every problem, by JSON path. */
export function parseRenderEnvironment(raw: unknown): EnvironmentParse {
  const problems: string[] = [];
  const onlyKnown = (obj: Record<string, unknown>, allowed: readonly string[], at: string): void => {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      problems.push(PLAIN_NAME.test(k) ? `${at}.${k}: unknown field` : `${at}: an unknown field (its name is not shown)`);
    }
  };
  const text = (obj: Record<string, unknown>, k: string, at: string): void => {
    const where = `${at}.${k}`;
    if (!Object.hasOwn(obj, k)) return void problems.push(`${where}: missing`);
    const v = obj[k];
    if (typeof v !== 'string') return void problems.push(`${where}: not a string`);
    if (v.length === 0) return void problems.push(`${where}: empty`);
    if (v.length > MAX_FIELD_LENGTH) return void problems.push(`${where}: longer than ${MAX_FIELD_LENGTH} characters`);
    if (!PRINTABLE.test(v)) return void problems.push(`${where}: has characters outside printable ASCII`);
    const local = localPathIn(v, []);
    if (local) return void problems.push(`${where}: contains a local path (${local})`);
    const pattern = credentialPatternIn(v);
    if (pattern) return void problems.push(`${where}: contains a secret-shaped value (${pattern})`);
    const shape = Object.hasOwn(SHAPES, k) ? SHAPES[k] : undefined;
    if (shape && !shape.re.test(v)) problems.push(`${where}: ${shape.what}`);
  };
  if (!isObject(raw)) return { ok: false, problems: ['$: not an object'] };
  onlyKnown(raw, TOP_FIELDS, '$');
  for (const k of TOP_FIELDS.filter((f) => f !== 'gpu')) text(raw, k, '$');
  const gpu = own(raw, 'gpu');
  if (!Object.hasOwn(raw, 'gpu')) problems.push('$.gpu: missing');
  else if (!isObject(gpu)) problems.push('$.gpu: not an object');
  else if (Object.hasOwn(gpu, 'unavailable')) {
    onlyKnown(gpu, ['unavailable'], '$.gpu');
    text(gpu, 'unavailable', '$.gpu');
  } else {
    onlyKnown(gpu, GPU_FIELDS, '$.gpu');
    for (const k of GPU_FIELDS) text(gpu, k, '$.gpu');
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, env: raw as unknown as RenderEnvironment };
}

const CLASS_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MATCH_FIELDS = ['os', 'blender', 'engine', 'gpu'] as const;
const CLASS_BLENDER_FIELDS = ['version', 'buildHash'] as const;
const CLASS_GPU_FIELDS = ['backend', 'vendor', 'renderer', 'rendererPrefix', 'version'] as const;
/** A class pins the Blender build as config/blender.json does: the release version (no release type) and the build hash. */
const PINNED_VERSION = /^\d+\.\d+\.\d+$/;
const BUILD_HASH = /^[0-9a-f]{12}$/;
/** A GPU backend as Blender's gpu.platform.backend_type_get() names it (OPENGL, VULKAN, METAL). */
const BACKEND = /^[A-Z][A-Z0-9_]{0,31}$/;

/** Every way one approved class departs from what a class must be (environmentsDocumentProblems). Names, never values. */
function classProblems(c: unknown, at: string, names: Set<string> | null = null): string[] {
  const problems: string[] = [];
  const unknownFields = (o: Record<string, unknown>, allowed: readonly string[], where: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) problems.push(`${where}: unknown field`);
  };
  const pinned = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!isObject(c)) return [`${at}: not an object`];
  unknownFields(c, ['name', 'purpose', 'match'], at);
  const name = own(c, 'name');
  if (typeof name !== 'string' || !CLASS_NAME.test(name)) problems.push(`${at}.name: not a plain class name`);
  else if (names?.has(name)) problems.push(`${at}.name: duplicate`);
  else names?.add(name);
  const purpose = own(c, 'purpose');
  if (purpose !== 'publication' && purpose !== 'proof') problems.push(`${at}.purpose: neither publication nor proof`);
  const m = own(c, 'match');
  if (!isObject(m)) return [...problems, `${at}.match: not an object`];
  unknownFields(m, MATCH_FIELDS, `${at}.match`);
  for (const k of ['os', 'engine'] as const) if (!pinned(own(m, k))) problems.push(`${at}.match.${k}: the class must pin it`);
  // The Blender build this class was qualified on, written as config/blender.json pins it (classBlenderPinProblem).
  const b = own(m, 'blender');
  if (!isObject(b)) problems.push(`${at}.match.blender: the class must pin the Blender build it was qualified on ({ version, buildHash }, as config/blender.json pins it)`);
  else {
    unknownFields(b, CLASS_BLENDER_FIELDS, `${at}.match.blender`);
    const version = own(b, 'version');
    const hash = own(b, 'buildHash');
    if (typeof version !== 'string' || !PINNED_VERSION.test(version)) problems.push(`${at}.match.blender.version: not a Blender release version as config/blender.json pins it (e.g. 5.2.2)`);
    if (typeof hash !== 'string' || !BUILD_HASH.test(hash)) problems.push(`${at}.match.blender.buildHash: not a 12-digit build hash`);
  }
  const g = own(m, 'gpu');
  if (!isObject(g)) return [...problems, `${at}.match.gpu: not an object`];
  unknownFields(g, CLASS_GPU_FIELDS, `${at}.match.gpu`);
  for (const k of CLASS_GPU_FIELDS) if (Object.hasOwn(g, k) && !pinned(g[k])) problems.push(`${at}.match.gpu.${k}: not a string`);
  const backend = own(g, 'backend');
  if (backend === undefined) problems.push(`${at}.match.gpu.backend: the class must pin the GPU backend`);
  else if (pinned(backend) && !BACKEND.test(backend)) problems.push(`${at}.match.gpu.backend: not a GPU backend as Blender names it (e.g. OPENGL)`);
  const renderer = own(g, 'renderer');
  const prefix = own(g, 'rendererPrefix');
  if ((renderer === undefined) === (prefix === undefined)) problems.push(`${at}.match.gpu: pin exactly one of renderer or rendererPrefix`);
  if (purpose === 'publication') {
    // A publication class names one host's GPU exactly (vendor, renderer, driver), never a family of GPUs.
    if (own(g, 'vendor') === undefined) problems.push(`${at}.match.gpu.vendor: a publication class must pin it`);
    if (prefix !== undefined) problems.push(`${at}.match.gpu.rendererPrefix: a publication class pins the exact renderer, never a prefix`);
    if (own(g, 'version') === undefined) problems.push(`${at}.match.gpu.version: a publication class must pin the driver`);
  }
  return problems;
}

/**
 * Every way the approved classes (config/blender-environments.json `classes`) depart from what a class must be: a plain
 * unique name, a purpose, and a match that pins the OS, the Blender build the class was qualified on, the engine, and the
 * GPU by backend and by renderer (or renderer prefix), with no other field; a publication class also pins the GPU vendor,
 * the exact renderer, and the driver. A class that pins nothing would approve anything, so a malformed document (an older
 * shape included) is refused, never read leniently. Own members only: a prototype name is an unknown field.
 */
export function environmentsDocumentProblems(doc: unknown): string[] {
  const classes = own(doc, 'classes');
  if (!Array.isArray(classes) || classes.length === 0) return ['classes: not a non-empty list'];
  const names = new Set<string>();
  return classes.flatMap((c, i) => classProblems(c, `classes[${i}]`, names));
}

const NOT_A_BUILD = '(not a Blender build)';
/** A Blender build as config/blender.json and the classes write it, "5.2.2 (d13f752e3b9c)"; any other value is not echoed. */
const buildText = (version: unknown, hash: unknown): string =>
  typeof version === 'string' && PINNED_VERSION.test(version) && typeof hash === 'string' && BUILD_HASH.test(hash) ? `${version} (${hash})` : NOT_A_BUILD;
/** A class's purpose, when it is one (an unvalidated document's other values are never echoed). */
const purposeOf = (cls: unknown): EnvironmentClassSpec['purpose'] | null => {
  const p = own(cls, 'purpose');
  return p === 'publication' || p === 'proof' ? p : null;
};

/**
 * Whether a class's Blender pin agrees with config/blender.json's. The build a class was qualified on must be the build
 * every render uses: when they disagree, one was changed without the other (a source/config coherence failure that no
 * command repairs), and the class approves nothing. Null when they agree.
 */
export function classBlenderPinProblem(cls: unknown, cfg: BlenderConfig): string | null {
  const b = own(own(cls, 'match'), 'blender');
  const version = own(b, 'version');
  const hash = own(b, 'buildHash');
  // Only a well-formed build agrees: a missing pin never "agrees" with a malformed config.
  if (buildText(version, hash) !== NOT_A_BUILD && version === cfg.blender.version && hash === cfg.blender.buildHash) return null;
  const purpose = purposeOf(cls);
  const kind = purpose ? `${purpose} class` : 'class';
  return `${kind} "${shownClassName(own(cls, 'name'))}" was qualified with Blender build ${buildText(version, hash)}, but the current pinned build is ${buildText(cfg.blender.version, cfg.blender.buildHash)}`;
}

/** classBlenderPinProblem for every approved class, in config order: empty when the classes and config/blender.json agree. */
export function blenderPinProblems(doc: EnvironmentsDocument, cfg: BlenderConfig): string[] {
  const classes = own(doc, 'classes');
  return (Array.isArray(classes) ? classes : []).map((c) => classBlenderPinProblem(c, cfg)).filter((p): p is string => p !== null);
}

/** A render-environment class id: the record (as given) and the render config it rendered with, hashed. */
export function environmentClassId(env: unknown, cfg: BlenderConfig): string {
  return contentAddress({ env, renderConfigSha256: blenderConfigSha256(cfg) }).slice(0, 16);
}

/** One compared fact: what the class pins (null when it pins nothing there) and what the host reported. */
export interface EnvironmentField {
  key: string;
  label: string;
  approved: string | null;
  observed: string;
  changed: boolean;
}

export interface EnvironmentDiff {
  /** The class compared against (its name when it is a plain class name). */
  against: string;
  /** Its purpose, or null for a class without a valid one (never echoed). */
  purpose: EnvironmentClassSpec['purpose'] | null;
  fields: EnvironmentField[];
  /** Labels of the changed fields, in field order (e.g. ["driver"]). */
  changed: string[];
  /**
   * Why the class approves nothing, whatever the host reports: its own schema problems (an older shape, a missing pin),
   * or a Blender pin that disagrees with config/blender.json. Empty for a well-formed, coherent class.
   */
  classProblems: string[];
}

export type EnvironmentStatus = 'APPROVED' | 'UNAPPROVED' | 'INVALID';

export interface EnvironmentClassification {
  status: EnvironmentStatus;
  classId: string;
  /** The approved class, when APPROVED. */
  approvedClass: EnvironmentClassSpec | null;
  /** The class the diff is drawn against: the approved class itself, or the nearest one. */
  nearest: EnvironmentClassSpec | null;
  /** Null for an INVALID record: no diff is drawn from something that is not an environment. */
  diff: EnvironmentDiff | null;
  /** Why an INVALID record is not an environment (field paths, never values). */
  problems: string[];
}

const UNAVAILABLE = '(unavailable)';

/** The facts an operator compares, in a fixed order. The Blender version is compared without its release type ("LTS"). */
function facts(env: RenderEnvironment): { key: string; label: string; observed: string }[] {
  const gpu = Object.hasOwn(env.gpu, 'renderer') ? (env.gpu as Extract<RenderEnvironment['gpu'], { renderer: string }>) : null;
  return [
    { key: 'os', label: 'os', observed: env.os },
    { key: 'blenderVersion', label: 'blender version', observed: env.blenderVersion.split(' ')[0]! },
    { key: 'blenderBuildHash', label: 'blender build', observed: env.blenderBuildHash },
    { key: 'engine', label: 'engine', observed: env.engine },
    { key: 'gpu.vendor', label: 'gpu vendor', observed: gpu?.vendor ?? UNAVAILABLE },
    { key: 'gpu.renderer', label: 'gpu', observed: gpu?.renderer ?? UNAVAILABLE },
    { key: 'gpu.version', label: 'driver', observed: gpu?.version ?? UNAVAILABLE },
    { key: 'gpu.backend', label: 'gpu backend', observed: gpu?.backend ?? UNAVAILABLE },
    { key: 'gpu.deviceType', label: 'gpu device type', observed: gpu?.deviceType ?? UNAVAILABLE },
  ];
}

/** The facts (by label) in which two well-formed environment records differ, in field order. */
export function environmentDifferences(a: RenderEnvironment, b: RenderEnvironment): string[] {
  const other = new Map(facts(b).map((f) => [f.key, f.observed]));
  return facts(a)
    .filter((f) => other.get(f.key) !== f.observed)
    .map((f) => f.label);
}

/** What a required pin shows when a class lacks it: never a wildcard, always a changed field. */
const NOT_PINNED = '(not pinned: the class is incomplete)';

/**
 * What a class pins for one fact, and whether an observed value satisfies it; null when it pins nothing there. The OS,
 * the Blender version and build, the engine, the GPU backend, and the renderer are pins every class carries
 * (environmentsDocumentProblems): one that is missing fails instead of matching anything. Own members only.
 */
function pin(cls: EnvironmentClassSpec, key: string): { show: string; ok: (v: string) => boolean } | null {
  const m = own(cls, 'match');
  const gpu = own(m, 'gpu');
  const blender = own(m, 'blender');
  const exact = (want: unknown) => (typeof want === 'string' && want.length > 0 ? { show: want, ok: (v: string) => v === want } : null);
  const required = (want: unknown) => exact(want) ?? { show: NOT_PINNED, ok: () => false };
  // A malformed Blender or backend pin is no pin (and is never echoed): environmentsDocumentProblems names it.
  const shaped = (want: unknown, re: RegExp) => required(typeof want === 'string' && re.test(want) ? want : undefined);
  switch (key) {
    case 'os':
      return required(own(m, 'os'));
    case 'blenderVersion':
      return shaped(own(blender, 'version'), PINNED_VERSION);
    case 'blenderBuildHash':
      return shaped(own(blender, 'buildHash'), BUILD_HASH);
    case 'engine':
      return required(own(m, 'engine'));
    case 'gpu.vendor':
      return exact(own(gpu, 'vendor'));
    case 'gpu.renderer': {
      const renderer = exact(own(gpu, 'renderer'));
      if (renderer) return renderer;
      const prefix = own(gpu, 'rendererPrefix');
      return typeof prefix === 'string' && prefix.length > 0 ? { show: `${prefix}*`, ok: (v: string) => v !== UNAVAILABLE && v.startsWith(prefix) } : required(undefined);
    }
    case 'gpu.version':
      return exact(own(gpu, 'version'));
    case 'gpu.backend':
      return shaped(own(gpu, 'backend'), BACKEND);
    default:
      return null;
  }
}

function diffAgainst(env: RenderEnvironment, cls: EnvironmentClassSpec, at: string, cfg: BlenderConfig): EnvironmentDiff {
  const gpuReported = Object.hasOwn(env.gpu, 'renderer');
  const fields = facts(env).map((f): EnvironmentField => {
    const p = pin(cls, f.key);
    // A class approves only a host that reports its GPU: without one, every GPU field it pins, and the renderer always, changed.
    if (!gpuReported && f.key.startsWith('gpu.') && (p || f.key === 'gpu.renderer')) return { ...f, approved: p?.show ?? '(a reported GPU)', changed: true };
    return { ...f, approved: p?.show ?? null, changed: p ? !p.ok(f.observed) : false };
  });
  // A malformed class approves nothing; a well-formed one only while its Blender pin is config/blender.json's.
  const structural = classProblems(cls, at);
  const coherence = structural.length === 0 ? classBlenderPinProblem(cls, cfg) : null;
  return {
    against: shownClassName(own(cls, 'name')),
    purpose: purposeOf(cls),
    fields,
    changed: fields.filter((f) => f.changed).map((f) => f.label),
    classProblems: coherence ? [coherence] : structural,
  };
}

/**
 * Classify a recorded render environment. APPROVED: the record is exactly the closed schema and some well-formed,
 * coherent approved class pins nothing it contradicts (the first such class, in config order). UNAPPROVED: a well-formed
 * record no class approves, diffed against the class that differs in the fewest fields (`prefer` wins a tie, then config
 * order). INVALID: not a well-formed record.
 */
export function classifyEnvironment(raw: unknown, cfg: BlenderConfig, approved: EnvironmentsDocument, opts: { prefer?: EnvironmentClassSpec['purpose'] } = {}): EnvironmentClassification {
  const classId = environmentClassId(raw, cfg);
  const parsed = parseRenderEnvironment(raw);
  if (!parsed.ok) return { status: 'INVALID', classId, approvedClass: null, nearest: null, diff: null, problems: parsed.problems };
  // The classes as plain data, read once: the schema check and the match see the same values (a getter answers once, an
  // inherited member is gone, an own "__proto__" stays data), and an entry that is not an object is a class problem.
  const listed = own(approved, 'classes');
  const classes = (Array.isArray(listed) ? JSON.parse(JSON.stringify(listed)) : []) as EnvironmentClassSpec[];
  const diffs = classes.map((c, i) => diffAgainst(parsed.env, c, `classes[${i}]`, cfg));
  const hit = diffs.findIndex((d) => d.changed.length === 0 && d.classProblems.length === 0);
  if (hit >= 0) return { status: 'APPROVED', classId, approvedClass: classes[hit]!, nearest: classes[hit]!, diff: diffs[hit]!, problems: [] };
  const prefer = opts.prefer ?? 'publication';
  let best = -1;
  diffs.forEach((d, i) => {
    const b = best >= 0 ? diffs[best]! : null;
    const fewer = b === null || d.changed.length < b.changed.length;
    const tieWon = b !== null && d.changed.length === b.changed.length && purposeOf(classes[i]) === prefer && purposeOf(classes[best]) !== prefer;
    if (fewer || tieWon) best = i;
  });
  return { status: 'UNAPPROVED', classId, approvedClass: null, nearest: best >= 0 ? classes[best]! : null, diff: best >= 0 ? diffs[best]! : null, problems: [] };
}

/** The diff as an operator reads it: what the class pins, what the host reported, the changed fields, and why a class approves nothing. */
export function formatEnvironmentDiff(d: EnvironmentDiff): string {
  return [
    `approved (${d.against}, ${d.purpose ?? 'not a valid purpose'}):`,
    ...d.fields.filter((f) => f.approved !== null).map((f) => `  ${f.label}: ${f.approved}`),
    'observed:',
    ...d.fields.map((f) => `  ${f.label}: ${f.observed}`),
    'changed:',
    ...(d.changed.length > 0 ? d.changed.map((c) => `  ${c}`) : ['  (none)']),
    ...(d.classProblems.length > 0 ? ['the class approves nothing:', ...d.classProblems.map((p) => `  ${p}`)] : []),
  ].join('\n');
}

/**
 * publication:proof's environment step, before the whole video is rendered: is the environment the invariants just
 * rendered in an approved publication class? The lines to print say what changed and what to do; nothing is approved.
 */
export function publicationEnvironmentCheck(record: unknown, cfg: BlenderConfig, envs: EnvironmentsDocument): { ok: boolean; lines: string[] } {
  const c = classifyEnvironment(record, cfg, envs, { prefer: 'publication' });
  if (c.status === 'APPROVED' && c.approvedClass?.purpose === 'publication') return { ok: true, lines: [`render environment ${c.classId}: ${c.approvedClass.name} (publication)`] };
  if (c.status === 'APPROVED') {
    // An approved class that is not for publication (the CI proof class): this is not the production host.
    const listed = own(envs, 'classes');
    const publication = classifyEnvironment(record, cfg, { ...envs, classes: (Array.isArray(listed) ? listed : []).filter((x) => purposeOf(x) === 'publication') });
    return {
      ok: false,
      lines: [`this host's render environment is the approved ${c.approvedClass!.name} class (${c.approvedClass!.purpose}): it renders proof frames, never a publication`, ...(publication.diff ? [formatEnvironmentDiff(publication.diff)] : []), 'Run the publication proof on the production render host (docs/PUBLICATION.md).'],
    };
  }
  return {
    ok: false,
    lines: [
      `this host's render environment is not an approved publication class (${environmentSummary(c)})`,
      ...(c.diff ? [formatEnvironmentDiff(c.diff)] : []),
      'The whole video was not rendered. If the change is expected (a driver, Blender, graphics runtime, or OS update),',
      'requalify this host:  npm run blender:qualify-production',
      'and have a human review its candidate evidence. Approval is a reviewed change to config/blender-environments.json;',
      'no command makes it (docs/PUBLICATION.md).',
    ],
  };
}

/** A recorded class id or name, as a finding may echo it: only when it plainly is one (a forged label is never printed). */
export const shownClassId = (v: unknown): string => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '(not a class id)');
export const shownClassName = (v: unknown): string => (v === null ? 'none' : typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v) ? v : '(not a class name)');

/** One line for a finding or a log: the class, and what changed against the nearest approved class. */
export function environmentSummary(c: EnvironmentClassification): string {
  if (c.status === 'INVALID') return `not a render-environment record (${c.problems.join('; ')})`;
  if (c.status === 'APPROVED') return `approved as ${c.approvedClass!.name} (${c.approvedClass!.purpose})`;
  if (!c.diff) return 'no approved class to compare with';
  const changes = c.diff.fields.filter((f) => f.changed).map((f) => `${f.label} ${f.approved ?? '(any)'} -> ${f.observed}`);
  const why = c.diff.classProblems.length > 0 ? `; the class approves nothing: ${c.diff.classProblems.join('; ')}` : '';
  return `not approved; nearest approved class ${c.diff.against} (${c.diff.purpose ?? 'not a valid purpose'}); changed: ${changes.join(', ') || 'nothing it pins'}${why}`;
}

/**
 * Why a proof run may not become the cross-class reference (scripts/blender-proof.ts export-reference), or null. Its
 * class is re-derived from its own record with this checkout's classes and Blender pin: it must be a publication class,
 * and the very class id and name the run recorded. A label, or one recorded before a class changed, is never enough.
 */
export function referenceExportProblem(run: { environment: unknown; environmentClass: unknown; approvedClass: unknown }, cfg: BlenderConfig, envs: EnvironmentsDocument): string | null {
  const c = classifyEnvironment(run.environment, cfg, envs, { prefer: 'publication' });
  if (c.status !== 'APPROVED' || c.approvedClass!.purpose !== 'publication') return `it was not rendered in an approved publication class (${environmentSummary(c)})`;
  if (c.classId !== run.environmentClass || c.approvedClass!.name !== run.approvedClass) return `its recorded class ${shownClassId(run.environmentClass)} (${shownClassName(run.approvedClass)}) is not what its record derives (${c.classId}, ${c.approvedClass!.name})`;
  return null;
}
