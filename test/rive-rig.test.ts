// WalletWallaby's Rive rig, end to end on the pinned runtime: the committed
// asset regenerates from code and matches its pin; the runtime loads it; every
// frame is a pure function of the frame (shuffled evaluation is bit-identical,
// with a positive control that a reused instance would leak); Rive's IK plants
// the feet, rests the tail on the surface or releases it past an edge, and
// grips a ledge lip; the drawn character stays bounded and off protected text;
// and adversarial controls are refused.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { TOKENS } from '../src/brand/tokens.ts';
import { choreograph, layoutsFor, mouthAt } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby, type MotionPlan } from '../src/character/walletwallaby/motion.ts';
import { FAMILY_COLORS, RIG_PALETTE } from '../src/character/walletwallaby/rig.ts';
import { boneWorlds, checkClipMix, finalizePose, openFreshPose, RigPlayer, RigPoseError, TAIL_GROUND, withFreshPose, type RiveArtboard } from '../src/character/walletwallaby/rive/rig-apply.ts';
import { poseExtent } from '../src/character/walletwallaby/rive/rig-bounds.ts';
import { compileRig, poseValues, RigCompileError, slotColor } from '../src/character/walletwallaby/rive/rig-compile.ts';
import { rigControls, type RigControls } from '../src/character/walletwallaby/rive/rig-controls.ts';
import { rivColor } from '../src/character/walletwallaby/rive/riv-format.ts';
import { POSE_CLIPS, RIG_BONES, RIG_CLIPS, RIG_CONTROLS, RIG_ENVELOPE, TAIL_BONES, TOE_PLANT, type RigBone } from '../src/character/walletwallaby/rive/rig-source.ts';
import { RIVE_ASSET } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { intersects, TITLE_SAFE } from '../src/layout/geometry.ts';
import { EYEBROW_RECT } from '../src/layout/scene-layout.ts';
import { verifyPinned } from '../src/pipeline/render-input.ts';
import { labPlan, LAB_DURATION_MS } from '../src/remotion/review/motion-lab-scene.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';
import { loadRig } from './rive-runtime.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const plan = planMotion(choreograph(timeline, layouts), layouts);
const FRAME_MS = 1000 / timeline.fps;
/** Every 9th frame of the committed video (about 590 frames), and every frame of the motion lab. */
const videoFrames = Array.from({ length: Math.floor(timeline.totalMs / FRAME_MS) }, (_, i) => i * FRAME_MS).filter((_, i) => i % 9 === 0);
const lab = labPlan();
const labFrames = Array.from({ length: Math.floor(LAB_DURATION_MS / FRAME_MS) }, (_, i) => i * FRAME_MS);

const state = (p: MotionPlan, ms: number) => sampleWallaby(p, ms, p === lab ? 'REST' : mouthAt(timeline, ms));
const FLIGHT_CLIPS = new Set(['takeoff', 'airborne', 'mantle']);

