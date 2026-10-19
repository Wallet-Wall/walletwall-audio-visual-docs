// The render environment Blender records for every render (render.py render_environment()), as a CLOSED schema;
// the approved class it falls in (config/blender-environments.json); and, when it falls in none, a deterministic
// diff against the nearest approved class, so an operator reads "changed: driver" rather than "unapproved".
//
// A class approves an environment exactly when the diff against it has no changed field: the decision and the
// explanation are one computation and cannot disagree. Every class also requires the Blender build that
// config/blender.json pins, so another Blender is another environment even where the GPU fields match.
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
    if (!(k in obj)) return void problems.push(`${where}: missing`);
    const v = obj[k];
    if (typeof v !== 'string') return void problems.push(`${where}: not a string`);
    if (v.length === 0) return void problems.push(`${where}: empty`);
    if (v.length > MAX_FIELD_LENGTH) return void problems.push(`${where}: longer than ${MAX_FIELD_LENGTH} characters`);
    if (!PRINTABLE.test(v)) return void problems.push(`${where}: has characters outside printable ASCII`);
    const local = localPathIn(v, []);
    if (local) return void problems.push(`${where}: contains a local path (${local})`);
    const pattern = credentialPatternIn(v);
    if (pattern) return void problems.push(`${where}: contains a secret-shaped value (${pattern})`);
    const shape = SHAPES[k];
    if (shape && !shape.re.test(v)) problems.push(`${where}: ${shape.what}`);
  };
  if (!isObject(raw)) return { ok: false, problems: ['$: not an object'] };
  onlyKnown(raw, TOP_FIELDS, '$');
  for (const k of TOP_FIELDS.filter((f) => f !== 'gpu')) text(raw, k, '$');
  const gpu = raw.gpu;
  if (!('gpu' in raw)) problems.push('$.gpu: missing');
  else if (!isObject(gpu)) problems.push('$.gpu: not an object');
  else if ('unavailable' in gpu) {
    onlyKnown(gpu, ['unavailable'], '$.gpu');
    text(gpu, 'unavailable', '$.gpu');
  } else {
    onlyKnown(gpu, GPU_FIELDS, '$.gpu');
    for (const k of GPU_FIELDS) text(gpu, k, '$.gpu');
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, env: raw as unknown as RenderEnvironment };
}

/**
 * Every way the approved classes (config/blender-environments.json `classes`) depart from what a class must be: a plain
 * unique name, a purpose, and a match that pins the OS, the engine, and the GPU by renderer (or renderer prefix), with no
 * other field. A class that pins nothing would approve anything, so a malformed document is refused, never read leniently.
 */
export function environmentsDocumentProblems(doc: unknown): string[] {
  const problems: string[] = [];
  const classes = isObject(doc) && Array.isArray(doc.classes) ? doc.classes : null;
  if (!classes || classes.length === 0) return ['classes: not a non-empty list'];
  const names = new Set<string>();
  classes.forEach((c, i) => {
    const at = `classes[${i}]`;
    if (!isObject(c)) return void problems.push(`${at}: not an object`);
    for (const k of Object.keys(c)) if (!['name', 'purpose', 'match'].includes(k)) problems.push(`${at}: unknown field`);
    if (typeof c.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.name)) problems.push(`${at}.name: not a plain class name`);
    else if (names.has(c.name)) problems.push(`${at}.name: duplicate`);
    else names.add(c.name);
    if (c.purpose !== 'publication' && c.purpose !== 'proof') problems.push(`${at}.purpose: neither publication nor proof`);
    const m = c.match;
    if (!isObject(m)) return void problems.push(`${at}.match: not an object`);
    for (const k of Object.keys(m)) if (!['os', 'engine', 'gpu'].includes(k)) problems.push(`${at}.match: unknown field`);
    for (const k of ['os', 'engine'] as const) if (typeof m[k] !== 'string' || (m[k] as string).length === 0) problems.push(`${at}.match.${k}: the class must pin it`);
    const g = m.gpu;
    if (!isObject(g)) return void problems.push(`${at}.match.gpu: not an object`);
    for (const k of Object.keys(g)) if (!['vendor', 'renderer', 'rendererPrefix', 'version'].includes(k)) problems.push(`${at}.match.gpu: unknown field`);
    for (const [k, v] of Object.entries(g)) if (typeof v !== 'string' || v.length === 0) problems.push(`${at}.match.gpu.${k}: not a string`);
    if ((g.renderer === undefined) === (g.rendererPrefix === undefined)) problems.push(`${at}.match.gpu: pin exactly one of renderer or rendererPrefix`);
  });
  return problems;
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
  /** The class compared against. */
  against: string;
  purpose: EnvironmentClassSpec['purpose'];
  fields: EnvironmentField[];
  /** Labels of the changed fields, in field order (e.g. ["driver"]). */
  changed: string[];
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

