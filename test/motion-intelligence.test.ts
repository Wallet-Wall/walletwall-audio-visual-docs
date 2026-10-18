// WalletWallaby motion intelligence (motion v3): ledge mantles chosen only
// where the terrain calls for a climb and never at the cost of text clarity;
// soft versus hard landings by impact; the tail as a traversal tool in every
// phase; phases in order; velocity that matches the feet. None of it can move
// a destination.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor, type Clip } from '../src/character/walletwallaby/choreography.ts';
import { MOTION_CONFIG, planMantle, planMotion, sampleWallaby, type MotionPlan, type Surface } from '../src/character/walletwallaby/motion.ts';
import { GROUND_Y } from '../src/layout/geometry.ts';
import type { SceneLayout } from '../src/layout/scene-layout.ts';
import { LAB_CLIPS, LAB_LAYOUT, LAB_SEGMENT, labPlan } from '../src/remotion/review/motion-lab-scene.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const plan = planMotion(choreograph(timeline, layouts), layouts);
const lab = labPlan();

const ledge: Surface = { id: 'ledge', kind: 'LEDGE', x0: 1060, x1: 1390 };
const climb = { from: { x: 300, y: GROUND_Y }, to: { x: 1170, y: 560 }, fromScale: 1, toScale: 1, startMs: 1100, endMs: 2000, platform: ledge };

const samples = (p: MotionPlan, from: number, to: number, step = 5) => {
  const out: { ms: number; s: ReturnType<typeof sampleWallaby> }[] = [];
  for (let ms = from; ms < to; ms += step) out.push({ ms, s: sampleWallaby(p, ms) });
  return out;
};

describe('mantle', () => {
  test('climbs onto a ledge from beside it, and the climb ends exactly on the authored anchor', () => {
    const m = planMantle(climb);
    assert.ok(m, 'eligible');
    assert.equal(m.side, -1, 'climbs the left face when arriving from the left');
    assert.ok(m.takeoffMs < m.grabMs && m.grabMs < m.pullMs && m.pullMs < m.topMs && m.topMs <= climb.endMs);
    const i = lab.clips.findIndex((c) => c.kind === 'TRAVEL' && c.to.y === 560);
    assert.equal(lab.motions[i]!.kind, 'MANTLE', 'the planner chose the mantle');
    const c = lab.clips[i]!;
    const end = sampleWallaby(lab, c.endMs - 0.001);
    assert.equal(end.x, c.to.x);
    assert.equal(end.y - end.motion.platformDip, c.to.y);
    const landing = lab.events.find((e) => e.kind === 'LANDING' && e.segmentId === LAB_SEGMENT && e.at.y === 560)!;
    assert.deepEqual(landing.at, c.to, 'the landing is the authored anchor');
    assert.equal(lab.clips, LAB_CLIPS, 'the clips are read, never rewritten');
  });

  test('the forelimbs hold the lip only from the reach to the end of the pull', () => {
    const i = lab.clips.findIndex((c) => c.kind === 'TRAVEL' && c.to.y === 560);
    const c = lab.clips[i]!;
    const m = lab.motions[i]!;
    assert.equal(m.kind, 'MANTLE');
    if (m.kind !== 'MANTLE') return;
    for (const { s } of samples(lab, c.startMs, c.endMs)) {
      const holding = s.motion.phase === 'REACH' || s.motion.phase === 'HANG' || s.motion.phase === 'PULL';
      assert.equal(s.motion.grip !== null, holding && s.motion.action !== 'HOP', `${s.motion.action}/${s.motion.phase}`);
      if (s.motion.grip) assert.deepEqual(s.motion.grip, m.corner);
    }
  });

  test('is refused where the terrain or the window does not call for it (positive controls)', () => {
    assert.ok(planMantle(climb), 'control');
    const refused: [string, Partial<typeof climb>][] = [
      ['a UI capture is not terrain', { platform: { ...ledge, kind: 'FRAME' } }],
      ['too small a rise', { from: { x: 300, y: 600 } }],
      ['starting on top of the platform', { from: { x: 1300, y: 560 } }],
      ['starting under the platform, with no face to climb', { from: { x: 1200, y: GROUND_Y } }],
      ['a destination off the platform', { to: { x: 1500, y: 560 } }],
      ['a scale change (depth) mid-climb', { toScale: 0.8 }],
      ['a window too short to climb', { endMs: 1500 }],
      ['too far to jump at the speed limit', { from: { x: -2200, y: GROUND_Y } }],
    ];
    for (const [name, patch] of refused) assert.equal(planMantle({ ...climb, ...patch }), null, name);
  });

  test('never adds text crossings: with text over the face, the hop wins', () => {
    const textOverFace: SceneLayout = { ...LAB_LAYOUT, texts: [{ elementId: 't', text: 'x', rect: { x: 700, y: 560, w: 340, h: 200 }, box: {} as never, styleKey: 'cardBody', mono: false }] };
    const alt = planMotion(LAB_CLIPS, new Map([[LAB_SEGMENT, textOverFace]]));
    const i = alt.clips.findIndex((c) => c.kind === 'TRAVEL' && c.to.y === 560);
    assert.equal(alt.motions[i]!.kind, 'HOP');
  });

  test('the committed lesson keeps its hops: no ledge there can be climbed without crossing text', () => {
    assert.ok(!plan.motions.some((m) => m.kind === 'MANTLE'));
  });
});

