// WalletWallaby as WalletWallrus's sibling, measured on the pinned Rive runtime in the canonical poses
// (idle, crouch, flight, landing, perch, inspect) and every other pose clip:
// A. the brick belly is present, integrated (inside the body's own silhouette, skinned to the torso so
//    it deforms with it), and a belly, not a whole-body texture;
// B. the tail, the signature feature, stays long and visible behind the body in every pose;
// C. (test/rive-rig.test.ts) the drawn character never overlaps protected text or leaves title-safe;
// D. (test/rive-rig.test.ts) every frame is posed fresh and shuffled evaluation is bit-identical;
// E. no geometry disappears: every shape keeps its area (or length) in every pose, and every
//    silhouette part keeps its ink underlay.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { RIG_PALETTE } from '../src/character/walletwallaby/rig.ts';
import { withFreshPose } from '../src/character/walletwallaby/rive/rig-apply.ts';
import { outlinePoints, type PosedTransforms } from '../src/character/walletwallaby/rive/rig-bounds.ts';
import { rigControls } from '../src/character/walletwallaby/rive/rig-controls.ts';
import type { Vec } from '../src/character/walletwallaby/rive/rig-math.ts';
import { POSE_CLIPS, RIG_BONES, RIG_CONTROLS, SHAPES, SILHOUETTE_PARTS, type PoseClip, type RigBone, type RigControl } from '../src/character/walletwallaby/rive/rig-source.ts';
import { clipState } from '../src/remotion/review/review-states.ts';
import { loadRig, type LoadedRig } from './rive-runtime.ts';

/** The poses the brief names, by the clip that holds each. */
const CANONICAL: Record<string, PoseClip[]> = { idle: ['idle_alert'], crouch: ['crouch_preload'], flight: ['airborne'], landing: ['land_soft', 'land_hard'], perch: ['perch'], inspect: ['inspect'] };

interface Posed {
  shape: string;
  closed: boolean;
  pts: Vec[];
}

/** Every outline of the rig posed in one clip on the runtime, in rig space. */
function posed(rig: LoadedRig, clip: PoseClip): Posed[] {
  const { rive, file, model } = rig;
  return withFreshPose(rive, file, model, rigControls(clipState(clip, { x: 0, y: 0, scale: 1 })), ({ player }) => {
    const t: PosedTransforms = {
      bones: Object.fromEntries(RIG_BONES.map((b) => [b, player.boneWorld(b)])) as Record<RigBone, ReturnType<typeof player.boneWorld>>,
      controls: Object.fromEntries(RIG_CONTROLS.map((c) => [c, player.controlWorld(c)])) as Record<RigControl, ReturnType<typeof player.controlWorld>>,
    };
    return model.outlines.map((o) => ({ shape: o.shape, closed: o.closed, pts: outlinePoints(model, o, t) }));
  });
}

