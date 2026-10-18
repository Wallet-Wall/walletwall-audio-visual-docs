// Closed vocabularies for the WalletWall Audiovisual Docs Pipeline.
//
// A storyboard planner (an LLM or a fixture) may only SELECT from these lists.
// What each word looks and sounds like is owned by WalletWall code: the
// renderer, the WalletWallaby rig, and the audio grammar. Adding a word here is
// a deliberate, reviewed change to the visual/sonic language, never something a
// planner can do at runtime.
//
// Everything in this module is isomorphic (no Node or DOM imports) because the
// Remotion bundle, the validator, and the tests all share it.

export const SCENE_TYPES = ['CARD', 'GRAPH', 'UI', 'TAKEAWAY'] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

/** Where a scene lives: the flat 2D teaching surface, or the earned depth dimension. */
export const SCENE_PLANES = ['SURFACE', 'DEPTH'] as const;
export type ScenePlane = (typeof SCENE_PLANES)[number];

export const WALLABY_ACTIONS = [
  'HOP', // move attention to a nearby concept
  'LAND', // settle onto a platform after arriving
  'PERCH', // hold position on a concept while it is explained
  'INSPECT', // scrutinize evidence
  'TRACE', // follow provenance / process / relationship along a route
  'REVEAL', // direct attention to an element as it appears
  'COMPARE', // evaluate two alternatives
  'PUSH_THROUGH', // press into the plane to reveal deeper structure (drives DEPTH_ENTER)
  'DIMENSION_JUMP', // leave one conceptual section for the next (drives SECTION_SHIFT)
  'RESOLVE', // uncertainty or conflict reduced
] as const;
export type WallabyAction = (typeof WALLABY_ACTIONS)[number];

export const WALLABY_EXPRESSIONS = ['NEUTRAL', 'CURIOUS', 'FOCUSED', 'SKEPTICAL', 'CAUTIOUS', 'SATISFIED'] as const;
export type WallabyExpression = (typeof WALLABY_EXPRESSIONS)[number];

export const WALLABY_POSES = [
  'NEUTRAL',
  'TEACH',
  'POINT',
  'INSPECT',
  'PERCH',
  'PREPARE_JUMP',
  'LAND',
  'TAKEAWAY',
  'CTA',
] as const;
export type WallabyPose = (typeof WALLABY_POSES)[number];

/** Actions that need a target anchor in the current scene. */
export const TARGETED_ACTIONS: ReadonlySet<WallabyAction> = new Set<WallabyAction>([
  'HOP',
  'LAND',
  'PERCH',
  'INSPECT',
  'TRACE',
  'REVEAL',
  'COMPARE',
  'RESOLVE',
]);

export const CLAIM_TYPES = ['DOC_DIRECT', 'DOC_DERIVED', 'MEASURED', 'DEMONSTRATED', 'INTERPRETATION'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VIDEO_CLASS_KINDS = ['QUICK', 'FOCUSED', 'DEEP_DIVE'] as const;
export type VideoClassKind = (typeof VIDEO_CLASS_KINDS)[number];

/** Runtime ceilings per class. The spec stores only the kind; this table owns the limits. */
export const VIDEO_CLASSES: Readonly<Record<VideoClassKind, { maxSeconds: number }>> = {
  QUICK: { maxSeconds: 180 },
  FOCUSED: { maxSeconds: 300 },
  DEEP_DIVE: { maxSeconds: 600 },
};

export const SEGMENT_ROLES = [
  'HOOK',
  'IDENT',
  'QUESTION',
  'EXPLANATION',
  'IMPLICATION',
  'TAKEAWAY',
  'CTA',
  'DOCS_REFERENCE',
  'OUTRO',
  'END_SCREEN',
] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

/** Roles that carry teaching content (and therefore a scene and claim-backed narration). */
export const CONTENT_ROLES: ReadonlySet<SegmentRole> = new Set<SegmentRole>([
  'HOOK',
  'QUESTION',
  'EXPLANATION',
  'IMPLICATION',
  'TAKEAWAY',
]);

/** Roles rendered from version-controlled brand templates; the planner only picks the template id. */
export const BRAND_ROLES: ReadonlySet<SegmentRole> = new Set<SegmentRole>([
  'IDENT',
  'CTA',
  'DOCS_REFERENCE',
  'OUTRO',
  'END_SCREEN',
]);

export const TRANSITION_TYPES = ['CUT', 'SECTION_SHIFT', 'DEPTH_ENTER', 'DEPTH_EXIT'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/** The only lesson moves that justify the 2D -> 3D signature transition. */
export const DEPTH_REASONS = [
  'SUMMARY_TO_INTERNALS',
  'RESULT_TO_EVIDENCE',
  'INTERFACE_TO_MECHANISM',
  'FLAT_TO_LAYERED',
] as const;
export type DepthReason = (typeof DEPTH_REASONS)[number];

/** Default budget of DEPTH_ENTER transitions per video; more requires a written justification. */
export const DEPTH_TRANSITION_BUDGET = 2;

export const SONIC_EVENTS = [
  'NODE_REVEAL', // subtle tactile tick
  'ROUTE_TRACE', // quiet movement / sweep
  'EVIDENCE_CONFIRMED', // restrained tonal resolution
  'CONFLICT', // controlled tension
  'LANDING', // soft tactile set
  'DIMENSION_SHIFT', // spatial widening / transformation
  'RESOLVED', // clean convergence
] as const;
export type SonicEvent = (typeof SONIC_EVENTS)[number];

/** Only valid where the source itself is a quantum / Quantum Intelligence topic. */
export const QUANTUM_SONIC_EVENTS = [
  'SUPERPOSITION_ENTER',
  'INTERFERENCE_CONSTRUCTIVE',
  'INTERFERENCE_DESTRUCTIVE',
  'MEASUREMENT_BEGIN',
  'STATE_RESOLVED',
  'UNCERTAINTY_EXPAND',
  'UNCERTAINTY_CONTRACT',
  'DECOHERENCE',
] as const;
export type QuantumSonicEvent = (typeof QUANTUM_SONIC_EVENTS)[number];

/**
 * Visual source kinds, in the preferred source hierarchy order (rank 1 = most
 * preferred). Stock footage, generative imagery/video, and AI presenters are
 * deliberately NOT expressible: there is no kind for them.
 */
export const ASSET_KINDS = [
  'REAL_UI_CAPTURE',
  'REPO_DIAGRAM',
  'REPO_ARTIFACT',
  'DOC_EXCERPT',
  'CHAIN_EVIDENCE',
  'ILLUSTRATION_PRIMITIVE',
  'BRAND_MARK',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const VIDEO_FRESHNESS = ['CURRENT', 'COSMETICALLY_STALE', 'REGENERATION_REQUIRED', 'MATERIALLY_STALE'] as const;
export type VideoFreshness = (typeof VIDEO_FRESHNESS)[number];

export const CHANGE_CATEGORIES = [
  'TYPO_ONLY',
  'STYLE_ONLY',
  'LINK_ONLY',
  'MINOR_EXPLANATION',
  'SCREENSHOT_CHANGED',
  'DIAGRAM_CHANGED',
  'CLAIM_CHANGED',
  'MECHANISM_CHANGED',
  'CONCLUSION_CHANGED',
] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
