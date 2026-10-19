// The Blender determinism proof on the representative proof set (src/blender/proof-set.ts).
//
// npm run blender:proof -- render  --run=<id> [--blend=<out-relative .blend>]   prepare + render + collect, here
// npm run blender:proof -- prepare --run=<id> [--blend=...]                      write the jobs (and the reveal's layer
//                                                                                images) for Blender on another host
// npm run blender:proof -- collect --run=<id> [--blend=...]                      write proof.json from that host's output
// npm run blender:proof -- export-reference --run=<id>                           keep a publication-class run as the
//                                                                                cross-class reference (blender/proof/reference/)
// npm run blender:proof -- compare <run A> <run B | reference>                   same class: every PNG byte-identical;
//                                                                                approved classes: the pinned tolerance
//
// Guarantees (docs/BLENDER.md, Determinism):
//   A. same approved render-environment class -> byte-identical lossless frames
//   B. different approved classes -> bounded pixel equivalence (config/blender-environments.json crossClassTolerance)
// The MotionPlan, the canonical model, and the frames compared must be the same in both runs, or nothing is compared.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { CHARACTER, environmentClass, loadEnvironments, type PixelTolerance, type RenderEnvironment } from '../src/blender/identity.ts';
import { lessonBridge, lessonMotion, lessonTerrain } from '../src/blender/lesson.ts';
import { characterProofFrames, PROOF_ROLES, transitionProofFrames, type ProofRole } from '../src/blender/proof-set.ts';
import { depthRevealConfig, revealJob, revealSeam } from '../src/blender/reveal.ts';
import { BLENDER_JOBS, blenderConfigSha256, blenderSourceSha256, findBlender, loadBlenderConfig, outFile, runBlender, writeJob } from '../src/blender/toolchain.ts';
import { characterCrop } from '../src/character/walletwallaby/blender/crop.ts';
import { blenderRigDocument } from '../src/character/walletwallaby/blender/rig-export.ts';
import { blenderTerrainDocument } from '../src/character/walletwallaby/blender/terrain-export.ts';
import { compileRig } from '../src/character/walletwallaby/rive/rig-compile.ts';
import { RIG_ENVELOPE } from '../src/character/walletwallaby/rive/rig-source.ts';
import { loadPipelineConfig, VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { loadCommittedSpec } from '../src/pipeline/context.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../src/pipeline/render-input.ts';
import { readPng, type Image } from './review/png.ts';

const args = process.argv.slice(2);
const mode = args[0];
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const RUN = /^[a-z0-9][a-z0-9-]{0,40}$/;
const videoId = 'migration-readiness';
const cfg = loadBlenderConfig();

interface ProofRecord {
  schema: 'walletwall.blender-proof/v1';
  run: string;
  environment: RenderEnvironment;
  environmentClass: string;
  approvedClass: string | null;
  canonicalModelSha256: string;
  realizationSha256: string;
  blenderConfigSha256: string;
  blenderSceneSourceSha256: string;
  motionPlanSha256: string;
  roles: { role: ProofRole; frame: number; file: string; sha256: string; crop: { x: number; y: number; width: number; height: number } | null }[];
  layers: string[];
}

async function plan(run: string, blend: string) {
  const lesson = await lessonMotion(videoId);
  const bridge = lessonBridge(lesson, 0, lesson.frames - 1);
  const seam = revealSeam(lesson);
  const dr = depthRevealConfig(cfg);
  const padPx = (cfg.render as unknown as { crop: { padPx: number } }).crop.padPx;
  const roles: Record<ProofRole, number> = { ...characterProofFrames(bridge, padPx, seam), ...transitionProofFrames(seam, seam.flatAgain, dr.revealBy, dr.settleFrom) };
  const frames = PROOF_ROLES.map((r) => bridge.frames[roles[r]]!);
  const subset = { ...bridge, frames };
  return { lesson, bridge, seam, roles, subset, padPx, dirs: { jobs: `proof-${run}`, out: `proof/${run}` }, blend };
}

async function prepare(run: string, blend: string): Promise<void> {
  const p = await plan(run, blend);
  const rig = blenderRigDocument(compileRig().model);
  const frameSize = { width: cfg.render.resolution[0], height: cfg.render.resolution[1] };
  const characterShots = PROOF_ROLES.filter((r) => !r.startsWith('transition-')).map((r) => {
    const f = p.bridge.frames[p.roles[r]]!;
    const c = characterCrop(f, RIG_ENVELOPE, p.padPx, frameSize)!;
    return { name: r, frame: f.frame, camera: { kind: 'crop', x: c.x, y: c.y, width: c.width, height: c.height } };
  });
  writeJob(`proof-${run}.characters`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend, bridge: p.subset, terrain: lessonTerrain(p.lesson, p.subset), shots: characterShots, outputs: { dir: `${p.dirs.out}/characters`, manifest: `${p.dirs.out}/characters/render.json` } });
  // The reveal's teaching surfaces: Remotion's own characterless frames (this host's Chrome draws them).
  const config = loadPipelineConfig();
  const spec = loadCommittedSpec(videoId);
  const source = loadSnapshot(spec);
  const track = await synthesize(spec, new FixtureVoiceProvider(), config);
  stageDeclaredAssets(spec);
  stageRendererAssets();
  const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
  const bare = buildProps(spec, source, track, config, { captions: false, characterless: true, guides: false });
  const comp = await selectComposition({ serveUrl, id: 'WalletWallDocsVideo', inputProps: bare });
  mkdirSync(path.join(BLENDER_JOBS, p.dirs.jobs), { recursive: true });
  for (const [i, frame] of [p.seam.first, p.seam.flatAgain].entries()) await renderStill({ composition: comp, serveUrl, output: path.join(BLENDER_JOBS, p.dirs.jobs, `layer-${i}.png`), frame, inputProps: bare });
  const terrain = blenderTerrainDocument(p.lesson.terrains, [p.seam.pushSegment, p.seam.intoSegment]);
  const revealFrames = (['transition-entry', 'transition-peak', 'transition-exit'] as const).map((r) => p.roles[r]);
  const revealBridge = lessonBridge(p.lesson, p.seam.first, p.seam.last);
  const { transition, shots } = revealJob(cfg, p.seam, revealBridge, revealFrames, [`${p.dirs.jobs}/layer-0.png`, `${p.dirs.jobs}/layer-1.png`]);
  const named = shots.map((s, i) => ({ ...s, name: ['transition-entry', 'transition-peak', 'transition-exit'][i]! }));
  writeJob(`proof-${run}.reveal`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend, bridge: revealBridge, terrain, transition, shots: named, outputs: { dir: `${p.dirs.out}/reveal`, manifest: `${p.dirs.out}/reveal/render.json` } });
  console.log(`[proof] ${run}: jobs written for ${PROOF_ROLES.map((r) => `${r}=${p.roles[r]}`).join(' ')}`);
}

