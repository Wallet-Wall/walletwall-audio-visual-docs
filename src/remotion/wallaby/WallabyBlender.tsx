// WalletWallaby drawn from the Blender presentation lane: per composition
// frame, one lossless RGBA crop (a small canvas whose bounds were decided from
// the frame's placement before Blender ran), rendered by the pinned Blender from
// the same MotionPlan the composition samples, verified by hash when it was
// staged (src/blender/stage.ts), and placed at its frame-pixel position.
// Remotion still owns time: the frame shown is the composition's frame, and
// opacity is applied here, exactly as for the Rive rig.
//
// Fail closed: a visible frame the staged sequence does not hold stops the render.

import React from 'react';
import { cancelRender, Img, staticFile } from 'remotion';
import type { BlenderCharacterProps } from '../props.ts';

const pad = (n: number): string => String(n).padStart(5, '0');

export const WallabyBlender: React.FC<{ frame: number; visible: boolean; opacity: number; source: BlenderCharacterProps }> = ({ frame, visible, opacity, source }) => {
  if (!visible || opacity <= 0) return null;
  if (frame < source.range.first || frame > source.range.last) {
    cancelRender(new Error(`the staged Blender sequence ${source.name} does not cover frame ${frame}`));
    return null;
  }
  const crop = source.crops.find((c) => c.frame === frame);
  // A visible frame without a crop is one whose whole envelope lies outside the frame (nothing of him is on screen).
  if (!crop) {
    if (!source.offFrame.includes(frame)) cancelRender(new Error(`the staged Blender sequence ${source.name} has no frame ${frame}`));
    return null;
  }
  return <Img src={staticFile(`${source.dir}/f${pad(frame)}.png`)} style={{ position: 'absolute', left: crop.x, top: crop.y, width: crop.width, height: crop.height, opacity }} />;
};
