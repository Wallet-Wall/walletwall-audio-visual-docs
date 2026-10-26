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