/** The facts an operator compares, in a fixed order. */
function facts(env: RenderEnvironment): { key: string; label: string; observed: string }[] {
  const gpu = 'renderer' in env.gpu ? env.gpu : null;
  return [
    { key: 'os', label: 'os', observed: env.os },
    { key: 'blender', label: 'blender', observed: `${env.blenderVersion.split(' ')[0]} (${env.blenderBuildHash})` },
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

/** What a class pins for one fact, and whether an observed value satisfies it; null when it pins nothing there. */
function pin(cls: EnvironmentClassSpec, cfg: BlenderConfig, key: string): { show: string; ok: (v: string) => boolean } | null {
  const m = cls.match;
  const exact = (want: string | undefined) => (want === undefined ? null : { show: want, ok: (v: string) => v === want });
  switch (key) {
    case 'os':
      return exact(m.os);
    case 'blender':
      return exact(`${cfg.blender.version} (${cfg.blender.buildHash})`);
    case 'engine':
      return exact(m.engine);
    case 'gpu.vendor':
      return exact(m.gpu.vendor);
    case 'gpu.renderer': {
      if (m.gpu.renderer !== undefined) return exact(m.gpu.renderer);
      const prefix = m.gpu.rendererPrefix;
      return prefix === undefined ? null : { show: `${prefix}*`, ok: (v: string) => v !== UNAVAILABLE && v.startsWith(prefix) };
    }
    case 'gpu.version':
      return exact(m.gpu.version);
    default:
      return null;
  }
}

function diffAgainst(env: RenderEnvironment, cls: EnvironmentClassSpec, cfg: BlenderConfig): EnvironmentDiff {
  const gpuReported = 'renderer' in env.gpu;
  const fields = facts(env).map((f): EnvironmentField => {
    const p = pin(cls, cfg, f.key);
    // A class approves only a host that reports its GPU, whatever else it pins.
    if (!p && f.key === 'gpu.renderer' && !gpuReported) return { ...f, approved: '(a reported GPU)', changed: true };
    return { ...f, approved: p?.show ?? null, changed: p ? !p.ok(f.observed) : false };
  });
  return { against: cls.name, purpose: cls.purpose, fields, changed: fields.filter((f) => f.changed).map((f) => f.label) };
}

/**
 * Classify a recorded render environment. APPROVED: the record is exactly the closed schema and some approved class
 * pins nothing it contradicts (the first such class, in config order). UNAPPROVED: a well-formed record no class
 * approves, diffed against the class that differs in the fewest fields (`prefer` wins a tie, then config order).
 * INVALID: not a well-formed record.
 */
export function classifyEnvironment(raw: unknown, cfg: BlenderConfig, approved: EnvironmentsDocument, opts: { prefer?: EnvironmentClassSpec['purpose'] } = {}): EnvironmentClassification {
  const classId = environmentClassId(raw, cfg);
  const parsed = parseRenderEnvironment(raw);
  if (!parsed.ok) return { status: 'INVALID', classId, approvedClass: null, nearest: null, diff: null, problems: parsed.problems };
  const diffs = approved.classes.map((c) => diffAgainst(parsed.env, c, cfg));
  const hit = diffs.findIndex((d) => d.changed.length === 0);
  if (hit >= 0) return { status: 'APPROVED', classId, approvedClass: approved.classes[hit]!, nearest: approved.classes[hit]!, diff: diffs[hit]!, problems: [] };
  const prefer = opts.prefer ?? 'publication';
  let best = -1;
  diffs.forEach((d, i) => {
    const b = best >= 0 ? diffs[best]! : null;
    const fewer = b === null || d.changed.length < b.changed.length;
    const tieWon = b !== null && d.changed.length === b.changed.length && approved.classes[i]!.purpose === prefer && approved.classes[best]!.purpose !== prefer;
    if (fewer || tieWon) best = i;
  });
  return { status: 'UNAPPROVED', classId, approvedClass: null, nearest: best >= 0 ? approved.classes[best]! : null, diff: best >= 0 ? diffs[best]! : null, problems: [] };
}

/** The diff as an operator reads it: what the class pins, what the host reported, and the changed fields. */
export function formatEnvironmentDiff(d: EnvironmentDiff): string {
  return [
    `approved (${d.against}, ${d.purpose}):`,
    ...d.fields.filter((f) => f.approved !== null).map((f) => `  ${f.label}: ${f.approved}`),
    'observed:',
    ...d.fields.map((f) => `  ${f.label}: ${f.observed}`),
    'changed:',
    ...(d.changed.length > 0 ? d.changed.map((c) => `  ${c}`) : ['  (none)']),
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
    const publication = classifyEnvironment(record, cfg, { ...envs, classes: envs.classes.filter((x) => x.purpose === 'publication') });
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
  return `not approved; nearest approved class ${c.diff.against} (${c.diff.purpose}); changed: ${changes.join(', ')}`;
}