/** Deterministic shuffle (LCG), so the order differs from timeline order but the test is reproducible. */
function shuffled<T>(xs: readonly T[]): T[] {
  const out = [...xs];
  let seed = 12345;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('rig asset', () => {
  test('the committed .riv regenerates byte-for-byte from the rig source and matches its pin', () => {
    const committed = readFileSync(path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/')));
    const fresh = compileRig().bytes;
    assert.equal(sha256Hex(fresh), sha256Hex(committed), 'regenerate with npm run rive:build');
    assert.equal(sha256Hex(committed), RIVE_ASSET.sha256, 'update RIVE_ASSET.sha256 (and the rig version) for a changed rig');
    assert.deepEqual(compileRig().bytes, fresh, 'compiling is deterministic');
  });

  test('the coat is WalletWallrus\'s coat, written into the asset itself', () => {
    assert.equal(RIG_PALETTE.fur, 'wallrusCoat');
    assert.equal(slotColor('fur'), FAMILY_COLORS.wallrusCoat);
    assert.equal(slotColor('fur'), '#BA6F38');
    const le = (n: number) => [n % 256, Math.floor(n / 256) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 16777216)].join(',');
    const bytes = compileRig().bytes.join(',');
    assert.ok(bytes.includes(le(rivColor(FAMILY_COLORS.wallrusCoat))), 'the walrus coat is a paint in the .riv');
    assert.ok(!bytes.includes(le(rivColor(TOKENS.terracotta))), 'control: the docs theme\'s terracotta is not');
    assert.ok(bytes.includes(le(rivColor(TOKENS.cream))) && bytes.includes(le(rivColor(TOKENS.charcoal))), 'cream and charcoal too');
  });

  test('pose authoring refuses non-finite deltas, unknown bones, and out-of-range IK strengths (positive controls)', () => {
    const { model } = compileRig();
    assert.throws(() => poseValues({ bones: { hip: Number.NaN } }, model.bones, model.controls), RigCompileError);
    assert.throws(() => poseValues({ bones: { wing: 3 } as never }, model.bones, model.controls), RigCompileError);
    assert.throws(() => poseValues({ ik: { legs: 1.5 } }, model.bones, model.controls), RigCompileError);
    assert.doesNotThrow(() => poseValues({ bones: { hip: 3 }, ik: { legs: 0.5 } }, model.bones, model.controls), 'control');
  });

  test('a tampered asset is refused before it can be drawn', async () => {
    const { rive, bytes } = await loadRig();
    const flipped = Uint8Array.from(bytes);
    const mid = flipped.length >> 1;
    flipped[mid] = flipped[mid]! ^ 0xff;
    assert.throws(() => verifyPinned(flipped, RIVE_ASSET.sha256, 'walletwallaby.riv'), /hash/);
    assert.doesNotThrow(() => verifyPinned(bytes, RIVE_ASSET.sha256, 'walletwallaby.riv'), 'control: the committed bytes pass');
    const badHeader = Uint8Array.from(bytes);
    badHeader[0] = 0;
    const log = console.error;
    console.error = () => {};
    try {
      assert.equal(await rive.load(badHeader, undefined, false), null, 'the runtime refuses a file without its fingerprint');
    } finally {
      console.error = log;
    }
  });
});

describe('Rive runtime', () => {
  test('loads one artboard with every bone, control, and clip the contract names', async () => {
    const { file, model } = await loadRig();
    assert.equal(file.artboardCount(), 1);
    const ab = file.artboardByName(model.artboard.name) as RiveArtboard & { delete(): void };
    for (const b of RIG_BONES) assert.ok(ab.bone(b), b);
    for (const c of RIG_CONTROLS) assert.ok(ab.node(c), c);
    for (const clip of RIG_CLIPS) assert.ok(ab.animationByName(clip), clip);
    ab.delete();
  });

  test('before IK, the runtime and our forward kinematics agree', async () => {
    const { rive, file, model } = await loadRig();
    const s = state(plan, 30_000);
    withFreshPose(rive, file, model, rigControls(s), ({ player }) => {
      const fk = boneWorlds(model, player.read());
      // Bones no IK constraint moves (the IK chains are checked by their contacts below).
      for (const b of ['hip', 'chest', 'neck', 'head', 'jaw', 'ear_n', 'ear_f', 'tail_0', 'tail_1', 'tail_2'] as const) {
        const rt = player.boneWorld(b);
        for (let k = 0; k < 6; k++) assert.ok(Math.abs(rt[k]! - fk[b][k]!) < 1e-3, `${b}[${k}] runtime ${rt[k]} vs fk ${fk[b][k]}`);
      }
    });
  });

  test('every frame is posed fresh: shuffled evaluation reproduces timeline order bit for bit', async () => {
    const { rive, file, model } = await loadRig();
    const snap = (ms: number): string => {
      const s = state(plan, ms);
      if (!s.visible) return 'hidden';
      return withFreshPose(rive, file, model, rigControls(s), ({ player, report }) => JSON.stringify([RIG_BONES.map((b) => player.boneWorld(b)), report]));
    };
    const inOrder = new Map(videoFrames.map((ms) => [ms, snap(ms)]));
    for (const ms of shuffled(videoFrames)) assert.equal(snap(ms), inOrder.get(ms), `t=${Math.round(ms)}`);
  });

  test('positive control: the comparison catches a 0.01 degree change in a single frame', async () => {
    const { rive, file, model } = await loadRig();
    const s = state(plan, 30_000);
    const c = rigControls(s);
    const snap = (pitch: number) => withFreshPose(rive, file, model, { ...c, body: { ...c.body, pitchDeg: c.body.pitchDeg + pitch } }, ({ player }) => JSON.stringify(RIG_BONES.map((b) => player.boneWorld(b))));
    assert.equal(snap(0), snap(0));
    assert.notEqual(snap(0.01), snap(0), 'bit-level comparison is sensitive');
  });

  test('even a reused instance stays history-free (belt and braces behind the fresh-instance design)', async () => {
    const { rive, file, model } = await loadRig();
    const ab = file.artboardByName(model.artboard.name) as RiveArtboard & { delete(): void };
    const player = new RigPlayer(rive, ab, model);
    const snap = (ms: number): string => {
      const s = state(plan, ms);
      if (!s.visible) return 'hidden';
      player.pose(rigControls(s));
      return JSON.stringify(RIG_BONES.map((b) => player.boneWorld(b)));
    };
    const frames = videoFrames.slice(0, 200);
    const inOrder = new Map(frames.map((ms) => [ms, snap(ms)]));
    const leaks = shuffled(frames).filter((ms) => snap(ms) !== inOrder.get(ms)).length;
    player.dispose();
    ab.delete();
    assert.equal(leaks, 0);
  });

  test('the same motion input gives the same rig controls', () => {
    const again = planMotion(choreograph(timeline, layouts), layouts);
    for (const ms of videoFrames.filter((_, i) => i % 5 === 0)) assert.deepEqual(rigControls(state(plan, ms)), rigControls(state(again, ms)));
  });
});

describe('Rive IK contacts', () => {
  test('grounded feet stay planted on the rig ground point, knees forward', async () => {
    const { rive, file, model } = await loadRig();
    let checked = 0;
    for (const ms of videoFrames) {
      const s = state(plan, ms);
      if (!s.visible || s.motion.contact === 'NONE') continue;
      const c = rigControls(s);
      if (c.clips.some((k) => FLIGHT_CLIPS.has(k.clip))) continue;
      withFreshPose(rive, file, model, c, ({ player, report }) => {
        checked++;
        assert.ok(Math.hypot(report.feet.near[0] - TOE_PLANT[0], report.feet.near[1] - TOE_PLANT[1]) < 0.01, `near toe at t=${Math.round(ms)}: ${report.feet.near}`);
        assert.ok(Math.abs(report.feet.far[1] - TOE_PLANT[1]) < 0.01, `far toe on the ground at t=${Math.round(ms)}`);
        const hipJ = player.boneWorld('thigh_n');
        const knee = player.boneWorld('shin_n');
        const ankle = player.boneWorld('foot_n');
        const cross = (ankle[4] - hipJ[4]) * (knee[5] - hipJ[5]) - (ankle[5] - hipJ[5]) * (knee[4] - hipJ[4]);
        assert.ok(cross < 0, `knee forward at t=${Math.round(ms)}`);
      });
    }
    assert.ok(checked > 400, `${checked} grounded frames checked`);
  });

  test('the tail rests on the surface where there is one, and hangs free past an edge', async () => {
    const { rive, file, model } = await loadRig();
    let resting = 0;
    let supported = 0;
    let heldClear = 0;
    for (const ms of videoFrames) {
      const s = state(plan, ms);
      if (!s.visible || s.motion.phase !== 'HOLD' || (s.pose.mix.inspect ?? 0) > 0) continue;
      withFreshPose(rive, file, model, rigControls(s), ({ report }) => {
        if (report.tailSupport < 1) return;
        supported++;
        // Released smoothly: fully resting below 0.05, a blend in between, held clear above.
        if (report.tailFree > 0.05) heldClear++;
        else if (report.tailContact) resting++;
        else assert.fail(`supported and not released, yet not resting at t=${Math.round(ms)}: tip ${report.tailTip}`);
      });
    }
    assert.ok(supported > 300, `${supported} supported holds`);
    assert.ok(heldClear / supported < 0.1, `the tail is released on ${heldClear} of ${supported} supported holds; resting on ${resting}`);
    // On the lab's narrow node, the tail tip is past the platform's edge: no contact, and it hangs below the surface line.
    let edge = 0;
    for (const ms of labFrames) {
      const s = state(lab, ms);
      if (!s.visible || s.motion.action !== 'PERCH') continue;
      withFreshPose(rive, file, model, rigControls(s), ({ report }) => {
        if (report.tailSupport > 0) return;
        edge++;
        // No surface under the tail: its ground contact is fully released, and it never "rests" on thin air.
        assert.equal(report.tailFree, 1, `released at t=${Math.round(ms)}`);
        assert.equal(report.tailContact, false, `no phantom contact at t=${Math.round(ms)}`);
      });
    }
    assert.ok(edge > 10, `${edge} unsupported perch frames`);
  });

  test('climbing, the paws hold the ledge lip', async () => {
    const { rive, file, model } = await loadRig();
    let hanging = 0;
    for (const ms of labFrames) {
      const s = state(lab, ms);
      if (!s.visible || s.motion.phase !== 'HANG') continue;
      const c = rigControls(s);
      withFreshPose(rive, file, model, c, ({ report }) => {
        hanging++;
        const target = [c.grip![0] + 6, c.grip![1] - 4];
        assert.ok(Math.hypot(report.paws.near[0] - target[0]!, report.paws.near[1] - target[1]!) < 3, `paw on the lip at t=${Math.round(ms)}`);
      });
    }
    assert.ok(hanging >= 2, `${hanging} hang frames`);
  });

  test('the tail stays bounded: no segment folds back on its neighbour', async () => {
    const { rive, file, model } = await loadRig();
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) {
      for (const ms of frames) {
        const s = state(p, ms);
        if (!s.visible) continue;
        withFreshPose(rive, file, model, rigControls(s), ({ player }) => {
          const angles = TAIL_BONES.map((b) => {
            const m = player.boneWorld(b);
            return Math.atan2(m[1], m[0]);
          });
          for (let i = 1; i < angles.length; i++) {
            let d = Math.abs(angles[i]! - angles[i - 1]!);
            if (d > Math.PI) d = 2 * Math.PI - d;
            assert.ok(d < (70 * Math.PI) / 180, `tail joint ${i} bends ${((d * 180) / Math.PI).toFixed(1)} deg at t=${Math.round(ms)}`);
          }
        });
      }
    }
  });
});

