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
import { RigPlayer, TARGETS, type RiveArtboard } from '../src/character/walletwallaby/rive/rig-apply.ts';
import { compileRig } from '../src/character/walletwallaby/rive/rig-compile.ts';
import { rigControls } from '../src/character/walletwallaby/rive/rig-controls.ts';
import { RIG_BONES } from '../src/character/walletwallaby/rive/rig-source.ts';
import { BLENDER_LANE_DIR, blenderSourceSha256, loadBlenderConfig, REQUIRED_ARGS, runBlender, writeJob } from '../src/blender/toolchain.ts';
import { terrainsFor } from '../src/layout/terrain.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';
import { loadRig } from './rive-runtime.ts';

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
  test('the resolved pose is exactly the Rive player\'s own pose before IK, on the real runtime', async () => {
    const { rive, file } = await loadRig();
    let checked = 0;
    for (let f = 0; f < frames; f += 23) {
      const { state } = at(f);
      if (!state.visible) continue;
      const controls = rigControls(state);
      const mine = resolvePose(model, controls);
      const artboard = file.artboardByName(model.artboard.name) as RiveArtboard & { delete?(): void };
      const player = new RigPlayer(rive, artboard, model);
      try {
        player.pose(controls);
        const theirs = player.read();
        // Rive stores properties as 32-bit floats: compare at that precision.
        for (const b of RIG_BONES) assert.ok(Math.abs(theirs.rot[b] - mine.rot[b]) < 2e-5, `frame ${f} ${b}: rive ${theirs.rot[b]} vs bridge ${mine.rot[b]}`);
        assert.ok(Math.abs(theirs.hipX - mine.hip[0]) < 1e-3 && Math.abs(theirs.hipY - mine.hip[1]) < 1e-3, `frame ${f} hip`);
        for (const t of TARGETS) {
          const n = artboard.node(t);
          assert.ok(Math.abs(n.x - mine.targets[t][0]) < 1e-3 && Math.abs(n.y - mine.targets[t][1]) < 1e-3, `frame ${f} ${t}: rive (${n.x}, ${n.y}) vs bridge (${mine.targets[t][0]}, ${mine.targets[t][1]})`);
        }
      } finally {
        player.dispose();
        artboard.delete?.();
      }
      checked++;
    }
    assert.ok(checked > 150, `compared ${checked} frames`);
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
    const bad: [string, (d: Record<string, any>) => void][] = [
      ['unknown top-level field', (d) => (d.python = 'import os')],
      ['unknown frame field', (d) => (d.frames[0].script = 'x')],
      ['a gap in the frames', (d) => d.frames.splice(2, 1)],
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
