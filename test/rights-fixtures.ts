// Fixtures for the release-rights tests: a small, fully valid manifest (the same shape as config/release-rights.json)
// and a complete in-memory repository that agrees with it. Each negative test changes exactly one thing. Plain data;
// every call returns a fresh deep copy.

import { prettyJson } from '../src/core/canonical-json.ts';
import { sha256Hex } from '../src/core/hash.ts';
import type { RepoView } from '../src/rights/repo.ts';

export type Json = any; // deliberately loose: a test must be able to break any field.

export const MIT_TEXT = 'MIT License\n\nCopyright (c) 2026 WalletWall\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';
export const GPL_TEXT = '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>\n';
export const BRAND_SHA = 'c'.repeat(64);
export const BLOB = '1'.repeat(40);
export const CRATE_SUM = '3'.repeat(64);

export function baseManifest(): Json {
  return {
    schema: 'walletwall.release-rights/v1',
    project: 'walletwall-audio-visual-docs',
    verifiedOn: '2026-10-22',
    documents: { notices: 'THIRD_PARTY_NOTICES.md', licensing: 'docs/LICENSING.md', policy: 'docs/RELEASE_RIGHTS.md' },
    sourceCode: {
      defaultLicense: 'MIT',
      copyright: '2026 WalletWall',
      licenseFiles: [
        { license: 'MIT', path: 'LICENSE', sha256: sha256Hex(MIT_TEXT) },
        { license: 'MIT', path: 'LICENSES/MIT.txt', sha256: sha256Hex(MIT_TEXT) },
        { license: 'GPL-3.0-or-later', path: 'LICENSES/GPL-3.0-or-later.txt', sha256: sha256Hex(GPL_TEXT) },
      ],
      python: [
        { path: 'blender/lane/rig.py', classification: 'BLENDER_API_COUPLED', license: 'GPL-3.0-or-later', reason: 'imports bpy' },
        { path: 'blender/lane/common.py', classification: 'BLENDER_INDEPENDENT', license: 'MIT', reason: 'stdlib only; loaded by rig.py inside Blender' },
      ],
    },
    components: [
      {
        id: 'blender-runtime',
        layer: 'TOOL_RUNTIME',
        kind: 'rendering-tool',
        scope: 'RELEASE_PATH',
        rightsBasis: 'OPEN_SOURCE_LICENSE',
        status: 'CLEARED',
        licenseExpression: 'GPL-3.0-or-later',
        distribution: 'NOT_DISTRIBUTED',
        summary: 'Blender renders the character; it is installed from the official build and never redistributed here.',
        evidence: [{ type: 'URL', ref: 'https://www.blender.org/about/license/', retrievedOn: '2026-10-22' }],
      },
      {
        id: 'remotion',
        layer: 'TOOL_RUNTIME',
        kind: 'rendering-tool',
        scope: 'RELEASE_PATH',
        rightsBasis: 'VENDOR_LICENSE',
        status: 'OWNER_CONFIRMATION_PENDING',
        licenseExpression: null,
        distribution: 'NOT_DISTRIBUTED',
        summary: 'Remotion is source-available under its own license; whether this project qualifies for the Free License is an owner and vendor question.',
        evidence: [{ type: 'PACKAGE', ref: 'remotion@4.0.532' }],
        resolution: { ownerAction: 'Confirm eligibility with the vendor, or obtain a company license.', reassessmentTrigger: 'A change of the pinned Remotion version, or of who develops or operates the project.' },
        assessedVersions: [{ package: 'remotion', version: '4.0.532' }],
      },
      {
        id: 'character-model',
        layer: 'GENERATED_MEDIA',
        kind: 'generated-model',
        scope: 'RELEASE_PATH',
        rightsBasis: 'GENERATED_FROM_OWNER_INPUTS',
        status: 'CLEARED',
        licenseExpression: null,
        distribution: 'IN_RELEASE_OUTPUT',
        summary: 'The character .blend generated from this repository code.',
        evidence: [{ type: 'URL', ref: 'https://www.blender.org/support/faq/', retrievedOn: '2026-10-22' }],
        producedBy: ['blender-runtime'],
      },
      {
        id: 'blender-render-output',
        layer: 'GENERATED_MEDIA',
        kind: 'generated-render',
        scope: 'RELEASE_PATH',
        rightsBasis: 'GENERATED_FROM_OWNER_INPUTS',
        status: 'CLEARED',
        licenseExpression: null,
        distribution: 'IN_RELEASE_OUTPUT',
        summary: "Frames Blender renders from this repository's code; Blender output is the creator's.",
        evidence: [{ type: 'URL', ref: 'https://www.blender.org/support/faq/', retrievedOn: '2026-10-22' }],
        producedBy: ['blender-runtime'],
      },
    ],
    dependencies: {
      npm: {
        lockfile: 'package-lock.json',
        rules: [
          { id: 'remotion-license', match: { package: 'remotion' }, version: null, lockLicense: 'SEE LICENSE IN LICENSE.md', resolvedLicense: null, component: 'remotion', evidence: [{ type: 'PACKAGE', ref: 'remotion@4.0.532' }] },
        ],
      },
      cargo: {
        lockfile: 'motion-intelligence/Cargo.lock',
        crates: [{ name: 'libm', version: '0.2.16', checksum: CRATE_SUM, license: 'MIT', linkage: 'COMPILED_INTO_COMMITTED_ARTIFACT', evidence: [{ type: 'PACKAGE', ref: 'libm@0.2.16' }] }],
      },
    },
    mediaFiles: [{ id: 'brand-png', match: { path: 'assets/brand/mark.png' }, covers: { asset: 'demo/brand-mark' } }],
    videos: [
      {
        videoId: 'demo',
        release: { state: 'LOCAL_PROOF' },
        assets: [
          {
            id: 'brand-mark',
            category: 'logo-trademark',
            binding: { type: 'SPEC_ASSET', specAssetId: 'brand-mark', sha256: BRAND_SHA },
            rightsBasis: 'OWNER_AUTHORED',
            status: 'CLEARED',
            licenseExpression: null,
            evidence: [{ type: 'FILE', ref: 'assets/brand/mark.png' }],
          },
          {
            id: 'character',
            category: 'three-d-asset',
            binding: { type: 'COMPONENT', componentId: 'character-model' },
            rightsBasis: 'GENERATED_FROM_OWNER_INPUTS',
            status: 'CLEARED',
            licenseExpression: null,
            evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }],
          },
          {
            id: 'docs-page',
            category: 'authored-content',
            binding: { type: 'CANONICAL_DOCS', docPath: 'docs/demo.mdx', blob: BLOB },
            rightsBasis: 'OWNER_AUTHORED',
            status: 'CLEARED',
            licenseExpression: null,
            evidence: [{ type: 'FILE', ref: 'fixtures/canonical/MANIFEST.json' }],
          },
        ],
        absent: ['music', 'sfx', 'screenshot', 'ui-capture', 'third-party-media', 'illustration', 'narration', 'font'],
      },
    ],
  };
}

