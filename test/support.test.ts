// Support plausibility, end to end: WalletWallaby stands, grips, and braces only where the terrain on
// screen can carry him. The transitional TypeScript judge and the Rust/WASM engine's port reach the
// same verdict bit for bit (on adversarial cases and on sweeps over every terrain the lesson draws);
// every contact of the committed lesson is carried; trace footholds are real tops, never the drawn
// route; the choreography only chooses among authored stands and fails closed when none is plausible;
// and the gates refuse a plan with one unsupported contact. Every refusal has a positive control.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor, standFor } from '../src/character/walletwallaby/choreography.ts';
import { assertSupported, auditLesson, judgeContacts, listContacts } from '../src/character/walletwallaby/contacts.ts';
import { MOTION_CONFIG, MotionPlanError, planMotion } from '../src/character/walletwallaby/motion.ts';
import { evaluateBrace, evaluateGrip, evaluateStance, selectSupport, SupportError, type ContactRole, type StanceQuery, type SupportVerdict } from '../src/character/walletwallaby/support.ts';
import { boundFeet } from '../src/character/walletwallaby/trace.ts';
import { WALLABY_HEIGHT } from '../src/character/walletwallaby/rig.ts';
import { FRAME, type Point } from '../src/layout/geometry.ts';
import { BRAND_GROUND } from '../src/layout/brand-layout.ts';
import type { Anchor } from '../src/layout/scene-layout.ts';
import { solidsOf, terrainsFor, type SupportClass, type Terrain, type TerrainSurface } from '../src/layout/terrain.ts';
import { MotionEngineError, SUPPORT_QUERY_SCHEMA, type SupportQuery } from '../src/motion/plan.ts';
import { auditContactsWithEngine, RustMotionEngine } from '../src/motion/rust-adapter.ts';
import { MOTION_INTELLIGENCE_CONFIG } from '../src/motion/rust-path.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

const cfg = MOTION_CONFIG.support;
const engine = RustMotionEngine.load();
const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const plan = planMotion(choreograph(timeline, layouts), layouts);
const terrains = terrainsFor(timeline.segments, layouts);

// The same test scene as motion-intelligence/tests/support.rs.
const block = (id: string, [x, y, w, h]: [number, number, number, number], top: SupportClass): TerrainSurface[] => [
  { id: `${id}:top`, element: id, face: 'TOP', support: top, x0: x, y0: y, x1: x + w, y1: y, thicknessPx: h },
  { id: `${id}:left`, element: id, face: 'LEFT', support: 'SIDE_FACE', x0: x, y0: y, x1: x, y1: y + h, thicknessPx: w },
  { id: `${id}:right`, element: id, face: 'RIGHT', support: 'SIDE_FACE', x0: x + w, y0: y, x1: x + w, y1: y + h, thicknessPx: w },
];
const SCENE: Terrain = {
  surfaces: [
    { id: 'ground:top', element: 'ground', face: 'TOP', support: 'SUPPORTED_SURFACE', x0: 0, y0: 880, x1: 1920, y1: 880, thicknessPx: 200 },
    ...block('card', [400, 500, 600, 200], 'SUPPORTED_SURFACE'),
    ...block('pedestal', [1100, 600, 100, 280], 'SUPPORTED_SURFACE'),
    ...block('corner', [1250, 650, 30, 230], 'SUPPORTED_SURFACE'),
    ...block('ledge', [1440, 600, 320, 280], 'LEDGE'),
    { id: 'hairline:top', element: 'hairline', face: 'TOP', support: 'SUPPORTED_SURFACE', x0: 200, y0: 300, x1: 380, y1: 300, thicknessPx: 1 },
    { id: 'border:top', element: 'border', face: 'TOP', support: 'DECORATIVE_EDGE', x0: 1300, y0: 420, x1: 1420, y1: 420, thicknessPx: 1 },
    { id: 'underline:top', element: 'underline', face: 'TOP', support: 'DECORATIVE_EDGE', x0: 100, y0: 200, x1: 350, y1: 200, thicknessPx: 2 },
    { id: 'route#0', element: 'route', face: 'LINE', support: 'NON_SUPPORTING', x0: 1500, y0: 300, x1: 1800, y1: 350, thicknessPx: 2 },
  ],
  protectedText: [{ x: 820, y: 440, w: 160, h: 50 }],
};
const stance = (x: number, y: number, facing: 1 | -1, role: ContactRole = 'PERCH', narrowAllowed = false, scale = 1): StanceQuery => ({ at: { x, y }, scale, facing, role, narrowAllowed });
/** A verdict as the engine states it: without its prose. */
const plain = <T extends { reason: string }>(v: T): Omit<T, 'reason'> => {
  const { reason: _r, ...rest } = v;
  return rest;
};
/** A hand verdict as the engine states it: without its prose, and a brace without its feet's verdict. */
const hand = (v: { reason: string; feet?: unknown }): unknown => {
  const { reason: _r, feet: _f, ...rest } = v;
  return rest;
};
const query = (t: Terrain, part: Partial<Pick<SupportQuery, 'stances' | 'grips' | 'braces'>>, support = MOTION_INTELLIGENCE_CONFIG.support): SupportQuery => ({
  schema: SUPPORT_QUERY_SCHEMA,
  config: support,
  bodyHeightPx: MOTION_INTELLIGENCE_CONFIG.bodyHeightPx,
  stage: { width: FRAME.width, height: FRAME.height },
  terrain: { surfaces: t.surfaces, protectedText: t.protectedText.map((r) => ({ ...r })) },
  stances: [],
  grips: [],
  braces: [],
  ...part,
});
/** Judge one stance with both judges; they must agree exactly. */
function judged(q: StanceQuery, t: Terrain = SCENE, support = cfg): SupportVerdict {
  const ts = evaluateStance(q, t, support);
  const [rust] = engine.judge(query(t, { stances: [q] }, support)).stances;
  assert.deepEqual(rust, plain(ts), `the engine agrees at (${q.at.x}, ${q.at.y}) facing ${q.facing}`);
  return ts;
}
const refused = (q: StanceQuery, code: SupportVerdict['code']): SupportVerdict => {
  const v = judged(q);
  assert.ok(!v.ok && v.code === code && v.grade === null, `${code} expected, got ${v.code}: ${v.reason}`);
  return v;
};

