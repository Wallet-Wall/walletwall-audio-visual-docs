// The quiet WalletWall footer: a fixed editorial element (src/layout/footer.ts, src/remotion/brand/Footer.tsx) that
// teaches nothing and covers nothing. It sits on the title-safe corner, right of the caption band; it never draws
// over captions, teaching content, WalletWallaby, brand copy, or the end screen's reserved zones; it steps aside
// wherever the lesson leaves the flat plane (the depth reveal, the depth exit) and is gone for the outro and end
// screen. It lives outside Motion Intelligence and Blender: it reads the timeline and clip windows only.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { loadAttentionConfig } from '../src/attention/config.ts';
import { cameraAt, framedRect, planAttention } from '../src/attention/direction.ts';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { lessonBridge, lessonMotionWith } from '../src/blender/lesson.ts';
import { revealSeam } from '../src/blender/reveal.ts';
import { choreograph } from '../src/character/walletwallaby/choreography.ts';
import { RIG_ENVELOPE } from '../src/character/walletwallaby/rig/rig-source.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { DOCS_CARD, END_SCREEN_LABEL, END_SCREEN_ZONES, PROVENANCE_CHIP } from '../src/layout/brand-layout.ts';
import { CAPTION_BAND, FOOTER, FOOTER_MARK, FOOTER_TIMING, FOOTER_WORDMARK, FOOTER_WORDMARK_STYLE, footerOpacityAt, planFooter, type FooterPlan } from '../src/layout/footer.ts';
import { easeInOut, FRAME, GROUND_Y, inside, intersects, TITLE_SAFE, type Rect } from '../src/layout/geometry.ts';
import type { SceneLayout } from '../src/layout/scene-layout.ts';
import { estimateWidth } from '../src/layout/text-fit.ts';
import { currentPublicState } from '../src/publish/public-output.ts';
import type { NarrationTrack, TimedSegment, Timeline } from '../src/timeline/timeline.ts';
import { committedSpec, config, scaledTrack, VIDEO_ID } from './helpers.ts';

const spec = committedSpec();
const fixtureTrack = estimateTrack(spec, config.voice, config.lexicon);
const lesson = lessonMotionWith(VIDEO_ID, 'typescript', fixtureTrack);
const { timeline } = lesson;
const fps = timeline.fps;
const msOf = (frame: number): number => (frame * 1000) / fps;
const plan = planFooter(timeline, lesson.motion.clips);
const opacity = (frame: number): number => footerOpacityAt(plan, msOf(frame));
const role = (r: TimedSegment['role']): TimedSegment => timeline.segments.find((s) => s.role === r)!;
const settled = (s: TimedSegment): number => Math.round(((s.contentStartMs + (s.endMs - s.contentStartMs) * 0.72) * fps) / 1000);

describe('the footer: where it sits', () => {
  test('on the title-safe corner, right of the caption band, its mark and wordmark side by side inside it', () => {
    assert.ok(inside(FOOTER, TITLE_SAFE));
    assert.equal(FOOTER.x + FOOTER.w, TITLE_SAFE.x + TITLE_SAFE.w, 'flush with the title-safe right edge');
    assert.equal(FOOTER.y + FOOTER.h, TITLE_SAFE.y + TITLE_SAFE.h, 'flush with the title-safe bottom edge');
    assert.equal(intersects(FOOTER, CAPTION_BAND), false, 'never under a caption');
    assert.ok(inside(FOOTER_MARK, FOOTER) && inside(FOOTER_WORDMARK, FOOTER));
    assert.equal(intersects(FOOTER_MARK, FOOTER_WORDMARK), false);
    assert.ok(estimateWidth(config.templates.footer.onScreen, FOOTER_WORDMARK_STYLE) <= FOOTER_WORDMARK.w, 'the wordmark fits its box (conservative estimate)');
    assert.ok(FOOTER_WORDMARK_STYLE.size * FOOTER_WORDMARK_STYLE.lineHeight <= FOOTER_WORDMARK.h);
  });

  test('clear of every brand template rect, the provenance chip, and the end screen\'s reserved zones', () => {
    for (const [name, r] of Object.entries({ DOCS_CARD, END_SCREEN_LABEL, PROVENANCE_CHIP, ...END_SCREEN_ZONES })) {
      assert.equal(intersects(FOOTER, r), false, name);
    }
  });

  test('its copy is the versioned template\'s, and the public-output gate scans it like any on-screen copy', async () => {
    assert.equal(config.templates.schema, 'walletwall.copy-templates/v2');
    assert.equal(config.templates.footer.id, 'footer.v1');
    assert.equal(config.templates.footer.onScreen, 'WalletWall');
    const state = await currentPublicState(VIDEO_ID, {});
    assert.ok(state.publicCopy.some((c) => c.path === 'config:copy-templates.footer.onScreen' && c.text === 'WalletWall'));
  });
});

