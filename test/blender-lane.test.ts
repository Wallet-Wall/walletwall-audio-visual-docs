// The Blender presentation lane, without Blender: what the lane is handed and
// how it may run. The pose it receives is exactly the Rive player's own pose
// (pre-IK) on the real runtime; every grounded frame of the lesson stands on a
// declared supporting top; the bridge refuses anything that is not exactly v1
// (each refusal with a positive control); the toolchain is pinned to one build
// with fixed arguments and confined jobs; and the lane's Python cannot reach a
// shell, the network, or arbitrary code. Blender itself is exercised by
// `npm run blender:check` (docs/BLENDER.md), which needs the pinned build.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { BLENDER_MOTION_SCHEMA, bridgeFrame, BlenderBridgeError, PLANE_ORIGIN, UNITS_PER_PX, validateBridge, type BlenderMotionDocument } from '../src/character/walletwallaby/blender/bridge.ts';
import { resolvePose } from '../src/character/walletwallaby/blender/pose-resolve.ts';
import { blenderRigDocument } from '../src/character/walletwallaby/blender/rig-export.ts';
import { terrainSegment } from '../src/character/walletwallaby/blender/terrain-export.ts';
import { choreograph, layoutsFor, mouthAt } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby } from '../src/character/walletwallaby/motion.ts';
import { compileRig } from '../src/character/walletwallaby/rig/rig-compile.ts';
import { rigControls } from '../src/character/walletwallaby/rig/rig-controls.ts';
import { RIG_BONES } from '../src/character/walletwallaby/rig/rig-source.ts';
import { BLENDER_LANE_DIR, blenderSourceSha256, loadBlenderConfig, REQUIRED_ARGS, runBlender, writeJob } from '../src/blender/toolchain.ts';
import { environmentClass, loadEnvironments } from '../src/blender/identity.ts';
import { characterProofFrames } from '../src/blender/proof-set.ts';
import { contentAddress } from '../src/core/hash.ts';
import { assertPinnedCharacter, BlenderProductionError } from '../src/blender/production.ts';
import { hexRgb, paletteCheck } from '../src/blender/palette-check.ts';
import { BLENDER_CHARACTER } from '../src/character/walletwallaby/versions.ts';
import { characterCrop, interiorEdges } from '../src/character/walletwallaby/blender/crop.ts';
import { RIG_ENVELOPE } from '../src/character/walletwallaby/rig/rig-source.ts';
import { terrainsFor } from '../src/layout/terrain.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

/** Captured 2026-10-18 while the Rive runtime parity test passed in the same run (see below). */
const RESOLVED_POSES_PIN = 'f8e79d0b1c2cbc3588d6f09a5e0273537624a2a009970ac0730988f783d7467a';
const RIG_DOCUMENT_PIN = 'cd49bd326c3fe914e57f7f5123ba65489282357fc022d2ea90e411d6d9e4cc38';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const plan = planMotion(choreograph(timeline, layouts), layouts);
const terrains = terrainsFor(timeline.segments, layouts);
const model = compileRig().model;
const frames = Math.floor((timeline.totalMs * timeline.fps) / 1000);
const at = (f: number) => {
  const ms = (f * 1000) / timeline.fps;
  const clip = plan.clips.find((c) => ms >= c.startMs && ms < c.endMs) ?? plan.clips[plan.clips.length - 1]!;
  const i = timeline.segments.findIndex((s) => s.id === clip.segmentId);
  const ids = [clip.segmentId];
  if (i > 0 && ms < timeline.segments[i]!.contentStartMs) ids.push(timeline.segments[i - 1]!.id);
  return { state: sampleWallaby(plan, ms, mouthAt(timeline, ms)), segment: clip.segmentId, onScreen: ids.flatMap((id) => (terrains.get(id) ? [terrains.get(id)!] : [])) };
};
const doc = (first: number, last: number): BlenderMotionDocument => ({
  schema: BLENDER_MOTION_SCHEMA,
  videoId: 'migration-readiness',
  fps: timeline.fps,
  range: { first, last },
  motionEngine: 'typescript:test',
  coordinates: { unitsPerPx: UNITS_PER_PX, planeOrigin: { ...PLANE_ORIGIN } },
  frames: Array.from({ length: last - first + 1 }, (_, i) => {
    const { state, segment, onScreen } = at(first + i);
    return bridgeFrame(model, first + i, segment, state, onScreen);
  }),
});

