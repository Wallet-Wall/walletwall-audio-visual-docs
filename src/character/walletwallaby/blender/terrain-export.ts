// The declared terrain, materialised for Blender: the same surfaces the support
// judge grades (../../../layout/terrain.ts), grouped back into the solid blocks
// they belong to, so a stand that Motion Intelligence found valid on
// `node:monitor:top` lands on a `node:monitor` mesh whose top is that surface.
// Nothing here is inferred from pixels: every block is a declared element, and
// a surface the judge treats as information (a route, a UI capture's top) is
// exported as non-contact geometry or not at all. Isomorphic.

import type { Terrain, TerrainSurface } from '../../../layout/terrain.ts';

export const BLENDER_TERRAIN_SCHEMA = 'walletwall.blender-terrain/v1';

export interface BlenderTerrainBlock {
  /** The declared element: a platform id, or 'ground'. */
  element: string;
  /** Frame px: the block's front face on the teaching plane (top edge y0, bottom y1). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** What its top offers feet, and what its side faces offer a hand (null: the block has no such surface). */
  top: TerrainSurface['support'] | null;
  faces: TerrainSurface['support'] | null;
  /** The surface ids, exactly as the judge and the bridge name them. */
  surfaceIds: string[];
}

export interface BlenderTerrainSegment {
  segment: string;
  blocks: BlenderTerrainBlock[];
  /** Drawn lines that are information, never terrain: exported so a view can show them as non-contact. */
  lines: { id: string; x0: number; y0: number; x1: number; y1: number }[];
}

export interface BlenderTerrainDocument {
  schema: typeof BLENDER_TERRAIN_SCHEMA;
  segments: BlenderTerrainSegment[];
}

/** Group one segment's declared surfaces back into blocks (top + left + right share an element). */
export function terrainSegment(segment: string, terrain: Terrain): BlenderTerrainSegment {
  const blocks = new Map<string, BlenderTerrainBlock>();
  const lines: BlenderTerrainSegment['lines'] = [];
  for (const s of terrain.surfaces) {
    if (s.face === 'LINE') {
      lines.push({ id: s.id, x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 });
      continue;
    }
    let b = blocks.get(s.element);
    if (!b) {
      b = { element: s.element, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, top: null, faces: null, surfaceIds: [] };
      blocks.set(s.element, b);
    }
    b.surfaceIds.push(s.id);
    if (s.face === 'TOP') {
      b.top = s.support;
      b.x0 = Math.min(b.x0, s.x0);
      b.x1 = Math.max(b.x1, s.x1);
      b.y0 = Math.min(b.y0, s.y0);
      // A top's thickness is the block's height (the ground's is the band below the baseline).
      b.y1 = Math.max(b.y1, s.y0 + s.thicknessPx);
    } else {
      b.faces = s.support;
      b.x0 = Math.min(b.x0, s.x0);
      b.x1 = Math.max(b.x1, s.x0);
      b.y0 = Math.min(b.y0, s.y0);
      b.y1 = Math.max(b.y1, s.y1);
    }
  }
  const sorted = [...blocks.values()].sort((a, b) => (a.element < b.element ? -1 : a.element > b.element ? 1 : 0));
  for (const b of sorted) b.surfaceIds.sort();
  return { segment, blocks: sorted, lines };
}

export function blenderTerrainDocument(terrains: ReadonlyMap<string, Terrain>, segments: readonly string[]): BlenderTerrainDocument {
  return {
    schema: BLENDER_TERRAIN_SCHEMA,
    segments: segments.map((id) => {
      const t = terrains.get(id);
      return t ? terrainSegment(id, t) : { segment: id, blocks: [], lines: [] };
    }),
  };
}
