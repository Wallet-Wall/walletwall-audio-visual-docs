// The committed Motion Intelligence WebAssembly artifact and its manifest. The artifact is the
// canonical Linux build of motion-intelligence/ (motion-intelligence/build-wasm.sh); the manifest
// records what made it and a hash of the crate sources it was built from, so a source change
// without a rebuild fails `npm test` on any machine, and `npm run motion:check` (CI) proves the
// committed bytes regenerate from source. Node-only.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT } from '../config/load.ts';
import { sha256Hex } from '../core/hash.ts';
import { MotionEngineError } from './plan.ts';

export const MOTION_CRATE_DIR = path.join(VIDEO_ROOT, 'motion-intelligence');
export const MOTION_WASM_REL = 'motion-intelligence/wasm/motion_intelligence.wasm';
export const MOTION_MANIFEST_REL = 'motion-intelligence/wasm/artifact.json';
export const ARTIFACT_SCHEMA = 'walletwall.motion-wasm-artifact/v1';
export const ABI_VERSION = 1;

/** Exports the engine must provide (plus linear memory); nothing else may be a function. */
export const ABI_FUNCTIONS = ['mi_abi_version', 'mi_input', 'mi_output_len', 'mi_output_ptr', 'mi_solve'] as const;
/** Globals the wasm32 linker always exports. */
const LINKER_GLOBALS = ['__data_end', '__heap_base'];

export interface ArtifactManifest {
  schema: typeof ARTIFACT_SCHEMA;
  crate: { name: string; version: string };
  abi: number;
  file: string;
  bytes: number;
  sha256: string;
  build: { rustc: string; host: string; target: string; profile: string; rustflags: string };
  /** Hash of the crate sources (Cargo.toml, Cargo.lock, rust-toolchain.toml, src/**) the artifact was built from. */
  sourceSha256: string;
}

const abs = (rel: string): string => path.join(VIDEO_ROOT, ...rel.split('/'));

/** Content address of the crate sources that determine the artifact's bytes. */
export function crateSourceSha256(): string {
  const files = ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'];
  const walk = (rel: string): void => {
    for (const e of readdirSync(path.join(MOTION_CRATE_DIR, ...rel.split('/')), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith('.rs')) files.push(child);
    }
  };
  walk('src');
  const listing = files.map((f) => `${f}\0${sha256Hex(readFileSync(path.join(MOTION_CRATE_DIR, ...f.split('/'))))}\n`).join('');
  return sha256Hex(listing);
}

/** Version from the crate's Cargo.toml [package] table. */
export function crateVersion(): string {
  const toml = readFileSync(path.join(MOTION_CRATE_DIR, 'Cargo.toml'), 'utf8');
  const pkg = toml.split(/^\[/m).find((s) => s.startsWith('package]'));
  const m = pkg?.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m);
  if (!m) throw new MotionEngineError('ENGINE_UNAVAILABLE', 'motion-intelligence/Cargo.toml has no [package] version');
  return m[1]!;
}

export interface WasmInspection {
  imports: string[];
  functions: string[];
  hasMemory: boolean;
  unexpectedExports: string[];
  /** Embedded source paths that are not host-neutral (/rustc/<commit>/library/... or /cargo/registry/src/...). */
  hostPaths: string[];
}

/** What a module imports and exports, and whether a host-specific path leaked into it. */
export function inspectWasm(bytes: Uint8Array<ArrayBuffer>): WasmInspection {
  const module = new WebAssembly.Module(bytes);
  const exports = WebAssembly.Module.exports(module);
  const text = Buffer.from(bytes).toString('latin1');
  const paths = [...text.matchAll(/[\x20-\x7e]{6,}/g)].map((m) => m[0]).filter((s) => /\.rs\b/.test(s));
  return {
    imports: WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`),
    functions: exports.filter((e) => e.kind === 'function').map((e) => e.name).sort(),
    hasMemory: exports.some((e) => e.kind === 'memory' && e.name === 'memory'),
    unexpectedExports: exports.filter((e) => !(e.kind === 'function' || (e.kind === 'memory' && e.name === 'memory') || (e.kind === 'global' && LINKER_GLOBALS.includes(e.name)))).map((e) => `${e.kind}:${e.name}`),
    hostPaths: paths.filter((s) => !/^\/rustc\/[0-9a-f]{40}\/library\//.test(s) && !/^\/cargo\/registry\/src\//.test(s)),
  };
}

/** Refuse a module that could reach its host, lacks the ABI, or carries a host path. */
export function assertHermetic(bytes: Uint8Array<ArrayBuffer>, what: string): void {
  const i = inspectWasm(bytes);
  if (i.imports.length) throw new MotionEngineError('ENGINE_UNAVAILABLE', `${what} imports host functions (${i.imports.join(', ')}); the engine must import nothing`);
  if (!i.hasMemory || i.functions.join(',') !== [...ABI_FUNCTIONS].sort().join(',') || i.unexpectedExports.length) throw new MotionEngineError('ENGINE_UNAVAILABLE', `${what} does not export exactly the ABI v${ABI_VERSION} surface`);
  if (i.hostPaths.length) throw new MotionEngineError('ENGINE_UNAVAILABLE', `${what} embeds host paths (${i.hostPaths.slice(0, 3).join(', ')}); build it with motion-intelligence/build-wasm.sh`);
}

export function readArtifactManifest(): ArtifactManifest {
  let manifest: ArtifactManifest;
  try {
    manifest = JSON.parse(readFileSync(abs(MOTION_MANIFEST_REL), 'utf8')) as ArtifactManifest;
  } catch (err) {
    throw new MotionEngineError('ENGINE_UNAVAILABLE', `cannot read ${MOTION_MANIFEST_REL}: ${(err as Error).message}`);
  }
  if (manifest.schema !== ARTIFACT_SCHEMA || manifest.abi !== ABI_VERSION || manifest.file !== path.basename(MOTION_WASM_REL)) throw new MotionEngineError('ENGINE_UNAVAILABLE', `${MOTION_MANIFEST_REL} is not an ABI v${ABI_VERSION} artifact manifest`);
  return manifest;
}

export interface VerifiedArtifact {
  bytes: Uint8Array<ArrayBuffer>;
  manifest: ArtifactManifest;
}

/** Refuse bytes that are not exactly the artifact the manifest names. */
export function verifyArtifactBytes(bytes: Uint8Array<ArrayBuffer>, manifest: ArtifactManifest): VerifiedArtifact {
  const sha = sha256Hex(bytes);
  if (sha !== manifest.sha256 || bytes.length !== manifest.bytes) throw new MotionEngineError('ENGINE_UNAVAILABLE', `${MOTION_WASM_REL} is ${sha} (${bytes.length} bytes), not the ${manifest.sha256} its manifest names`);
  return { bytes, manifest };
}

/** The committed artifact, refused unless its bytes are exactly the ones its manifest names. */
export function loadVerifiedArtifact(): VerifiedArtifact {
  const manifest = readArtifactManifest();
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(readFileSync(abs(MOTION_WASM_REL)));
  } catch (err) {
    throw new MotionEngineError('ENGINE_UNAVAILABLE', `cannot read ${MOTION_WASM_REL}: ${(err as Error).message}`);
  }
  return verifyArtifactBytes(bytes, manifest);
}
