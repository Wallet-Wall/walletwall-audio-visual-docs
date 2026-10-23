// Attention direction (src/attention/direction.ts, docs/ATTENTION.md): the mode grammar is derived from the
// authored beats alone and is repeatable; the framing is bounded, title-safe, and identity wherever a transition,
// a brand segment, or the end screen owns the frame; nothing a body stands on moves; the character and its support
// stay registered exactly because one transform frames the whole content world; and the config that shapes the
// pixels is part of the build identity.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  applyFraming,
  ATTENTION_CONFIG_REL,
  AttentionConfigError,
  cameraAt,
  castOf,
  directionAt,
  framedRect,
  framingCss,
  IDENTITY_FRAMING,
  isIdentity,
  loadAttentionConfig,
  planAttention,
  resolveAttentionConfig,
  routeDrawn,
  subjectsOfAnchor,
  type AttentionMode,
  type AttentionPlan,
} from '../src/attention/config.ts';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby } from '../src/character/walletwallaby/motion.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress } from '../src/core/hash.ts';
import { CONTENT_BOTTOM, inside, TITLE_SAFE, type Rect } from '../src/layout/geometry.ts';
import { PROVENANCE_CHIP } from '../src/layout/brand-layout.ts';
import { terrainsFor } from '../src/layout/terrain.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildTimeline, totalFrames, type TimedSegment } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const fps = timeline.fps;
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const clips = choreograph(timeline, layouts);
const attention = loadAttentionConfig();
const plan = planAttention(timeline, layouts, clips, attention);
const frames = totalFrames(timeline);
const msOf = (frame: number): number => (frame * 1000) / fps;
const segmentAt = (ms: number): TimedSegment => timeline.segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? timeline.segments[timeline.segments.length - 1]!;
const seg = (id: string): TimedSegment => timeline.segments.find((s) => s.id === id)!;
const f = (ms: number): number => Math.round((ms * fps) / 1000);
const raw = (): any => JSON.parse(readFileSync(path.join(VIDEO_ROOT, ATTENTION_CONFIG_REL), 'utf8'));
const src = (rel: string): string => readFileSync(path.join(VIDEO_ROOT, ...rel.split('/')), 'utf8');

describe('the attention config', () => {
  test('is the declared schema, within bounds; out-of-bounds, unknown, and missing values are refused (positive controls)', () => {
    assert.doesNotThrow(() => resolveAttentionConfig(raw()));
    assert.ok(attention.framing.maxScale <= 1.05 && attention.framing.maxTranslateX <= 70 && attention.framing.maxTranslateY <= 35);
    const bad: [string, (c: any) => void, RegExp][] = [
      ['a scale beyond the ceiling', (c) => (c.modes.INSPECT.scale = 1.2), /modes.INSPECT.scale/],
      ['a subject attenuated below the floor', (c) => (c.modes.INSPECT.others = 0.3), /modes.INSPECT.others/],
      ['context below the floor', (c) => (c.modes.INSPECT.context = 0.5), /modes.INSPECT.context/],
      ['a mode that is always neutral', (c) => (c.modes.ESTABLISH = { scale: 1, lean: 0, others: 1, context: 1, routes: 1 }), /always neutral/],
      ['a missing mode', (c) => delete c.modes.RESOLVE, /modes.RESOLVE is missing/],
      ['another schema', (c) => (c.schema = 'walletwall.attention-direction/v2'), /is not walletwall.attention-direction\/v1/],
      ['a translation beyond the signal', (c) => (c.framing.maxTranslateX = 100), /framing.maxTranslateX/],
      ['a negative lean', (c) => (c.modes.GUIDE.lean = -0.1), /modes.GUIDE.lean/],
      ['an unbounded settle', (c) => (c.settleMs = 5000), /settleMs/],
      ['a non-number', (c) => (c.entrance.routeDrawMs = '420'), /routeDrawMs/],
    ];
    for (const [what, mutate, re] of bad) {
      const c = raw();
      mutate(c);
      assert.throws(() => resolveAttentionConfig(c), (e: unknown) => e instanceof AttentionConfigError && re.test(e.message), what);
    }
  });

  test('is part of the build identity: changing it changes the identity (positive control)', () => {
    const identity = buildIdentity();
    const recorded = identity.configs[ATTENTION_CONFIG_REL];
    assert.match(recorded ?? '', /^[0-9a-f]{64}$/);
    assert.equal(recorded, contentAddress(raw()));
    const edited = raw();
    edited.modes.INSPECT.others = 0.71;
    assert.notEqual(contentAddress(edited), recorded, 'a pixel-affecting edit is a different identity');
  });
});

