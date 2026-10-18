// Review compositions for WalletWallaby (never part of the video pipeline).

import React from 'react';
import { Composition } from 'remotion';
import { Closeup } from './Closeup.tsx';
import { LAB_DURATION_MS, LAB_FPS } from './motion-lab-scene.ts';
import { MotionLab } from './MotionLab.tsx';
import { PoseSheet, SilhouetteSheet } from './PoseSheet.tsx';

export const ReviewRoot: React.FC = () => (
  <>
    <Composition id="WalletWallabyPoseSheet" component={PoseSheet} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id="WalletWallabySilhouetteSheet" component={SilhouetteSheet} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id="WalletWallabyCloseup" component={Closeup} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id="WalletWallabyMotionLab" component={MotionLab} durationInFrames={Math.ceil((LAB_DURATION_MS / 1000) * LAB_FPS)} fps={LAB_FPS} width={1920} height={1080} />
  </>
);
