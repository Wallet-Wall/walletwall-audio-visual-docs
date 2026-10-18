// Which motion engine made a render's motion, recorded in render.json and the provenance manifest.
// A rust-wasm render names the exact artifact (sha256 of the committed bytes), the crate and ABI
// versions, the toolchain that built it, the physics configuration (schema, version, content
// address), and the content address of every plan it performed, so the motion can be reproduced
// against the exact WASM that generated it. Node-only.

import path from 'node:path';
import { MOTION } from '../character/walletwallaby/versions.ts';
import { readJson, VIDEO_ROOT } from '../config/load.ts';
import { contentAddress } from '../core/hash.ts';
import { MOTION_WASM_REL, type ArtifactManifest } from './artifact.ts';
import type { MotionIntelligenceConfig } from './plan.ts';

export const MOTION_INTELLIGENCE_CONFIG_REL = 'config/motion-intelligence.json';

/** config version -> content address of the config at that version. Append-only. */
export const MOTION_INTELLIGENCE_CONFIG_PINS: Readonly<Record<number, string>> = {
  1: '0b5de144aed204ab3353368681d459876a871de824a38a284d0f7e69d888b6c5',
};

export interface RustMotionEngineIdentity {
  motionEngine: 'rust-wasm';
  crate: { name: string; version: string };
  abi: number;
  wasm: { path: string; sha256: string; bytes: number };
  toolchain: { rustc: string; target: string };
  config: { path: string; schema: string; id: string; version: number; sha256: string };
  /** The plans the engine performed: which frames, and the content address of the exact bytes it returned. */
  paths: { segmentId: string; action: string; frames: { first: number; count: number }; planSha256: string }[];
}

export interface TypescriptMotionEngineIdentity {
  motionEngine: 'typescript';
  motion: { id: string; version: number };
}

export type MotionEngineIdentity = RustMotionEngineIdentity | TypescriptMotionEngineIdentity;

export function readMotionIntelligenceConfig(): MotionIntelligenceConfig {
  return readJson<MotionIntelligenceConfig>(path.join(VIDEO_ROOT, ...MOTION_INTELLIGENCE_CONFIG_REL.split('/')));
}

export function typescriptEngineIdentity(): TypescriptMotionEngineIdentity {
  return { motionEngine: 'typescript', motion: { id: MOTION.id, version: MOTION.version } };
}

export function rustEngineIdentity(manifest: ArtifactManifest, paths: RustMotionEngineIdentity['paths']): RustMotionEngineIdentity {
  const config = readMotionIntelligenceConfig();
  return {
    motionEngine: 'rust-wasm',
    crate: { ...manifest.crate },
    abi: manifest.abi,
    wasm: { path: MOTION_WASM_REL, sha256: manifest.sha256, bytes: manifest.bytes },
    toolchain: { rustc: manifest.build.rustc, target: manifest.build.target },
    config: { path: MOTION_INTELLIGENCE_CONFIG_REL, schema: config.schema, id: config.id, version: config.version, sha256: contentAddress(config) },
    paths,
  };
}
