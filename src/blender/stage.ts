// Stage a Blender-rendered WalletWallaby sequence into the render bundle.
//
// The frames are trusted only if (1) every PNG matches the sha256 Blender's own
// manifest records, and (2) the bridge they were rendered from is, byte for
// byte, the bridge the CURRENT MotionPlan gives for that range. So a sequence
// rendered from an older plan, an edited bridge, or a swapped PNG is refused,
// and the composition can only ever show frames of the motion it is sampling.
// Node-only.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { PUBLIC_DIR } from '../pipeline/render-input.ts';
import type { BlenderCharacterProps, BlenderTransitionProps } from '../remotion/props.ts';
import { validateBridge } from '../character/walletwallaby/blender/bridge.ts';
import { blenderIdentity, type BlenderIdentity } from './identity.ts';
import { lessonBridge, lessonTerrain, type LessonMotion } from './lesson.ts';
import { findBlender, loadBlenderConfig, outFile } from './toolchain.ts';
import { BLENDER_MOTION_SCHEMA } from '../character/walletwallaby/blender/bridge.ts';
import { RIG } from '../character/walletwallaby/versions.ts';

export class BlenderStageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlenderStageError';
  }
}

/** Stage a rendered depth reveal (full frames over its whole range), after verifying every PNG against its manifest. */
export function stageBlenderTransition(name: string, range: { first: number; last: number }): BlenderTransitionProps {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(name)) throw new BlenderStageError('the transition name must be a plain id');
  const dir = `renders/${name}`;
  const manifestBytes = readFileSync(outFile(`${dir}/render.json`));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { schema: string; shots: { name: string; frame: number; sha256: string }[] };
  if (manifest.schema !== 'walletwall.blender-render/v1') throw new BlenderStageError(`${dir}/render.json is not walletwall.blender-render/v1`);
  const identity = JSON.parse(readFileSync(outFile(`${dir}/identity.json`), 'utf8')) as Record<string, string | number | null>;
  const publicDir = `renderer/blender/${name}`;
  mkdirSync(path.join(PUBLIC_DIR, ...publicDir.split('/')), { recursive: true });
  const shots = new Map(manifest.shots.map((s) => [s.frame, s]));
  for (let f = range.first; f <= range.last; f++) {
    const shot = shots.get(f);
    if (!shot) throw new BlenderStageError(`${name} has no frame ${f}`);
    const src = outFile(`${dir}/${shot.name}.png`);
    if (sha256Hex(readFileSync(src)) !== shot.sha256) throw new BlenderStageError(`${dir}/${shot.name}.png does not match its manifest`);
    copyFileSync(src, path.join(PUBLIC_DIR, ...publicDir.split('/'), `${shot.name}.png`));
  }
  return { schema: 'walletwall.blender-transition-props/v1', name, dir: publicDir, range: { ...range }, renderSha256: sha256Hex(manifestBytes), identity };
}

export function stageBlenderSequence(name: string, lesson: LessonMotion): BlenderCharacterProps {
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(name)) throw new BlenderStageError('the sequence name must be a plain id');
  const dir = `renders/${name}`;
  const manifestBytes = readFileSync(outFile(`${dir}/render.json`));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { schema: string; shots: { name: string; frame: number; sha256: string }[] };
  if (manifest.schema !== 'walletwall.blender-render/v1') throw new BlenderStageError(`${dir}/render.json is not walletwall.blender-render/v1`);
  const bridge = validateBridge(JSON.parse(readFileSync(outFile(`${dir}/bridge.json`), 'utf8')));
  if (bridge.videoId !== lesson.videoId) throw new BlenderStageError(`${name} was rendered for ${bridge.videoId}, not ${lesson.videoId}`);
  const current = lessonBridge(lesson, bridge.range.first, bridge.range.last);
  if (contentAddress(current) !== contentAddress(bridge)) throw new BlenderStageError(`${name} was rendered from a different MotionPlan than the one this render samples; re-render it`);
  // The frames must have been made by exactly this toolchain, config, lane source, built model, and plan.
  const recorded = JSON.parse(readFileSync(outFile(`${dir}/identity.json`), 'utf8')) as BlenderIdentity;
  const cfg = loadBlenderConfig();
  const expected = blenderIdentity(cfg, findBlender(cfg), RIG.version, current, BLENDER_MOTION_SCHEMA, lessonTerrain(lesson, current));
  for (const [k, v] of Object.entries(expected)) {
    // The .blend's bytes are recorded but not compared: Blender writes memory addresses into the file, so two builds
    // of the same source differ in bytes while their canonical model (walletwallabyModelSha256) is identical.
    if (k === 'blendArtifactSha256') continue;
    if ((recorded as unknown as Record<string, unknown>)[k] !== v) throw new BlenderStageError(`${name} was rendered with a different ${k} (${String((recorded as unknown as Record<string, unknown>)[k])} vs ${String(v)}); re-render it`);
  }
  const visible = current.frames.filter((f) => f.visible).map((f) => f.frame);
  const shots = new Map(manifest.shots.map((s) => [s.frame, s]));
  const publicDir = `renderer/blender/${name}`;
  mkdirSync(path.join(PUBLIC_DIR, ...publicDir.split('/')), { recursive: true });
  for (const f of visible) {
    const shot = shots.get(f);
    if (!shot) throw new BlenderStageError(`${name} has no frame ${f}, which is visible`);
    const src = outFile(`${dir}/${shot.name}.png`);
    if (sha256Hex(readFileSync(src)) !== shot.sha256) throw new BlenderStageError(`${dir}/${shot.name}.png does not match its manifest`);
    copyFileSync(src, path.join(PUBLIC_DIR, ...publicDir.split('/'), `${shot.name}.png`));
  }
  return {
    schema: 'walletwall.blender-character-props/v1',
    renderer: 'blender',
    name,
    dir: publicDir,
    range: { ...bridge.range },
    frames: visible,
    renderSha256: sha256Hex(manifestBytes),
    bridgeSha256: contentAddress(bridge),
    identity: { ...expected },
  };
}
