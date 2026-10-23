// WalletWall's quiet brand footer: a fixed editorial element in the bottom-right corner, drawn by Remotion alone
// (src/remotion/brand/Footer.tsx). The lesson teaches from its first frame; the brand rides along here, never as a
// standalone logo scene. It covers nothing: it sits on the title-safe corner, right of the caption band and below
// the ground every scene stands on, and it steps aside wherever the lesson leaves the flat plane (the staged depth
// reveal, from the push to the flat frame, and the depth exit) and for the end screen, which carries the brand
// itself. Its timing is a pure function of the timeline and the clip windows: nothing from Motion
// Intelligence or Blender, no clock, no randomness. Isomorphic.

import type { Clip } from '../character/walletwallaby/choreography.ts';
import type { Timeline, TimedSegment } from '../timeline/timeline.ts';
import { clamp01, type Rect } from './geometry.ts';
import type { TextStyle } from './text-fit.ts';

/** Where the composition draws captions (src/remotion/DocsVideo.tsx): the footer stays right of it. */
export const CAPTION_BAND: Rect = { x: 260, y: 948, w: 1400, h: 132 };

/** The footer: on the title-safe right and bottom edges, right of the caption band. */
export const FOOTER: Rect = { x: 1676, y: 994, w: 148, h: 32 };
/** The brick-wallet mark (the spec's declared BRAND_MARK asset), left of the wordmark. */
export const FOOTER_MARK: Rect = { x: 1676, y: 995, w: 30, h: 30 };
/** The wordmark (config/copy-templates.json `footer`), in WalletWall terracotta. */
export const FOOTER_WORDMARK: Rect = { x: 1714, y: 994, w: 110, h: 32 };
export const FOOTER_WORDMARK_STYLE: TextStyle = { font: 'ui', size: 17, weight: 700, lineHeight: 1.2 };

/** It settles in at the start, steps aside before a hidden stretch, and returns after one. */
export const FOOTER_TIMING = { fadeInMs: 400, stepAsideMs: 300, returnMs: 400 } as const;

/** Segments that carry the brand themselves: the footer is gone from the first of them to the end. */
const SELF_BRANDED: ReadonlySet<TimedSegment['role']> = new Set<TimedSegment['role']>(['END_SCREEN']);

/** A stretch where the footer is fully transparent: [fromMs, toMs). */
export interface FooterWindow {
  fromMs: number;
  toMs: number;
}

export interface FooterPlan {
  totalMs: number;
  hidden: readonly FooterWindow[];
}

/** Where the footer steps aside, from the timeline and the clip windows alone. */
export function planFooter(timeline: Timeline, clips: readonly Pick<Clip, 'kind' | 'startMs' | 'endMs'>[]): FooterPlan {
  const hidden: FooterWindow[] = [];
  for (const s of timeline.segments) {
    if (s.transitionIn.type === 'DEPTH_ENTER') {
      // Blender draws the whole frame from the push that ends where this segment starts, and takes Remotion's frames at
      // both ends of that range, the first flat frame included, as its layer images (src/blender/reveal.ts): the
      // footer stays transparent through that frame's instant, so it is never part of a texture Blender draws.
      const push = clips.find((c) => c.kind === 'PUSH' && Math.abs(c.endMs - s.startMs) <= 1);
      const flatAgainMs = (Math.ceil((s.contentStartMs * timeline.fps) / 1000) * 1000) / timeline.fps;
      hidden.push({ fromMs: Math.min(push?.startMs ?? s.startMs, s.startMs), toMs: flatAgainMs });
    } else if (s.transitionIn.type === 'DEPTH_EXIT') {
      hidden.push({ fromMs: s.startMs, toMs: s.contentStartMs });
    }
  }
  const branded = timeline.segments.find((s) => SELF_BRANDED.has(s.role));
  if (branded) hidden.push({ fromMs: branded.startMs, toMs: timeline.totalMs });
  return { totalMs: timeline.totalMs, hidden };
}

/** The footer's opacity at `ms`: every ramp is linear, so it never pops, and it is 0 inside a hidden stretch. */
export function footerOpacityAt(plan: FooterPlan, ms: number): number {
  let o = clamp01(ms / FOOTER_TIMING.fadeInMs);
  for (const w of plan.hidden) {
    if (ms < w.fromMs) o = Math.min(o, clamp01((w.fromMs - ms) / FOOTER_TIMING.stepAsideMs));
    else if (ms < w.toMs || w.toMs >= plan.totalMs) return 0;
    else o = Math.min(o, clamp01((ms - w.toMs) / FOOTER_TIMING.returnMs));
  }
  return o;
}
