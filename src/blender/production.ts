// The production Blender path (docs/BLENDER.md, Production): what `npm run render` uses to draw WalletWallaby.
//
//   1. The character, built from code by the pinned Blender, and refused unless its canonical model and materials are
//      exactly the ones src/character/walletwallaby/versions.ts pins (BLENDER_CHARACTER). A cached build is reused only
//      while the config, lane source, and rig it was built from are today's.
//   2. The lesson's character frames, in the crop layout (production) or whole frames (the approved reference and
//      fallback), for the whole lesson or for a set of frames (review stills). A rendered sequence is reused only if it
//      is the same bridge and it passes staging (src/blender/stage.ts) in full.
//   3. The depth reveal at a PUSH_THROUGH -> DEPTH_ENTER seam: Blender draws the whole frame there, from Remotion's
//      own characterless surfaces.
//
// Blender decides nothing here: every frame is a MotionPlan frame, every crop is decided before Blender runs, and
// every output is verified against its manifest before it is used. Node-only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BLENDER_MOTION_SCHEMA, type BlenderMotionDocument } from '../character/walletwallaby/blender/bridge.ts';
import { characterCrop } from '../character/walletwallaby/blender/crop.ts';
import { blenderRigDocument } from '../character/walletwallaby/blender/rig-export.ts';
import { compileRig } from '../character/walletwallaby/rive/rig-compile.ts';
import { RIG_ENVELOPE } from '../character/walletwallaby/rive/rig-source.ts';
import { BLENDER_CHARACTER, RIG } from '../character/walletwallaby/versions.ts';
import { prettyJson } from '../core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { blenderIdentity, CHARACTER, readModelManifest, type ModelManifest } from './identity.ts';
import { lessonBridge, lessonBridgeFor, lessonTerrain, type LessonMotion } from './lesson.ts';
import { revealJob, type RevealSeam } from './reveal.ts';
import { stageBlenderSequence, stageBlenderTransition, type BlenderLayout } from './stage.ts';
import { BLENDER_JOBS, blenderConfigSha256, blenderSourceSha256, findBlender, outFile, runBlender, writeJob, type BlenderConfig } from './toolchain.ts';

export class BlenderProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderProductionError';
  }
}

type Blender = ReturnType<typeof findBlender>;

const BUILD_INPUTS = 'character/inputs.json';

/** What a character build was made from: if any of these change, the cached build is stale. */
function buildInputs(cfg: BlenderConfig, rig: object) {
  return { schema: 'walletwall.blender-build-inputs/v1', blenderConfigSha256: blenderConfigSha256(cfg), blenderSceneSourceSha256: blenderSourceSha256().sha256, rigSha256: contentAddress(rig) };
}

/** Refuse a built character that is not the pinned one. */
export function assertPinnedCharacter(model: ModelManifest): void {
  const pin = BLENDER_CHARACTER;
  if (model.modelVersion !== pin.modelVersion || model.modelSha256 !== pin.modelSha256) throw new BlenderProductionError(`the built model v${model.modelVersion} ${model.modelSha256.slice(0, 12)} is not the pinned v${pin.modelVersion} ${pin.modelSha256.slice(0, 12)} (src/character/walletwallaby/versions.ts BLENDER_CHARACTER)`);
  if (model.materialsVersion !== pin.materialsVersion || model.materialsSha256 !== pin.materialsSha256) throw new BlenderProductionError(`the built materials v${model.materialsVersion} ${model.materialsSha256.slice(0, 12)} are not the pinned v${pin.materialsVersion} ${pin.materialsSha256.slice(0, 12)} (BLENDER_CHARACTER)`);
}

/** Build the character from code with the pinned Blender; refused unless it is the pinned model. */
export function buildCharacter(cfg: BlenderConfig, blender: Blender): { model: ModelManifest; ms: number } {
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob('build', { schema: 'walletwall.blender-job/v1', kind: 'build', config: cfg, rig, outputs: CHARACTER });
  const { ms } = runBlender(blender, cfg, 'build.py', job);
  const model = readModelManifest();
  assertPinnedCharacter(model);
  writeFileSync(outFile(BUILD_INPUTS), prettyJson(buildInputs(cfg, rig)));
  return { model, ms };
}

