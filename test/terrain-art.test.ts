// The flat scenes' terrain family, and the guarantee that makes it safe: a formation is cut
// INSIDE its support's declared rectangle, its top edge and contact faces stay on the declared
// coordinates, only dedicated physical supports are cut, and the declared terrain itself is
// byte-for-byte what it was before any of it existed (the pin below is main's).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { loadVisualConfig } from '../src/blender/visual.ts';
import { layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress } from '../src/core/hash.ts';
import { GROUND_Y, type Rect } from '../src/layout/geometry.ts';
import { rockLayers, unit, type Rock, type RockKindParams } from '../src/layout/rock.ts';
import { SUMMIT_LEDGE } from '../src/layout/scene-layout.ts';
import { terrainsFor } from '../src/layout/terrain.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

const visual = loadVisualConfig();
const strata = visual.terrain.strata;
const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');

/** What the contract promises, checked on a cut: returns the first violation, or null. */
function violation(rect: Rect, rock: Rock, p: RockKindParams): string | null {
  const { layers } = rock;
  if (layers.length === 0) return 'no layers';
  if (layers[0]!.top !== 0) return `the top is at ${layers[0]!.top}, not the declared top`;
  if (layers.at(-1)!.bottom !== rect.h) return 'the layers do not reach the declared bottom';
  const zone = Math.min(p.contactZonePx, rect.h);
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (i > 0 && l.top !== layers[i - 1]!.bottom) return `layer ${i} does not meet the one above`;
    if (l.cap && (l.left.top !== 0 || l.right.top !== 0)) return 'the cap is not flush with the declared top';
    for (const v of [l.left.top, l.left.bottom, l.right.top, l.right.bottom]) if (v < 0 || v > rect.w / 2) return `layer ${i} leaves the rectangle`;
    if (l.top < zone && l.bottom > zone) return `layer ${i} straddles the contact zone`;
    // Inside the contact zone a side stays within the jitter of the declared face (no taper yet).
    if (l.bottom <= zone) for (const v of [l.left.top, l.left.bottom, l.right.top, l.right.bottom]) if (v > p.sideJitterPx + 1e-9) return `layer ${i}: a contact face strays ${v.toFixed(2)} px`;
  }
  for (const [x, y] of rock.lowerEdge) if (x < 0 || x > rect.w || y < rect.h - p.fractureMaxPx - 1e-9 || y > rect.h) return 'the broken lower edge leaves its band';
  return null;
}

