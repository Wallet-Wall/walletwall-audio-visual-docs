// VideoSpec: the typed, source-bound description of one WalletWall docs video.
//
// The spec is the versioned artifact of record. It must stay independent of the
// renderer (Remotion), the voice provider (ElevenLabs or any other), the upload
// target (YouTube), and the planner (any LLM). Those live behind adapters and
// read the spec; nothing in here names them.
//
// Design rules encoded in the shape:
// - Every visual text element and every content narration line cites claims;
//   every claim cites evidence (a verbatim doc span or a hashed repo artifact).
// - WalletWallaby beats carry NO text. The character can direct attention but
//   can never be the only carrier of information.
// - There is no free-form styling, JSX, CSS, camera, or generative-prompt field
//   anywhere. Strict-shape validation rejects unknown keys.

import type {
  AssetKind,
  ClaimType,
  DepthReason,
  QuantumSonicEvent,
  ScenePlane,
  SegmentRole,
  SonicEvent,
  VideoClassKind,
  WallabyAction,
  WallabyExpression,
} from './vocabulary.ts';

export const SPEC_SCHEMA = 'walletwall.video-spec/v1';

export interface VideoSpec {
  schema: typeof SPEC_SCHEMA;
  /** Stable kebab-case id; survives regeneration and re-upload. */
  id: string;
  /** Bumped when a materially changed video is regenerated (a new upload). */
  revision: number;
  locale: 'en-US';
  title: VideoTitle;
  videoClass: VideoClassKind;
  series: SeriesMembership | null;
  source: SourceBinding;
  planner: PlannerProvenance;
  claims: Claim[];
  assets: AssetUse[];
  segments: Segment[];
  audio: AudioDirection;
  output: OutputFormat;
}

export interface VideoTitle {
  /** The searchable question or topic. Series metadata is appended by the publisher, never typed here. */
  topic: string;
}

/** Present only when a topic genuinely needs two or more videos. */
export interface SeriesMembership {
  seriesId: string;
  part: number;
  totalParts: number;
}

export interface SourceBinding {
  /** Repo-relative POSIX path of the authoritative doc. */
  docPath: string;
  /** Canonical published URL (derived from the docs site, never hand-typed). */
  docUrl: string;
  /**
   * Git blob id of docPath's committed bytes when the spec was planned. Content-
   * addressed, so it survives squash and rebase merges (a commit SHA would not);
   * `git log --find-object=<blob>` recovers the commits that carried it.
   */
  blob: string;
  /** sha256 of the normalized meaningful content (EOL-, emphasis-, and link-target-insensitive). */
  contentHash: string;
  normalizerVersion: string;
  /** Committed normalized-source snapshot this spec was planned against (repo-relative). */
  snapshotPath: string;
}

export interface PlannerProvenance {
  /** Storyboard provider id, e.g. "fixture" or a future LLM adapter id. */
  provider: string;
  /** Version of the planner input/output contract the storyboard was produced under. */
  contract: string;
  /** sha256 of the canonical storyboard the spec was assembled from. */
  storyboardHash: string;
}

export interface Claim {
  id: string;
  type: ClaimType;
  /** What the video asserts, in plain words. Reviewed by humans; not machine-verified as a paraphrase. */
  statement: string;
  evidence: ClaimEvidence[];
}

export type ClaimEvidence = DocSpanEvidence | ArtifactEvidence;

export interface DocSpanEvidence {
  kind: 'DOC_SPAN';
  sectionId: string;
  /** Verbatim span of the normalized section text (whitespace- and emphasis-insensitive). */
  quote: string;
}

export interface ArtifactEvidence {
  kind: 'ARTIFACT';
  /** Repo-relative path of a measurement, capture, or demonstration artifact. */
  path: string;
  sha256: string;
  /** Reviewer-facing description. Never treated as evidence. */
  note: string;
  /**
   * Verbatim excerpt of the artifact's text (e.g. a measured value in a committed
   * report). This, not the note, is what numbers and statements are checked against.
   */
  quote?: string;
}

export interface AssetUse {
  id: string;
  kind: AssetKind;
  /** Repo-relative path. */
  path: string;
  sha256: string;
  /** Why this visual is justified by the lesson. */
  justification: string;
}

