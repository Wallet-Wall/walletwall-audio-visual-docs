// The Blender identity of a render: everything that can change a WalletWallaby
// frame on the Blender side, by hash. Recorded next to every rendered sequence
// (identity.json), carried into the composition's provenance, and re-derived
// before staging, so frames made by another Blender build, another config,
// other lane source, another built model, or another MotionPlan are refused.
// No local path, user name, or machine detail is recorded. Node-only.

import { readFileSync } from 'node:fs';
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
  walletwallabyModelSha256: string;
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
  materialsSha256: string;
  blenderVersion: string;
  blenderBuildHash: string;
}

export const CHARACTER = { blend: 'character/walletwallaby.blend', manifest: 'character/model.json' } as const;

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
