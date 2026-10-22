// The planner contract: what a storyboard provider (a future LLM adapter, or a
// committed fixture) is allowed to produce.
//
// A storyboard SELECTS: claims as verbatim doc spans, scene types, layouts,
// WalletWallaby actions, transitions, and brand template ids. It cannot express
// styling, code, camera moves, asset generation, or brand copy. The assembler
// turns it into a VideoSpec by binding provenance and resolving templates.

import type { NormalizedSource } from '../source/types.ts';
import type { AssetUse, Claim, NarrationLine, SceneSpec, SeriesMembership, SonicCue, TransitionSpec, WallabyBeat } from '../spec/types.ts';
import type { SegmentRole, VideoClassKind } from '../spec/vocabulary.ts';

export const STORYBOARD_CONTRACT = 'walletwall.storyboard/v1';

export interface Storyboard {
  contract: typeof STORYBOARD_CONTRACT;
  videoId: string;
  docPath: string;
  topic: string;
  /** Optional: the planner may ask for a longer class; the assembler never picks shorter than it fits. */
  requestedClass?: VideoClassKind;
  series: SeriesMembership | null;
  claims: Claim[];
  assets: AssetUse[];
  segments: StoryboardSegment[];
  musicBedId: string | null;
}

export interface ContentStoryboardSegment {
  id: string;
  role: Exclude<SegmentRole, 'CTA' | 'DOCS_REFERENCE' | 'OUTRO' | 'END_SCREEN'>;
  transitionIn: TransitionSpec;
  scene: SceneSpec;
  narration: Omit<NarrationLine, 'templateId'>[];
  wallaby: WallabyBeat[];
  sonic: SonicCue[];
}

export interface BrandStoryboardSegment {
  id: string;
  role: 'CTA' | 'DOCS_REFERENCE' | 'OUTRO' | 'END_SCREEN';
  transitionIn: TransitionSpec;
  templateId: string;
}

export type StoryboardSegment = ContentStoryboardSegment | BrandStoryboardSegment;

export function isBrandSegment(s: StoryboardSegment): s is BrandStoryboardSegment {
  return 'templateId' in s;
}

export interface PlanningRequest {
  videoId: string;
  source: NormalizedSource;
  /** Hard ceiling the planner must design within (e.g. QUICK = 180 s). */
  maxSeconds: number;
}

/** Any storyboard source: fixture today, an LLM adapter later. Output is untrusted until validated. */
export interface StoryboardProvider {
  readonly id: string;
  plan(request: PlanningRequest): Promise<Storyboard>;
}
