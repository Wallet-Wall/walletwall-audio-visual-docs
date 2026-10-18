// Building blocks shared by every scene: positioned text, platforms, the ground
// line, masonry courses, and attention / resolution treatments.

import React from 'react';
import { TOKENS } from '../../brand/tokens.ts';
import { GROUND_Y, type Rect } from '../../layout/geometry.ts';
import type { SceneLayout, TextRegion } from '../../layout/scene-layout.ts';
import type { TimedSegment } from '../../timeline/timeline.ts';
import { HAIRLINE, rectStyle, settle, textStyle } from '../style.ts';

export interface SceneState {
  ms: number;
  seg: TimedSegment;
  layout: SceneLayout;
  /** Elements the guide is currently directing attention to. */
  attention: Set<string>;
  /** Elements a RESOLVE beat has settled. */
  resolved: Set<string>;
  /** Route id -> traced fraction 0..1. */
  traced: Record<string, number>;
  /** Platform id -> downward contact displacement in px (a few px at most, returning to 0). */
  platformDip: Record<string, number>;
}

/**
 * Translate a platform and everything printed on it by its contact displacement,
 * composed after any existing transform (e.g. a reveal's settle).
 */
export function dipStyle(state: SceneState, platformId: string, base = 'none'): React.CSSProperties {
  const dy = Math.round((state.platformDip[platformId] ?? 0) * 100) / 100;
  if (dy === 0) return base === 'none' ? {} : { transform: base };
  return { transform: `${base === 'none' ? '' : `${base} `}translateY(${dy}px)` };
}

export function regionFor(layout: SceneLayout, elementId: string): TextRegion | undefined {
  return layout.texts.find((t) => t.elementId === elementId);
}

export const TextAt: React.FC<{ region: TextRegion | undefined; state: SceneState; color?: string }> = ({ region, state, color }) => {
  if (!region) return null;
  const reveal = settle(state.ms, state.seg.reveals[region.elementId]);
  return (
    <div style={{ ...rectStyle(region.rect), ...textStyle(region.styleKey, region.mono), ...(color ? { color } : {}), ...reveal }}>{region.text}</div>
  );
};

/** Attention: a quiet terracotta wash and rule behind the element, never a glow. */
export const Attention: React.FC<{ rect: Rect | undefined; on: boolean; resolved: boolean }> = ({ rect, on, resolved }) => {
  if (!rect || (!on && !resolved)) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x - 16,
        top: rect.y - 8,
        width: rect.w + 24,
        height: rect.h + 16,
        background: on ? TOKENS.accentWash(0.07) : 'transparent',
        borderLeft: `${resolved ? 4 : 3}px solid ${resolved ? TOKENS.terracotta : TOKENS.accentWash(0.55)}`,
      }}
    />
  );
};

/** The ground line, edge to edge unless a template draws only a stretch of it. */
export const Ground: React.FC<{ x0?: number; x1?: number }> = ({ x0 = 0, x1 = 1920 }) => (
  <div style={{ position: 'absolute', left: x0, top: GROUND_Y, width: x1 - x0, height: 1, background: TOKENS.charcoalRail }} />
);

/** A raised card / platform with WalletWall's fine border and 2px corners. */
export const Platform: React.FC<{ rect: Rect; style?: React.CSSProperties; children?: React.ReactNode }> = ({ rect, style, children }) => (
  <div
    style={{
      ...rectStyle(rect),
      background: TOKENS.surface,
      border: HAIRLINE,
      borderTop: `2px solid ${TOKENS.charcoalBorder}`,
      borderRadius: TOKENS.radiusPanel,
      boxShadow: `0 1px 2px ${TOKENS.inkAlpha(0.05)}`,
      ...style,
    }}
  >
    {children}
  </div>
);

/** Masonry courses for pillars and ledges: the brand's brick language, kept faint. */
export const Masonry: React.FC<{ rect: Rect; course?: number }> = ({ rect, course = 26 }) => {
  const rows = Math.max(1, Math.floor(rect.h / course));
  return (
    <svg style={{ ...rectStyle(rect), overflow: 'hidden' }} viewBox={`0 0 ${rect.w} ${rect.h}`}>
      <rect x={0} y={0} width={rect.w} height={rect.h} fill={TOKENS.stone} opacity={0.42} stroke={TOKENS.charcoalBorder} />
      {Array.from({ length: rows }, (_, r) => (
        <g key={r} stroke={TOKENS.stoneLow} strokeWidth={1} opacity={0.5}>
          <line x1={0} y1={(r + 1) * course} x2={rect.w} y2={(r + 1) * course} />
          {Array.from({ length: Math.ceil(rect.w / 64) + 1 }, (_, c) => {
            const x = c * 64 + (r % 2 ? 32 : 0);
            return <line key={c} x1={x} y1={r * course} x2={x} y2={(r + 1) * course} />;
          })}
        </g>
      ))}
    </svg>
  );
};

/** Small terracotta brick used as a list marker (the brand's bullet, never a dot). */
export const BrickMarker: React.FC<{ x: number; y: number; opacity: number }> = ({ x, y, opacity }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 12, height: 7, background: TOKENS.terracotta, opacity, borderRadius: 1 }} />
);
