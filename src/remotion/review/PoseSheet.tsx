// Review-only still: every WalletWallaby key pose, drawn by the Rive rig, with
// the old-vs-new comparisons rendered separately by scripts/render-review.ts.
// The silhouette variant draws the same poses in solid charcoal: the test of a
// mascot is that its outline alone is recognisable in every pose (one mass,
// the long tail as the signature line).

import React, { useEffect, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender } from 'remotion';
import { FONTS, TOKENS } from '../../brand/tokens.ts';
import { POSE_CLIPS } from '../../character/walletwallaby/rive/rig-source.ts';
import { loadBrandFonts } from '../fonts.ts';
import { WallabyRive } from '../wallaby/WallabyRive.tsx';
import { clipState, UNSUPPORTED_CLIPS } from './review-states.ts';

const COLS = 6;
const CELL_W = 300;
const ROW_Y = [450, 930];
const SCALE = 0.8;
/** The figure's ink runs further behind the feet (the tail) than ahead, so each figure sits right of its cell's centre. */
const INK_SHIFT = 30;

export const PoseSheet: React.FC<{ silhouette?: boolean }> = ({ silhouette = false }) => {
  const [fontHandle] = useState(() => delayRender('Loading WalletWall fonts'));
  useEffect(() => {
    loadBrandFonts()
      .then(() => continueRender(fontHandle))
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
  }, [fontHandle]);
  const cells = POSE_CLIPS.map((clip, i) => ({ clip, cx: 150 + (i % COLS) * CELL_W + 60, y: ROW_Y[Math.floor(i / COLS)]! - (UNSUPPORTED_CLIPS.has(clip) ? 40 : 0) }));
  return (
    <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
      {cells.map((c) => (
        <React.Fragment key={c.clip}>
          {UNSUPPORTED_CLIPS.has(c.clip) ? null : <div style={{ position: 'absolute', left: c.cx - 135, top: c.y, width: 270, height: 2, background: TOKENS.charcoalRail }} />}
          <div style={{ position: 'absolute', left: c.cx - 135, top: ROW_Y[POSE_CLIPS.indexOf(c.clip) < COLS ? 0 : 1]! + 18, width: 270, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 20, color: TOKENS.inkMuted }}>{c.clip}</div>
        </React.Fragment>
      ))}
      <WallabyRive silhouette={silhouette} states={cells.map((c) => clipState(c.clip, { x: c.cx + INK_SHIFT, y: c.y, scale: SCALE }))} />
    </AbsoluteFill>
  );
};

export const SilhouetteSheet: React.FC = () => <PoseSheet silhouette />;