describe('the mode grammar', () => {
  test('is derived from the beats alone, at the representative frames', () => {
    const expect: [number, string, AttentionMode, string[]][] = [
      [1471, 'tiers', 'GUIDE', ['review']],
      [1630, 'tiers', 'INSPECT', ['vault-candidate']],
      [1673, 'tiers', 'TRANSITION', []],
      [1744, 'signals', 'TRANSITION', []],
      [1774, 'signals', 'ESTABLISH', []],
      [1804, 'signals', 'GUIDE', ['value-at-risk']],
      [1859, 'signals', 'INSPECT', ['wallet-structure']],
      [2053, 'signals', 'GUIDE', ['tier']],
      [2450, 'reading', 'COMPARE', ['reading-band', 'reading-verdict']],
      [2750, 'reading', 'ESTABLISH', []],
      [3154, 'vault-conditional', 'INSPECT', ['vault-testnet']],
      [3387, 'vault-conditional', 'RESOLVE', ['vault-research']],
      [3720, 'takeaway', 'GUIDE', ['takeaway-statement']],
      [3959, 'takeaway', 'RESOLVE', ['takeaway-statement']],
    ];
    for (const [frame, segId, mode, primary] of expect) {
      const s = segmentAt(msOf(frame));
      assert.equal(s.id, segId, `f${frame} is in ${s.id}`);
      const d = directionAt(plan, s.id, msOf(frame));
      assert.equal(d.mode, mode, `f${frame}`);
      assert.deepEqual([...d.primary], primary, `f${frame}`);
    }
  });

  test('the current subject is the latest beat by time, not by index: the top tier\'s INSPECT is not lost to its segment\'s exit cue', () => {
    // tiers: beat #5 INSPECT node:vault-candidate starts after beat #6 PUSH_THROUGH's cue; the push itself begins later.
    const tiers = seg('tiers');
    const inspect = tiers.beats.find((b) => b.beat.action === 'INSPECT')!;
    const push = tiers.beats.find((b) => b.beat.action === 'PUSH_THROUGH')!;
    assert.ok(push.index > inspect.index && push.startMs < inspect.startMs, 'the lesson authors the exit cue before the inspect, by time');
    const d = directionAt(plan, 'tiers', inspect.startMs + 400);
    assert.equal(d.mode, 'INSPECT');
    assert.deepEqual([...d.primary], ['vault-candidate']);
    assert.ok((d.wash['vault-candidate'] ?? 0) > 0.5);
  });

  test('a beat on a whole surface (card:top) or an unknown anchor is ESTABLISH; a traced route makes its destination primary and its source related', () => {
    const reading = seg('reading').scene!;
    assert.deepEqual(subjectsOfAnchor('card:top', reading), { primary: [], related: [], routes: [] });
    assert.deepEqual(subjectsOfAnchor(undefined, reading), { primary: [], related: [], routes: [] });
    assert.deepEqual(subjectsOfAnchor('card:body:reading-band', reading).primary, ['reading-band']);
    const tiers = seg('tiers').scene!;
    assert.deepEqual(subjectsOfAnchor('edge:monitor->review', tiers), { primary: ['review'], related: ['monitor'], routes: ['edge:monitor->review'] });
    assert.deepEqual(subjectsOfAnchor('edge:monitor->monitor', tiers), { primary: ['monitor'], related: [], routes: ['edge:monitor->monitor'] });
    const cast = castOf(seg('signals').scene!);
    assert.deepEqual(cast.context, ['signals-caption', 'tier'], 'a layered scene\'s upper plane is context');
    assert.deepEqual(cast.subjects, ['value-at-risk', 'signature-exposure', 'dormancy', 'wallet-structure']);
    assert.equal(cast.detailOf['tier-detail'], 'tier');
  });

  test('same frame, same input, same state: the plan and every sample are repeatable', () => {
    const again = planAttention(timeline, layouts, clips, attention);
    assert.deepEqual([...again.segments.entries()], [...plan.segments.entries()]);
    assert.deepEqual(again.camera, plan.camera);
    for (const frame of [0, 168, 1471, 1630, 1654, 1804, 1859, 2450, 3154, 3720, 3879, 4068, 4455]) {
      const s = segmentAt(msOf(frame));
      assert.deepEqual(directionAt(plan, s.id, msOf(frame)), directionAt(again, s.id, msOf(frame)));
      assert.deepEqual(cameraAt(plan, msOf(frame)), cameraAt(again, msOf(frame)));
    }
    const text = src('src/attention/direction.ts');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame|setTimeout|process\.|document\.|window\./.test(text), 'no clock, randomness, environment, or DOM');
  });

  test('COMPARE never alternates: both subjects hold the same hierarchy for the whole beat', () => {
    const reading = seg('reading');
    const compare = reading.beats.find((b) => b.beat.action === 'COMPARE')!;
    const next = reading.beats.find((b) => b.startMs > compare.startMs)!;
    let checked = 0;
    for (let ms = compare.startMs; ms < next.startMs; ms += 33) {
      const d = directionAt(plan, 'reading', ms);
      assert.equal(d.mode, 'COMPARE');
      assert.equal(d.wash['reading-band'], d.wash['reading-verdict']);
      assert.equal(d.emphasis['reading-band'], d.emphasis['reading-verdict']);
      checked++;
    }
    assert.ok(checked > 100);
  });

  test('context never becomes unreadable: no element ever falls below the configured floors', () => {
    const floors = { others: 0.5, context: 0.7 };
    for (const s of timeline.segments) {
      const d = plan.segments.get(s.id);
      if (!d) continue;
      for (let ms = s.startMs; ms < s.endMs; ms += 100) {
        const sample = directionAt(plan, s.id, ms);
        for (const id of d.cast.all) {
          const owner = d.cast.detailOf[id] ?? id;
          const floor = d.cast.context.includes(owner) ? floors.context : floors.others;
          assert.ok((sample.emphasis[id] ?? 1) >= floor - 1e-9, `${s.id} ${id} at ${f(ms)}: ${sample.emphasis[id]}`);
        }
      }
    }
  });
});

