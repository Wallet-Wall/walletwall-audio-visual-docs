// Review-only synthetic terrain for WalletWallaby's motion lab: a ground line,
// a tall ledge to climb, and a narrow node to land and balance on. The clips
// fix WHERE and WHEN exactly as the choreography would; the motion planner and
// the rig decide HOW. Never used by the video pipeline. Isomorphic.

import type { Clip } from '../../character/walletwallaby/choreography.ts';
import { planMotion, type MotionPlan } from '../../character/walletwallaby/motion.ts';
import { GROUND_Y, type Point } from '../../layout/geometry.ts';
import type { Platform, SceneLayout } from '../../layout/scene-layout.ts';
import type { WallabyPose } from '../../spec/vocabulary.ts';

export const LAB_SEGMENT = 'lab';
export const LAB_FPS = 30;

export const LAB_PLATFORMS: Platform[] = [
  { id: 'ledge', kind: 'LEDGE', rect: { x: 1060, y: 560, w: 330, h: GROUND_Y - 560 } },
  { id: 'node', kind: 'NODE', rect: { x: 1600, y: 740, w: 150, h: GROUND_Y - 740 } },
];

export const LAB_LAYOUT: SceneLayout = { texts: [], platforms: LAB_PLATFORMS, anchors: {}, routes: [], slabs: [], limits: { maxItems: 0 } };

const clip = (kind: Clip['kind'], startMs: number, endMs: number, from: Point, to: Point, pose: WallabyPose, extra: Partial<Clip> = {}): Clip => ({
  kind,
  segmentId: LAB_SEGMENT,
  startMs,
  endMs,
  from,
  to,
  fromScale: 1,
  toScale: 1,
  arc: 0,
  path: [],
  pose,
  expression: 'FOCUSED',
  lookAt: { x: to.x + 260, y: to.y - 160 },
  lookAlt: null,
  action: null,
  target: null,
  ...extra,
});

const START: Point = { x: 300, y: GROUND_Y };
const LEDGE_TOP: Point = { x: 1170, y: 560 };
const NODE_TOP: Point = { x: 1675, y: 740 };

/** Idle on the ground, mantle onto the ledge, inspect, hard-land on the narrow node, balance, push into depth. */
export const LAB_CLIPS: Clip[] = [
  clip('HOLD', 0, 1100, START, START, 'NEUTRAL', { expression: 'CURIOUS', lookAt: { x: 1100, y: 520 } }),
  clip('TRAVEL', 1100, 2000, START, LEDGE_TOP, 'NEUTRAL', { action: 'HOP' }),
  clip('HOLD', 2000, 3300, LEDGE_TOP, LEDGE_TOP, 'INSPECT', { lookAt: { x: 1330, y: 640 } }),
  clip('TRAVEL', 3300, 4000, LEDGE_TOP, NODE_TOP, 'INSPECT', { action: 'LAND' }),
  clip('HOLD', 4000, 5600, NODE_TOP, NODE_TOP, 'PERCH', { lookAt: { x: 1300, y: 600 } }),
  clip('PUSH', 5600, 7100, NODE_TOP, { x: 960, y: 520 }, 'PERCH', { toScale: 0.3, action: 'PUSH_THROUGH' }),
];

export const LAB_DURATION_MS = 7400;

export function labPlan(): MotionPlan {
  return planMotion(LAB_CLIPS, new Map([[LAB_SEGMENT, LAB_LAYOUT]]));
}
