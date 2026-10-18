// WalletWallaby motion: deterministic, bounded, physically shaped, and unable
// to change where the lesson goes. Runs against the committed video and against
// adversarial inputs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { mixTokens, TOKENS } from '../src/brand/tokens.ts';
import { choreograph, layoutsFor, type Clip } from '../src/character/walletwallaby/choreography.ts';
import {
  arcDepth,
  MOTION_CONFIG,
  MotionPlanError,
  planHop,
  planMotion,
  platformOffsets,
  sampleWallaby,
  springResponse,
  stepBoundary,
  validateMotionConfig,
  type MotionConfig,
  type MotionPlan,
} from '../src/character/walletwallaby/motion.ts';
import { RIG_PALETTE } from '../src/character/walletwallaby/rig.ts';
import { MOTION } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { intersects } from '../src/layout/geometry.ts';
import { EYEBROW_RECT, wallabyBounds } from '../src/layout/scene-layout.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { clone, committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const clips = choreograph(timeline, layouts);
const plan = planMotion(clips, layouts);
const FRAME_MS = 1000 / timeline.fps;
const frames = (): number[] => Array.from({ length: Math.floor(timeline.totalMs / FRAME_MS) }, (_, i) => i * FRAME_MS);
const { limits } = MOTION_CONFIG;

const hopClips = (p: MotionPlan) => p.clips.map((c, i) => ({ c, m: p.motions[i]! })).filter((x) => x.m.kind === 'HOP');
const configWith = (patch: (c: Record<string, any>) => void): unknown => {
  const c = clone(MOTION_CONFIG) as unknown as Record<string, any>;
  patch(c);
  return c;
};

describe('motion config', () => {
  test('the committed config is valid and is the declared motion version', () => {
    assert.equal(validateMotionConfig(JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'config', 'motion.json'), 'utf8'))).version, MOTION.version);
    assert.equal(MOTION_CONFIG.id, MOTION.id);
  });

  test('invalid numeric config fails closed (positive controls)', () => {
    const bad: [string, (c: Record<string, any>) => void][] = [
      ['NaN gravity', (c) => (c.gravityBodyHeightsPerS2 = Number.NaN)],
      ['Infinite gravity', (c) => (c.gravityBodyHeightsPerS2 = Number.POSITIVE_INFINITY)],
      ['negative anticipation', (c) => (c.hop.anticipationMs = -1)],
      ['zero flight floor', (c) => (c.hop.minFlightMs = 0)],
      ['unbounded peak', (c) => (c.hop.peakMax = 50)],
      ['peak min above max', (c) => (c.hop.peakMin = 0.9) && (c.hop.peakMax = 0.5)],
      ['overdamped spring', (c) => (c.response.compression.damping = 1)],
      ['absurd speed limit', (c) => (c.limits.maxSpeedBodyHeightsPerS = 1e6)],
      ['platform dip over its limit', (c) => (c.gains.platformDipPx = 5) && (c.limits.platformMaxPx = 2)],
      ['string number', (c) => (c.limits.maxRotationDeg = '9')],
      ['missing field', (c) => delete c.trace.skipStepMs],
      ['unknown field', (c) => (c.hop.wobble = 1)],
      ['wrong schema', (c) => (c.schema = 'walletwall.motion-config/v0')],
      ['non-integer version', (c) => (c.version = 1.5)],
    ];
    for (const [name, patch] of bad) assert.throws(() => validateMotionConfig(configWith(patch)), MotionPlanError, name);
    assert.doesNotThrow(() => validateMotionConfig(configWith(() => {})), 'control: an untouched copy is valid');
  });
});

