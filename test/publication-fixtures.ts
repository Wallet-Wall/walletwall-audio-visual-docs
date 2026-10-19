// Fixtures for the publication-proof tests (test/leak-policy.test.ts, test/publication-receipt.test.ts): a clean
// publication package assembled in-process the way scripts/validate.ts and scripts/publish-dry-run.ts write one, a
// render attached the way scripts/render.ts records one, and the Blender evidence a production render leaves
// (render.py's manifests, the invariants report). The package builders follow test/public-output-check.test.ts; they
// are kept here, not imported from it, because importing a test file would run its tests. Nothing reads or writes
// dist/: every directory is a fresh temp dir.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { buildCaptions, checkCaptions, toSrt, toWebVtt } from '../src/audio/captions.ts';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { environmentClass, loadEnvironments, presentationHashes, type RenderEnvironment } from '../src/blender/identity.ts';
import { lessonBridge, lessonBridgeFor, lessonTerrain, strideFrames } from '../src/blender/lesson.ts';
import { findRevealSeam } from '../src/blender/reveal.ts';
import { INVARIANT_THRESHOLDS } from '../src/blender/invariants-policy.ts';
import { characterShots } from '../src/blender/production.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { planMotion } from '../src/character/walletwallaby/motion.ts';
import { loadPipelineConfig, VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { typescriptEngineIdentity } from '../src/motion/engine-identity.ts';
import { loadCommittedSpec, validationContextFor } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';
import { buildPublishManifest, checkPublishManifest } from '../src/publish/manifest.ts';
import type { EvidenceSources } from '../src/publish/proof-receipt.ts';
import { checkPublicOutput, writeReviewBundle, type PublicState } from '../src/publish/public-output.ts';
import { DryRunUploadProvider } from '../src/publish/upload-provider.ts';
import { loadDocsSite } from '../src/source/load.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';
import { VIDEO_ID } from './helpers.ts';

export { VIDEO_ID };
export const MP4 = `${VIDEO_ID}.r1.mp4`;
export const VTT = `${VIDEO_ID}.en.vtt`;
export const SRT = `${VIDEO_ID}.en.srt`;

/** A scratch area under the OS temp dir; `cleanup` removes it. */
export function scratchArea(label: string): { dir: (name: string) => string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), `ww-av-${label}-`));
  let serial = 0;
  return {
    dir: (name) => {
      const d = path.join(root, `${String(serial++).padStart(3, '0')}-${name}`);
      mkdirSync(d, { recursive: true });
      return d;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export const readJsonFile = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
export const editJson = <T>(file: string, edit: (doc: T) => void): void => {
  const doc = readJsonFile<T>(file);
  edit(doc);
  writeFileSync(file, prettyJson(doc));
};

/** The package scripts/validate.ts + scripts/publish-dry-run.ts write for a video with no render. */
export async function writeDryRunPackage(dir: string): Promise<void> {
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
export function png(seed: number, extra: [type: string, data: Buffer][] = []): Buffer {
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
export function box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

/** Stand-in for a rendered MP4: ftyp, a media payload, and a moov whose udta carries an encoder tag `meta`. */
export const mp4 = (media = 'frames', meta = 'Lavf61.7.100'): Buffer =>
  Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2avc1mp41', 'latin1')),
    box('mdat', Buffer.from(media, 'latin1')),
    box('moov', box('udta', box('meta', Buffer.concat([Buffer.alloc(4), box('ilst', box('\xa9too', box('data', Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(meta, 'latin1')]))))])))),
  ]);

