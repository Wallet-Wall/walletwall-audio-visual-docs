// What a render was made with, beyond the spec: the toolchain, the hashed
// version-controlled configuration, and WalletWallaby's declared rig and motion
// versions. Recorded in render.json and the provenance manifest. Node-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RIG, MOTION, motionDefinition, rigDefinition } from '../character/walletwallaby/versions.ts';
import { readJson, VIDEO_ROOT } from '../config/load.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';

export interface BuildIdentity {
  toolchain: { node: string; lockfileSha256: string; packages: Record<string, string> };
  /** repo path -> content address of the parsed JSON (formatting-insensitive). */
  configs: Record<string, string>;
  character: {
    rig: { id: string; version: number; definition: string };
    motion: { id: string; version: number; definition: string };
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
    },
  };
}
