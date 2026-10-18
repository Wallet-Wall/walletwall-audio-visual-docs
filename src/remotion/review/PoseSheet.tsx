// Review-only still: every WalletWallaby key pose, drawn by the Rive rig, with
// the old-vs-new comparisons rendered separately by scripts/render-review.ts.

import React, { useEffect, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion';
import { FONTS, TOKENS } from '../../brand/tokens.ts';
import { POSE_CLIPS } from '../../character/walletwallaby/rive/rig-source.ts';
import { loadBrandFonts } from '../fonts.ts';
import { WallabyRive } from '../wallaby/WallabyRive.tsx';
import { clipState, UNSUPPORTED_CLIPS } from './review-states.ts';

const COLS = 6;
const CELL_W = 300;
const ROW_Y = [470, 940];
const SCALE = 1.05;

export const PoseSheet: React.FC = () => {
  const [fontHandle] = useState(() => delayRender('Loading WalletWall fonts'));
  useEffect(() => {
    loadBrandFonts()
      .then(() => continueRender(fontHandle))
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
  }, [fontHandle]);
  const cells = POSE_CLIPS.map((clip, i) => ({ clip, x: 180 + (i % COLS) * CELL_W, y: ROW_Y[Math.floor(i / COLS)]! - (UNSUPPORTED_CLIPS.has(clip) ? 40 : 0) }));
  return (
    <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
      {cells.map((c) => (
        <React.Fragment key={c.clip}>
          {UNSUPPORTED_CLIPS.has(c.clip) ? null : <div style={{ position: 'absolute', left: c.x - 130, top: c.y, width: 260, height: 2, background: TOKENS.charcoalRail }} />}
          <div style={{ position: 'absolute', left: c.x - 130, top: ROW_Y[POSE_CLIPS.indexOf(c.clip) < COLS ? 0 : 1]! + 18, width: 260, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 20, color: TOKENS.inkMuted }}>{c.clip}</div>
        </React.Fragment>
      ))}
      <WallabyRive states={cells.map((c) => clipState(c.clip, { x: c.x, y: c.y, scale: SCALE }))} />
    </AbsoluteFill>
  );
};