export const RIG_PY = '# SPDX-License-Identifier: GPL-3.0-or-later\n# SPDX-FileCopyrightText: 2026 WalletWall\n"""The rig."""\nimport bpy\nfrom common import UNITS\n';
export const COMMON_PY = '# SPDX-License-Identifier: MIT\n# SPDX-FileCopyrightText: 2026 WalletWall\n"""Shared guards."""\nimport json\nUNITS = 0.01\n';

/** The repository that agrees with baseManifest(): every file the check reads. */
export function baseFiles(): Record<string, string> {
  const manifest = baseManifest();
  return {
    LICENSE: MIT_TEXT,
    'LICENSES/MIT.txt': MIT_TEXT,
    'LICENSES/GPL-3.0-or-later.txt': GPL_TEXT,
    'THIRD_PARTY_NOTICES.md': '# Notices\n\n### `blender-runtime`\n### `remotion`\n### `character-model`\n### `blender-render-output`\n\n`libm@0.2.16`\n',
    'docs/LICENSING.md': '# Licensing\n',
    'docs/RELEASE_RIGHTS.md': '# Release rights\n',
    'package.json': JSON.stringify({ name: 'demo', license: 'MIT', dependencies: { remotion: '4.0.532' } }),
    'package-lock.json': JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/remotion': { version: '4.0.532', license: 'SEE LICENSE IN LICENSE.md' } } }),
    'motion-intelligence/Cargo.toml': '[package]\nname = "mi"\nlicense = "MIT"\n',
    'motion-intelligence/Cargo.lock': `version = 4\n\n[[package]]\nname = "libm"\nversion = "0.2.16"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${CRATE_SUM}"\n\n[[package]]\nname = "mi"\nversion = "0.1.0"\n`,
    'blender/lane/rig.py': RIG_PY,
    'blender/lane/common.py': COMMON_PY,
    'config/blender.json': '{}',
    'config/videos.json': JSON.stringify({ videos: [{ videoId: 'demo' }] }),
    'config/sonic-identity.json': JSON.stringify({ ident: { id: 'i', asset: null }, musicBeds: { bed: { asset: null } }, events: { TICK: { asset: null } } }),
    'specs/demo/spec.json': JSON.stringify({
      assets: [{ id: 'brand-mark', kind: 'BRAND_MARK', path: 'video/assets/brand/mark.png', sha256: BRAND_SHA }],
      source: { docPath: 'docs/demo.mdx', blob: BLOB },
      audio: { voiceIdentityId: null, sonicIdentityId: 'i', musicBedId: null },
    }),
    'assets/brand/mark.png': 'not really a png',
    'fixtures/canonical/MANIFEST.json': '{}',
    'config/release-rights.json': prettyJson(manifest),
  };
}

/** A repository with `change` applied to its files and its manifest; the manifest file is re-serialized afterwards. */
export function repoWith(change: (r: { files: Record<string, string>; manifest: Json }) => void = () => {}): RepoView {
  const files = baseFiles();
  const manifest = baseManifest();
  change({ files, manifest });
  files['config/release-rights.json'] = prettyJson(manifest);
  return memoryRepo(files);
}

export function memoryRepo(files: Record<string, string>): RepoView {
  const paths = Object.keys(files).sort();
  return { files: () => paths, read: (rel) => (Object.hasOwn(files, rel) ? files[rel]! : null) };
}

/** Takes the generated character out of a change: its component, the video asset bound to it, its notice, and declares the category absent. */
export function dropCharacter(r: { files: Record<string, string>; manifest: Json }): void {
  r.manifest.components = r.manifest.components.filter((c: Json) => c.id !== 'character-model');
  for (const v of r.manifest.videos) {
    v.assets = v.assets.filter((a: Json) => !(a.binding.type === 'COMPONENT' && a.binding.componentId === 'character-model'));
    if (!v.absent.includes('three-d-asset')) v.absent.push('three-d-asset');
  }
  r.files['THIRD_PARTY_NOTICES.md'] = r.files['THIRD_PARTY_NOTICES.md']!.replace('### `character-model`\n', '');
}

/** A deep copy of the base manifest with `change` applied. */
export function withChange(change: (m: Json) => void): Json {
  const m = baseManifest();
  change(m);
  return m;
}

/** The component of a manifest with this id, for a test to edit. */
export const component = (m: Json, id: string): Json => m.components.find((c: Json) => c.id === id);
