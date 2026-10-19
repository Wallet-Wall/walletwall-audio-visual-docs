// The Blender identity of a render: everything that can change a WalletWallaby
// frame on the Blender side, by hash. Recorded next to every rendered sequence
// (identity.json), carried into the composition's provenance, and re-derived
// before staging, so frames made by another Blender build, another config,
// other lane source, another built model, or another MotionPlan are refused.
// No local path, user name, or machine detail is recorded. Node-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT } from '../config/load.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { blenderConfigSha256, blenderSourceSha256, outFile, type BlenderConfig } from './toolchain.ts';

export const BLENDER_IDENTITY_SCHEMA = 'walletwall.blender-identity/v1';

export interface BlenderIdentity {
  schema: typeof BLENDER_IDENTITY_SCHEMA;
  blenderVersion: string;
  blenderBuildHash: string;
  blenderConfigSha256: string;
  /** The lane's Python and README (blender/walletwallaby/*), in a fixed order. */
  blenderSceneSourceSha256: string;
  blendArtifactSha256: string;
  walletwallabyModelVersion: number;
  /** Canonical model content (quantized, order-independent): the same on every host that builds this source. */
  walletwallabyModelSha256: string;
  /** This host's exact float realization of the model (host-specific; recorded, compared only on the same host). */
  walletwallabyRealizationSha256: string;
  walletwallabyRigVersion: number;
  materialsVersion: number;
  materialsSha256: string;
  motionBridgeSchema: string;
  motionPlanSha256: string;
  terrainSha256: string | null;
  /** The camera and render settings blocks of the config, on their own (also inside the config hash). */
  cameraDefinitionSha256: string;
  renderSettingsSha256: string;
}

export interface ModelManifest {
  schema: 'walletwall.blender-model/v1';
  modelVersion: number;
  materialsVersion: number;
  modelSha256: string;
  modelRealizationSha256: string;
  materialsSha256: string;
  blenderVersion: string;
  blenderBuildHash: string;
}

export const CHARACTER = { blend: 'character/walletwallaby.blend', manifest: 'character/model.json' } as const;

/** What actually rendered, as Blender's GPU module reported it (render.py render_environment). */
export interface RenderEnvironment {
  os: string;
  blenderVersion: string;
  blenderBuildHash: string;
  engine: string;
  gpu: { backend: string; vendor: string; renderer: string; version: string; deviceType: string } | { unavailable: string };
}

export interface EnvironmentClassSpec {
  name: string;
  purpose: 'publication' | 'proof';
  match: { os: string; engine: string; gpu: { vendor?: string; renderer?: string; rendererPrefix?: string; version?: string } };
}

export interface EnvironmentsDocument {
  schema: 'walletwall.blender-environments/v1';
  classes: EnvironmentClassSpec[];
  /** Same approved class: lossless frames must be byte-identical. */
  sameClass: 'byte-identical';
  /** Different approved classes, and a crop against its full-frame reference: bounded equivalence. */
  crossClassTolerance: { character: PixelTolerance; scene: PixelTolerance };
  cropEquivalenceTolerance: PixelTolerance;
}

/** Bounded pixel equivalence of two lossless images of the same frame (RGBA, 8-bit). */
export interface PixelTolerance {
  /** At most this fraction of the compared channels may differ by more than `noiseLevel`. */
  maxFractionOverNoise: number;
  noiseLevel: number;
  /** Mean absolute channel difference over the compared area. */
  maxMeanAbsDelta: number;
  /** No drawn pixel may appear or vanish: alpha coverage may differ by at most this many pixels with alpha > 0. */
  maxCoverageDeltaPx: number;
}

export function loadEnvironments(): EnvironmentsDocument {
  const doc = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'config', 'blender-environments.json'), 'utf8')) as EnvironmentsDocument;
  if (doc.schema !== 'walletwall.blender-environments/v1') throw new Error('config/blender-environments.json is not walletwall.blender-environments/v1');
  return doc;
}

/**
 * The render-environment class a render belongs to: its identity (a hash of everything that can change pixels on
 * the host side: OS family, Blender build, engine, GPU or software renderer and its driver or Mesa version, and the
 * render config) and, when one matches, the approved class it falls in.
 */
export function environmentClass(env: RenderEnvironment, cfg: BlenderConfig, approved: EnvironmentsDocument): { id: string; approvedAs: EnvironmentClassSpec | null } {
  const id = contentAddress({ env, renderConfigSha256: blenderConfigSha256(cfg) }).slice(0, 16);
  const gpu = 'renderer' in env.gpu ? env.gpu : null;
  const approvedAs =
    approved.classes.find((c) => {
      const m = c.match;
      if (m.os !== env.os || m.engine !== env.engine || !gpu) return false;
      if (m.gpu.vendor !== undefined && m.gpu.vendor !== gpu.vendor) return false;
      if (m.gpu.renderer !== undefined && m.gpu.renderer !== gpu.renderer) return false;
      if (m.gpu.rendererPrefix !== undefined && !gpu.renderer.startsWith(m.gpu.rendererPrefix)) return false;
      if (m.gpu.version !== undefined && m.gpu.version !== gpu.version) return false;
      return true;
    }) ?? null;
  return { id, approvedAs };
}

export function readModelManifest(): ModelManifest {
  const m = JSON.parse(readFileSync(outFile(CHARACTER.manifest), 'utf8')) as ModelManifest;
  if (m.schema !== 'walletwall.blender-model/v1') throw new Error(`${CHARACTER.manifest} is not walletwall.blender-model/v1`);
  return m;
}

export function blenderIdentity(cfg: BlenderConfig, blender: { version: string; buildHash: string }, rigVersion: number, bridge: object, bridgeSchema: string, terrain: object | null): BlenderIdentity {
  const model = readModelManifest();
  if (model.blenderVersion.split(' ')[0] !== blender.version || model.blenderBuildHash !== blender.buildHash) throw new Error(`the character was built by Blender ${model.blenderVersion} (${model.blenderBuildHash}), not the pinned ${blender.version} (${blender.buildHash}): rebuild it`);
  return {
    schema: BLENDER_IDENTITY_SCHEMA,
    blenderVersion: blender.version,
    blenderBuildHash: blender.buildHash,
    blenderConfigSha256: blenderConfigSha256(cfg),
    blenderSceneSourceSha256: blenderSourceSha256().sha256,
    blendArtifactSha256: sha256Hex(readFileSync(outFile(CHARACTER.blend))),
    walletwallabyModelVersion: model.modelVersion,
    walletwallabyModelSha256: model.modelSha256,
    walletwallabyRealizationSha256: model.modelRealizationSha256,
    walletwallabyRigVersion: rigVersion,
    materialsVersion: model.materialsVersion,
    materialsSha256: model.materialsSha256,
    motionBridgeSchema: bridgeSchema,
    motionPlanSha256: contentAddress(bridge),
    terrainSha256: terrain ? contentAddress(terrain) : null,
    cameraDefinitionSha256: contentAddress({ presentation: cfg.presentation, resolution: cfg.render.resolution }),
    renderSettingsSha256: contentAddress({ render: cfg.render, lighting: cfg.lighting, materials: cfg.materials, outline: cfg.outline, contactShadow: cfg.contactShadow }),
  };
}
