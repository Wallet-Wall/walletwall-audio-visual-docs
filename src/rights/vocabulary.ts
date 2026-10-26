// The closed vocabulary and the encoded policy of the release-rights check (docs/RELEASE_RIGHTS.md). The policy lives
// here, in reviewed code with tests, and not in config/release-rights.json: a manifest can record facts, never loosen
// the rules that judge them. No I/O, no environment.

export const RIGHTS_SCHEMA = 'walletwall.release-rights/v1';

/**
 * What the owner (or a verified license) has established about one item. CLEARED is the only status that is ever
 * enough for a public release; every other status states why not. UNKNOWN and UNVERIFIED are honest placeholders and
 * can never be read as CLEARED.
 */
export const RIGHTS_STATUSES = [
  'CLEARED',
  'OWNER_CONFIRMATION_PENDING',
  'PAID_LICENSE_REQUIRED',
  'BLOCKED',
  'UNKNOWN',
  'UNVERIFIED',
  'PERSONAL_USE_ONLY',
  'NONCOMMERCIAL',
  'EXPIRED',
  'INCOMPATIBLE',
] as const;
export type RightsStatus = (typeof RIGHTS_STATUSES)[number];

/** The release lifecycle of one video. Only the owner may authorize UNLISTED -> PUBLIC. */
export const RELEASE_STATES = ['LOCAL_PROOF', 'RIGHTS_CLEARED', 'UNLISTED', 'OWNER_REVIEWED', 'PUBLIC'] as const;
export type ReleaseState = (typeof RELEASE_STATES)[number];

/**
 * Which statuses a video's material items may hold in each release state. A local proof may carry recorded owner
 * decisions; RIGHTS_CLEARED and everything after it may not. There is deliberately no pre-public exception: a future
 * policy that permits a non-CLEARED status before PUBLIC must change this table, and test/rights-check.test.ts fails
 * until it does so on purpose.
 */
export const STATUSES_PERMITTED_IN: Readonly<Record<ReleaseState, readonly RightsStatus[]>> = Object.freeze({
  LOCAL_PROOF: RIGHTS_STATUSES,
  RIGHTS_CLEARED: ['CLEARED'],
  UNLISTED: ['CLEARED'],
  OWNER_REVIEWED: ['CLEARED'],
  PUBLIC: ['CLEARED'],
});

/** The strict check (`--public-release`) judges against this state: the first one that tolerates no open item. */
export const STRICT_STATE: ReleaseState = 'RIGHTS_CLEARED';

export const COMPONENT_LAYERS = ['SOURCE_CODE', 'TOOL_RUNTIME', 'GENERATED_MEDIA'] as const;
export type ComponentLayer = (typeof COMPONENT_LAYERS)[number];

/** Which component kinds each layer admits. `research-tool` is the one kind that is not on the release path. */
export const KINDS_BY_LAYER: Readonly<Record<ComponentLayer, readonly string[]>> = Object.freeze({
  SOURCE_CODE: ['third-party-derived-source'],
  TOOL_RUNTIME: ['rendering-tool', 'dependency-set', 'font-package', 'data-package', 'provider-service', 'research-tool'],
  GENERATED_MEDIA: ['generated-render', 'generated-model', 'generated-audio'],
});
export const COMPONENT_KINDS: readonly string[] = Object.freeze(Object.values(KINDS_BY_LAYER).flat());

export const COMPONENT_SCOPES = ['RELEASE_PATH', 'RESEARCH_ONLY'] as const;
export type ComponentScope = (typeof COMPONENT_SCOPES)[number];

export const DISTRIBUTIONS = ['NOT_DISTRIBUTED', 'IN_REPOSITORY', 'IN_RELEASE_OUTPUT', 'IN_REPOSITORY_AND_RELEASE_OUTPUT'] as const;

