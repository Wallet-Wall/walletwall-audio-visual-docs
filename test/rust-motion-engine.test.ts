// The Rust/WASM Motion Intelligence engine, end to end: the committed artifact, the TS -> WASM -> TS
// round trip on the committed lesson's takeaway hop, fail-closed refusals at both layers, plan
// validation, the composition's binding and sampling, oracle parity with the transitional
// TypeScript solver, and render provenance. Every refusal has a positive control.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { MOTION_CONFIG, planMotion, sampleWallaby, SETTLE_RESERVE_MS } from '../src/character/walletwallaby/motion.ts';
import { rigControls } from '../src/character/walletwallaby/rive/rig-controls.ts';
import { WALLABY_HEIGHT } from '../src/character/walletwallaby/rig.ts';
import { MOTION } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { ABI_FUNCTIONS, assertHermetic, crateSourceSha256, crateVersion, inspectWasm, loadVerifiedArtifact, MOTION_CRATE_DIR, readArtifactManifest, verifyArtifactBytes } from '../src/motion/artifact.ts';
import { MOTION_INTELLIGENCE_CONFIG_PINS, readMotionIntelligenceConfig, typescriptEngineIdentity } from '../src/motion/engine-identity.ts';
import { expectationFor, MotionEngineError, validateMotionPlan, type MotionErrorCode, type MotionInput } from '../src/motion/plan.ts';
import { planRustMotion, rustInputsFor, RustMotionEngine } from '../src/motion/rust-adapter.ts';
import { bindMotionEngine, findRustPath, MOTION_INTELLIGENCE_CONFIG, RUST_MOTION_PATHS, sampleWithEngine, type MotionEngineProps } from '../src/motion/rust-path.ts';
import { buildTimeline, totalFrames } from '../src/timeline/timeline.ts';
import { clone, committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const headings = Object.fromEntries(committedSnapshot().sections.map((s) => [s.id, s.heading]));
const args = { spec, track: estimateTrack(spec, config.voice, config.lexicon), templates: config.templates, headings };
const timeline = buildTimeline(spec, args.track, config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const ts = planMotion(choreograph(timeline, layouts), layouts);
const fps = timeline.fps;
const engine = RustMotionEngine.load();
const { inputs } = rustInputsFor(args);
const input = inputs[0]!.input;
const FIXTURES = path.join(MOTION_CRATE_DIR, 'tests', 'fixtures');
const fixtureInput = JSON.parse(readFileSync(path.join(FIXTURES, 'takeaway-hop.input.json'), 'utf8')) as MotionInput;
const fixturePlan = new Uint8Array(readFileSync(path.join(FIXTURES, 'takeaway-hop.plan.json')));

/** The refusal code of a call that must refuse. */
function refusal(fn: () => unknown): MotionErrorCode {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof MotionEngineError, `expected a MotionEngineError, got ${String(err)}`);
    return err.code;
  }
  assert.fail('expected a refusal');
}
const variant = (patch: (i: Record<string, any>) => void): MotionInput => {
  const i = clone(input) as unknown as Record<string, any>;
  patch(i);
  return i as unknown as MotionInput;
};
/** A minimal module: magic, version, then the given sections. */
const wasm = (...sections: number[][]): Uint8Array<ArrayBuffer> => new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...sections.flat()]);

