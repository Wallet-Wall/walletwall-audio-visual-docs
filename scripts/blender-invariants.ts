// npm run blender:invariants [-- --every=9] [--lab-every=1]
//   -> dist/blender/out/invariants/report.json; exits 1 if any invariant fails
//
// The rig invariants the Rive runtime proved before the cutover (test/rive-rig.test.ts), ported to the frames the
// pinned Blender actually renders. Every 9th frame of the lesson and every frame of the motion lab (the ledge it hangs
// from and the narrow perch whose edge the tail passes) are rendered in the production crop layout, with each bone's
// projected position recorded by Blender (render.py measure_bones); then, on those frames and their pixels:
//
//   1. every pose is finite;
//   2. grounded feet stay planted (Blender's IK reaches every toe and heel target) with the knees forward;
//   3. the tail rests on the surface where there is one (and is released smoothly), and hangs free past an edge;
//   4. climbing, the paws hold the ledge lip;
//   5. the tail stays bounded: no segment folds back on its neighbour;
//   6. the drawn character stays inside its envelope (its actual pixels, not a bone estimate), and while holding it
//      never overlaps protected text and never leaves title-safe;
//   7. brand colours on the rendered pixels: every opaque pixel is a mix of palette colours, and most are exactly one
//      (src/blender/palette-check.ts);
//   8. shuffled-frame purity: frames rendered in a shuffled order are byte-identical to the same frames in order.
//
// Ported thresholds: feet within 0.05 px of their targets (Rive: 0.01 rig px; Blender's worst over the whole lesson is
// 0.0217 px), the tail's 70 degree joint bound and the paw's 3 px lip tolerance as before (the paw's distance from its
// target, which is the lip, within 3 rig px), and Rive's coverage minimums
// (400 grounded frames, 300 supported holds, 300 scene holds at every 9th frame) scaled to the stride. Not ported (they
// describe the 2D shapes Rive drew, which no longer exist): the belly polygon inside the torso polygon, the underlay
// draw order, and per-shape area retention. The Blender body is pinned instead (BLENDER_CHARACTER) and was passed by
// the owner's visual gate.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { labLesson } from '../src/blender/lab.ts';
import { lessonMotion, type LessonMotion } from '../src/blender/lesson.ts';
import { ensureCharacter, renderCharacterSequence } from '../src/blender/production.ts';
import { BLENDER_JOBS, findBlender, loadBlenderConfig, outFile, runBlender, writeJob } from '../src/blender/toolchain.ts';
import { bridgeFrame, type BlenderMotionFrame } from '../src/character/walletwallaby/blender/bridge.ts';
import { characterCrop } from '../src/character/walletwallaby/blender/crop.ts';
import { resolvePose } from '../src/character/walletwallaby/blender/pose-resolve.ts';
import { blenderRigDocument } from '../src/character/walletwallaby/blender/rig-export.ts';
import { CHARACTER } from '../src/blender/identity.ts';
import { compileRig } from '../src/character/walletwallaby/rig/rig-compile.ts';
import { rigControls } from '../src/character/walletwallaby/rig/rig-controls.ts';
import { RIG_ENVELOPE } from '../src/character/walletwallaby/rig/rig-source.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress } from '../src/core/hash.ts';
import { intersects, TITLE_SAFE, type Rect } from '../src/layout/geometry.ts';
import { EYEBROW_RECT } from '../src/layout/scene-layout.ts';
import { hexRgb, paletteCheck } from '../src/blender/palette-check.ts';
import { readPng, type Image } from './review/png.ts';

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const every = Number(opt('every') ?? '9');
const labEvery = Number(opt('lab-every') ?? '1');
if (!Number.isInteger(every) || every < 1 || !Number.isInteger(labEvery) || labEvery < 1) throw new Error('--every and --lab-every take positive integers');

