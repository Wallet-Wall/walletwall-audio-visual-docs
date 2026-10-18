// The public-output gate: verify what publish:dry-run, render, and render:stills actually wrote, against
// the checkout they claim to come from, before anything is handed to a human reviewer or a publisher.
//
// It fails closed. A missing, unreadable, linked, inconsistent, or stale artifact; anything describing a
// live upload; an initial privacy other than unlisted; unresolved placeholder text in public copy; a
// local machine path in any public or review artifact; review stills that are not the bytes stills.json
// names or lack a working characterless twin: each is a finding, and any finding blocks the package.
//
// It inspects; it does not rebuild. The one exception is the captions, which it re-derives from the
// committed spec with the fixture voice to prove that the bytes on disk reproduce the narration. It
// never uploads anything, and the review bundle it writes holds exactly the files it verified. Node-only.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCaptions, checkCaptions, toSrt, toWebVtt } from '../audio/captions.ts';
import { FIXTURE_VOICE_PROVIDER_ID, FixtureVoiceProvider } from '../audio/voice-provider.ts';
import { DOCS_URL } from '../brand/repo-constants.ts';
import { choreograph, layoutsFor } from '../character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby } from '../character/walletwallaby/motion.ts';
import { loadPipelineConfig, readJson, VIDEO_ROOT } from '../config/load.ts';
import type { CopyTemplates, YoutubeChannelConfig } from '../config/types.ts';
import { canonicalJson, prettyJson } from '../core/canonical-json.ts';
import { readContainedFile, realPathOrNull } from '../core/contained-read.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { IssueCollector, type ValidationIssue, type ValidationReport } from '../core/issues.ts';
import { buildIdentity, type BuildIdentity } from '../manifest/build-identity.ts';
import { typescriptEngineIdentity, type MotionEngineIdentity } from '../motion/engine-identity.ts';
import { planRustMotion } from '../motion/rust-adapter.ts';
import { loadCommittedSpec, validationContextFor } from '../pipeline/context.ts';
import { loadSnapshot, synthesize } from '../pipeline/render-input.ts';
import type { NormalizedSource } from '../source/types.ts';
import type { VideoSpec } from '../spec/types.ts';
import { loadDocsSite } from '../source/load.ts';
import { buildTimeline, totalFrames } from '../timeline/timeline.ts';
import { validateSpec } from '../validation/validate-spec.ts';
import type { Lineage } from './lineage.ts';
import { buildPublishManifest, checkPublishManifest, type PublishManifest } from './manifest.ts';
import type { UploadReceipt } from './upload-provider.ts';

/** Stable codes, like the validation codes: CI and reviewers act on these, not on prose. */
export const PUBLIC_OUTPUT_CODES = {
  ARTIFACT_MISSING: 'A required publication artifact is missing.',
  ARTIFACT_INVALID: 'An artifact is unreadable, is a link, or is not the document its schema names.',
  VALIDATION_BLOCKED: 'Spec validation has blocking errors.',
  MEDIA_QA_BLOCKED: 'Media QA has blocking errors.',
  NOT_DRY_RUN: 'An artifact describes a live upload; this pipeline only ever produces a dry run.',
  PRIVACY_NOT_UNLISTED: 'The initial publication privacy is not UNLISTED.',
  CAPTIONS_MISMATCH: 'The captions on disk are not the captions the narration produces.',
  MANIFEST_INCONSISTENT: 'The publish manifest disagrees with itself, the platform rules, or the files it names.',
  PROVENANCE_INCONSISTENT: 'Provenance disagrees with the spec, the manifest, the render, or a fresh validation.',
  SOURCE_IDENTITY_INVALID: 'The canonical docs identity is missing, malformed, or not the committed spec source.',
  SPEC_STALE: 'An artifact was made from a different spec than the committed one.',
  IDENTITY_STALE: 'An artifact was made with a different build identity than this checkout.',
  MOTION_ENGINE_STALE: 'An artifact names a motion engine, WASM artifact, config, or plan this checkout would not produce.',
  RENDER_INCONSISTENT: 'The rendered file is not the one its records name.',
  DEBUG_OUTPUT: 'A publication render carries a debug overlay or is a design-test variant.',
  STILLS_INCONSISTENT: 'A review still is missing, unlisted, ambiguous, or not the bytes stills.json names.',
  CHARACTERLESS_MISSING: 'A review frame has no characterless twin.',
  CHARACTERLESS_INEFFECTIVE: 'A characterless still equals its frame while WalletWallaby is on canvas.',
  PLACEHOLDER_TEXT: 'Public copy contains unresolved placeholder or leaked-value text.',
  LOCAL_PATH: 'A public or review artifact contains a local machine path.',
  METADATA_PRESENT: 'A review still carries textual or unknown metadata.',
  CREDENTIAL_PRESENT: 'A publication credential is present in the environment of a credential-free gate.',
} as const;

export type PublicOutputCode = keyof typeof PUBLIC_OUTPUT_CODES;

export interface PublicOutputFinding {
  code: PublicOutputCode;
  /** Where: a bundle path plus a JSON path, `env:<NAME>`, or `spec:<path>`. Never an absolute path. */
  path: string;
  message: string;
}

/** The current publication contract: v1 uploads are unlisted for human review (config/youtube.json). */
export const REQUIRED_PRIVACY = 'unlisted';

/**
 * Environment names that would hold YouTube publication credentials: anything naming YouTube, and
 * Google service-account or OAuth client material. Other tools' OAuth settings are not matched. Values
 * are never read.
 */
const PUBLICATION_CREDENTIAL = /YOUTUBE|^YT_|^GOOGLE_APPLICATION_CREDENTIALS$|^GOOGLE_\w*(?:OAUTH|CLIENT_SECRET|REFRESH_TOKEN)/i;

