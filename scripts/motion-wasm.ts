// npm run motion:build  -> canonical rebuild of the Motion Intelligence engine, then update the
//                          committed artifact and its manifest (Linux or WSL: see build-wasm.sh)
// npm run motion:check  -> canonical rebuild, then prove the committed artifact regenerates from
//                          source byte for byte (CI)
//
// Usage: node scripts/motion-wasm.ts --write <built.wasm> | --check <built.wasm>
// <built.wasm> comes from `bash motion-intelligence/build-wasm.sh <built.wasm>`, which also writes
// <built.wasm>.build.json describing the toolchain that made it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { ABI_VERSION, ARTIFACT_SCHEMA, assertHermetic, crateSourceSha256, crateVersion, MOTION_MANIFEST_REL, MOTION_WASM_REL, readArtifactManifest, type ArtifactManifest } from '../src/motion/artifact.ts';

const [mode, built] = process.argv.slice(2);
if ((mode !== '--write' && mode !== '--check') || !built) {
  console.error('usage: node scripts/motion-wasm.ts --write|--check <built.wasm>');
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(built));
assertHermetic(bytes, built);
const build = JSON.parse(readFileSync(`${built}.build.json`, 'utf8')) as ArtifactManifest['build'];
for (const k of ['rustc', 'host', 'target', 'profile', 'rustflags'] as const) {
  if (typeof build[k] !== 'string' || !build[k]) throw new Error(`${built}.build.json: missing ${k}`);
}
if (build.target !== 'wasm32-unknown-unknown' || build.profile !== 'release') throw new Error(`${built} is not a wasm32 release build`);

const manifest: ArtifactManifest = {
  schema: ARTIFACT_SCHEMA,
  crate: { name: 'motion-intelligence', version: crateVersion() },
  abi: ABI_VERSION,
  file: path.basename(MOTION_WASM_REL),
  bytes: bytes.length,
  sha256: sha256Hex(bytes),
  build,
  sourceSha256: crateSourceSha256(),
};

if (mode === '--write') {
  const wasmPath = path.join(VIDEO_ROOT, ...MOTION_WASM_REL.split('/'));
  mkdirSync(path.dirname(wasmPath), { recursive: true });
  writeFileSync(wasmPath, bytes);
  writeFileSync(path.join(VIDEO_ROOT, ...MOTION_MANIFEST_REL.split('/')), prettyJson(manifest));
  console.log(`[motion:build] ${MOTION_WASM_REL}: ${manifest.bytes} bytes, sha256 ${manifest.sha256} (${build.rustc}, ${build.host})`);
} else {
  const committed = readArtifactManifest();
  const committedBytes = new Uint8Array(readFileSync(path.join(VIDEO_ROOT, ...MOTION_WASM_REL.split('/'))));
  // The host is informational: the canonical bytes do not depend on it.
  const comparable = (m: ArtifactManifest) => prettyJson({ ...m, build: { ...m.build, host: '(any)' } });
  const problems: string[] = [];
  if (manifest.sourceSha256 !== committed.sourceSha256) problems.push(`crate sources changed since the committed build (${committed.sourceSha256} -> ${manifest.sourceSha256}); run npm run motion:build`);
  if (sha256Hex(committedBytes) !== committed.sha256) problems.push('the committed artifact does not match its own manifest');
  if (Buffer.compare(Buffer.from(committedBytes), Buffer.from(bytes)) !== 0) problems.push(`rebuilt artifact ${manifest.sha256} (${manifest.bytes} bytes) != committed ${committed.sha256} (${committed.bytes} bytes)`);
  if (comparable(manifest) !== comparable(committed)) problems.push(`manifest differs:\n${comparable(committed)}vs rebuilt\n${comparable(manifest)}`);
  if (problems.length) {
    for (const p of problems) console.error(`[motion:check] ${p}`);
    process.exit(1);
  }
  console.log(`[motion:check] ${MOTION_WASM_REL} regenerates byte for byte from source (${manifest.sha256}, ${build.rustc}).`);
}