const FOOT_PX = 0.05;
const TAIL_PX = 0.05;
/** The paw on the lip: Rive's tolerance (3 rig px). Blender's arm, near full reach on the climb, lands within 2.5. */
const PAW_PX = 3;
const LIP_PX = 3;
const TAIL_JOINT_DEG = 70;
const FLIGHT_CLIPS = ['takeoff', 'airborne', 'mantle'];
const TAIL_BONES = ['tail_0', 'tail_1', 'tail_2', 'tail_3', 'tail_4'];
const scaled = (n: number) => Math.floor((n * 9) / every);

const cfg = loadBlenderConfig();
const blender = findBlender(cfg);
ensureCharacter(cfg, blender);
const model = compileRig().model;

interface Shot {
  name: string;
  frame: number;
  sha256: string;
  crop: { x: number; y: number; width: number; height: number };
  contactErrorPx: Record<string, number>;
  bones: Record<string, [number, number, number, number]>;
}
interface Row {
  run: string;
  frame: number;
  bf: BlenderMotionFrame;
  shot: Shot;
  png: Image;
  lesson: LessonMotion;
}

const failures: { check: string; run: string; frame: number; detail: string }[] = [];
const counts: Record<string, number> = {};
/** Frames the support judge refuses to bridge (only the synthetic lab has any): excluded, and listed in the report. */
const excluded: Record<string, number[]> = {};
const fail = (check: string, r: { run: string; frame: number }, detail: string) => failures.push({ check, run: r.run, frame: r.frame, detail });
const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

/** Render (always anew, with measurements) and load every measured frame of a lesson. */
function measuredRun(run: string, lesson: LessonMotion, step: number): Row[] {
  const bridgeable = (i: number): boolean => {
    const { state, segment, onScreen } = lesson.sample(i);
    try {
      bridgeFrame(model, i, segment, state, onScreen);
      return true;
    } catch {
      (excluded[run] ??= []).push(i);
      return false;
    }
  };
  const frames = Array.from({ length: lesson.frames }, (_, i) => i).filter((i) => i % step === 0 && lesson.sample(i).state.visible && bridgeable(i));
  const name = `invariants-${run}`;
  const r = renderCharacterSequence(cfg, blender, { lesson, name, layout: 'crop', frames, measure: true });
  console.log(`[invariants] ${run}: ${r.frames} frames in ${(r.ms / 1000).toFixed(1)} s`);
  const manifest = JSON.parse(readFileSync(outFile(`renders/${name}/render.json`), 'utf8')) as { shots: Shot[] };
  const bridge = JSON.parse(readFileSync(outFile(`renders/${name}/bridge.json`), 'utf8')) as { frames: BlenderMotionFrame[] };
  const byFrame = new Map(bridge.frames.map((f) => [f.frame, f]));
  return manifest.shots.map((shot) => ({ run, frame: shot.frame, bf: byFrame.get(shot.frame)!, shot, png: readPng(outFile(`renders/${name}/${shot.name}.png`)), lesson }));
}

/** The drawn pixels' bounds in frame px (alpha above 8/255), or null for an empty crop. */
function inkRect(row: Row): Rect | null {
  const { png, shot } = row;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3]! > 8) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x: shot.crop.x + x0, y: shot.crop.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const rigDoc = blenderRigDocument(model) as unknown as { palette: Record<string, string> };
const visual = (cfg as unknown as { visual: { palette: Record<string, string>; contactShadow: { color: string } } }).visual;
// The colours the materials emit (build.py): the rig's coat, its shade and ink, the lane's warm stone in place of cream
// and its glint, and the warm umber contact shadow (opaque where it lies under the feet's ink).
const PALETTE = [rigDoc.palette.coat!, rigDoc.palette.coatShade!, rigDoc.palette.ink!, visual.palette.accent!, visual.palette.accentShade!, visual.palette.glint!, visual.contactShadow.color].map(hexRgb);
const palette = paletteCheck(PALETTE);
/** Opaque pixels outside every mix of palette colours, per frame (measured: 0 of 11 million). */
const MAX_OFF_HULL = 1e-4;
/** Opaque pixels that are exactly a palette colour, per frame (two flat tones per surface; measured worst 44.6%). */
const MIN_EXACT = 0.3;
const TAIL_BLEND_PX = 2;