/** Where a right comes from. UNDETERMINED is a placeholder and never admits CLEARED. */
export const RIGHTS_BASES = ['OWNER_AUTHORED', 'GENERATED_FROM_OWNER_INPUTS', 'OPEN_SOURCE_LICENSE', 'VENDOR_LICENSE', 'PROVIDER_TERMS', 'THIRD_PARTY_ATTRIBUTION_ONLY', 'UNDETERMINED'] as const;
export type RightsBasis = (typeof RIGHTS_BASES)[number];

/** Bases whose clearance is a decision (a vendor's, a provider's, a third party's terms), so it needs the owner's record. */
export const BASES_NEEDING_OWNER_CLEARANCE: readonly RightsBasis[] = ['VENDOR_LICENSE', 'PROVIDER_TERMS', 'THIRD_PARTY_ATTRIBUTION_ONLY'];

/** Every category the policy names (docs/RELEASE_RIGHTS.md). The first ten can be per-video assets. */
export const ASSET_CATEGORIES = ['authored-content', 'narration', 'music', 'sfx', 'font', 'screenshot', 'ui-capture', 'logo-trademark', 'illustration', 'third-party-media', 'three-d-asset'] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export const POLICY_CATEGORIES = [...ASSET_CATEGORIES, 'source-script', 'software-dependency'] as const;

/** What a spec asset kind (src/spec/vocabulary.ts ASSET_KINDS) must be recorded as, so a mark cannot be filed as plain text. */
export const CATEGORY_OF_SPEC_ASSET_KIND: Readonly<Record<string, AssetCategory>> = Object.freeze({
  REAL_UI_CAPTURE: 'ui-capture',
  REPO_DIAGRAM: 'illustration',
  REPO_ARTIFACT: 'authored-content',
  DOC_EXCERPT: 'authored-content',
  CHAIN_EVIDENCE: 'screenshot',
  ILLUSTRATION_PRIMITIVE: 'illustration',
  BRAND_MARK: 'logo-trademark',
});

export const BLENDER_CLASSIFICATIONS = ['BLENDER_API_COUPLED', 'BLENDER_INDEPENDENT', 'REVIEW_REQUIRED'] as const;

/** The license a Blender-API-coupled script must carry (Blender's FAQ: licensed as GNU GPL; Blender's binaries ship under GPL v3 or later). */
export const BLENDER_COUPLED_LICENSE = 'GPL-3.0-or-later';

/** Licenses an independent file may keep while GPL files load it inside Blender: all are GPL-compatible. */
export const GPL_COMPATIBLE_LICENSES: ReadonlySet<string> = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0', 'GPL-3.0-or-later']);

/**
 * Licenses a dependency may declare with no further record: permissive, with no obligation on a user who does not
 * redistribute it. Anything else (a custom vendor license, MPL, OFL, CC-BY, a copyleft, or no license at all) needs an
 * explicit rule in the manifest tied to a component.
 */
export const PERMISSIVE_LICENSES: ReadonlySet<string> = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'Python-2.0', 'BlueOak-1.0.0', 'CC0-1.0', 'Unicode-3.0']);

/**
 * Every SPDX identifier an open-source basis may name. An identifier outside this list is refused, so a made-up one
 * (`Remotion-License`) can never stand in for a real license; adding one is a reviewed edit after its text has been read.
 */
export const RECOGNISED_SPDX_IDS: ReadonlySet<string> = new Set([
  ...PERMISSIVE_LICENSES,
  'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0-only', 'AGPL-3.0-or-later',
  'MPL-2.0', 'EPL-2.0', 'OFL-1.1', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'Zlib', 'Artistic-2.0',
]);

/**
 * Licenses whose terms a CLEARED status cannot stand for on its own: a non-commercial restriction, and the network
 * copyleft that reaches a service a user only talks to. Recorded under a status that says why (NONCOMMERCIAL,
 * INCOMPATIBLE, OWNER_CONFIRMATION_PENDING), or as one alternative of an OR the owner can take.
 */
