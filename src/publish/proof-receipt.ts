// The publication proof receipt (walletwall.publication-proof-receipt/v2): one small, deterministic, machine-readable
// document, written last by `npm run publication:proof` on the production render host, that answers "what exact
// bytes, identities, environment, and gates produced this approved publication candidate?". It binds the video bytes,
// the spec and its canonical docs identity, the build identity, the motion engine and MotionPlan, the Blender
// character (canonical model, materials, config, lane source, this host's realization), the render environment and
// the approved publication class it falls in, Remotion, the narration (for publication narration: the verified
// narration set's identity, provider, model, voice, identity, language, binding, synthesis config, script, chunk plan,
// and audio hashes; v2) and captions, every file of the proof package, and each required gate together with the
// evidence it passed on.
//
// Identity: receiptSha256 = sha256 of the canonical JSON (sorted keys) of { schema, subject }. Key order never
// matters. `informational.writtenAt`, the only wall-clock value, sits outside the subject and is never hashed; the
// subject holds no timestamp, render timing, local path, host or user name, environment variable, or subprocess
// output (the shared leak policy, src/core/leak-scan.ts, refuses all of them).
//
// Nothing in a receipt is trusted for what it says. verifyReceipt re-derives the subject: from this checkout (the
// spec, build identity, motion engine, MotionPlan, character pins, the environment's class, the captions, the
// invariants' frames) and, with the proof package beside it, from the package (it re-runs the public-output gate on
// the package as bundled, re-hashes every file, refuses any file it does not bind, and re-derives Blender's per-frame
// render content and the invariants evidence). A gate's PASS is never a stored boolean: each is re-derived from the
// evidence it names. Node-only.

import { linkSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { classifyEnvironment, environmentSummary, parseRenderEnvironment, shownClassId, shownClassName } from '../blender/environment.ts';
import { presentationHashes } from '../blender/identity.ts';
import { invariantsBarProblems, PUBLICATION_STRIDE } from '../blender/invariants-policy.ts';
import { lessonBridge, lessonBridgeFor, lessonTerrain, strideFrames, type LessonMotion } from '../blender/lesson.ts';
import { characterShots } from '../blender/production.ts';
import { findRevealSeam } from '../blender/reveal.ts';
import { renderContentSha256 } from '../blender/stage.ts';
import { loadBlenderConfig } from '../blender/toolchain.ts';
import { BLENDER_MOTION_SCHEMA } from '../character/walletwallaby/blender/bridge.ts';
import { canonicalJson, prettyJson } from '../core/canonical-json.ts';
import { readContainedFile, realPathOrNull } from '../core/contained-read.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { localPathIn, machineNameIn, credentialPatternIn } from '../core/leak-scan.ts';
import type { BuildIdentity } from '../manifest/build-identity.ts';
import type { MotionEngineIdentity } from '../motion/engine-identity.ts';
import type { PublicationNarrationRef } from '../timeline/timeline.ts';
import { checkPublicOutput, jsonStrings, type PublicState } from './public-output.ts';

export const RECEIPT_SCHEMA = 'walletwall.publication-proof-receipt/v2';
/** The receipt, at the root of the proof package (dist/publication-proof/). */
export const RECEIPT_FILE = 'publication-proof-receipt.json';
/** The public-output gate's report, as writeReviewBundle leaves it at the package root. */
export const GATE_REPORT_FILE = 'public-output-check.json';
/** The ported invariants' report, as scripts/blender-invariants.ts wrote it. */
export const INVARIANTS_EVIDENCE = 'evidence/blender-invariants.json';
export const INVARIANTS_SCHEMA = 'walletwall.blender-invariants/v2';
/** Blender's render manifests, without their timings: one per character sequence and depth reveal. */
export const BLENDER_EVIDENCE_DIR = 'evidence/blender';
export const BLENDER_EVIDENCE_SCHEMA = 'walletwall.blender-render-evidence/v1';
/** The required gates, in the order publication:proof runs them. */
export const REQUIRED_GATES = ['validate', 'blender-invariants', 'render', 'publish-dry-run', 'public-output'] as const;
export type GateName = (typeof REQUIRED_GATES)[number];
/** The publication stride of the ported invariants (scripts/blender-invariants.ts defaults: every 9th frame, every lab frame). */
// The publication stride of the ported invariants is src/blender/invariants-policy.ts PUBLICATION_STRIDE.
const COMPOSITION_ID = 'WalletWallDocsVideo';
const BLENDER_RENDER_SCHEMA = 'walletwall.blender-render/v1';
const MAX_RECEIPT_BYTES = 1 << 20;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const NAME = /^[a-z0-9][a-z0-9.-]{0,80}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

export interface ReceiptFile {
  /** Path inside the proof package, POSIX, relative. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface ReceiptGate {
  gate: GateName;
  result: 'PASS';
  /** The package files the result is re-derived from. */
  evidence: string[];
}

export interface ReceiptSubject {
  video: {
    videoId: string;
    revision: number;
    specHash: string;
    source: { docPath: string; docUrl: string; docBlob: string; contentHash: string };
    file: ReceiptFile;
    frames: number;
    durationMs: number;
    fps: number;
    width: number;
    height: number;
  };
  build: { identitySha256: string; identity: BuildIdentity };
  motion: { engine: MotionEngineIdentity; planSha256: string };
  character: {
    layout: 'crop' | 'full-frame';
    /** The Blender identity the frames were made with (src/blender/identity.ts), less the .blend cache's bytes. */
    identity: Record<string, string | number | null>;
    sequence: { renderSha256: string; bridgeSha256: string; frames: number; evidence: string };
    reveals: { range: { first: number; last: number }; renderSha256: string; bridgeSha256: string; frames: number; evidence: string }[];
  };
  renderEnvironment: { classId: string; approvedClass: string; purpose: 'publication'; record: Record<string, unknown> };
  remotion: { version: string; compositionId: string };
  narration: { providerId: string; estimated: boolean; audio: 'NONE' | 'PRESENT'; publication: PublicationNarrationRef | null };
  captions: { vtt: string; srt: string };
  invariants: { evidence: string; motionEngine: 'typescript' | 'rust-wasm'; every: number; labEvery: number; lessonFrames: number[]; lessonBridgeSha256: string; pass: true };
  /** Every file of the proof package but the receipt, by path. */
  files: ReceiptFile[];
  gates: ReceiptGate[];
}

export interface PublicationProofReceipt {
  schema: typeof RECEIPT_SCHEMA;
  receiptSha256: string;
  subject: ReceiptSubject;
  /** Never part of the identity. */
  informational: { writtenAt: string };
}

/** Stable codes: an operator and a reviewer act on these, not on prose. */
export const RECEIPT_CODES = {
  RECEIPT_UNREADABLE: 'The receipt is missing, a link, too large, or not JSON.',
  RECEIPT_SCHEMA: 'The receipt is not exactly walletwall.publication-proof-receipt/v1 (an unknown, missing, or mistyped field).',
  RECEIPT_IDENTITY: 'receiptSha256 is not the hash of the subject: the receipt was edited after it was written.',
  RECEIPT_LEAK: 'The receipt or its evidence names a local path, a secret-shaped value, or this machine.',
  CHECKOUT_MISMATCH: 'A field is not what this checkout derives (spec, build identity, motion, MotionPlan, character, captions, or narration).',
  ENVIRONMENT_NOT_PUBLICATION: 'The render environment is not an approved publication class, or its recorded class is not what its record derives.',
  GATES_INCOMPLETE: 'The required gates are not all present, in order, each passed on the evidence it names.',
  PACKAGE_INVALID: 'The proof package fails the public-output gate, lacks a file the receipt binds, or holds one it does not.',
  EVIDENCE_INVALID: "Evidence (the ported invariants' report, Blender's render manifests) is missing, stale, failed, or not what the render recorded.",
  FIELD_MISMATCH: 'A field differs from what the proof package derives.',
} as const;
export type ReceiptFindingCode = keyof typeof RECEIPT_CODES;

export interface ReceiptFinding {
  code: ReceiptFindingCode;
  /** A JSON path in the receipt (subject.…), or a path inside the proof package. Never an absolute path. */
  path: string;
  message: string;
}

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptError';
  }
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The receipt's identity: the hash of its schema and subject, in canonical JSON. Never the informational block. */
export function receiptIdentity(subject: ReceiptSubject): string {
  return contentAddress({ schema: RECEIPT_SCHEMA, subject });
}