const lesson = await lessonMotion('migration-readiness');
const lab = labLesson();
const rows = [...measuredRun('lesson', lesson, every), ...measuredRun('lab', lab, labEvery)];
let opaque = 0;
let off = 0;
let exactPx = 0;
let worstExact = 1;

for (const row of rows) {
  const { bf, shot } = row;
  const state = row.lesson.sample(row.frame).state;
  const controls = rigControls(state);
  const resolved = resolvePose(model, controls);
  // 1. Finite.
  count('frames');
  if (Object.values(shot.bones).some((b) => b.some((v) => !Number.isFinite(v)))) fail('finite', row, 'a bone is not finite');
  const facing = bf.place.facing;
  const local = (p: [number, number]): [number, number] => [facing * (p[0] - bf.place.x), p[1]];
  const head = (b: string) => local([shot.bones[b]![0], shot.bones[b]![1]]);
  const tail = (b: string) => local([shot.bones[b]![2], shot.bones[b]![3]]);
  // 2. Planted feet, knees forward.
  const flight = Object.entries(bf.pose.clips).some(([c, w]) => FLIGHT_CLIPS.includes(c) && (w ?? 0) > 0);
  if (bf.semantic.contact !== 'NONE' && !flight && bf.pose.ik.legs >= 0.999) {
    count(`${row.run}.grounded`);
    for (const t of ['target_toe_n', 'target_heel_n', 'target_toe_f', 'target_heel_f']) {
      const e = shot.contactErrorPx[t];
      if (e === undefined || e > FOOT_PX) fail('planted', row, `${t} ${e === undefined ? 'not solved' : `${e} px`} from its target`);
    }
    const [hip, knee, ankle] = [head('thigh_n'), head('shin_n'), head('foot_n')];
    const cross = (ankle[0] - hip[0]) * (knee[1] - hip[1]) - (ankle[1] - hip[1]) * (knee[0] - hip[0]);
    if (!(cross < 0)) fail('knee forward', row, `cross ${cross.toFixed(3)}`);
  }
  // 3. The tail rests where there is a surface (released smoothly), and hangs free past an edge.
  if (row.run === 'lesson' && bf.semantic.phase === 'HOLD' && (bf.pose.clips.inspect ?? 0) === 0 && resolved.tailSupport >= 1) {
    count('lesson.supportedHolds');
    if (resolved.tailFree > 0.05) count('lesson.heldClear');
    else if (bf.pose.ik.tail >= 0.999 ? (shot.contactErrorPx.target_tail ?? Infinity) <= TAIL_PX : Math.abs(shot.bones.tail_4![3] - (bf.place.y + bf.place.scale * bf.pose.targets.target_tail[1])) <= TAIL_BLEND_PX) count('lesson.resting');
    else fail('tail rest', row, `supported and not released, yet not resting (tail IK ${bf.pose.ik.tail}, error ${shot.contactErrorPx.target_tail})`);
  }
  if (row.run === 'lab' && bf.semantic.action === 'PERCH' && resolved.tailSupport === 0) {
    count('lab.unsupportedPerch');
    if (resolved.tailFree !== 1 || bf.pose.ik.tail !== 0) fail('tail release', row, `tail free ${resolved.tailFree}, tail IK ${bf.pose.ik.tail}`);
    if (shot.contactErrorPx.target_tail !== undefined) fail('tail release', row, 'the tail was solved onto a target past the edge');
  }
  // 4. Climbing, the paws hold the lip.
  if (bf.semantic.phase === 'HANG') {
    count(`${row.run}.hang`);
    const lip: [number, number] = [controls.grip![0] + 6, controls.grip![1] - 4];
    const target = bf.pose.targets.target_paw_n;
    if (Math.hypot(target[0] - lip[0], target[1] - lip[1]) >= LIP_PX) fail('paw on lip', row, `target ${target} is not the lip ${lip}`);
    const e = shot.contactErrorPx.target_paw_n;
    if (e === undefined || e > PAW_PX * bf.place.scale) fail('paw on lip', row, `the paw is ${e} px from its target`);
  }
  // 5. The tail never folds.
  const angles = TAIL_BONES.map((b) => {
    const [h, t] = [head(b), tail(b)];
    return Math.atan2(t[1] - h[1], t[0] - h[0]);
  });
  for (let i = 1; i < angles.length; i++) {
    let d = Math.abs(angles[i]! - angles[i - 1]!);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d >= (TAIL_JOINT_DEG * Math.PI) / 180) fail('tail bounded', row, `joint ${i} bends ${((d * 180) / Math.PI).toFixed(1)} deg`);
  }
  // 6. Inside the envelope; while holding, off protected text and inside title-safe.
  const ink = inkRect(row);
  if (ink) {
    const s = bf.place.scale;
    const xa = bf.place.x + facing * s * RIG_ENVELOPE.minX;
    const xb = bf.place.x + facing * s * RIG_ENVELOPE.maxX;
    const env = { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: bf.place.y + s * RIG_ENVELOPE.minY, y1: bf.place.y + s * RIG_ENVELOPE.maxY };
    if (ink.x < Math.floor(env.x0) || ink.x + ink.w > Math.ceil(env.x1) || ink.y < Math.floor(env.y0) || ink.y + ink.h > Math.ceil(env.y1)) fail('envelope', row, `ink ${JSON.stringify(ink)} leaves ${JSON.stringify(env)}`);
    const ms = (row.frame * 1000) / row.lesson.timeline.fps;
    const seg = row.lesson.timeline.segments.find((x) => ms >= x.startMs && ms < x.endMs);
    if (row.run === 'lesson' && bf.semantic.phase === 'HOLD' && seg?.scene && ms >= seg.contentStartMs) {
      count('lesson.sceneHolds');
      const texts = [...(row.lesson.layouts.get(seg.id)?.texts.map((t) => t.rect) ?? []), EYEBROW_RECT];
      for (const r of texts) if (intersects(ink, r)) fail('protected text', row, `ink ${JSON.stringify(ink)} over ${JSON.stringify(r)}`);
      if (ink.x < TITLE_SAFE.x || ink.x + ink.w > TITLE_SAFE.x + TITLE_SAFE.w || ink.y < TITLE_SAFE.y || ink.y + ink.h > TITLE_SAFE.y + TITLE_SAFE.h) fail('title-safe', row, `ink ${JSON.stringify(ink)}`);
    }
  }
  // 7. Brand colours on the rendered pixels.
  let frameOpaque = 0;
  let frameOff = 0;
  let frameExact = 0;
  for (let i = 0; i < row.png.data.length; i += 4) {
    if (row.png.data[i + 3] !== 255) continue;
    frameOpaque++;
    const [r, g, b] = [row.png.data[i]!, row.png.data[i + 1]!, row.png.data[i + 2]!];
    if (palette.exact(r, g, b)) frameExact++;
    else if (!palette.inHull(r, g, b)) frameOff++;
  }
  opaque += frameOpaque;
  off += frameOff;
  exactPx += frameExact;
  if (frameOpaque > 0) {
    worstExact = Math.min(worstExact, frameExact / frameOpaque);
    if (frameOff / frameOpaque > MAX_OFF_HULL) fail('brand colours', row, `${frameOff} opaque pixels are no mix of palette colours`);
    if (frameExact / frameOpaque < MIN_EXACT) fail('brand colours', row, `only ${((frameExact / frameOpaque) * 100).toFixed(1)}% of opaque pixels are exact palette colours: the flat two-tone shading has gone`);
  }
}