describe('the Blender bridge carries the decisions, not new ones', () => {
  // The Rive runtime was retired after it proved, frame for frame, that resolvePose is the pose its player would have
  // drawn (a parity test on the real runtime, until the cutover; these pins were captured in the same run, in the commit
  // before the runtime was removed). These pins freeze what it proved: the resolved pose of every 23rd frame
  // of the lesson, and the rig document Blender builds the character from. A change to either is a declared rig change.
  test('the resolved pose and the rig document are the ones the Rive runtime proved (pinned)', () => {
    const round = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
    const poses = [];
    for (let f = 0; f < frames; f += 23) {
      const { state } = at(f);
      if (state.visible) poses.push({ frame: f, pose: round(resolvePose(model, rigControls(state))) });
    }
    assert.equal(contentAddress(poses), RESOLVED_POSES_PIN, `${poses.length} resolved poses`);
    assert.equal(contentAddress(blenderRigDocument(model)), RIG_DOCUMENT_PIN);
  });

  test('positive control: a 0.01 degree change in one bone is caught', () => {
    const { state } = at(1850);
    const controls = rigControls(state);
    const a = resolvePose(model, controls);
    const b = resolvePose(model, { ...controls, head: { deg: controls.head.deg + 0.01 } });
    assert.ok(Math.abs(a.rot.head - b.rot.head) > 1e-4);
  });

  test('every visible frame of the lesson stands on a declared supporting top or is in the air', () => {
    const d = doc(0, frames - 1);
    const grounded = d.frames.filter((f) => f.visible && f.semantic.contact !== 'NONE');
    assert.ok(grounded.length > 3000, `${grounded.length} grounded frames`);
    const onStage = grounded.filter((f) => !f.semantic.offStage);
    assert.ok(grounded.length - onStage.length < 40, `${grounded.length - onStage.length} grounded frames off stage`);
    for (const f of onStage) assert.ok(f.semantic.surface && ['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE'].includes(f.semantic.surface.support), `frame ${f.frame}`);
    // Off stage means outside the frame, and only there.
    for (const f of grounded.filter((x) => x.semantic.offStage)) assert.ok(f.place.x < 0 || f.place.x > 1920 || f.place.y < 0 || f.place.y > 1080, `frame ${f.frame}`);
    assert.doesNotThrow(() => validateBridge(JSON.parse(JSON.stringify(d))));
  });

  test('a grounded frame with no declared top under it is refused (positive control: the real terrain passes)', () => {
    const { state, segment, onScreen } = at(1850);
    assert.doesNotThrow(() => bridgeFrame(model, 1850, segment, state, onScreen));
    assert.throws(() => bridgeFrame(model, 1850, segment, state, [{ surfaces: [], protectedText: [] }]), BlenderBridgeError);
  });

  test('the bridge refuses anything that is not exactly v1', () => {
    const good = doc(1840, 1845);
    assert.doesNotThrow(() => validateBridge(JSON.parse(JSON.stringify(good))));
    // A subset of the range (review stills, the proof set, some frames of a reveal) is a bridge too.
    const subset = JSON.parse(JSON.stringify(good));
    subset.frames.splice(2, 2);
    assert.doesNotThrow(() => validateBridge(subset));
    const bad: [string, (d: Record<string, any>) => void][] = [
      ['unknown top-level field', (d) => (d.python = 'import os')],
      ['unknown frame field', (d) => (d.frames[0].script = 'x')],
      ['no frames', (d) => (d.frames = [])],
      ['a repeated frame', (d) => (d.frames[2] = JSON.parse(JSON.stringify(d.frames[1])))],
      ['frames out of order', (d) => d.frames.reverse()],
      ['a frame outside the range', (d) => (d.range.last = 1844)],
      ['more frames than the range holds', (d) => (d.range.first = 1841)],
      ['non-finite rotation', (d) => (d.frames[1].pose.rot.head = Number.NaN)],
      ['an unknown clip', (d) => (d.frames[1].pose.clips = { dance: 1 })],
      ['clip weights not summing to 1', (d) => (d.frames[1].pose.clips = { idle_alert: 0.5 })],
      ['an IK strength above 1', (d) => (d.frames[1].pose.ik.legs = 1.5)],
      ['a target across the frame', (d) => (d.frames[1].pose.targets.target_toe_n = [900, 0])],
      ['a path-like segment id', (d) => (d.frames[1].segment = '../../etc')],
      ['a grounded frame on nothing', (d) => (d.frames[1].semantic.surface = null)],
      ['a missing off-stage flag', (d) => delete d.frames[1].semantic.offStage],
      ['another schema', (d) => (d.schema = 'walletwall.blender-motion/v2')],
      ['another unit scale', (d) => (d.coordinates.unitsPerPx = 1)],
    ];
    for (const [what, mutate] of bad) {
      const d = JSON.parse(JSON.stringify(good));
      mutate(d);
      assert.throws(() => validateBridge(d), BlenderBridgeError, what);
    }
  });

  test('production draws only the pinned character: another model or materials is refused (positive control: the pin passes)', () => {
    const pinned = { schema: 'walletwall.blender-model/v1' as const, modelVersion: BLENDER_CHARACTER.modelVersion, materialsVersion: BLENDER_CHARACTER.materialsVersion, modelSha256: BLENDER_CHARACTER.modelSha256, modelRealizationSha256: 'f'.repeat(64), materialsSha256: BLENDER_CHARACTER.materialsSha256, blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c' };
    assert.doesNotThrow(() => assertPinnedCharacter(pinned));
    for (const change of [{ modelSha256: 'a'.repeat(64) }, { modelVersion: 2 }, { materialsSha256: 'b'.repeat(64) }, { materialsVersion: 1 }]) {
      assert.throws(() => assertPinnedCharacter({ ...pinned, ...change }), BlenderProductionError, JSON.stringify(change));
    }
  });

  test('brand colours: palette colours and their mixes pass; a highlight, a tint, or a foreign hue does not', () => {
    const p = paletteCheck(['#BA6F38', '#9D6136', '#2B2B2E', '#E9D3AD', '#B99568', '#562E28'].map(hexRgb));
    assert.ok(p.exact(186, 111, 56) && p.inHull(186, 111, 56), 'the coat itself');
    assert.ok(!p.exact(106, 69, 49) && p.inHull(106, 69, 49), 'an antialiased edge between the coat shade and the ink (a mix in linear light)');
    for (const [r, g, b, what] of [[255, 255, 255, 'a white highlight'], [80, 120, 200, 'a blue tint'], [90, 160, 80, 'green'], [200, 60, 60, 'a saturated red'], [250, 240, 200, 'paler than the stone']] as const) {
      assert.equal(p.inHull(r, g, b), false, what);
    }
  });

  test('declared terrain becomes blocks under the same surface ids the judge uses', () => {
    const seg = terrainSegment('signals', terrains.get('signals')!);
    const ids = seg.blocks.flatMap((b) => b.surfaceIds);
    for (const s of terrains.get('signals')!.surfaces.filter((x) => x.face !== 'LINE')) assert.ok(ids.includes(s.id), s.id);
    for (const b of seg.blocks) assert.ok(b.x1 > b.x0 && b.y1 > b.y0, b.element);
    // Routes are information: exported only as lines, never as blocks.
    for (const l of seg.lines) assert.ok(!seg.blocks.some((b) => b.element === l.id.split('#')[0]), l.id);
  });

  test('the rig export is the rig contract, with the palette resolved from the brand contract', () => {
    const rig = blenderRigDocument(model);
    assert.deepEqual(rig.bones.map((b) => b.name), [...RIG_BONES]);
    for (const c of Object.values(rig.palette)) assert.match(c, /^#[0-9A-Fa-f]{6}$/);
    assert.equal(rig.palette.coat.toLowerCase(), '#ba6f38', 'the coat is WalletWallrus\'s own');
  });
});

describe('character crops and the proof set', () => {
  const frameSize = { width: 1920, height: 1080 };
  const lesson = doc(0, frames - 1);

  test('every crop is integer, inside the frame, decided by the placement alone, and holds the whole envelope', () => {
    for (const f of lesson.frames) {
      const c = characterCrop(f, RIG_ENVELOPE, 40, frameSize);
      if (!f.visible) {
        assert.equal(c, null);
        continue;
      }
      if (c === null) continue;
      for (const v of [c.x, c.y, c.width, c.height]) assert.ok(Number.isInteger(v), `frame ${f.frame}`);
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.width <= 1920 && c.y + c.height <= 1080, `frame ${f.frame}`);
      // Recomputing gives the same bounds (no state, no growth).
      assert.deepEqual(characterCrop(f, RIG_ENVELOPE, 40, frameSize), c);
      // Where the crop is not clamped by the frame, it contains the padded envelope at this placement.
      const { x, y, scale: s, facing } = f.place;
      const xs = [x + facing * s * (RIG_ENVELOPE.minX - 40), x + facing * s * (RIG_ENVELOPE.maxX + 40)];
      const e = interiorEdges(c, frameSize);
      if (e.left) assert.ok(c.x <= Math.min(...xs), `frame ${f.frame} left`);
      if (e.right) assert.ok(c.x + c.width >= Math.max(...xs), `frame ${f.frame} right`);
      if (e.top) assert.ok(c.y <= y + s * (RIG_ENVELOPE.minY - 40), `frame ${f.frame} top`);
      if (e.bottom) assert.ok(c.y + c.height >= y + s * (RIG_ENVELOPE.maxY + 40), `frame ${f.frame} bottom`);
    }
  });

  test('a crop needs a visible frame and a non-negative pad; a frame wholly outside the picture has none', () => {
    const f = lesson.frames[1850]!;
    assert.throws(() => characterCrop(f, RIG_ENVELOPE, -1, frameSize));
    assert.equal(characterCrop({ ...f, place: { ...f.place, x: 5000 } }, RIG_ENVELOPE, 40, frameSize), null);
    assert.equal(characterCrop({ ...f, visible: false }, RIG_ENVELOPE, 40, frameSize), null);
  });

  test('the proof set is chosen by fixed rules from the lesson, the same every time', () => {
    const a = characterProofFrames(lesson, 40, { first: 1719, last: 1814 });
    const b = characterProofFrames(JSON.parse(JSON.stringify(lesson)), 40, { first: 1719, last: 1814 });
    assert.deepEqual(a, b);
    const at = (n: number) => lesson.frames[n]!.semantic;
    assert.equal(at(a.idle).action, 'IDLE');
    assert.equal(at(a.crouch).phase, 'PRELOAD');
    assert.equal(at(a.airborne).contact, 'NONE');
    assert.equal(at(a.landing).phase, 'CONTACT');
    assert.ok(at(a['tail-brace']).landingImpulse > 0.9);
    assert.equal(at(a.inspect).action, 'INSPECT');
    for (const n of Object.values(a)) assert.ok(n < 1719 || n > 1814, 'character roles stay outside the reveal');
  });
});

describe('render-environment classes and tolerances', () => {
  const cfg = loadBlenderConfig();
  const envs = loadEnvironments();
  const rtx = { os: 'windows', blenderVersion: '5.2.2 LTS', blenderBuildHash: 'd13f752e3b9c', engine: 'BLENDER_EEVEE', gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 616.56', deviceType: 'NVIDIA' } };
  const soft = { ...rtx, os: 'linux', gpu: { backend: 'OPENGL', vendor: 'Mesa', renderer: 'llvmpipe (LLVM 21.1.8, 256 bits)', version: '4.5 (Core Profile) Mesa 26.0.3', deviceType: 'SOFTWARE' } };

  test('a render is matched to the approved class it was made in, and only one with a publication purpose can publish', () => {
    assert.equal(environmentClass(rtx, cfg, envs).approvedAs?.purpose, 'publication');
    assert.equal(environmentClass(soft, cfg, envs).approvedAs?.purpose, 'proof');
    // Positive control: another driver is another class, not approved.
    assert.equal(environmentClass({ ...rtx, gpu: { ...rtx.gpu, version: '4.6.0 NVIDIA 617.00' } }, cfg, envs).approvedAs, null);
    assert.notEqual(environmentClass(rtx, cfg, envs).id, environmentClass(soft, cfg, envs).id);
  });

  test('every pinned tolerance is above what was measured, and none lets a pixel appear or vanish', () => {
    const all = [envs.crossClassTolerance.character, envs.crossClassTolerance.scene, envs.cropEquivalenceTolerance] as (typeof envs.cropEquivalenceTolerance & { measured: { fractionOverNoise: number; meanAbsDelta: number } })[];
    for (const t of all) {
      assert.ok(t.maxFractionOverNoise > t.measured.fractionOverNoise && t.maxMeanAbsDelta > t.measured.meanAbsDelta);
      assert.equal(t.maxCoverageDeltaPx, 0);
      assert.equal(t.noiseLevel, 2);
    }
    assert.equal(envs.sameClass, 'byte-identical');
  });
});

describe('the Blender toolchain boundary', () => {
  test('the config pins one build, EEVEE, exact colour management, no dither, and the fixed arguments', () => {
    const cfg = loadBlenderConfig();
    assert.match(cfg.blender.version, /^\d+\.\d+\.\d+$/);
    assert.match(cfg.blender.buildHash, /^[0-9a-f]{12}$/);
    assert.deepEqual(cfg.blender.args, [...REQUIRED_ARGS]);
    const r = cfg.render as Record<string, any>;
    assert.equal(r.engine, 'BLENDER_EEVEE');
    assert.equal(r.ditherIntensity, 0);
    assert.equal(r.colorManagement.view, 'Standard');
    assert.equal(r.film.transparent, true);
    assert.equal(r.output.format, 'PNG');
    for (const sha of Object.values(cfg.blender.artifacts)) assert.match(sha, /^[0-9a-f]{64}$/);
  });

  test('only the lane\'s own entries run, on job files inside dist/blender/jobs', () => {
    const cfg = loadBlenderConfig();
    const fake = { exe: 'never-run' };
    assert.throws(() => runBlender(fake, cfg, 'evil.py' as never, path.join(BLENDER_LANE_DIR, 'x.json')), /not a lane entry/);
    assert.throws(() => runBlender(fake, cfg, 'render.py', path.join(BLENDER_LANE_DIR, 'job.json')), /inside dist\/blender\/jobs/);
    assert.throws(() => writeJob('../escape', {}), /plain id/);
  });

  test('every lane source file is hashed into the identity', () => {
    const listed = blenderSourceSha256().files.map((f) => f.file);
    const onDisk = readdirSync(BLENDER_LANE_DIR).filter((f) => f.endsWith('.py') || f.endsWith('.md')).map((f) => `blender/walletwallaby/${f}`);
    assert.deepEqual([...listed].sort(), [...onDisk].sort());
  });

  test('the lane\'s Python cannot reach a shell, the network, or arbitrary code', () => {
    const forbidden = [/\bimport\s+(subprocess|socket|urllib|http|requests|ftplib|smtplib|ctypes|shutil)\b/, /\bfrom\s+(subprocess|socket|urllib|http|requests|ctypes)\b/, /\bos\.(system|popen|exec|spawn|environ|getenv)/, /\b(eval|exec|compile|__import__)\s*\(/, /bpy\.ops\.wm\.(url_open|read_homefile)/, /use_scripts\s*=\s*True/];
    for (const f of readdirSync(BLENDER_LANE_DIR).filter((x) => x.endsWith('.py'))) {
      const text = readFileSync(path.join(BLENDER_LANE_DIR, f), 'utf8');
      for (const re of forbidden) assert.ok(!re.test(text), `${f}: ${re}`);
    }
    // Positive control: the rule set does catch the forms it names.
    assert.ok(forbidden.some((re) => re.test('import subprocess')) && forbidden.some((re) => re.test('os.environ["X"]')));
  });
});