// ── The closed schema ───────────────────────────────────────────────────────────────────────────────

type Shape = 'string' | 'hex64' | 'int' | 'number' | 'bool' | 'iso' | 'json' | { const: string | boolean } | { enum: readonly string[] } | { obj: Record<string, Shape> } | { arr: Shape } | { nullable: Shape };

const FILE: Shape = { obj: { path: 'string', sha256: 'hex64', bytes: 'int' } };
const CHARACTER_IDENTITY: Shape = {
  obj: {
    schema: { const: 'walletwall.blender-identity/v1' },
    blenderVersion: 'string',
    blenderBuildHash: 'string',
    blenderConfigSha256: 'hex64',
    blenderSceneSourceSha256: 'hex64',
    walletwallabyModelVersion: 'int',
    walletwallabyModelSha256: 'hex64',
    walletwallabyRealizationSha256: 'hex64',
    walletwallabyRigVersion: 'int',
    materialsVersion: 'int',
    materialsSha256: 'hex64',
    motionBridgeSchema: 'string',
    motionPlanSha256: 'hex64',
    terrainSha256: { nullable: 'hex64' },
    cameraDefinitionSha256: 'hex64',
    renderSettingsSha256: 'hex64',
  },
};
/** Publication narration's identity (src/timeline/timeline.ts PublicationNarrationRef); null for the fixture voice. */
const NARRATION_REF: Shape = {
  nullable: {
    obj: {
      identity: 'hex64',
      provider: 'string',
      bindingId: 'string',
      modelId: 'string',
      voiceId: 'string',
      voiceIdentityId: 'string',
      language: 'string',
      bindingSha256: 'hex64',
      synthesisConfigSha256: 'hex64',
      scriptSha256: 'hex64',
      chunkPlanSha256: 'hex64',
      audioSha256: 'hex64',
    },
  },
};
const RECEIPT_SHAPE: Shape = {
  obj: {
    schema: { const: RECEIPT_SCHEMA },
    receiptSha256: 'hex64',
    subject: {
      obj: {
        video: {
          obj: {
            videoId: 'string',
            revision: 'int',
            specHash: 'hex64',
            source: { obj: { docPath: 'string', docUrl: 'string', docBlob: 'string', contentHash: 'hex64' } },
            file: FILE,
            frames: 'int',
            durationMs: 'number',
            fps: 'int',
            width: 'int',
            height: 'int',
          },
        },
        build: { obj: { identitySha256: 'hex64', identity: 'json' } },
        motion: { obj: { engine: 'json', planSha256: 'hex64' } },
        character: {
          obj: {
            layout: { enum: ['crop', 'full-frame'] },
            identity: CHARACTER_IDENTITY,
            sequence: { obj: { renderSha256: 'hex64', bridgeSha256: 'hex64', frames: 'int', evidence: 'string' } },
            reveals: { arr: { obj: { range: { obj: { first: 'int', last: 'int' } }, renderSha256: 'hex64', bridgeSha256: 'hex64', frames: 'int', evidence: 'string' } } },
          },
        },
        renderEnvironment: { obj: { classId: 'string', approvedClass: 'string', purpose: { const: 'publication' }, record: 'json' } },
        remotion: { obj: { version: 'string', compositionId: 'string' } },
        narration: { obj: { providerId: 'string', estimated: 'bool', audio: { enum: ['NONE', 'PRESENT'] }, publication: NARRATION_REF } },
        captions: { obj: { vtt: 'hex64', srt: 'hex64' } },
        invariants: { obj: { evidence: 'string', motionEngine: { enum: ['typescript', 'rust-wasm'] }, every: 'int', labEvery: 'int', lessonFrames: { arr: 'int' }, lessonBridgeSha256: 'hex64', pass: { const: true } } },
        files: { arr: FILE },
        gates: { arr: { obj: { gate: { enum: REQUIRED_GATES }, result: { const: 'PASS' }, evidence: { arr: 'string' } } } },
      },
    },
    informational: { obj: { writtenAt: 'iso' } },
  },
};

/** Every way `value` departs from `shape`, by JSON path. Strings are bounded; nothing unknown is allowed anywhere. */
function shapeProblems(value: unknown, shape: Shape, at: string, out: string[]): void {
  if (typeof shape === 'object' && 'nullable' in shape) {
    if (value !== null) shapeProblems(value, shape.nullable, at, out);
    return;
  }
  if (shape === 'json') return; // compared whole against this checkout's own value, so it is closed by equality
  if (shape === 'string' || shape === 'hex64' || shape === 'iso') {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512) return void out.push(`${at}: not a string of 1..512 characters`);
    if (shape === 'hex64' && !/^[0-9a-f]{64}$/.test(value)) out.push(`${at}: not a sha256`);
    if (shape === 'iso' && !ISO_UTC.test(value)) out.push(`${at}: not an ISO-8601 UTC time`);
    return;
  }
  if (shape === 'int') return void (Number.isSafeInteger(value) ? undefined : out.push(`${at}: not an integer`));
  if (shape === 'number') return void (typeof value === 'number' && Number.isFinite(value) ? undefined : out.push(`${at}: not a number`));
  if (shape === 'bool') return void (typeof value === 'boolean' ? undefined : out.push(`${at}: not a boolean`));
  if ('const' in shape) return void (value === shape.const ? undefined : out.push(`${at}: is not ${JSON.stringify(shape.const)}`));
  if ('enum' in shape) return void (typeof value === 'string' && shape.enum.includes(value) ? undefined : out.push(`${at}: is not one of ${shape.enum.join(', ')}`));
  if ('arr' in shape) {
    if (!Array.isArray(value)) return void out.push(`${at}: not an array`);
    value.forEach((v, i) => shapeProblems(v, shape.arr, `${at}[${i}]`, out));
    return;
  }
  if (!isObject(value)) return void out.push(`${at}: not an object`);
  // Own keys only: `in` would accept every Object.prototype name (constructor, toString, __proto__) as known.
  for (const k of Object.keys(value)) if (!Object.hasOwn(shape.obj, k)) out.push(/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k) && k !== '__proto__' ? `${at}.${k}: unknown field` : `${at}: an unknown field (its name is not shown)`);
  for (const [k, s] of Object.entries(shape.obj)) {
    if (!Object.hasOwn(value, k)) out.push(`${at}.${k}: missing`);
    else shapeProblems(value[k], s, `${at}.${k}`, out);
  }
}