const area = (pts: Vec[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
};
const length = (pts: Vec[]): number => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
const size = (o: Posed): number => (o.closed ? area(o.pts) : length(o.pts));
const inside = (p: Vec, poly: Vec[]): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** Distance from a point to a closed polygon's outline. */
const toOutline = (p: Vec, poly: Vec[]): number => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
};
const bbox = (pts: Vec[]) => pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), y0: Math.min(b.y0, y), y1: Math.max(b.y1, y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
const of = (all: Posed[], shape: string): Posed[] => all.filter((o) => o.shape === shape);

describe('brand identity: WalletWallrus\'s sibling', () => {
  test('A. the brick belly is present in every pose, inside the body\'s own silhouette, and a belly, not a texture', async () => {
    const rig = await loadRig();
    const belly = rig.model.outlines.filter((o) => o.shape === 'brick_belly');
    assert.ok(belly.length >= 6, `a flank line, bed joints, and head joints (${belly.length} strokes)`);
    assert.ok(belly.every((o) => o.skinned), 'skinned to the torso: the mortar deforms with the body, never a rigid plate');
    const order = SHAPES.map((s) => s.name);
    assert.ok(order.indexOf('torso') < order.indexOf('brick_belly') && order.indexOf('brick_belly') < order.indexOf('thigh_n'), 'drawn on the torso, under the near leg: part of the body');
    const brick = SHAPES.find((s) => s.name === 'brick_belly')!;
    assert.ok(brick.stroke && !brick.fill && RIG_PALETTE[brick.stroke.slot] === 'charcoal', 'charcoal mortar on the terracotta coat, as on WalletWallrus: no glued-on plate');
    for (const [name, clips] of Object.entries(CANONICAL)) {
      for (const clip of clips) {
        const all = posed(rig, clip);
        const torso = of(all, 'torso')[0]!.pts;
        const mortar = of(all, 'brick_belly').flatMap((o) => o.pts);
        // Every mortar point lies inside the torso, or on its outline under the silhouette's ink.
        for (const p of mortar) assert.ok(inside(p, torso) || toOutline(p, torso) <= 3, `${name} (${clip}): mortar at (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) leaves the body`);
        const b = bbox(mortar);
        const t = bbox(torso);
        const share = ((b.x1 - b.x0) * (b.y1 - b.y0)) / ((t.x1 - t.x0) * (t.y1 - t.y0));
        assert.ok(share > 0.2 && share < 0.45, `${name} (${clip}): the brick field covers ${(share * 100).toFixed(1)}% of the torso box: a belly, neither a token nor the whole body`);
        assert.ok(b.y1 - b.y0 > 40, `${name} (${clip}): at least four courses tall (${(b.y1 - b.y0).toFixed(1)} px)`);
      }
    }
  });

  test('B. the tail stays long and visible behind the body in idle, crouch, flight, landing, perch, and inspect', async () => {
    const rig = await loadRig();
    for (const [name, clips] of Object.entries(CANONICAL)) {
      for (const clip of clips) {
        const all = posed(rig, clip);
        const torso = of(all, 'torso')[0]!.pts;
        const tail = of(all, 'tail')[0]!.pts;
        const tb = bbox(tail);
        const ob = bbox(torso);
        const span = Math.hypot(tb.x1 - tb.x0, tb.y1 - tb.y0);
        const visible = tail.filter((p) => !inside(p, torso)).length / tail.length;
        assert.ok(span > 170, `${name} (${clip}): tail span ${span.toFixed(1)} px`);
        assert.ok(span > 1.2 * (ob.y1 - ob.y0), `${name} (${clip}): the tail outreaches the body (${span.toFixed(1)} vs ${(ob.y1 - ob.y0).toFixed(1)})`);
        assert.ok(ob.x0 - tb.x0 > 120, `${name} (${clip}): the tip reaches ${(ob.x0 - tb.x0).toFixed(1)} px behind the body`);
        assert.ok(visible > 0.8, `${name} (${clip}): ${(visible * 100).toFixed(1)}% of the tail outline is outside the body`);
      }
    }
  });

  test('E. no geometry disappears: every shape keeps its area or length in every pose clip, and every silhouette part keeps its underlay', async () => {
    const rig = await loadRig();
    const rest = posed(rig, 'idle_alert');
    for (const clip of POSE_CLIPS) {
      const all = posed(rig, clip);
      assert.equal(all.length, rest.length);
      all.forEach((o, i) => {
        if (o.shape === 'shadow') return;
        for (const [x, y] of o.pts) assert.ok(Number.isFinite(x) && Number.isFinite(y), `${clip} ${o.shape}: finite`);
        const kept = size(o) / size(rest[i]!);
        assert.ok(kept > 0.8, `${clip} ${o.shape} keeps ${(kept * 100).toFixed(1)}% of its ${o.closed ? 'area' : 'length'}`);
      });
    }
    // The single outer contour: every silhouette part has an ink underlay drawn before any fill.
    const names = SHAPES.map((s) => s.name);
    const firstFill = names.findIndex((n) => !n.endsWith('_ink') && n !== 'shadow');
    for (const part of SILHOUETTE_PARTS) {
      const k = names.indexOf(`${part}_ink`);
      assert.ok(k >= 0 && k < firstFill, `${part} has its underlay behind every fill`);
    }
    // Positive control: the retention check catches a collapsed shape (the torso flattened onto a line).
    const torso = rest.find((o) => o.shape === 'torso')!;
    assert.ok(size({ ...torso, pts: torso.pts.map(([x]) => [x, 0] as Vec) }) / size(torso) < 0.8);
  });
});