export const RESTRICTED_SPDX_IDS: ReadonlySet<string> = new Set(['CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later']);

/**
 * File types that carry rights of their own (images, audio, video, fonts, 3D models with their textures and materials,
 * and the arrays a mesh or texture can be stored as) and the compiled or archived code a program can import or load
 * (WebAssembly, Python bytecode and extension modules, shared libraries, zip and wheel archives); every tracked one must
 * be inventoried.
 */
export const MEDIA_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|ico|heic|jxl|jp2|tga|dds|ktx2?|basis|psd|psb|kra|xcf|mp3|wav|ogg|oga|flac|m4a|aac|opus|mp4|mov|webm|mkv|avi|m4v|woff2?|ttf|otf|eot|blend|glb|gltf|fbx|obj|mtl|stl|ply|dae|abc|3ds|bvh|x3d|vox|usd[acz]?|sbsar|sbs|ies|cube|exr|hdr|npy|npz|wasm|riv|pyc|pyd|pyz|zip|whl|dll|dylib|so(?:\.\d+)*)$/i;

/** The asset category an asset that binds a component of this kind must be recorded as, so a video cannot file it elsewhere and declare the category absent. */
export const CATEGORY_OF_COMPONENT_KIND: Readonly<Record<string, AssetCategory>> = Object.freeze({ 'generated-model': 'three-d-asset', 'font-package': 'font' });

/** The license files the source-code license map may name, with the SPDX identifier each one holds. */
export const KNOWN_LICENSE_FILES: Readonly<Record<string, string>> = Object.freeze({ MIT: 'LICENSES/MIT.txt', 'GPL-3.0-or-later': 'LICENSES/GPL-3.0-or-later.txt' });

// ── Owner-authored and generated items ──────────────────────────────────────────────────────────────────────────────────
// An item WalletWall authored, or generated from what it authored, is cleared on the owner's word, so the word is
// recorded with what it is about (docs/RELEASE_RIGHTS.md, "Owner-authored and generated items"): a provenance record that
// names who states it and binds the exact bytes, which the check hashes. It establishes the item's own rights and nothing
// else: what the item incorporates keeps its own record (dependsOn), and so does third-party code its sources carry.

/** The bases a provenance record is for, and that an item needs one on to be CLEARED. */
export const OWNER_BASES: readonly RightsBasis[] = ['OWNER_AUTHORED', 'GENERATED_FROM_OWNER_INPUTS'];

/** What a bound file is to the item: its own bytes, a source it is authored in or generated from, or an output it generated that the repository keeps. */
export const PROVENANCE_ROLES = ['ASSET', 'SOURCE', 'OUTPUT'] as const;
export type ProvenanceRole = (typeof PROVENANCE_ROLES)[number];

/** An authored item is its own bytes and may name its sources; a generated item has sources and outputs, never bytes it authored. */
export const PROVENANCE_ROLES_BY_BASIS: Readonly<Record<string, readonly ProvenanceRole[]>> = Object.freeze({ OWNER_AUTHORED: ['ASSET', 'SOURCE'], GENERATED_FROM_OWNER_INPUTS: ['SOURCE', 'OUTPUT'] });

export const MAX_PROVENANCE_FILES = 64;

/**
 * What a generator of each kind makes, so an OUTPUT is the kind of file its item produces: a texture is not a model's
 * output, and code is nobody's. An output of anything else (an asset, another kind) is at least a media file.
 */
export const OUTPUT_FORMATS_BY_KIND: Readonly<Record<string, RegExp>> = Object.freeze({
  'generated-model': /\.(?:blend|glb|gltf|fbx|obj|stl|ply|dae|abc|3ds|x3d|usd[acz]?)$/i,
  'generated-render': /\.(?:png|jpe?g|webp|avif|exr|tiff?|bmp|gif|mp4|mov|webm|mkv|avi|m4v)$/i,
  'generated-audio': /\.(?:wav|mp3|ogg|oga|flac|m4a|aac|opus)$/i,
});