/** Every `__proto__` member anywhere in a parsed document: never valid, and refused even inside a field compared whole. */
function protoKeys(value: unknown, at: string, out: string[]): void {
  if (Array.isArray(value)) value.forEach((v, i) => protoKeys(v, `${at}[${i}]`, out));
  else if (isObject(value)) {
    for (const k of Object.keys(value)) {
      if (k === '__proto__') out.push(`${at}: an unknown field (its name is not shown)`);
      else protoKeys(value[k], `${at}.${k}`, out);
    }
  }
}

// ── Reading the proof package ───────────────────────────────────────────────────────────────────────

/** A package file by its POSIX path, read through one handle; null if absent, a link anywhere on its path, or not a plain path. */
function readPackageFile(realPackage: string, rel: string): Buffer | null {
  const segments = rel.split('/');
  if (!segments.every((s) => SEGMENT.test(s))) return null;
  const abs = path.join(realPackage, ...segments);
  return readContainedFile(abs, (real) => real === abs);
}

/** A local source file (outside the package), refused if it is a link. */
function readSourceFile(abs: string): Buffer | null {
  const home = realPathOrNull(path.dirname(abs));
  return home ? readContainedFile(abs, (real) => real === path.join(home, path.basename(abs))) : null;
}

const parseObject = (bytes: Buffer | null): Record<string, unknown> | null => {
  if (!bytes) return null;
  try {
    const doc = JSON.parse(bytes.toString('utf8')) as unknown;
    return isObject(doc) ? doc : null;
  } catch {
    return null;
  }
};

/** Every entry of the package: its files by POSIX path, and anything that is neither a file nor a directory. */
function listPackage(realPackage: string): { files: string[]; odd: string[] } {
  const files: string[] = [];
  const odd: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) odd.push(r);
      else if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.isFile()) files.push(r);
      else odd.push(r);
    }
  };
  walk(realPackage, '');
  return { files: files.sort(), odd: odd.sort() };
}

/** The one video directory of a proof package (the gate's bundle holds `<videoId>/…`). */
function packageVideoId(realPackage: string): string {
  const dirs = readdirSync(realPackage, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'evidence').map((e) => e.name);
  if (dirs.length !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(dirs[0]!)) throw new ReceiptError('PACKAGE_INVALID: the proof package does not hold exactly one video directory');
  return dirs[0]!;
}

// ── What a passed proof leaves, and the evidence it is bound to ─────────────────────────────────────

/** What render.json records (scripts/render.ts, walletwall.render-info/v6), as far as the receipt reads it. */
interface RenderRecord {
  output: { path: string; sha256: string };
  fps: number;
  frames: number;
  durationMs: number;
  engine: { name: string; version: string; compositionId: string };
  narration: { providerId: string; estimated: boolean; audio: 'NONE' | 'PRESENT'; publication?: PublicationNarrationRef | null };
  identity: BuildIdentity;
  motionEngine: MotionEngineIdentity;
  character: {
    renderer: string;
    layout: 'crop' | 'full-frame';
    sequence: { name: string; frames: number; renderSha256: string; bridgeSha256: string; environment: { classId: string; approvedClass: string | null; purpose: string | null; record: Record<string, unknown> } };
    reveals: { name: string; range: { first: number; last: number }; frames: number; renderSha256: string; bridgeSha256: string; environment: { classId: string; approvedClass: string | null; purpose: string | null; record: Record<string, unknown> } }[];
    identity: Record<string, string | number | null>;
  };
}

/** Where Blender and the invariants left their records (dist/blender/out on the production render host). */
export interface EvidenceSources {
  /** The ported invariants' report (dist/blender/out/invariants/report.json). */
  invariantsReport: string;
  /** Blender's render manifest of a sequence or depth reveal, by its name (dist/blender/out/renders/<name>/render.json). */
  blenderManifest: (name: string) => string;
}

const blenderEvidencePath = (name: string): string => `${BLENDER_EVIDENCE_DIR}/${name}.json`;

/**
 * Copy the evidence the receipt binds into the proof package, once: the invariants report as written, and each of
 * Blender's render manifests the render used, without timings (each must be, by content, the render render.json
 * recorded). Refuses to overwrite: a proof package is written once, by one run.
 */
export function stageEvidence(packageDir: string, sources: EvidenceSources): void {
  const real = realPathOrNull(packageDir);
  if (!real) throw new ReceiptError('PACKAGE_INVALID: there is no proof package');
  const id = packageVideoId(real);
  const render = parseObject(readPackageFile(real, `${id}/render.json`)) as RenderRecord | null;
  if (!render || !isObject(render.character) || !isObject(render.character.sequence)) throw new ReceiptError(`PACKAGE_INVALID: ${id}/render.json records no Blender character`);
  const records = [render.character.sequence, ...(Array.isArray(render.character.reveals) ? render.character.reveals : [])];
  mkdirSync(path.join(real, ...BLENDER_EVIDENCE_DIR.split('/')), { recursive: true });
  for (const rec of records) {
    if (typeof rec.name !== 'string' || !NAME.test(rec.name)) throw new ReceiptError('EVIDENCE_INVALID: a rendered sequence has no plain name');
    const manifest = parseObject(readSourceFile(sources.blenderManifest(rec.name)));
    if (!manifest || manifest.schema !== BLENDER_RENDER_SCHEMA || !Array.isArray(manifest.shots) || !isObject(manifest.environment)) throw new ReceiptError(`EVIDENCE_INVALID: Blender's render manifest for ${rec.name} is missing or not ${BLENDER_RENDER_SCHEMA}`);
    const shots = (manifest.shots as Record<string, unknown>[]).map((s) => ({ name: s.name as string, frame: s.frame as number, sha256: s.sha256 as string, ...(isObject(s.crop) ? { crop: s.crop } : {}), ...(isObject(s.contactErrorPx) ? { contactErrorPx: s.contactErrorPx } : {}) }));
    if (renderContentSha256({ schema: BLENDER_RENDER_SCHEMA, environment: manifest.environment, shots }) !== rec.renderSha256) throw new ReceiptError(`EVIDENCE_INVALID: Blender's render manifest for ${rec.name} is not the render render.json recorded (renderSha256)`);
    const evidence = { schema: BLENDER_EVIDENCE_SCHEMA, name: rec.name, environment: manifest.environment, shots };
    writeFileSync(path.join(real, ...blenderEvidencePath(rec.name).split('/')), prettyJson(evidence), { flag: 'wx' });
  }
  const invariants = readSourceFile(sources.invariantsReport);
  if (!invariants) throw new ReceiptError('EVIDENCE_INVALID: no ported invariants report (npm run blender:invariants; publication:proof runs it first)');
  writeFileSync(path.join(real, ...INVARIANTS_EVIDENCE.split('/')), invariants, { flag: 'wx' });
}