describe('the nine refusals', () => {
  test('a 1 px decorative border is not terrain, and a hairline declared as a surface is too thin', () => {
    assert.equal(refused(stance(1360, 420, 1), 'NOT_TERRAIN').surface, 'border:top');
    refused(stance(290, 300, 1), 'TOO_THIN');
  });
  test('a tiny corner cannot hold both feet', () => {
    assert.equal(refused(stance(1265, 650, 1), 'FEET_UNSUPPORTED').widthPx, 30);
    refused(stance(1265, 650, 1, 'STEP'), 'FEET_UNSUPPORTED');
  });
  test('a vertical card side never carries feet', () => {
    assert.equal(refused(stance(400, 600, 1), 'SIDE_FACE').surface, 'card:left');
  });
  test('a text underline is not terrain, and no stance touches protected text', () => {
    refused(stance(200, 200, 1), 'NOT_TERRAIN');
    refused(stance(900, 500, 1), 'TEXT_CONTACT');
  });
  test('a graph edge is drawn information', () => {
    assert.equal(refused(stance(1650, 325, 1, 'STEP'), 'NOT_TERRAIN').surface, 'route#0');
  });
  test('a tail cannot carry a body the feet do not', () => {
    assert.equal(refused(stance(1400, 600, -1), 'TAIL_ONLY').surface, 'ledge:top');
  });
  test('an unreachable grip is refused, and a corner that is not a lip is never gripped', () => {
    const far = evaluateGrip({ x: 1440, y: 600 }, { x: 1300, y: 700 }, 1, SCENE, cfg);
    assert.ok(!far.ok && far.code === 'OUT_OF_REACH', far.reason);
    assert.equal(evaluateGrip({ x: 1600, y: 600 }, { x: 1600, y: 640 }, 1, SCENE, cfg).code, 'NOT_A_LIP');
  });
  test('feet outside the support area are refused', () => {
    assert.ok(refused(stance(1460, 600, 1), 'FEET_UNSUPPORTED').marginBackPx < 0);
  });
  test('a centre of mass outside the ledge is refused (a body leaning out past the lip)', () => {
    const leaning = { ...cfg, comAheadBodyHeights: 0.3 };
    const v = judged(stance(1715, 600, 1), SCENE, leaning);
    assert.ok(!v.ok && v.code === 'COM_UNSUPPORTED' && v.feet.x1 <= 1760 && v.comX > 1760, v.reason);
    assert.ok(judged(stance(1715, 600, 1)).ok, 'control: the committed centre of mass is carried there');
  });
  test('and the rest have their own codes', () => {
    refused(stance(1150, 600, 1), 'NARROW_NOT_AUTHORIZED');
    refused(stance(700, 600, 1), 'INSIDE_SOLID');
    refused(stance(300, 100, 1, 'STEP'), 'NO_SURFACE');
  });
});

