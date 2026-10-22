// Input props for the Remotion composition. The composition receives only
// renderer-neutral data: the VideoSpec, a narration track, the source headings
// it needs for eyebrows, the brand copy templates, and, when a render selects
// the Rust/WASM motion engine, the engine's plans (data: one state per frame).
// It never receives credentials, prompts, or provider handles.

import type { AttentionConfig } from '../attention/direction.ts';
import type { BlenderVisual } from '../blender/visual-core.ts';
import type { CopyTemplates } from '../config/types.ts';
import type { MotionEngineProps } from '../motion/rust-path.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { NarrationTrack } from '../timeline/timeline.ts';

export interface ReviewOverlays {
  /** Burn narration captions into the frame (review renders only; YouTube gets a sidecar). */
  captions: boolean;
  /** The design test: render with WalletWallaby removed to prove the lesson stands alone. */
  characterless: boolean;
  /** Draw title-safe, content-bottom, and end-screen reserved zones. */
  guides: boolean;
  /**
   * false only for the layer images Blender's depth reveal is textured with (scripts/render.ts, scripts/blender-proof.ts,
   * scripts/review/blender-transition.ts): Blender never draws brand chrome. Absent (drawn) everywhere else.
   */
  footer?: boolean;
}

/** Where Blender frames were rendered: the environment class id, the approved class it matched (if any), and the record. */
export interface BlenderEnvironmentProps {
  classId: string;
  approvedClass: string | null;
  purpose: 'publication' | 'proof' | null;
  record: Record<string, unknown>;
}

/** A staged, hash-verified Blender frame sequence of WalletWallaby (docs/BLENDER.md). */
export interface BlenderCharacterProps {
  schema: 'walletwall.blender-character-props/v1';
  renderer: 'blender';
  /** Production draws small crops; the full-frame layout is the approved reference and fallback. */
  layout: 'crop' | 'full-frame';
  /** The sequence's name and where it is served from in the bundle's public dir. */
  name: string;
  dir: string;
  /** The bridge range it was rendered from. */
  range: { first: number; last: number };
  /** One crop per drawn frame: integer frame-px bounds, decided from the placement before rendering. */
  crops: { frame: number; x: number; y: number; width: number; height: number }[];
  /** Visible frames whose whole envelope lies outside the frame: nothing to draw. */
  offFrame: number[];
  environment: BlenderEnvironmentProps;
  /** sha256 of Blender's render manifest (every PNG's hash), and of the bridge the frames were rendered from. */
  renderSha256: string;
  bridgeSha256: string;
  /** The Blender identity the frames were made with (src/blender/identity.ts): versions and hashes only. */
  identity: Record<string, string | number | null>;
}

/**
 * A staged Blender depth-reveal transition (the 2D -> 3D signature move): full frames that replace the flat transition
 * for exactly their range. Their teaching surfaces are Remotion's own characterless frames, projected; Blender draws
 * no copy of its own.
 */
export interface BlenderTransitionProps {
  schema: 'walletwall.blender-transition-props/v1';
  name: string;
  dir: string;
  range: { first: number; last: number };
  /** The frames it holds (all of the range, or the ones a stills render asked for); any other frame of the range fails closed. */
  frames: number[];
  environment: BlenderEnvironmentProps;
  renderSha256: string;
  bridgeSha256: string;
  identity: Record<string, string | number | null>;
}

export interface DocsVideoProps {
  spec: VideoSpec;
  track: NarrationTrack;
  /** sectionId -> heading, from the normalized source snapshot. */
  headings: Record<string, string>;
  docTitle: string;
  templates: CopyTemplates;
  overlays: ReviewOverlays;
  /** Rendered into the docs-reference card: short provenance identifiers. */
  provenance: { blob: string; contentHash: string };
  /** The resolved material (config/blender-visual.json): authored cards in parchment, text colours, and the terrain formations' palette. */
  material: BlenderVisual;
  /** The resolved attention direction (config/attention.json): the mode grammar's treatments and the framing bounds. */
  direction: AttentionConfig;
  /** Rust/WASM Motion Intelligence plans for the paths it owns; absent = the TypeScript solver alone. */
  motionEngine?: MotionEngineProps;
  /** WalletWallaby drawn from a staged Blender sequence; absent = the Rive rig. */
  characterRenderer?: BlenderCharacterProps;
  /** Blender depth-reveal transitions, each replacing the flat transition for its frames. */
  depthReveals?: BlenderTransitionProps[];
  /** Index signature required by Remotion's props constraint. */
  [key: string]: unknown;
}
