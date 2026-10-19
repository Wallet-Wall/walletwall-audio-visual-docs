// The Rust/WASM Motion Intelligence engine, end to end: the committed artifact, the TS -> WASM -> TS
// round trip on the committed lesson's engine paths (every hop that ends in a perch), fail-closed
// refusals at both layers, plan validation, the composition's binding and sampling, the scene's
// reactions to the engine's own contacts, exact oracle parity with the transitional TypeScript
// solver (on the lesson and on a sweep of synthetic hops), and render provenance. Every refusal has
// a positive control.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { MOTION_CONFIG, MotionPlanError, planHop, planMotion, platformOffsets, sampleWallaby, SETTLE_RESERVE_MS, type HopMotion, type MotionEvent, type MotionPlan as TsMotionPlan } from '../src/character/walletwallaby/motion.ts';
import { rigControls } from '../src/character/walletwallaby/rig/rig-controls.ts';
import { WALLABY_HEIGHT } from '../src/character/walletwallaby/rig.ts';
import { MOTION } from '../src/character/walletwallaby/versions.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { WALLABY_EXTENT } from '../src/layout/scene-layout.ts';
import { terrainsFor, type TerrainSurface } from '../src/layout/terrain.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { ABI_FUNCTIONS, assertHermetic, crateSourceSha256, crateVersion, inspectWasm, loadVerifiedArtifact, MOTION_CRATE_DIR, readArtifactManifest, verifyArtifactBytes } from '../src/motion/artifact.ts';
import { MOTION_INTELLIGENCE_CONFIG_PINS, readMotionIntelligenceConfig, typescriptEngineIdentity } from '../src/motion/engine-identity.ts';
import { expectationFor, MotionEngineError, validateMotionPlan, type MotionErrorCode, type MotionInput, type MotionRect } from '../src/motion/plan.ts';
import { planRustMotion, rustInputsFor, RustMotionEngine } from '../src/motion/rust-adapter.ts';
import { bindMotionEngine, engineContacts, findRustPath, findRustPaths, MOTION_INTELLIGENCE_CONFIG, RUST_MOTION_PATHS, sampleWithEngine, selectRustPaths, type MotionEngineProps, type RustPathSelection } from '../src/motion/rust-path.ts';
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
const input = inputs.find((i) => i.selection.segmentId === 'takeaway')!.input;
const FIXTURES = path.join(MOTION_CRATE_DIR, 'tests', 'fixtures');
/** The canonical fixtures (scripts/motion-fixtures.ts): the first engine path in each of these segments. */
const FIXTURE_PATHS = [
  { name: 'takeaway-hop', segmentId: 'takeaway' },
  { name: 'hook-hop', segmentId: 'hook' },
  { name: 'reading-land', segmentId: 'reading' },
  { name: 'signals-hop', segmentId: 'signals' },
] as const;
const readFixture = (name: string): { input: MotionInput; plan: Uint8Array } => ({
  input: JSON.parse(readFileSync(path.join(FIXTURES, `${name}.input.json`), 'utf8')) as MotionInput,
  plan: new Uint8Array(readFileSync(path.join(FIXTURES, `${name}.plan.json`))),
});
const fixtureInput = readFixture('takeaway-hop').input;
const fixturePlan = readFixture('takeaway-hop').plan;
/** Every TRAVEL clip of the committed lesson that the transitional solver performs as a hop from a stance ending in a perch. */
const HOPS_TO_PERCHES = [1, 4, 7, 28, 33, 40, 42, 44, 48, 50, 52, 54];
/** The tiers arrival: the fall that continues the previous scene's exit leap (no takeoff), which stays TypeScript. */
const FALL = 14;
const terrains = terrainsFor(timeline.segments, layouts);
/** Two level tops spanning (and overhanging) the frame at the two heights of a synthetic hop: open terrain under both ends. */
const openTerrain = (a: { y: number }, b: { y: number }): TerrainSurface[] => [
  { id: 'from:top', element: 'from', face: 'TOP', support: 'SUPPORTED_SURFACE', x0: -200, y0: a.y, x1: 2120, y1: a.y, thicknessPx: 1080 - a.y },
  ...(b.y === a.y ? [] : [{ id: 'to:top', element: 'to', face: 'TOP', support: 'SUPPORTED_SURFACE', x0: -200, y0: b.y, x1: 2120, y1: b.y, thicknessPx: 1080 - b.y } as const]),
];
const frameMs = (f: number): number => (f * 1000) / fps;
const maxResponseWindow = Math.max(...Object.values(ts.config.response).map((r) => r.windowMs));

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
    assert.deepEqual(input.destination.candidates[plan.support.candidate], travel.to, 'the stand the lesson authored and the transitional layer chose');
    assert.equal(plan.support.landing.verdict.grade, 'BROAD');
    assert.equal(plan.support.takeoff?.terrain, 'OUTGOING', 'the takeoff stands on the card still on screen from the previous scene');
    assert.deepEqual(plan.samples.at(-1)!.position, travel.to);
    assert.equal(plan.samples.at(-1)!.phase, 'PERCH');
    assert.equal(plan.frames.fps, fps);
    assert.ok(plan.frames.count > 200);
  });

  test('the converter builds exactly the canonical fixture inputs, and the artifact returns exactly the canonical plan bytes', () => {
    for (const f of FIXTURE_PATHS) {
      const fixture = readFixture(f.name);
      assert.deepEqual(inputs.find((i) => i.selection.segmentId === f.segmentId)!.input, fixture.input, `${f.name} is the real path; regenerate with npm run motion:fixtures`);
      const { bytes } = engine.solve(fixture.input);
      assert.ok(Buffer.compare(Buffer.from(bytes), Buffer.from(fixture.plan)) === 0, `${f.name}: the wasm plan differs from the fixture the native Rust tests also pin`);
    }
  });

  test('the engine reads the same terrain the transitional solver avoids and judges: its surfaces, its text in its order, the outgoing scene, and the figure box', () => {
    for (const { selection, input: i } of inputs) {
      const layout = layouts.get(selection.segmentId);
      const expected = layout ? [...layout.texts.map((t) => t.rect), { x: 160, y: 104, w: 1100, h: 32 }] : [];
      assert.deepEqual(i.terrain.protectedText, expected.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })), `${selection.segmentId} clip ${selection.clip}`);
      assert.deepEqual(i.terrain.surfaces, terrains.get(selection.segmentId)!.surfaces, 'every declared surface, as declared');
      const k = timeline.segments.findIndex((x) => x.id === selection.segmentId);
      const previous = k > 0 ? terrains.get(timeline.segments[k - 1]!.id) : undefined;
      assert.deepEqual(i.terrain.outgoing, { surfaces: previous?.surfaces ?? [], protectedText: previous?.protectedText.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) ?? [], untilMs: timeline.segments[k]!.contentStartMs });
      assert.deepEqual(i.terrain.figure, { left: WALLABY_EXTENT.left, right: WALLABY_EXTENT.right, top: WALLABY_EXTENT.top });
    }
    assert.ok(inputs.some((i) => i.input.terrain.protectedText.length > 1) && inputs.some((i) => i.input.terrain.protectedText.length === 0), 'control: scenes protect text, brand segments do not');
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
    assert.deepEqual(plan.target, input.destination.candidates[plan.support.candidate]);
    assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.target) && Object.isFrozen(plan.samples.at(-1)!.position) && Object.isFrozen(plan.events[1]!), 'the plan cannot be edited after validation');
    assert.throws(() => {
      (plan.target as { x: number }).x = 0;
    }, TypeError);
  });
});