describe('six positive controls', () => {
  test('a broad card top, with the tail resting on it', () => {
    const v = judged(stance(600, 500, 1));
    assert.ok(v.ok && v.grade === 'BROAD' && v.tail === 'ON_SUPPORT', v.reason);
  });
  test('a normal ledge, near its lip', () => {
    const v = judged(stance(1500, 600, 1));
    assert.ok(v.ok && v.grade === 'LEDGE' && v.marginBackPx >= 0, v.reason);
  });
  test('an authored narrow perch', () => {
    const v = judged(stance(1150, 600, 1, 'PERCH', true));
    assert.ok(v.ok && v.grade === 'NARROW', v.reason);
    assert.ok(judged(stance(1150, 600, 1, 'STEP')).ok, 'a passing step needs no authorization');
  });
  test('a mantle lip within reach', () => {
    const v = evaluateGrip({ x: 1440, y: 600 }, { x: 1400, y: 640 }, 1, SCENE, cfg);
    assert.ok(v.ok && v.code === 'GRIPPED' && v.surface === 'ledge:left', v.reason);
  });
  test('feet plus tail: a tripod on the ledge', () => {
    const v = judged(stance(1640, 600, 1));
    assert.ok(v.ok && v.grade === 'BROAD' && v.tail === 'ON_SUPPORT', v.reason);
  });
  test('a hand brace while the feet stand supported, and never instead of them', () => {
    const v = evaluateBrace(stance(1360, 880, 1), { x: 1440, y: 740 }, SCENE, cfg);
    assert.ok(v.ok && v.code === 'BRACED', v.reason);
    assert.equal(evaluateBrace(stance(1360, 700, 1), { x: 1440, y: 740 }, SCENE, cfg).code, 'FEET_NOT_SUPPORTED');
    assert.equal(evaluateBrace(stance(1360, 880, -1), { x: 1440, y: 740 }, SCENE, cfg).code, 'BEHIND_THE_BODY');
  });
});

describe('one judge on both sides of the WASM boundary', () => {
  test('hands: grips and braces agree exactly', () => {
    const grips = [
      { corner: { x: 1440, y: 600 }, shoulder: { x: 1400, y: 640 }, scale: 1 },
      { corner: { x: 1440, y: 600 }, shoulder: { x: 1300, y: 700 }, scale: 1 },
      { corner: { x: 1600, y: 600 }, shoulder: { x: 1600, y: 640 }, scale: 1 },
      { corner: { x: 1000, y: 500 }, shoulder: { x: 1030, y: 540 }, scale: 0.78 },
    ];
    const braces = [stance(1360, 880, 1), stance(1360, 700, 1), stance(1360, 880, -1), stance(1300, 880, 1)].map((s) => ({ stance: s, hand: { x: 1440, y: 740 } }));
    const report = engine.judge(query(SCENE, { grips, braces }));
    grips.forEach((g, i) => assert.deepEqual(report.grips[i], hand(evaluateGrip(g.corner, g.shoulder, g.scale, SCENE, cfg)), `grip ${i}`));
    braces.forEach((b, i) => assert.deepEqual(report.braces[i], hand(evaluateBrace(b.stance, b.hand, SCENE, cfg)), `brace ${i}`));
    assert.ok(report.grips.some((g) => g.ok) && report.grips.some((g) => !g.ok) && report.braces.some((b) => b.ok) && report.braces.some((b) => !b.ok), 'control: both outcomes occur');
  });

  test('a sweep over every terrain the lesson draws: every stance gets the same verdict from both judges', () => {
    let compared = 0;
    const codes = new Set<string>();
    for (const [id, t] of terrains) {
      const ys = [...new Set(t.surfaces.flatMap((s) => (s.face === 'TOP' ? [s.y0 - 1.5, s.y0, s.y0 + 1] : s.face === 'LINE' ? [(s.y0 + s.y1) / 2] : [(s.y0 + s.y1) / 2])))];
      const stances: StanceQuery[] = [];
      for (const y of ys) for (let x = 3; x < FRAME.width; x += 61) for (const facing of [1, -1] as const) for (const role of ['PERCH', 'STEP'] as const) for (const scale of [0.5, 0.78]) stances.push(stance(x, y, facing, role, false, scale));
      for (let k = 0; k < stances.length; k += 4000) {
        const chunk = stances.slice(k, k + 4000);
        const report = engine.judge(query(t, { stances: chunk }));
        chunk.forEach((q, i) => {
          const ts = plain(evaluateStance(q, t, cfg));
          if (!isDeepStrictEqual(report.stances[i], ts)) assert.fail(`${id} at (${q.at.x}, ${q.at.y}) facing ${q.facing} ${q.role} @${q.scale}: engine ${JSON.stringify(report.stances[i])} vs ${JSON.stringify(ts)}`);
          codes.add(ts.code);
          compared++;
        });
      }
    }
    assert.ok(compared > 20_000, `${compared} stances compared`);
    for (const c of ['SUPPORTED', 'NO_SURFACE', 'INSIDE_SOLID', 'FEET_UNSUPPORTED', 'NOT_TERRAIN', 'TEXT_CONTACT']) assert.ok(codes.has(c), `control: the sweep reaches ${c} (${[...codes].join(' ')})`);
  });
});