describe('controls and bounds', () => {
  test('every frame poses within the hard limits; weights, times, and values are in range', async () => {
    const { rive, file, model } = await loadRig();
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) {
      for (const ms of frames) {
        const s = state(p, ms);
        if (!s.visible) continue;
        const c = rigControls(s);
        checkClipMix(c.clips);
        for (const k of c.clips) {
          const clip = model.clips[k.clip];
          assert.ok(k.timeS >= 0 && (clip.loop || k.timeS <= clip.durationS + 1e-9), `${k.clip} time ${k.timeS}`);
        }
        // Posing runs every hard-limit and finiteness check; it must not throw on any real frame.
        withFreshPose(rive, file, model, c, ({ player }) => {
          for (const b of RIG_BONES) for (const v of player.boneWorld(b)) assert.ok(Number.isFinite(v), `${b} at t=${Math.round(ms)}`);
        });
      }
    }
  });

  test('the drawn character stays inside its envelope, and while holding never overlaps protected text or leaves title-safe', async () => {
    const { rive, file, model } = await loadRig();
    let holds = 0;
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) {
      for (const ms of frames) {
        const s = state(p, ms);
        if (!s.visible) continue;
        withFreshPose(rive, file, model, rigControls(s), ({ player }) => {
          const bones = Object.fromEntries(RIG_BONES.map((b) => [b, player.boneWorld(b)])) as Record<RigBone, ReturnType<typeof player.boneWorld>>;
          const controls = Object.fromEntries(RIG_CONTROLS.map((c) => [c, player.controlWorld(c)])) as never;
          const e = poseExtent(model, { bones, controls });
          assert.ok(e.minX >= RIG_ENVELOPE.minX && e.maxX <= RIG_ENVELOPE.maxX && e.minY >= RIG_ENVELOPE.minY && e.maxY <= RIG_ENVELOPE.maxY, `envelope at t=${Math.round(ms)}: ${JSON.stringify(e)}`);
          if (p !== plan || s.motion.phase !== 'HOLD') return;
          const seg = timeline.segments.find((x) => ms >= x.startMs && ms < x.endMs);
          if (!seg?.scene || ms < seg.contentStartMs) return;
          holds++;
          const xa = s.x + s.facing * e.minX * s.scale;
          const xb = s.x + s.facing * e.maxX * s.scale;
          const ink = { x: Math.min(xa, xb), y: s.y + e.minY * s.scale, w: Math.abs(xb - xa), h: (e.maxY - e.minY) * s.scale };
          for (const r of [...layouts.get(seg.id)!.texts.map((t) => t.rect), EYEBROW_RECT]) assert.ok(!intersects(ink, r), `${seg.id} t=${Math.round(ms)} ink over text`);
          assert.ok(ink.x >= TITLE_SAFE.x && ink.x + ink.w <= TITLE_SAFE.x + TITLE_SAFE.w && ink.y >= TITLE_SAFE.y && ink.y + ink.h <= TITLE_SAFE.y + TITLE_SAFE.h, `${seg.id} t=${Math.round(ms)} leaves title-safe`);
        });
      }
    }
    assert.ok(holds > 300, `${holds} scene hold frames checked`);
  });

  test('adversarial controls are refused before anything is drawn (positive controls)', async () => {
    const { rive, file, model } = await loadRig();
    const good = rigControls(state(plan, 30_000));
    const variants: [string, (c: RigControls) => RigControls][] = [
      ['NaN pitch', (c) => ({ ...c, body: { ...c.body, pitchDeg: Number.NaN } })],
      ['Infinite hip drop', (c) => ({ ...c, body: { ...c.body, dy: Number.POSITIVE_INFINITY } })],
      ['pitch past its limit', (c) => ({ ...c, body: { ...c.body, pitchDeg: 80 } })],
      ['tail swing past its limit', (c) => ({ ...c, tail: { ...c.tail, deg: [90, 0, 0, 0, 0] } })],
      ['tail tension above 1', (c) => ({ ...c, tail: { ...c.tail, tension: 1.5 } })],
      ['missing tail bone', (c) => ({ ...c, tail: { ...c.tail, deg: [0, 0, 0, 0] } })],
      ['weights not summing to 1', (c) => ({ ...c, clips: c.clips.map((k) => ({ ...k, weight: k.weight * 0.9 })) })],
      ['negative weight', (c) => ({ ...c, clips: [{ clip: 'idle_alert', weight: 1.5, timeS: 0 }, { clip: 'perch', weight: -0.5, timeS: 0 }] })],
      ['unknown clip', (c) => ({ ...c, clips: [{ clip: 'moonwalk' as never, weight: 1, timeS: 0 }] })],
      ['control clip as a pose', (c) => ({ ...c, clips: [{ clip: 'tail_free' as never, weight: 1, timeS: 0 }] })],
      ['duplicate clip', (c) => ({ ...c, clips: [{ clip: 'perch', weight: 0.5, timeS: 0 }, { clip: 'perch', weight: 0.5, timeS: 0 }] })],
      ['negative clip time', (c) => ({ ...c, clips: [{ clip: 'idle_alert', weight: 1, timeS: -1 }] })],
      ['grip across the frame', (c) => ({ ...c, grip: [900, -40] })],
      ['point amount above 1', (c) => ({ ...c, point: { target: [80, -150], amount: 2 } })],
      ['inverted support span', (c) => ({ ...c, support: { minX: 10, maxX: -10 } })],
      ['lid past closed', (c) => ({ ...c, face: { ...c.face, lid: 1.4 } })],
    ];
    for (const [name, mutate] of variants) {
      assert.throws(() => openFreshPose(rive, file, model, mutate(structuredClone(good))), RigPoseError, name);
      assert.throws(() => finalizePose(model, { rot: Object.fromEntries(RIG_BONES.map((b) => [b, model.bones[b].restRotation])) as never, hipX: -20, hipY: -78, stance: -9, heel: 0, gazeX: 0, gazeY: 0, lid: 0, brow: 0 }, mutate(structuredClone(good))), RigPoseError, `${name} (pure)`);
    }
    assert.doesNotThrow(() => withFreshPose(rive, file, model, good, () => undefined), 'control: the real controls pose');
  });

  test('every pose clip is reachable from the motion vocabulary or a transient', () => {
    const used = new Set<string>();
    for (const [p, frames] of [[plan, videoFrames], [lab, labFrames]] as const) for (const ms of frames) for (const k of Object.keys(state(p, ms).pose.mix)) used.add(k);
    for (const clip of POSE_CLIPS) assert.ok(used.has(clip), `${clip} is never used`);
  });
});