describe('hop solver', () => {
  const base = { from: { x: 400, y: 640 }, to: { x: 900, y: 520 }, fromScale: 0.7, toScale: 0.7, startMs: 1000, endMs: 1900 };

  test('lands exactly on the authored target, ballistic in between', () => {
    const hop = planHop(base);
    assert.ok(hop.takeoffMs > base.startMs && hop.contactMs > hop.takeoffMs && hop.contactMs <= base.endMs);
    // y(s) = y0 + d s - c s(1-s) is exactly y1 at s = 1 and a parabola (constant second difference) in between.
    const y = (s: number) => base.from.y + (base.to.y - base.from.y) * s - hop.depthPx * s * (1 - s);
    assert.equal(y(1), base.to.y);
    const d2 = [0.2, 0.4, 0.6].map((s) => y(s + 0.1) - 2 * y(s) + y(s - 0.1));
    for (const v of d2) assert.ok(Math.abs(v - d2[0]!) < 1e-9, 'constant acceleration');
    assert.ok(hop.apexAbovePx > 0, 'rises above the higher endpoint');
  });

  test('same input, same plan; no randomness, no clock', () => {
    assert.deepEqual(planHop(base), planHop(base));
    const src = readFileSync(path.join(VIDEO_ROOT, 'src', 'character', 'walletwallaby', 'motion.ts'), 'utf8');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame|setTimeout|process\./.test(src), 'motion.ts reads no clock, randomness, or environment');
  });

  test('non-finite, negative, impossible, or absurd inputs are refused (positive controls)', () => {
    const bad: Partial<typeof base>[] = [
      { from: { x: Number.NaN, y: 0 } },
      { to: { x: 0, y: Number.POSITIVE_INFINITY } },
      { endMs: 1000 },
      { endMs: 900 },
      { fromScale: 0 },
      { toScale: -1 },
      { endMs: Number.NaN },
      { to: { x: 900000, y: 520 } },
      { endMs: 1040 },
    ];
    for (const patch of bad) assert.throws(() => planHop({ ...base, ...patch }), MotionPlanError, JSON.stringify(patch));
  });

  test('a hop in place (zero distance) is a valid, bounded hop', () => {
    const hop = planHop({ ...base, to: base.from });
    assert.ok(Number.isFinite(hop.depthPx) && hop.depthPx > 0);
  });

  test('surface awareness lowers or raises the arc but never moves the landing', () => {
    const ceiling = { x: 300, y: 300, w: 800, h: 80 };
    const free = planHop(base);
    const aware = planHop({ ...base, avoid: [ceiling] });
    const crossings = (h: ReturnType<typeof planHop>) => {
      let n = 0;
      for (let k = 1; k < 32; k++) {
        const u = k / 32;
        const feet = { x: base.from.x + (base.to.x - base.from.x) * u, y: base.from.y + (base.to.y - base.from.y) * u - h.depthPx * u * (1 - u) };
        if (intersects(wallabyBounds(feet, 0.7), ceiling)) n++;
      }
      return n;
    };
    assert.ok(crossings(free) > 0, 'control: the natural arc crosses the text');
    assert.ok(crossings(aware) < crossings(free), 'the aware arc crosses less');
    assert.equal(aware.textCrossings, crossings(aware));
    // The solver has no output that names a destination: landing is the input target.
    assert.deepEqual(Object.keys(aware).sort(), ['apexAbovePx', 'contactMs', 'depthPx', 'gravityPx', 'kind', 'orientEndMs', 'takeoffMs', 'textCrossings']);
  });

  test('the arc formula puts the apex where asked', () => {
    for (const [y0, y1, h] of [[600, 600, 40], [600, 400, 30], [400, 600, 25]] as const) {
      const c = arcDepth(y0, y1, h);
      const s = (1 - (y1 - y0) / c) / 2;
      const apex = y0 + (y1 - y0) * s - c * s * (1 - s);
      assert.ok(Math.abs(Math.min(y0, y1) - apex - h) < 1e-9, `${y0}->${y1} h${h}`);
    }
  });
});

