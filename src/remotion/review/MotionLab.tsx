// Review-only composition: WalletWallaby crossing synthetic terrain (ledge
// mantle, inspect, hard landing on a narrow node, tail balance, push into
// depth), driven by the same motion planner, controls, and Rive rig as the video.

import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONTS, TOKENS } from '../../brand/tokens.ts';
import { sampleWallaby } from '../../character/walletwallaby/motion.ts';
import { GROUND_Y } from '../../layout/geometry.ts';
import { loadBrandFonts } from '../fonts.ts';
import { WallabyRive } from '../wallaby/WallabyRive.tsx';
import { LAB_PLATFORMS, labPlan } from './motion-lab-scene.ts';

export const MotionLab: React.FC = () => {
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
    <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
      <div style={{ position: 'absolute', left: 0, top: GROUND_Y, width: 1920, height: 1080 - GROUND_Y, background: TOKENS.stoneLow, borderTop: `2px solid ${TOKENS.charcoalRail}` }} />
      {LAB_PLATFORMS.map((p) => (
        <div key={p.id} style={{ position: 'absolute', left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h, background: TOKENS.stone, border: `2px solid ${TOKENS.charcoalBorder}`, boxSizing: 'border-box' }} />
      ))}
      <WallabyRive states={[state]} opacity={state.opacity} />
      <div style={{ position: 'absolute', left: 60, top: 980, fontFamily: FONTS.mono, fontSize: 24, color: TOKENS.inkMuted }}>
        {`${(ms / 1000).toFixed(2)} s · ${state.visible ? `${state.motion.action} · ${state.motion.phase}` : 'hidden'}`}
      </div>
    </AbsoluteFill>
  );
};