/** The gates a receipt must carry, with the evidence each is re-derived from. */
function expectedGates(id: string, mp4: string, blenderEvidence: string[]): ReceiptGate[] {
  const p = (f: string) => `${id}/${f}`;
  return [
    { gate: 'validate', result: 'PASS', evidence: [p('validation.json')] },
    { gate: 'blender-invariants', result: 'PASS', evidence: [INVARIANTS_EVIDENCE] },
    { gate: 'render', result: 'PASS', evidence: [p('render.json'), p(mp4), ...blenderEvidence] },
    { gate: 'publish-dry-run', result: 'PASS', evidence: [p('publish-manifest.json'), p('receipt.json'), p('provenance.json'), p('cue-sheet.json'), p('media-qa.json'), p(`${id}.en.vtt`), p(`${id}.en.srt`)] },
    { gate: 'public-output', result: 'PASS', evidence: [GATE_REPORT_FILE] },
  ];
}

/** The Blender identity fields this checkout pins, by key (the realization and terrain are checked elsewhere). */
function pinnedIdentity(state: PublicState): Record<string, string | number> {
  const b = state.identity.character.blender;
  return {
    schema: 'walletwall.blender-identity/v1',
    blenderVersion: b.version,
    blenderBuildHash: b.buildHash,
    blenderConfigSha256: b.configSha256,
    blenderSceneSourceSha256: b.sceneSourceSha256,
    walletwallabyModelVersion: b.model.version,
    walletwallabyModelSha256: b.model.sha256,
    walletwallabyRigVersion: state.identity.character.rig.version,
    materialsVersion: b.materials.version,
    materialsSha256: b.materials.sha256,
    motionBridgeSchema: BLENDER_MOTION_SCHEMA,
    ...presentationHashes(loadBlenderConfig()),
  };
}

/** A shot as the evidence binds it: the frame Blender drew, under the name the plan gives it, and its decided crop. */
type PlannedShot = { name: string; frame: number; crop?: { x: number; y: number; width: number; height: number } };

interface Plan {
  planSha256: string;
  terrainSha256: string;
  reveal: { range: { first: number; last: number }; bridgeSha256: string; shots: PlannedShot[] } | null;
  strideFrames: number[];
  /** The shots a whole-lesson character sequence renders, per layout (src/blender/production.ts characterShots). */
  shots: (layout: 'crop' | 'full-frame') => PlannedShot[];
}

/** Plans this checkout gives, solved once per lesson (state.lesson memoizes the lesson per engine). */
const plans = new WeakMap<LessonMotion, Plan>();
function planOf(lesson: LessonMotion): Plan {
  let p = plans.get(lesson);
  if (!p) {
    const bridge = lessonBridgeFor(lesson, undefined);
    const seam = findRevealSeam(lesson);
    const reveal = seam ? lessonBridge(lesson, seam.first, seam.last) : null;
    const byLayout = new Map<string, PlannedShot[]>();
    p = {
      planSha256: contentAddress(bridge),
      terrainSha256: contentAddress(lessonTerrain(lesson, bridge)),
      reveal: seam && reveal ? { range: { first: seam.first, last: seam.last }, bridgeSha256: contentAddress(reveal), shots: reveal.frames.map((f) => ({ name: `f${String(f.frame).padStart(5, '0')}`, frame: f.frame })) } : null,
      strideFrames: strideFrames(lesson, PUBLICATION_STRIDE.every),
      shots: (layout) => {
        if (!byLayout.has(layout)) byLayout.set(layout, characterShots(bridge, layout, loadBlenderConfig()).map((s) => ({ name: s.name, frame: s.frame, ...(s.camera.kind === 'crop' ? { crop: { x: s.camera.x, y: s.camera.y, width: s.camera.width, height: s.camera.height } } : {}) })));
        return byLayout.get(layout)!;
      },
    };
    plans.set(lesson, p);
  }
  return p;
}

const SHOT_KEYS = ['name', 'frame', 'sha256', 'crop', 'contactErrorPx'];
/** Whether an evidence shot is exactly the closed shape the receipt binds (no timing or other field rides along). */
function plainShot(s: unknown): boolean {
  if (!isObject(s) || Object.keys(s).some((k) => !SHOT_KEYS.includes(k))) return false;
  if (typeof s.name !== 'string' || !Number.isSafeInteger(s.frame) || typeof s.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) return false;
  if (Object.hasOwn(s, 'crop') && !(isObject(s.crop) && Object.keys(s.crop).length === 4 && ['x', 'y', 'width', 'height'].every((k) => Number.isSafeInteger((s.crop as Record<string, unknown>)[k])))) return false;
  return !Object.hasOwn(s, 'contactErrorPx') || (isObject(s.contactErrorPx) && Object.entries(s.contactErrorPx).every(([k, v]) => /^[a-z_]{1,40}$/.test(k) && typeof v === 'number' && Number.isFinite(v)));
}

/** Every local path, secret-shaped value, or name of this machine in a parsed document (values never printed). */
function leakFindings(doc: unknown, where: string, state: PublicState): ReceiptFinding[] {
  const out: ReceiptFinding[] = [];
  for (const [at, text] of jsonStrings(doc)) {
    const local = localPathIn(text, state.localRoots);
    const pattern = credentialPatternIn(text);
    const what = local ? `a local path (${local})` : pattern ? `a secret-shaped value (${pattern})` : machineNameIn(text, state.machineNames) ? "this machine's host or user name" : null;
    if (what) out.push({ code: 'RECEIPT_LEAK', path: `${where}${at.slice(1)}`, message: `${RECEIPT_CODES.RECEIPT_LEAK} It holds ${what}; the value is not printed.` });
  }
  return out;
}

/**
 * The invariants evidence, checked against this checkout's bar (src/blender/invariants-policy.ts), the render's own
 * video, engine, plan, character realization, and environment; findings, or the receipt's block.
 */
