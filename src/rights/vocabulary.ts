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
 * File types that carry rights of their own (images, audio, video, fonts, 3D) and the compiled or archived code a
 * program can import or load (WebAssembly, Python bytecode and extension modules, shared libraries, zip and wheel
 * archives); every tracked one must be inventoried.
 */
export const MEDIA_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|ico|heic|mp3|wav|ogg|oga|flac|m4a|aac|opus|mp4|mov|webm|mkv|avi|m4v|woff2?|ttf|otf|eot|blend|glb|gltf|fbx|obj|stl|usdz?|exr|hdr|wasm|riv|pyc|pyd|pyz|zip|whl|dll|dylib|so(?:\.\d+)*)$/i;

/** The asset category an asset that binds a component of this kind must be recorded as, so a video cannot file it elsewhere and declare the category absent. */
export const CATEGORY_OF_COMPONENT_KIND: Readonly<Record<string, AssetCategory>> = Object.freeze({ 'generated-model': 'three-d-asset', 'font-package': 'font' });

/** The license files the source-code license map may name, with the SPDX identifier each one holds. */
export const KNOWN_LICENSE_FILES: Readonly<Record<string, string>> = Object.freeze({ MIT: 'LICENSES/MIT.txt', 'GPL-3.0-or-later': 'LICENSES/GPL-3.0-or-later.txt' });

export const LINKAGES = ['COMPILED_INTO_COMMITTED_ARTIFACT', 'BUILD_TIME_ONLY'] as const;

export const EVIDENCE_TYPES = ['FILE', 'URL', 'PACKAGE'] as const;