/**
 * What generated media may rest on: the inputs it was generated from, or a vendor's, provider's, or third party's terms
 * for it. Never the license of the tool or the scripts that made it (a program's license does not reach what it outputs
 * unless the output copies the program's own text or art), and never authorship: generated media is generated.
 */
export const GENERATED_MEDIA_BASES: readonly RightsBasis[] = ['GENERATED_FROM_OWNER_INPUTS', 'VENDOR_LICENSE', 'PROVIDER_TERMS', 'THIRD_PARTY_ATTRIBUTION_ONLY', 'UNDETERMINED'];

// ── Voice rights ────────────────────────────────────────────────────────────────────────────────────────────────────────
// A narration voice is used on a rights-and-consent basis (docs/RELEASE_RIGHTS.md, "Voice rights"), not on a blanket ban
// of every human-derived voice. It is allowed only when its rights are established: a synthetic or designed voice; a
// Professional Voice Clone its verified owner intentionally made available to others through the provider; or another
// voice its speaker authorized in writing with the commercial scope documented. It is never allowed when it is cloned
// or conditioned on reference audio without the speaker's authorization, when it impersonates or is attributed
// deceptively, when it is used outside the scope the provider or rights holder granted, when a provider control is
// bypassed or ignored, or when its rights basis cannot be established. WalletWall owns its authored script, composition
// and audiovisual work, never the speaker's voice or likeness.

/** Where a narration voice comes from. UNDETERMINED is a placeholder and never admits CLEARED. */
export const VOICE_SOURCES = ['ELEVENLABS_VOICE_LIBRARY', 'PROVIDER_DESIGNED_SYNTHETIC', 'SPEAKER_LICENSED_DIRECT', 'UNDETERMINED'] as const;
export type VoiceSource = (typeof VOICE_SOURCES)[number];

export const VOICE_TYPES = ['PROFESSIONAL_VOICE_CLONE', 'VOICE_DESIGN', 'REFERENCE_AUDIO_CLONE', 'RECORDED_SPEAKER', 'UNDETERMINED'] as const;
export type VoiceType = (typeof VOICE_TYPES)[number];

/** How the speaker's consent is established. NOT_ESTABLISHED is a voice nobody authorized: it is BLOCKED, never pending. */
export const VOICE_AUTHORIZATION_BASES = ['VERIFIED_OWNER_PUBLISHED', 'SPEAKER_WRITTEN_AUTHORIZATION', 'NO_HUMAN_SPEAKER', 'NOT_ESTABLISHED', 'UNDETERMINED'] as const;
export type VoiceAuthorizationBasis = (typeof VOICE_AUTHORIZATION_BASES)[number];

/** Who lets WalletWall use the voice. Separate from the right to use what it says (COMMERCIAL_OUTPUT_BASES). */
export const VOICE_USE_BASES = ['PROVIDER_AUTHORIZED', 'SPEAKER_LICENSED', 'NOT_ESTABLISHED', 'UNDETERMINED'] as const;
export type VoiceUseBasis = (typeof VOICE_USE_BASES)[number];

/** What lets the audio the voice produces be used commercially. Separate from the right to use the voice itself. */
export const COMMERCIAL_OUTPUT_BASES = ['PAID_PLAN_TERMS', 'SPEAKER_LICENSE', 'NOT_ESTABLISHED', 'UNDETERMINED'] as const;
export type CommercialOutputBasis = (typeof COMMERCIAL_OUTPUT_BASES)[number];

/** The only things WalletWall may record as its own in a narrated work. The speaker's voice and likeness are not on this list. */
export const WALLETWALL_OWNABLE = ['AUTHORED_SCRIPT', 'COMPOSITION', 'AUDIOVISUAL_WORK'] as const;
export type WalletwallOwnable = (typeof WALLETWALL_OWNABLE)[number];

