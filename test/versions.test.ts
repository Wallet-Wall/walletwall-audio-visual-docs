// Declared WalletWallaby versions must match their pinned definition hashes:
// a pose, palette slot, or motion constant cannot change without a new version.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MOTION, MOTION_PINS, motionDefinition, RIG, RIG_PINS, rigDefinition } from '../src/character/walletwallaby/versions.ts';
import { contentAddress } from '../src/core/hash.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';

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
    const changed = { ...rigDefinition(), palette: { ...rigDefinition().palette, fur: 'terracotta' } };
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
});