/** Render environments as Blender records them (render.py render_environment): the two approved classes, and one that is not. */
export const ENVIRONMENTS = {
  'production-rtx5080': { os: 'windows', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 616.56', deviceType: 'NVIDIA' } },
  'proof-linux-software-gl': { os: 'linux', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'Mesa', renderer: 'llvmpipe (LLVM 21.1.8, 256 bits)', version: '4.5 (Core Profile) Mesa 26.0.3-1ubuntu1', deviceType: 'SOFTWARE' } },
  'new-driver': { os: 'windows', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 620.10', deviceType: 'NVIDIA' } },
} as const satisfies Record<string, RenderEnvironment>;
export type EnvironmentName = keyof typeof ENVIRONMENTS;

/** The environment block scripts/render.ts records: the class re-derived from the record, as staging derives it. */
export function environmentRecord(record: unknown) {
  const cls = environmentClass(record as RenderEnvironment, loadBlenderConfig(), loadEnvironments());
  return { classId: cls.id, approvedClass: cls.approvedAs?.name ?? null, purpose: cls.approvedAs?.purpose ?? null, record };
}

/**
 * A Blender render manifest as render.py writes one (timings included), for the given shots: name, frame, and, in the
 * crop layout, the crop decided before rendering.
 */
export function blenderManifest(environment: unknown, shots: { name: string; frame: number; crop?: { x: number; y: number; width: number; height: number } }[], opts: { seed?: number } = {}) {
  return {
    schema: 'walletwall.blender-render/v1',
    blenderVersion: '5.2.2 LTS',
    environment,
    shots: shots.map((s, i) => ({
      name: s.name,
      frame: s.frame,
      ...(s.crop ? { crop: s.crop } : {}),
      ms: 190 + (i % 7),
      contactErrorPx: { target_heel_n: 0.0001, target_toe_n: 0.0002 },
      sha256: sha256Hex(`frame ${s.frame} seed ${opts.seed ?? 0}`),
    })),
    seconds: 12.5,
    firstShotMs: 976.2,
  };
}

/** What staging records as a Blender render's content (src/blender/stage.ts renderContentSha256): never its timings. */
export const renderContentSha256 = (m: ReturnType<typeof blenderManifest>): string =>
  contentAddress({ schema: m.schema, environment: m.environment, shots: m.shots.map((s) => ({ name: s.name, frame: s.frame, sha256: s.sha256 })) });

/**
 * The character record scripts/render.ts writes for a whole-lesson render, and the Blender manifests behind it: this
 * checkout's Blender identity and plan, rendered in `environment`.
 */
export function characterEvidence(state: PublicState, engine: 'typescript' | 'rust-wasm' = 'typescript', environment: EnvironmentName = 'production-rtx5080', opts: { truncateShots?: boolean } = {}) {
  const record = ENVIRONMENTS[environment];
  const env = environmentRecord(record);
  const lesson = state.lesson(engine);
  const seam = findRevealSeam(lesson);
  const sequenceBridge = lessonBridgeFor(lesson, undefined);
  // The shots production renders for this plan (src/blender/production.ts characterShots), or a consistent subset.
  const planned = characterShots(sequenceBridge, 'crop', loadBlenderConfig()).map((s) => ({ name: s.name, frame: s.frame, crop: s.camera.kind === 'crop' ? { x: s.camera.x, y: s.camera.y, width: s.camera.width, height: s.camera.height } : undefined }));
  const sequenceManifest = blenderManifest(record, opts.truncateShots ? planned.slice(0, 3) : planned);
  const reveal = seam ? lessonBridge(lesson, seam.first, seam.last) : null;
  const revealManifest = reveal ? blenderManifest(record, reveal.frames.map((f) => ({ name: `f${String(f.frame).padStart(5, '0')}`, frame: f.frame })), { seed: 1 }) : null;
  const sequenceName = `${VIDEO_ID}-r1-${engine}-crop-lesson`;
  const revealName = `${VIDEO_ID}-r1-${engine}-reveal-lesson`;
  const b = state.identity.character.blender;
  const planSha256 = contentAddress(sequenceBridge);
  const character = {
    renderer: 'blender',
    layout: 'crop',
    sequence: { name: sequenceName, frames: sequenceManifest.shots.length, renderSha256: renderContentSha256(sequenceManifest), bridgeSha256: planSha256, environment: env },
    reveals:
      seam && reveal && revealManifest
        ? [{ name: revealName, range: { first: seam.first, last: seam.last }, frames: revealManifest.shots.length, renderSha256: renderContentSha256(revealManifest), bridgeSha256: contentAddress(reveal), environment: env }]
        : [],
    // The Blender identity staging records (src/blender/identity.ts blenderIdentity), less the .blend cache's bytes.
    identity: {
      schema: 'walletwall.blender-identity/v1',
      blenderVersion: b.version,
      blenderBuildHash: b.buildHash,
      blenderConfigSha256: b.configSha256,
      blenderSceneSourceSha256: b.sceneSourceSha256,
      walletwallabyModelVersion: b.model.version,
      walletwallabyModelSha256: b.model.sha256,
      walletwallabyRealizationSha256: 'ac81bb8e27868cb5feb0dee2c9cf7e66b6a4b63d5df77dd242a33bab5273f18c',
      walletwallabyRigVersion: state.identity.character.rig.version,
      materialsVersion: b.materials.version,
      materialsSha256: b.materials.sha256,
      motionBridgeSchema: 'walletwall.blender-motion/v1',
      motionPlanSha256: planSha256,
      terrainSha256: contentAddress(lessonTerrain(lesson, sequenceBridge)),
      ...presentationHashes(loadBlenderConfig()),
    },
  };
  const manifests: Record<string, ReturnType<typeof blenderManifest>> = { [sequenceName]: sequenceManifest, ...(revealManifest ? { [revealName]: revealManifest } : {}) };
  return { character, manifests, environment: env };
}

/** Attach a render the way scripts/render.ts and publish-dry-run.ts record one. */
export function attachRender(dir: string, state: PublicState, opts: { bytes?: Buffer; character?: unknown; engine?: 'typescript' | 'rust-wasm' } = {}): void {
  const bytes = opts.bytes ?? mp4();
  writeFileSync(path.join(dir, MP4), bytes);
  const output = { path: `dist/${VIDEO_ID}/${MP4}`, sha256: sha256Hex(bytes) };
  const motionEngine = opts.engine === 'rust-wasm' ? state.rustEngine() : typescriptEngineIdentity();
  writeFileSync(
    path.join(dir, 'render.json'),
    prettyJson({
      schema: 'walletwall.render-info/v5',
      videoId: VIDEO_ID,
      revision: 1,
      specHash: state.specHash,
      engine: { name: 'remotion', version: state.identity.toolchain.packages.remotion, compositionId: 'WalletWallDocsVideo' },
      fps: state.fps,
      frames: state.frames,
      durationMs: state.totalMs,
      output,
      narration: { providerId: state.narrationProviderId, estimated: true, audio: 'NONE' },
      overlays: { captions: true, characterless: false, guides: false },
      identity: state.identity,
      motionEngine,
      character: opts.character ?? characterEvidence(state).character,
    }),
  );
  editJson<{ files: { video: unknown } }>(path.join(dir, 'publish-manifest.json'), (m) => {
    m.files.video = { ...output, durationMs: state.totalMs };
  });
  editJson<{ render: unknown }>(path.join(dir, 'provenance.json'), (p) => {
    p.render = { engine: 'remotion', version: state.identity.toolchain.packages.remotion, output: output.path, sha256: output.sha256, motionEngine };
  });
}

/**
 * The ported invariants' report (scripts/blender-invariants.ts, walletwall.blender-invariants/v2) for a passing run at
 * the publication stride, measured in `environment` on this checkout's plan and character.
 */
/** The counts of a passing publication-stride run, as measured on the production host on 2026-10-19. */
export const PASSING_COUNTS = { frames: 786, 'lesson.grounded': 539, 'lesson.sceneHolds': 405, 'lesson.supportedHolds': 312, 'lesson.resting': 310, 'lesson.heldClear': 2, 'lab.grounded': 152, 'lab.hang': 3, 'lab.unsupportedPerch': 48, shuffled: 12 };

export function invariantsReport(state: PublicState, opts: { environment?: EnvironmentName; engine?: 'typescript' | 'rust-wasm'; pass?: boolean; frames?: number[]; identity?: Record<string, unknown>; every?: number; excludedLesson?: number[]; realization?: string; thresholds?: Record<string, number>; counts?: Record<string, number> } = {}) {
  const engine = opts.engine ?? 'typescript';
  const lesson = state.lesson(engine);
  const every = opts.every ?? 9;
  const frames = opts.frames ?? strideFrames(lesson, every);
  const lessonBridgeSha256 = contentAddress(lessonBridgeFor(lesson, frames));
  const base = characterEvidence(state).character.identity;
  const pass = opts.pass ?? true;
  // The invariants' own lesson render: the same character and host as the publication render, its own frames and terrain.
  const { terrainSha256: _terrain, ...shared } = base;
  return {
    schema: 'walletwall.blender-invariants/v2',
    videoId: VIDEO_ID,
    motionEngine: engine,
    every,
    labEvery: 1,
    lessonFrames: frames,
    lessonBridgeSha256,
    identity: opts.identity ?? { ...shared, ...(opts.realization ? { walletwallabyRealizationSha256: opts.realization } : {}), motionPlanSha256: lessonBridgeSha256, terrainSha256: contentAddress(lessonTerrain(lesson, lessonBridgeFor(lesson, frames))) },
    environment: environmentRecord(ENVIRONMENTS[opts.environment ?? 'production-rtx5080']),
    thresholds: opts.thresholds ?? { ...INVARIANT_THRESHOLDS },
    counts: opts.counts ?? PASSING_COUNTS,
    excluded: { ...(opts.excludedLesson ? { lesson: opts.excludedLesson } : {}), lab: [212, 213] },
    palette: { colours: [], opaquePixels: 1000, offHull: 0, exactFraction: 0.722, worstFrameExact: 0.446 },
    failuresByCheck: pass ? {} : { 'planted feet': 1 },
    pass,
    failures: pass ? [] : [{ check: 'planted feet', run: 'lesson', frame: frames[0], detail: 'heel 0.2 px from its target' }],
    failureCount: pass ? 0 : 1,
  };
}

export interface ProofFixture {
  /** The proof package publication:proof leaves: the gate's review bundle (receipt not yet written). */
  bundle: string;
  /** Where Blender and the invariants left their records (dist/blender/out on a production host). */
  sources: EvidenceSources;
  /** The character record the render made, and Blender's manifests behind it. */
  evidence: ReturnType<typeof characterEvidence>;
}

/**
 * A complete publication proof as publication:proof leaves it, before the receipt: the clean package (copied from
 * `cleanPackage`) with a render from `environment`, passed through the public-output gate into a review bundle, and
 * Blender's manifests and the invariants report where the receipt step collects them.
 */
export function proofFixture(dir: (name: string) => string, state: PublicState, cleanPackage: string, label: string, opts: { environment?: EnvironmentName; engine?: 'typescript' | 'rust-wasm'; invariants?: unknown; bytes?: Buffer; truncateShots?: boolean; character?: (c: ReturnType<typeof characterEvidence>['character']) => void } = {}): ProofFixture {
  const pkg = dir(`${label}-package`);
  cpSync(cleanPackage, pkg, { recursive: true });
  const engine = opts.engine ?? 'typescript';
  const evidence = characterEvidence(state, engine, opts.environment, { truncateShots: opts.truncateShots });
  // A change to what render.json records, after Blender's manifests were made (they keep what Blender recorded).
  opts.character?.(evidence.character);
  attachRender(pkg, state, { character: evidence.character, bytes: opts.bytes, engine });
  const result = checkPublicOutput(pkg, state, { requireRender: true });
  if (!result.report.ok) throw new Error(`the fixture package does not pass the gate: ${result.report.findings.map((f) => `${f.code} ${f.path}`).join('; ')}`);
  const bundle = path.join(dir(`${label}-bundle`), 'publication-proof');
  writeReviewBundle(result, bundle, state.machineNames);
  const out = dir(`${label}-blender-out`);
  for (const [name, manifest] of Object.entries(evidence.manifests)) {
    mkdirSync(path.join(out, 'renders', name), { recursive: true });
    writeFileSync(path.join(out, 'renders', name, 'render.json'), prettyJson(manifest));
  }
  mkdirSync(path.join(out, 'invariants'), { recursive: true });
  writeFileSync(path.join(out, 'invariants', 'report.json'), prettyJson(opts.invariants ?? invariantsReport(state, { environment: opts.environment, engine })));
  return { bundle, evidence, sources: { invariantsReport: path.join(out, 'invariants', 'report.json'), blenderManifest: (name) => path.join(out, 'renders', name, 'render.json') } };
}