describe('the footer: when it shows', () => {
  test('it settles in over the first 400 ms and is fully there on settled teaching and brand frames', () => {
    assert.equal(footerOpacityAt(plan, 0), 0);
    assert.equal(footerOpacityAt(plan, FOOTER_TIMING.fadeInMs), 1);
    for (const r of ['HOOK', 'QUESTION', 'TAKEAWAY', 'DOCS_REFERENCE'] as const) assert.equal(opacity(settled(role(r))), 1, r);
    for (const s of timeline.segments.filter((x) => x.role === 'EXPLANATION' || x.role === 'IMPLICATION')) assert.equal(opacity(settled(s)), 1, s.id);
  });

  test('it steps aside for every depth move: transparent from the push to the flat frame (every staged reveal frame) and through the depth exit', () => {
    const push = lesson.motion.clips.find((c) => c.kind === 'PUSH')!;
    const into = timeline.segments.find((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER')!;
    // The range the Blender depth reveal replaces (src/blender/reveal.ts revealSeam).
    const first = Math.ceil((push.startMs * fps) / 1000);
    const flatAgain = Math.ceil((into.contentStartMs * fps) / 1000);
    for (let f = first; f < flatAgain; f++) assert.equal(opacity(f), 0, `reveal frame ${f}`);
    const exit = timeline.segments.find((s) => s.transitionIn.type === 'DEPTH_EXIT')!;
    for (let f = Math.ceil((exit.startMs * fps) / 1000); f <= Math.floor((exit.contentStartMs * fps) / 1000); f++) assert.equal(opacity(f), 0, `depth exit frame ${f}`);
  });

  test('it never enters Blender: transparent on both frames the depth reveal takes as its layer images, the first flat frame included', () => {
    // scripts/render.ts and scripts/blender-proof.ts render Remotion's characterless frames at seam.first and
    // seam.flatAgain as the reveal's textures; a footer in them would be drawn by Blender, moving with the layer.
    const seam = revealSeam(lesson);
    for (let f = seam.first; f <= seam.flatAgain; f++) assert.equal(opacity(f), 0, `frame ${f} (reveal ${seam.first}..${seam.last}, flat again ${seam.flatAgain})`);
    assert.ok(opacity(seam.flatAgain + 1) > 0, 'and it starts back right after');
  });

  test('it stays on the canonical page and is gone for the end screen, which carries the brand itself', () => {
    const docs = role('DOCS_REFERENCE');
    assert.equal(opacity(settled(docs)), 1, 'the canonical page keeps the footer');
    const end = role('END_SCREEN');
    const frames = Math.round((timeline.totalMs * fps) / 1000);
    for (let f = Math.ceil((end.startMs * fps) / 1000); f < frames; f++) assert.equal(opacity(f), 0, `frame ${f}`);
  });

  test('it never pops: from one frame to the next its opacity moves by at most one step of its fastest ramp', () => {
    const step = 1000 / fps / Math.min(FOOTER_TIMING.fadeInMs, FOOTER_TIMING.stepAsideMs, FOOTER_TIMING.returnMs) + 1e-9;
    const frames = Math.round((timeline.totalMs * fps) / 1000);
    for (let f = 0; f + 1 < frames; f++) assert.ok(Math.abs(opacity(f + 1) - opacity(f)) <= step, `frame ${f}: ${opacity(f)} -> ${opacity(f + 1)}`);
    for (let f = 0; f < frames; f++) assert.ok(opacity(f) >= 0 && opacity(f) <= 1);
  });

  test('a pure function of the timeline and the clip windows: same input, same plan; no clock, randomness, or environment', () => {
    assert.deepEqual(planFooter(timeline, lesson.motion.clips), plan);
    const text = readFileSync(path.join(VIDEO_ROOT, 'src', 'layout', 'footer.ts'), 'utf8');
    assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|process\.|document\.|window\./.test(text), 'no clock, randomness, environment, or DOM');
    assert.ok(!/from '\.\.\/(blender|motion)\//.test(text) && !/motion\.ts'/.test(text), 'nothing from Motion Intelligence or Blender');
    assert.match(text, /import type \{ Clip \}/, 'clips enter as a type: only their windows are read');
  });

  test('the layer images Blender\'s depth reveal is textured with are rendered with the footer off; every other render, the characterless design test included, draws it', () => {
    const video = readFileSync(path.join(VIDEO_ROOT, 'src', 'remotion', 'DocsVideo.tsx'), 'utf8');
    const footer = /<Footer opacity=\{([^}]*\})/.exec(video)?.[1] ?? '';
    assert.equal(footer, 'props.overlays.footer === false ? 0 : footerOpacityAt(model.footer, ms)}', 'only an explicit footer: false turns it off');
    assert.ok(!/characterless/.test(footer), 'the characterless twin keeps the footer, so it differs from its frame only where WalletWallaby was');
    // The three renders that make the reveal's layer images (the footer's timing already keeps it out of those frames).
    for (const [file, pattern] of [
      ['scripts/render.ts', /const bare = withEngine\(buildProps\(spec, source, track, config, \{ captions: false, characterless: true, guides: false, footer: false \}\)\);/],
      ['scripts/blender-proof.ts', /const bare = buildProps\(spec, source, track, config, \{ captions: false, characterless: true, guides: false, footer: false \}\);/],
      ['scripts/review/blender-transition.ts', /const bare = buildProps\(spec, source, track, config, \{ captions: false, characterless: true, guides: false, footer: false \}\);/],
    ] as const) assert.match(readFileSync(path.join(VIDEO_ROOT, file), 'utf8'), pattern, file);
  });

  test('outside Motion Intelligence and Blender: nothing there reads the footer', () => {
    const roots = ['src/blender', 'src/motion', 'src/character', 'motion-intelligence/src', 'blender'];
    const files = roots.flatMap((r) => (readdirSync(path.join(VIDEO_ROOT, r), { recursive: true }) as string[]).map((f) => path.join(VIDEO_ROOT, r, f))).filter((f) => /\.(ts|tsx|rs|py)$/.test(f));
    assert.ok(files.length > 20);
    for (const f of files) assert.ok(!/footer/i.test(readFileSync(f, 'utf8')), path.relative(VIDEO_ROOT, f));
  });
});

