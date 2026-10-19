// The depth reveal at a lesson seam (a PUSH_THROUGH followed by a DEPTH_ENTER segment): where it starts and ends, and
// the Blender transition spec built from the pinned config. Shared by the review script and the proof set. Node-only.

import type { BlenderMotionDocument } from '../character/walletwallaby/blender/bridge.ts';
import type { LessonMotion } from './lesson.ts';
import type { BlenderConfig } from './toolchain.ts';

export interface RevealSeam {
  pushSegment: string;
  intoSegment: string;
  /** First frame of the push (the reveal's first frame) and the incoming segment's first flat frame. */
  first: number;
  flatAgain: number;
  last: number;
}

/** The lesson's depth-reveal seam, or null when it has no PUSH_THROUGH followed by a DEPTH_ENTER segment. */
export function findRevealSeam(lesson: LessonMotion): RevealSeam | null {
  const push = lesson.motion.clips.find((c) => c.kind === 'PUSH');
  if (!push) return null;
  return lesson.timeline.segments.some((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER') ? revealSeam(lesson) : null;
}

export function revealSeam(lesson: LessonMotion): RevealSeam {
  const fps = lesson.timeline.fps;
  const push = lesson.motion.clips.find((c) => c.kind === 'PUSH');
  if (!push) throw new Error('the lesson has no PUSH_THROUGH');
  const into = lesson.timeline.segments.find((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER');
  if (!into) throw new Error('the push is not followed by a DEPTH_ENTER segment');
  const first = Math.ceil((push.startMs * fps) / 1000);
  const flatAgain = Math.ceil((into.contentStartMs * fps) / 1000);
  return { pushSegment: push.segmentId, intoSegment: into.id, first, flatAgain, last: flatAgain - 1 };
}

export interface DepthRevealConfig {
  blockDepthPx: number;
  layerGapPx: number;
  revealBy: number;
  settleFrom: number;
  [k: string]: number | string;
}

export const depthRevealConfig = (cfg: BlenderConfig): DepthRevealConfig => (cfg.transitions as { depthReveal: DepthRevealConfig }).depthReveal;

/** The transition spec and per-frame shots for a set of reveal frames. `layerImages`: job-relative staged PNGs. */
export function revealJob(cfg: BlenderConfig, seam: RevealSeam, bridge: BlenderMotionDocument, frames: readonly number[], layerImages: [string, string]) {
  const dr = depthRevealConfig(cfg);
  const transition = {
    primitive: 'depth-reveal',
    layers: [
      { segment: seam.pushSegment, image: layerImages[0], depthPx: 0, blockDepthPx: dr.blockDepthPx },
      { segment: seam.intoSegment, image: layerImages[1], depthPx: dr.layerGapPx, blockDepthPx: dr.blockDepthPx },
    ],
    camera: { ...dr, focusA: [960, 540], focusB: [960, 540] },
  };
  // The push's falling scale becomes depth toward the deeper surface; in the incoming segment he stands on it.
  const byFrame = new Map(bridge.frames.map((f) => [f.frame, f]));
  const pushFrames = bridge.frames.filter((f) => f.segment === seam.pushSegment && f.visible && f.frame >= seam.first && f.frame <= seam.last);
  const s0 = pushFrames[0]!.place.scale;
  const sEnd = pushFrames.at(-1)!.place.scale;
  const k = dr.layerGapPx / Math.max(1e-6, s0 / sEnd - 1);
  const mid = dr.blockDepthPx / 2;
  const shots = frames.map((frame) => {
    const f = byFrame.get(frame);
    if (!f) throw new Error(`reveal frame ${frame} is not in the bridge`);
    return {
      name: `f${String(frame).padStart(5, '0')}`,
      frame,
      camera: { kind: 'transition', t: (frame - seam.first) / (seam.flatAgain - seam.first) },
      ...(f.segment === seam.pushSegment ? { depthFromScale: { s0, k, base: mid } } : { depthPx: dr.layerGapPx + mid }),
    };
  });
  return { transition, shots };
}
