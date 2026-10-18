// What a render was made with, beyond the spec: the toolchain, the hashed
// version-controlled configuration, WalletWallaby's declared rig and motion
// versions, and the exact Rive asset and runtime bytes the renderer loads.
// Recorded in render.json and the provenance manifest. Node-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RIG, MOTION, motionDefinition, rigDefinition, RIVE_ASSET, RIVE_RUNTIME } from '../character/walletwallaby/versions.ts';
import { readJson, VIDEO_ROOT } from '../config/load.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';

export interface BuildIdentity {
  toolchain: { node: string; lockfileSha256: string; packages: Record<string, string> };
  /** repo path -> content address of the parsed JSON (formatting-insensitive). */
  configs: Record<string, string>;
  character: {
    rig: { id: string; version: number; definition: string };
    motion: { id: string; version: number; definition: string };
    /** The compiled rig the renderer loads (sha256 of the committed bytes) and the runtime that draws it. */
    rive: {
      asset: { path: string; rigVersion: number; sha256: string };
      runtime: { package: string; version: string; wasmSha256: string };
    };
  };
}

const PINNED_PACKAGES = ['remotion', '@remotion/bundler', '@remotion/renderer', '@rive-app/canvas-advanced', 'react', 'react-dom', 'typescript'] as const;
const IDENTITY_CONFIGS = [
  'config/voice-identity.json',
  'config/pronunciation.json',
  'config/sonic-identity.json',
  'config/copy-templates.json',
  'config/copy-policy.json',
  'config/youtube.json',
  'contracts/walletwall-brand.json',
  'fixtures/canonical/MANIFEST.json',
] as const;

export function buildIdentity(): BuildIdentity {
  const packages: Record<string, string> = {};
  for (const name of PINNED_PACKAGES) packages[name] = readJson<{ version: string }>(path.join(VIDEO_ROOT, 'node_modules', ...name.split('/'), 'package.json')).version;
  const configs: Record<string, string> = {};
  for (const rel of IDENTITY_CONFIGS) configs[rel] = contentAddress(readJson<unknown>(path.join(VIDEO_ROOT, ...rel.split('/'))));
  return {
    toolchain: { node: process.version, lockfileSha256: sha256Hex(readFileSync(path.join(VIDEO_ROOT, 'package-lock.json'))), packages },
    configs,
    character: {
      rig: { ...RIG, definition: contentAddress(rigDefinition()) },
      motion: { ...MOTION, definition: contentAddress(motionDefinition()) },
      rive: {
        asset: { path: RIVE_ASSET.path, rigVersion: RIVE_ASSET.rigVersion, sha256: sha256Hex(readFileSync(path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/')))) },
        runtime: {
          package: RIVE_RUNTIME.package,
          version: packages[RIVE_RUNTIME.package]!,
          wasmSha256: sha256Hex(readFileSync(path.join(VIDEO_ROOT, 'node_modules', ...RIVE_RUNTIME.package.split('/'), RIVE_RUNTIME.wasm))),
        },
      },
    },
  };
}
