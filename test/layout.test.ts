// Layout invariants for every scene grammar at its maximum capacity: text stays
// inside the YouTube title-safe area and above the player chrome, and
// WalletWallaby can stand at every anchor without covering any text.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { END_SCREEN_ZONES, PROVENANCE_CHIP } from '../src/layout/brand-layout.ts';
import { CONTENT_BOTTOM, inside, intersects, TITLE_SAFE } from '../src/layout/geometry.ts';
import { eyebrowOccupied, layoutScene, wallabyBounds, type SceneLayout } from '../src/layout/scene-layout.ts';
import { estimateWidth, fitText } from '../src/layout/text-fit.ts';
import type { SceneSpec, VisualText } from '../src/spec/types.ts';

const vt = (id: string, text = 'Placeholder text of moderate length'): VisualText => ({ id, text, claimIds: ['c'] });
const LONG_EYEBROW = 'How recommendations should be interpreted';

const MAX_SCENES: Record<string, SceneSpec> = {
  'card-stack': { type: 'CARD', plane: 'SURFACE', eyebrowSectionId: 's', layout: 'STACK', heading: vt('h'), body: [vt('a'), vt('b'), vt('c')] },
  'card-split': { type: 'CARD', plane: 'SURFACE', eyebrowSectionId: 's', layout: 'SPLIT', heading: vt('h'), body: [vt('a'), vt('b')] },
  ...Object.fromEntries(
    [2, 3, 4, 5].flatMap((n) =>
      (['ROUTE', 'ASCENDING_ROUTE'] as const).map((layout) => [
        `graph-${layout}-${n}`,
        {
          type: 'GRAPH',
          plane: 'SURFACE',
          eyebrowSectionId: 's',
          layout,
          caption: vt('cap'),
          nodes: Array.from({ length: n }, (_, i) => ({ ...vt(`n${i}`, 'Label'), detail: vt(`d${i}`, 'Short detail') })),
          edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, claimIds: ['c'] })),
        } satisfies SceneSpec,
      ]),
    ),
  ),
  layered: {
    type: 'GRAPH',
    plane: 'DEPTH',
    eyebrowSectionId: 's',
    layout: 'LAYERED',
    caption: vt('cap'),
    nodes: [
      { ...vt('top', 'Result'), layer: 'UPPER', detail: vt('td', 'Detail') },
      ...Array.from({ length: 4 }, (_, i) => ({ ...vt(`l${i}`, 'Signal'), layer: 'LOWER' as const })),
    ],
    edges: Array.from({ length: 4 }, (_, i) => ({ from: `l${i}`, to: 'top', claimIds: ['c'] })),
  },
  takeaway: { type: 'TAKEAWAY', plane: 'SURFACE', eyebrowSectionId: 's', statement: vt('st'), support: [vt('a'), vt('b')] },
  ui: { type: 'UI', plane: 'SURFACE', eyebrowSectionId: 's', assetId: 'x', caption: vt('cap') },
};

function protectedRects(layout: SceneLayout) {
  return [eyebrowOccupied(LONG_EYEBROW), PROVENANCE_CHIP, ...layout.texts.filter((t) => t.elementId !== 'eyebrow').map((t) => t.rect)];
}

describe('scene layouts', () => {
  for (const [name, scene] of Object.entries(MAX_SCENES)) {
    test(`${name}: every text region is title-safe and above the player chrome`, () => {
      const layout = layoutScene(scene, LONG_EYEBROW);
      for (const t of layout.texts) {
        assert.ok(inside(t.rect, TITLE_SAFE), `${t.elementId} outside title-safe: ${JSON.stringify(t.rect)}`);
        assert.ok(t.rect.y + t.rect.h <= CONTENT_BOTTOM, `${t.elementId} below the content line`);
      }
    });

    test(`${name}: WalletWallaby never covers text at any anchor`, () => {
      const layout = layoutScene(scene, LONG_EYEBROW);
      for (const [id, a] of Object.entries(layout.anchors)) {
        if (id.startsWith('edge:')) continue; // routes are traversed, not rested on
        const box = wallabyBounds(a.stand, a.scale);
        for (const r of protectedRects(layout)) assert.ok(!intersects(box, r), `${name} anchor ${id} covers ${JSON.stringify(r)}`);
        assert.ok(box.y >= 0 && box.x + box.w <= 1920, `${name} anchor ${id} leaves the frame`);
      }
    });
  }

  test('text regions never overlap each other', () => {
    for (const [name, scene] of Object.entries(MAX_SCENES)) {
      const texts = layoutScene(scene, LONG_EYEBROW).texts;
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) assert.ok(!intersects(texts[i]!.rect, texts[j]!.rect), `${name}: ${texts[i]!.elementId} / ${texts[j]!.elementId}`);
      }
    }
  });

  test('end-screen zones are title-safe and clear of the guide', () => {
    for (const r of Object.values(END_SCREEN_ZONES)) assert.ok(inside(r, TITLE_SAFE));
    const guide = wallabyBounds({ x: 1700, y: 1010 }, 0.5);
    for (const r of Object.values(END_SCREEN_ZONES)) assert.ok(!intersects(guide, r));
  });
});

describe('text fit estimation', () => {
  test('monospace width is exact (0.6em per glyph)', () => {
    assert.equal(estimateWidth('0123456789', { font: 'mono', size: 20, weight: 500, lineHeight: 1.2 }), 120);
  });
  test('wraps by words and reports overflow and unbreakable words', () => {
    const box = { maxWidth: 300, maxLines: 2, style: { font: 'ui' as const, size: 30, weight: 500, lineHeight: 1.3 } };
    assert.equal(fitText('short', box).fits, true);
    assert.equal(fitText('a much longer sentence that will need several lines to fit at all', box).fits, false);
    assert.equal(fitText('Supercalifragilisticexpialidocious', box).overlongWord, 'Supercalifragilisticexpialidocious');
  });
});
