// WalletWallaby: a stylized, flat 2D rig. Feet sit at the local origin; the
// figure faces right and is mirrored for facing = -1. Performance comes from
// posture, head tilt, ears, eyes, and tail balance; the mouth has four quiet
// states. No costume and no caricature: a calm expedition guide, drawn in the
// WalletWall palette with fine charcoal strokes.

import React from 'react';
import { TOKENS } from '../../brand/tokens.ts';
import type { WallabyState } from '../../character/walletwallaby/choreography.ts';
import { RIG_PALETTE } from '../../character/walletwallaby/rig.ts';
import { lerp } from '../../layout/geometry.ts';

const INK = TOKENS[RIG_PALETTE.ink];
const FUR = TOKENS[RIG_PALETTE.fur];
const FUR_FAR = TOKENS[RIG_PALETTE.furFar];
const BELLY = TOKENS[RIG_PALETTE.belly];
const INNER_EAR = TOKENS[RIG_PALETTE.innerEar];
const TAG = TOKENS[RIG_PALETTE.tag];

export const WallabyFigure: React.FC<{ state: WallabyState }> = ({ state }) => {
  if (!state.visible) return null;
  const { pose, expr, gaze, mouth } = state;
  const stroke = 2.2;
  const crouchDrop = pose.crouch * 20;
  const armAngle = lerp(72, -6, pose.reach) - pose.lift * 58;
  const footTuck = pose.airborne * -22;
  const lid = Math.min(1, expr.lid);
  const s = state.scale;

  const eye = (cx: number, cy: number, rx: number, ry: number, clipId: string) => (
    <g>
      <clipPath id={clipId}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} />
      </clipPath>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={INK} />
      <circle cx={cx + 1.8 + gaze.x * 0.8} cy={cy - 2.2 + gaze.y * 0.6} r={rx * 0.3} fill={BELLY} />
      <rect x={cx - rx - 1} y={cy - ry - 1} width={rx * 2 + 2} height={(ry * 2 + 2) * lid} fill={FUR} clipPath={`url(#${clipId})`} />
    </g>
  );

  return (
    <svg
      width={420}
      height={360}
      viewBox="-210 -320 420 360"
      style={{
        position: 'absolute',
        left: state.x - 210 * s,
        top: state.y - 320 * s,
        width: 420 * s,
        height: 360 * s,
        opacity: state.opacity,
        overflow: 'visible',
      }}
    >
      <g transform={`scale(${state.facing}, 1)`} stroke={INK} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round">
        {/* ground contact shadow; fades while airborne */}
        <ellipse cx={4} cy={0} rx={56 * (1 - pose.airborne * 0.45)} ry={7} fill={INK} opacity={0.1 * (1 - pose.airborne * 0.6)} stroke="none" />

        {/* tail: the balance counterweight */}
        <g transform={`rotate(${-pose.tail} -22 -48)`}>
          <path d="M -20 -62 C -66 -54 -110 -34 -146 -10 C -151 -6 -146 1 -139 -2 C -104 -16 -64 -27 -16 -34 Z" fill={FUR} />
        </g>

        {/* far foot */}
        <g transform={`rotate(${footTuck} -16 -8)`}>
          <path d="M -36 -6 L 30 -6 Q 40 -8 34 -13 L -26 -17 Z" fill={FUR_FAR} />
        </g>

        {/* haunch */}
        <ellipse cx={-4} cy={-52 + crouchDrop * 0.7} rx={41} ry={46 - pose.crouch * 6} fill={FUR} />

        {/* near foot */}
        <g transform={`rotate(${footTuck} -22 -4)`}>
          <path d="M -28 -2 L 48 -2 Q 59 -4 52 -11 L -18 -15 Z" fill={FUR} />
        </g>

        {/* body, belly, and the guide's strap with a terracotta trail tag */}
        <g transform={`rotate(${pose.lean} 0 -60)`}>
          <ellipse cx={8} cy={-118 + crouchDrop} rx={44} ry={66} fill={FUR} />
          <ellipse cx={26} cy={-104 + crouchDrop} rx={19} ry={42} fill={BELLY} strokeWidth={1.4} />
          <path d={`M -22 ${-166 + crouchDrop} L 44 ${-88 + crouchDrop}`} fill="none" strokeWidth={4} />
          <rect x={30} y={-104 + crouchDrop} width={11} height={15} rx={1} fill={TAG} strokeWidth={1.4} />

          {/* forearm: pointing reaches forward, presenting lifts */}
          <g transform={`translate(34 ${-148 + crouchDrop}) rotate(${armAngle})`}>
            <rect x={0} y={-6.5} width={46} height={13} rx={6.5} fill={FUR} />
            <circle cx={46} cy={0} r={7.5} fill={FUR} />
          </g>

          {/* head */}
          <g transform={`translate(30 ${-188 + crouchDrop * 1.1}) rotate(${pose.headTilt + gaze.y * 4})`}>
            <g transform={`rotate(${-14 - expr.earSpread - expr.earPerk * 0.4} -12 -22)`}>
              <ellipse cx={-14} cy={-50} rx={10} ry={34} fill={FUR_FAR} />
            </g>
            <g transform={`rotate(${expr.earSpread * 0.6 - expr.earPerk + expr.asym * 12} 4 -26)`}>
              <ellipse cx={4} cy={-58} rx={11.5} ry={38} fill={FUR} />
              <ellipse cx={5} cy={-56} rx={5} ry={25} fill={INNER_EAR} strokeWidth={1.2} />
            </g>
            <circle cx={0} cy={0} r={32} fill={FUR} />
            <ellipse cx={30} cy={10} rx={26} ry={17} fill={FUR} />
            <ellipse cx={33} cy={17} rx={13} ry={6} fill={BELLY} stroke="none" />
            <ellipse cx={54} cy={4} rx={6.5} ry={5} fill={INK} />
            {mouth === 'OPEN' ? (
              <ellipse cx={42} cy={21} rx={4.6} ry={4.4} fill={INK} strokeWidth={1} />
            ) : mouth === 'SMALL' ? (
              <ellipse cx={42} cy={20.5} rx={3.8} ry={2.2} fill={INK} strokeWidth={1} />
            ) : (
              <path d={`M 35 ${20 - expr.smile * 2} Q 42 ${20 + expr.smile * 4} 49 ${19 - expr.smile * 2}`} fill="none" strokeWidth={1.8} />
            )}
            {eye(-6 + gaze.x * 2, -5 + gaze.y * 2, 4.4, 6, 'ww-eye-far')}
            {eye(15 + gaze.x * 3, -7 + gaze.y * 2.5, 5.8, 7.2, 'ww-eye-near')}
            <g transform={`rotate(${-expr.brow - expr.asym * 9} 15 -19)`}>
              <path d="M 8 -19 L 23 -20" fill="none" strokeWidth={2} />
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
};
