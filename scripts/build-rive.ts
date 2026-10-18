// npm run rive:build          -> regenerate assets/character/walletwallaby.riv from the rig source
// npm run rive:build -- --check -> fail if the committed .riv differs from a fresh compile (CI-safe, writes nothing)
//
// The .riv is a build artifact of src/character/walletwallaby/rive/rig-source.ts, committed so the
// render bundle and provenance can pin its exact bytes (RIVE_ASSET in versions.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { compileRig } from '../src/character/walletwallaby/rive/rig-compile.ts';
import { RIVE_ASSET } from '../src/character/walletwallaby/versions.ts';

const check = process.argv.includes('--check');
const file = path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/'));
const { bytes } = compileRig();
const fresh = sha256Hex(bytes);

if (check) {
  const committed = existsSync(file) ? sha256Hex(readFileSync(file)) : 'missing';
  const ok = committed === fresh && fresh === RIVE_ASSET.sha256;
  console.log(`[rive] committed ${committed}\n[rive] compiled  ${fresh}\n[rive] pinned    ${RIVE_ASSET.sha256}`);
  if (!ok) {
    console.error('[rive] the committed rig asset, a fresh compile, and the pin must all agree (run npm run rive:build and update RIVE_ASSET).');
    process.exit(1);
  }
  console.log('[rive] ok');
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`[rive] wrote ${RIVE_ASSET.path} (${bytes.length} bytes)\n[rive] sha256 ${fresh}${fresh === RIVE_ASSET.sha256 ? ' (matches the pin)' : ' (pin RIVE_ASSET.sha256 in versions.ts must be updated)'}`);
}