describe('springs and steps', () => {
  test('a contact response starts at rest, peaks at 1, rebounds a little, and ends exactly at rest', () => {
    const sp = MOTION_CONFIG.response.compression;
    assert.equal(springResponse(0, sp), 0);
    assert.equal(springResponse(-5, sp), 0);
    assert.equal(springResponse(sp.windowMs, sp), 0);
    assert.equal(springResponse(sp.windowMs + 100, sp), 0);
    let max = 0, min = 0;
    for (let t = 0; t < sp.windowMs; t += 1) {
      const v = springResponse(t, sp);
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
    assert.ok(Math.abs(max - 1) < 1e-3, 'peaks at 1');
    assert.ok(min < 0 && min > -0.35, `a slight rebound (${min.toFixed(3)}), not a bounce`);
  });

  test('trace bounds accelerate out and decelerate in', () => {
    const n = 5;
    const lengths = Array.from({ length: n }, (_, k) => stepBoundary(k + 1, n) - stepBoundary(k, n));
    assert.equal(stepBoundary(0, n), 0);
    assert.equal(stepBoundary(n, n), 1);
    assert.ok(lengths[0]! < lengths[2]! && lengths[4]! < lengths[2]!);
  });
});

describe('the committed video', () => {
  test('the same spec plans and samples identically', () => {
    assert.deepEqual(planMotion(clips, layouts), plan);
    for (const ms of frames().filter((_, i) => i % 7 === 0)) assert.deepEqual(sampleWallaby(plan, ms, 'REST'), sampleWallaby(planMotion(clips, layouts), ms, 'REST'));
  });

  test('every frame is finite and every channel stays inside its limit', () => {
    for (const ms of frames()) {
      const s = sampleWallaby(plan, ms);
      if (!s.visible) continue;
      const nums = [s.x, s.y, s.scale, s.opacity, ...Object.values(s.pose), ...Object.values(s.motion).filter((v): v is number => typeof v === 'number')];
      for (const v of nums) assert.ok(Number.isFinite(v), `t=${ms}`);
      const m = s.motion;
      assert.ok(Math.abs(m.rotation) <= limits.maxRotationDeg + 1e-9, `rotation t=${ms}`);
      assert.ok(m.stretch >= -limits.maxCompression - 1e-9 && m.stretch <= limits.maxStretch + 1e-9, `stretch t=${ms}`);
      assert.ok(Math.abs(m.tailLag) <= limits.maxTailLagDeg + 1e-9, `tail t=${ms}`);
      assert.ok(Math.abs(m.earLag) <= limits.maxEarLagDeg + 1e-9, `ears t=${ms}`);
      assert.ok(Math.abs(m.headStab) <= limits.maxHeadStabDeg + 1e-9, `head t=${ms}`);
      assert.ok(Math.abs(m.platformDip) <= limits.platformMaxPx, `dip t=${ms}`);
      assert.ok(s.pose.crouch >= 0 && s.pose.crouch <= 1, `crouch t=${ms}`);
    }
  });

  test('anticipation comes before takeoff, flight before contact, compression after contact', () => {
    const hops = hopClips(plan);
    assert.ok(hops.length >= 10);
    for (const { c, m } of hops) {
      if (m.kind !== 'HOP') continue;
      const before = sampleWallaby(plan, m.takeoffMs - 1);
      assert.equal(before.x, c.from.x, 'feet stay put until takeoff');
      assert.notEqual(before.motion.contact, 'NONE');
      assert.ok(before.motion.stretch <= 0, 'loaded, not stretched, before takeoff');
      const mid = sampleWallaby(plan, (m.takeoffMs + m.contactMs) / 2);
      assert.equal(mid.motion.contact, 'NONE', 'airborne between takeoff and contact');
      const after = sampleWallaby(plan, m.contactMs + 50);
      assert.notEqual(after.motion.contact, 'NONE', 'grounded after contact');
      assert.ok(after.motion.stretch < 0, 'the landing compresses the body');
    }
  });

  test('every move ends exactly on its authored anchor, and every perch holds it', () => {
    for (let i = 0; i < plan.clips.length; i++) {
      const c = plan.clips[i]!;
      const m = plan.motions[i]!;
      if (c.kind === 'HOLD') {
        for (const ms of [c.startMs, (c.startMs + c.endMs) / 2, c.endMs - 1]) {
          const s = sampleWallaby(plan, ms);
          assert.equal(s.x, c.from.x, `hold x at ${ms}`);
          assert.equal(s.y - s.motion.platformDip, c.from.y, `hold y at ${ms}`);
        }
      }
      if (m.kind === 'HOP' || m.kind === 'DROP' || (m.kind === 'TRACE' && c.kind !== 'HOLD')) {
        const s = sampleWallaby(plan, c.endMs - 0.001);
        assert.equal(s.x, c.to.x, `${c.kind} ${c.segmentId} lands on x`);
        assert.equal(s.y - s.motion.platformDip, c.to.y, `${c.kind} ${c.segmentId} lands on y`);
      }
    }
  });

  test('the motion solver cannot change where the lesson goes', () => {
    // A very different, still-valid physics config: heavier gravity, other arcs, other springs.
    const other = validateMotionConfig(
      configWith((c) => {
        c.version = 99;
        c.gravityBodyHeightsPerS2 = 40;
        c.hop.peakBase = 0.6;
        c.hop.anticipationMs = 90;
        c.trace.strideBodyHeights = 1.2;
        c.response.compression.freqHz = 6;
      }),
    );
    const alt = planMotion(clips, layouts, other as MotionConfig);
    const landings = (p: MotionPlan) => p.events.filter((e) => e.kind === 'LANDING').map((e) => `${e.segmentId}:${e.at.x},${e.at.y}`);
    assert.deepEqual(landings(alt), landings(plan), 'same destinations, same order');
    const authored = plan.clips.filter((c) => c.kind === 'TRAVEL' || c.kind === 'TRAVERSE' || c.kind === 'DROP_IN').map((c) => `${c.segmentId}:${c.to.x},${c.to.y}`);
    assert.deepEqual(landings(plan), authored, 'every landing is an authored clip endpoint, in authored order');
    assert.equal(alt.clips, plan.clips, 'the solver reads the clips; it never rewrites them');
  });

  test('perched frames never overlap protected text', () => {
    for (const ms of frames()) {
      const seg = timeline.segments.find((s) => ms >= s.startMs && ms < s.endMs);
      if (!seg?.scene || ms < seg.contentStartMs) continue;
      const clip = plan.clips.find((c) => ms >= c.startMs && ms < c.endMs);
      if (clip?.kind !== 'HOLD') continue;
      const s = sampleWallaby(plan, ms);
      if (!s.visible) continue;
      const layout = layouts.get(seg.id)!;
      const box = wallabyBounds({ x: s.x, y: s.y }, s.scale * (1 + Math.max(0, s.motion.stretch)));
      for (const r of [...layout.texts.map((t) => t.rect), EYEBROW_RECT]) assert.ok(!intersects(box, r), `${seg.id} t=${Math.round(ms)}`);
    }
  });

  test('in flight, text crossings stay within the v1 choreography baseline', () => {
    // v1 (closed-form, no physics) crossed protected text on 109 frames of this video, all in
    // flight. The physics pass must not regress that; it may only improve it.
    let crossings = 0;
    for (const ms of frames()) {
      const seg = timeline.segments.find((s) => ms >= s.startMs && ms < s.endMs);
      if (!seg?.scene || ms < seg.contentStartMs) continue;
      const s = sampleWallaby(plan, ms);
      if (!s.visible) continue;
      const box = wallabyBounds({ x: s.x, y: s.y }, s.scale * (1 + Math.max(0, s.motion.stretch)));
      if ([...layouts.get(seg.id)!.texts.map((t) => t.rect), EYEBROW_RECT].some((r) => intersects(box, r))) crossings++;
    }
    assert.ok(crossings <= 109, `${crossings} frames cross text`);
  });

  test('platforms acknowledge contact by a few pixels and return exactly to rest', () => {
    const landings = plan.events.filter((e) => e.kind === 'LANDING' && e.surface);
    assert.ok(landings.length >= 10);
    for (const e of landings) {
      let peak = 0;
      for (let t = e.atMs; t < e.atMs + 600; t += 5) peak = Math.max(peak, Math.abs(platformOffsets(plan, e.segmentId, t)[e.surface!.id] ?? 0));
      assert.ok(peak > 0 && peak <= limits.platformMaxPx, `${e.surface!.id} peak ${peak}`);
      const window = MOTION_CONFIG.response.platform.windowMs;
      const later = plan.events.some((o) => o !== e && o.surface?.id === e.surface!.id && o.segmentId === e.segmentId && o.atMs > e.atMs && o.atMs < e.atMs + window + 1);
      if (!later) assert.equal(platformOffsets(plan, e.segmentId, e.atMs + window + 1)[e.surface!.id] ?? 0, 0, 'back to rest');
    }
    assert.ok(plan.events.every((e) => e.surface?.kind !== 'FRAME'), 'a UI capture never moves');
  });

  test('feet ride the platform they stand on, by exactly its displacement', () => {
    for (const e of plan.events.filter((x) => x.kind === 'LANDING' && x.surface)) {
      const ms = e.atMs + 60;
      const s = sampleWallaby(plan, ms);
      if (s.motion.contact !== 'PLATFORM') continue;
      assert.equal(s.motion.platformDip, platformOffsets(plan, e.segmentId, ms)[e.surface!.id] ?? 0);
    }
  });
});

describe('terracotta character', () => {
  test('the coat is the canonical WalletWall terracotta; the shade is derived, not invented', () => {
    assert.equal(RIG_PALETTE.fur, 'terracotta');
    const contract = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'contracts', 'walletwall-brand.json'), 'utf8')) as { theme: Record<string, string> };
    assert.equal(TOKENS[RIG_PALETTE.fur], contract.theme['COLORS.brand.terracotta']);
    assert.equal(RIG_PALETTE.belly, 'cream');
    assert.equal(RIG_PALETTE.ink, 'charcoal');
    const shade = mixTokens(TOKENS[RIG_PALETTE.furShade.from], TOKENS[RIG_PALETTE.furShade.to], RIG_PALETTE.furShade.t);
    assert.match(shade, /^#[0-9A-F]{6}$/);
    const ch = (hex: string, k: number) => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16);
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(ch(TOKENS.terracotta, k), ch(TOKENS.terracottaDark, k));
      const hi = Math.max(ch(TOKENS.terracotta, k), ch(TOKENS.terracottaDark, k));
      assert.ok(ch(shade, k) >= lo && ch(shade, k) <= hi, 'between the two canonical tokens');
    }
    assert.throws(() => mixTokens(TOKENS.terracotta, 'orange', 0.5), 'refuses a non-token colour');
  });

  test('the figure paints only from the rig palette', () => {
    const src = readFileSync(path.join(VIDEO_ROOT, 'src', 'remotion', 'wallaby', 'WallabyFigure.tsx'), 'utf8');
    assert.ok(!/#[0-9a-f]{3,6}\b|rgba?\(/i.test(src), 'no colour literal in the figure');
    for (const m of src.matchAll(/(?:fill|stroke)=\{([A-Z_]+)\}/g)) assert.ok(['FUR', 'FUR_SHADE', 'BELLY', 'INNER_EAR', 'INK', 'HIGHLIGHT', 'TAG'].includes(m[1]!), m[1]);
  });
});

