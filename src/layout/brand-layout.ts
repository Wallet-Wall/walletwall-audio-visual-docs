// Fixed geometry for brand segments (the canonical page and the end screen).
// These are WalletWall-owned templates; nothing here is planner input.
// Isomorphic.

import type { Rect } from './geometry.ts';

export const DOCS_CARD: Rect = { x: 160, y: 290, w: 1220, h: 470 };
export const END_SCREEN_LABEL: Rect = { x: 160, y: 140, w: 900, h: 40 };

/**
 * Zones YouTube end-screen elements are placed into (by a reviewer in YouTube
 * Studio; the Data API cannot set them). The renderer leaves them visually empty.
 */
export const END_SCREEN_ZONES: Record<string, Rect> = {
  'endscreen:video-a': { x: 160, y: 300, w: 720, h: 405 },
  'endscreen:video-b': { x: 1040, y: 300, w: 720, h: 405 },
  'endscreen:subscribe': { x: 850, y: 760, w: 220, h: 220 },
};

/** Provenance chip: top-right, on the eyebrow row, clear of captions and player chrome. */
export const PROVENANCE_CHIP: Rect = { x: 1000, y: 106, w: 760, h: 24 };

/**
 * The ground each brand template draws (at the scene ground line), as the horizontal extent of the
 * line: WalletWallaby's terrain in that segment. The end screen draws only the stretch right of the
 * subscribe zone, so the zones YouTube fills stay empty.
 */
export const BRAND_GROUND = {
  DOCS_REFERENCE: { x0: 0, x1: 1920 },
  END_SCREEN: { x0: 1100, x1: 1920 },
} as const satisfies Record<string, { x0: number; x1: number }>;
