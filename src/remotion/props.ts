// Input props for the Remotion composition. The composition receives only
// renderer-neutral data: the VideoSpec, a narration track, the source headings
// it needs for eyebrows, the brand copy templates, and, when a render selects
// the Rust/WASM motion engine, the engine's plans (data: one state per frame).
// It never receives credentials, prompts, or provider handles.

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
  /** Rust/WASM Motion Intelligence plans for the paths it owns; absent = the TypeScript solver alone. */
  motionEngine?: MotionEngineProps;
  /** Index signature required by Remotion's props constraint. */
  [key: string]: unknown;
}