function invariantsBlock(doc: Record<string, unknown> | null, state: PublicState, environment: Record<string, unknown>, realization: unknown, engine: 'typescript' | 'rust-wasm'): { block: ReceiptSubject['invariants'] | null; findings: ReceiptFinding[] } {
  const findings: ReceiptFinding[] = [];
  const bad = (message: string) => findings.push({ code: 'EVIDENCE_INVALID', path: INVARIANTS_EVIDENCE, message: `${RECEIPT_CODES.EVIDENCE_INVALID} ${message}` });
  if (!doc) return (bad('it is missing or not JSON'), { block: null, findings });
  if (doc.schema !== INVARIANTS_SCHEMA) bad(`it is not ${INVARIANTS_SCHEMA}`);
  if (doc.videoId !== state.videoId) bad(`it was measured on another video than ${state.videoId}`);
  if (doc.motionEngine !== engine) bad(`it was measured on the ${String(doc.motionEngine).slice(0, 16)} plan, not the render's ${engine} plan`);
  // The bar: the publication stride, this checkout's thresholds and coverage minimums, the tail-release limit, a pass.
  for (const p of invariantsBarProblems(doc)) bad(p);
  if (!Array.isArray(doc.failures) || doc.failures.length !== 0) bad('it records failures');
  const excluded = isObject(doc.excluded) ? doc.excluded.lesson : undefined;
  if (excluded !== undefined && !(Array.isArray(excluded) && excluded.length === 0)) bad('it excludes lesson frames: every measured lesson frame must be bridged');
  const lesson = state.lesson(engine);
  const frames = Array.isArray(doc.lessonFrames) && doc.lessonFrames.every((f) => Number.isSafeInteger(f)) ? (doc.lessonFrames as number[]) : null;
  if (!frames || !same(frames, planOf(lesson).strideFrames)) bad("its lesson frames are not every visible frame at the stride of this checkout's plan");
  else if (doc.lessonBridgeSha256 !== contentAddress(lessonBridgeFor(lesson, frames))) bad("it was measured on another MotionPlan than this checkout's");
  const identity = isObject(doc.identity) ? doc.identity : {};
  for (const [k, v] of Object.entries(pinnedIdentity(state))) if (identity[k] !== v) bad(`it was measured with another ${k}`);
  if (identity.motionPlanSha256 !== doc.lessonBridgeSha256) bad('its identity names another plan than the one it measured');
  if (identity.walletwallabyRealizationSha256 !== realization) bad("it was measured on another host realization of the character than the publication render's");
  const env = isObject(doc.environment) ? doc.environment : {};
  if (!same(env.record, environment)) bad('it was measured in another render environment than the publication render');
  const cls = classifyEnvironment(env.record, state.blenderConfig, state.environments);
  if (cls.classId !== env.classId || (cls.approvedClass?.name ?? null) !== env.approvedClass) bad('its recorded environment class is not what its record derives');
  findings.push(...leakFindings(doc, INVARIANTS_EVIDENCE, state));
  if (findings.length > 0) return { block: null, findings };
  return { block: { evidence: INVARIANTS_EVIDENCE, motionEngine: engine, every: doc.every as number, labEvery: doc.labEvery as number, lessonFrames: frames!, lessonBridgeSha256: doc.lessonBridgeSha256 as string, pass: true }, findings };
}

/**
 * Derive the receipt's subject from a proof package and this checkout. Re-runs the public-output gate on the
 * package as bundled, re-hashes every file and refuses any it would not bind, re-derives Blender's render content and
 * the invariants evidence, and requires one approved publication environment throughout. A subject exists only when
 * every gate passes on its evidence.
 */
