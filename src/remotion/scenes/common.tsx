// Building blocks shared by every scene: positioned text, platforms, the ground
// line, masonry courses, and the attention / resolution treatments.

import React from 'react';
import type { SceneDirection } from '../../attention/direction.ts';
import { TOKENS } from '../../brand/tokens.ts';
import type { Rect } from '../../layout/geometry.ts';
import type { SceneLayout, TextRegion } from '../../layout/scene-layout.ts';
import type { TimedSegment } from '../../timeline/timeline.ts';
import { useMaterial } from '../material.tsx';
import { HAIRLINE, rectStyle, settle, textStyle } from '../style.ts';

export interface SceneState {
  ms: number;
  seg: TimedSegment;
  layout: SceneLayout;
  /** Where the viewer's eye is being guided (src/attention/direction.ts): the mode, the subjects, and every element's eased emphasis. */
  direction: SceneDirection;
  /** How long a route takes to draw on from its source to its destination (the route entrance). */
  routeDrawMs: number;
  /** Route id -> traced fraction 0..1. */
  traced: Record<string, number>;
  /** Platform id -> downward contact displacement in px (a few px at most, returning to 0). */
  platformDip: Record<string, number>;
}

/** The eased opacity multiplier attention direction gives an element (1 = untouched). */
export const emphasisOf = (state: SceneState, elementId: string): number => state.direction.emphasis[elementId] ?? 1;

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

/** An opacity style only when it is not 1, so an untouched element renders exactly as it always has. */
export const opacityStyle = (opacity: number): React.CSSProperties => (opacity >= 1 ? {} : { opacity });

export const TextAt: React.FC<{ region: TextRegion | undefined; state: SceneState; color?: string }> = ({ region, state, color }) => {
  const m = useMaterial();
  if (!region) return null;
  const reveal = settle(state.ms, state.seg.reveals[region.elementId]);
  const opacity = reveal.opacity * emphasisOf(state, region.elementId);
  return (
    <div style={{ ...rectStyle(region.rect), ...textStyle(region.styleKey, region.mono, color ?? m.flat.text.ink), ...reveal, opacity }}>{region.text}</div>
  );
};

/**
 * Attention: a quiet terracotta wash and rule behind the element, never a glow. `wash` (0..1) is the guide /
 * inspect strength of the wash and its 3px rule; `resolved` (0..1) the strength of the heavier terracotta rule a
 * RESOLVE beat leaves behind. Both ease in and out; at full strength the drawing is exactly the accepted treatment.
 */
export const Attention: React.FC<{ rect: Rect | undefined; wash: number; resolved: number }> = ({ rect, wash, resolved }) => {
  if (!rect || (wash <= 0 && resolved <= 0)) return null;
  const box: React.CSSProperties = { position: 'absolute', left: rect.x - 16, top: rect.y - 8, width: rect.w + 24, height: rect.h + 16 };
  return (
    <>
      {wash > 0 ? <div style={{ ...box, background: TOKENS.accentWash(0.07), borderLeft: `3px solid ${TOKENS.accentWash(0.55)}`, ...opacityStyle(wash) }} /> : null}
      {resolved > 0 ? <div style={{ ...box, borderLeft: `4px solid ${TOKENS.terracotta}`, ...opacityStyle(resolved) }} /> : null}
    </>
  );
};

/** A node's focus: its top edge in terracotta (the platform's rule), easing in and out with the guide's attention. */
export const FocusRule: React.FC<{ rect: Rect; strength: number }> = ({ rect, strength }) => {
  if (strength <= 0) return null;
  return <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w + 2, height: 3, background: TOKENS.terracotta, borderRadius: `${TOKENS.radiusPanel}px ${TOKENS.radiusPanel}px 0 0`, ...opacityStyle(strength) }} />;
};

/** A raised card / platform with WalletWall's fine border and 2px corners, in the warm parchment of the material rule (never white). */
export const Platform: React.FC<{ rect: Rect; style?: React.CSSProperties; children?: React.ReactNode }> = ({ rect, style, children }) => {
  const m = useMaterial();
  return (
  <div
    style={{
      ...rectStyle(rect),
      background: m.flat.surface,
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
};

/** Small terracotta brick used as a list marker (the brand's bullet, never a dot). */
export const BrickMarker: React.FC<{ x: number; y: number; opacity: number }> = ({ x, y, opacity }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 12, height: 7, background: TOKENS.terracotta, opacity, borderRadius: 1 }} />
);
