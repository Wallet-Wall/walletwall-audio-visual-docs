// Review-only composition: WalletWallaby crossing synthetic terrain (ledge
// mantle, inspect, hard landing on a narrow node, tail balance, push into
// depth), driven by the same motion planner, controls, and Rive rig as the video.

import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import visualJson from '../../../config/blender-visual.json';
import { resolveVisual, type RawVisual } from '../../blender/visual-core.ts';
import { FONTS, TOKENS } from '../../brand/tokens.ts';
import { sampleWallaby } from '../../character/walletwallaby/motion.ts';
import { GROUND_Y } from '../../layout/geometry.ts';
import { loadBrandFonts } from '../fonts.ts';
import { MaterialContext } from '../material.tsx';
import { Formation, Ground } from '../scenes/terrain-art.tsx';
import { WallabyRive } from '../wallaby/WallabyRive.tsx';
import { LAB_PLATFORMS, labPlan } from './motion-lab-scene.ts';

const MATERIAL = resolveVisual(visualJson as unknown as RawVisual);

/** `characterless` draws the terrain alone (the design test; the narrow-perch review composites Blender's body over it). */
export const MotionLab: React.FC<{ characterless?: boolean }> = ({ characterless = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [fontHandle] = useState(() => delayRender('Loading WalletWall fonts'));
  useEffect(() => {
    loadBrandFonts()
      .then(() => continueRender(fontHandle))
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
  }, [fontHandle]);
  const plan = useMemo(() => labPlan(), []);
  const ms = (frame * 1000) / fps;
  const state = sampleWallaby(plan, ms);
  return (
    <MaterialContext.Provider value={MATERIAL}>
    <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
      <Ground />
      {/* Both lab supports are bare physical supports (no content on them), so both are cut as terrain: the tall ledge and the narrow perch. */}
      {LAB_PLATFORMS.map((p) => (
        <Formation key={p.id} kind="ledge" id={p.id} rect={p.rect} />
      ))}
      {characterless ? null : <WallabyRive states={[state]} opacity={state.opacity} />}
      <div style={{ position: 'absolute', left: 60, top: 980, fontFamily: FONTS.mono, fontSize: 24, color: TOKENS.inkMuted }}>
        {`${(ms / 1000).toFixed(2)} s · ${state.visible ? `${state.motion.action} · ${state.motion.phase}` : 'hidden'}`}
      </div>
    </AbsoluteFill>
    </MaterialContext.Provider>
  );
};
