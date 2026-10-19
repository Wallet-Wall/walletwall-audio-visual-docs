// Review-only helpers: hand-built WallabyStates for the pose sheet. Never used
// by the video composition. Isomorphic.

import type { MotionChannels, WallabyState } from '../../character/walletwallaby/motion.ts';
import { EXPRESSIONS, type PoseParams } from '../../character/walletwallaby/rig.ts';
import type { PoseClip } from '../../character/walletwallaby/rig/rig-source.ts';

/** Clips whose pose is a flight or a hang: no ground under the feet. */
export const UNSUPPORTED_CLIPS: ReadonlySet<PoseClip> = new Set<PoseClip>(['takeoff', 'airborne', 'mantle']);

export function staticState(at: { x: number; y: number; scale: number; facing?: 1 | -1 }, pose: PoseParams, channels: Partial<MotionChannels> = {}): WallabyState {
  const grounded = channels.contact === undefined || channels.contact !== 'NONE';
  return {
    visible: true,
    x: at.x,
    y: at.y,
    scale: at.scale,
    opacity: 1,
    facing: at.facing ?? 1,
    pose,
    expression: 'NEUTRAL',
    expr: EXPRESSIONS.NEUTRAL,
    gaze: { x: 0.3 * (at.facing ?? 1), y: 0 },
    focus: null,
    mouth: 'REST',
    motion: {
      rotation: 0,
      stretch: 0,
      tailLag: 0,
      earLag: 0,
      headStab: 0,
      contact: 'GROUND',
      platformDip: 0,
      action: 'IDLE',
      phase: 'HOLD',
      velocity: { x: 0, y: 0 },
      landingImpulse: 0,
      tail: { swing: 0, curl: 0, tension: 0.1 },
      support: grounded ? { x0: -1e6, x1: 1e6 } : null,
      idleTimeS: 0,
      grip: null,
      ...channels,
    },
  };
}

export function clipState(clip: PoseClip, at: { x: number; y: number; scale: number }): WallabyState {
  const airborne = UNSUPPORTED_CLIPS.has(clip);
  return staticState(at, { mix: { [clip]: 1 }, crouch: 0, headTilt: 0, reach: 0, lift: 0 }, airborne ? { contact: 'NONE', support: null } : {});
}