/** What this checkout says the package must be. Built once by currentPublicState; tests may override parts. */
export interface PublicState {
  videoId: string;
  spec: VideoSpec;
  specHash: string;
  identity: BuildIdentity;
  youtube: YoutubeChannelConfig;
  lineage: Lineage;
  /** The only narration this gate can re-derive captions for. */
  narrationProviderId: string;
  /** The captions the committed spec produces with the fixture voice, and their caption QA issues. */
  captions: { vtt: string; srt: string; qa: ValidationIssue[] };
  /** A fresh validation of the committed spec (the same call publish:dry-run makes). */
  validation: ValidationReport;
  totalMs: number;
  fps: number;
  /** Frames in the committed timeline (what render.json must record). */
  frames: number;
  /** Everything the video shows on screen besides narration (narration is checked through the captions). */
  publicCopy: { path: string; text: string }[];
  typescriptEngine: MotionEngineIdentity;
  /** The rust-wasm identity this checkout produces (solved on first use: it runs the committed engine). */
  rustEngine: () => MotionEngineIdentity;
  /** Whether a frame draws WalletWallaby on canvas: visible, not transparent, feet inside the frame. */
  onCanvas: (frame: number) => boolean;
  /**
   * The publish manifest this checkout produces for a render (or none), built by the same function
   * publish:dry-run uses. It covers inputs the build identity does not hash, such as config/playlists.json.
   */
  expectedManifest: (video: { path: string; sha256: string } | null) => PublishManifest;
  /** Absolute paths of this machine that must never appear in an artifact (repository, home, temp, CI workspace). */
  localRoots: string[];
  env: Record<string, string | undefined>;
}

export async function currentPublicState(videoId: string, env: Record<string, string | undefined> = process.env): Promise<PublicState> {
  const config = loadPipelineConfig();
  const spec = loadCommittedSpec(videoId);
  const source = loadSnapshot(spec);
  // The same narration track publish:dry-run uses: the fixture voice.
  const track = await synthesize(spec, new FixtureVoiceProvider(), config);
  const timeline = buildTimeline(spec, track, config.templates);
  const cues = buildCaptions(timeline);
  const qa = new IssueCollector();
  checkCaptions(cues, spec, timeline, config.lexicon, qa);
  const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
  const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
  // The Rust engine flies exactly this plan's feet on every frame it performs (bindMotionEngine refuses
  // anything else), so on-canvas is the same question for either engine.
  const plan = planMotion(choreograph(timeline, layouts), layouts);
  const specHash = contentAddress(spec);
  const vtt = toWebVtt(cues);
  let rust: MotionEngineIdentity | undefined;
  return {
    videoId,
    spec,
    specHash,
    identity: buildIdentity(),
    youtube: config.youtube,
    lineage: readJson<Lineage>(path.join(VIDEO_ROOT, 'manifests', `${videoId}.lineage.json`)),
    narrationProviderId: FIXTURE_VOICE_PROVIDER_ID,
    captions: { vtt, srt: toSrt(cues), qa: qa.issues },
    validation: validateSpec(spec, validationContextFor(spec, config, loadDocsSite(), track)),
    totalMs: timeline.totalMs,
    fps: timeline.fps,
    frames: totalFrames(timeline),
    publicCopy: onScreenCopy(spec, source, config.templates),
    typescriptEngine: typescriptEngineIdentity(),
    rustEngine: () => (rust ??= planRustMotion({ spec, track, templates: config.templates, headings }).identity),
    onCanvas: (frame) => {
      const w = sampleWallaby(plan, (frame * 1000) / timeline.fps);
      return w.visible && w.opacity > 0 && w.x >= 0 && w.x <= spec.output.width && w.y >= 0 && w.y <= spec.output.height;
    },
    expectedManifest: (video) =>
      buildPublishManifest({
        spec,
        specHash,
        timeline,
        docDescription: source.description,
        youtube: config.youtube,
        playlists: config.playlists,
        captions: { path: `dist/${videoId}/${videoId}.en.vtt`, sha256: sha256Hex(vtt) },
        video,
        narration: { providerId: track.providerId, estimated: track.estimated },
      }),
    localRoots: localRoots([VIDEO_ROOT, os.homedir(), os.tmpdir(), process.cwd(), env.RUNNER_TEMP, env.GITHUB_WORKSPACE, env.RUNNER_WORKSPACE]),
    env,
  };
}

/** Every string the composition draws besides narration: scene text, eyebrows, brand copy, the doc title, the provenance chip. */
function onScreenCopy(spec: VideoSpec, source: NormalizedSource, templates: CopyTemplates): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [{ path: 'spec:title.topic', text: spec.title.topic }, { path: 'snapshot:title', text: source.title }, { path: 'spec:source.docPath', text: spec.source.docPath }];
  const headings = new Map(source.sections.map((s) => [s.id, s.heading]));
  spec.segments.forEach((seg, i) => {
    if (seg.templateId) {
      const onScreen = templates.templates[seg.templateId]?.onScreen;
      if (onScreen) out.push({ path: `config:copy-templates.${seg.templateId}.onScreen`, text: onScreen });
    }
    if (!seg.scene) return;
    const heading = headings.get(seg.scene.eyebrowSectionId);
    if (heading) out.push({ path: `snapshot:sections.${seg.scene.eyebrowSectionId}.heading`, text: heading });
    // Every visual text element is an object with a `text` string (heading, body, nodes, details, captions, statements).
    const walk = (value: unknown, at: string): void => {
      if (Array.isArray(value)) value.forEach((v, j) => walk(v, `${at}[${j}]`));
      else if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (k === 'text' && typeof v === 'string') out.push({ path: `spec:${at}.text`, text: v });
          else walk(v, `${at}.${k}`);
        }
      }
    };
    walk(seg.scene, `segments[${i}].scene`);
  });
  return out;
}

function localRoots(candidates: (string | undefined)[]): string[] {
  const roots = new Set<string>();
  for (const c of candidates) {
    if (!c) continue;
    const abs = path.resolve(c);
    // Never a filesystem root or a short path like /tmp: those would match ordinary text.
    if (abs.length < 8 || abs === path.parse(abs).root) continue;
    for (const form of [abs, abs.split(path.sep).join('/'), abs.split('/').join('\\')]) roots.add(form.toLowerCase());
  }
  return [...roots];
}

// ── Text scanners ───────────────────────────────────────────────────────────────────────────────────

/** Unresolved placeholders and leaked values. Applied to public copy only (what a viewer reads). */
const PLACEHOLDERS: readonly { re: RegExp; what: string }[] = [
  { re: /\b(?:TODO|TBD|FIXME)\b/i, what: 'an unresolved TODO/TBD/FIXME marker' },
  { re: /\blorem ipsum\b/i, what: 'lorem ipsum filler' },
  { re: /\[object Object\]/, what: 'a stringified object' },
  { re: /\bundefined\b/, what: 'a leaked undefined value' },
  { re: /\bNaN\b/, what: 'a leaked NaN value' },
  { re: /\$\{[^}]*\}|\{\{[^}]*\}\}/, what: 'an unresolved template placeholder' },
];

/**
 * Local machine paths. Applied to every artifact. Shaped so that repo-relative paths, `video/…`
 * workspace paths, and URLs (including ones whose path contains /home/) are not matched.
 */
