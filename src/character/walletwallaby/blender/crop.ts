// Where WalletWallaby is drawn in a teaching frame: a small transparent canvas,
// decided before Blender runs and from nothing but the frame's own placement.
//
// The rig contract's envelope (every pose the motion system can produce, rig px
// at scale 1) is placed at the frame's feet position, mirrored by facing and
// scaled, and padded by a fixed amount (the body's depth under the presentation
// turn, and the outline). The bounds are integer frame pixels, clamped to the
// frame. Blender renders exactly that canvas with a camera whose pixel grid is
// the frame's own, so a crop pixel is the frame pixel it covers; Remotion
// places the crop at (x, y). There is no "grow until it fits": a frame whose
// ink reaches a crop edge that is not the frame's own edge fails the render.
// Isomorphic.

import type { BlenderMotionFrame } from './bridge.ts';

export interface CharacterCrop {
  frame: number;
  /** Frame px, integers: the canvas's top-left corner and size. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The character's scale at this frame (recorded for review; the bounds already include it). */
  scale: number;
}

export interface Envelope {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The crop for one frame, or null when the character is hidden or wholly outside the frame. */
export function characterCrop(f: BlenderMotionFrame, envelope: Envelope, padPx: number, frameSize: { width: number; height: number }): CharacterCrop | null {
  if (!f.visible || f.opacity <= 0) return null;
  if (!(Number.isFinite(padPx) && padPx >= 0)) throw new Error('crop padding must be a non-negative number');
  const { x, y, scale: s, facing } = f.place;
  const xa = x + facing * s * (envelope.minX - padPx);
  const xb = x + facing * s * (envelope.maxX + padPx);
  const x0 = Math.max(0, Math.floor(Math.min(xa, xb)));
  const x1 = Math.min(frameSize.width, Math.ceil(Math.max(xa, xb)));
  const y0 = Math.max(0, Math.floor(y + s * (envelope.minY - padPx)));
  const y1 = Math.min(frameSize.height, Math.ceil(y + s * (envelope.maxY + padPx)));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { frame: f.frame, x: x0, y: y0, width: x1 - x0, height: y1 - y0, scale: s };
}

/** Which crop edges lie inside the frame (where touching ink means the envelope did not hold the body). */
export function interiorEdges(c: CharacterCrop, frameSize: { width: number; height: number }): { left: boolean; right: boolean; top: boolean; bottom: boolean } {
  return { left: c.x > 0, right: c.x + c.width < frameSize.width, top: c.y > 0, bottom: c.y + c.height < frameSize.height };
}