describe('the committed lesson', () => {
  const judgedLesson = auditLesson(timeline, layouts, plan);

  test('every contact the lesson makes is carried by the terrain on screen', () => {
    assert.doesNotThrow(() => assertSupported(judgedLesson));
    assert.ok(judgedLesson.length > 60, `${judgedLesson.length} contacts`);
    for (const kind of ['HOLD', 'LANDING', 'TAKEOFF', 'STEP'] as const) assert.ok(judgedLesson.some((c) => c.kind === kind && !c.offStage), `control: the lesson makes ${kind} contacts`);
    for (const c of judgedLesson.filter((x) => x.offStage)) assert.ok(c.at.x < 0 || c.at.x > FRAME.width || c.at.y < 0 || c.at.y > FRAME.height, 'only what is off the stage goes unjudged');
    // Every perch is a real surface: no hold or landing on a drawn line, a face, or inside a block.
    for (const c of judgedLesson.filter((x) => !x.offStage && x.stance)) assert.ok(['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE'].includes(c.stance!.support!), `${c.segmentId} ${c.kind} on ${c.stance!.surface}`);
  });

  test('the gate refuses a plan with a single contact the terrain cannot carry (positive control)', () => {
    // The takeaway scene without its summit ledge: the perch there is now on nothing.
    const take = terrains.get('takeaway')!;
    const without = new Map(terrains).set('takeaway', { ...take, surfaces: take.surfaces.filter((s) => s.element !== 'ledge') });
    const bad = judgeContacts(plan, without, timeline.segments);
    assert.ok(bad.some((c) => !c.ok && c.segmentId === 'takeaway'));
    assert.throws(() => assertSupported(bad), (err: unknown) => err instanceof MotionPlanError && /UNSUPPORTED_CONTACT/.test(err.message));
  });

  test('trace footholds are real tops, never the drawn route, and no leap passes through a block', () => {
    let bounds = 0;
    plan.motions.forEach((m, i) => {
      if (m.kind !== 'TRACE' || !m.bounds) return;
      const clip = plan.clips[i]!;
      const t = terrains.get(clip.segmentId)!;
      const solids = solidsOf(t);
      for (const b of m.bounds) {
        bounds++;
        for (const [p, scale] of [[b.from, b.fromScale], [b.to, b.toScale]] as const) {
          const v = evaluateStance(stance(p.x, p.y, b.to.x < b.from.x - 4 ? -1 : 1, 'STEP', false, scale), t, cfg);
          assert.ok(v.ok && v.support !== 'NON_SUPPORTING', `${clip.segmentId} foothold (${p.x}, ${p.y}): ${v.code} ${v.reason}`);
        }
        for (let k = 1; k < 48; k++) {
          const f = boundFeet(b, k / 48);
          for (const s of solids) assert.ok(!(f.x > s.rect.x + 1 && f.x < s.rect.x + s.rect.w - 1 && f.y > s.rect.y + 1 && f.y < s.rect.y + s.rect.h - 1), `${clip.segmentId}: a ${b.kind} passes through ${s.element}`);
        }
      }
    });
    assert.ok(bounds > 10, `control: the lesson bounds between footholds (${bounds})`);
  });

  test('brand segments stand on their own drawn ground, the end screen included', () => {
    for (const c of judgedLesson.filter((x) => x.segmentId === 'end-screen' && !x.offStage)) assert.ok(c.ok && c.stance?.surface === 'ground:top', `${c.kind} on ${c.stance?.surface}`);
    assert.ok(BRAND_GROUND.END_SCREEN.x0 > 0, 'control: the end screen draws ground only right of its reserved zones');
  });
});

