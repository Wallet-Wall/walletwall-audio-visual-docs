// Stage a Blender-rendered WalletWallaby sequence, or a depth reveal, into the render bundle.
//
// The frames are trusted only if (1) every PNG matches the sha256 Blender's own manifest records, (2) the bridge they
// were rendered from is, byte for byte, the bridge the CURRENT MotionPlan gives for those frames, (3) they were made
// by exactly this toolchain, config, lane source, built model, and plan, (4) Blender recorded the render environment
// they were made in, and (5) for the crop layout, every crop is the one the frame's placement decides. So a sequence
// rendered from an older plan, an edited bridge, another build, or a swapped PNG is refused, and the composition can
// only ever show frames of the motion it is sampling.
//
// A sequence may cover its whole bridge range or only some of its frames (review stills): the subset is compared
// frame by frame with the current plan, and the composition fails closed on any frame the sequence does not hold.
// Node-only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { characterCrop, type CharacterCrop } from '../character/walletwallaby/blender/crop.ts';
import { RIG_ENVELOPE } from '../character/walletwallaby/rig/rig-source.ts';
import { BLENDER_MOTION_SCHEMA, validateBridge, type BlenderMotionDocument } from '../character/walletwallaby/blender/bridge.ts';
import { RIG } from '../character/walletwallaby/versions.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { PUBLIC_DIR } from '../pipeline/render-input.ts';
import type { BlenderCharacterProps, BlenderEnvironmentProps, BlenderTransitionProps } from '../remotion/props.ts';
import { blenderIdentity, environmentClass, loadEnvironments, type BlenderIdentity, type RenderEnvironment } from './identity.ts';
import { lessonBridge, lessonTerrain, type LessonMotion } from './lesson.ts';
import { findBlender, loadBlenderConfig, outFile, type BlenderConfig } from './toolchain.ts';

export class BlenderStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderStageError';
  }
}

/**
 * Empty the bundle's Blender staging area before a render stages its frames: the bundle copies the whole public
 * dir, so frames left from other renders would ride along (and slow every bundle) though nothing may show them.
 */
export function clearStagedBlender(): void {
  rmSync(path.join(PUBLIC_DIR, 'renderer', 'blender'), { recursive: true, force: true });
}

/** The content of a Blender render, for provenance: the frames it holds and where it ran, never its timings. */
function renderContentSha256(manifest: Manifest): string {
  return contentAddress({ schema: manifest.schema, environment: manifest.environment, shots: manifest.shots.map((s) => ({ name: s.name, frame: s.frame, sha256: s.sha256 })) });
}

/** How a character sequence was laid out: small crops (production) or whole frames (the approved reference). */
export type BlenderLayout = 'crop' | 'full-frame';

interface Manifest {
  schema: string;
  environment?: RenderEnvironment;
  shots: { name: string; frame: number; sha256: string }[];
}

