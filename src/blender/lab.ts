// The motion lab (review-only synthetic terrain: a ground line, a tall ledge to climb, a narrow node to balance on)
// as a lesson Blender can be given, so the ported rig invariants (scripts/blender-invariants.ts) cover what the
// lesson itself never does: hanging from a ledge lip, and a tail past the edge of a narrow perch. Node-only.

import { sampleWallaby } from '../character/walletwallaby/motion.ts';
import { terrainsFor } from '../layout/terrain.ts';
import { bindMotionEngine } from '../motion/rust-path.ts';
import { labPlan, LAB_DURATION_MS, LAB_FPS, LAB_LAYOUT, LAB_SEGMENT } from '../remotion/review/motion-lab-scene.ts';
import type { Timeline } from '../timeline/timeline.ts';
import type { LessonMotion } from './lesson.ts';

export const LAB_VIDEO_ID = 'motion-lab';

export function labLesson(): LessonMotion {
  const motion = labPlan();
  const terrains = terrainsFor([{ id: LAB_SEGMENT, role: 'SCENE' }], new Map([[LAB_SEGMENT, LAB_LAYOUT]]));
  const terrain = terrains.get(LAB_SEGMENT)!;
  // The lab has no narrated timeline: only its frame rate and length matter to a bridge.
  const timeline = { fps: LAB_FPS, totalMs: LAB_DURATION_MS, segments: [] } as unknown as Timeline;
  return {
    videoId: LAB_VIDEO_ID,
    timeline,
    motion,
    engine: bindMotionEngine(undefined, motion, LAB_FPS, LAB_VIDEO_ID),
    engineId: 'typescript:motion-lab',
    terrains,
    layouts: new Map([[LAB_SEGMENT, LAB_LAYOUT]]),
    frames: Math.floor((LAB_DURATION_MS * LAB_FPS) / 1000),
    sample(frame: number) {
      const ms = (frame * 1000) / LAB_FPS;
      return { state: sampleWallaby(motion, ms, 'REST'), segment: LAB_SEGMENT, onScreen: [terrain] };
    },
  };
}