export type NarrationRole = 'CONTENT' | 'INTERPRETATION' | 'TEMPLATE';

export interface NarrationLine {
  id: string;
  /** Display text: what captions show and what reviewers read. */
  text: string;
  role: NarrationRole;
  claimIds: string[];
  /** Set for TEMPLATE lines; the text must equal the version-controlled template. */
  templateId?: string;
  /** Extra silence after the line, for emphasis. */
  pauseAfterMs?: number;
}

/**
 * One WalletWallaby action. Anchors are scene-local ids such as
 * `node:review`, `card:heading`, or `takeaway:statement`. The renderer owns
 * what the action looks like, how long it takes, and its default expression.
 */
export interface WallabyBeat {
  action: WallabyAction;
  target?: string;
  /** COMPARE only: the second alternative. */
  secondaryTarget?: string;
  /** Narration line id that starts this beat. */
  cue: string;
  delayMs?: number;
  expression?: WallabyExpression;
}

export interface SonicCue {
  event: SonicEvent | QuantumSonicEvent;
  cue: string;
  delayMs?: number;
}

export type TransitionSpec =
  | { type: 'CUT' }
  | { type: 'SECTION_SHIFT' }
  | { type: 'DEPTH_ENTER'; reason: DepthReason; justification?: string }
  | { type: 'DEPTH_EXIT' };

export interface Segment {
  id: string;
  role: SegmentRole;
  transitionIn: TransitionSpec;
  narration: NarrationLine[];
  /** Content roles carry a scene; brand roles are rendered from templates. */
  scene: SceneSpec | null;
  /** Brand roles name their template. */
  templateId?: string;
  wallaby: WallabyBeat[];
  sonic: SonicCue[];
}

/** Text that appears on screen. It must be backed by claims, like spoken text. */
export interface VisualText {
  id: string;
  text: string;
  claimIds: string[];
  /** Narration line id at which the element appears; absent = visible from the scene start. */
  revealCue?: string;
  /** Monospaced treatment for identifiers, paths, hashes, and technical metadata. */
  mono?: boolean;
}

export type SceneSpec = CardScene | GraphScene | UiScene | TakeawayScene;

interface SceneBase {
  plane: ScenePlane;
  /** Source section whose heading is shown as the scene eyebrow (provenance on screen). */
  eyebrowSectionId: string;
}

export interface CardScene extends SceneBase {
  type: 'CARD';
  layout: 'STACK' | 'SPLIT';
  heading: VisualText;
  body: VisualText[];
}

export interface GraphNode extends VisualText {
  /** Optional second line under the label; sourced like any other visual text. */
  detail?: VisualText;
  /** LAYERED layout only. */
  layer?: 'UPPER' | 'LOWER';
}

export interface GraphEdge {
  from: string;
  to: string;
  claimIds: string[];
  revealCue?: string;
}

export interface GraphScene extends SceneBase {
  type: 'GRAPH';
  /**
   * ROUTE = footholds on a level path. ASCENDING_ROUTE = footholds that rise in
   * order; the ordering itself is a claim and must cite one. LAYERED = an upper
   * result plane over a lower evidence plane (used in the depth dimension).
   */
  layout: 'ROUTE' | 'ASCENDING_ROUTE' | 'LAYERED';
  orderingClaimId?: string;
  caption?: VisualText;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface UiScene extends SceneBase {
  type: 'UI';
  /** Must reference a REAL_UI_CAPTURE asset. Fake WalletWall UI is not expressible. */
  assetId: string;
  caption: VisualText;
}

export interface TakeawayScene extends SceneBase {
  type: 'TAKEAWAY';
  statement: VisualText;
  support: VisualText[];
}

export interface AudioDirection {
  /** Provider-neutral voice identity id (config/voice-identity.json). */
  voiceIdentityId: string;
  pronunciationDictionaryId: string;
  sonicIdentityId: string;
  /** null = no music bed. Silence is allowed. */
  musicBedId: string | null;
}

export interface OutputFormat {
  width: 1920;
  height: 1080;
  fps: 30;
  /** Captions ship as a sidecar file; burn-in is a review-render convenience only. */
  captions: 'SIDECAR';
}
