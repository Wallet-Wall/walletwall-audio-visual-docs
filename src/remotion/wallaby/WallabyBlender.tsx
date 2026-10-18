// WalletWallaby drawn from the Blender presentation lane: per composition
// frame, one lossless RGBA PNG rendered by the pinned Blender from the same
// MotionPlan the composition samples, verified by hash when it was staged
// (src/blender/stage.ts). Remotion still owns time: the frame shown is the
// composition's frame, and opacity is applied here, exactly as for the Rive rig.
//
// Fail closed: a visible frame the staged sequence does not hold stops the render.

import React from 'react';
import { cancelRender, Img, staticFile } from 'remotion';
import type { BlenderCharacterProps } from '../props.ts';

const pad = (n: number): string => String(n).padStart(5, '0');

export const WallabyBlender: React.FC<{ frame: number; visible: boolean; opacity: number; source: BlenderCharacterProps }> = ({ frame, visible, opacity, source }) => {
  if (!visible || opacity <= 0) return null;
  if (frame < source.range.first || frame > source.range.last || !source.frames.includes(frame)) {
    cancelRender(new Error(`the staged Blender sequence ${source.name} has no frame ${frame}`));
    return null;
  }
  return <Img src={staticFile(`${source.dir}/f${pad(frame)}.png`)} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, opacity }} />;
};
