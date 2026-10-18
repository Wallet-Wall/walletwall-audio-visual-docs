// Input props for the Remotion composition. The composition receives only
// renderer-neutral data: the VideoSpec, a narration track, the source headings
// it needs for eyebrows, and the brand copy templates. It never receives
// credentials, prompts, or provider handles.

import type { CopyTemplates } from '../config/types.ts';
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
  /** Index signature required by Remotion's props constraint. */
  [key: string]: unknown;
}