const LOCAL_PATHS: readonly { re: RegExp; what: string }[] = [
  { re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/, what: 'a Windows drive path' },
  { re: /(?:^|[\s"'`(=,;])\\\\[A-Za-z0-9._$-]+\\/, what: 'a UNC path' },
  { re: /(?:^|[\s"'`(=,;:])\/(?:Users|home|root)\/(?=[^\s/])/, what: 'a home-directory path' },
  // Temporary and system directories: where Remotion bundles, browser profiles, and toolchains live on a
  // Linux runner (/tmp, /opt/hostedtoolcache), a Mac (/private/var/folders), or WSL (/mnt/c).
  { re: /(?:^|[\s"'`(=,;:])\/(?:tmp|var|opt|mnt|private|proc|usr|etc|srv|run)\/(?=[^\s/])/, what: 'a temporary or system directory path' },
  { re: /(?:^|[\s"'`(=,;:])~[\\/]/, what: 'a home-relative path' },
  { re: /\bfile:\/\//i, what: 'a file:// URL' },
];

/**
 * In binary metadata a path can abut other printable bytes, so boundaries cannot be required there;
 * a home, temporary, or system directory with a name and a trailing separator is specific enough on
 * its own. (Not used on text, where it would match URLs such as https://host/home/page/.)
 */
const BINARY_LOCAL_PATH = /[\\/](?:Users|home|root|tmp|var|opt|mnt|private)[\\/][^\\/\s]{1,64}[\\/]/;

function localPathIn(text: string, roots: readonly string[], binary = false): string | null {
  for (const p of LOCAL_PATHS) if (p.re.test(text)) return p.what;
  if (binary && BINARY_LOCAL_PATH.test(text)) return 'a home, temporary, or system directory path';
  const lower = text.toLowerCase();
  for (const root of roots) if (lower.includes(root)) return 'an absolute path of this machine';
  return null;
}

const placeholderIn = (text: string): string | null => PLACEHOLDERS.find((p) => p.re.test(text))?.what ?? null;

/** Every key and string value of a parsed JSON document, with its JSON path. */
function* jsonStrings(value: unknown, at = '$'): Generator<[string, string]> {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* jsonStrings(value[i], `${at}[${i}]`);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield [`${at}{key}`, k];
      yield* jsonStrings(v, `${at}.${k}`);
    }
  }
}

// ── Binary containers ───────────────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Critical chunks plus ancillary chunks that carry no text (color, transparency, physical size). */
const PNG_ALLOWED_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'cICP', 'mDCV', 'cLLI', 'bKGD', 'hIST', 'pHYs', 'sPLT']);

function pngChunks(bytes: Buffer): { type: string; data: Buffer }[] | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks: { type: string; data: Buffer }[] = [];
  let o = 8;
  while (o < bytes.length) {
    if (o + 12 > bytes.length) return null;
    const len = bytes.readUInt32BE(o);
    if (o + 12 + len > bytes.length) return null;
    chunks.push({ type: bytes.toString('latin1', o + 4, o + 8), data: bytes.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return chunks[0]?.type === 'IHDR' && chunks[chunks.length - 1]?.type === 'IEND' ? chunks : null;
}

/** Top-level ISO-BMFF boxes of an MP4: everything but the compressed media payload (`mdat`) is metadata. */
function mp4MetadataBoxes(bytes: Buffer): Buffer[] | null {
  const boxes: Buffer[] = [];
  let o = 0;
  while (o < bytes.length) {
    if (o + 8 > bytes.length) return null;
    let size = bytes.readUInt32BE(o);
    const type = bytes.toString('latin1', o + 4, o + 8);
    let header = 8;
    if (size === 1) {
      if (o + 16 > bytes.length) return null;
      size = Number(bytes.readBigUInt64BE(o + 8));
      header = 16;
    } else if (size === 0) size = bytes.length - o;
    if (size < header || o + size > bytes.length) return null;
    if (type !== 'mdat') boxes.push(bytes.subarray(o + header, o + size));
    o += size;
  }
  return boxes;
}

/** Printable runs long enough to be a path; shorter runs in binary data are noise. */
const printableRuns = (bytes: Buffer): string[] => bytes.toString('latin1').match(/[\x20-\x7e]{8,}/g) ?? [];

function lstatOrNull(abs: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(abs);
  } catch {
    return null;
  }
}

// ── The check ───────────────────────────────────────────────────────────────────────────────────────

export interface VerifiedFile {
  /** Path inside the review bundle, `<videoId>/…`. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface PublicOutputReport {
  schema: 'walletwall.public-output-check/v1';
  videoId: string;
  ok: boolean;
  errors: number;
  findings: PublicOutputFinding[];
  /** Exactly the files the check verified; the review bundle holds these and nothing else. */
  files: VerifiedFile[];
  summary: {
    title: string | null;
    privacyStatus: string | null;
    chapters: number;
    captionsSha256: string | null;
    narrationProviderId: string | null;
    specHash: string;
    node: string;
    lockfileSha256: string;
    render: { sha256: string; motionEngine: string; overlays: unknown } | null;
    stills: { engine: string; stills: number; characterlessTwins: number; onCanvasTwins: number }[];
  };
}

export interface PublicOutputResult {
  report: PublicOutputReport;
  /** bundle path -> the local file it was verified from. Never serialized: these are local paths. */
  sources: Map<string, string>;
}

export interface CheckOptions {
  /** Require render.json and the MP4 it names (the publication proof). */
  requireRender?: boolean;
  /** Directories render:stills wrote (each with stills.json); one per motion engine. */
  stills?: string[];
}

interface ReportShape {
  ok: unknown;
  errors: unknown;
  issues: unknown;
}

const blocking = (r: ReportShape): boolean => r.ok !== true || r.errors !== 0 || !Array.isArray(r.issues) || r.issues.some((i: { severity?: unknown }) => i?.severity !== 'warning');
const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const STILL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;

export function checkPublicOutput(dir: string, state: PublicState, opts: CheckOptions = {}): PublicOutputResult {
  const id = state.videoId;
  const spec = state.spec;
  const findings: PublicOutputFinding[] = [];
  const files: VerifiedFile[] = [];
  const sources = new Map<string, string>();
  const fail = (code: PublicOutputCode, where: string, detail?: string): void => {
    findings.push({ code, path: where, message: detail ? `${PUBLIC_OUTPUT_CODES[code]} ${detail}` : PUBLIC_OUTPUT_CODES[code] });
  };
  const scanForPaths = (where: string, text: string, binary = false): void => {
    const hit = localPathIn(text, state.localRoots, binary);
    if (hit) fail('LOCAL_PATH', where, `(${hit})`);
  };
  /** Placeholder text, and local paths unless the string was already scanned as part of a JSON artifact. */
  const scanPublicCopy = (where: string, text: unknown, alsoPaths = true): void => {
    if (typeof text !== 'string') return;
    const hit = placeholderIn(text);
    if (hit) fail('PLACEHOLDER_TEXT', where, `(${hit}): ${JSON.stringify(text.length > 120 ? `${text.slice(0, 117)}...` : text)}`);
    if (alsoPaths) scanForPaths(where, text);
  };

  /**
   * A regular file, read without a check-then-read race (src/core/contained-read.ts: one open, then
   * everything through the handle). Its real path must be exactly the requested name in its own
   * directory, so a link, to anywhere or to another file of the package, is refused, not followed:
   * a link could pull anything on this machine into the review bundle.
   */
  const readFile = (abs: string, bundlePath: string, required = true): Buffer | null => {
    const home = realPathOrNull(path.dirname(abs));
    const bytes = home ? readContainedFile(abs, (real) => real === path.join(home, path.basename(abs))) : null;
    if (!bytes) {
      // Refused or absent; lstat only words the finding.
      const st = lstatOrNull(abs);
      if (!st) {
        if (required) fail('ARTIFACT_MISSING', bundlePath);
      } else fail('ARTIFACT_INVALID', bundlePath, st.isSymbolicLink() ? 'is a link' : 'is not a regular file');
      return null;
    }
    files.push({ path: bundlePath, sha256: sha256Hex(bytes), bytes: bytes.length });
    sources.set(bundlePath, abs);
    return bytes;
  };
  const readJsonFile = <T>(abs: string, bundlePath: string, schema?: string, required = true): T | null => {
    const bytes = readFile(abs, bundlePath, required);
    if (!bytes) return null;
    let doc: unknown;
    try {
      doc = JSON.parse(bytes.toString('utf8'));
    } catch {
      fail('ARTIFACT_INVALID', bundlePath, 'is not JSON');
      return null;
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
      fail('ARTIFACT_INVALID', bundlePath, 'is not a JSON object');
      return null;
    }
    if (schema && (doc as { schema?: unknown }).schema !== schema) {
      fail('ARTIFACT_INVALID', bundlePath, `is not ${schema}`);
      return null;
    }
    for (const [at, text] of jsonStrings(doc)) scanForPaths(`${bundlePath}${at.slice(1)}`, text);
    return doc as T;
  };
  const at = (name: string): string => path.join(dir, name);
  const bp = (name: string): string => `${id}/${name}`;

  // ── The environment of a credential-free gate ──
  for (const [name, value] of Object.entries(state.env)) {
    if (value && PUBLICATION_CREDENTIAL.test(name)) fail('CREDENTIAL_PRESENT', `env:${name}`, '(the value is not read or printed)');
  }

  // ── Spec and canonical source identity ──
  const src = spec.source;
  if (!HEX40.test(src.blob ?? '') || !HEX64.test(src.contentHash ?? '') || !/^docs\/[^\s\\]+\.mdx?$/.test(src.docPath ?? '') || !(src.docUrl ?? '').startsWith(`${DOCS_URL}/`) || !src.snapshotPath) {
    fail('SOURCE_IDENTITY_INVALID', 'spec:source', 'the committed spec does not carry a complete canonical docs binding');
  }
  if (!state.validation.ok) fail('VALIDATION_BLOCKED', 'spec', `a fresh validation of the committed spec fails (${state.validation.errors} errors)`);
  if (state.youtube.defaults.privacyStatusOnUpload !== REQUIRED_PRIVACY) fail('PRIVACY_NOT_UNLISTED', 'config:youtube.defaults.privacyStatusOnUpload', JSON.stringify(state.youtube.defaults.privacyStatusOnUpload));
  for (const c of state.publicCopy) scanPublicCopy(c.path, c.text);

  // ── Validation and media QA ──
  const validation = readJsonFile<ReportShape>(at('validation.json'), bp('validation.json'));
  if (validation && blocking(validation)) fail('VALIDATION_BLOCKED', bp('validation.json'), `(ok ${String(validation.ok)}, errors ${String(validation.errors)})`);
  const media = readJsonFile<ReportShape>(at('media-qa.json'), bp('media-qa.json'));
  if (media && blocking(media)) fail('MEDIA_QA_BLOCKED', bp('media-qa.json'), `(ok ${String(media.ok)}, errors ${String(media.errors)})`);
  for (const i of state.captions.qa.filter((x) => x.severity === 'error')) fail('MEDIA_QA_BLOCKED', `captions:${i.path}`, `fresh caption QA: ${i.code}`);

  // ── Captions: the bytes on disk must be the ones the narration produces ──
  const vttName = `${id}.en.vtt`;
  const srtName = `${id}.en.srt`;
  const vtt = readFile(at(vttName), bp(vttName));
  const srt = readFile(at(srtName), bp(srtName));
  for (const [name, bytes] of [[vttName, vtt], [srtName, srt]] as const) {
    if (!bytes) continue;
    const text = bytes.toString('utf8');
    scanPublicCopy(bp(name), text);
  }

  // ── The publish manifest ──
  const manifest = readJsonFile<PublishManifest>(at('publish-manifest.json'), bp('publish-manifest.json'), 'walletwall.youtube-publish-manifest/v1');
  const narrationProvider = manifest?.provenance?.narration?.providerId ?? null;
  const canReDerive = narrationProvider === state.narrationProviderId;
  if (manifest && !canReDerive) fail('CAPTIONS_MISMATCH', bp('publish-manifest.json.provenance.narration'), `narration from ${JSON.stringify(narrationProvider)} cannot be re-derived by this gate; only ${state.narrationProviderId} can`);
  if (canReDerive) {
    if (vtt && vtt.toString('utf8') !== state.captions.vtt) fail('CAPTIONS_MISMATCH', bp(vttName), 'differs from the WebVTT the committed narration produces');
    if (srt && srt.toString('utf8') !== state.captions.srt) fail('CAPTIONS_MISMATCH', bp(srtName), 'differs from the SRT the committed narration produces');
  }
  if (manifest) {
    const m = manifest;
    const where = (p: string) => `${bp('publish-manifest.json')}.${p}`;
    if (m.mode !== 'DRY_RUN') fail('NOT_DRY_RUN', where('mode'), JSON.stringify(m.mode));
    if (m.status?.privacyStatus !== REQUIRED_PRIVACY) fail('PRIVACY_NOT_UNLISTED', where('status.privacyStatus'), JSON.stringify(m.status?.privacyStatus));
    if (m.videoId !== id || m.revision !== spec.revision || m.specHash !== state.specHash) fail('SPEC_STALE', where('specHash'), `${String(m.videoId)} r${String(m.revision)} ${String(m.specHash).slice(0, 12)} is not ${id} r${spec.revision} ${state.specHash.slice(0, 12)}`);
    if (m.review?.required !== true || m.review?.gate !== 'HUMAN_REVIEW_BEFORE_PUBLIC') fail('MANIFEST_INCONSISTENT', where('review'), 'the human review gate is not required');
    const qa = new IssueCollector();
    try {
      checkPublishManifest(m, state.youtube, state.env, qa);
    } catch (err) {
      fail('ARTIFACT_INVALID', where('*'), `cannot be checked: ${(err as Error).message}`);
    }
    for (const i of qa.report().issues) if (i.severity === 'error' && i.code !== 'MANIFEST_PRIVACY_INVALID') fail('MANIFEST_INCONSISTENT', where(i.path), `${i.code}: ${i.message}`);
    if ((m.chapters ?? []).some((c) => !(c.atMs >= 0 && c.atMs < state.totalMs))) fail('MANIFEST_INCONSISTENT', where('chapters'), 'a chapter starts outside the video');
    const cap = m.files?.captions;
    if (!cap || cap.path !== `dist/${id}/${vttName}` || cap.format !== 'vtt' || cap.language !== m.snippet?.defaultLanguage || (vtt && cap.sha256 !== sha256Hex(vtt))) fail('MANIFEST_INCONSISTENT', where('files.captions'), 'does not name the captions on disk');
    const p = m.provenance;
    if (!p || p.docPath !== src.docPath || p.docUrl !== src.docUrl || p.docBlob !== src.blob || p.contentHash !== src.contentHash) fail('SOURCE_IDENTITY_INVALID', where('provenance'), 'is not the committed spec source');
    if (p && p.planner !== `${spec.planner.provider}:${spec.planner.contract}`) fail('MANIFEST_INCONSISTENT', where('provenance.planner'), JSON.stringify(p.planner));
    // What YouTube shows: title, description, tags, chapter titles, playlist titles.
    scanPublicCopy(where('snippet.title'), m.snippet?.title, false);
    scanPublicCopy(where('snippet.description'), m.snippet?.description, false);
    (m.snippet?.tags ?? []).forEach((t, i) => scanPublicCopy(where(`snippet.tags[${i}]`), t, false));
    (m.chapters ?? []).forEach((c, i) => scanPublicCopy(where(`chapters[${i}].title`), c.title, false));
    (m.playlists ?? []).forEach((pl, i) => scanPublicCopy(where(`playlists[${i}].title`), pl.title, false));
  }

  // ── The dry-run receipt: nothing was uploaded, nothing was recorded ──
  const receipt = readJsonFile<{ receipt?: UploadReceipt; lineageUnchanged?: unknown }>(at('receipt.json'), bp('receipt.json'));
  if (receipt) {
    const r = receipt.receipt;
    if (r?.mode !== 'DRY_RUN' || r?.youtubeId !== null) fail('NOT_DRY_RUN', `${bp('receipt.json')}.receipt`, `mode ${JSON.stringify(r?.mode)}, youtubeId ${JSON.stringify(r?.youtubeId)}`);
    if (r?.privacyStatus !== REQUIRED_PRIVACY) fail('PRIVACY_NOT_UNLISTED', `${bp('receipt.json')}.receipt.privacyStatus`, JSON.stringify(r?.privacyStatus));
    if (!same(receipt.lineageUnchanged, state.lineage)) fail('NOT_DRY_RUN', `${bp('receipt.json')}.lineageUnchanged`, 'the dry run recorded a change to the lineage');
  }

  // ── The cue sheet ──
  const cueSheet = readJsonFile<{ cues?: { asset?: unknown }[]; suppressed?: unknown[]; identAsset?: unknown; musicBed?: { id?: unknown } }>(at('cue-sheet.json'), bp('cue-sheet.json'));

  // ── The render (optional, required for the publication proof) ──
  type RenderInfo = {
    videoId?: unknown;
    revision?: unknown;
    specHash?: unknown;
    engine?: { name?: string; version?: string };
    fps?: unknown;
    frames?: unknown;
    durationMs?: unknown;
    output?: { path?: string; sha256?: string };
    narration?: { providerId?: unknown };
    overlays?: { captions?: unknown; characterless?: unknown; guides?: unknown };
    identity?: unknown;
    motionEngine?: MotionEngineIdentity;
  };
  const render = readJsonFile<RenderInfo>(at('render.json'), bp('render.json'), 'walletwall.render-info/v4', opts.requireRender === true);
  let renderSha: string | null = null;
  if (render) {
    const where = (p: string) => `${bp('render.json')}.${p}`;
    const mp4Name = `${id}.r${spec.revision}.mp4`;
    // The spec hash binds the frames to the exact spec: an on-screen text edit changes no timing or identity.
    if (render.specHash !== state.specHash) fail('SPEC_STALE', where('specHash'), `${String(render.specHash).slice(0, 12)} is not the committed spec ${state.specHash.slice(0, 12)}`);
    if (render.videoId !== id || render.revision !== spec.revision || render.fps !== state.fps || render.durationMs !== state.totalMs || render.frames !== state.frames) {
      fail('SPEC_STALE', where('durationMs'), 'the render is not of the committed spec (video, revision, or timeline differ)');
    }
    if (!same(render.identity, state.identity)) fail('IDENTITY_STALE', where('identity'), 'the render was made with a different toolchain, configuration, or character version');
    if (render.engine?.name !== 'remotion' || render.engine?.version !== state.identity.toolchain.packages.remotion) fail('RENDER_INCONSISTENT', where('engine'), `${JSON.stringify(render.engine)} is not this checkout's renderer`);
    const o = render.overlays;
    if (!o || typeof o.guides !== 'boolean' || typeof o.characterless !== 'boolean' || typeof o.captions !== 'boolean') fail('ARTIFACT_INVALID', where('overlays'), 'does not record the render overlays');
    else {
      if (o.guides) fail('DEBUG_OUTPUT', where('overlays.guides'), 'the layout guides are drawn into the frames');
      if (o.characterless) fail('DEBUG_OUTPUT', where('overlays.characterless'), 'the characterless design test is not the publication render');
    }
    if (render.narration?.providerId !== narrationProvider) fail('RENDER_INCONSISTENT', where('narration.providerId'), 'the render and the manifest name different narration');
    checkMotionEngine(render.motionEngine, where('motionEngine'));
    if (render.output?.path !== `dist/${id}/${mp4Name}`) fail('RENDER_INCONSISTENT', where('output.path'), `is not dist/${id}/${mp4Name}`);
    const video = readFile(at(mp4Name), bp(mp4Name));
    if (video) {
      renderSha = sha256Hex(video);
      if (renderSha !== render.output?.sha256) fail('RENDER_INCONSISTENT', bp(mp4Name), `is ${renderSha.slice(0, 12)}, render.json names ${String(render.output?.sha256).slice(0, 12)}`);
      const boxes = mp4MetadataBoxes(video);
      if (!boxes) fail('ARTIFACT_INVALID', bp(mp4Name), 'is not an ISO-BMFF (MP4) file');
      else for (const b of boxes) for (const run of printableRuns(b)) scanForPaths(`${bp(mp4Name)}:metadata`, run, true);
    }
    if (manifest && !same(manifest.files?.video, { path: render.output?.path, sha256: render.output?.sha256, durationMs: state.totalMs })) fail('MANIFEST_INCONSISTENT', `${bp('publish-manifest.json')}.files.video`, 'does not name the render');
  } else if (manifest && manifest.files?.video !== null) fail('MANIFEST_INCONSISTENT', `${bp('publish-manifest.json')}.files.video`, 'names a video, but there is no render.json');
  // The whole manifest, re-derived with the function publish:dry-run uses: catches stale inputs the build
  // identity does not hash (playlists, the doc description) and any edit the checks above do not name.
  if (manifest && canReDerive) {
    const video = render && typeof render.output?.path === 'string' && typeof render.output?.sha256 === 'string' ? { path: render.output.path, sha256: render.output.sha256 } : null;
    if (!same(manifest, state.expectedManifest(video))) fail('MANIFEST_INCONSISTENT', bp('publish-manifest.json'), 'is not the manifest this checkout produces (stale or edited)');
  }

  // ── Provenance ──
  type Provenance = {
    videoId?: unknown;
    revision?: unknown;
    specHash?: unknown;
    source?: unknown;
    planner?: unknown;
    claims?: { id?: unknown; type?: unknown }[];
    narration?: { providerId?: unknown };
    timeline?: { totalMs?: unknown };
    audio?: { identAsset?: unknown; musicBed?: unknown; cues?: unknown; silentCues?: unknown; suppressedCues?: unknown };
    validation?: unknown;
    render?: unknown;
    identity?: unknown;
  };
  const prov = readJsonFile<Provenance>(at('provenance.json'), bp('provenance.json'), 'walletwall.video-provenance/v3');
  if (prov) {
    const where = (p: string) => `${bp('provenance.json')}.${p}`;
    if (prov.videoId !== id || prov.revision !== spec.revision || prov.specHash !== state.specHash) fail('SPEC_STALE', where('specHash'), `${String(prov.specHash).slice(0, 12)} is not ${state.specHash.slice(0, 12)}`);
    if (!same(prov.source, src)) fail('SOURCE_IDENTITY_INVALID', where('source'), 'is not the committed spec source');
    if (!same(prov.planner, spec.planner)) fail('PROVENANCE_INCONSISTENT', where('planner'), 'is not the committed spec planner');
    if (!same((prov.claims ?? []).map((c) => [c.id, c.type]), spec.claims.map((c) => [c.id, c.type]))) fail('PROVENANCE_INCONSISTENT', where('claims'), 'are not the committed spec claims');
    if (!same(prov.identity, state.identity)) fail('IDENTITY_STALE', where('identity'), 'was recorded with a different toolchain, configuration, or character version');
    const fresh = { ok: state.validation.ok, errors: state.validation.errors, warnings: state.validation.warnings, codes: [...new Set(state.validation.issues.map((i) => i.code))] };
    if (!same(prov.validation, fresh)) fail('PROVENANCE_INCONSISTENT', where('validation'), 'is not the verdict a fresh validation gives');
    if (prov.timeline?.totalMs !== state.totalMs) fail('PROVENANCE_INCONSISTENT', where('timeline.totalMs'), 'is not the committed timeline');
    if (prov.narration?.providerId !== narrationProvider) fail('PROVENANCE_INCONSISTENT', where('narration.providerId'), 'disagrees with the manifest');
    if (cueSheet && Array.isArray(cueSheet.cues)) {
      const expected = { identAsset: cueSheet.identAsset ?? null, musicBed: cueSheet.musicBed?.id ?? null, cues: cueSheet.cues.length, silentCues: cueSheet.cues.filter((c) => c.asset === null).length, suppressedCues: cueSheet.suppressed?.length ?? 0 };
      if (!same(prov.audio, expected)) fail('PROVENANCE_INCONSISTENT', where('audio'), 'does not describe the cue sheet');
    } else if (cueSheet) fail('ARTIFACT_INVALID', `${bp('cue-sheet.json')}.cues`, 'is not a list');
    const expectedRender = render ? { engine: render.engine?.name, version: render.engine?.version, output: render.output?.path, sha256: render.output?.sha256, motionEngine: render.motionEngine } : null;
    if (!same(prov.render, expectedRender)) fail('PROVENANCE_INCONSISTENT', where('render'), render ? 'does not name the render' : 'names a render, but there is no render.json');
  }

  // ── Review stills ──
  const stillsSummary: PublicOutputReport['summary']['stills'] = [];
  const engines = new Set<string>();
  for (const stillsDir of opts.stills ?? []) {
    type StillsInfo = { videoId?: unknown; revision?: unknown; specHash?: unknown; motionEngine?: MotionEngineIdentity; identity?: unknown; stills?: { file?: unknown; frame?: unknown; sha256?: unknown }[] };
    const engineName = (() => {
      try {
        const doc = JSON.parse(readFileSync(path.join(stillsDir, 'stills.json'), 'utf8')) as StillsInfo;
        return typeof doc.motionEngine?.motionEngine === 'string' && /^[a-z0-9-]+$/.test(doc.motionEngine.motionEngine) ? doc.motionEngine.motionEngine : 'unknown';
      } catch {
        return 'unknown';
      }
    })();
    const base = `${id}/stills/${engineName}`;
    if (engines.has(engineName)) {
      fail('STILLS_INCONSISTENT', base, `two stills sets claim the ${engineName} engine`);
      continue;
    }
    engines.add(engineName);
    const info = readJsonFile<StillsInfo>(path.join(stillsDir, 'stills.json'), `${base}/stills.json`, 'walletwall.stills-info/v2');
    if (!info) continue;
    const where = (p: string) => `${base}/stills.json.${p}`;
    if (info.videoId !== id || info.revision !== spec.revision || info.specHash !== state.specHash) fail('SPEC_STALE', where('specHash'), 'the stills are not of the committed spec');
    if (!same(info.identity, state.identity)) fail('IDENTITY_STALE', where('identity'), 'the stills were made with a different toolchain, configuration, or character version');
    checkMotionEngine(info.motionEngine, where('motionEngine'));
    const list = Array.isArray(info.stills) ? info.stills : [];
    if (list.length === 0) fail('STILLS_INCONSISTENT', where('stills'), 'lists no stills');
    const byFile = new Map<string, { frame: number; sha256: string }>();
    const frameCount = state.frames;
    for (const [i, s] of list.entries()) {
      // Names are plain file names: nothing in stills.json may point outside its own directory.
      if (typeof s.file !== 'string' || !STILL_FILE.test(s.file) || typeof s.sha256 !== 'string' || !Number.isInteger(s.frame) || (s.frame as number) < 0 || (s.frame as number) >= frameCount || byFile.has(s.file)) {
        fail('STILLS_INCONSISTENT', where(`stills[${i}]`), 'is not a plain, unique PNG name with a frame of this video');
        continue;
      }
      byFile.set(s.file, { frame: s.frame as number, sha256: s.sha256 });
      const bytes = readFile(path.join(stillsDir, s.file), `${base}/${s.file}`);
      if (!bytes) continue;
      if (sha256Hex(bytes) !== s.sha256) fail('STILLS_INCONSISTENT', `${base}/${s.file}`, 'is not the bytes stills.json names');
      const chunks = pngChunks(bytes);
      if (!chunks) {
        fail('ARTIFACT_INVALID', `${base}/${s.file}`, 'is not a well-formed PNG');
        continue;
      }
      for (const c of chunks) {
        if (PNG_ALLOWED_CHUNKS.has(c.type)) continue;
        fail('METADATA_PRESENT', `${base}/${s.file}`, `(${JSON.stringify(c.type)} chunk)`);
        scanForPaths(`${base}/${s.file}:${c.type}`, c.data.toString('latin1'), true);
      }
    }
    for (const name of readdirSync(stillsDir)) {
      if (name.endsWith('.png') && !byFile.has(name)) fail('STILLS_INCONSISTENT', `${base}/${name}`, 'is not listed in stills.json (left over from another render?)');
    }
    // Every frame renders twice: as published, and with WalletWallaby removed (the design test).
    let twins = 0;
    let onCanvasTwins = 0;
    for (const [file, s] of byFile) {
      if (file.endsWith('.characterless.png')) {
        if (!byFile.has(file.replace(/\.characterless\.png$/, '.png'))) fail('STILLS_INCONSISTENT', `${base}/${file}`, 'has no frame it is the twin of');
        continue;
      }
      const twinName = file.replace(/\.png$/, '.characterless.png');
      const twin = byFile.get(twinName);
      if (!twin || twin.frame !== s.frame) {
        fail('CHARACTERLESS_MISSING', `${base}/${file}`, `has no characterless twin (${twinName}) of frame ${s.frame}`);
        continue;
      }
      twins++;
      if (state.onCanvas(s.frame)) {
        onCanvasTwins++;
        if (twin.sha256 === s.sha256) fail('CHARACTERLESS_INEFFECTIVE', `${base}/${twinName}`, `equals ${file}, but frame ${s.frame} draws WalletWallaby on canvas`);
      }
    }
    stillsSummary.push({ engine: engineName, stills: list.length, characterlessTwins: twins, onCanvasTwins });
  }

  function checkMotionEngine(recorded: MotionEngineIdentity | undefined, where: string): void {
    if (!recorded || typeof recorded !== 'object') {
      fail('ARTIFACT_INVALID', where, 'records no motion engine');
      return;
    }
    if (recorded.motionEngine === 'typescript') {
      if (!same(recorded, state.typescriptEngine)) fail('MOTION_ENGINE_STALE', where, `TypeScript motion ${JSON.stringify((recorded as { motion?: unknown }).motion)} is not this checkout's`);
      return;
    }
    if (recorded.motionEngine === 'rust-wasm') {
      let current: MotionEngineIdentity;
      try {
        current = state.rustEngine();
      } catch (err) {
        fail('MOTION_ENGINE_STALE', where, `the committed engine cannot reproduce the plans: ${(err as Error).message}`);
        return;
      }
      if (!same(recorded, current)) fail('MOTION_ENGINE_STALE', where, 'the WASM artifact, config, or plans are not the ones this checkout produces');
      return;
    }
    fail('MOTION_ENGINE_STALE', where, `unknown motion engine ${JSON.stringify((recorded as { motionEngine?: unknown }).motionEngine)}`);
  }

  const report: PublicOutputReport = {
    schema: 'walletwall.public-output-check/v1',
    videoId: id,
    ok: findings.length === 0,
    errors: findings.length,
    findings,
    files,
    summary: {
      title: manifest?.snippet?.title ?? null,
      privacyStatus: manifest?.status?.privacyStatus ?? null,
      chapters: manifest?.chapters?.length ?? 0,
      captionsSha256: vtt ? sha256Hex(vtt) : null,
      narrationProviderId: narrationProvider,
      specHash: state.specHash,
      node: state.identity.toolchain.node,
      lockfileSha256: state.identity.toolchain.lockfileSha256,
      render: render && renderSha ? { sha256: renderSha, motionEngine: render.motionEngine?.motionEngine ?? 'unknown', overlays: render.overlays } : null,
      stills: stillsSummary,
    },
  };
  return { report, sources };
}

/**
 * A Markdown summary of a report, for $GITHUB_STEP_SUMMARY. Table cells escape backslashes before
 * pipes and fold newlines, so no value can break out of its cell or its row.
 */
export function markdownSummary(r: PublicOutputReport, bundled: boolean): string {
  const cell = (v: string): string => v.replace(/[\\|]/g, (c) => `\\${c}`).replace(/\s*\r?\n\s*/g, ' ');
  const s = r.summary;
  const short = (hash: string) => `\`${hash.slice(0, 16)}…\``;
  const rows: [string, string][] = [
    ['Title', s.title ?? '(none)'],
    ['Initial privacy', s.privacyStatus ?? '(none)'],
    ['Chapters', String(s.chapters)],
    ['Captions (WebVTT sha256)', s.captionsSha256 ? short(s.captionsSha256) : '(none)'],
    ['Narration', s.narrationProviderId ?? '(none)'],
    ['Spec hash', short(s.specHash)],
    ['Node / lockfile', `${s.node} / ${short(s.lockfileSha256)}`],
    ['Render', s.render ? `${short(s.render.sha256)} (${s.render.motionEngine})` : 'none (dry run without a render)'],
    ...s.stills.map((x): [string, string] => [`Stills (${x.engine})`, `${x.stills} stills, ${x.characterlessTwins} characterless twins (${x.onCanvasTwins} with WalletWallaby on canvas)`]),
    ['Files verified', String(r.files.length)],
    ['Review bundle', bundled ? 'written' : 'not written'],
  ];
  const findings = r.findings.map((f) => `- \`${f.code}\` \`${f.path}\` — ${f.message}`);
  return [
    `### Public output: ${r.ok ? 'PASS' : 'FAIL'} (${r.videoId})`,
    '',
    '| Check | Result |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`),
    '',
    ...(findings.length ? ['**Findings**', '', ...findings, ''] : []),
    'CI can prove publication readiness; it cannot publish. Nothing here was uploaded to YouTube.',
    '',
  ].join('\n');
}

// ── Repeat-render determinism ───────────────────────────────────────────────────────────────────────

export interface StillsComparison {
  identical: boolean;
  /** Stills listed by the first render. */
  stills: number;
  differences: string[];
}

/**
 * Two render:stills outputs of the same input: identical only if both list the same stills, every PNG
 * is byte-identical, each stills.json names its own bytes, and the two stills.json files are equal.
 * Lossless frames are the determinism evidence (MP4 bytes are not run-to-run stable).
 */
export function compareStillSets(a: string, b: string): StillsComparison {
  const differences: string[] = [];
  type Info = { stills?: { file: string; sha256: string }[] } & Record<string, unknown>;
  const load = (dir: string, label: string): { raw: string; info: Info } | null => {
    try {
      const raw = readFileSync(path.join(dir, 'stills.json'), 'utf8');
      return { raw, info: JSON.parse(raw) as Info };
    } catch {
      differences.push(`${label}: no readable stills.json`);
      return null;
    }
  };
  const sa = load(a, 'first');
  const sb = load(b, 'second');
  if (!sa || !sb) return { identical: false, stills: 0, differences };
  if (sa.raw !== sb.raw) {
    const keys = [...new Set([...Object.keys(sa.info), ...Object.keys(sb.info)])].filter((k) => !same(sa.info[k], sb.info[k]));
    differences.push(`stills.json differs (${keys.join(', ')})`);
  }
  const listing = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  const la = listing(a);
  const lb = listing(b);
  for (const f of la.filter((x) => !lb.includes(x))) differences.push(`${f}: only in the first render`);
  for (const f of lb.filter((x) => !la.includes(x))) differences.push(`${f}: only in the second render`);
  const stills = Array.isArray(sa.info.stills) ? sa.info.stills : [];
  // Each PNG is read once; everything below compares those bytes.
  const read = (file: string): Buffer | null => {
    try {
      return readFileSync(file);
    } catch {
      return null;
    }
  };
  const bytes = new Map<string, Buffer | null>();
  for (const [label, dir, info] of [['first', a, sa.info], ['second', b, sb.info]] as const) {
    for (const s of Array.isArray(info.stills) ? info.stills : []) {
      if (typeof s.file !== 'string' || !STILL_FILE.test(s.file)) {
        differences.push(`${label}: stills.json lists ${JSON.stringify(s.file)}`);
        continue;
      }
      const png = read(path.join(dir, s.file));
      bytes.set(`${label}/${s.file}`, png);
      if (!png || sha256Hex(png) !== s.sha256) differences.push(`${s.file}: the ${label} render's bytes are not the ones its stills.json names`);
    }
  }
  for (const s of stills) {
    if (typeof s.file !== 'string' || !STILL_FILE.test(s.file)) continue;
    const pa = bytes.get(`first/${s.file}`);
    const pb = bytes.get(`second/${s.file}`);
    if (pa && pb && !pa.equals(pb)) differences.push(`${s.file}: PNG bytes differ (${sha256Hex(pa).slice(0, 12)} vs ${sha256Hex(pb).slice(0, 12)})`);
  }
  return { identical: differences.length === 0 && stills.length > 0, stills: stills.length, differences: stills.length === 0 && differences.length === 0 ? ['the first render lists no stills'] : differences };
}

// ── Review bundle ───────────────────────────────────────────────────────────────────────────────────

/**
 * Copy exactly the verified files, plus the report, into an empty directory. Refuses a package with
 * findings, and any file whose bytes changed after it was verified; nothing is written unless every
 * file still matches. The bundle is what CI uploads for review, so this is the last gate before it.
 */
export function writeReviewBundle(result: PublicOutputResult, bundleDir: string): void {
  const { report, sources } = result;
  if (!report.ok || report.findings.length > 0) throw new Error(`refusing to bundle a package with findings (${report.findings.length})`);
  if (existsSync(bundleDir) && readdirSync(bundleDir).length > 0) throw new Error(`refusing to bundle into ${bundleDir}: it is not empty`);
  const staged = report.files.map((f) => {
    const from = sources.get(f.path);
    if (!from || f.path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) throw new Error(`refusing to bundle ${f.path}: not a verified bundle path`);
    const bytes = readFileSync(from);
    if (sha256Hex(bytes) !== f.sha256) throw new Error(`refusing to bundle ${f.path}: it changed after it was verified`);
    return { to: path.join(bundleDir, ...f.path.split('/')), bytes };
  });
  const reportText = prettyJson(report);
  if (localPathIn(reportText, localRoots([VIDEO_ROOT, os.homedir(), os.tmpdir(), process.cwd()]))) throw new Error('refusing to bundle: the report would carry a local path');
  for (const s of staged) {
    mkdirSync(path.dirname(s.to), { recursive: true });
    writeFileSync(s.to, s.bytes);
  }
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(path.join(bundleDir, 'public-output-check.json'), reportText);
}