export const SPEAKER_OWNERSHIP = ['SPEAKER_RETAINS', 'NO_HUMAN_SPEAKER'] as const;
export type SpeakerOwnership = (typeof SPEAKER_OWNERSHIP)[number];

/** The provider controls a Voice Library voice can carry. Each is recorded as found, or as undetermined with the exact uncertainty. */
export const PROVIDER_CONTROL_KINDS = ['NOTICE_PERIOD', 'LIVE_MODERATION', 'CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL'] as const;
export type ProviderControlKind = (typeof PROVIDER_CONTROL_KINDS)[number];
export const PROVIDER_CONTROL_STATES = ['IN_FORCE', 'NOT_IN_FORCE', 'UNDETERMINED'] as const;

/**
 * The controls that restrict use, as against conditions of availability: a notice period says how long a withdrawn voice
 * stays usable and live moderation screens requests, but a custom restriction limits how the voice may be used and a
 * removal ends the right to synthesize with it. One in force is never ignored: the owner records whether it is satisfied.
 */
export const USE_RESTRICTING_CONTROLS: readonly ProviderControlKind[] = ['CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL'];

export const MAX_NOTICE_PERIOD_DAYS = 730;

/**
 * The owner's assessment of a use-restricting control in force. EXISTING_OUTPUT_ONLY is for a withdrawal: it ends new
 * synthesis with the voice and leaves the output already generated while the voice was available, so a later withdrawal
 * is not read back into authorized history. It is not a way to wave a restriction through: the owner records that no
 * further synthesis is run.
 */
export const PROVIDER_CONTROL_COMPLIANCE = ['SATISFIED', 'NOT_SATISFIED', 'EXISTING_OUTPUT_ONLY'] as const;
export const COMPLIANCE_THAT_CLEARS: readonly string[] = ['SATISFIED', 'EXISTING_OUTPUT_ONLY'];

/** What a speaker's written authorization can cover, and what it must cover for the voice to be CLEARED. */
export const SPEAKER_AUTHORIZATION_SCOPES = ['VOICE_CLONING', 'COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'] as const;
export const SPEAKER_SCOPE_NEEDED: Readonly<Record<string, readonly string[]>> = Object.freeze({
  REFERENCE_AUDIO_CLONE: ['VOICE_CLONING', 'COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'],
  RECORDED_SPEAKER: ['COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'],
});

/** What each part of a voice's rights requires of the next, so no part can be borrowed from a different route. */
export const VOICE_SOURCE_TYPES: Readonly<Record<string, readonly VoiceType[]>> = Object.freeze({
  ELEVENLABS_VOICE_LIBRARY: ['PROFESSIONAL_VOICE_CLONE'],
  PROVIDER_DESIGNED_SYNTHETIC: ['VOICE_DESIGN'],
  SPEAKER_LICENSED_DIRECT: ['REFERENCE_AUDIO_CLONE', 'RECORDED_SPEAKER'],
});
export const VOICE_TYPE_AUTHORIZATION: Readonly<Record<string, VoiceAuthorizationBasis>> = Object.freeze({
  PROFESSIONAL_VOICE_CLONE: 'VERIFIED_OWNER_PUBLISHED',
  VOICE_DESIGN: 'NO_HUMAN_SPEAKER',
  REFERENCE_AUDIO_CLONE: 'SPEAKER_WRITTEN_AUTHORIZATION',
  RECORDED_SPEAKER: 'SPEAKER_WRITTEN_AUTHORIZATION',
});
export const VOICE_SOURCE_USE: Readonly<Record<string, VoiceUseBasis>> = Object.freeze({
  ELEVENLABS_VOICE_LIBRARY: 'PROVIDER_AUTHORIZED',
  PROVIDER_DESIGNED_SYNTHETIC: 'PROVIDER_AUTHORIZED',
  SPEAKER_LICENSED_DIRECT: 'SPEAKER_LICENSED',
});
export const VOICE_USE_OUTPUT: Readonly<Record<string, CommercialOutputBasis>> = Object.freeze({ PROVIDER_AUTHORIZED: 'PAID_PLAN_TERMS', SPEAKER_LICENSED: 'SPEAKER_LICENSE' });