/** The pinned character: the cached build when it was made from today's inputs by this Blender, else a fresh build. */
export function ensureCharacter(cfg: BlenderConfig, blender: Blender, fresh = false): { model: ModelManifest; rebuilt: boolean } {
  const rig = blenderRigDocument(compileRig().model);
  if (!fresh && [CHARACTER.blend, CHARACTER.manifest, BUILD_INPUTS].every((f) => existsSync(outFile(f)))) {
    const recorded = JSON.parse(readFileSync(outFile(BUILD_INPUTS), 'utf8')) as unknown;
    const model = readModelManifest();
    const sameBlender = model.blenderVersion.split(' ')[0] === blender.version && model.blenderBuildHash === blender.buildHash;
    if (sameBlender && contentAddress(recorded) === contentAddress(buildInputs(cfg, rig))) {
      assertPinnedCharacter(model);
      return { model, rebuilt: false };
    }
  }
  return { model: buildCharacter(cfg, blender).model, rebuilt: true };
}

/** True when a rendered output exists for exactly this bridge (the caller still stages it, which verifies everything). */
function sameBridgeOnDisk(name: string, bridge: BlenderMotionDocument): boolean {
  const file = outFile(`renders/${name}/bridge.json`);
  return existsSync(file) && existsSync(outFile(`renders/${name}/render.json`)) && contentAddress(JSON.parse(readFileSync(file, 'utf8'))) === contentAddress(bridge);
}

export interface CharacterSequenceRequest {
  lesson: LessonMotion;
  name: string;
  layout: BlenderLayout;
  /** Only these frames (review stills); absent = every frame of the lesson. */
  frames?: readonly number[];
  /** Never reuse an earlier render (determinism runs). */
  fresh?: boolean;
  /** Record each frame's projected bones (the invariants run); always renders anew. */
  measure?: boolean;
}

