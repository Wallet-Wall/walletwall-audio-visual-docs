// The public-output gate (src/publish/public-output.ts, scripts/public-output-check.ts). Each case
// changes ONE thing in an otherwise clean publication package and names the code that must refuse it;
// the negative controls prove legitimate provenance and copy are not flagged.
//
// The clean package is assembled in-process the way scripts/validate.ts and scripts/publish-dry-run.ts
// assemble it (fixture voice, no render), so this suite never reads or writes dist/. CI runs the same
// gate on the real scripts' output (.github/workflows/public-output.yml).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { buildCaptions, checkCaptions, toSrt, toWebVtt } from '../src/audio/captions.ts';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { environmentClass, loadEnvironments } from '../src/blender/identity.ts';
import { lessonBridge, lessonBridgeFor } from '../src/blender/lesson.ts';
import { findRevealSeam } from '../src/blender/reveal.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { planMotion } from '../src/character/walletwallaby/motion.ts';
import { loadPipelineConfig, VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { typescriptEngineIdentity } from '../src/motion/engine-identity.ts';
import { planRustMotion } from '../src/motion/rust-adapter.ts';
import { loadCommittedSpec, validationContextFor } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';
import { buildPublishManifest, checkPublishManifest } from '../src/publish/manifest.ts';
import { checkPublicOutput, compareStillSets, currentPublicState, markdownSummary, writeReviewBundle, type PublicOutputCode, type PublicState } from '../src/publish/public-output.ts';
import { DryRunUploadProvider } from '../src/publish/upload-provider.ts';
import { loadDocsSite } from '../src/source/load.ts';
import { buildTimeline, msToFrame } from '../src/timeline/timeline.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';
import { VIDEO_ID } from './helpers.ts';

const MP4 = `${VIDEO_ID}.r1.mp4`;
const VTT = `${VIDEO_ID}.en.vtt`;
const SRT = `${VIDEO_ID}.en.srt`;
const scratch = mkdtempSync(path.join(os.tmpdir(), 'ww-av-public-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let serial = 0;
const freshDir = (label: string): string => {
  const dir = path.join(scratch, `${String(serial++).padStart(3, '0')}-${label}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const readJsonFile = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const editJson = <T>(file: string, edit: (doc: T) => void): void => {
  const doc = readJsonFile<T>(file);
  edit(doc);
  writeFileSync(file, prettyJson(doc));
};

/** The package scripts/validate.ts + scripts/publish-dry-run.ts write for a video with no render. */
async function writeDryRunPackage(dir: string): Promise<void> {
  const config = loadPipelineConfig();
  const spec = loadCommittedSpec(VIDEO_ID);
  const source = loadSnapshot(spec);
  const site = loadDocsSite();
  writeFileSync(path.join(dir, 'validation.json'), prettyJson(validateSpec(spec, validationContextFor(spec, config, site))));
  const track = await synthesize(spec, new FixtureVoiceProvider(), config);
  const timeline = buildTimeline(spec, track, config.templates);
  const validation = validateSpec(spec, validationContextFor(spec, config, site, track));
  const cues = buildCaptions(timeline);
  const qa = new IssueCollector();
  checkCaptions(cues, spec, timeline, config.lexicon, qa);
  const vtt = toWebVtt(cues);
  writeFileSync(path.join(dir, VTT), vtt);
  writeFileSync(path.join(dir, SRT), toSrt(cues));
  const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
  const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
  const motion = planMotion(choreograph(timeline, layouts), layouts);
  const cueSheet = buildCueSheet(timeline, config.sonic, spec.audio.musicBedId, motion.events);
  writeFileSync(path.join(dir, 'cue-sheet.json'), prettyJson(cueSheet));
  const manifest = buildPublishManifest({
    spec,
    specHash: contentAddress(spec),
    timeline,
    docDescription: source.description,
    youtube: config.youtube,
    playlists: config.playlists,
    captions: { path: `dist/${VIDEO_ID}/${VTT}`, sha256: sha256Hex(vtt) },
    video: null,
    narration: { providerId: track.providerId, estimated: track.estimated },
  });
  checkPublishManifest(manifest, config.youtube, {}, qa);
  const provenance = buildProvenanceManifest({ spec, track, timeline, cueSheet, validation, render: null, identity: buildIdentity() });
  writeFileSync(path.join(dir, 'provenance.json'), prettyJson(provenance));
  writeFileSync(path.join(dir, 'publish-manifest.json'), prettyJson(manifest));
  writeFileSync(path.join(dir, 'media-qa.json'), prettyJson(qa.report()));
  const receipt = await new DryRunUploadProvider().upload({ manifest, videoFile: '', captionsFile: path.join(dir, VTT) });
  const lineage = readJsonFile<unknown>(path.join(VIDEO_ROOT, 'manifests', `${VIDEO_ID}.lineage.json`));
  writeFileSync(path.join(dir, 'receipt.json'), prettyJson({ receipt, lineageUnchanged: lineage }));
}

/** A minimal PNG: real chunk framing and CRCs, pixels derived from `seed`. */
function png(seed: number, extra: [type: string, data: Buffer][] = []): Buffer {
  const w = 4;
  const h = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let i = 0; i < raw.length; i++) raw[i] = i % (w * 3 + 1) === 0 ? 0 : (seed * 31 + i * 7) & 0xff;
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra.map(([t, d]) => chunk(t, d)), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** One ISO-BMFF box. */
function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

/** Stand-in for a rendered MP4: ftyp, a media payload, and a moov whose udta carries an encoder tag `meta` (as ffmpeg writes one). */
const mp4 = (media = 'frames', meta = 'Lavf61.7.100'): Buffer =>
  Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1')),
    box('mdat', Buffer.from(media, 'latin1')),
    box('moov', box('udta', box('meta', Buffer.concat([Buffer.alloc(4), box('ilst', box('\xa9too', box('data', Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(meta, 'latin1')]))))])))),
  ]);

/** Frames the stills fixtures use: ON is drawn with WalletWallaby on canvas, OFF is not (see `state`). */
const ON = 100;
const OFF = 200;

/** Render environments as Blender records them (render.py render_environment): the two approved classes, and one that is not. */
const ENVIRONMENTS = {
  'production-rtx5080': { os: 'windows', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 616.56', deviceType: 'NVIDIA' } },
  'proof-linux-software-gl': { os: 'linux', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'Mesa', renderer: 'llvmpipe (LLVM 21.1.8, 256 bits)', version: '4.5 (Core Profile) Mesa 26.0.3-1ubuntu1', deviceType: 'SOFTWARE' } },
  unapproved: { os: 'windows', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 999.99', deviceType: 'NVIDIA' } },
} as const;

/** The character record scripts/render.ts writes: this checkout's Blender identity and plan, rendered in `environment`. */
function characterRecord(state: PublicState, engine: 'typescript' | 'rust-wasm', frames: number[] | null, environment: keyof typeof ENVIRONMENTS = 'production-rtx5080') {
  const record = ENVIRONMENTS[environment];
  const cls = environmentClass(record, loadBlenderConfig(), loadEnvironments());
  const env = { classId: cls.id, approvedClass: cls.approvedAs?.name ?? null, purpose: cls.approvedAs?.purpose ?? null, record };
  const lesson = state.lesson(engine);
  const seam = findRevealSeam(lesson);
  const inReveal = (f: number) => seam !== null && f >= seam.first && f <= seam.last;
  const unique = frames ? [...new Set(frames)].sort((a, b) => a - b) : null;
  const sequenceBridge = contentAddress(lessonBridgeFor(lesson, unique ? unique.filter((f) => !inReveal(f)) : undefined));
  const revealFrames = unique ? unique.filter(inReveal) : null;
  const reveals =
    seam && (!revealFrames || revealFrames.length > 0)
      ? [(() => {
          const full = lessonBridge(lesson, seam.first, seam.last);
          const bridge = revealFrames ? { ...full, frames: full.frames.filter((f) => revealFrames.includes(f.frame)) } : full;
          return { name: 'reveal', range: { first: seam.first, last: seam.last }, frames: bridge.frames.length, renderSha256: '1'.repeat(64), bridgeSha256: contentAddress(bridge), environment: env };
        })()]
      : [];
  const b = state.identity.character.blender;
  return {
    renderer: 'blender',
    layout: 'crop',
    sequence: { name: 'sequence', frames: 1, renderSha256: '0'.repeat(64), bridgeSha256: sequenceBridge, environment: env },
    reveals,
    identity: {
      blenderVersion: b.version,
      blenderBuildHash: b.buildHash,
      blenderConfigSha256: b.configSha256,
      blenderSceneSourceSha256: b.sceneSourceSha256,
      walletwallabyModelVersion: b.model.version,
      walletwallabyModelSha256: b.model.sha256,
      materialsVersion: b.materials.version,
      materialsSha256: b.materials.sha256,
      motionPlanSha256: sequenceBridge,
    },
  };
}

/** A stills set as render:stills writes one: each frame twice (with and without WalletWallaby) and stills.json. */
function writeStills(dir: string, opts: { motionEngine?: unknown; twinOn?: 'differs' | 'same'; character?: unknown } = {}): string {
  mkdirSync(dir, { recursive: true });
  const files: { file: string; frame: number; bytes: Buffer }[] = [
    { file: '00-on.png', frame: ON, bytes: png(1) },
    { file: '01-off.png', frame: OFF, bytes: png(2) },
    { file: '00-on.characterless.png', frame: ON, bytes: opts.twinOn === 'same' ? png(1) : png(3) },
    { file: '01-off.characterless.png', frame: OFF, bytes: png(2) },
  ];
  for (const f of files) writeFileSync(path.join(dir, f.file), f.bytes);
  const info = {
    schema: 'walletwall.stills-info/v3',
    videoId: VIDEO_ID,
    revision: 1,
    specHash: contentAddress(loadCommittedSpec(VIDEO_ID)),
    motionEngine: opts.motionEngine ?? typescriptEngineIdentity(),
    identity: buildIdentity(),
    character: opts.character ?? characterRecord(state, 'typescript', [ON, OFF], 'proof-linux-software-gl'),
    stills: files.map((f) => ({ file: f.file, frame: f.frame, sha256: sha256Hex(f.bytes) })),
  };
  writeFileSync(path.join(dir, 'stills.json'), prettyJson(info));
  return dir;
}

/** Attach a render the way scripts/render.ts and publish-dry-run.ts record one. */
function attachRender(dir: string, state: PublicState, opts: { bytes?: Buffer; overlays?: Record<string, boolean>; motionEngine?: unknown; character?: unknown } = {}): void {
  const bytes = opts.bytes ?? mp4();
  writeFileSync(path.join(dir, MP4), bytes);
  const output = { path: `dist/${VIDEO_ID}/${MP4}`, sha256: sha256Hex(bytes) };
  const motionEngine = opts.motionEngine ?? typescriptEngineIdentity();
  writeFileSync(
    path.join(dir, 'render.json'),
    prettyJson({
      schema: 'walletwall.render-info/v6',
      videoId: VIDEO_ID,
      revision: 1,
      specHash: state.specHash,
      engine: { name: 'remotion', version: state.identity.toolchain.packages.remotion, compositionId: 'WalletWallDocsVideo' },
      fps: state.fps,
      frames: state.frames,
      durationMs: state.totalMs,
      output,
      narration: { providerId: state.narrationProviderId, estimated: true, audio: 'NONE', publication: null },
      overlays: opts.overlays ?? { captions: true, characterless: false, guides: false },
      identity: state.identity,
      motionEngine,
      character: opts.character ?? characterRecord(state, (motionEngine as { motionEngine?: string }).motionEngine === 'rust-wasm' ? 'rust-wasm' : 'typescript', null),
    }),
  );
  editJson<{ files: { video: unknown } }>(path.join(dir, 'publish-manifest.json'), (m) => {
    m.files.video = { ...output, durationMs: state.totalMs };
  });
  editJson<{ render: unknown }>(path.join(dir, 'provenance.json'), (p) => {
    p.render = { engine: 'remotion', version: state.identity.toolchain.packages.remotion, output: output.path, sha256: output.sha256, motionEngine };
  });
}

let state: PublicState;
let clean: string;

before(async () => {
  const real = await currentPublicState(VIDEO_ID, {});
  // Twin checks run against two frames of known visibility, not the current timeline's.
  state = { ...real, onCanvas: (frame) => frame === ON };
  clean = freshDir('clean');
  await writeDryRunPackage(clean);
});

/** A copy of the clean package with one change applied. */
function variant(label: string, change: (dir: string) => void): string {
  const dir = freshDir(label);
  cpSync(clean, dir, { recursive: true });
  change(dir);
  return dir;
}

const codesFor = (dir: string, opts: Parameters<typeof checkPublicOutput>[2] = {}, s: PublicState = state): PublicOutputCode[] => checkPublicOutput(dir, s, opts).report.findings.map((f) => f.code);

function refuses(dir: string, code: PublicOutputCode, opts: Parameters<typeof checkPublicOutput>[2] = {}, s: PublicState = state): void {
  const { report } = checkPublicOutput(dir, s, opts);
  assert.equal(report.ok, false, `expected ${code}, the gate passed`);
  assert.ok(
    report.findings.some((f) => f.code === code),
    `expected ${code}, got ${report.findings.map((f) => `${f.code} ${f.path}`).join('; ')}`,
  );
}

function passes(dir: string, opts: Parameters<typeof checkPublicOutput>[2] = {}, s: PublicState = state): void {
  const { report } = checkPublicOutput(dir, s, opts);
  assert.deepEqual(
    report.findings.map((f) => `${f.code} ${f.path}: ${f.message}`),
    [],
  );
  assert.equal(report.ok, true);
}

describe('public output: the clean package', () => {
  test('passes, and the report lists every file it verified with its hash', () => {
    const { report } = checkPublicOutput(clean, state, {});
    assert.deepEqual(report.findings, []);
    assert.equal(report.ok, true);
    const listed = report.files.map((f) => f.path).sort();
    assert.deepEqual(listed, [`${VIDEO_ID}/cue-sheet.json`, `${VIDEO_ID}/media-qa.json`, `${VIDEO_ID}/${SRT}`, `${VIDEO_ID}/${VTT}`, `${VIDEO_ID}/provenance.json`, `${VIDEO_ID}/publish-manifest.json`, `${VIDEO_ID}/receipt.json`, `${VIDEO_ID}/validation.json`]);
    for (const f of report.files) assert.equal(f.sha256, sha256Hex(readFileSync(path.join(clean, path.basename(f.path)))), f.path);
  });
});

describe('public output: publication gates', () => {
  test('media QA errors are refused even when the report claims ok', () => {
    refuses(variant('qa-hidden', (d) => editJson<{ issues: unknown[] }>(path.join(d, 'media-qa.json'), (q) => q.issues.push({ code: 'CAPTIONS_TIMING', severity: 'error', path: 'captions[1]', message: 'overlap' }))), 'MEDIA_QA_BLOCKED');
  });
  test('a media QA report that counts errors is refused', () => {
    refuses(variant('qa-errors', (d) => editJson<{ ok: boolean; errors: number }>(path.join(d, 'media-qa.json'), (q) => ((q.ok = false), (q.errors = 1)))), 'MEDIA_QA_BLOCKED');
  });
  test('spec validation errors are refused', () => {
    refuses(variant('validation', (d) => editJson<{ ok: boolean; errors: number; issues: unknown[] }>(path.join(d, 'validation.json'), (v) => ((v.ok = false), (v.errors = 1), v.issues.push({ code: 'TEXT_OVERFLOW', severity: 'error', path: 'segments[2]', message: 'x' })))), 'VALIDATION_BLOCKED');
  });
  test('provenance cannot record a validation verdict other than a fresh one', () => {
    refuses(variant('prov-validation', (d) => editJson<{ validation: { warnings: number } }>(path.join(d, 'provenance.json'), (p) => (p.validation.warnings = 3))), 'PROVENANCE_INCONSISTENT');
  });
  test('a receipt from a live upload is refused', () => {
    refuses(variant('live-receipt', (d) => editJson<{ receipt: { mode: string; youtubeId: string | null } }>(path.join(d, 'receipt.json'), (r) => ((r.receipt.mode = 'LIVE'), (r.receipt.youtubeId = 'dQw4w9WgXcQ')))), 'NOT_DRY_RUN');
  });
  test('a manifest that is not a dry run is refused', () => {
    refuses(variant('live-manifest', (d) => editJson<{ mode: string }>(path.join(d, 'publish-manifest.json'), (m) => (m.mode = 'LIVE'))), 'NOT_DRY_RUN');
  });
  test('a dry run that recorded an upload in the lineage is refused', () => {
    refuses(variant('lineage', (d) => editJson<{ lineageUnchanged: { versions: unknown[] } }>(path.join(d, 'receipt.json'), (r) => r.lineageUnchanged.versions.push({ revision: 1, youtubeId: 'x', status: 'UNLISTED_REVIEW' }))), 'NOT_DRY_RUN');
  });
  test('the initial privacy must be unlisted: private is refused', () => {
    refuses(variant('private', (d) => editJson<{ status: { privacyStatus: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.status.privacyStatus = 'private'))), 'PRIVACY_NOT_UNLISTED');
  });
  test('the initial privacy must be unlisted: a public receipt is refused', () => {
    refuses(variant('public-receipt', (d) => editJson<{ receipt: { privacyStatus: string } }>(path.join(d, 'receipt.json'), (r) => (r.receipt.privacyStatus = 'public'))), 'PRIVACY_NOT_UNLISTED');
  });
  for (const file of [VTT, SRT, 'provenance.json', 'publish-manifest.json', 'media-qa.json', 'validation.json', 'receipt.json', 'cue-sheet.json']) {
    test(`a missing ${file} is refused`, () => {
      refuses(variant(`missing-${file}`, (d) => unlinkSync(path.join(d, file))), 'ARTIFACT_MISSING');
    });
  }
  test('a linked artifact is refused, so a link cannot pull another file into the review bundle', (t) => {
    const outsideDir = freshDir('outside');
    const outside = path.join(outsideDir, 'cue-sheet.json');
    writeFileSync(outside, readFileSync(path.join(clean, 'cue-sheet.json')));
    const dir = variant('linked', (d) => unlinkSync(path.join(d, 'cue-sheet.json')));
    try {
      symlinkSync(outside, path.join(dir, 'cue-sheet.json'), 'file');
    } catch {
      // Windows without symlink privilege: a directory junction in the file's place (no elevation needed).
      try {
        symlinkSync(outsideDir, path.join(dir, 'cue-sheet.json'), 'junction');
      } catch (err) {
        t.skip(`cannot create a link here: ${(err as Error).message}`);
        return;
      }
    }
    refuses(dir, 'ARTIFACT_INVALID');
  });
  test('a corrupt JSON artifact is refused, not skipped', () => {
    refuses(variant('corrupt', (d) => writeFileSync(path.join(d, 'provenance.json'), '{"schema": ')), 'ARTIFACT_INVALID');
  });
  test('WebVTT captions that no longer reproduce the narration are refused', () => {
    refuses(variant('vtt-drift', (d) => writeFileSync(path.join(d, VTT), readFileSync(path.join(d, VTT), 'utf8').replace('urgent', 'pressing'))), 'CAPTIONS_MISMATCH');
  });
  test('SRT captions that drift from the WebVTT are refused', () => {
    refuses(variant('srt-drift', (d) => writeFileSync(path.join(d, SRT), readFileSync(path.join(d, SRT), 'utf8').replace('00:00:00,450', '00:00:00,500'))), 'CAPTIONS_MISMATCH');
  });
  test('captions from a voice this gate cannot re-derive are refused (fail closed)', () => {
    refuses(clean, 'CAPTIONS_MISMATCH', {}, { ...state, narrationProviderId: 'some-live-voice' });
  });
  test('a manifest naming different caption bytes is refused', () => {
    refuses(variant('caption-hash', (d) => editJson<{ files: { captions: { sha256: string } } }>(path.join(d, 'publish-manifest.json'), (m) => (m.files.captions.sha256 = '0'.repeat(64)))), 'MANIFEST_INCONSISTENT');
  });
  test('a manifest whose chapters break the platform rules is refused', () => {
    refuses(variant('chapters', (d) => editJson<{ chapters: { atMs: number; title: string }[] }>(path.join(d, 'publish-manifest.json'), (m) => m.chapters.splice(1, 0, { atMs: 4000, title: 'Too soon' }))), 'MANIFEST_INCONSISTENT');
  });
  test('a manifest this checkout would not produce is refused (playlist titles from an older config)', () => {
    // config/playlists.json is not part of the build identity, so only re-deriving the manifest catches this.
    refuses(variant('stale-playlist', (d) => editJson<{ playlists: { title: string }[]; snippet: { tags: string[] } }>(path.join(d, 'publish-manifest.json'), (m) => {
      m.playlists[0]!.title = 'WalletWall Vault Series';
      m.snippet.tags[m.snippet.tags.length - 1] = 'WalletWall Vault Series';
    })), 'MANIFEST_INCONSISTENT');
  });
  test('a manifest without the human review gate is refused', () => {
    refuses(variant('review', (d) => editJson<{ review: { required: boolean } }>(path.join(d, 'publish-manifest.json'), (m) => (m.review.required = false))), 'MANIFEST_INCONSISTENT');
  });
  test('artifacts made from a different spec are refused', () => {
    refuses(
      variant('spec', (d) => {
        editJson<{ specHash: string }>(path.join(d, 'publish-manifest.json'), (m) => (m.specHash = 'a'.repeat(64)));
        editJson<{ specHash: string }>(path.join(d, 'provenance.json'), (p) => (p.specHash = 'a'.repeat(64)));
      }),
      'SPEC_STALE',
    );
  });
  test('provenance made with a different build identity is refused', () => {
    refuses(variant('identity', (d) => editJson<{ identity: { toolchain: { lockfileSha256: string } } }>(path.join(d, 'provenance.json'), (p) => (p.identity.toolchain.lockfileSha256 = 'b'.repeat(64)))), 'IDENTITY_STALE');
  });
  test('a manifest whose docs blob is not the spec source is refused', () => {
    refuses(variant('doc-blob', (d) => editJson<{ provenance: { docBlob: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.provenance.docBlob = 'f'.repeat(40)))), 'SOURCE_IDENTITY_INVALID');
  });
  test('provenance that points the canonical page somewhere else is refused', () => {
    refuses(variant('doc-url', (d) => editJson<{ source: { docUrl: string } }>(path.join(d, 'provenance.json'), (p) => (p.source.docUrl = 'https://example.com/concepts/migration-readiness'))), 'SOURCE_IDENTITY_INVALID');
  });
  for (const name of ['YOUTUBE_REFRESH_TOKEN', 'YT_UPLOAD_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
    test(`a publication credential in the environment (${name}) fails the credential-free gate`, () => {
      refuses(clean, 'CREDENTIAL_PRESENT', {}, { ...state, env: { [name]: 'not-a-real-credential-0123456789' } });
    });
  }
  test('ordinary CI and tool environment variables are not publication credentials', () => {
    // EXAMPLE_TOOL_OAUTH_SCOPES reproduces a real false positive: a developer tool's OAuth setting is not a YouTube credential.
    passes(clean, {}, { ...state, env: { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Wallet-Wall/walletwall-audio-visual-docs', RUNNER_OS: 'Linux', EXAMPLE_TOOL_OAUTH_SCOPES: 'user:inference' } });
  });
});

describe('public output: placeholder and leaked-value text', () => {
  const cases: [string, (d: string) => void][] = [
    ['title TODO', (d) => editJson<{ snippet: { title: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.title += ' TODO'))],
    ['description TBD', (d) => editJson<{ snippet: { description: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.description += '\nTBD'))],
    ['chapter FIXME', (d) => editJson<{ chapters: { title: string }[] }>(path.join(d, 'publish-manifest.json'), (m) => (m.chapters[1]!.title = 'FIXME: name this'))],
    ['chapter undefined', (d) => editJson<{ chapters: { title: string }[] }>(path.join(d, 'publish-manifest.json'), (m) => (m.chapters[2]!.title = 'undefined'))],
    ['tag [object Object]', (d) => editJson<{ snippet: { tags: string[] } }>(path.join(d, 'publish-manifest.json'), (m) => m.snippet.tags.push('[object Object]'))],
    ['playlist NaN', (d) => editJson<{ playlists: { title: string }[] }>(path.join(d, 'publish-manifest.json'), (m) => (m.playlists[0]!.title = 'Part NaN'))],
    ['description lorem ipsum', (d) => editJson<{ snippet: { description: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.description += '\nLorem ipsum dolor sit amet'))],
    ['description template', (d) => editJson<{ snippet: { description: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.description += '\nWatch ${nextVideo}'))],
    ['caption text', (d) => writeFileSync(path.join(d, VTT), readFileSync(path.join(d, VTT), 'utf8').replace('how urgent is the risk?', 'how urgent is TODO?'))],
  ];
  for (const [name, change] of cases) {
    test(`${name} is refused`, () => refuses(variant(`placeholder-${name}`, change), 'PLACEHOLDER_TEXT'));
  }
  test('on-screen copy with a placeholder is refused', () => {
    refuses(clean, 'PLACEHOLDER_TEXT', {}, { ...state, publicCopy: [...state.publicCopy, { path: 'spec:segments[3].scene.heading', text: 'Tiers: {{tierName}}' }] });
  });
  test('legitimate copy that merely contains these letters is not flagged', () => {
    const copy = { path: 'spec:segments[2].scene.body[0].text', text: 'Not financial advice. Undefined behaviour is not a feature. Stand-up notes: today, tomorrow.' };
    passes(clean, {}, { ...state, publicCopy: [...state.publicCopy, copy] });
  });
});

describe('public output: local machine paths', () => {
  const cases: [string, (d: string) => void][] = [
    ['a Windows path in provenance', (d) => editJson<{ claims: { evidence: { path?: string }[] }[] }>(path.join(d, 'provenance.json'), (p) => (p.claims[0]!.evidence[0]!.path = 'C:\\Users\\example\\docs\\x.mdx'))],
    ['a Linux home path in the description', (d) => editJson<{ snippet: { description: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.snippet.description += '\nRendered in /home/runner/work/x'))],
    ['a macOS home path in the cue sheet', (d) => editJson<{ cues: { segmentId: string }[] }>(path.join(d, 'cue-sheet.json'), (c) => (c.cues[0]!.segmentId = '/Users/example/clip'))],
    ['a file URL in media QA', (d) => editJson<{ issues: unknown[]; warnings: number }>(path.join(d, 'media-qa.json'), (q) => ((q.warnings = 1), q.issues.push({ code: 'CAPTIONS_TIMING', severity: 'warning', path: 'file:///tmp/x.vtt', message: 'x' })))],
    ['the checkout path in the receipt', (d) => editJson<{ receipt: Record<string, unknown> }>(path.join(d, 'receipt.json'), (r) => (r.receipt.note = path.join(VIDEO_ROOT, 'dist')))],
    // Where Remotion bundles, Chrome profiles, and toolchains live on a Linux runner or a Mac.
    ['a Linux temp path in the receipt', (d) => editJson<{ receipt: Record<string, unknown> }>(path.join(d, 'receipt.json'), (r) => (r.receipt.note = '/tmp/remotion-webpack-bundle-x1y2z3/index.html'))],
    ['a runner toolcache path in the cue sheet', (d) => editJson<{ cues: { reason: string }[] }>(path.join(d, 'cue-sheet.json'), (c) => (c.cues[0]!.reason = '/opt/hostedtoolcache/node/24.10.0/x64/bin/node'))],
    ['a WSL mount path in the cue sheet', (d) => editJson<{ cues: { reason: string }[] }>(path.join(d, 'cue-sheet.json'), (c) => (c.cues[0]!.reason = '/mnt/c/Users/example/x'))],
    ['a macOS temp path in media QA', (d) => editJson<{ issues: unknown[]; warnings: number }>(path.join(d, 'media-qa.json'), (q) => ((q.warnings = 1), q.issues.push({ code: 'CAPTIONS_TIMING', severity: 'warning', path: 'captions[1]', message: 'see /private/var/folders/xy/T/out.vtt' })))],
  ];
  for (const [name, change] of cases) {
    test(`${name} is refused`, () => refuses(variant(`path-${name}`, change), 'LOCAL_PATH'));
  }
  test('repo-relative paths, workspace paths, and URLs whose path contains /home/ or /tmp/ are not local paths', () => {
    passes(
      variant('path-negative', (d) =>
        editJson<{ cues: { reason: string }[] }>(path.join(d, 'cue-sheet.json'), (c) => {
          c.cues[0]!.reason = 'See https://docs.walletwall.org/home/overview, https://example.com/tmp/x and docs/concepts/migration-readiness.mdx (video/specs/x.json, dist/x/y.vtt).';
        }),
      ),
    );
  });
});

describe('public output: renders', () => {
  const withRender = (label: string, opts: Parameters<typeof attachRender>[2] = {}, change: (d: string) => void = () => {}): string =>
    variant(label, (d) => {
      attachRender(d, state, opts);
      change(d);
    });

  test('a consistent render passes, and the MP4 and render.json join the verified files', () => {
    const dir = withRender('render-clean');
    passes(dir, { requireRender: true });
    const listed = checkPublicOutput(dir, state, { requireRender: true }).report.files.map((f) => f.path);
    assert.ok(listed.includes(`${VIDEO_ID}/${MP4}`) && listed.includes(`${VIDEO_ID}/render.json`));
  });
  test('a required render that is missing is refused', () => {
    refuses(clean, 'ARTIFACT_MISSING', { requireRender: true });
  });
  test('MP4 bytes that are not the recorded render are refused', () => {
    refuses(withRender('render-bytes', {}, (d) => writeFileSync(path.join(d, MP4), mp4('other frames'))), 'RENDER_INCONSISTENT');
  });
  test('a render of a different spec is refused even when its timeline is unchanged', () => {
    // An on-screen text edit leaves the timeline (and the build identity) unchanged; only the spec hash tells.
    refuses(withRender('render-spec', {}, (d) => editJson<{ specHash: string }>(path.join(d, 'render.json'), (r) => (r.specHash = 'a'.repeat(64)))), 'SPEC_STALE');
  });
  test('a render.json from before renders recorded their spec (v3) is refused', () => {
    refuses(
      withRender('render-v3', {}, (d) =>
        editJson<{ schema: string; specHash?: string }>(path.join(d, 'render.json'), (r) => {
          r.schema = 'walletwall.render-info/v4';
          delete r.specHash;
        }),
      ),
      'ARTIFACT_INVALID',
    );
  });
  test('a render made with a different build identity is refused', () => {
    refuses(withRender('render-identity', {}, (d) => editJson<{ identity: { toolchain: { node: string } } }>(path.join(d, 'render.json'), (r) => (r.identity.toolchain.node = 'v0.0.0'))), 'IDENTITY_STALE');
  });
  test('a render with the debug guides overlay is refused', () => {
    refuses(withRender('render-guides', { overlays: { captions: true, characterless: false, guides: true } }), 'DEBUG_OUTPUT');
  });
  test('a characterless design-test render is refused as a publication render', () => {
    refuses(withRender('render-characterless', { overlays: { captions: true, characterless: true, guides: false } }), 'DEBUG_OUTPUT');
  });
  test('provenance naming a different render is refused', () => {
    refuses(withRender('render-prov', {}, (d) => editJson<{ render: { sha256: string } }>(path.join(d, 'provenance.json'), (p) => (p.render.sha256 = 'c'.repeat(64)))), 'PROVENANCE_INCONSISTENT');
  });
  test('a manifest that leaves out an existing render is refused', () => {
    refuses(withRender('render-manifest', {}, (d) => editJson<{ files: { video: unknown } }>(path.join(d, 'publish-manifest.json'), (m) => (m.files.video = null))), 'MANIFEST_INCONSISTENT');
  });
  test('a local path in the MP4 metadata is refused', () => {
    refuses(withRender('render-meta', { bytes: mp4('frames', 'C:\\Users\\example\\render\\out.mp4') }), 'LOCAL_PATH');
  });
  test('path-like bytes inside the compressed media payload are not metadata', () => {
    passes(withRender('render-mdat', { bytes: mp4('/home/xx/C:\\Users\\yy') }), { requireRender: true });
  });
  test('a TypeScript-engine render recording another motion version is refused', () => {
    refuses(withRender('render-ts-engine', { motionEngine: { motionEngine: 'typescript', motion: { id: 'walletwallaby-motion', version: 2 } } }), 'MOTION_ENGINE_STALE');
  });
  test('a rust-wasm render whose WASM, config, and plans are this checkout\'s passes', () => {
    passes(withRender('render-rust', { motionEngine: state.rustEngine() }), { requireRender: true });
  });
  test('a rust-wasm render naming a stale WASM artifact is refused', () => {
    const stale = structuredClone(state.rustEngine()) as { wasm: { sha256: string } };
    stale.wasm.sha256 = 'd'.repeat(64);
    refuses(withRender('render-rust-wasm', { motionEngine: stale }), 'MOTION_ENGINE_STALE');
  });
  test('a rust-wasm render naming a stale plan is refused', () => {
    const stale = structuredClone(state.rustEngine()) as { paths: { planSha256: string }[] };
    stale.paths[0]!.planSha256 = 'e'.repeat(64);
    refuses(withRender('render-rust-plan', { motionEngine: stale }), 'MOTION_ENGINE_STALE');
  });
  test('a render that records no Blender character is refused', () => {
    refuses(withRender('render-no-character', { character: { renderer: 'none' } }), 'ARTIFACT_INVALID');
  });
  test('a publication render from the proof class is refused: only a publication class may be published', () => {
    refuses(withRender('render-proof-class', { character: characterRecord(state, 'typescript', null, 'proof-linux-software-gl') }), 'RENDER_ENVIRONMENT_UNAPPROVED');
  });
  test('a render from an unapproved environment (a new driver) is refused', () => {
    refuses(withRender('render-unapproved', { character: characterRecord(state, 'typescript', null, 'unapproved') }), 'RENDER_ENVIRONMENT_UNAPPROVED');
  });
  test('a forged class label is refused: the class is re-derived from the environment record', () => {
    const forged = characterRecord(state, 'typescript', null, 'unapproved');
    forged.sequence.environment = { ...forged.sequence.environment, approvedClass: 'production-rtx5080', purpose: 'publication' };
    refuses(withRender('render-forged-class', { character: forged }), 'RENDER_ENVIRONMENT_UNAPPROVED');
  });
  test('character frames rendered from another MotionPlan are refused', () => {
    const other = characterRecord(state, 'typescript', null);
    other.sequence.bridgeSha256 = 'c'.repeat(64);
    refuses(withRender('render-other-plan', { character: other }), 'CHARACTER_STALE');
  });
  test('character frames from another built model are refused', () => {
    const other = characterRecord(state, 'typescript', null);
    other.identity.walletwallabyModelSha256 = 'd'.repeat(64);
    refuses(withRender('render-other-model', { character: other }), 'CHARACTER_STALE');
  });
  test('a render without the depth reveal its lesson has is refused', () => {
    const other = characterRecord(state, 'typescript', null);
    other.reveals = [];
    refuses(withRender('render-no-reveal', { character: other }), 'CHARACTER_STALE');
  });
});

describe('public output: review stills', () => {
  test('a consistent stills set passes and joins the verified files under its engine', () => {
    const stills = writeStills(freshDir('stills-clean'));
    passes(clean, { stills: [stills] });
    const listed = checkPublicOutput(clean, state, { stills: [stills] }).report.files.map((f) => f.path);
    assert.ok(listed.includes(`${VIDEO_ID}/stills/typescript/00-on.characterless.png`) && listed.includes(`${VIDEO_ID}/stills/typescript/stills.json`));
  });
  test('a still whose bytes are not the ones stills.json names is refused', () => {
    const stills = writeStills(freshDir('stills-bytes'));
    writeFileSync(path.join(stills, '01-off.png'), png(9));
    refuses(clean, 'STILLS_INCONSISTENT', { stills: [stills] });
  });
  test('a PNG left over from another render is refused', () => {
    const stills = writeStills(freshDir('stills-extra'));
    writeFileSync(path.join(stills, 'f00042.png'), png(5));
    refuses(clean, 'STILLS_INCONSISTENT', { stills: [stills] });
  });
  test('a frame without its characterless twin is refused', () => {
    const stills = writeStills(freshDir('stills-twin'));
    unlinkSync(path.join(stills, '01-off.characterless.png'));
    editJson<{ stills: { file: string }[] }>(path.join(stills, 'stills.json'), (s) => (s.stills = s.stills.filter((x) => x.file !== '01-off.characterless.png')));
    refuses(clean, 'CHARACTERLESS_MISSING', { stills: [stills] });
  });
  test('a characterless twin identical to its frame while WalletWallaby is on canvas is refused', () => {
    refuses(clean, 'CHARACTERLESS_INEFFECTIVE', { stills: [writeStills(freshDir('stills-same'), { twinOn: 'same' })] });
  });
  test('an identical twin where WalletWallaby is off canvas is expected, not refused', () => {
    // writeStills always makes the OFF frame's twin identical: the clean case above already covers it.
    const stills = writeStills(freshDir('stills-off'));
    const info = readJsonFile<{ stills: { file: string; sha256: string }[] }>(path.join(stills, 'stills.json'));
    const sha = (f: string) => info.stills.find((s) => s.file === f)!.sha256;
    assert.equal(sha('01-off.png'), sha('01-off.characterless.png'));
    passes(clean, { stills: [stills] });
  });
  test('stills of a different spec are refused', () => {
    const stills = writeStills(freshDir('stills-spec'));
    editJson<{ specHash: string }>(path.join(stills, 'stills.json'), (s) => (s.specHash = 'b'.repeat(64)));
    refuses(clean, 'SPEC_STALE', { stills: [stills] });
  });
  test('stills made with a different build identity are refused', () => {
    const stills = writeStills(freshDir('stills-identity'));
    editJson<{ identity: { configs: Record<string, string> } }>(path.join(stills, 'stills.json'), (s) => (s.identity.configs['config/youtube.json'] = '1'.repeat(64)));
    refuses(clean, 'IDENTITY_STALE', { stills: [stills] });
  });
  test('stills from the proof class pass; from an unapproved class they are refused', () => {
    passes(clean, { stills: [writeStills(freshDir('stills-proof-class'))] });
    refuses(clean, 'RENDER_ENVIRONMENT_UNAPPROVED', { stills: [writeStills(freshDir('stills-unapproved'), { character: characterRecord(state, 'typescript', [ON, OFF], 'unapproved') })] });
  });
  test('stills whose character frames were rendered for other frames are refused', () => {
    refuses(clean, 'CHARACTER_STALE', { stills: [writeStills(freshDir('stills-other-frames'), { character: characterRecord(state, 'typescript', [ON, OFF + 1], 'proof-linux-software-gl') })] });
  });
  test('stills naming a stale motion engine are refused', () => {
    refuses(clean, 'MOTION_ENGINE_STALE', { stills: [writeStills(freshDir('stills-engine'), { motionEngine: { motionEngine: 'typescript', motion: { id: 'walletwallaby-motion', version: 1 } } })] });
  });
  test('a still carrying a text chunk is refused, and a local path in it is named', () => {
    const stills = writeStills(freshDir('stills-meta'));
    const bytes = png(1, [['tEXt', Buffer.from('Source\0C:\\Users\\example\\render.png', 'latin1')]]);
    writeFileSync(path.join(stills, '00-on.png'), bytes);
    editJson<{ stills: { file: string; sha256: string }[] }>(path.join(stills, 'stills.json'), (s) => (s.stills.find((x) => x.file === '00-on.png')!.sha256 = sha256Hex(bytes)));
    const codes = codesFor(clean, { stills: [stills] });
    assert.ok(codes.includes('METADATA_PRESENT') && codes.includes('LOCAL_PATH'), codes.join(', '));
  });
  test('two stills sets from the same engine are refused as ambiguous', () => {
    refuses(clean, 'STILLS_INCONSISTENT', { stills: [writeStills(freshDir('stills-a')), writeStills(freshDir('stills-b'))] });
  });
  test('the real visibility predicate: WalletWallaby is on canvas in the hook and hidden for the ident', async () => {
    const real = await currentPublicState(VIDEO_ID, {});
    const spec = loadCommittedSpec(VIDEO_ID);
    const config = loadPipelineConfig();
    const timeline = buildTimeline(spec, await synthesize(spec, new FixtureVoiceProvider(), config), config.templates);
    const settled = (role: string) => {
      const s = timeline.segments.find((x) => x.role === role)!;
      return msToFrame(s.contentStartMs + (s.endMs - s.contentStartMs) * 0.72, timeline.fps);
    };
    assert.equal(real.onCanvas(settled('HOOK')), true);
    assert.equal(real.onCanvas(settled('IDENT')), false);
  });
});

describe('repeat-render comparison', () => {
  const pair = (label: string): [string, string] => {
    const a = writeStills(freshDir(`${label}-a`));
    const b = freshDir(`${label}-b`);
    cpSync(a, b, { recursive: true });
    return [a, b];
  };
  test('two identical renders compare equal, still by still', () => {
    const [a, b] = pair('cmp-same');
    assert.deepEqual(compareStillSets(a, b), { identical: true, stills: 4, differences: [] });
  });
  test('one changed byte in one PNG is a difference that names the file', () => {
    const [a, b] = pair('cmp-byte');
    const file = path.join(b, '00-on.png');
    const bytes = readFileSync(file);
    bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 1;
    writeFileSync(file, bytes);
    editJson<{ stills: { file: string; sha256: string }[] }>(path.join(b, 'stills.json'), (s) => (s.stills.find((x) => x.file === '00-on.png')!.sha256 = sha256Hex(bytes)));
    const r = compareStillSets(a, b);
    assert.equal(r.identical, false);
    assert.ok(r.differences.some((d) => d.includes('00-on.png')), r.differences.join('; '));
  });
  test('a still whose bytes disagree with its own stills.json is a difference', () => {
    const [a, b] = pair('cmp-chain');
    writeFileSync(path.join(b, '01-off.png'), png(8));
    assert.equal(compareStillSets(a, b).identical, false);
  });
  test('different stills.json metadata is a difference', () => {
    const [a, b] = pair('cmp-meta');
    editJson<{ revision: number }>(path.join(b, 'stills.json'), (s) => (s.revision = 2));
    assert.equal(compareStillSets(a, b).identical, false);
  });
  test('a file only one render produced is a difference', () => {
    const [a, b] = pair('cmp-extra');
    writeFileSync(path.join(b, 'f00001.png'), png(4));
    assert.equal(compareStillSets(a, b).identical, false);
  });
  test('an empty or missing render is never "identical"', () => {
    const a = freshDir('cmp-empty-a');
    const b = freshDir('cmp-empty-b');
    assert.equal(compareStillSets(a, b).identical, false);
  });
  test('the stills:compare CLI exits 0 for identical renders and 1 for a difference', () => {
    const cli = (a: string, b: string) => spawnSync(process.execPath, [path.join(VIDEO_ROOT, 'scripts', 'stills-compare.ts'), a, b], { cwd: VIDEO_ROOT, encoding: 'utf8' });
    const [a, b] = pair('cmp-cli');
    const same = cli(a, b);
    assert.equal(same.status, 0, same.stdout + same.stderr);
    writeFileSync(path.join(b, 'f00009.png'), png(7));
    const differs = cli(a, b);
    assert.equal(differs.status, 1, differs.stdout + differs.stderr);
    assert.match(differs.stdout + differs.stderr, /f00009\.png/);
  });
});

describe('engine review frames', () => {
  test('one airborne frame of each path the Rust engine performs, on canvas when the flight is, in timeline order', async () => {
    const r = spawnSync(process.execPath, [path.join(VIDEO_ROOT, 'scripts', 'engine-path-frames.ts'), VIDEO_ID], { cwd: VIDEO_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const frames = r.stdout.trim().split(',').map(Number);
    const config = loadPipelineConfig();
    const spec = loadCommittedSpec(VIDEO_ID);
    const source = loadSnapshot(spec);
    const track = await synthesize(spec, new FixtureVoiceProvider(), config);
    const { props } = planRustMotion({ spec, track, templates: config.templates, headings: Object.fromEntries(source.sections.map((s) => [s.id, s.heading])) });
    assert.equal(frames.length, props.paths.length);
    const onCanvas = (p: { x: number; y: number }) => p.x >= 0 && p.x <= spec.output.width && p.y >= 0 && p.y <= spec.output.height;
    frames.forEach((f, i) => {
      const plan = props.paths[i]!.plan;
      const sample = plan.samples[f - plan.frames.first];
      // The flight is what the engine solves; a perch or ground hold after landing would not exercise it.
      assert.equal(sample?.contact, 'NONE', `frame ${f} of path ${i} (${plan.frames.first}+${plan.frames.count}) is not airborne`);
      // And the still must show it: when any of the flight is inside the frame, the chosen frame is.
      if (plan.samples.some((s) => s.contact === 'NONE' && onCanvas(s.position))) assert.ok(onCanvas(sample.position), `frame ${f} of path ${i} has the feet outside the frame`);
      if (i > 0) assert.ok(f > frames[i - 1]!, 'ascending');
    });
  });
});

describe('review bundle', () => {
  test('holds exactly the verified files and the report, with no absolute path anywhere', () => {
    const stills = writeStills(freshDir('bundle-stills'));
    const result = checkPublicOutput(clean, state, { stills: [stills] });
    const bundle = path.join(freshDir('bundle'), 'out');
    writeReviewBundle(result, bundle);
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(bundle, path.join(d, e.name)).split(path.sep).join('/')]));
    assert.deepEqual(walk(bundle).sort(), [...result.report.files.map((f) => f.path), 'public-output-check.json'].sort());
    const report = readFileSync(path.join(bundle, 'public-output-check.json'), 'utf8');
    for (const root of [VIDEO_ROOT, scratch, os.homedir()]) assert.ok(!report.includes(root) && !report.includes(root.split(path.sep).join('/')), `report names ${root}`);
    for (const f of result.report.files) assert.equal(sha256Hex(readFileSync(path.join(bundle, ...f.path.split('/')))), f.sha256, f.path);
  });
  test('is never written for a package with findings', () => {
    const result = checkPublicOutput(variant('bundle-bad', (d) => unlinkSync(path.join(d, VTT))), state, {});
    const bundle = path.join(freshDir('bundle-bad-out'), 'out');
    assert.throws(() => writeReviewBundle(result, bundle), /findings/);
    assert.equal(existsSync(bundle), false);
  });
  test('refuses a file that changed after it was verified', () => {
    const dir = variant('bundle-toctou', () => {});
    const result = checkPublicOutput(dir, state, {});
    writeFileSync(path.join(dir, 'cue-sheet.json'), '{}\n');
    assert.throws(() => writeReviewBundle(result, path.join(freshDir('bundle-toctou-out'), 'out')), /changed/);
  });
  test('refuses to mix into a non-empty directory', () => {
    const result = checkPublicOutput(clean, state, {});
    const bundle = freshDir('bundle-dirty');
    writeFileSync(path.join(bundle, 'stale.png'), png(6));
    assert.throws(() => writeReviewBundle(result, bundle), /not empty/);
  });
});

describe('the Markdown summary', () => {
  test('escapes backslashes and pipes and keeps each table row on one line', () => {
    const { report } = checkPublicOutput(clean, state, {});
    const tricky = { ...report, summary: { ...report.summary, title: 'a\\|b | c\nd' } };
    const row = markdownSummary(tricky, false).split('\n').find((l) => l.startsWith('| Title |'));
    assert.equal(row, '| Title | a\\\\\\|b \\| c d |');
  });
});

describe('the public-output CLI', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [path.join(VIDEO_ROOT, 'scripts', 'public-output-check.ts'), VIDEO_ID, ...args], { cwd: VIDEO_ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } });

  test('exits 0 on a clean package, writes the bundle, and appends a Markdown summary', () => {
    const out = freshDir('cli-ok');
    const bundle = path.join(out, 'bundle');
    const summary = path.join(out, 'summary.md');
    const r = run(`--dir=${clean}`, `--bundle=${bundle}`, `--summary=${summary}`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(path.join(bundle, 'public-output-check.json')));
    assert.match(readFileSync(summary, 'utf8'), /Public output: PASS/);
  });
  test('exits 1 on a tampered package and writes no bundle', () => {
    const dir = variant('cli-bad', (d) => editJson<{ status: { privacyStatus: string } }>(path.join(d, 'publish-manifest.json'), (m) => (m.status.privacyStatus = 'private')));
    const bundle = path.join(freshDir('cli-bad-out'), 'bundle');
    const r = run(`--dir=${dir}`, `--bundle=${bundle}`);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /PRIVACY_NOT_UNLISTED/);
    assert.equal(existsSync(bundle), false);
  });
});