describe('Motion Intelligence artifact', () => {
  test('the committed artifact is exactly the bytes its manifest names, built from the current crate sources', () => {
    const { bytes, manifest } = loadVerifiedArtifact();
    assert.equal(sha256Hex(bytes), manifest.sha256);
    assert.equal(manifest.crate.version, crateVersion());
    assert.equal(manifest.sourceSha256, crateSourceSha256(), 'crate sources changed without npm run motion:build (in Linux/WSL)');
    assert.equal(manifest.build.target, 'wasm32-unknown-unknown');
    assert.match(manifest.build.rustc, /^rustc 1\.96\.0 /, 'built with the toolchain rust-toolchain.toml pins');
  });

  test('a tampered artifact is refused (positive control)', () => {
    const { bytes, manifest } = loadVerifiedArtifact();
    const tampered = new Uint8Array(bytes);
    const last = tampered.length - 1;
    tampered[last] = tampered[last]! ^ 1;
    assert.equal(refusal(() => verifyArtifactBytes(tampered, manifest)), 'ENGINE_UNAVAILABLE');
    assert.doesNotThrow(() => verifyArtifactBytes(new Uint8Array(bytes), manifest));
  });

  test('the engine imports nothing from its host and exports exactly the ABI', () => {
    const { bytes } = loadVerifiedArtifact();
    const i = inspectWasm(bytes);
    assert.deepEqual(i.imports, [], 'no clock, randomness, environment, or I/O can reach the engine');
    assert.deepEqual(i.functions, [...ABI_FUNCTIONS].sort());
    assert.ok(i.hasMemory);
    assert.deepEqual(i.hostPaths, [], 'no machine-specific path is embedded');
    assert.doesNotThrow(() => assertHermetic(bytes, 'artifact'));
  });

  test('a module that imports from its host, or carries a host path, is refused (positive controls)', () => {
    // (type: func () -> ()) (import "env" "now" (func))
    const importing = wasm([1, 4, 1, 0x60, 0, 0], [2, 11, 1, 3, 0x65, 0x6e, 0x76, 3, 0x6e, 0x6f, 0x77, 0, 0]);
    assert.deepEqual(inspectWasm(importing).imports, ['env.now']);
    assert.equal(refusal(() => assertHermetic(importing, 'importing')), 'ENGINE_UNAVAILABLE');
    const leak = [...Buffer.from('C:\\Users\\someone\\.cargo\\registry\\src\\serde_json\\src\\read.rs', 'latin1')];
    const leaking = wasm([0, leak.length + 2, 1, 0x78, ...leak]);
    assert.equal(inspectWasm(leaking).hostPaths.length, 1);
  });
});

describe('TS -> WASM -> TS', () => {
  test('the takeaway hop round-trips: a validated plan that lands on the authored anchor', () => {
    const travel = ts.clips.find((c) => c.segmentId === 'takeaway' && c.kind === 'TRAVEL' && c.action === 'HOP')!;
    const { plan } = engine.solve(input);
    assert.deepEqual(plan.target, travel.to);
    assert.deepEqual(plan.samples.at(-1)!.position, travel.to);
    assert.equal(plan.samples.at(-1)!.phase, 'PERCH');
    assert.equal(plan.frames.fps, fps);
    assert.ok(plan.frames.count > 200);
  });

  test('the converter builds exactly the canonical fixture input, and the artifact returns exactly the canonical plan bytes', () => {
    assert.deepEqual(input, fixtureInput, 'the fixture is the real path; regenerate with npm run motion:fixtures');
    const { bytes } = engine.solve(fixtureInput);
    assert.ok(Buffer.compare(Buffer.from(bytes), Buffer.from(fixturePlan)) === 0, 'the wasm plan differs from the fixture the native Rust tests also pin');
  });

  test('the same input gives the same bytes, call after call, across other inputs, and on a fresh instance', () => {
    const first = Buffer.from(engine.solve(input).bytes);
    const other = variant((i) => (i.config.gravityBodyHeightsPerS2 = 30));
    assert.notDeepEqual(Buffer.from(engine.solve(other).bytes), first, 'control: a different config gives a different plan');
    for (let k = 0; k < 3; k++) assert.ok(Buffer.compare(Buffer.from(engine.solve(input).bytes), first) === 0, `repeat ${k}`);
    assert.ok(Buffer.compare(Buffer.from(RustMotionEngine.load().solve(input).bytes), first) === 0, 'a fresh instance');
  });

  test('solving never changes the semantic destination', () => {
    const before = clone(input);
    const frozen = Object.freeze(clone(input));
    const { plan } = engine.solve(frozen);
    assert.deepEqual(input, before, 'the input is untouched');
    assert.deepEqual(plan.target, input.target);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.target) && Object.isFrozen(plan.samples.at(-1)!.position), 'the plan cannot be edited after validation');
    assert.throws(() => {
      (plan.target as { x: number }).x = 0;
    }, TypeError);
  });
});

