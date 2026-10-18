// Declared WalletWallaby versions must match their pinned definition hashes:
// a pose, palette slot, or motion constant cannot change without a new version.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MOTION, MOTION_PINS, motionDefinition, RIG, RIG_PINS, rigDefinition, RIVE_ASSET, RIVE_RUNTIME } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { committedSpec } from './helpers.ts';

describe('character versions', () => {
  test('the rig definition matches the hash pinned for its declared version', () => {
    assert.equal(contentAddress(rigDefinition()), RIG_PINS[RIG.version], `rig v${RIG.version}: changed definition needs a new version and pin`);
  });
  test('the motion definition matches the hash pinned for its declared version', () => {
    assert.equal(contentAddress(motionDefinition()), MOTION_PINS[MOTION.version], `motion v${MOTION.version}: changed definition needs a new version and pin`);
  });
  test('pins are append-only: one per version from 1 up to the current one', () => {
    for (const [pins, current] of [[RIG_PINS, RIG.version], [MOTION_PINS, MOTION.version]] as const) {
      assert.deepEqual(Object.keys(pins).map(Number), Array.from({ length: current }, (_, i) => i + 1));
      assert.equal(new Set(Object.values(pins)).size, current, 'every version pins a distinct definition');
    }
  });
  test('a definition change is detected (positive control)', () => {
    const changed = { ...rigDefinition(), palette: { ...rigDefinition().palette, fur: 'tan' } };
    assert.notEqual(contentAddress(changed), RIG_PINS[RIG.version]);
  });
});

describe('build identity', () => {
  test('records the toolchain, hashed configs, and character versions, deterministically', () => {
    const a = buildIdentity();
    assert.deepEqual(a, buildIdentity());
    assert.match(a.toolchain.lockfileSha256, /^[0-9a-f]{64}$/);
    assert.equal(a.toolchain.packages.remotion, a.toolchain.packages['@remotion/renderer']);
    for (const rel of ['config/voice-identity.json', 'config/sonic-identity.json', 'config/pronunciation.json', 'contracts/walletwall-brand.json']) assert.match(a.configs[rel] ?? '', /^[0-9a-f]{64}$/, rel);
    assert.equal(a.character.rig.version, RIG.version);
    assert.equal(a.character.motion.definition, MOTION_PINS[MOTION.version]);
  });

  test('records the exact Rive asset and runtime the renderer loads', () => {
    const { rive } = buildIdentity().character;
    const committed = sha256Hex(readFileSync(path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/'))));
    assert.equal(rive.asset.sha256, committed, 'the hash of the bytes on disk');
    assert.equal(rive.asset.sha256, RIVE_ASSET.sha256, 'equal to the pin the renderer enforces');
    assert.equal(rive.asset.rigVersion, RIG.version);
    assert.equal(rive.runtime.package, '@rive-app/canvas-advanced');
    assert.equal(rive.runtime.version, RIVE_RUNTIME.version);
    assert.equal(rive.runtime.wasmSha256, RIVE_RUNTIME.wasmSha256);
    assert.equal(buildIdentity().toolchain.packages[RIVE_RUNTIME.package], RIVE_RUNTIME.version);
    const pkg = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    assert.equal(pkg.dependencies[RIVE_RUNTIME.package], RIVE_RUNTIME.version, 'exact-pinned dependency');
  });

  test('the Rive asset and runtime are part of the provenance manifest', () => {
    const manifest = buildProvenanceManifest({ spec: committedSpec(), track: { providerId: 'fixture', voiceIdentityId: 'v', synthetic: true, estimated: true, lines: [] } as never, timeline: { totalMs: 1, segments: [] } as never, cueSheet: { identAsset: null, musicBed: { id: null }, cues: [], suppressed: [] } as never, validation: { ok: true, errors: 0, warnings: 0, issues: [] } as never, render: null, identity: buildIdentity() });
    assert.equal(manifest.identity.character.rive.asset.sha256, RIVE_ASSET.sha256);
    assert.equal(manifest.identity.character.rive.runtime.wasmSha256, RIVE_RUNTIME.wasmSha256);
  });
});
