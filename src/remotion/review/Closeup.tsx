// Review-only still: WalletWallaby large, for judging silhouette and face detail.

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TOKENS } from '../../brand/tokens.ts';
import { POSES } from '../../character/walletwallaby/rig.ts';
import { WallabyRive } from '../wallaby/WallabyRive.tsx';
import { staticState } from './review-states.ts';

export const Closeup: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
    <div style={{ position: 'absolute', left: 0, top: 1000, width: 1920, height: 2, background: TOKENS.charcoalRail }} />
    <WallabyRive
      states={[
        staticState({ x: 620, y: 1000, scale: 3.3 }, POSES.NEUTRAL),
        staticState({ x: 1500, y: 1000, scale: 2.2 }, POSES.INSPECT, { tail: { swing: 0, curl: 1.5, tension: 0.35 } }),
      ]}
    />
  </AbsoluteFill>
);