describe('fail closed', () => {
  test('the adapter refuses what JSON would silently corrupt, before the engine sees it', () => {
    assert.equal(refusal(() => engine.solve(variant((i) => (i.target.x = Number.NaN)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.timing.endMs = Number.POSITIVE_INFINITY)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.config.tail.freqHz = Number.NEGATIVE_INFINITY)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.stance.rest.tailDeg = undefined)))), 'INVALID_INPUT');
    assert.doesNotThrow(() => engine.solve(variant(() => {})), 'control: an untouched copy solves');
  });

  test('the engine refuses malformed, impossible, or unsupported input with its own codes', () => {
    const cases: [string, (i: Record<string, any>) => void, MotionErrorCode][] = [
      ['unknown field', (i) => (i.wobble = 1), 'INVALID_INPUT'],
      ['string number', (i) => (i.target.x = '1600'), 'INVALID_INPUT'],
      ['missing field', (i) => delete i.stance, 'INVALID_INPUT'],
      ['fractional fps', (i) => (i.fps = 29.97), 'INVALID_INPUT'],
      ['config out of range', (i) => (i.config.gravityBodyHeightsPerS2 = 500), 'INVALID_CONFIG'],
      ['absurd peak height', (i) => (i.config.hop.peakMax = 5), 'INVALID_CONFIG'],
      ['negative start', (i) => (i.timing.startMs = -5), 'INVALID_DURATION'],
      ['zero window', (i) => (i.timing.arriveByMs = i.timing.startMs), 'INVALID_DURATION'],
      ['window closes before the landing settles', (i) => (i.timing.endMs = i.timing.arriveByMs + 100), 'INVALID_DURATION'],
      ['unsupported action', (i) => (i.action = 'MANTLE'), 'UNSUPPORTED_ACTION'],
      ['target off its ledge', (i) => (i.target.x = 1900), 'INVALID_TARGET'],
      ['unreachable in the window', (i) => ((i.terrain.target = null), (i.start.x = 0), (i.target.x = 1920), (i.timing.arriveByMs = i.timing.startMs + 400)), 'UNSOLVABLE_TRAJECTORY'],
      ['target off stage', (i) => ((i.terrain.target = null), (i.target.y = 1200)), 'OUT_OF_BOUNDS'],
    ];
    for (const [name, patch, code] of cases) assert.equal(refusal(() => engine.solve(variant(patch))), code, name);
  });

  test('raw bytes that are not an input document are refused at the boundary itself', () => {
    const out = engine.solveBytes(new TextEncoder().encode('{"schema":'));
    assert.equal(out.status, 1);
    assert.equal(JSON.parse(new TextDecoder().decode(out.output)).error.code, 'INVALID_INPUT');
    assert.equal(refusal(() => engine.solveBytes(new Uint8Array(0))), 'INVALID_INPUT');
    assert.equal(refusal(() => engine.solveBytes(new Uint8Array((1 << 20) + 1))), 'INVALID_INPUT');
    assert.equal(engine.solveBytes(new TextEncoder().encode(JSON.stringify(input))).status, 0, 'control: the engine still answers');
  });

  test('a plan made by a different engine version than the artifact manifest names is refused', () => {
    const { bytes, manifest } = loadVerifiedArtifact();
    const other = new RustMotionEngine(bytes, { ...manifest, crate: { ...manifest.crate, version: '9.9.9' } });
    assert.equal(refusal(() => other.solve(input)), 'INVALID_PLAN');
  });

  test('every tampering with a returned plan is caught by validation (positive controls)', () => {
    const raw = () => JSON.parse(new TextDecoder().decode(fixturePlan)) as Record<string, any>;
    const expect = expectationFor(fixtureInput);
    assert.doesNotThrow(() => validateMotionPlan(raw(), expect), 'control: the untouched plan validates');
    const landed = (p: Record<string, any>) => p.samples.find((s: { phase: string }) => s.phase === 'SETTLE');
    const cases: [string, (p: Record<string, any>) => void][] = [
      ['target moved', (p) => (p.target.x += 1)],
      ['a landed foot moved by a hair', (p) => (landed(p).position.x += 1e-9)],
      ['a channel turned null (a NaN through JSON)', (p) => (p.samples[30].tailAngle = null)],
      ['an extra field', (p) => (p.samples[3].wobble = 0)],
      ['a missing field', (p) => delete p.samples[3].tailCurl],
      ['the tail past its range', (p) => (p.samples[12].tailAngle = 45)],
      ['a phase out of order', (p) => ([p.phases[2], p.phases[3]] = [p.phases[3], p.phases[2]])],
      ['a sample in the wrong phase', (p) => (p.samples[12].phase = 'PERCH')],
      ['a frame missing', (p) => p.samples.pop()],
      ['a different frame grid', (p) => (p.frames.first += 1)],
      ['contact moved', (p) => (p.timing.contactMs += 1)],
      ['not at rest when handed back', (p) => (p.samples.at(-1).tailAngle = 0.5)],
      ['wrong schema', (p) => (p.schema = 'walletwall.motion-plan/v0')],
      ['another engine', (p) => (p.engine.name = 'something-else')],
    ];
    for (const [name, tamper] of cases) {
      const p = raw();
      tamper(p);
      assert.equal(refusal(() => validateMotionPlan(p, expect)), 'INVALID_PLAN', name);
    }
  });
});