describe('the lesson decides where; Motion Intelligence decides how', () => {
  const layout = layouts.get('takeaway')!;
  const anchor = (candidates: Point[], narrow = false): Anchor => ({ stand: candidates[0]!, candidates, focus: { x: 750, y: 364 }, scale: 0.78, ...(narrow ? { narrow } : {}) });

  test('a destination\'s stand is chosen only among the authored ones, best supported first', () => {
    // The ledge's lip (facing the subject, the heels hang off) before its middle: the middle is chosen.
    const at = standFor(anchor([{ x: 1450, y: 600 }, { x: 1600, y: 600 }]), layout);
    assert.deepEqual(at, { x: 1600, y: 600 });
    // Equally good stands keep the authored order.
    assert.deepEqual(standFor(anchor([{ x: 1600, y: 600 }, { x: 1620, y: 600 }]), layout), { x: 1600, y: 600 });
  });

  test('with no plausible stand the choreography fails closed instead of inventing one', () => {
    assert.throws(() => standFor(anchor([{ x: 1900, y: 600 }, { x: 1600, y: 700 }]), layout), (err: unknown) => err instanceof SupportError && err.code === 'SUPPORT_UNAVAILABLE');
    assert.throws(() => standFor(anchor([{ x: 1600, y: 590 }]), layout), SupportError, 'a single implausible stand too');
    assert.doesNotThrow(() => standFor(anchor([{ x: 1600, y: 600 }]), layout), 'control');
  });

  test('selection never moves a stand: the chosen point is one of the candidates, exactly', () => {
    const candidates = [{ x: 1265, y: 650 }, { x: 1640.25, y: 600 }];
    const choice = selectSupport(candidates, { scale: 1, facing: 1, role: 'PERCH', narrowAllowed: false }, SCENE, cfg);
    assert.equal(choice.at, candidates[1]);
    assert.equal(choice.index, 1);
  });
});

describe('the engine audits every lesson contact itself', () => {
  test('a rust-wasm render: the engine judges every contact, in agreement with the TypeScript judge', () => {
    const audit = auditContactsWithEngine(engine, plan, terrains, timeline.segments);
    const all = listContacts(plan);
    assert.equal(audit.contacts, all.length);
    assert.equal(audit.offStage, all.filter((c) => c.at.x < 0 || c.at.x > FRAME.width || c.at.y < 0 || c.at.y > FRAME.height).length);
    assert.ok(audit.queries >= 5, `${audit.queries} terrain queries`);
  });

  test('a disagreement between the judges, or an unsupported contact, stops the render (positive controls)', () => {
    const tampered = {
      judge: (q: SupportQuery) => {
        const r = engine.judge(q);
        return { ...r, stances: r.stances.map((v, i) => (i === 0 ? { ...v, comMarginPx: v.comMarginPx + 1e-9 } : v)) };
      },
    } as unknown as RustMotionEngine;
    assert.throws(() => auditContactsWithEngine(tampered, plan, terrains, timeline.segments), (err: unknown) => err instanceof MotionEngineError && err.code === 'SUPPORT_MISMATCH');
    const take = terrains.get('takeaway')!;
    const without = new Map(terrains).set('takeaway', { ...take, surfaces: take.surfaces.filter((s) => s.element !== 'ledge') });
    assert.throws(() => auditContactsWithEngine(engine, plan, without, timeline.segments), (err: unknown) => err instanceof MotionEngineError && err.code === 'IMPLAUSIBLE_SUPPORT');
  });

  test('the footprint is a body\'s, at its scale', () => {
    const v = evaluateStance(stance(600, 500, 1, 'PERCH', false, 0.5), SCENE, cfg);
    assert.ok(Math.abs(v.feet.x1 - v.feet.x0 - (cfg.footprintBackBodyHeights + cfg.footprintFrontBodyHeights) * WALLABY_HEIGHT * 0.5) < 1e-9);
  });
});