describe('landings', () => {
  test('a hard landing compresses deeper and braces, a soft one barely bends', () => {
    const hard = plan.events.find((e) => e.kind === 'LANDING' && e.impulse >= 0.99)!;
    const soft = plan.events.find((e) => e.kind === 'LANDING' && e.impulse <= 0.3)!;
    assert.ok(hard && soft);
    const at = (e: typeof hard) => sampleWallaby(plan, e.atMs + 40);
    const h = at(hard);
    const s = at(soft);
    assert.ok((h.pose.mix.land_hard ?? 0) > 0.5, `hard landing pose ${JSON.stringify(h.pose.mix)}`);
    assert.ok((s.pose.mix.land_hard ?? 0) === 0, `soft landing pose ${JSON.stringify(s.pose.mix)}`);
    assert.ok(h.pose.crouch > s.pose.crouch, 'deeper compression');
    assert.ok(h.motion.tail.tension > s.motion.tail.tension && h.motion.tail.swing < s.motion.tail.swing, 'the tail braces');
    assert.ok(h.motion.landingImpulse > 0.95 && s.motion.landingImpulse < 0.35);
  });
});

describe('the tail as a traversal tool', () => {
  test('loads before takeoff, counters the pitch in flight, and reaches down before contact', () => {
    let checkedHops = 0;
    for (let i = 0; i < plan.clips.length; i++) {
      const m = plan.motions[i]!;
      if (m.kind !== 'HOP' || m.apexAbovePx < 40) continue;
      checkedHops++;
      const pre = sampleWallaby(plan, m.takeoffMs - 2);
      assert.equal(pre.motion.phase, 'PRELOAD');
      assert.ok(pre.motion.tail.swing < 0 && pre.motion.tail.tension > MOTION_CONFIG.tail.restTension, 'loaded down and stiffened');
      for (let k = 0.25; k < 0.7; k += 0.05) {
        const s = sampleWallaby(plan, m.takeoffMs + (m.contactMs - m.takeoffMs) * k);
        if (Math.abs(s.motion.rotation) < 2) continue;
        assert.ok(Math.sign(s.motion.tail.swing) === -Math.sign(s.motion.rotation) || Math.abs(s.motion.tail.swing) < 3, `counter-rotation at k=${k.toFixed(2)}: pitch ${s.motion.rotation.toFixed(1)} tail ${s.motion.tail.swing.toFixed(1)}`);
      }
      const reach = sampleWallaby(plan, m.contactMs - 2);
      assert.equal(reach.motion.phase, 'REACH');
      assert.ok(reach.motion.tail.swing < sampleWallaby(plan, m.takeoffMs + (m.contactMs - m.takeoffMs) * 0.5).motion.tail.swing, 'sweeps down to meet the ground');
    }
    assert.ok(checkedHops >= 4, `${checkedHops} real bounds checked`);
  });

  test('hangs and swings once as a counterweight while climbing, and braces behind a push', () => {
    const hang = samples(lab, 0, 7400).filter((x) => x.s.motion.phase === 'HANG');
    assert.ok(hang.length > 3);
    const swings = hang.map((x) => x.s.motion.tail.swing);
    assert.ok(Math.max(...swings) - Math.min(...swings) > 3 && swings.every((v) => v < 0), 'hangs below and swings as the body stops');
    const brace = samples(lab, 0, 7400).filter((x) => x.s.motion.phase === 'BRACE' || x.s.motion.phase === 'LOAD');
    assert.ok(brace.length > 5 && brace.every((x) => x.s.motion.contact !== 'NONE'));
    const loaded = brace[brace.length - 1]!.s.motion.tail;
    assert.ok(loaded.swing < 0 && loaded.tension >= MOTION_CONFIG.tail.braceTension - 1e-9, 'planted and stiff');
  });

  test('corrects balance on a narrow perch with a slow, small sway, and stays still on wide ground', () => {
    const narrow = samples(lab, 4400, 5600, 50).map((x) => x.s.motion.tail.swing);
    assert.ok(Math.max(...narrow) - Math.min(...narrow) > 1 && Math.max(...narrow.map(Math.abs)) <= MOTION_CONFIG.tail.narrowSwayDeg + 1e-9);
    const wide = samples(lab, 300, 1000, 50).map((x) => x.s.motion.tail.swing);
    assert.ok(wide.every((v) => v === wide[0]), 'no sway on open ground');
  });
});

