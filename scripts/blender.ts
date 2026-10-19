// The Blender presentation lane (docs/BLENDER.md).
//
// npm run blender:build                      -> dist/blender/out/character/walletwallaby.blend + model.json
// npm run blender:render -- [videoId] --frames=a..b [--every=n] [--name=id] [--motion-engine=typescript|rust-wasm]
//                                            -> dist/blender/out/renders/<name>/fNNNNN.png + render.json + bridge.json
//
// Motion Intelligence decides; this script exports its decisions (the bridge),
// hands them to the pinned Blender with fixed arguments, and verifies every
// file Blender wrote against the manifest Blender wrote.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WallabyState } from '../src/character/walletwallaby/motion.ts';
import { AIRBORNE, LAND_HARD, POSES, PUSH } from '../src/character/walletwallaby/rig.ts';
import { compileRig } from '../src/character/walletwallaby/rig/rig-compile.ts';
import { BLENDER_MOTION_SCHEMA, bridgeFrame, PLANE_ORIGIN, UNITS_PER_PX, validateBridge } from '../src/character/walletwallaby/blender/bridge.ts';
import { blenderRigDocument } from '../src/character/walletwallaby/blender/rig-export.ts';
import type { Terrain } from '../src/layout/terrain.ts';
import { staticState } from '../src/remotion/review/review-states.ts';
import { readPng } from './review/png.ts';
import { characterCrop } from '../src/character/walletwallaby/blender/crop.ts';
import { RIG_ENVELOPE } from '../src/character/walletwallaby/rig/rig-source.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { blenderIdentity, CHARACTER } from '../src/blender/identity.ts';
import { lessonBridge, lessonMotion, lessonTerrain } from '../src/blender/lesson.ts';
import { RIG } from '../src/character/walletwallaby/versions.ts';
import { BLENDER_OUT, blenderConfigSha256, blenderSourceSha256, findBlender, loadBlenderConfig, outFile, runBlender, writeJob } from '../src/blender/toolchain.ts';

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const cfg = loadBlenderConfig();
const blender = findBlender(cfg);
console.log(`[blender] Blender ${blender.version} (${blender.buildHash}), config ${blenderConfigSha256(cfg).slice(0, 12)}, source ${blenderSourceSha256().sha256.slice(0, 12)}`);


function build(): void {
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob('build', { schema: 'walletwall.blender-job/v1', kind: 'build', config: cfg, rig, outputs: CHARACTER });
  const { ms } = runBlender(blender, cfg, 'build.py', job);
  const model = JSON.parse(readFileSync(outFile(CHARACTER.manifest), 'utf8')) as { modelSha256: string; materialsSha256: string };
  const blendSha = sha256Hex(readFileSync(outFile(CHARACTER.blend)));
  console.log(`[blender] built in ${(ms / 1000).toFixed(1)} s: model ${model.modelSha256.slice(0, 12)}, materials ${model.materialsSha256.slice(0, 12)}, .blend ${blendSha.slice(0, 12)}`);
}

function parseFrames(spec: string): { first: number; last: number } {
  const m = /^(\d+)\.\.(\d+)$/.exec(spec);
  if (!m) throw new Error(`--frames must be a..b, got ${JSON.stringify(spec)}`);
  return { first: Number(m[1]), last: Number(m[2]) };
}