/** Render (or reuse) WalletWallaby's frames for the lesson. Returns whether a verified earlier render was reused. */
export function renderCharacterSequence(cfg: BlenderConfig, blender: Blender, req: CharacterSequenceRequest): { reused: boolean; frames: number; ms: number } {
  const bridge = lessonBridgeFor(req.lesson, req.frames);
  if (!req.fresh && !req.measure && sameBridgeOnDisk(req.name, bridge)) {
    try {
      stageBlenderSequence(req.name, req.lesson, req.layout);
      return { reused: true, frames: bridge.frames.length, ms: 0 };
    } catch {
      // Stale (another identity, layout, or tampered output): render it again below.
    }
  }
  const terrain = lessonTerrain(req.lesson, bridge);
  const frameSize = { width: cfg.render.resolution[0], height: cfg.render.resolution[1] };
  const padPx = (cfg.render as unknown as { crop: { padPx: number } }).crop.padPx;
  // Crops are decided here, from the placement alone, before Blender runs.
  const shots = bridge.frames
    .filter((f) => f.visible)
    .flatMap((f) => {
      const name = `f${String(f.frame).padStart(5, '0')}`;
      if (req.layout === 'full-frame') return [{ name, frame: f.frame, camera: { kind: 'teaching' } }];
      const c = characterCrop(f, RIG_ENVELOPE, padPx, frameSize);
      return c ? [{ name, frame: f.frame, camera: { kind: 'crop', x: c.x, y: c.y, width: c.width, height: c.height } }] : [];
    });
  const outDir = `renders/${req.name}`;
  mkdirSync(outFile(outDir), { recursive: true });
  // A failed render leaves no manifest behind that staging could mistake for this one.
  for (const stale of ['crops.json', 'render.json']) rmSync(outFile(`${outDir}/${stale}`), { force: true });
  writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
  writeFileSync(outFile(`${outDir}/identity.json`), prettyJson(blenderIdentity(cfg, blender, RIG.version, bridge, BLENDER_MOTION_SCHEMA, terrain)));
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob(`render.${req.name}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, terrain, shots, ...(req.measure ? { measure: true } : {}), outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
  const { ms } = runBlender(blender, cfg, 'render.py', job);
  const manifest = JSON.parse(readFileSync(outFile(`${outDir}/render.json`), 'utf8')) as { shots: { name: string; frame: number; sha256: string; crop?: { x: number; y: number; width: number; height: number } }[] };
  for (const s of manifest.shots) if (sha256Hex(readFileSync(outFile(`${outDir}/${s.name}.png`))) !== s.sha256) throw new BlenderProductionError(`${outDir}/${s.name}.png does not match the manifest Blender wrote`);
  if (req.layout === 'crop') {
    const byFrame = new Map(bridge.frames.map((f) => [f.frame, f]));
    const crops = manifest.shots.map((s) => {
      const c = characterCrop(byFrame.get(s.frame)!, RIG_ENVELOPE, padPx, frameSize)!;
      if (!s.crop || s.crop.x !== c.x || s.crop.y !== c.y || s.crop.width !== c.width || s.crop.height !== c.height) throw new BlenderProductionError(`frame ${s.frame}: Blender rendered a crop other than the one decided for it`);
      return { frame: s.frame, x: c.x, y: c.y, width: c.width, height: c.height, scale: c.scale, pngSha256: s.sha256 };
    });
    writeFileSync(outFile(`${outDir}/crops.json`), prettyJson({ schema: 'walletwall.blender-crops/v1', padPx, frameSize, crops }));
  }
  return { reused: false, frames: manifest.shots.length, ms };
}

export interface RevealRequest {
  lesson: LessonMotion;
  name: string;
  seam: RevealSeam;
  /** The two characterless teaching surfaces Remotion drew at the seam's first frame and at its flat-again frame. */
  layers: [string, string];
  /** Only these frames of the reveal (review stills); absent = all of it. */
  frames?: readonly number[];
  /** Never reuse an earlier render (determinism runs). */
  fresh?: boolean;
}

/** Render (or reuse) the depth reveal at a seam: whole frames, Blender's only full-scene shots. */
export function renderDepthReveal(cfg: BlenderConfig, blender: Blender, req: RevealRequest): { reused: boolean; frames: number; ms: number } {
  const full = lessonBridge(req.lesson, req.seam.first, req.seam.last);
  const frames = (req.frames ?? full.frames.map((f) => f.frame)).filter((f) => f >= req.seam.first && f <= req.seam.last);
  if (frames.length === 0) throw new BlenderProductionError('no reveal frames were asked for');
  const want = new Set(frames);
  const bridge = want.size === full.frames.length ? full : { ...full, frames: full.frames.filter((f) => want.has(f.frame)) };
  // The two surfaces are inputs to the frames: they are copied into the job directory and hashed into the job.
  const layerDir = path.join(BLENDER_JOBS, req.name);
  mkdirSync(layerDir, { recursive: true });
  req.layers.forEach((src, i) => copyFileSync(src, path.join(layerDir, `layer-${i}.png`)));
  const layerSha = req.layers.map((src) => sha256Hex(readFileSync(src)));
  const layersFile = outFile(`renders/${req.name}/layers.json`);
  const sameLayers = existsSync(layersFile) && readFileSync(layersFile, 'utf8') === prettyJson({ layers: layerSha });
  if (!req.fresh && sameLayers && sameBridgeOnDisk(req.name, bridge)) {
    try {
      stageBlenderTransition(req.name, req.lesson);
      return { reused: true, frames: bridge.frames.length, ms: 0 };
    } catch {
      // Stale: render it again below.
    }
  }
  // Both segments' terrain and the push's whole scale range, whichever frames are drawn, so a subset's frames are
  // exactly the full reveal's.
  const terrain = lessonTerrain(req.lesson, full);
  const { transition, shots } = revealJob(cfg, req.seam, full, frames, [`${req.name}/layer-0.png`, `${req.name}/layer-1.png`]);
  const outDir = `renders/${req.name}`;
  mkdirSync(outFile(outDir), { recursive: true });
  rmSync(outFile(`${outDir}/render.json`), { force: true });
  writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
  writeFileSync(outFile(`${outDir}/identity.json`), prettyJson({ ...blenderIdentity(cfg, blender, RIG.version, bridge, BLENDER_MOTION_SCHEMA, terrain), transition: 'depth-reveal' }));
  writeFileSync(layersFile, prettyJson({ layers: layerSha }));
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob(`render.${req.name}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge: full, terrain, transition, shots, outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
  const { ms } = runBlender(blender, cfg, 'render.py', job);
  const manifest = JSON.parse(readFileSync(outFile(`${outDir}/render.json`), 'utf8')) as { shots: { name: string; sha256: string }[] };
  for (const s of manifest.shots) if (sha256Hex(readFileSync(outFile(`${outDir}/${s.name}.png`))) !== s.sha256) throw new BlenderProductionError(`${outDir}/${s.name}.png does not match the manifest Blender wrote`);
  return { reused: false, frames: manifest.shots.length, ms };
}
