// Fixtures for the release-rights tests: a small, fully valid manifest (the same shape as config/release-rights.json)
// and a complete in-memory repository that agrees with it. Each negative test changes exactly one thing. Plain data;
// every call returns a fresh deep copy.

import { prettyJson } from '../src/core/canonical-json.ts';
import { sha256Hex } from '../src/core/hash.ts';
import type { RepoView } from '../src/rights/repo.ts';

export type Json = any; // deliberately loose: a test must be able to break any field.

export const MIT_TEXT = 'MIT License\n\nCopyright (c) 2026 WalletWall\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';
export const GPL_TEXT = '                    GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n\n Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>\n';
/** The fixture brand mark's bytes. Its rights record binds them by sha256, so the hash is the real one. */
export const BRAND_BYTES = 'not really a png';
export const BRAND_SHA = sha256Hex(BRAND_BYTES);
export const BLOB = '1'.repeat(40);
export const CRATE_SUM = '3'.repeat(64);

/** The fixture character's sources: the body its model is generated from, and the scene its frames are rendered in. */
export const BODY_SOURCE = 'export const BODY = { rump: [33, 31, 32], belly: [42, 36, 40] };\n';
export const SCENE_SOURCE = "export const SCENE = { world: 'flat', sun: 1 };\n";

/** The owner's statement behind an owner-authored or owner-generated item. */
export const ownerAttestation = (basis = 'The owner states that WalletWall made this and that nothing of a third party is in it.'): Json => ({ attestedBy: 'OWNER', attestedOn: '2026-10-25', basis });
/** A provenance file entry bound to the exact text given. */
export const bound = (path: string, text: string, role: 'ASSET' | 'SOURCE' | 'OUTPUT'): Json => ({ path, sha256: sha256Hex(text), role });

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
        provenance: { attestation: ownerAttestation(), files: [bound('src/character/body.ts', BODY_SOURCE, 'SOURCE')] },
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
        provenance: { attestation: ownerAttestation(), files: [bound('src/character/scene.ts', SCENE_SOURCE, 'SOURCE')] },
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
            provenance: { attestation: ownerAttestation(), files: [{ path: 'assets/brand/mark.png', sha256: BRAND_SHA, role: 'ASSET' }] },
          },
          {
            id: 'character',
            category: 'three-d-asset',
            binding: { type: 'COMPONENT', componentId: 'character-model' },
            rightsBasis: 'OWNER_AUTHORED',
            status: 'CLEARED',
            licenseExpression: null,
            evidence: [{ type: 'FILE', ref: 'docs/LICENSING.md' }],
            provenance: { attestation: ownerAttestation(), files: [bound('src/character/body.ts', BODY_SOURCE, 'SOURCE')] },
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
    'assets/brand/mark.png': BRAND_BYTES,
    'src/character/body.ts': BODY_SOURCE,
    'src/character/scene.ts': SCENE_SOURCE,
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

// ── A narrated video: the publication binding, its voice, and the rights record for that voice ─────────────────────────

export const BINDING_ID = 'demo-publication-v1';
/** The voice the fixture binding names. It lives in config/narration-providers.json, never in the manifest: the rights record carries only its sha256. */
export const FIXTURE_VOICE_ID = 'fixture-voice-0001';
export const OWNER_CLEARANCE = { clearedBy: 'OWNER', clearedOn: '2026-10-22', basis: 'The owner confirmed the voice rights and the paid-plan terms for the narration set that ships.' };

const control = (kind: string, state: string, extra: Json = {}): Json => ({
  kind,
  state,
  note: state === 'UNDETERMINED' ? `The ${kind} setting could not be read offline; it is recorded as undetermined.` : `The owner read the ${kind} setting on the voice's provider page.`,
  ...(state === 'UNDETERMINED' ? {} : { observedBy: 'OWNER', observedOn: '2026-10-22' }),
  ...extra,
});

/** Controls of a Voice Library voice: a 30-day notice period the owner read, and three the owner could not read. */
export function libraryControls(): Json[] {
  return [control('NOTICE_PERIOD', 'IN_FORCE', { days: 30 }), control('LIVE_MODERATION', 'UNDETERMINED'), control('CUSTOM_RESTRICTION', 'UNDETERMINED'), control('LIBRARY_REMOVAL', 'UNDETERMINED')];
}

const ownership = (speaker: 'SPEAKER_RETAINS' | 'NO_HUMAN_SPEAKER'): Json => ({ walletwallOwns: ['AUTHORED_SCRIPT', 'COMPOSITION', 'AUDIOVISUAL_WORK'], speakerVoiceAndLikeness: speaker });

/** Who says the voice is what its record says, and on what basis: required once the origin is established. */
const attestation = (basis = 'The owner inspected the voice in the provider\'s interface and reported what the record states.'): Json => ({ attestedBy: 'OWNER', attestedOn: '2026-10-22', basis });

/** A Professional Voice Clone its verified owner published to the provider's Voice Library for other people to use. */
export function libraryVoice(): Json {
  return {
    binding: { id: BINDING_ID, voiceIdSha256: sha256Hex(FIXTURE_VOICE_ID) },
    source: 'ELEVENLABS_VOICE_LIBRARY',
    voiceType: 'PROFESSIONAL_VOICE_CLONE',
    authorizationBasis: 'VERIFIED_OWNER_PUBLISHED',
    useBasis: 'PROVIDER_AUTHORIZED',
    commercialOutputBasis: 'PAID_PLAN_TERMS',
    ownership: ownership('SPEAKER_RETAINS'),
    attestation: attestation(),
    providerControls: libraryControls(),
  };
}

/** A synthetic voice the provider designed: no human speaker, so nothing for a speaker to authorize. */
export function designedVoice(): Json {
  return { ...libraryVoice(), source: 'PROVIDER_DESIGNED_SYNTHETIC', voiceType: 'VOICE_DESIGN', authorizationBasis: 'NO_HUMAN_SPEAKER', ownership: ownership('NO_HUMAN_SPEAKER'), providerControls: [] };
}

/** A speaker's own voice, licensed to WalletWall directly in writing with the commercial scope documented. */
export function licensedVoice(): Json {
  return {
    ...libraryVoice(),
    source: 'SPEAKER_LICENSED_DIRECT',
    voiceType: 'RECORDED_SPEAKER',
    authorizationBasis: 'SPEAKER_WRITTEN_AUTHORIZATION',
    useBasis: 'SPEAKER_LICENSED',
    commercialOutputBasis: 'SPEAKER_LICENSE',
    speakerAuthorization: { documentHeldBy: 'OWNER', grantedOn: '2026-10-01', scope: ['COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'] },
    providerControls: [],
  };
}

/**
 * Makes the fixture video narrated through the provider `elevenlabs`: the binding config, the spec's voice identity, the
 * provider service with its voice record, the generated audio it produces, and the video's narration asset, all CLEARED
 * with the owner's record unless `status` says otherwise. Remotion stays pending, as in the base manifest.
 */
export function withNarration(x: { files: Record<string, string>; manifest: Json }, voice: Json = libraryVoice(), status = 'CLEARED'): void {
  const cleared = status === 'CLEARED';
  const open = { resolution: { ownerAction: 'Confirm the voice rights and the plan at synthesis time.', reassessmentTrigger: 'Each synthesis run.' } };
  const gate = cleared ? { clearance: OWNER_CLEARANCE } : open;
  x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: BINDING_ID, provider: 'elevenlabs' }, providers: { elevenlabs: { voiceId: FIXTURE_VOICE_ID } } });
  x.files['specs/demo/spec.json'] = JSON.stringify({ assets: [{ id: 'brand-mark', kind: 'BRAND_MARK', path: 'p.png', sha256: BRAND_SHA }], source: { docPath: 'docs/demo.mdx', blob: BLOB }, audio: { voiceIdentityId: 'v2', sonicIdentityId: 'i', musicBedId: null } });
  x.files['THIRD_PARTY_NOTICES.md'] += '### `elevenlabs-service`\n### `elevenlabs-narration-audio`\n';
  x.manifest.components.push(
    {
      id: 'elevenlabs-service',
      layer: 'TOOL_RUNTIME',
      kind: 'provider-service',
      scope: 'RELEASE_PATH',
      rightsBasis: 'PROVIDER_TERMS',
      status,
      licenseExpression: null,
      distribution: 'NOT_DISTRIBUTED',
      summary: 'An external service synthesizes the narration under its terms, with the voice recorded in voiceRights.',
      evidence: [{ type: 'URL', ref: 'https://example.com/terms', retrievedOn: '2026-10-22' }],
      voiceRights: voice,
      ...gate,
    },
    {
      id: 'elevenlabs-narration-audio',
      layer: 'GENERATED_MEDIA',
      kind: 'generated-audio',
      scope: 'RELEASE_PATH',
      rightsBasis: 'PROVIDER_TERMS',
      status,
      licenseExpression: null,
      distribution: 'IN_RELEASE_OUTPUT',
      summary: 'Narration audio the provider generates.',
      evidence: [{ type: 'URL', ref: 'https://example.com/terms', retrievedOn: '2026-10-22' }],
      producedBy: ['elevenlabs-service'],
      ...gate,
    },
  );
  x.manifest.videos[0].assets.push({ id: 'narration', category: 'narration', binding: { type: 'COMPONENT', componentId: 'elevenlabs-service' }, rightsBasis: 'PROVIDER_TERMS', status, licenseExpression: null, evidence: [{ type: 'FILE', ref: 'docs/RELEASE_RIGHTS.md' }], ...gate });
  x.manifest.videos[0].absent.splice(x.manifest.videos[0].absent.indexOf('narration'), 1);
}
