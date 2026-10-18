// WalletWallaby drawn by the Rive runtime, frame-authoritative.
//
// Remotion owns time: for every frame the component receives the sampled motion
// state(s), maps them to rig controls, poses a FRESH Rive artboard instance
// (reset, clip blend, IK targets, advance by zero: Rive solves the IK and skins
// the outlines), draws it onto a full-frame transparent canvas placed under the
// feet position at the character's scale and facing, flushes, and frees the
// instance. Nothing here plays, ticks, reads a clock, or keeps Rive state
// between frames, so any frame renders identically on its own, in any order,
// in any tab.

import type { CanvasRendererProxy, RiveCanvas, File as RiveFile } from '@rive-app/canvas-advanced';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cancelRender, continueRender, delayRender, useVideoConfig } from 'remotion';
import type { WallabyState } from '../../character/walletwallaby/motion.ts';
import { openFreshPose, type PosedFrame, type RiveRuntime } from '../../character/walletwallaby/rive/rig-apply.ts';
import { compileRig } from '../../character/walletwallaby/rive/rig-compile.ts';
import { rigControls } from '../../character/walletwallaby/rive/rig-controls.ts';
import { loadWallabyRive } from './rive-loader.ts';

/** The rest-pose model the solver needs; the loader proves the served .riv was compiled from the same source. */
const MODEL = compileRig().model;

interface Bound {
  rive: RiveCanvas;
  file: RiveFile;
  renderer: CanvasRendererProxy;
}

/** The canvas renderer's transform takes the six matrix numbers (its typings say Mat2D; the canvas backend ignores one). */
type CanvasTransform = (xx: number, xy: number, yx: number, yy: number, tx: number, ty: number) => void;

function drawFrame(b: Bound, states: readonly WallabyState[]): void {
  const frames: PosedFrame[] = [];
  try {
    b.renderer.clear();
    for (const s of states) {
      if (!s.visible) continue;
      const frame = openFreshPose(b.rive as unknown as RiveRuntime, b.file, MODEL, rigControls(s));
      frames.push(frame);
      // Rig space -> frame: the rig origin (the feet) lands on the state's feet position, scaled and mirrored.
      const k = s.scale;
      const f = s.facing;
      b.renderer.save();
      (b.renderer.transform as unknown as CanvasTransform)(k * f, 0, 0, k, s.x - k * f * MODEL.origin[0], s.y - k * MODEL.origin[1]);
      (frame.artboard as unknown as { draw(r: CanvasRendererProxy): void }).draw(b.renderer);
      b.renderer.restore();
    }
    // The canvas renderer queues its draw calls; run them all now, while every instance's paints are alive.
    b.rive.resolveAnimationFrame();
  } finally {
    for (const frame of frames) frame.release();
  }
}

/**
 * `silhouette` (review renders only): every pixel the rig inks is drawn in solid charcoal, so a sheet of
 * poses can be judged by outline alone. The pose and the drawing are unchanged; only the canvas is filtered.
 */
export const WallabyRive: React.FC<{ states: readonly WallabyState[]; opacity?: number; silhouette?: boolean }> = ({ states, opacity = 1, silhouette = false }) => {
  const { width, height } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bound, setBound] = useState<Bound | null>(null);
  const [handle] = useState(() => delayRender('Loading the WalletWallaby Rive rig'));
  const released = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let renderer: CanvasRendererProxy | null = null;
    loadWallabyRive()
      .then(({ rive, file }) => {
        if (cancelled || !canvas.current) return;
        renderer = rive.makeRenderer(canvas.current) as CanvasRendererProxy;
        setBound({ rive, file, renderer });
      })
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
    return () => {
      cancelled = true;
      renderer?.delete();
    };
  }, []);

  // Layout effect: the canvas is drawn before the frame can be captured.
  useLayoutEffect(() => {
    if (!bound) return;
    drawFrame(bound, states);
    if (!released.current) {
      released.current = true;
      continueRender(handle);
    }
  }, [bound, states, handle]);

  return <canvas ref={canvas} width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, width, height, opacity, ...(silhouette ? { filter: 'brightness(0)' } : {}) }} />;
};
