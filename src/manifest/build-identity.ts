// What a render was made with, beyond the spec: the toolchain, the hashed
// version-controlled configuration, WalletWallaby's declared rig and motion
// versions, and the Blender renderer that draws him (the pinned build, its
// config, the lane's source, the approved render-environment classes, and the
// pinned character model). Recorded in render.json and the provenance manifest.
// Everything here is re-derivable from the repository alone (no Blender run),
// so the public-output gate can check it anywhere. Node-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { blenderConfigSha256, blenderSourceSha256, loadBlenderConfig } from '../blender/toolchain.ts';
import { BLENDER_CHARACTER, RIG, MOTION, motionDefinition, rigDefinition } from '../character/walletwallaby/versions.ts';
import { readJson, VIDEO_ROOT } from '../config/load.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';

export interface BuildIdentity {
  toolchain: { node: string; lockfileSha256: string; packages: Record<string, string> };
  /** repo path -> content address of the parsed JSON (formatting-insensitive). */
  configs: Record<string, string>;
  character: {
    rig: { id: string; version: number; definition: string };
    motion: { id: string; version: number; definition: string };
    /** The renderer that draws WalletWallaby: the pinned Blender build, its config and lane source, and the character it builds. */
    blender: {
      version: string;
      buildHash: string;
      configSha256: string;
      sceneSourceSha256: string;
      model: { version: number; sha256: string };
      materials: { version: number; sha256: string };
    };
  };
}

const PINNED_PACKAGES = ['remotion', '@remotion/bundler', '@remotion/renderer', 'react', 'react-dom', 'typescript'] as const;
const IDENTITY_CONFIGS = [
  'config/voice-identity.json',
  'config/pronunciation.json',
  'config/sonic-identity.json',
  'config/copy-templates.json',
  'config/copy-policy.json',
  'config/youtube.json',
  'config/blender-visual.json',
  'config/attention.json',
  'config/blender.json',
  'config/blender-environments.json',
  'contracts/walletwall-brand.json',
  'fixtures/canonical/MANIFEST.json',
] as const;

export function buildIdentity(): BuildIdentity {
  const packages: Record<string, string> = {};
  for (const name of PINNED_PACKAGES) packages[name] = readJson<{ version: string }>(path.join(VIDEO_ROOT, 'node_modules', ...name.split('/'), 'package.json')).version;
  const configs: Record<string, string> = {};
  for (const rel of IDENTITY_CONFIGS) configs[rel] = contentAddress(readJson<unknown>(path.join(VIDEO_ROOT, ...rel.split('/'))));
  const cfg = loadBlenderConfig();
  return {
    toolchain: { node: process.version, lockfileSha256: sha256Hex(readFileSync(path.join(VIDEO_ROOT, 'package-lock.json'))), packages },
    configs,
    character: {
      rig: { ...RIG, definition: contentAddress(rigDefinition()) },
      motion: { ...MOTION, definition: contentAddress(motionDefinition()) },
      blender: {
        version: cfg.blender.version,
        buildHash: cfg.blender.buildHash,
        configSha256: blenderConfigSha256(cfg),
        sceneSourceSha256: blenderSourceSha256().sha256,
        model: { version: BLENDER_CHARACTER.modelVersion, sha256: BLENDER_CHARACTER.modelSha256 },
        materials: { version: BLENDER_CHARACTER.materialsVersion, sha256: BLENDER_CHARACTER.materialsSha256 },
      },
    },
  };
}