/** A source that belongs to one provider names it; the narration binding must use that provider. */
export const VOICE_SOURCE_PROVIDER: Readonly<Record<string, string>> = Object.freeze({ ELEVENLABS_VOICE_LIBRARY: 'elevenlabs' });

/** A voice basis is established when someone has looked and found it; UNDETERMINED (nobody looked) and NOT_ESTABLISHED (looked, and it does not hold) are not. */
export const voiceFactEstablished = (v: string | null): boolean => v !== null && v !== 'UNDETERMINED' && v !== 'NOT_ESTABLISHED';

export const LINKAGES = ['COMPILED_INTO_COMMITTED_ARTIFACT', 'BUILD_TIME_ONLY'] as const;

export const EVIDENCE_TYPES = ['FILE', 'URL', 'PACKAGE'] as const;

/**
 * Third-party code this repository has carried, known by how it shows in a source file: a credit (the author's name or
 * site) and fingerprints, the sha256 of distinctive statements with every whitespace character removed, both as the
 * author published them and as they were once translated here. A source file that shows either must be cited by a
 * third-party-derived-source component (check.ts, THIRD_PARTY_CODE_UNRECORDED), so a component cannot be removed or
 * retired while any of its code remains, credited or not. Fingerprints are a tripwire for copies, not a proof of
 * independence: renamed or reflowed statements pass them, which review and the property tests answer instead.
 */
export interface ThirdPartyCodeSign {
  source: string;
  credits: readonly RegExp[];
  fingerprints: readonly string[];
}