/** What every staged Blender output shares: a verified manifest, the current plan's bridge, and this identity. */
function verifiedRender(name: string, lesson: LessonMotion, kind: 'sequence' | 'transition') {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(name)) throw new BlenderStageError(`the ${kind} name must be a plain id`);
  const dir = `renders/${name}`;
  const manifestBytes = readFileSync(outFile(`${dir}/render.json`));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Manifest;
  if (manifest.schema !== 'walletwall.blender-render/v1') throw new BlenderStageError(`${dir}/render.json is not walletwall.blender-render/v1`);
  if (!manifest.environment) throw new BlenderStageError(`${dir}/render.json does not record its render environment; re-render it`);
  const bridge = validateBridge(JSON.parse(readFileSync(outFile(`${dir}/bridge.json`), 'utf8')));
  if (bridge.videoId !== lesson.videoId) throw new BlenderStageError(`${name} was rendered for ${bridge.videoId}, not ${lesson.videoId}`);
  const current = currentBridgeFor(bridge, lesson);
  if (contentAddress(current) !== contentAddress(bridge)) throw new BlenderStageError(`${name} was rendered from a different MotionPlan than the one this render samples; re-render it`);
  // The frames must have been made by exactly this toolchain, config, lane source, built model, and plan.
  const recorded = JSON.parse(readFileSync(outFile(`${dir}/identity.json`), 'utf8')) as BlenderIdentity & { transition?: string };
  if ((kind === 'transition') !== (recorded.transition === 'depth-reveal')) throw new BlenderStageError(`${name} is not a ${kind === 'transition' ? 'depth reveal' : 'character sequence'}`);
  const cfg = loadBlenderConfig();
  // A reveal draws both segments' terrain whichever of its frames it holds, so its terrain is its whole range's.
  const terrainOf = kind === 'transition' ? lessonBridge(lesson, current.range.first, current.range.last) : current;
  const expected = blenderIdentity(cfg, findBlender(cfg), RIG.version, current, BLENDER_MOTION_SCHEMA, lessonTerrain(lesson, terrainOf));
  for (const [k, v] of Object.entries(expected)) {
    // The .blend's bytes are recorded but not compared: Blender writes memory addresses into the file, so two builds
    // of the same source differ in bytes while their canonical model (walletwallabyModelSha256) is identical.
    if (k === 'blendArtifactSha256') continue;
    if ((recorded as unknown as Record<string, unknown>)[k] !== v) throw new BlenderStageError(`${name} was rendered with a different ${k} (${String((recorded as unknown as Record<string, unknown>)[k])} vs ${String(v)}); re-render it`);
  }
  const publicDir = `renderer/blender/${name}`;
  mkdirSync(path.join(PUBLIC_DIR, ...publicDir.split('/')), { recursive: true });
  return { dir, publicDir, cfg, manifest, manifestBytes, bridge: current, expected, environment: environmentProps(manifest.environment, cfg) };
}

/** The current plan's bridge for the frames a recorded bridge holds: its whole range, or exactly its subset. */
function currentBridgeFor(recorded: BlenderMotionDocument, lesson: LessonMotion): BlenderMotionDocument {
  const full = lessonBridge(lesson, recorded.range.first, recorded.range.last);
  const held = new Set(recorded.frames.map((f) => f.frame));
  if (held.size === 0) throw new BlenderStageError('a staged sequence must hold at least one frame');
  return held.size === full.frames.length ? full : { ...full, frames: full.frames.filter((f) => held.has(f.frame)) };
}

function environmentProps(env: RenderEnvironment, cfg: BlenderConfig): BlenderEnvironmentProps {
  const cls = environmentClass(env, cfg, loadEnvironments());
  return { classId: cls.id, approvedClass: cls.approvedAs?.name ?? null, purpose: cls.approvedAs?.purpose ?? null, record: { ...env } };
}

/** Copy one verified PNG into the bundle's public dir; returns its bytes. */
function stagePng(dir: string, publicDir: string, shot: { name: string; sha256: string }): Buffer {
  const src = outFile(`${dir}/${shot.name}.png`);
  const bytes = readFileSync(src);
  if (sha256Hex(bytes) !== shot.sha256) throw new BlenderStageError(`${dir}/${shot.name}.png does not match its manifest`);
  copyFileSync(src, path.join(PUBLIC_DIR, ...publicDir.split('/'), `${shot.name}.png`));
  return bytes;
}

/** Stage a rendered depth reveal: whole frames for the frames its bridge holds, verified like a character sequence. */
export function stageBlenderTransition(name: string, lesson: LessonMotion): BlenderTransitionProps {
  const r = verifiedRender(name, lesson, 'transition');
  const shots = new Map(r.manifest.shots.map((s) => [s.frame, s]));
  const frames: number[] = [];
  for (const f of r.bridge.frames) {
    const shot = shots.get(f.frame);
    if (!shot) throw new BlenderStageError(`${name} has no frame ${f.frame}`);
    const bytes = stagePng(r.dir, r.publicDir, shot);
    if (bytes.readUInt32BE(16) !== r.cfg.render.resolution[0] || bytes.readUInt32BE(20) !== r.cfg.render.resolution[1]) throw new BlenderStageError(`${r.dir}/${shot.name}.png is not a whole frame`);
    frames.push(f.frame);
  }
  return {
    schema: 'walletwall.blender-transition-props/v1',
    name,
    dir: r.publicDir,
    range: { ...r.bridge.range },
    frames,
    environment: r.environment,
    renderSha256: renderContentSha256(r.manifest),
    bridgeSha256: contentAddress(r.bridge),
    identity: { ...r.expected },
  };
}