describe('contact sound', () => {
  test('landings sound at the real contact; takeoffs and pushes are cued; steps stay silent', () => {
    const sheet = buildCueSheet(timeline, config.sonic, spec.audio.musicBedId, plan.events);
    const contactLandings = plan.events.filter((e) => e.kind === 'LANDING').map((e) => Math.round(e.atMs));
    const landingCues = [...sheet.cues, ...sheet.suppressed].filter((c) => c.event === 'LANDING');
    assert.ok(landingCues.every((c) => c.reason === 'CONTACT' && contactLandings.includes(c.atMs)), 'no beat-start landing cue remains');
    assert.ok(sheet.cues.some((c) => c.event === 'TAKEOFF') && sheet.cues.some((c) => c.event === 'PUSH_CONTACT'));
    assert.ok(![...sheet.cues, ...sheet.suppressed].some((c) => c.event === 'STEP' || c.event === 'SHIFT'));
    for (const e of ['TAKEOFF', 'PUSH_CONTACT']) assert.ok(config.sonic.events[e] && config.sonic.events[e]!.maxGainDb <= -26, `${e} stays quiet`);
    assert.deepEqual(buildCueSheet(timeline, config.sonic, spec.audio.musicBedId, plan.events), sheet, 'deterministic');
  });

  test('without a motion plan the cue sheet is the v1 beat-timed sheet', () => {
    const sheet = buildCueSheet(timeline, config.sonic, spec.audio.musicBedId);
    assert.ok(sheet.cues.every((c) => c.reason !== 'CONTACT'));
  });
});

void (null as unknown as Clip);