async function collect(run: string, blend: string): Promise<void> {
  const p = await plan(run, blend);
  const chars = JSON.parse(readFileSync(outFile(`${p.dirs.out}/characters/render.json`), 'utf8')) as { environment: RenderEnvironment; shots: { name: string; frame: number; sha256: string; crop?: ProofRecord['roles'][number]['crop'] }[] };
  const rev = JSON.parse(readFileSync(outFile(`${p.dirs.out}/reveal/render.json`), 'utf8')) as typeof chars;
  if (contentAddress(chars.environment) !== contentAddress(rev.environment)) throw new Error('the two proof renders ran in different environments');
  const model = JSON.parse(readFileSync(outFile(blend.replace(/walletwallaby\.blend$/, 'model.json')), 'utf8')) as { modelSha256: string; modelRealizationSha256: string };
  const cls = environmentClass(chars.environment, cfg, loadEnvironments());
  const roles = PROOF_ROLES.map((role) => {
    const sub = role.startsWith('transition-') ? 'reveal' : 'characters';
    const shot = (sub === 'reveal' ? rev : chars).shots.find((s) => s.name === role)!;
    const file = `${p.dirs.out}/${sub}/${role}.png`;
    if (sha256Hex(readFileSync(outFile(file))) !== shot.sha256) throw new Error(`${file} does not match its manifest`);
    return { role, frame: shot.frame, file, sha256: shot.sha256, crop: shot.crop ?? null };
  });
  const record: ProofRecord = {
    schema: 'walletwall.blender-proof/v1',
    run,
    environment: chars.environment,
    environmentClass: cls.id,
    approvedClass: cls.approvedAs?.name ?? null,
    canonicalModelSha256: model.modelSha256,
    realizationSha256: model.modelRealizationSha256,
    blenderConfigSha256: blenderConfigSha256(cfg),
    blenderSceneSourceSha256: blenderSourceSha256().sha256,
    motionPlanSha256: contentAddress(p.subset),
    roles,
    layers: [0, 1].map((i) => sha256Hex(readFileSync(path.join(BLENDER_JOBS, p.dirs.jobs, `layer-${i}.png`)))),
  };
  writeFileSync(outFile(`${p.dirs.out}/proof.json`), prettyJson(record));
  console.log(`[proof] ${run}: class ${cls.id} (${record.approvedClass ?? 'not an approved class'}), model ${record.canonicalModelSha256.slice(0, 12)}, plan ${record.motionPlanSha256.slice(0, 12)}`);
}

function tolerance(a: Image, b: Image, t: PixelTolerance) {
  if (a.width !== b.width || a.height !== b.height) return { pass: false, why: 'different sizes' };
  let over = 0;
  let sum = 0;
  let max = 0;
  let coverage = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i]! - b.data[i]!);
    if (d > t.noiseLevel) over++;
    if (d > max) max = d;
    sum += d;
  }
  for (let i = 3; i < a.data.length; i += 4) if ((a.data[i]! > 0) !== (b.data[i]! > 0)) coverage++;
  const fractionOverNoise = over / a.data.length;
  const meanAbsDelta = sum / a.data.length;
  return { pass: fractionOverNoise <= t.maxFractionOverNoise && meanAbsDelta <= t.maxMeanAbsDelta && coverage <= t.maxCoverageDeltaPx, maxDelta: max, fractionOverNoise, meanAbsDelta, coverageDeltaPx: coverage };
}