describe('fail closed', () => {
  test('the adapter refuses what JSON would silently corrupt, before the engine sees it', () => {
    assert.equal(refusal(() => engine.solve(variant((i) => (i.destination.candidates[0].x = Number.NaN)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.terrain.surfaces[1].y0 = Number.NaN)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.timing.endMs = Number.POSITIVE_INFINITY)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.config.tail.freqHz = Number.NEGATIVE_INFINITY)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.terrain.protectedText[0].y = Number.NaN)))), 'NON_FINITE_VALUE');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.stance.rest.tailDeg = undefined)))), 'INVALID_INPUT');
    assert.equal(refusal(() => engine.solve(variant((i) => (i.stance.rest.tailCurl = undefined)))), 'INVALID_INPUT');
    assert.doesNotThrow(() => engine.solve(variant(() => {})), 'control: an untouched copy solves');
  });

  test('the engine refuses malformed, impossible, or unsupported input with its own codes', () => {
    const cases: [string, (i: Record<string, any>) => void, MotionErrorCode][] = [
      ['unknown field', (i) => (i.wobble = 1), 'INVALID_INPUT'],
      ['string number', (i) => (i.destination.candidates[0].x = '1600'), 'INVALID_INPUT'],
      ['the v2 target in place of a destination', (i) => ((i.target = i.destination.candidates[0]), delete i.destination), 'INVALID_INPUT'],
      ['an unknown support class', (i) => (i.terrain.surfaces[0].support = 'TRAMPOLINE'), 'INVALID_INPUT'],
      ['no authored stand', (i) => (i.destination.candidates = []), 'INVALID_INPUT'],
      ['missing field', (i) => delete i.stance, 'INVALID_INPUT'],
      ['omitted protected text', (i) => delete i.terrain.protectedText, 'INVALID_INPUT'],
      ['omitted figure', (i) => delete i.terrain.figure, 'INVALID_INPUT'],
      ['text with a negative size', (i) => (i.terrain.protectedText[0].w = -1), 'INVALID_INPUT'],
      ['a figure with no height', (i) => (i.terrain.figure.top = 0), 'INVALID_INPUT'],
      ['a tail curl past its range', (i) => (i.stance.rest.tailCurl = 5), 'INVALID_INPUT'],
      ['a tail tension past 1', (i) => (i.stance.initial.tailTension = 1.5), 'INVALID_INPUT'],
      ['fractional fps', (i) => (i.fps = 29.97), 'INVALID_INPUT'],
      ['config out of range', (i) => (i.config.gravityBodyHeightsPerS2 = 500), 'INVALID_CONFIG'],
      ['absurd peak height', (i) => (i.config.hop.peakMax = 5), 'INVALID_CONFIG'],
      ['a minimum settle longer than the settle', (i) => (i.config.landing.minSettleMs = 800), 'INVALID_CONFIG'],
      ['negative start', (i) => (i.timing.startMs = -5), 'INVALID_DURATION'],
      ['zero window', (i) => (i.timing.arriveByMs = i.timing.startMs), 'INVALID_DURATION'],
      ['window closes before the landing can settle', (i) => (i.timing.endMs = i.timing.arriveByMs + 100), 'INVALID_DURATION'],
      ['unsupported action', (i) => (i.action = 'MANTLE'), 'UNSUPPORTED_ACTION'],
      ['a stand off its ledge', (i) => (i.destination.candidates = [{ x: 1900, y: 600 }]), 'IMPLAUSIBLE_SUPPORT'],
      ['a stand inside its ledge', (i) => (i.destination.candidates = [{ x: 1600, y: 700 }]), 'IMPLAUSIBLE_SUPPORT'],
      ['a takeoff from terrain no longer on screen', (i) => (i.terrain.outgoing.surfaces = []), 'IMPLAUSIBLE_SUPPORT'],
      ['unreachable in the window', (i) => ((i.start.x = 0), (i.destination.candidates = [{ x: 1850, y: 880 }]), (i.timing.arriveByMs = i.timing.startMs + 400)), 'UNSOLVABLE_TRAJECTORY'],
      ['a stand off stage', (i) => (i.destination.candidates = [{ x: 1600, y: 1200 }]), 'OUT_OF_BOUNDS'],
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
      ['another stand named', (p) => (p.support.candidate = 1)],
      ['a refused landing', (p) => ((p.support.landing.verdict.ok = false), (p.support.landing.verdict.code = 'NO_SURFACE'), (p.support.landing.verdict.grade = null))],
      ['an ok verdict with a refusal code', (p) => (p.support.candidates[0].code = 'TAIL_ONLY')],
      ['an unknown support code', (p) => (p.support.landing.verdict.code = 'FLOATING')],
      ['the takeoff left unjudged on stage', (p) => (p.support.takeoff = null)],
      ['the landing judged a moment late', (p) => (p.support.landing.atMs += 1)],
      ['a verdict number turned null', (p) => (p.support.landing.verdict.comMarginPx = null)],
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
      ['the landing stated a moment late', (p) => (p.events[1].atMs += 1)],
      ['the takeoff stated somewhere else', (p) => (p.events[0].position.x += 1)],
      ['the landing on the wrong terrain', (p) => (p.events[1].contact = 'GROUND')],
      ['an impulse past 1', (p) => (p.events[1].impulse = 1.5)],
      ['a third contact', (p) => p.events.push(p.events[1])],
      ['contacts out of order', (p) => p.events.reverse()],
      ['an arc the search cannot choose', (p) => (p.trajectory.textCrossings = 32)],
      ['not at rest when handed back', (p) => (p.samples.at(-1).tailAngle = 0.5)],
      ['handed back out of its stance\'s curl', (p) => (p.samples.at(-1).tailCurl = 0.5)],
      ['wrong schema', (p) => (p.schema = 'walletwall.motion-plan/v2')],
      ['another engine', (p) => (p.engine.name = 'something-else')],
    ];
    for (const [name, tamper] of cases) {
      const p = raw();
      tamper(p);
      assert.equal(refusal(() => validateMotionPlan(p, expect)), 'INVALID_PLAN', name);
    }
  });
});