/** Stage a rendered character sequence in the layout the caller expects (production: `crop`). */
export function stageBlenderSequence(name: string, lesson: LessonMotion, layout: BlenderLayout = 'crop'): BlenderCharacterProps {
  const r = verifiedRender(name, lesson, 'sequence');
  // Crop layout: every crop is re-derived from the current bridge (bounds decided before rendering, never by the
  // render), and each PNG must have exactly those dimensions. A full-frame sequence (the reference) has no crops.json.
  const frameSize = { width: r.cfg.render.resolution[0], height: r.cfg.render.resolution[1] };
  const padPx = (r.cfg.render as unknown as { crop: { padPx: number } }).crop.padPx;
  const cropFile = outFile(`${r.dir}/crops.json`);
  const cropDoc = existsSync(cropFile) ? (JSON.parse(readFileSync(cropFile, 'utf8')) as { schema: string; padPx: number; crops: (CharacterCrop & { pngSha256: string })[] }) : null;
  if ((layout === 'crop') !== (cropDoc !== null)) throw new BlenderStageError(`${name} is not a ${layout} sequence`);
  if (cropDoc && (cropDoc.schema !== 'walletwall.blender-crops/v1' || cropDoc.padPx !== padPx)) throw new BlenderStageError(`${r.dir}/crops.json is not walletwall.blender-crops/v1 at the configured padding`);
  const recordedCrops = new Map((cropDoc?.crops ?? []).map((c) => [c.frame, c]));
  const shots = new Map(r.manifest.shots.map((s) => [s.frame, s]));
  const crops: BlenderCharacterProps['crops'] = [];
  const offFrame: number[] = [];
  for (const f of r.bridge.frames.filter((x) => x.visible)) {
    const want = cropDoc ? characterCrop(f, RIG_ENVELOPE, padPx, frameSize) : { frame: f.frame, x: 0, y: 0, width: frameSize.width, height: frameSize.height, scale: f.place.scale };
    const shot = shots.get(f.frame);
    if (!want) {
      if (shot) throw new BlenderStageError(`${name} drew frame ${f.frame}, whose envelope lies wholly outside the frame`);
      offFrame.push(f.frame);
      continue;
    }
    if (!shot) throw new BlenderStageError(`${name} has no frame ${f.frame}, which is visible`);
    if (cropDoc) {
      const got = recordedCrops.get(f.frame);
      if (!got || got.x !== want.x || got.y !== want.y || got.width !== want.width || got.height !== want.height || got.pngSha256 !== shot.sha256) throw new BlenderStageError(`${name} frame ${f.frame}: its crop is not the one its placement decides`);
    }
    const bytes = stagePng(r.dir, r.publicDir, shot);
    if (bytes.readUInt32BE(16) !== want.width || bytes.readUInt32BE(20) !== want.height) throw new BlenderStageError(`${r.dir}/${shot.name}.png is not ${want.width}x${want.height}`);
    crops.push({ frame: f.frame, x: want.x, y: want.y, width: want.width, height: want.height });
  }
  return {
    schema: 'walletwall.blender-character-props/v1',
    renderer: 'blender',
    layout,
    name,
    dir: r.publicDir,
    range: { ...r.bridge.range },
    crops,
    offFrame,
    environment: r.environment,
    renderSha256: renderContentSha256(r.manifest),
    bridgeSha256: contentAddress(r.bridge),
    identity: { ...r.expected },
  };
}

/** Review tools only: the layout a rendered sequence was recorded in (production declares the layout it expects). */
export function recordedLayout(name: string): BlenderLayout {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(name)) throw new BlenderStageError('the sequence name must be a plain id');
  return existsSync(outFile(`renders/${name}/crops.json`)) ? 'crop' : 'full-frame';
}