describe('the engine performs the takeaway path in the composition', () => {
  const rust = planRustMotion(args, engine);
  const bound = bindMotionEngine(rust.props, ts, fps, spec.id);
  const path0 = bound.paths[0]!;
  const frames = totalFrames(timeline);

  test('the plans bind to the clips, and the default render binds no engine at all', () => {
    assert.equal(bound.engine, 'rust-wasm');
    assert.equal(bound.paths.length, RUST_MOTION_PATHS.length);
    assert.equal(path0.travel.segmentId, 'takeaway');
    assert.deepEqual(bindMotionEngine(undefined, ts, fps, spec.id), { engine: 'typescript', paths: [] });
  });

  test('outside its path every frame is exactly the TypeScript solver; inside, the feet are exactly where the oracle puts them', () => {
    let inside = 0;
    let tailDiffers = 0;
    for (let f = 0; f < frames; f++) {
      const ms = (f * 1000) / fps;
      const a = sampleWithEngine(bound, ts, f, ms, 'REST');
      const b = sampleWallaby(ts, ms, 'REST');
      if (f < path0.first || f >= path0.end) {
        assert.deepEqual(a, b, `frame ${f} outside the engine's path`);
        continue;
      }
      inside++;
      const s = path0.plan.samples[f - path0.first]!;
      assert.equal(a.x, b.x, `frame ${f} x`);
      assert.equal(a.y, b.y, `frame ${f} y`);
      assert.equal(a.scale, b.scale);
      assert.equal(a.motion.contact, b.motion.contact);
      assert.equal(a.motion.tail.swing, s.tailAngle, 'the tail is the engine\'s');
      assert.equal(a.motion.rotation, s.bodyPitch);
      if (Math.abs(a.motion.tail.swing - b.motion.tail.swing) > 0.5) tailDiffers++;
    }
    assert.equal(inside, path0.plan.frames.count);
    assert.ok(tailDiffers > 30, `positive control: the engine, not the transitional solver, drives the tail (${tailDiffers} frames differ)`);
  });

  test('the Rive rig accepts every engine state', () => {
    const finiteEverywhere = (v: unknown, at: string): void => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${at} is not finite`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finiteEverywhere(x, `${at}.${k}`);
    };
    for (let f = path0.first; f < path0.end; f++) {
      const c = rigControls(sampleWithEngine(bound, ts, f, (f * 1000) / fps, 'REST'));
      finiteEverywhere(c, `frame ${f}`);
      assert.ok(Math.abs(c.clips.reduce((a, x) => a + x.weight, 0) - 1) < 1e-9, `frame ${f}: clip weights sum to 1`);
    }
  });

  test('binding fails closed on any plan that does not answer exactly these clips', () => {
    const props = () => clone(rust.props) as MotionEngineProps & Record<string, any>;
    const cases: [string, (p: Record<string, any>) => void][] = [
      ['target moved', (p) => (p.paths[0].plan.target.x += 1)],
      ['liftoff moved', (p) => ((p.paths[0].plan.timing.liftoffMs += 1), (p.paths[0].plan.trajectory.flightMs -= 1))],
      ['wrong schema', (p) => (p.schema = 'walletwall.motion-engine-props/v0')],
      ['no plans', (p) => (p.paths = [])],
      ['an unselected path', (p) => p.paths.push({ ...p.paths[0], segmentId: 'outro' })],
      ['a different arc', (p) => (p.paths[0].plan.trajectory.depthPx += 1)],
    ];
    for (const [name, tamper] of cases) {
      const p = props();
      tamper(p);
      assert.throws(() => bindMotionEngine(p, ts, fps, spec.id), MotionEngineError, name);
    }
    assert.throws(() => bindMotionEngine(rust.props, ts, 60, spec.id), MotionEngineError, 'another frame rate');
    assert.doesNotThrow(() => bindMotionEngine(props(), ts, fps, spec.id), 'control: an untouched copy binds');
  });

  test('a path engine v1 cannot perform exactly is refused, never silently left to TypeScript', () => {
    assert.equal(refusal(() => findRustPath(ts, { videoId: spec.id, segmentId: 'nowhere', action: 'HOP' })), 'INELIGIBLE_PATH');
    assert.equal(refusal(() => findRustPath(ts, { videoId: spec.id, segmentId: 'hook', action: 'HOP' })), 'INELIGIBLE_PATH', 'needs the surface-aware arc search');
    assert.equal(refusal(() => findRustPath(ts, { videoId: spec.id, segmentId: 'vault-conditional', action: 'LAND' })), 'INELIGIBLE_PATH', 'a chained skip, not a hop');
    assert.doesNotThrow(() => findRustPath(ts, RUST_MOTION_PATHS[0]!), 'control: the selected path is eligible');
  });
});

describe('oracle parity with the transitional TypeScript solver', () => {
  test('the engine\'s liftoff, contact, and arc are the TypeScript hop\'s, exactly', () => {
    const { plan } = engine.solve(input);
    const p = findRustPath(ts, RUST_MOTION_PATHS[0]!);
    assert.equal(plan.timing.orientEndMs, p.hop.orientEndMs);
    assert.equal(plan.timing.liftoffMs, p.hop.takeoffMs);
    assert.equal(plan.timing.contactMs, p.hop.contactMs);
    assert.equal(plan.trajectory.depthPx, p.hop.depthPx);
    assert.equal(plan.trajectory.gravityPxPerS2, p.hop.gravityPx);
    assert.equal(plan.trajectory.apexAbovePx, p.hop.apexAbovePx);
    const landing = ts.events.find((e) => e.kind === 'LANDING' && e.atMs === p.hop.contactMs)!;
    assert.equal(plan.landingImpulse, landing.impulse, 'the same impulse the scene\'s platform dip uses');
  });

  test('the shared physics constants agree with config/motion.json and the rig', () => {
    const c = MOTION_INTELLIGENCE_CONFIG;
    const m = MOTION_CONFIG;
    assert.equal(c.bodyHeightPx, WALLABY_HEIGHT);
    assert.equal(c.gravityBodyHeightsPerS2, m.gravityBodyHeightsPerS2);
    assert.equal(c.maxGravityBoost, m.maxGravityBoost);
    assert.equal(c.maxSpeedBodyHeightsPerS, m.limits.maxSpeedBodyHeightsPerS);
    for (const k of ['peakBase', 'peakPerPx', 'peakMin', 'peakMax', 'anticipationMs', 'anticipationHoldFrac', 'orientMaxMs', 'minFlightMs'] as const) assert.equal(c.hop[k], m.hop[k], `hop.${k}`);
    assert.equal(c.hop.settleReserveMs, SETTLE_RESERVE_MS);
    assert.equal(c.pitch.maxDeg, m.limits.maxRotationDeg);
    assert.equal(c.tail.maxDeg, m.limits.maxTailSwingDeg);
    assert.equal(c.tail.maxCurlDeg, m.limits.maxTailCurlDeg);
    assert.equal(c.tail.tensionRest, m.tail.restTension);
    assert.equal(c.ears.maxDeg, m.limits.maxEarLagDeg);
    assert.equal(c.limits.maxHeadDeg, m.limits.maxHeadStabDeg);
  });
});

describe('motion engine provenance', () => {
  test('the engine config matches the hash pinned for its declared version (append-only pins)', () => {
    const c = readMotionIntelligenceConfig();
    assert.deepEqual(c, MOTION_INTELLIGENCE_CONFIG, 'the bundled and the read config are one file');
    assert.equal(contentAddress(c), MOTION_INTELLIGENCE_CONFIG_PINS[c.version], `config v${c.version}: a changed value needs a new version and pin`);
    assert.deepEqual(Object.keys(MOTION_INTELLIGENCE_CONFIG_PINS).map(Number), Array.from({ length: c.version }, (_, i) => i + 1));
    assert.notEqual(contentAddress({ ...c, tail: { ...c.tail, loadDeg: 9 } }), MOTION_INTELLIGENCE_CONFIG_PINS[c.version], 'positive control');
  });

  test('a rust-wasm render records the engine, the exact WASM, the config, and every plan it performed', () => {
    const { identity } = planRustMotion(args, engine);
    const manifest = readArtifactManifest();
    assert.equal(identity.motionEngine, 'rust-wasm');
    assert.deepEqual(identity.crate, { name: 'motion-intelligence', version: crateVersion() });
    assert.equal(identity.abi, 1);
    assert.equal(identity.wasm.sha256, sha256Hex(readFileSync(path.join(VIDEO_ROOT, identity.wasm.path))));
    assert.equal(identity.wasm.sha256, manifest.sha256);
    assert.equal(identity.toolchain.rustc, manifest.build.rustc);
    assert.deepEqual(identity.config, { path: 'config/motion-intelligence.json', schema: 'walletwall.motion-intelligence-config/v1', id: 'walletwallaby-motion-intelligence', version: 1, sha256: contentAddress(readMotionIntelligenceConfig()) });
    assert.equal(identity.paths.length, 1);
    assert.equal(identity.paths[0]!.planSha256, sha256Hex(fixturePlan), 'the plan the render used is the canonical plan');
    assert.deepEqual(planRustMotion(args, engine).identity, identity, 'deterministic');
  });

  test('a typescript render says so, and the provenance manifest carries whichever engine made the render', () => {
    assert.deepEqual(typescriptEngineIdentity(), { motionEngine: 'typescript', motion: { id: MOTION.id, version: MOTION.version } });
    const { identity } = planRustMotion(args, engine);
    const manifest = buildProvenanceManifest({ spec, track: args.track, timeline: { totalMs: 1, segments: [] } as never, cueSheet: { identAsset: null, musicBed: { id: null }, cues: [], suppressed: [] } as never, validation: { ok: true, errors: 0, warnings: 0, issues: [] } as never, render: { engine: 'remotion', version: '4', output: 'x.mp4', sha256: 'a'.repeat(64), motionEngine: identity }, identity: buildIdentity() });
    assert.equal(manifest.schema, 'walletwall.video-provenance/v3');
    assert.equal(manifest.render?.motionEngine.motionEngine, 'rust-wasm');
  });
});

describe('determinism guards', () => {
  test('the motion engine modules read no clock, randomness, or environment', () => {
    for (const f of ['plan.ts', 'rust-path.ts', 'rust-adapter.ts', 'artifact.ts', 'engine-identity.ts']) {
      const src = readFileSync(path.join(VIDEO_ROOT, 'src', 'motion', f), 'utf8');
      assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|requestAnimationFrame|setTimeout|process\.env/.test(src), f);
    }
  });
});