export function deriveSubject(packageDir: string, state: PublicState): { subject: ReceiptSubject | null; findings: ReceiptFinding[] } {
  const findings: ReceiptFinding[] = [];
  const pkg = (at: string, message: string) => findings.push({ code: 'PACKAGE_INVALID', path: at, message: `${RECEIPT_CODES.PACKAGE_INVALID} ${message}` });
  const evidenceBad = (at: string, message: string) => findings.push({ code: 'EVIDENCE_INVALID', path: at, message: `${RECEIPT_CODES.EVIDENCE_INVALID} ${message}` });
  const done = () => ({ subject: null, findings });
  const real = realPathOrNull(packageDir);
  if (!real) return (pkg('.', 'there is no proof package beside the receipt'), done());
  const id = state.videoId;
  const spec = state.spec;
  const mp4 = `${id}.r${spec.revision}.mp4`;

  // 1. The public-output gate, re-run on the package exactly as bundled, with the render required.
  const gate = checkPublicOutput(path.join(real, id), state, { requireRender: true });
  for (const f of gate.report.findings) pkg(f.path, `${f.code}: ${f.message}`);
  // 2. Its report, as bundled: a pass, over exactly the files the gate verifies now.
  const report = parseObject(readPackageFile(real, GATE_REPORT_FILE));
  if (!report || report.schema !== 'walletwall.public-output-check/v1' || report.ok !== true || report.errors !== 0 || !same(report.findings, []) || report.videoId !== id) pkg(GATE_REPORT_FILE, 'the bundled gate report is not a pass for this video');
  else if (!same(report.files, gate.report.files)) pkg(GATE_REPORT_FILE, 'the bundled gate report does not list exactly the files the gate verifies now');
  else if (!same(report, gate.report)) pkg(GATE_REPORT_FILE, 'the bundled gate report is not the report the gate gives now');
  if (report) findings.push(...leakFindings(report, GATE_REPORT_FILE, state));
  if (findings.length > 0) return done();

  // 3. What the render recorded (the gate has verified it against this checkout).
  const render = parseObject(readPackageFile(real, `${id}/render.json`)) as unknown as RenderRecord;
  const ch = render.character;
  const records = [ch.sequence, ...ch.reveals];
  const environment = ch.sequence.environment.record;
  for (const [i, r] of records.entries()) if (!same(r.environment, ch.sequence.environment)) pkg(`${id}/render.json`, `character ${i === 0 ? 'sequence' : `reveal ${i - 1}`}: one publication is rendered in one environment`);
  const cls = classifyEnvironment(environment, state.blenderConfig, state.environments);
  if (cls.status !== 'APPROVED' || cls.approvedClass?.purpose !== 'publication') findings.push({ code: 'ENVIRONMENT_NOT_PUBLICATION', path: `${id}/render.json`, message: `${RECEIPT_CODES.ENVIRONMENT_NOT_PUBLICATION} ${environmentSummary(cls)}` });
  if (findings.length > 0) return done();

  // 4. Blender's render manifests, as evidence: by content, the renders render.json recorded, in that environment, and
  // exactly the frames and crops this checkout's plan decides (the sequence in its layout, the reveal's every frame).
  const engine = render.motionEngine.motionEngine;
  const plan = planOf(state.lesson(engine));
  for (const [i, r] of records.entries()) {
    const rel = blenderEvidencePath(r.name);
    const doc = NAME.test(r.name) ? parseObject(readPackageFile(real, rel)) : null;
    if (!doc || doc.schema !== BLENDER_EVIDENCE_SCHEMA || doc.name !== r.name || !Array.isArray(doc.shots) || Object.keys(doc).some((k) => !['schema', 'name', 'environment', 'shots'].includes(k))) {
      evidenceBad(rel, `it is missing or not ${BLENDER_EVIDENCE_SCHEMA}`);
      continue;
    }
    if (!doc.shots.every(plainShot)) {
      evidenceBad(rel, 'a shot carries more than its name, frame, hash, crop, and contact error');
      continue;
    }
    const shots = doc.shots as (PlannedShot & { sha256: string })[];
    if (!same(doc.environment, environment)) evidenceBad(rel, 'Blender recorded another environment than the render');
    if (renderContentSha256({ schema: BLENDER_RENDER_SCHEMA, environment: doc.environment, shots }) !== r.renderSha256 || shots.length !== r.frames) evidenceBad(rel, 'it is not the render render.json recorded');
    const planned = i === 0 ? plan.shots(ch.layout) : (plan.reveal?.shots ?? []);
    if (!same(shots.map((s) => ({ name: s.name, frame: s.frame, ...(s.crop ? { crop: s.crop } : {}) })), planned)) evidenceBad(rel, "its shots are not the frames and crops this checkout's plan decides");
    findings.push(...leakFindings(doc, rel, state));
  }
  // 5. The ported invariants: passed this checkout's bar, at the publication stride, on the render's own plan and
  // character, in this environment.
  const inv = invariantsBlock(parseObject(readPackageFile(real, INVARIANTS_EVIDENCE)), state, environment, ch.identity.walletwallabyRealizationSha256, engine);
  findings.push(...inv.findings);
  if (findings.length > 0) return done();

  // 6. Every file of the package, each bound; nothing else beside the receipt.
  const blenderEvidence = records.map((r) => blenderEvidencePath(r.name));
  const files: ReceiptFile[] = [...gate.report.files];
  for (const rel of [GATE_REPORT_FILE, INVARIANTS_EVIDENCE, ...blenderEvidence]) {
    const bytes = readPackageFile(real, rel);
    if (!bytes) pkg(rel, 'is missing or is a link');
    else files.push({ path: rel, sha256: sha256Hex(bytes), bytes: bytes.length });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const listing = listPackage(real);
  const bound = new Set(files.map((f) => f.path));
  for (const rel of listing.files) if (rel !== RECEIPT_FILE && !bound.has(rel)) pkg(rel, 'is in the package, but no receipt binds it');
  for (const rel of listing.odd) pkg(rel, 'is a link or not a regular file');
  if (findings.length > 0) return done();

  const byPath = new Map(files.map((f) => [f.path, f]));
  const subject: ReceiptSubject = {
    video: {
      videoId: id,
      revision: spec.revision,
      specHash: state.specHash,
      source: { docPath: spec.source.docPath, docUrl: spec.source.docUrl, docBlob: spec.source.blob, contentHash: spec.source.contentHash },
      file: byPath.get(`${id}/${mp4}`)!,
      frames: render.frames,
      durationMs: render.durationMs,
      fps: render.fps,
      width: spec.output.width,
      height: spec.output.height,
    },
    build: { identitySha256: contentAddress(render.identity), identity: render.identity },
    motion: { engine: render.motionEngine, planSha256: ch.sequence.bridgeSha256 },
    character: {
      layout: ch.layout,
      identity: ch.identity,
      sequence: { renderSha256: ch.sequence.renderSha256, bridgeSha256: ch.sequence.bridgeSha256, frames: ch.sequence.frames, evidence: blenderEvidencePath(ch.sequence.name) },
      reveals: ch.reveals.map((r) => ({ range: { first: r.range.first, last: r.range.last }, renderSha256: r.renderSha256, bridgeSha256: r.bridgeSha256, frames: r.frames, evidence: blenderEvidencePath(r.name) })),
    },
    renderEnvironment: { classId: cls.classId, approvedClass: cls.approvedClass!.name, purpose: 'publication', record: environment },
    remotion: { version: render.engine.version, compositionId: render.engine.compositionId },
    narration: { providerId: render.narration.providerId, estimated: render.narration.estimated, audio: render.narration.audio, publication: render.narration.publication ?? null },
    captions: { vtt: byPath.get(`${id}/${id}.en.vtt`)!.sha256, srt: byPath.get(`${id}/${id}.en.srt`)!.sha256 },
    invariants: inv.block!,
    files,
    gates: expectedGates(id, mp4, blenderEvidence),
  };
  return { subject, findings };
}

/**
 * Everything a receipt says that this checkout can derive without the proof package: the spec and docs identity, the
 * timeline and resolution, the build identity, the motion engine and MotionPlan, the reveal, the Blender character's
 * pinned identity, the environment's class, Remotion, the narration, the captions, the invariants' frames and plan,
 * and the structure of the gates and files.
 */
function checkoutFindings(r: PublicationProofReceipt, state: PublicState): ReceiptFinding[] {
  const out: ReceiptFinding[] = [];
  const bad = (code: ReceiptFindingCode, at: string, message: string) => out.push({ code, path: at, message: `${RECEIPT_CODES[code]} ${message}` });
  const s = r.subject;
  const spec = state.spec;
  const id = state.videoId;
  if (s.video.videoId !== id || s.video.revision !== spec.revision || s.video.specHash !== state.specHash) bad('CHECKOUT_MISMATCH', 'subject.video', `it is not ${id} r${spec.revision} ${state.specHash.slice(0, 12)}, the committed spec`);
  if (!same(s.video.source, { docPath: spec.source.docPath, docUrl: spec.source.docUrl, docBlob: spec.source.blob, contentHash: spec.source.contentHash })) bad('CHECKOUT_MISMATCH', 'subject.video.source', 'it is not the committed spec source');
  if (s.video.frames !== state.frames || s.video.durationMs !== state.totalMs || s.video.fps !== state.fps || s.video.width !== spec.output.width || s.video.height !== spec.output.height) bad('CHECKOUT_MISMATCH', 'subject.video', 'its timeline or resolution is not the committed one');
  if (s.video.file.path !== `${id}/${id}.r${spec.revision}.mp4`) bad('CHECKOUT_MISMATCH', 'subject.video.file.path', 'it is not the render of the committed revision');
  if (!same(s.build.identity, state.identity)) bad('CHECKOUT_MISMATCH', 'subject.build.identity', "it is not this checkout's build identity");
  if (s.build.identitySha256 !== contentAddress(s.build.identity)) bad('CHECKOUT_MISMATCH', 'subject.build.identitySha256', 'it is not the hash of the identity it names');

  const engineName = isObject(s.motion.engine) ? s.motion.engine.motionEngine : undefined;
  let engine: MotionEngineIdentity | null = null;
  if (engineName === 'typescript') engine = state.typescriptEngine;
  else if (engineName === 'rust-wasm') {
    try {
      engine = state.rustEngine();
    } catch {
      engine = null;
    }
  }
  if (!engine || !same(s.motion.engine, engine)) bad('CHECKOUT_MISMATCH', 'subject.motion.engine', "it is not a motion engine this checkout reproduces");
  else {
    const plan = planOf(state.lesson(engineName as 'typescript' | 'rust-wasm'));
    if (s.motion.planSha256 !== plan.planSha256 || s.character.sequence.bridgeSha256 !== plan.planSha256 || s.character.identity.motionPlanSha256 !== plan.planSha256) bad('CHECKOUT_MISMATCH', 'subject.motion.planSha256', `it is not this checkout's MotionPlan ${plan.planSha256.slice(0, 12)}`);
    if (s.character.identity.terrainSha256 !== plan.terrainSha256) bad('CHECKOUT_MISMATCH', 'subject.character.identity.terrainSha256', "it is not the terrain of this checkout's lesson");
    if (s.character.sequence.frames !== plan.shots(s.character.layout).length) bad('CHECKOUT_MISMATCH', 'subject.character.sequence.frames', `it is not the ${plan.shots(s.character.layout).length} frames this checkout's plan draws in the ${s.character.layout} layout`);
    const reveals = plan.reveal ? [{ range: plan.reveal.range, bridgeSha256: plan.reveal.bridgeSha256, frames: plan.reveal.shots.length }] : [];
    if (!same(s.character.reveals.map((x) => ({ range: x.range, bridgeSha256: x.bridgeSha256, frames: x.frames })), reveals)) bad('CHECKOUT_MISMATCH', 'subject.character.reveals', "they are not the depth reveal this checkout's MotionPlan gives");
    // The invariants were measured on this same plan: the render's engine, every visible frame at the publication stride.
    const inv = s.invariants;
    if (inv.motionEngine !== engineName) bad('EVIDENCE_INVALID', 'subject.invariants.motionEngine', `the invariants were measured on the ${inv.motionEngine} plan, not the render's ${String(engineName)} plan`);
    else if (inv.evidence !== INVARIANTS_EVIDENCE || inv.every !== PUBLICATION_STRIDE.every || inv.labEvery !== PUBLICATION_STRIDE.labEvery || !same(inv.lessonFrames, plan.strideFrames)) bad('EVIDENCE_INVALID', 'subject.invariants', "the invariants were not measured on every visible frame at the publication stride of this checkout's plan");
    else if (inv.lessonBridgeSha256 !== contentAddress(lessonBridgeFor(state.lesson(engineName as 'typescript' | 'rust-wasm'), inv.lessonFrames))) bad('EVIDENCE_INVALID', 'subject.invariants.lessonBridgeSha256', "the invariants were measured on another MotionPlan than this checkout's");
  }
  for (const [k, v] of Object.entries(pinnedIdentity(state))) if (s.character.identity[k] !== v) bad('CHECKOUT_MISMATCH', `subject.character.identity.${k}`, `it is not this checkout's ${k}`);

  const parsed = parseRenderEnvironment(s.renderEnvironment.record);
  if (!parsed.ok) for (const p of parsed.problems) bad('RECEIPT_SCHEMA', `subject.renderEnvironment.record${p.slice(1)}`, 'the render environment is not the closed render-environment schema');
  else {
    // Re-derived from the record with this checkout's classes and Blender pin: a recorded label, or a class whose Blender
    // pin disagrees with config/blender.json, never makes an environment a publication class.
    const cls = classifyEnvironment(parsed.env, state.blenderConfig, state.environments);
    if (cls.status !== 'APPROVED' || cls.approvedClass?.purpose !== 'publication') bad('ENVIRONMENT_NOT_PUBLICATION', 'subject.renderEnvironment', environmentSummary(cls));
    else if (cls.classId !== s.renderEnvironment.classId || cls.approvedClass.name !== s.renderEnvironment.approvedClass) bad('ENVIRONMENT_NOT_PUBLICATION', 'subject.renderEnvironment', `the recorded class ${shownClassId(s.renderEnvironment.classId)} (${shownClassName(s.renderEnvironment.approvedClass)}) is not what the record derives (${cls.classId}, ${cls.approvedClass.name})`);
  }

  if (s.remotion.version !== state.identity.toolchain.packages.remotion || s.remotion.compositionId !== COMPOSITION_ID) bad('CHECKOUT_MISMATCH', 'subject.remotion', "it is not this checkout's renderer and composition");
  // The narration this checkout re-derives: the fixture voice (silent, estimated), or the verified publication narration
  // set it replays (audio present, durations measured, and exactly that set's identity, binding, and hashes).
  const pub = state.narrationPublication;
  const narration = pub ? { providerId: state.narrationProviderId, estimated: false, audio: 'PRESENT', publication: pub.ref } : { providerId: state.narrationProviderId, estimated: true, audio: 'NONE', publication: null };
  if (!same(s.narration, narration)) bad('CHECKOUT_MISMATCH', 'subject.narration', pub ? `it is not the publication narration set ${pub.ref.identity.slice(0, 12)} this checkout replays (${pub.ref.provider} ${pub.ref.modelId}, voice ${pub.ref.voiceId})` : `it is not the narration this proof can re-derive (${state.narrationProviderId}: estimated, no audio)`);
  if (s.captions.vtt !== sha256Hex(state.captions.vtt) || s.captions.srt !== sha256Hex(state.captions.srt)) bad('CHECKOUT_MISMATCH', 'subject.captions', 'they are not the captions the committed narration produces');

  // The gates: exactly the required ones, in order, each re-derivable from the bound files it names.
  const names = [s.character.sequence, ...s.character.reveals].map((x) => x.evidence);
  const plainEvidence = names.every((e) => new RegExp(`^${BLENDER_EVIDENCE_DIR}/[a-z0-9][a-z0-9.-]{0,80}\\.json$`).test(e));
  if (!plainEvidence || !same(s.gates, expectedGates(id, `${id}.r${spec.revision}.mp4`, names))) bad('GATES_INCOMPLETE', 'subject.gates', `the gates are not exactly ${REQUIRED_GATES.join(', ')}, in order, each on its own evidence`);
  const paths = s.files.map((f) => f.path);
  const sorted = [...paths].sort();
  if (!same(paths, sorted) || new Set(paths).size !== paths.length || !paths.every((p) => p.split('/').every((seg) => SEGMENT.test(seg))) || paths.includes(RECEIPT_FILE)) bad('RECEIPT_SCHEMA', 'subject.files', 'the files are not unique plain package paths in order');
  for (const g of s.gates) for (const e of g.evidence) if (!paths.includes(e)) bad('GATES_INCOMPLETE', `subject.gates.${g.gate}`, `its evidence ${e} is not a file the receipt binds`);
  const video = s.files.find((f) => f.path === s.video.file.path);
  if (!video || !same(video, s.video.file)) bad('CHECKOUT_MISMATCH', 'subject.video.file', 'the video is not the file the receipt binds at that path');
  return out;
}

export interface ReceiptVerification {
  ok: boolean;
  receiptSha256: string | null;
  findings: ReceiptFinding[];
  /** Whether the proof package beside the receipt was re-derived (false with receiptOnly). */
  checked: { package: boolean };
}

/** A receipt's document from disk: one handle, never a link, at most MAX_RECEIPT_BYTES (checked before reading). */
export function readReceiptDocument(receiptPath: string): { doc: unknown | null; problem: string | null } {
  const abs = path.resolve(receiptPath);
  const home = realPathOrNull(path.dirname(abs));
  const bytes = home ? readContainedFile(abs, (real) => real === path.join(home, path.basename(abs)), MAX_RECEIPT_BYTES) : null;
  if (!bytes) return { doc: null, problem: `it is missing, a link, not a regular file, or larger than ${MAX_RECEIPT_BYTES} bytes` };
  try {
    return { doc: JSON.parse(bytes.toString('utf8')) as unknown, problem: null };
  } catch {
    return { doc: null, problem: 'it is not JSON' };
  }
}

/** Keys of two objects that differ, over both key sets (so an extra key on either side is a difference). */
const differingKeys = (a: unknown, b: unknown): string[] => (isObject(a) && isObject(b) ? [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !Object.hasOwn(a, k) || !Object.hasOwn(b, k) || !same(a[k], b[k])) : []);

/**
 * Verify a receipt document: its closed schema (own keys only, no `__proto__` anywhere), its identity, that it leaks
 * nothing, everything this checkout derives, and (with `packageDir`) the proof package, re-derived in full and
 * compared over both key sets. Fails closed on anything it cannot check.
 */
export function verifyReceiptDocument(doc: unknown, packageDir: string | null, state: PublicState): ReceiptVerification {
  const findings: ReceiptFinding[] = [];
  const result = (sha: string | null): ReceiptVerification => ({ ok: findings.length === 0, receiptSha256: sha, findings, checked: { package: packageDir !== null } });
  const problems: string[] = [];
  shapeProblems(doc, RECEIPT_SHAPE, '$', problems);
  protoKeys(doc, '$', problems);
  for (const p of problems) findings.push({ code: 'RECEIPT_SCHEMA', path: p.split(':')[0]!.replace(/^\$\.?/, ''), message: `${RECEIPT_CODES.RECEIPT_SCHEMA} ${p}` });
  findings.push(...leakFindings(doc, RECEIPT_FILE, state));
  if (problems.length > 0) return result(null);
  const receipt = doc as PublicationProofReceipt;
  if (receipt.receiptSha256 !== receiptIdentity(receipt.subject)) findings.push({ code: 'RECEIPT_IDENTITY', path: 'receiptSha256', message: RECEIPT_CODES.RECEIPT_IDENTITY });
  findings.push(...checkoutFindings(receipt, state));
  if (packageDir !== null) {
    const derived = deriveSubject(packageDir, state);
    findings.push(...derived.findings);
    if (derived.subject && !same(derived.subject, receipt.subject)) {
      for (const k of differingKeys(derived.subject, receipt.subject)) {
        const inner = differingKeys((derived.subject as unknown as Record<string, unknown>)[k], (receipt.subject as unknown as Record<string, unknown>)[k]);
        findings.push({ code: 'FIELD_MISMATCH', path: `subject.${k}`, message: `${RECEIPT_CODES.FIELD_MISMATCH}${inner.length ? ` (${inner.join(', ')})` : ''}` });
      }
    }
  }
  return result(receipt.receiptSha256);
}

/**
 * Verify a receipt file: everything verifyReceiptDocument checks, against the proof package beside it (unless
 * `receiptOnly`). Fails closed on anything it cannot read or check.
 */
export function verifyReceipt(receiptPath: string, state: PublicState, opts: { receiptOnly?: boolean } = {}): ReceiptVerification {
  const read = readReceiptDocument(receiptPath);
  if (!read.doc) return { ok: false, receiptSha256: null, findings: [{ code: 'RECEIPT_UNREADABLE', path: RECEIPT_FILE, message: `${RECEIPT_CODES.RECEIPT_UNREADABLE} ${read.problem}` }], checked: { package: !opts.receiptOnly } };
  return verifyReceiptDocument(read.doc, opts.receiptOnly ? null : path.dirname(path.resolve(receiptPath)), state);
}

/** Build the receipt for a proof package whose evidence is staged; throws (naming every finding) unless it derives cleanly. */
export function buildReceipt(packageDir: string, state: PublicState, writtenAt: string): PublicationProofReceipt {
  if (!ISO_UTC.test(writtenAt)) throw new ReceiptError('writtenAt must be an ISO-8601 UTC time');
  const d = deriveSubject(packageDir, state);
  if (!d.subject || d.findings.length > 0) throw new ReceiptError(`no receipt for this proof: ${d.findings.map((f) => `${f.code} ${f.path}: ${f.message}`).join(' | ')}`);
  return { schema: RECEIPT_SCHEMA, receiptSha256: receiptIdentity(d.subject), subject: d.subject, informational: { writtenAt } };
}

/**
 * Write a receipt into its proof package, once. The exact bytes are verified in full against the package BEFORE
 * anything is written (a receipt that does not verify, or a verification that throws, leaves nothing behind); then
 * they go to a temporary file, are read back and compared, and are published under the receipt's name by a hard link,
 * which is atomic and never replaces an existing receipt (no check-then-write). Returns the receipt's path.
 */
export function writeReceipt(packageDir: string, receipt: PublicationProofReceipt, state: PublicState): string {
  const real = realPathOrNull(packageDir);
  if (!real) throw new ReceiptError('there is no proof package to write the receipt into');
  const text = prettyJson(receipt);
  const check = verifyReceiptDocument(JSON.parse(text) as unknown, real, state);
  if (!check.ok) throw new ReceiptError(`the receipt does not verify, so it was not written: ${check.findings.map((f) => `${f.code} ${f.path}`).join('; ')}`);
  const final = path.join(real, RECEIPT_FILE);
  const tmp = path.join(real, `.${RECEIPT_FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, text, { flag: 'wx' });
  try {
    const written = readContainedFile(tmp, (r) => r === tmp);
    if (!written || written.toString('utf8') !== text) throw new ReceiptError('the receipt did not reach the disk intact');
    linkSync(tmp, final);
  } catch (err) {
    if (err instanceof ReceiptError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    throw new ReceiptError(code === 'EEXIST' ? 'a receipt already exists in this proof package; a new proof starts from an empty package' : `the receipt could not be published in the proof package (${code ?? 'error'})`);
  } finally {
    unlinkSync(tmp);
  }
  return final;
}