// Coverage, as the Rive tests required it (scaled to the stride).
const need: [string, number][] = [
  ['lesson.grounded', scaled(400)],
  ['lesson.supportedHolds', scaled(300)],
  ['lesson.sceneHolds', scaled(300)],
  ['lab.unsupportedPerch', Math.floor(10 / labEvery)],
  ['lab.hang', Math.floor(2 / labEvery)],
];
for (const [k, n] of need) if ((counts[k] ?? 0) < Math.max(1, n)) failures.push({ check: 'coverage', run: k.split('.')[0]!, frame: -1, detail: `${k}: ${counts[k] ?? 0} frames checked, at least ${Math.max(1, n)} needed` });
const supported = counts['lesson.supportedHolds'] ?? 0;
if (supported > 0 && (counts['lesson.heldClear'] ?? 0) / supported >= 0.1) failures.push({ check: 'tail rest', run: 'lesson', frame: -1, detail: `the tail is released on ${counts['lesson.heldClear']} of ${supported} supported holds` });

// 8. Shuffled-frame purity: some measured lesson frames again, in a shuffled order, in one fresh process.
const lessonRows = rows.filter((r) => r.run === 'lesson');
const sample = lessonRows.filter((_, i) => i % Math.max(1, Math.floor(lessonRows.length / 12)) === 0).slice(0, 12);
const order = [...sample];
let seed = 12345;
for (let i = order.length - 1; i > 0; i--) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  const j = seed % (i + 1);
  [order[i], order[j]] = [order[j]!, order[i]!];
}
const shuffledDir = 'renders/invariants-shuffled';
mkdirSync(outFile(shuffledDir), { recursive: true });
const bridge = JSON.parse(readFileSync(outFile('renders/invariants-lesson/bridge.json'), 'utf8'));
const job = writeJob('render.invariants-shuffled', {
  schema: 'walletwall.blender-job/v1',
  kind: 'render',
  config: cfg,
  rig: blenderRigDocument(model),
  blend: CHARACTER.blend,
  bridge,
  terrain: JSON.parse(readFileSync(path.join(BLENDER_JOBS, 'render.invariants-lesson.json'), 'utf8')).terrain,
  shots: order.map((r) => ({ name: r.shot.name, frame: r.frame, camera: { kind: 'crop', ...characterCrop(r.bf, RIG_ENVELOPE, (cfg.render as unknown as { crop: { padPx: number } }).crop.padPx, { width: cfg.render.resolution[0], height: cfg.render.resolution[1] })! } })),
  outputs: { dir: shuffledDir, manifest: `${shuffledDir}/render.json` },
});
runBlender(blender, cfg, 'render.py', job);
const shuffled = JSON.parse(readFileSync(outFile(`${shuffledDir}/render.json`), 'utf8')) as { shots: { frame: number; sha256: string }[] };
for (const s of shuffled.shots) {
  count('shuffled');
  const inOrder = sample.find((r) => r.frame === s.frame)!;
  if (s.sha256 !== inOrder.shot.sha256) fail('shuffled purity', { run: 'lesson', frame: s.frame }, 'the frame differs when rendered in another order');
}