describe('a formation never moves what the motion system stands on', () => {
  test('a cut is deterministic, and keyed by the support\'s own id', () => {
    const rect: Rect = { x: 100, y: 300, w: 200, h: 280 };
    const p = visual.flat.pillar;
    const a = rockLayers(rect, 'pillar:node:x', p, strata.layers.length, strata.seed);
    assert.deepEqual(a, rockLayers(rect, 'pillar:node:x', p, strata.layers.length, strata.seed));
    assert.notDeepEqual(a, rockLayers(rect, 'pillar:node:y', p, strata.layers.length, strata.seed), 'another support is another rock');
    for (let i = 0; i < 50; i++) assert.ok(unit('s', 'k', i) >= 0 && unit('s', 'k', i) < 1);
  });

  test('every real support is cut inside its rectangle: top flush, contact faces on the declared line (positive control: a bad cut is caught)', () => {
    let cut = 0;
    for (const layout of layouts.values()) {
      for (const pl of layout.platforms) {
        if (pl.kind !== 'PILLAR' && pl.kind !== 'LEDGE') continue;
        const kind = pl.kind === 'PILLAR' ? 'pillar' : 'ledge';
        const p = visual.flat[kind];
        const rock = rockLayers(pl.rect, `${kind}:${pl.id}`, p, strata.layers.length, strata.seed);
        assert.equal(violation(pl.rect, rock, p), null, pl.id);
        cut++;
      }
    }
    assert.ok(cut >= 4, `${cut} supports cut`);
    // The summit ledge by its own rectangle, and the ground's band under its line.
    const ledge = rockLayers(SUMMIT_LEDGE, 'ledge:ledge', visual.flat.ledge, strata.layers.length, strata.seed);
    assert.equal(violation(SUMMIT_LEDGE, ledge, visual.flat.ledge), null);
    const g = visual.flat.ground;
    const groundRect: Rect = { x: 0, y: GROUND_Y, w: 1920, h: g.depthPx };
    assert.equal(violation(groundRect, rockLayers(groundRect, 'ground:0-1920', g, strata.layers.length, strata.seed), g), null);
    // Positive control: the same check rejects a side that strays past the contact tolerance, and a top that moved.
    const wild = { ...visual.flat.pillar, sideJitterPx: 20 };
    const r: Rect = { x: 0, y: 0, w: 200, h: 300 };
    assert.match(violation(r, rockLayers(r, 'k', wild, strata.layers.length, strata.seed), visual.flat.pillar) ?? '', /strays/);
    const moved = rockLayers(r, 'k', visual.flat.pillar, strata.layers.length, strata.seed);
    moved.layers[0]!.top = 4;
    assert.match(violation(r, moved, visual.flat.pillar) ?? '', /declared top/);
  });

  test('the ledge and the ground taper only where nothing touches: the contact zone below the top is untouched', () => {
    const p = visual.flat.ledge;
    const rock = rockLayers(SUMMIT_LEDGE, 'ledge:ledge', p, strata.layers.length, strata.seed);
    const inZone = rock.layers.filter((l) => l.bottom <= p.contactZonePx);
    assert.ok(inZone.length >= 2, 'the zone holds the cap and at least one layer');
    for (const l of inZone) for (const v of [l.left.bottom, l.right.bottom]) assert.ok(v <= p.sideJitterPx);
    const deepest = rock.layers.at(-1)!;
    assert.ok(deepest.left.bottom > p.sideJitterPx, 'below the zone the side does recede (a tapered formation)');
    assert.ok(deepest.left.bottom <= p.sideJitterPx + p.taperPx + 1e-9);
  });

  test('the declared terrain and layouts are byte-for-byte what main declares (nothing a body touches moved)', () => {
    const terrains = [...terrainsFor(timeline.segments, layouts).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    assert.equal(terrains.length, 11);
    assert.equal(contentAddress(terrains), '7a76e388b254f2b145281ae409e5df959de21e6c202d8bb37e272824a2b9f4d1');
    assert.equal(contentAddress([...layouts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))), '986d9087baffb1c727594416c64fb8ca8bd3ad55461fb132fddd02e9e4a02121');
  });
});

describe('only dedicated physical supports are terrain; cards stay cards', () => {
  const scenes = readFileSync(path.join(VIDEO_ROOT, 'src', 'remotion', 'scenes', 'SceneView.tsx'), 'utf8');
  const art = readFileSync(path.join(VIDEO_ROOT, 'src', 'remotion', 'scenes', 'terrain-art.tsx'), 'utf8');

  test('formations are cut for the pillar, the ledge, the ground, and the slabs, never for a CARD or NODE platform', () => {
    assert.match(art, /type Kind = 'ground' \| 'pillar' \| 'ledge';/);
    for (const m of scenes.matchAll(/<Formation kind="(\w+)"/g)) assert.ok(['pillar', 'ledge'].includes(m[1]!), m[1]);
    assert.ok((scenes.match(/<Formation /g) ?? []).length === 2 && scenes.includes('<RockSlab') && scenes.includes('<Ground'));
    // Cards and nodes are still Platform: parchment, text, a fine edge.
    assert.match(scenes, /<Platform rect=\{card\.rect\}/);
    assert.match(scenes, /<Platform rect=\{platform\.rect\}/);
  });

  test('the ground line itself stays exactly where it was: one px at GROUND_Y, under which the rock lies', () => {
    assert.match(art, /top: GROUND_Y, width: x1 - x0, height: 1/);
    assert.match(art, /y: GROUND_Y, w: x1 - x0, h: g\.depthPx/);
  });
});