describe('the bounded editorial camera', () => {
  const cfg = attention.framing;

  test('stays inside its bounds at every frame: scale, coverage, and every text region title-safe and above the content line', () => {
    for (let frame = 0; frame < frames; frame++) {
      const ms = msOf(frame);
      const c = cameraAt(plan, ms);
      assert.ok(c.scale >= 1 && c.scale <= cfg.maxScale, `f${frame} scale ${c.scale}`);
      assert.ok(Math.abs(c.tx) <= Math.min(cfg.maxTranslateX, 960 * (c.scale - 1)) + 1e-6, `f${frame} tx ${c.tx} at scale ${c.scale}`);
      assert.ok(Math.abs(c.ty) <= Math.min(cfg.maxTranslateY, 540 * (c.scale - 1)) + 1e-6, `f${frame} ty ${c.ty} at scale ${c.scale}`);
      const s = segmentAt(ms);
      const layout = layouts.get(s.id);
      if (!layout) continue;
      for (const t of [...layout.texts, { elementId: 'provenance', rect: PROVENANCE_CHIP }]) {
        const r = framedRect(c, t.rect);
        assert.ok(inside(r, TITLE_SAFE), `f${frame} ${s.id} ${t.elementId} leaves title-safe: ${JSON.stringify(r)}`);
        assert.ok(r.y + r.h <= CONTENT_BOTTOM + 1e-6, `f${frame} ${s.id} ${t.elementId} crosses the content line`);
      }
    }
  });

  test('is identity through every transition window and at every segment boundary, and never frames a brand segment', () => {
    for (const s of timeline.segments) {
      assert.ok(isIdentity(cameraAt(plan, s.startMs)), `${s.id} starts at identity`);
      assert.ok(isIdentity(cameraAt(plan, s.endMs - 1)), `${s.id} ends at identity`);
      for (let ms = s.startMs; ms < s.contentStartMs; ms += 10) assert.ok(isIdentity(cameraAt(plan, ms)), `${s.id} transition window at ${f(ms)}`);
      if (!s.scene) for (let ms = s.startMs; ms < s.endMs; ms += 33) assert.equal(framingCss(cameraAt(plan, ms)), 'none', `${s.id} (brand) at ${f(ms)}`);
    }
  });

  test('the end screen is protected: identity and no direction at every frame; its reserved zones are never framed', () => {
    const end = timeline.segments.find((s) => s.role === 'END_SCREEN')!;
    for (let ms = end.startMs; ms < end.endMs; ms += 10) {
      assert.deepEqual(cameraAt(plan, ms), IDENTITY_FRAMING);
      const d = directionAt(plan, end.id, ms);
      assert.equal(d.key, null);
      assert.deepEqual(d.emphasis, {});
    }
    assert.equal(plan.segments.has(end.id), false, 'a brand segment has no direction schedule');
  });

  test('the signature depth transition owns its frames: TRANSITION, identity, no wash or attenuation from the push to the flat frame', () => {
    const push = clips.find((c) => c.kind === 'PUSH')!;
    const into = timeline.segments.find((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER')!;
    // The same range the Blender depth reveal replaces (scripts/review/blender-transition.ts).
    const first = Math.ceil((push.startMs * fps) / 1000);
    const flatAgain = Math.ceil((into.contentStartMs * fps) / 1000);
    assert.ok(flatAgain - first > 60, `${flatAgain - first} transition frames`);
    for (let frame = first; frame <= flatAgain; frame++) {
      const ms = msOf(frame);
      assert.deepEqual(cameraAt(plan, ms), IDENTITY_FRAMING, `f${frame}`);
      const s = segmentAt(ms);
      const d = directionAt(plan, s.id, ms);
      assert.ok(d.mode === 'TRANSITION' || (frame === flatAgain && d.mode === 'ESTABLISH'), `f${frame} ${s.id} ${d.mode}`);
      assert.deepEqual(d.wash, {}, `f${frame} wash`);
      for (const v of Object.values(d.emphasis)) assert.equal(v, 1, `f${frame} attenuation`);
    }
    // And every other non-cut transition: the DEPTH_EXIT out of the depth plane, the SECTION_SHIFT into the tiers.
    for (const s of timeline.segments.filter((x) => x.transitionIn.type !== 'CUT')) {
      const prev = timeline.segments[timeline.segments.indexOf(s) - 1]!;
      for (let ms = s.startMs - attention.settleMs; ms < s.contentStartMs; ms += 10) {
        assert.ok(isIdentity(cameraAt(plan, ms)), `${s.transitionIn.type} into ${s.id} at ${f(ms)}`);
        if (ms >= s.startMs) assert.equal(directionAt(plan, s.id, ms).mode, 'TRANSITION');
        else if (plan.segments.has(prev.id)) assert.equal(directionAt(plan, prev.id, ms).mode, 'TRANSITION', `${prev.id} is fading its effects out at ${f(ms)}`);
      }
      // By the time the transition begins, the outgoing scene has no effect left.
      if (plan.segments.has(prev.id)) {
        const out = directionAt(plan, prev.id, prev.endMs - 1);
        assert.deepEqual(out.wash, {}, `${prev.id} has no wash left as ${s.transitionIn.type} begins`);
        for (const v of Object.values(out.emphasis)) assert.equal(v, 1);
      }
    }
  });

  test('a move is taken only when it can hold still; a RESOLVE holds until the segment\'s return', () => {
    const gap = attention.settleMs + attention.minHoldMs;
    for (let i = 1; i < plan.camera.length; i++) {
      const a = plan.camera[i - 1]!;
      const b = plan.camera[i]!;
      assert.ok(b.required || b.atMs - a.atMs >= gap, `${f(a.atMs)} -> ${f(b.atMs)} could not hold`);
    }
    // The top tier's INSPECT could not hold before the push into depth: not taken, the camera stayed still.
    assert.ok(plan.cameraDropped.some((k) => k.segmentId === 'tiers' && /INSPECT node:vault-candidate/.test(k.reason)));
    for (let ms = seg('tiers').beats.find((b) => b.beat.action === 'INSPECT')!.startMs; ms < seg('tiers').endMs; ms += 33) assert.ok(isIdentity(cameraAt(plan, ms)));
    // The takeaway's RESOLVE: one settle, then nothing moves (camera or hierarchy) until the return before the cut.
    const takeaway = seg('takeaway');
    const resolve = takeaway.beats.find((b) => b.beat.action === 'RESOLVE')!;
    const settled = resolve.startMs + attention.settleMs;
    const ret = plan.camera.find((k) => k.segmentId === 'takeaway' && k.required)!;
    assert.ok(ret.atMs - settled >= attention.minHoldMs, 'a genuine still hold');
    const pose = cameraAt(plan, settled);
    const state = directionAt(plan, 'takeaway', settled);
    assert.ok(pose.scale > 1, 'the conclusion is framed');
    for (let ms = settled; ms < ret.atMs; ms += 10) {
      assert.deepEqual(cameraAt(plan, ms), pose, `camera still at ${f(ms)}`);
      assert.deepEqual(directionAt(plan, 'takeaway', ms), state, `hierarchy still at ${f(ms)}`);
    }
    assert.equal(state.resolved['takeaway-statement'], 1);
  });

  test('a framing is refused, not forced, when the scale alone would push a text region out of title-safe', () => {
    const layout = layouts.get('tiers')!;
    const wide = { ...layout, texts: [...layout.texts, { ...layout.texts[0]!, elementId: 'edge-text', rect: { x: 96, y: 54, w: 1728, h: 20 } as Rect }] };
    const tight = planAttention(timeline, new Map([...layouts.entries(), ['tiers', wide]]), clips, attention);
    const inspect = tight.segments.get('tiers')!.keys.find((k) => k.mode === 'INSPECT')!;
    assert.deepEqual(inspect.framing, IDENTITY_FRAMING);
    assert.match(inspect.framingNote, /refused/);
    // Positive control: the real layout admits the framing (clamped, never beyond the bounds).
    const real = plan.segments.get('tiers')!.keys.find((k) => k.mode === 'INSPECT')!;
    assert.ok(real.framing.scale > 1 && Math.abs(real.framing.tx) <= 960 * (real.framing.scale - 1));
  });
});

describe('what attention direction may never change', () => {
  test('semantic coordinates and support geometry: the plan reads frozen layouts and clips and leaves them byte-identical', () => {
    const freeze = (v: unknown): void => {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const x of Object.values(v as Record<string, unknown>)) freeze(x);
      }
    };
    const before = contentAddress([...layouts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
    const clipsBefore = contentAddress(clips);
    for (const l of layouts.values()) freeze(l);
    for (const c of clips) freeze(c);
    assert.doesNotThrow(() => planAttention(timeline, layouts, clips, attention), 'nothing writes to a layout or a clip');
    assert.equal(contentAddress([...layouts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))), before);
    assert.equal(contentAddress(clips), clipsBefore);
    // The declared terrain and the layouts are exactly what test/terrain-art.test.ts pins as main's.
    const terrains = [...terrainsFor(timeline.segments, layouts).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    assert.equal(contentAddress(terrains), '2be957526f16b5c476f24812e3f336b91fb20d978a58f6718aeeb11c17509e6e');
    assert.equal(before, '986d9087baffb1c727594416c64fb8ca8bd3ad55461fb132fddd02e9e4a02121');
  });

  test('the motion plan does not depend on attention direction, and direction does not read the character', () => {
    const motion = planMotion(clips, layouts);
    const states = [1471, 1804, 3154, 3720, 4059].map((fr) => sampleWallaby(motion, msOf(fr)));
    // The plan was built from the same clips and layouts; the character's feet are where the motion plan puts them, framed or not.
    for (const s of states) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
    const text = src('src/attention/direction.ts');
    assert.ok(!/sampleWallaby|WallabyState|characterless|motion\.ts/.test(text), 'direction reads beats, layouts, and clip windows only');
    assert.match(text, /import type \{ Clip \}/, 'clips enter as a type: only their windows are read');
  });

  test('the character and its support stay registered exactly: one transform about one origin frames the whole content world', () => {
    const motion = planMotion(clips, layouts);
    for (const fr of [168, 212, 1859, 1939, 3154, 3387, 3959]) {
      const c = cameraAt(plan, msOf(fr));
      const s = sampleWallaby(motion, msOf(fr));
      const feet = { x: s.x, y: s.y };
      const support = { x: s.x, y: s.y + 10 };
      const dFeet = applyFraming(c, feet);
      const dSupport = applyFraming(c, support);
      // The same affine map: the offset between feet and support scales uniformly and never shifts.
      assert.ok(Math.abs(dSupport.x - dFeet.x) < 1e-9 && Math.abs(dSupport.y - dFeet.y - 10 * c.scale) < 1e-9, `f${fr}`);
    }
    const docs = src('src/remotion/DocsVideo.tsx');
    const world = docs.indexOf('data-layer="content-world"');
    const fixed = docs.indexOf('The fixed editorial layer');
    assert.ok(world > 0 && fixed > world, 'one content world, then the fixed layer');
    assert.equal((docs.match(/framingCss\(/g) ?? []).length, 1, 'the framing is applied exactly once');
    assert.match(docs, /transform: framingCss\(framing\), transformOrigin: '960px 540px'/);
    // The character (drawn by Blender since the cutover; Rive is retired) is drawn inside the content world, once.
    const at = docs.indexOf('<WallabyBlender');
    assert.ok(at > world && at < fixed && docs.indexOf('<WallabyBlender', at + 1) < 0, '<WallabyBlender is drawn once, inside the content world');
    assert.ok(!docs.includes('<WallabyRive'), 'no Rive path remains');
    for (const tag of ['reveal.dir', 'cue.rows', 'overlays.guides', 'END_SCREEN_ZONES']) assert.ok(docs.lastIndexOf(tag) > fixed, `${tag} is in the fixed layer`);
    // The provenance chip shares the eyebrow row: it rides the world (under the character, as before) and is title-safe-checked.
    const chip = docs.lastIndexOf('PROVENANCE_CHIP');
    assert.ok(chip > world && chip < docs.indexOf('<WallabyBlender') && chip < fixed, 'the chip is in the world, under the character');
    // Scenes never apply a framing of their own: direction only sets opacity, wash, and rule strength.
    const scenes = src('src/remotion/scenes/SceneView.tsx') + src('src/remotion/scenes/common.tsx');
    assert.ok(!/framingCss|cameraAt|scale\(/.test(scenes), 'no transform from direction inside a scene');
  });

  test('the Blender character path and the characterless design test consume the same framing', () => {
    const docs = src('src/remotion/DocsVideo.tsx');
    // One `framing` value, computed from the plan, before the character component; the characterless flag only omits the character.
    assert.match(docs, /const framing = cameraAt\(model\.attention, ms\)/);
    assert.match(docs, /reveal \|\| props\.overlays\.characterless \|\| !props\.characterRenderer \? null : \(/);
    // A staged depth reveal (Blender's full frame) belongs to the transition, which is identity by construction.
    const push = clips.find((c) => c.kind === 'PUSH')!;
    assert.ok(isIdentity(cameraAt(plan, push.startMs)) && isIdentity(cameraAt(plan, push.endMs)));
  });

  test('the characterless lesson is directed identically: the hierarchy and framing come from the lesson, not the character', () => {
    // Nothing in the plan's inputs is the character: the same timeline, layouts, and clips give the same plan whether or not he is drawn.
    const plain = planAttention(timeline, layouts, clips, attention);
    assert.deepEqual([...plain.segments.entries()], [...plan.segments.entries()]);
    for (const s of timeline.segments) if (s.scene) assert.ok(plan.segments.get(s.id)!.keys.some((k) => k.mode !== 'ESTABLISH' && k.mode !== 'TRANSITION'), `${s.id} directs something`);
  });
});

describe('the entrance vocabulary', () => {
  test('a route draws on from its source toward its destination, and a drawn route is exactly the settled drawing', () => {
    assert.equal(routeDrawn(100, undefined, 420), 1, 'no reveal cue: always drawn');
    assert.equal(routeDrawn(99, 100, 420), 0);
    let prev = 0;
    for (let ms = 100; ms <= 520; ms += 20) {
      const v = routeDrawn(ms, 100, 420);
      assert.ok(v >= prev && v >= 0 && v <= 1);
      prev = v;
    }
    assert.equal(routeDrawn(520, 100, 420), 1);
    assert.equal(routeDrawn(1000, 100, 420), 1);
    const scenes = src('src/remotion/scenes/SceneView.tsx');
    assert.match(scenes, /if \(drawn >= 1\) return null;/, 'no clip once drawn: the settled route is untouched');
    assert.match(scenes, /if \(drawn <= 0\) return null;/, 'nothing before its reveal');
  });

  test('the laid-brick settle is unchanged for cards, text, and nodes', () => {
    const style = src('src/remotion/style.ts');
    assert.match(style, /export function settle\(ms: number, revealMs: number \| undefined, durationMs = 380\)/);
    assert.match(style, /translateY\(\$\{\(\(1 - p\) \* 10\)\.toFixed\(2\)\}px\)/);
  });
});