const report = {
  schema: 'walletwall.blender-invariants/v1',
  every,
  labEvery,
  lessonBridgeSha256: contentAddress(bridge),
  thresholds: { footPx: FOOT_PX, tailPx: TAIL_PX, tailBlendPx: TAIL_BLEND_PX, pawPx: PAW_PX, lipPx: LIP_PX, tailJointDeg: TAIL_JOINT_DEG, maxOffHull: MAX_OFF_HULL, minExact: MIN_EXACT },
  counts,
  excluded,
  palette: { colours: PALETTE, opaquePixels: opaque, offHull: off, exactFraction: opaque ? +(exactPx / opaque).toFixed(4) : null, worstFrameExact: +worstExact.toFixed(4) },
  failuresByCheck: failures.reduce<Record<string, number>>((m, f) => ((m[f.check] = (m[f.check] ?? 0) + 1), m), {}),
  pass: failures.length === 0,
  failures: failures.slice(0, 100),
  failureCount: failures.length,
};
mkdirSync(outFile('invariants'), { recursive: true });
writeFileSync(outFile('invariants/report.json'), prettyJson(report));
console.log(`[invariants] ${report.pass ? 'PASS' : 'FAIL'}: ${JSON.stringify(counts)}; palette: ${off} off-hull, ${report.palette.exactFraction} exact (worst frame ${report.palette.worstFrameExact}); ${failures.length} failures -> dist/blender/out/invariants/report.json`);
for (const f of failures.slice(0, 20)) console.log(`  ${f.check} ${f.run} ${f.frame}: ${f.detail}`);
process.exit(report.pass ? 0 : 1);