async function render(): Promise<void> {
  const videoId = args.slice(1).find((a) => !a.startsWith('--')) ?? 'migration-readiness';
  const engine = (opt('motion-engine') ?? 'typescript') as 'typescript' | 'rust-wasm';
  const { first, last } = parseFrames(opt('frames') ?? '');
  const every = Number(opt('every') ?? '1');
  const name = opt('name') ?? `${videoId}-${first}-${last}`;
  if (!/^[a-z0-9][a-z0-9.-]{0,80}$/.test(name)) throw new Error('--name must be a plain id');
  const lesson = await lessonMotion(videoId, engine);
  const bridge = lessonBridge(lesson, first, last);
  const terrain = lessonTerrain(lesson, bridge);
  // Teaching frames: WalletWallaby alone, in his crop (decided here, before Blender runs); --full-frame renders the
  // whole 1920x1080 canvas instead (the reference the crops are proven against).
  const fullFrame = args.includes('--full-frame');
  const crop = cfg.render as unknown as { crop: { padPx: number }; resolution: [number, number] };
  const frameSize = { width: crop.resolution[0], height: crop.resolution[1] };
  const shots = bridge.frames
    .filter((f) => f.visible && (f.frame - first) % every === 0)
    .flatMap((f) => {
      const name = `f${String(f.frame).padStart(5, '0')}`;
      if (fullFrame) return [{ name, frame: f.frame, camera: { kind: 'teaching' } }];
      const c = characterCrop(f, RIG_ENVELOPE, crop.crop.padPx, frameSize);
      return c ? [{ name, frame: f.frame, camera: { kind: 'crop', x: c.x, y: c.y, width: c.width, height: c.height } }] : [];
    });
  const outDir = `renders/${name}`;
  mkdirSync(path.join(BLENDER_OUT, ...outDir.split('/')), { recursive: true });
  writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
  // Identity before the render: the frames are bound to exactly these inputs.
  const identity = blenderIdentity(cfg, blender, RIG.version, bridge, BLENDER_MOTION_SCHEMA, terrain);
  writeFileSync(outFile(`${outDir}/identity.json`), prettyJson(identity));
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob(`render.${name}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, terrain, shots, outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
  const { ms } = runBlender(blender, cfg, 'render.py', job);
  const manifest = JSON.parse(readFileSync(outFile(`${outDir}/render.json`), 'utf8')) as { shots: { name: string; frame: number; sha256: string; ms: number; crop?: { x: number; y: number; width: number; height: number }; contactErrorPx: Record<string, number> }[] };
  for (const s of manifest.shots) {
    const got = sha256Hex(readFileSync(outFile(`${outDir}/${s.name}.png`)));
    if (got !== s.sha256) throw new Error(`${outDir}/${s.name}.png does not match the manifest Blender wrote`);
  }
  if (!fullFrame) {
    // The crop metadata Remotion composites from: bounds decided before the render, and each PNG's hash.
    const crops = manifest.shots.map((s) => {
      const c = characterCrop(bridge.frames[s.frame - first]!, RIG_ENVELOPE, crop.crop.padPx, frameSize)!;
      if (!s.crop || s.crop.x !== c.x || s.crop.y !== c.y || s.crop.width !== c.width || s.crop.height !== c.height) throw new Error(`frame ${s.frame}: Blender rendered a crop other than the one decided for it`);
      return { frame: s.frame, x: c.x, y: c.y, width: c.width, height: c.height, scale: c.scale, pngSha256: s.sha256 };
    });
    writeFileSync(outFile(`${outDir}/crops.json`), prettyJson({ schema: 'walletwall.blender-crops/v1', padPx: crop.crop.padPx, frameSize, crops }));
  }
  const worst = Math.max(0, ...manifest.shots.flatMap((s) => Object.values(s.contactErrorPx)));
  console.log(`[blender] ${manifest.shots.length} frames in ${(ms / 1000).toFixed(1)} s (process), bridge ${contentAddress(bridge).slice(0, 12)}, worst IK contact error ${worst.toFixed(4)} px -> dist/blender/out/${outDir}`);
}

/** Review poses: the motion system's own states (src/remotion/review/review-states.ts), one bridge frame each. */
const REVIEW_AT = { x: 960, y: 760, scale: 1 } as const;
function reviewStates(): { name: string; state: WallabyState }[] {
  const at = REVIEW_AT;
  const point = staticState(at, POSES.POINT);
  point.focus = { x: at.x + 300, y: at.y - 260 };
  point.gaze = { x: 0.8, y: -0.4 };
  return [
    { name: 'idle', state: staticState(at, POSES.NEUTRAL) },
    { name: 'crouch', state: staticState(at, POSES.PREPARE_JUMP, { action: 'HOP', phase: 'PRELOAD', tail: { swing: -3, curl: 0, tension: 0.5 } }) },
    { name: 'airborne', state: staticState(at, AIRBORNE, { contact: 'NONE', support: null, action: 'AIRBORNE', phase: 'FLIGHT', rotation: -6, tail: { swing: -5, curl: 0, tension: 0.75 } }) },
    { name: 'hard-landing', state: staticState(at, LAND_HARD, { action: 'LAND', phase: 'CONTACT', landingImpulse: 1, tail: { swing: 3, curl: 0, tension: 0.6 } }) },
    { name: 'broad-perch', state: staticState(at, POSES.PERCH, { action: 'PERCH', tail: { swing: 0, curl: 0.4, tension: 0.2 } }) },
    { name: 'point', state: point },
    { name: 'tail-braced', state: staticState(at, PUSH, { action: 'PUSH_THROUGH', phase: 'BRACE', tail: { swing: -4, curl: 0, tension: 0.85 } }) },
  ];
}

function review(): void {
  const model = compileRig().model;
  const poses = reviewStates();
  const ground: Terrain = { surfaces: [{ id: 'review:top', element: 'review', face: 'TOP', support: 'SUPPORTED_SURFACE', x0: 0, y0: REVIEW_AT.y, x1: 1920, y1: REVIEW_AT.y, thicknessPx: 200 }], protectedText: [] };
  const frames = poses.map((p, i) => bridgeFrame(model, i, 'review', p.state, [ground]));
  const bridge = validateBridge(JSON.parse(JSON.stringify({ schema: BLENDER_MOTION_SCHEMA, videoId: 'review', fps: 30, range: { first: 0, last: frames.length - 1 }, motionEngine: 'typescript:review-states', coordinates: { unitsPerPx: UNITS_PER_PX, planeOrigin: { ...PLANE_ORIGIN } }, frames })));
  const sheet = poses.map((p, i) => ({ name: `pose-${p.name}`, frame: i, camera: { kind: 'framing', center: [REVIEW_AT.x - 30, REVIEW_AT.y - 140], widthPx: 520 }, resolution: [720, 720] }));
  const close = [
    { name: 'closeup', frame: 0, camera: { kind: 'framing', center: [REVIEW_AT.x + 0, REVIEW_AT.y - 125], widthPx: 330 }, resolution: [1200, 1200] },
    { name: 'closeup-head', frame: 0, camera: { kind: 'framing', center: [REVIEW_AT.x + 50, REVIEW_AT.y - 200], widthPx: 140 }, resolution: [1000, 1000] },
    { name: 'closeup-belly', frame: 0, camera: { kind: 'framing', center: [REVIEW_AT.x + 10, REVIEW_AT.y - 110], widthPx: 150 }, resolution: [1000, 1000] },
  ];
  const turn = opt('turnaround') ? [20, 35, 50, 65].flatMap((yawDeg) => [0, 5].map((frame) => ({ name: `yaw${yawDeg}-${poses[frame]!.name}`, frame, yawDeg, camera: { kind: 'framing', center: [REVIEW_AT.x - 30, REVIEW_AT.y - 140], widthPx: 520 }, resolution: [720, 720] }))) : [];
  close.push(...(turn as typeof close));
  const outDir = 'renders/review';
  mkdirSync(path.join(BLENDER_OUT, ...outDir.split('/')), { recursive: true });
  const rig = blenderRigDocument(model);
  const job = writeJob('render.review', { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, shots: [...sheet, ...close], outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
  const { ms } = runBlender(blender, cfg, 'render.py', job);
  console.log(`[blender] review stills in ${(ms / 1000).toFixed(1)} s -> dist/blender/out/${outDir}`);
}

/** The declared terrain made solid: stratified rock in the lane's warm palette (config/blender-visual.json, resolved from the brand tokens). Only the depth is a job field; every colour is config.visual's. */
function terrainStyle(): Record<string, string | number> {
  return { depthPx: cfg.visual.terrain.depthPx };
}

/** Contact views: the lesson's own frames, seen in perspective on the declared terrain they stand on. */
async function contact(): Promise<void> {
  const videoId = 'migration-readiness';
  const frames = (opt('frames') ?? '').split(',').filter(Boolean).map(Number);
  const name = opt('name') ?? 'contact';
  const lesson = await lessonMotion(videoId);
  const first = Math.min(...frames);
  const last = Math.max(...frames);
  const bridge = lessonBridge(lesson, first, last);
  const terrain = lessonTerrain(lesson, bridge);
  const style = terrainStyle();
  const depth = (style.depthPx as number) / 2;
  const shots = frames.flatMap((f) => {
    const fr = bridge.frames[f - first]!;
    const close = { kind: 'perspective', target: [fr.place.x, fr.place.y - 60], depthPx: depth, distancePx: 820, elevationDeg: 22, azimuthDeg: -34, lensMm: 50 };
    const wide = { kind: 'perspective', target: [960, 560], depthPx: depth, distancePx: 2900, elevationDeg: 26, azimuthDeg: -24, lensMm: 42 };
    return [
      { name: `close-f${String(f).padStart(5, '0')}`, frame: f, camera: close, terrainSegment: fr.segment, depthPx: depth, resolution: [960, 720] },
      { name: `wide-f${String(f).padStart(5, '0')}`, frame: f, camera: wide, terrainSegment: fr.segment, depthPx: depth, resolution: [1600, 900] },
    ];
  });
  const outDir = `renders/${name}`;
  mkdirSync(path.join(BLENDER_OUT, ...outDir.split('/')), { recursive: true });
  writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
  writeFileSync(outFile(`${outDir}/terrain.json`), prettyJson(terrain));
  const rig = blenderRigDocument(compileRig().model);
  const job = writeJob(`render.${name}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, terrain, terrainStyle: style, shots, outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
  const { ms } = runBlender(blender, cfg, 'render.py', job);
  for (const f of frames) {
    const fr = bridge.frames[f - first]!;
    console.log(`[blender] contact f${f}: ${fr.semantic.action}/${fr.semantic.phase} ${fr.semantic.contact} on ${fr.semantic.surface?.id ?? '(air)'} [${fr.semantic.surface?.support ?? '-'}]`);
  }
  console.log(`[blender] ${shots.length} contact views in ${(ms / 1000).toFixed(1)} s -> dist/blender/out/${outDir}`);
}

/** Deterministic shuffle (LCG), as the Rive frame-purity test does. */
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

/**
 * Determinism evidence: (1) two builds give the same model (canonical hash) and report whether the .blend bytes
 * match; (2) the same frames rendered in two fresh processes give the same PNG bytes; (3) the same frames rendered
 * in a shuffled order give the same bytes (no frame depends on another). Differences are measured, not hidden.
 */
async function determinism(): Promise<void> {
  const frames = (opt('frames') ?? '').split(',').filter(Boolean).map(Number);
  const report: Record<string, unknown> = { schema: 'walletwall.blender-determinism/v1', blender: `${blender.version} (${blender.buildHash})` };
  const builds: { modelSha256: string; materialsSha256: string; blendSha256: string }[] = [];
  const rebuild = (): void => {
    if (args.includes('--skip-build')) return;
    build();
    const m = JSON.parse(readFileSync(outFile(CHARACTER.manifest), 'utf8')) as { modelSha256: string; materialsSha256: string };
    builds.push({ modelSha256: m.modelSha256, materialsSha256: m.materialsSha256, blendSha256: sha256Hex(readFileSync(outFile(CHARACTER.blend))) });
  };
  const lesson = await lessonMotion('migration-readiness');
  const first = Math.min(...frames);
  const last = Math.max(...frames);
  const bridge = lessonBridge(lesson, first, last);
  const rig = blenderRigDocument(compileRig().model);
  const shotsFor = (order: number[]) => order.map((f) => ({ name: `f${String(f).padStart(5, '0')}`, frame: f, camera: { kind: 'teaching' } }));
  // Run a renders from the first build, b and shuffled from a second build of the same source: equal frames prove
  // same source -> same model -> same pixels, across builds and processes, in any order.
  const runs = { a: frames, b: frames, shuffled: shuffled(frames) };
  const hashes: Record<string, Record<number, string>> = {};
  const times: Record<string, number> = {};
  for (const [run, order] of Object.entries(runs)) {
    if (run !== 'shuffled') rebuild();
    const outDir = `determinism/${run}`;
    mkdirSync(outFile(outDir), { recursive: true });
    const job = writeJob(`render.det-${run}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, shots: shotsFor(order), outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
    times[run] = runBlender(blender, cfg, 'render.py', job).ms;
    hashes[run] = Object.fromEntries(order.map((f) => [f, sha256Hex(readFileSync(outFile(`${outDir}/f${String(f).padStart(5, '0')}.png`)))]));
  }
  const compare = (x: string, y: string) => {
    const diffs = [];
    for (const f of frames) {
      if (hashes[x]![f] === hashes[y]![f]) continue;
      const A = readPng(outFile(`determinism/${x}/f${String(f).padStart(5, '0')}.png`));
      const B = readPng(outFile(`determinism/${y}/f${String(f).padStart(5, '0')}.png`));
      let n = 0;
      let max = 0;
      for (let i = 0; i < A.data.length; i++) {
        const d = Math.abs(A.data[i]! - B.data[i]!);
        if (d) n++;
        if (d > max) max = d;
      }
      diffs.push({ frame: f, differingChannels: n, maxChannelDelta: max });
    }
    return { identical: frames.length - diffs.length, of: frames.length, diffs };
  };
  if (builds.length === 2) {
    report.builds = builds;
    report.buildModelIdentical = builds[0]!.modelSha256 === builds[1]!.modelSha256 && builds[0]!.materialsSha256 === builds[1]!.materialsSha256;
    report.buildBlendBytesIdentical = builds[0]!.blendSha256 === builds[1]!.blendSha256;
  }
  report.frames = frames;
  report.twoBuildsTwoProcesses = compare('a', 'b');
  report.shuffledOrder = compare('a', 'shuffled');
  report.processMs = times;
  writeFileSync(outFile('determinism/report.json'), prettyJson(report));
  console.log(`[blender] determinism: ${JSON.stringify({ build: { model: report.buildModelIdentical, blendBytes: report.buildBlendBytesIdentical }, twoBuilds: `${(report.twoBuildsTwoProcesses as { identical: number }).identical}/${frames.length}`, shuffled: `${(report.shuffledOrder as { identical: number }).identical}/${frames.length}` })}`);
}

if (command === 'build') build();
else if (command === 'determinism') await determinism();
else if (command === 'contact') await contact();
else if (command === 'render') await render();
else if (command === 'review') review();
else {
  console.error('usage: node scripts/blender.ts build | render [videoId] --frames=a..b [--every=n] [--name=id] [--motion-engine=typescript|rust-wasm]');
  process.exit(2);
}