/** Everything a segment draws in the content world, in its own coordinates, before the camera and any transition. */
function drawnRects(seg: TimedSegment, layout: SceneLayout | undefined): Rect[] {
  // The ground and the rock under it (its strata, cap, and fracture: 30 px, drawn deeper here to be conservative).
  const ground: Rect = { x: 0, y: GROUND_Y, w: FRAME.width, h: 60 };
  if (!layout) {
    const brand: Partial<Record<TimedSegment['role'], Rect[]>> = { DOCS_REFERENCE: [DOCS_CARD, ground], END_SCREEN: [END_SCREEN_LABEL, ...Object.values(END_SCREEN_ZONES), ground] };
    return brand[seg.role] ?? [];
  }
  const out: Rect[] = [...layout.texts.map((t) => t.rect), PROVENANCE_CHIP];
  for (const p of layout.platforms) out.push(p.rect, { x: p.rect.x, y: p.rect.y + p.rect.h, w: p.rect.w, h: Math.max(0, GROUND_Y + 60 - p.rect.y - p.rect.h) });
  for (const s of layout.slabs) {
    const xs = s.corners.map((c) => c.x);
    const ys = s.corners.map((c) => c.y);
    out.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  for (const r of layout.routes) {
    const xs = r.points.map((p) => p.x);
    const ys = r.points.map((p) => p.y);
    out.push({ x: Math.min(...xs) - 8, y: Math.min(...ys) - 8, w: Math.max(...xs) - Math.min(...xs) + 16, h: Math.max(...ys) - Math.min(...ys) + 16 });
  }
  if (layout.ground) out.push(ground);
  return out;
}

/**
 * Every frame where the footer shows, everything drawn under the same frame (its transition and its camera
 * included) is checked against `footer`: the scenes and brand templates, WalletWallaby's crop, and the captions.
 */
function coverage(track: NarrationTrack, footer: Rect, footerPlan?: (t: Timeline) => FooterPlan): string[] {
  const l = lessonMotionWith(VIDEO_ID, 'typescript', track);
  const t = l.timeline;
  const fp = footerPlan ? footerPlan(t) : planFooter(t, l.motion.clips);
  const attention = planAttention(t, l.layouts as Map<string, SceneLayout>, choreograph(t, l.layouts as Map<string, SceneLayout>), loadAttentionConfig());
  const bridge = lessonBridge(l, 0, l.frames - 1);
  // The staged depth reveal (src/blender/reveal.ts): Blender draws the whole frame from the push to the flat frame.
  const push = l.motion.clips.find((c) => c.kind === 'PUSH');
  const into = push ? t.segments.find((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER') : undefined;
  const found: string[] = [];
  if (intersects(footer, CAPTION_BAND)) found.push('the caption band');
  for (let f = 0; f < l.frames; f++) {
    const ms = (f * 1000) / t.fps;
    if (footerOpacityAt(fp, ms) === 0) continue;
    if (push && into && ms >= push.startMs && ms < into.contentStartMs) found.push(`frame ${f}: shows over the staged depth reveal`);
    const i = Math.max(0, t.segments.findIndex((s) => ms >= s.startMs && ms < s.endMs));
    const seg = t.segments[i]!;
    const prev = t.segments[i - 1];
    const inTransition = Boolean(prev) && ms < seg.contentStartMs;
    const e = inTransition ? easeInOut((ms - seg.startMs) / (seg.contentStartMs - seg.startMs)) : 1;
    const camera = cameraAt(attention, ms);
    const shifted = (r: Rect, dx: number): Rect => ({ ...r, x: r.x + dx });
    const layers: [TimedSegment, number][] = [[seg, inTransition && seg.transitionIn.type === 'SECTION_SHIFT' ? 1920 * (1 - e) : 0]];
    if (inTransition && prev) layers.push([prev, seg.transitionIn.type === 'SECTION_SHIFT' ? -1920 * e : 0]);
    for (const [s, dx] of layers) {
      if (inTransition && (seg.transitionIn.type === 'DEPTH_ENTER' || seg.transitionIn.type === 'DEPTH_EXIT')) found.push(`frame ${f}: shows during a depth transition into ${seg.id}`);
      for (const r of drawnRects(s, l.layouts.get(s.id))) if (intersects(framedRect(camera, shifted(r, dx)), footer)) found.push(`frame ${f}: ${s.id} draws under it`);
    }
    // WalletWallaby's drawn pixels: his envelope, exactly as the ported invariants bound his actual ink
    // (scripts/blender-invariants.ts, check 6). The render crop around it adds only a transparent pad.
    const bf = bridge.frames[f];
    if (bf && bf.visible && bf.place.scale > 0) {
      const s = bf.place.scale;
      const facing = bf.place.facing;
      const xa = bf.place.x + facing * s * RIG_ENVELOPE.minX;
      const xb = bf.place.x + facing * s * RIG_ENVELOPE.maxX;
      const x0 = Math.floor(Math.min(xa, xb));
      const y0 = Math.floor(bf.place.y + s * RIG_ENVELOPE.minY);
      const envelope: Rect = { x: x0, y: y0, w: Math.ceil(Math.max(xa, xb)) - x0, h: Math.ceil(bf.place.y + s * RIG_ENVELOPE.maxY) - y0 };
      if (intersects(framedRect(camera, envelope), footer)) found.push(`frame ${f}: WalletWallaby is under it`);
    }
  }
  return found;
}

describe('the footer covers nothing', () => {
  test('wherever it shows, nothing drawn is under it: text, platforms, slabs, routes, ground, brand copy, WalletWallaby, captions', () => {
    assert.deepEqual(coverage(fixtureTrack, FOOTER), []);
  });

  test('the same holds when the narration runs 20% slower or faster (the timing is structural, not tuned)', () => {
    assert.deepEqual(coverage(scaledTrack(fixtureTrack, 1.2), FOOTER), []);
    assert.deepEqual(coverage(scaledTrack(fixtureTrack, 0.8), FOOTER), []);
  });

  test('and when every line has its own pace, as real narration does (seeded, 0.75x to 1.3x per line)', () => {
    for (const seed of [1, 7, 42]) {
      let s = seed;
      const next = (): number => ((s = (s * 1103515245 + 12345) % 2147483648), s / 2147483648);
      const jittered: NarrationTrack = { ...fixtureTrack, lines: fixtureTrack.lines.map((l) => ({ ...l, durationMs: Math.round(l.durationMs * (0.75 + 0.55 * next())) })) };
      assert.deepEqual(coverage(jittered, FOOTER), [], `seed ${seed}`);
    }
  });

  test('positive controls: the audit bites when the footer would cover the ground WalletWallaby walks, or would show through a depth move', () => {
    const onTheGround: Rect = { x: 1500, y: GROUND_Y - 40, w: 148, h: 32 };
    assert.ok(coverage(fixtureTrack, onTheGround).some((v) => /WalletWallaby is under it/.test(v)));
    assert.ok(coverage(fixtureTrack, onTheGround).some((v) => /draws under it/.test(v)));
    const alwaysOn = (t: Timeline): FooterPlan => ({ totalMs: t.totalMs, hidden: [] });
    assert.ok(coverage(fixtureTrack, FOOTER, alwaysOn).some((v) => /depth transition/.test(v)));
  });
});