describe('phases and velocity', () => {
  test('every hop runs its phases in order', () => {
    const order = ['ORIENT', 'PRELOAD', 'TAKEOFF', 'FLIGHT', 'REACH', 'CONTACT', 'SETTLE'];
    for (let i = 0; i < plan.clips.length; i++) {
      if (plan.motions[i]!.kind !== 'HOP') continue;
      const c = plan.clips[i]!;
      let last = -1;
      for (const { s } of samples(plan, c.startMs, c.endMs, 3)) {
        const k = order.indexOf(s.motion.phase);
        assert.ok(k >= last, `${c.segmentId}: ${s.motion.phase} after ${order[last]}`);
        last = k;
      }
    }
  });

  test('velocity is the derivative of the feet position in flight', () => {
    for (let i = 0; i < plan.clips.length; i++) {
      const m = plan.motions[i]!;
      if (m.kind !== 'HOP') continue;
      const mid = (m.takeoffMs + m.contactMs) / 2;
      const a = sampleWallaby(plan, mid - 1);
      const b = sampleWallaby(plan, mid + 1);
      const s = sampleWallaby(plan, mid);
      const vx = (b.x - a.x) / 0.002;
      const vy = (b.y - a.y) / 0.002;
      assert.ok(Math.abs(vx - s.motion.velocity.x) < 2 && Math.abs(vy - s.motion.velocity.y) < 2, `velocity ${JSON.stringify(s.motion.velocity)} vs ${vx.toFixed(1)},${vy.toFixed(1)}`);
    }
  });

  test('the action vocabulary covers the brief: every action and every phase appears', () => {
    const actions = new Set<string>();
    const phases = new Set<string>();
    for (const p of [plan, lab]) for (let ms = 0; ms < (p === lab ? 7400 : timeline.totalMs); ms += 20) {
      const s = sampleWallaby(p, ms);
      if (!s.visible) continue;
      actions.add(s.motion.action);
      phases.add(s.motion.phase);
    }
    for (const a of ['IDLE', 'HOP', 'AIRBORNE', 'LAND', 'PERCH', 'INSPECT', 'TRACE', 'MANTLE', 'PUSH_THROUGH']) assert.ok(actions.has(a), a);
    for (const ph of ['HOLD', 'ORIENT', 'PRELOAD', 'TAKEOFF', 'FLIGHT', 'REACH', 'CONTACT', 'SETTLE', 'STEP', 'HANG', 'PULL', 'BRACE', 'LOAD', 'DRIVE', 'FALL']) assert.ok(phases.has(ph), ph);
  });
});

void (null as unknown as Clip);