describe('the engine performs every hop that ends in a perch, in the composition', () => {
  const rust = planRustMotion(args, engine);
  const bound = bindMotionEngine(rust.props, ts, fps, spec.id);
  const frames = totalFrames(timeline);
  const pathAt = (f: number) => bound.paths.find((p) => f >= p.first && f < p.end);
  const takeaway = bound.paths.find((p) => p.travel.segmentId === 'takeaway')!;

  test('every hop to a perch is selected and bound, and nothing else; the default render binds no engine at all', () => {
    assert.equal(bound.engine, 'rust-wasm');
    assert.deepEqual(RUST_MOTION_PATHS, [{ videoId: spec.id, paths: 'HOPS_TO_PERCHES' }]);
    assert.deepEqual(bound.paths.map((p) => p.travelIndex), HOPS_TO_PERCHES);
    for (const [i, c] of ts.clips.entries()) {
      if (c.kind !== 'TRAVEL' || HOPS_TO_PERCHES.includes(i)) continue;
      const next = ts.clips[i + 1];
      const perch = next?.kind === 'HOLD' && next.from.x === c.to.x && next.from.y === c.to.y;
      const m = ts.motions[i]!;
      assert.ok(m.kind !== 'HOP' || !perch || m.airborneStart, `clip ${i} stays on the TypeScript solver only because it is not a hop from a stance to a perch`);
    }
    const fall = ts.motions[FALL]!;
    assert.ok(fall.kind === 'HOP' && fall.airborneStart && ts.clips[FALL]!.segmentId === 'tiers', 'control: the tiers arrival is a fall that continues the exit leap, and stays TypeScript');
    assert.equal(ts.motions[37]!.kind, 'TRACE', 'control: a chained skip stays TypeScript');
    assert.equal(ts.clips[31]!.kind, 'TRAVERSE', 'control: the hop at clip 30 runs straight into a trace and stays TypeScript');
    assert.deepEqual(bindMotionEngine(undefined, ts, fps, spec.id), { engine: 'typescript', transitional: ts, paths: [], contacts: ts.events, muted: new Set() });
  });

  test('outside its paths every frame is the TypeScript solver without the engine\'s own follow-through; inside, the feet are exactly where the oracle puts them', () => {
    let inside = 0;
    let tailDiffers = 0;
    const changed: number[] = [];
    for (let f = 0; f < frames; f++) {
      const ms = frameMs(f);
      const a = sampleWithEngine(bound, ts, f, ms, 'REST');
      const b = sampleWallaby(ts, ms, 'REST', bound.muted, bound.contacts);
      const p = pathAt(f);
      if (!p) {
        assert.deepEqual(a, b, `frame ${f} outside the engine's paths`);
        if (!isDeepStrictEqual(a, sampleWallaby(ts, ms, 'REST'))) changed.push(f);
        continue;
      }
      inside++;
      const s = p.plan.samples[f - p.first]!;
      assert.equal(a.x, b.x, `frame ${f} x`);
      assert.equal(a.y, b.y, `frame ${f} y`);
      assert.equal(a.scale, b.scale);
      assert.equal(a.motion.contact, b.motion.contact);
      assert.equal(a.motion.tail.swing, s.tailAngle, 'the tail is the engine\'s');
      assert.equal(a.motion.rotation, s.bodyPitch);
      if (Math.abs(a.motion.tail.swing - b.motion.tail.swing) > 0.5) tailDiffers++;
    }
    assert.equal(inside, bound.paths.reduce((n, p) => n + p.plan.frames.count, 0));
    assert.ok(tailDiffers > 300, `positive control: the engine, not the transitional solver, drives the tail (${tailDiffers} frames differ)`);
    // Only where the transitional solver would still be settling an engine landing past its path's
    // end (the hook's short perch): the engine settled it inside its own window.
    assert.ok(changed.length > 0, 'control: the hook hop\'s landing would outlast its perch in the transitional solver');
    for (const f of changed) {
      assert.ok(
        bound.paths.some((p) => f >= p.end && [...p.events].some((e) => e.kind === 'LANDING' && frameMs(f) < e.atMs + maxResponseWindow)),
        `frame ${f} differs from the default render without an engine landing behind it`,
      );
    }
  });

  test('another move\'s tail and ear follow-through carries on over the engine\'s own; a landing\'s never runs into an engine path', () => {
    // On the committed lesson no engine path begins while another move still swings the tail.
    for (const p of bound.paths) {
      for (let f = p.first; f < p.end; f++) assert.equal(sampleWithEngine(bound, ts, f, frameMs(f), 'REST').motion.tailLag, 0, `${p.travel.segmentId} frame ${f}`);
    }
    // Carry one in: a takeoff 100 ms before the takeaway hop (findRustPath admits a takeoff's follow-through).
    const travel = ts.clips[takeaway.travelIndex]!;
    const kick: MotionEvent = { kind: 'TAKEOFF', atMs: travel.startMs - 100, impulse: 0.8, scale: travel.fromScale, at: travel.from, segmentId: 'takeaway', surface: null };
    const kicked: TsMotionPlan = { ...ts, events: [...ts.events, kick].sort((a, b) => a.atMs - b.atMs) };
    const rebound = bindMotionEngine(rust.props, kicked, fps, spec.id);
    const path0 = rebound.paths.find((p) => p.travel.segmentId === 'takeaway')!;
    let carried = 0;
    for (let f = path0.first; f < path0.end; f++) {
      const a = sampleWithEngine(rebound, kicked, f, frameMs(f), 'REST');
      const s = path0.plan.samples[f - path0.first]!;
      const b = sampleWallaby(kicked, frameMs(f), 'REST', rebound.muted, rebound.contacts);
      assert.equal(a.motion.tailLag, b.motion.tailLag);
      assert.equal(a.motion.earLag, Math.min(ts.config.limits.maxEarLagDeg, Math.max(-ts.config.limits.maxEarLagDeg, s.earLag + b.motion.earLag)));
      if (b.motion.tailLag !== 0) carried++;
    }
    assert.ok(carried > 10, `control: the carried-in takeoff still swings the tail as the takeaway hop begins (${carried} frames)`);
  });

  test('the scene reacts to the engine\'s own contacts: each platform\'s dip, the feet riding it, and the contact cues', () => {
    // The engine's takeoff and landing replace each path's own in the transitional plan, in time order.
    const stated = bound.contacts.filter((c) => !ts.events.includes(c));
    assert.equal(stated.length, 2 * bound.paths.length);
    assert.equal(bound.contacts.length, ts.events.length);
    assert.ok(bound.contacts.every((c) => !bound.muted.has(c)));
    assert.ok(bound.contacts.every((c, k) => k === 0 || bound.contacts[k - 1]!.atMs <= c.atMs), 'sorted by time');
    for (const p of bound.paths) {
      for (const e of p.plan.events) {
        const c = stated.find((x) => x.segmentId === p.travel.segmentId && x.kind === e.kind && x.atMs === e.atMs)!;
        assert.ok(c, `${p.travel.segmentId} ${e.kind}`);
        assert.equal(c.impulse, e.impulse);
        assert.equal(c.scale, e.scale);
        assert.deepEqual(c.at, e.position);
        assert.equal(c.surface, e.kind === 'LANDING' ? p.surfaces.to : null, 'a landing dips the surface under the target; a takeoff moves nothing');
      }
    }
    // Today the engine flies exactly the oracle's hop, so the scene is unchanged...
    const segments = [...new Set(ts.clips.map((c) => c.segmentId))];
    for (let f = 0; f < frames; f += 3) for (const seg of segments) assert.deepEqual(platformOffsets(ts, seg, frameMs(f), bound.contacts), platformOffsets(ts, seg, frameMs(f)), `frame ${f} ${seg}`);
    // ...but it follows the engine (positive controls): a softer stated landing dips the ledge less,
    // and a later one moves the platform and the landing cue with it.
    const landing = takeaway.plan.events[1]!;
    const restate = (edit: Partial<typeof landing>) => engineContacts(ts, bound.paths.map((p) => (p === takeaway ? { ...p, plan: { ...p.plan, events: [p.plan.events[0]!, { ...landing, ...edit }] } } : p)));
    const ledge = takeaway.surfaces.to!.id;
    const peak = (contacts: readonly MotionEvent[], from: number): number => {
      let m = 0;
      for (let t = from; t < from + 500; t += 5) m = Math.max(m, Math.abs(platformOffsets(ts, 'takeaway', t, contacts)[ledge] ?? 0));
      return m;
    };
    assert.ok(peak(bound.contacts, landing.atMs) > 0, 'control: the ledge dips under the landing');
    assert.ok(peak(restate({ impulse: landing.impulse / 2 }), landing.atMs) < peak(bound.contacts, landing.atMs), 'a softer landing dips it less');
    const later = restate({ atMs: landing.atMs + 100 });
    assert.equal(platformOffsets(ts, 'takeaway', landing.atMs + 50, later)[ledge] ?? 0, 0, 'nothing moves before the stated landing');
    const sheet = (contacts: readonly MotionEvent[]) => buildCueSheet(timeline, config.sonic, spec.audio.musicBedId, contacts);
    assert.deepEqual(sheet(bound.contacts), sheet(ts.events));
    const cueAt = (contacts: readonly MotionEvent[], at: number) => sheet(contacts).cues.some((c) => c.event === 'LANDING' && c.reason === 'CONTACT' && c.atMs === Math.round(at));
    assert.ok(cueAt(bound.contacts, landing.atMs) && cueAt(later, landing.atMs + 100) && !cueAt(later, landing.atMs), 'the landing cue sounds at the stated contact');
    // The feet ride the platform the scene dips, by exactly the same amount.
    let riding = 0;
    for (const p of bound.paths) {
      for (let f = p.first; f < p.end; f++) {
        const s = p.plan.samples[f - p.first]!;
        const a = sampleWithEngine(bound, ts, f, frameMs(f), 'REST');
        const surface = s.contact !== 'PLATFORM' ? null : ['IDLE', 'PRELOAD', 'TAKEOFF'].includes(s.phase) ? p.surfaces.from : p.surfaces.to;
        const dip = surface ? (platformOffsets(ts, p.travel.segmentId, frameMs(f), bound.contacts)[surface.id] ?? 0) : 0;
        assert.equal(a.motion.platformDip, dip, `${p.travel.segmentId} frame ${f}`);
        assert.equal(a.y, s.position.y + dip, `${p.travel.segmentId} frame ${f}`);
        if (dip !== 0) riding++;
      }
    }
    assert.ok(riding > 10, `control: platforms do dip under engine landings (${riding} frames)`);
  });

  test('the Rive rig accepts every engine state', () => {
    const finiteEverywhere = (v: unknown, at: string): void => {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${at} is not finite`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finiteEverywhere(x, `${at}.${k}`);
    };
    for (const p of bound.paths) {
      for (let f = p.first; f < p.end; f++) {
        const c = rigControls(sampleWithEngine(bound, ts, f, frameMs(f), 'REST'));
        finiteEverywhere(c, `frame ${f}`);
        assert.ok(Math.abs(c.clips.reduce((a, x) => a + x.weight, 0) - 1) < 1e-9, `frame ${f}: clip weights sum to 1`);
      }
    }
  });

  test('binding fails closed on any plan that does not answer exactly these clips', () => {
    const props = () => clone(rust.props) as MotionEngineProps & Record<string, any>;
    const k = rust.props.paths.findIndex((x) => x.segmentId === 'takeaway');
    const cases: [string, (p: Record<string, any>) => void][] = [
      ['target moved', (p) => (p.paths[k].plan.target.x += 1)],
      ['liftoff moved', (p) => ((p.paths[k].plan.timing.liftoffMs += 1), (p.paths[k].plan.trajectory.flightMs -= 1), (p.paths[k].plan.events[0].atMs += 1))],
      ['a contact moved', (p) => (p.paths[k].plan.events[1].atMs += 1)],
      ['wrong schema', (p) => (p.schema = 'walletwall.motion-engine-props/v1')],
      ['no plans', (p) => (p.paths = [])],
      ['an unselected path', (p) => p.paths.push({ ...p.paths[k], segmentId: 'outro' })],
      ['plans out of order', (p) => ([p.paths[0], p.paths[1]] = [p.paths[1], p.paths[0]])],
      ['the wrong clip', (p) => (p.paths[k].clip += 1)],
      ['a different arc', (p) => (p.paths[k].plan.trajectory.depthPx += 1)],
    ];
    for (const [name, tamper] of cases) {
      const p = props();
      tamper(p);
      assert.throws(() => bindMotionEngine(p, ts, fps, spec.id), MotionEngineError, name);
    }
    assert.throws(() => bindMotionEngine(rust.props, ts, 60, spec.id), MotionEngineError, 'another frame rate');
    const replanned = planMotion(choreograph(timeline, layouts), layouts);
    assert.equal(refusal(() => sampleWithEngine(bound, replanned, takeaway.first, frameMs(takeaway.first))), 'BINDING_MISMATCH', 'a plan object the engine was not bound to');
    assert.doesNotThrow(() => sampleWithEngine(bindMotionEngine(rust.props, replanned, fps, spec.id), replanned, takeaway.first, frameMs(takeaway.first)), 'control: bound to that plan, it samples');
    assert.doesNotThrow(() => bindMotionEngine(props(), ts, fps, spec.id), 'control: an untouched copy binds');
  });

  test('a plan whose samples fly elsewhere is refused at bind, before any frame is drawn, down to one ULP', () => {
    const k = rust.props.paths.findIndex((x) => x.segmentId === 'takeaway');
    const i = rust.props.paths[k]!.plan.samples.findIndex((s) => s.phase === 'AIRBORNE' && s.phaseProgress > 0.4);
    const nextUp = (v: number): number => {
      const b = new Float64Array([v]);
      const u = new BigUint64Array(b.buffer);
      u[0] = u[0]! + (v >= 0 ? 1n : -1n);
      return b[0]!;
    };
    const tampered = (y: (v: number) => number) => {
      const p = clone(rust.props) as MotionEngineProps & Record<string, any>;
      const s = p.paths[k]!.plan.samples[i]! as { position: { y: number } };
      s.position.y = y(s.position.y);
      return p;
    };
    for (const [name, y] of [['half a pixel', (v: number) => v + 0.5], ['one ULP', nextUp]] as const) {
      const p = tampered(y);
      assert.doesNotThrow(() => validateMotionPlan(clone(p.paths[k]!.plan), expectationFor(input)), `control (${name}): the sample stays inside its arc, so validation alone passes it`);
      assert.equal(refusal(() => bindMotionEngine(p, ts, fps, spec.id)), 'BINDING_MISMATCH', name);
    }
    assert.doesNotThrow(() => bindMotionEngine(tampered((v) => v), ts, fps, spec.id), 'control: the untouched sample binds');
  });

  test('frame order does not change the output: engine frames sampled shuffled or reversed are the frames sampled in order', () => {
    const engineFrames = bound.paths.flatMap((p) => Array.from({ length: p.end - p.first }, (_, k) => p.first + k));
    const inOrder = new Map(engineFrames.map((f) => [f, sampleWithEngine(bound, ts, f, frameMs(f), 'REST')]));
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    let stride = 1009;
    while (gcd(stride, engineFrames.length) !== 1) stride++;
    const shuffled = engineFrames.map((_, k) => engineFrames[(k * stride) % engineFrames.length]!);
    assert.equal(new Set(shuffled).size, engineFrames.length, 'control: a permutation of every engine frame');
    assert.notDeepEqual(shuffled.slice(0, 10), engineFrames.slice(0, 10), 'control: not timeline order');
    for (const f of shuffled) assert.deepEqual(sampleWithEngine(bound, ts, f, frameMs(f), 'REST'), inOrder.get(f), `frame ${f}`);
    for (const f of [...engineFrames].reverse()) assert.deepEqual(rigControls(sampleWithEngine(bound, ts, f, frameMs(f), 'REST')), rigControls(inOrder.get(f)!), `frame ${f}: rig controls`);
    assert.notDeepEqual(inOrder.get(engineFrames[100]!), inOrder.get(engineFrames[101]!), 'control: neighbouring frames differ, so the comparison can fail');
  });

  test('without the engine, every frame of the video and every platform is exactly the TypeScript solver', () => {
    const none = bindMotionEngine(undefined, ts, fps, spec.id);
    let differs = 0;
    for (let f = 0; f < frames; f++) {
      const ms = frameMs(f);
      const b = sampleWallaby(ts, ms, 'REST');
      assert.deepEqual(sampleWithEngine(none, ts, f, ms, 'REST'), b, `frame ${f}`);
      if (!isDeepStrictEqual(sampleWithEngine(bound, ts, f, ms, 'REST'), b)) differs++;
    }
    assert.ok(differs > 1000, `control: with the engine, ${differs} frames differ`);
    assert.equal(none.contacts, ts.events, 'the platforms react to the plan\'s own contacts');
    const segments = [...new Set(ts.clips.map((c) => c.segmentId))];
    for (let f = 0; f < frames; f += 5) for (const seg of segments) assert.deepEqual(platformOffsets(ts, seg, frameMs(f), none.contacts), platformOffsets(ts, seg, frameMs(f)), `frame ${f} ${seg}`);
  });

  test('a path the engine cannot perform exactly is refused, never silently left to TypeScript', () => {
    const sel = (segmentId: string, clip: number, action: RustPathSelection['action'] = 'HOP'): RustPathSelection => ({ videoId: spec.id, segmentId, clip, action });
    assert.equal(refusal(() => findRustPath(ts, sel('nowhere', 999))), 'INELIGIBLE_PATH');
    assert.equal(refusal(() => findRustPath(ts, sel('vault-conditional', 37, 'LAND'))), 'INELIGIBLE_PATH', 'a chained skip, not a hop');
    assert.equal(refusal(() => findRustPath(ts, sel('signals', 30))), 'INELIGIBLE_PATH', 'a hop that runs straight into a trace');
    assert.equal(refusal(() => findRustPath(ts, sel('tiers', FALL))), 'INELIGIBLE_PATH', 'a fall that continues a flight (no takeoff)');
    assert.equal(refusal(() => findRustPath(ts, sel('takeaway', 44, 'LAND'))), 'INELIGIBLE_PATH', 'the lesson asks for a HOP there');
    assert.doesNotThrow(() => findRustPath(ts, sel('takeaway', 44)), 'control: the takeaway hop is eligible');
    // Variations of the takeaway path, each refused for one reason.
    const travel = ts.clips[44]!;
    const edited = (edit: (t: TsMotionPlan) => void): TsMotionPlan => {
      const t = { ...ts, clips: [...ts.clips], surfaces: [...ts.surfaces], events: [...ts.events] };
      edit(t);
      t.events.sort((a, b) => a.atMs - b.atMs);
      return t;
    };
    const comparing = edited((t) => (t.clips[45] = { ...t.clips[45]!, lookAlt: { x: 400, y: 400 } }));
    assert.equal(refusal(() => findRustPath(comparing, sel('takeaway', 44))), 'INELIGIBLE_PATH', 'a comparing perch');
    const narrow = edited((t) => (t.surfaces[44] = { ...t.surfaces[44]!, to: { ...t.surfaces[44]!.to!, x1: t.surfaces[44]!.to!.x0 + 60 } }));
    assert.equal(refusal(() => findRustPath(narrow, sel('takeaway', 44))), 'INELIGIBLE_PATH', 'a narrow perch');
    const event = (kind: MotionEvent['kind']): MotionEvent => ({ kind, atMs: travel.startMs - 100, impulse: 0.5, scale: travel.fromScale, at: travel.from, segmentId: 'takeaway', surface: null });
    assert.equal(refusal(() => findRustPath(edited((t) => t.events.push(event('LANDING'))), sel('takeaway', 44))), 'INELIGIBLE_PATH', 'another landing still settling');
    assert.doesNotThrow(() => findRustPath(edited((t) => t.events.push(event('TAKEOFF'))), sel('takeaway', 44)), 'control: a takeoff\'s follow-through may run on');
    assert.doesNotThrow(() => findRustPaths(ts, spec.id), 'every hop to a perch in the lesson is eligible');
    assert.deepEqual(selectRustPaths(ts, 'some-other-video'), [], 'a video the engine does not perform selects nothing');
  });
});

describe('oracle parity with the transitional TypeScript solver', () => {
  test('every engine path flies exactly the TypeScript hop: liftoff, contact, arc, text crossings, and contacts', () => {
    const { bound } = planRustMotion(args, engine);
    for (const p of bound.paths) {
      const at = `${p.travel.segmentId} clip ${p.travelIndex}`;
      const { timing, trajectory, events } = p.plan;
      assert.equal(timing.orientEndMs, p.hop.orientEndMs, at);
      assert.equal(timing.liftoffMs, p.hop.takeoffMs, at);
      assert.equal(timing.contactMs, p.hop.contactMs, at);
      assert.equal(trajectory.depthPx, p.hop.depthPx, at);
      assert.equal(trajectory.gravityPxPerS2, p.hop.gravityPx, at);
      assert.equal(trajectory.apexAbovePx, p.hop.apexAbovePx, at);
      assert.equal(trajectory.textCrossings, p.hop.textCrossings, at);
      for (const e of events) {
        const own = [...p.events].find((x) => x.kind === e.kind)!;
        assert.equal(e.atMs, own.atMs, `${at} ${e.kind}`);
        assert.equal(e.impulse, own.impulse, `${at} ${e.kind} impulse: the same the transitional plan states`);
        assert.equal(e.scale, own.scale);
        assert.deepEqual(e.position, own.at);
      }
    }
    // The search did real work on the lesson: arcs lowered and kept (the synthetic sweep below also raises them).
    const fractions = bound.paths.map((p) => p.plan.trajectory.arcFraction);
    assert.ok(fractions.some((f) => f < 1) && fractions.some((f) => f === 1), fractions.join(' '));
  });

  test('the arc search is an exact port: a sweep of synthetic hops flies the same arc, bit for bit, or both refuse', () => {
    const texts: MotionRect[][] = [
      [],
      [{ x: 800, y: 380, w: 200, h: 40 }],
      [{ x: 860, y: 600, w: 40, h: 50 }],
      // Text over the whole frame above the feet (no stand may have text where its feet touch).
      [{ x: 0, y: 0, w: 1920, h: 480 }],
      [{ x: 500, y: 520, w: 600, h: 60 }, { x: 160, y: 104, w: 1100, h: 32 }],
    ];
    let solved = 0;
    let refused = 0;
    const fractions = new Set<number>();
    for (const from of [{ x: 200, y: 800 }, { x: 700, y: 640 }]) {
      for (const to of [{ x: 400, y: 800 }, { x: 1300, y: 800 }, { x: 1300, y: 520 }, { x: 1800, y: 900 }]) {
        for (const dur of [450, 800, 1500]) {
          for (const [fromScale, toScale] of [[0.78, 0.78], [0.5, 0.78], [1, 0.95]] as const) {
            for (const text of texts) {
              const i = variant((x) => {
                Object.assign(x, { start: from, destination: { candidates: [to], focus: { x: to.x + 100, y: to.y - 200 }, narrowAllowed: false }, startScale: fromScale, targetScale: toScale, timing: { startMs: 1000, arriveByMs: 1000 + dur, endMs: 3000 + dur } });
                Object.assign(x.terrain, { surfaces: openTerrain(from, to), protectedText: text, outgoing: { surfaces: [], protectedText: [], untilMs: 0 } });
              });
              const at = `${JSON.stringify([from, to, dur, fromScale, toScale])} text ${texts.indexOf(text)}`;
              let hop: HopMotion | null = null;
              try {
                hop = planHop({ from, to, fromScale, toScale, startMs: 1000, endMs: 1000 + dur, avoid: text.length ? text : undefined }, MOTION_CONFIG);
              } catch (err) {
                assert.ok(err instanceof MotionPlanError, at);
              }
              let plan: ReturnType<typeof engine.solve>['plan'] | null = null;
              let code: MotionErrorCode | null = null;
              try {
                plan = engine.solve(i).plan;
              } catch (err) {
                assert.ok(err instanceof MotionEngineError, at);
                code = err.code;
              }
              if (!hop) {
                assert.ok(code === 'UNSOLVABLE_TRAJECTORY' || code === 'INVALID_DURATION', `${at}: the oracle refuses, the engine said ${code ?? 'yes'}`);
                refused++;
                continue;
              }
              assert.ok(plan, `${at}: the oracle flies it, the engine refused with ${code}`);
              assert.equal(plan.timing.orientEndMs, hop.orientEndMs, at);
              assert.equal(plan.timing.liftoffMs, hop.takeoffMs, at);
              assert.equal(plan.timing.contactMs, hop.contactMs, at);
              assert.equal(plan.trajectory.depthPx, hop.depthPx, at);
              assert.equal(plan.trajectory.gravityPxPerS2, hop.gravityPx, at);
              assert.equal(plan.trajectory.apexAbovePx, hop.apexAbovePx, at);
              assert.equal(plan.trajectory.textCrossings, hop.textCrossings, at);
              fractions.add(plan.trajectory.arcFraction);
              solved++;
            }
          }
        }
      }
    }
    assert.ok(solved > 150 && refused > 0, `control: the sweep flies most hops and refuses some (${solved} flown, ${refused} refused)`);
    assert.ok([...fractions].some((f) => f < 1) && [...fractions].some((f) => f > 1) && fractions.has(1), `control: the sweep reaches lower, higher, and natural arcs (${[...fractions].join(' ')})`);
  });

  test('the engine is stricter than the oracle in exactly one way: it refuses an arc that rises past limits.maxApexBodyHeights', () => {
    // A screen-wide hop at half scale: the speed limit buys flight time with a higher arc (about 2.7 body heights).
    const from = { x: 0, y: 800 };
    const to = { x: 1920, y: 800 };
    const hop = planHop({ from, to, fromScale: 0.5, toScale: 0.5, startMs: 1000, endMs: 2500 }, MOTION_CONFIG);
    const limit = MOTION_INTELLIGENCE_CONFIG.limits.maxApexBodyHeights * WALLABY_HEIGHT * 0.5;
    assert.ok(hop.apexAbovePx > limit, `the oracle flies it ${hop.apexAbovePx.toFixed(1)} px high`);
    const open = { surfaces: openTerrain(from, to), protectedText: [], outgoing: { surfaces: [], protectedText: [], untilMs: 0 } };
    const i = variant((x) => {
      Object.assign(x, { start: from, destination: { candidates: [to], focus: { x: 1920, y: 600 }, narrowAllowed: false }, startScale: 0.5, targetScale: 0.5, timing: { startMs: 1000, arriveByMs: 2500, endMs: 4500 } });
      Object.assign(x.terrain, open);
    });
    assert.equal(refusal(() => engine.solve(i)), 'UNSOLVABLE_TRAJECTORY', 'the engine fails closed instead');
    const lower = variant((x) => {
      Object.assign(x, { start: { x: 300, y: 800 }, destination: { candidates: [{ x: 1500, y: 800 }], focus: { x: 1920, y: 600 }, narrowAllowed: false }, startScale: 0.5, targetScale: 0.5, timing: { startMs: 1000, arriveByMs: 2500, endMs: 4500 } });
      Object.assign(x.terrain, open);
    });
    assert.doesNotThrow(() => engine.solve(lower), 'control: a shorter hop at the same scale stays under the limit');
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
    assert.equal(c.ears.maxDeg, m.limits.maxEarLagDeg);
    assert.equal(c.limits.maxHeadDeg, m.limits.maxHeadStabDeg);
    assert.deepEqual(c.support, m.support, 'one support judge: the same geometry on both sides');
    // The engine has no resting tension of its own: a plain standing stance carries the transitional
    // layer's, and an inspecting perch its lifted, curled counterweight.
    assert.equal(input.stance.rest.tailTension, m.tail.restTension);
    assert.ok(!('tensionRest' in c.tail));
    const inspecting = inputs.find((i) => i.selection.segmentId === 'signals')!.input.stance.rest;
    assert.ok(inspecting.tailTension > m.tail.restTension && inspecting.tailCurl > 0, 'control: an inspecting perch differs');
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
    assert.deepEqual(identity.config, { path: 'config/motion-intelligence.json', schema: 'walletwall.motion-intelligence-config/v3', id: 'walletwallaby-motion-intelligence', version: 3, sha256: contentAddress(readMotionIntelligenceConfig()) });
    assert.deepEqual(identity.paths.map((p) => p.clip), HOPS_TO_PERCHES);
    for (const f of FIXTURE_PATHS) assert.equal(identity.paths.find((p) => p.segmentId === f.segmentId)!.planSha256, sha256Hex(readFixture(f.name).plan), `the plan the render used for ${f.name} is the canonical plan`);
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