export const THIRD_PARTY_CODE_SIGNS: readonly ThirdPartyCodeSign[] = Object.freeze([
  {
    // Inigo Quilez's signed-distance articles (iquilezles.org/articles: distfunctions, smin, ellipsoids). Their code
    // was translated into blender/walletwallaby/geometry.py and build.py (2026-10-18, 1e893e5) and replaced with code
    // written from the definitions (docs/LICENSING.md, "Signed-distance code"). The fingerprints cover the retired
    // translation, the published statements it and its replacement could follow (the round cone in both published
    // forms, the smooth operators), and a first replacement drafted and withdrawn before commit because it followed
    // the vertical round cone and the smooth union statement by statement.
    source: 'Inigo Quilez',
    credits: [/\bQuilez\b/i, /iquilezles/i],
    fingerprints: [
    'e5e9c0919002270ebb3c0cafd6a919f9f77dd4bc2077488ba5099c1e799cc582', // retired sd_ellipsoid: the first radial term
    'cf6fa923c83b719865bc80841c7290ac86969f6cc4e9f7cf64531c3d515a9d58', // retired sd_ellipsoid: the second radial term
    '7221771ab0246907d643dbbb38aaea5f1f273eb26cd64eb9e2a7c7134fc3f999', // retired sd_ellipsoid: the estimate
    '395ae82ffaed99ca8e80299b4124a7600c2144ea96db4b007b4e38a0ec56af8e', // retired sd_round_cone: a2
    '48d4131e5dae988f5f6b1381701de591f73370a166d5d0ad7802f9f3f82bbb08', // retired sd_round_cone: il2
    '786c7cc0d9489726a8d84f9447cbfe2353a3c62f0990d491f58270d6cf665301', // retired sd_round_cone: the scaled radial vector
    '4f8f19b58dece0f865836adfc12f2e8faed31ad37f2f1c644f7080d3046cc2af', // retired sd_round_cone: x2
    '9d10777dd4d9cda2478f04f4caf91c201bc45ac57a077330e29d283e067b0f52', // retired sd_round_cone: y2
    '976c70401ae4dbf880da4130093569b37fe0ccb6eb30177f1f9ebed41aa1bd28', // retired sd_round_cone: z2
    '76836839e590792aa01bdeebb1793aaf84eccec7560e299b67bf0b3686fc647c', // retired sd_round_cone: the branch threshold
    '05fefd38fe2981baee2530d1b78804d45700d30206224165a8dd2f06b8f94e2d', // retired sd_round_cone: the side distance
    '2602cc8f1b47153c944090fb0c586438e582e573601c6a0863132afef2eee765', // retired sd_round_cone: the first-cap test
    '8172b1a498987a003dab9c8172a2d25580be06d3d0a4ad79f5645724aadcdc86', // retired sd_round_cone: the first-cap distance
    '3a1e83c591dddd384e8ea2d39c0aad832729802ea9d6dbe276259ad910dbfacb', // retired sd_round_cone: the second-cap test
    '163393d0d8077e2cf2c65b11f59b5d491b7fa092e81ee329f85f92fec1e4690f', // retired sd_round_cone: the second-cap distance
    '4fb2d3972873589b63da320ee129a8e7ca5d7d810eb60a832b812c0e3037445e', // retired smin: the normalised overlap
    '88bbc018f0c32c6afe75cc00a09d0ecb18fa5a4eeb806ef6d1d2b3d4c49a8a00', // retired smin: the blend
    'bb3e2e672755e7f24a0b1d251adfca518f880dae17ea4c0b8aacf8c34fce9226', // retired smax: the reflection
    '5aa36c90a022153b0442cf0408c7a1f53be73accd87996378e01e3dbc26e2f18', // retired scaled: the scaled evaluation
    '8153c070bfe65c701c15309b91d553e3518524fa1022e0a9c0003550f0e15337', // retired lid shell (build.py)
    '50262a5a323151d87f580ddfe404fffeb70e7caff7ec8f44b98544b501592364', // published sdEllipsoid: k0
    'c50e3d41c10dfb58bb22c880f4a3a897ac07a2c4bbc606306e6b5a4a200b9a35', // published sdEllipsoid: k1
    '002ed8db11f828084c69bb7eb3c02558a674b0911af8155b814f7fdf056e62cd', // published sdEllipsoid: the estimate
    '3fd325b6e574aa976a9a9348a6940551e763fc198921253fe88fc75eca07ccc1', // published sdRoundCone: a2
    '90b75337b0cf198af0a2d2f34fa8c35dcfcdb2e1e335512e038dd0dc3789e1e8', // published sdRoundCone: il2
    'dd66d2a9eb037ffc0c94a1453820b87ed96d20803cc3d89e1f9338f8f7b04c1f', // published sdRoundCone: x2
    'a4a6a32d3f4dec3ec85b570f26a2c185db719521ee6e8bb8b856d93733f657b1', // published sdRoundCone: y2
    'c991e6004aae0d70f904bd7ab6b515d8a75b24f13024fbf80cc2ae3ef26f0a07', // published sdRoundCone: z2
    '5003ffdc1d1b4cfa7c1658cfeabdc4ed9b2455b39b00bdadda2157805c339780', // published sdRoundCone: the branch threshold
    'bfa51968028d74b5fc0962910d8999f9f87e068f86ac1739a950d3e24a9e5107', // published sdRoundCone: the second-cap branch
    'f49d1edd1e7dfa925224ef7590e30d3c14db9f2f4595769f008587182df194bf', // published sdRoundCone: the first-cap branch
    '342d234b650c8d7ad4a319913854e4bc553b9c9bd6c4cc40f24321f854181803', // published sdRoundCone: the side
    'a4a5a14aba4f6b2fcfd9c912140c5d845538b78287cd576a20c27ab92319da8f', // published smin (quadratic polynomial): the normalised overlap
    '22780cea09c1d02c417ecd44688d984343f96fd19a8cfe5b726e92ed62605ecb', // published smin (quadratic polynomial): the blend
    '7e3b8320bbeb0f3e4838bf47b593aa834d2d02dbff6c4274213579fc89a7a4e0', // published opSmoothUnion: the overlap
    '9a04f7d954d6f2c28616420ab1c96ac01039e07936651cefa4f0762ec87944dc', // published opSmoothUnion: the blend
    'ecb1eae1cf10d2328d7b4c28c33faa893b0ec4cfbbf99be4c2ca5369f53af0fd', // published opOnion
    'f654c41cdfff9706ca27e852fa43ffce6b00e30b1bd1e973929f9f4bb6798b57', // published opScale
    '72642d65eafc77a71d6b3d4a09947481bda23350939677ca9652b5328605147f', // published sdRoundCone (vertical): the taper
    '72f9f3b56248479e9af8e029abd4117b88245f48cb53ff8ca7e65bc87ff7324c', // published sdRoundCone (vertical): its cosine
    '72944e21f730ff2e223b417b3d5cff869450b80603589c2a69baf7fd98871910', // published sdRoundCone (vertical): the half-plane point
    'ffceaef643be0fce573bd52e19cf553abd6d35113c39a299c4f971d66971bb89', // published sdRoundCone (vertical): the foot
    'bd47a3b296f061ce94ebeb906f873e9dad15e598d555081bcf94c74585064148', // published sdRoundCone (vertical): the first-cap branch
    '7fbaea6a780eab5c38512e1d090cb19239f6409ee5704becbb0f43cebac6f55b', // published sdRoundCone (vertical): the second-cap branch
    'a8f688c2c455bd5cb0f3da370ef82483b7c21363229191e5688a5f97e57d17e6', // published sdRoundCone (vertical): the side
    '297757254a09e12614d8c093383c7e23d2109c7e7e19e317c64af5e1a1dd6945', // published opSmoothSubtraction
    'd471b86b4426a474227165478ad49fd08d21678c9de5adf68262d931170dead1', // published opSmoothIntersection
    'ea31549257a2207fc48c2a2aed1e563e54c6ead554a3e8cc761b9ffbccf0d9ef', // published opSmoothIntersection: the expanded blend
    '392cc48d2d5102d9cd6b4d9bf2094876fbddd6f9cdd291671c8c3426759f29a8', // withdrawn draft (followed the vertical sdRoundCone): the foot
    '6f8326780fdce9b58c39c27aef572ecae968e1ef9263de586944c8034eeac1e4', // withdrawn draft: the first-cap distance
    '7f43626890e0d5bd6bd0c509596fe948a5ecc2ab685e1616977862f8f4068bec', // withdrawn draft: the second-cap distance
    '2260572c8131179e04f7b26259b76ac07ccf7293c04ee18c62fc0591e806b149', // withdrawn draft: the side distance
    '82084b4532931df61bf3bdb48a14bfb1eed24b20da937e64c3106a89283eb500', // withdrawn draft: the region selection
    '83933721f0987980ba6e06e0bfe5c50b3bee1d6490c05b368749557d352f7863', // withdrawn draft (followed opSmoothUnion): the overlap
    'e35cf9ed475dc23c6f5b955ee6e021dff81790641dce330ba0032ac7ef7ea2f5', // withdrawn draft: the smooth minimum
    'a69006f00e135e4be4484d54fd87d80393fcea137d576b82c5eab3ade1ce813b', // withdrawn draft: the smooth maximum
    ],
  },
]);

/** The files the third-party code scan reads: source code in any language this repository could carry code in. */
export const THIRD_PARTY_SCAN_EXTENSIONS = /\.(?:py|pyw|pyi|ts|tsx|mts|cts|js|jsx|mjs|cjs|rs|glsl|vert|frag|geom|comp|wgsl|hlsl|osl|c|h|cc|cpp|hpp|cs|go|java|kt|swift|lua|ipynb)$/i;