/** The production class's proof frames, kept in the repository as the cross-class reference (blender/proof/reference/). */
const REFERENCE_DIR = path.join(VIDEO_ROOT, 'blender', 'proof', 'reference');

function exportReference(run: string): void {
  const rec = JSON.parse(readFileSync(outFile(`proof/${run}/proof.json`), 'utf8')) as ProofRecord;
  if (loadEnvironments().classes.find((c) => c.name === rec.approvedClass)?.purpose !== 'publication') throw new Error(`${run} was not rendered in an approved publication class`);
  mkdirSync(REFERENCE_DIR, { recursive: true });
  const roles = rec.roles.map((r) => {
    writeFileSync(path.join(REFERENCE_DIR, `${r.role}.png`), readFileSync(outFile(r.file)));
    return { ...r, file: `${r.role}.png` };
  });
  writeFileSync(path.join(REFERENCE_DIR, 'proof.json'), prettyJson({ ...rec, run: 'reference', roles }));
  console.log(`[proof] reference <- ${run} (${rec.approvedClass}, ${roles.length} frames)`);
}

function compare(runA: string, runB: string): void {
  const load = (r: string): ProofRecord => {
    if (r !== 'reference') return JSON.parse(readFileSync(outFile(`proof/${r}/proof.json`), 'utf8')) as ProofRecord;
    const rec = JSON.parse(readFileSync(path.join(REFERENCE_DIR, 'proof.json'), 'utf8')) as ProofRecord;
    return { ...rec, roles: rec.roles.map((x) => ({ ...x, file: path.join(REFERENCE_DIR, x.file) })) };
  };
  const pngOf = (file: string): Image => readPng(path.isAbsolute(file) ? file : outFile(file));
  const a = load(runA);
  const b = load(runB);
  for (const k of ['canonicalModelSha256', 'motionPlanSha256', 'blenderConfigSha256', 'blenderSceneSourceSha256'] as const) {
    if (a[k] !== b[k]) throw new Error(`the two runs differ in ${k}: they do not render the same thing`);
  }
  const envs = loadEnvironments();
  const sameClass = a.environmentClass === b.environmentClass;
  const rows = a.roles.map((ra) => {
    const rb = b.roles.find((x) => x.role === ra.role)!;
    if (rb.frame !== ra.frame || JSON.stringify(rb.crop) !== JSON.stringify(ra.crop)) throw new Error(`${ra.role}: the runs rendered different frames or crops`);
    if (sameClass) return { role: ra.role, frame: ra.frame, identical: ra.sha256 === rb.sha256, pass: ra.sha256 === rb.sha256 };
    const t = tolerance(pngOf(ra.file), pngOf(rb.file), ra.role.startsWith("transition-") ? envs.crossClassTolerance.scene : envs.crossClassTolerance.character);
    return { role: ra.role, frame: ra.frame, identical: ra.sha256 === rb.sha256, ...t };
  });
  if (!sameClass && (!a.approvedClass || !b.approvedClass)) throw new Error('cross-class comparison needs two approved classes');
  const report = { schema: 'walletwall.blender-proof-comparison/v1', a: { run: runA, class: a.environmentClass, approved: a.approvedClass, gpu: a.environment.gpu }, b: { run: runB, class: b.environmentClass, approved: b.approvedClass, gpu: b.environment.gpu }, guarantee: sameClass ? 'A: same class, byte-identical' : 'B: cross-class, pinned tolerance', tolerance: sameClass ? null : envs.crossClassTolerance, pass: rows.every((r) => r.pass), rows };
  writeFileSync(outFile(`proof/compare-${runA}-${runB}.json`), prettyJson(report));
  console.log(prettyJson(report));
  if (!report.pass) process.exit(1);
}

const run = opt('run') ?? '';
const blend = opt('blend') ?? CHARACTER.blend;
if (mode !== 'compare' && !RUN.test(run)) throw new Error('--run must be a short lowercase id');
if (mode === 'prepare') await prepare(run, blend);
else if (mode === 'collect') await collect(run, blend);
else if (mode === 'render') {
  const blender = findBlender(cfg);
  await prepare(run, blend);
  for (const part of ['characters', 'reveal']) runBlender(blender, cfg, 'render.py', path.join(BLENDER_JOBS, `proof-${run}.${part}.json`));
  await collect(run, blend);
} else if (mode === 'compare') compare(args[1]!, args[2]!);
else if (mode === 'export-reference') exportReference(run);
else {
  console.error('usage: node scripts/blender-proof.ts render|prepare|collect --run=<id> [--blend=<path>] | compare <run A> <run B>');
  process.exit(2);
}
