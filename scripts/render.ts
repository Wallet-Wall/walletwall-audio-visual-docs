// npm run render         -> dist/<id>/<id>.r<revision>.mp4 (+ render.json)
// npm run render:stills  -> dist/<id>/stills/*.png, with and without WalletWallaby (+ stills.json)
//
// Usage: node scripts/render.ts [videoId] [--stills [--frames=a,b,c]] [--guides] [--no-captions]
//                               [--characterless] [--motion-engine=typescript|rust-wasm]
//                               [--character-layout=crop|full-frame] [--fresh-blender]
// Uses the fixture voice (silent, estimated timing) unless a live provider is wired in a later lane.
// --motion-engine=rust-wasm performs the paths in src/motion/rust-path.ts with the committed
// Rust/WASM Motion Intelligence engine (everything else stays on the TypeScript solver); the
// default is the TypeScript solver alone. Either way the engine is recorded in render.json.
//
// WalletWallaby is drawn by the pinned Blender (docs/BLENDER.md, Production; WALLETWALL_BLENDER names
// the executable): small crops by default, or whole frames with --character-layout=full-frame (the
// approved reference and fallback). The depth reveal at a PUSH_THROUGH -> DEPTH_ENTER seam is Blender's
// only full-scene shot. Verified renders are reused (never with --fresh-blender: determinism runs build
// the character and render every frame anew); anything stale is rendered again. render.json and
// stills.json record the sequences and the render environment they were made in; only a publication
// class may be published (npm run public:check).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { assertSupported, auditLesson } from '../src/character/walletwallaby/contacts.ts';
import { planMotion } from '../src/character/walletwallaby/motion.ts';
import { loadPipelineConfig, readJson, VIDEO_ROOT } from '../src/config/load.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { typescriptEngineIdentity, type MotionEngineIdentity } from '../src/motion/engine-identity.ts';
import { planRustMotion } from '../src/motion/rust-adapter.ts';
import { distDir, loadCommittedSpec, loadRegistry, validationContextFor } from '../src/pipeline/context.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../src/pipeline/render-input.ts';
import { buildTimeline, msToFrame, totalFrames } from '../src/timeline/timeline.ts';
import { lessonMotion } from '../src/blender/lesson.ts';
import { ensureCharacter, renderCharacterSequence, renderDepthReveal } from '../src/blender/production.ts';
import { findRevealSeam } from '../src/blender/reveal.ts';
import { clearStagedBlender, stageBlenderSequence, stageBlenderTransition, type BlenderLayout } from '../src/blender/stage.ts';
import { BLENDER_JOBS, findBlender, loadBlenderConfig } from '../src/blender/toolchain.ts';
import type { BlenderCharacterProps, BlenderTransitionProps } from '../src/remotion/props.ts';

const COMPOSITION_ID = 'WalletWallDocsVideo';
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const videoId = args.find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;

const engineArg = args.find((a) => a.startsWith('--motion-engine='))?.slice('--motion-engine='.length) ?? 'typescript';
if (engineArg !== 'typescript' && engineArg !== 'rust-wasm') {
  console.error(`[render] unknown motion engine ${JSON.stringify(engineArg)}: use typescript or rust-wasm`);
  process.exit(2);
}

const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
// Recorded in render.json and stills.json: an on-screen text edit changes neither the timeline nor the
// build identity, so only the spec hash ties the frames to the spec they show.
const specHash = contentAddress(spec);

// Fail closed: nothing renders unless the spec passes the publishability gate.
const gate = validateSpec(spec, validationContextFor(spec, config));
if (!gate.ok) {
  for (const i of gate.issues.filter((x) => x.severity === 'error')) console.error(`  ERROR ${i.code} ${i.path} — ${i.message}`);
  console.error(`[render] ${videoId}: refusing to render a spec that fails validation (${gate.errors} errors).`);
  process.exit(1);
}

const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const timeline = buildTimeline(spec, track, config.templates);
const out = distDir(videoId);
mkdirSync(out, { recursive: true });
const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));

// Fail closed: nothing renders while WalletWallaby would stand, grip, or brace on anything the terrain
// on screen cannot carry (src/character/walletwallaby/contacts.ts).
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const contacts = auditLesson(timeline, layouts, planMotion(choreograph(timeline, layouts), layouts));
try {
  assertSupported(contacts);
} catch (err) {
  console.error(`[render] ${videoId}: ${(err as Error).message}`);
  process.exit(1);
}
console.log(`[render] support: ${contacts.length} contacts, every one carried (${contacts.filter((c) => c.offStage).length} off stage)`);

// The motion engine runs here, once, before anything is bundled: a plan the composition would refuse
// stops the render now (and the engine audits every contact itself). The composition receives the plans
// as data and samples them per frame.
const rust = engineArg === 'rust-wasm' ? planRustMotion({ spec, track, templates: config.templates, headings }) : null;
const motionEngine: MotionEngineIdentity = rust ? rust.identity : typescriptEngineIdentity();
if (rust) for (const p of rust.identity.paths) console.log(`[render] rust-wasm ${rust.identity.wasm.sha256.slice(0, 12)}: ${p.segmentId} clip ${p.clip} ${p.action} frames ${p.frames.first}..${p.frames.first + p.frames.count - 1}, plan ${p.planSha256.slice(0, 12)}`);
const withEngine = <T extends object>(props: T): T => (rust ? { ...props, motionEngine: rust.props } : props);

// The frames to render: one settled frame per segment plus the midpoint of every non-CUT transition (stills), or,
// with --frames=a,b,c, exactly those; a full render is every frame.
const stills = flag('--stills');
const picks: { name: string; frame: number }[] = [];
if (stills) {
  const framesArg = args.find((a) => a.startsWith('--frames='))?.slice('--frames='.length);
  if (framesArg) {
    for (const f of framesArg.split(',')) {
      const frame = Number(f);
      if (!Number.isInteger(frame) || frame < 0 || frame >= totalFrames(timeline)) throw new Error(`--frames: ${JSON.stringify(f)} is not a frame of this video`);
      picks.push({ name: `f${String(frame).padStart(5, '0')}`, frame });
    }
  } else {
    for (const s of timeline.segments) {
      picks.push({ name: `${String(picks.length).padStart(2, '0')}-${s.id}`, frame: msToFrame(s.contentStartMs + (s.endMs - s.contentStartMs) * 0.72, timeline.fps) });
      if (s.transitionIn.type !== 'CUT') {
        picks.push({ name: `${String(picks.length).padStart(2, '0')}-${s.id}-transition`, frame: msToFrame((s.startMs + s.contentStartMs) / 2, timeline.fps) });
      }
    }
  }
}

const overlays = { captions: !flag('--no-captions'), characterless: flag('--characterless'), guides: flag('--guides') };
const bundleNow = () => bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
stageDeclaredAssets(spec);
stageRendererAssets();
console.log(`[render] bundling ${COMPOSITION_ID} (${(timeline.totalMs / 1000).toFixed(1)} s, ${totalFrames(timeline)} frames)…`);
let serveUrl = await bundleNow();

// WalletWallaby in Blender: the character's frames (crops, or whole frames), and the depth reveal. A characterless
// render needs neither.
const characterArg = args.find((a) => a.startsWith('--character-layout='))?.slice('--character-layout='.length) ?? 'crop';
if (characterArg !== 'crop' && characterArg !== 'full-frame') {
  console.error(`[render] unknown character layout ${JSON.stringify(characterArg)}: use crop or full-frame`);
  process.exit(2);
}
const layout: BlenderLayout = characterArg;
let character: { characterRenderer: BlenderCharacterProps; depthReveals: BlenderTransitionProps[] } | null = null;
if (!overlays.characterless) {
  const cfg = loadBlenderConfig();
  const blender = findBlender(cfg);
  const lesson = await lessonMotion(videoId, engineArg);
  const fresh = flag('--fresh-blender');
  clearStagedBlender();
  const built = ensureCharacter(cfg, blender, fresh);
  console.log(`[render] Blender ${blender.version} (${blender.buildHash}): character ${built.rebuilt ? 'built' : 'reused'}, model ${built.model.modelSha256.slice(0, 12)}, materials ${built.model.materialsSha256.slice(0, 12)}`);
  const seam = findRevealSeam(lesson);
  const inReveal = (f: number) => seam !== null && f >= seam.first && f <= seam.last;
  const wanted = stills ? [...new Set(picks.map((p) => p.frame))].sort((a, b) => a - b) : undefined;
  const scope = wanted ? `stills-${contentAddress(wanted).slice(0, 12)}` : 'lesson';
  // Sequence names say what they hold; staging, not the name, decides whether one may be used.
  const seqName = `${videoId}-r${spec.revision}-${engineArg}-${layout}-${scope}`;
  const seqFrames = wanted?.filter((f) => !inReveal(f));
  if (!seqFrames || seqFrames.length > 0) {
    const seq = renderCharacterSequence(cfg, blender, { lesson, name: seqName, layout, frames: seqFrames, fresh });
    console.log(`[render] character: ${seq.reused ? 'reused' : 'rendered'} ${seq.frames} ${layout} frames${seq.reused ? '' : ` in ${(seq.ms / 1000).toFixed(1)} s`}`);
  }
  const reveals: BlenderTransitionProps[] = [];
  const revealFrames = seam ? (wanted ? wanted.filter(inReveal) : undefined) : [];
  if (seam && (!revealFrames || revealFrames.length > 0)) {
    // The reveal's only imagery: the two teaching surfaces, as Remotion draws them, characterless.
    const bare = withEngine(buildProps(spec, source, track, config, { captions: false, characterless: true, guides: false }));
    const bareComp = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: bare });
    const layerDir = path.join(BLENDER_JOBS, `${videoId}-surfaces`);
    mkdirSync(layerDir, { recursive: true });
    const layers: [string, string] = [path.join(layerDir, 'layer-0.png'), path.join(layerDir, 'layer-1.png')];
    await renderStill({ composition: bareComp, serveUrl, output: layers[0], frame: seam.first, inputProps: bare });
    await renderStill({ composition: bareComp, serveUrl, output: layers[1], frame: seam.flatAgain, inputProps: bare });
    const revealName = `${videoId}-r${spec.revision}-${engineArg}-reveal-${wanted ? scope : 'lesson'}`;
    const rv = renderDepthReveal(cfg, blender, { lesson, name: revealName, seam, layers, frames: revealFrames, fresh });
    console.log(`[render] depth reveal ${seam.first}..${seam.last}: ${rv.reused ? 'reused' : 'rendered'} ${rv.frames} frames${rv.reused ? '' : ` in ${(rv.ms / 1000).toFixed(1)} s`}`);
    reveals.push(stageBlenderTransition(revealName, lesson));
  }
  // Stills that all fall inside the reveal hold no character frames of their own: refused, never drawn without one.
  const characterRenderer = seqFrames && seqFrames.length === 0 ? null : stageBlenderSequence(seqName, lesson, layout);
  if (!characterRenderer) throw new Error('[render] every requested frame lies inside the depth reveal; ask for at least one frame outside it');
  character = { characterRenderer, depthReveals: reveals };
  const env = characterRenderer.environment;
  console.log(`[render] render environment ${env.classId}: ${env.approvedClass ? `${env.approvedClass} (${env.purpose})` : 'NOT an approved class'}`);
  // The bundle copies the public dir when it is made: bundle again now that the Blender frames are staged.
  serveUrl = await bundleNow();
}

/** What drew WalletWallaby, recorded beside the frames: versions, hashes, and the environment class only. */
const characterRecord = (characterless: boolean) =>
  characterless || !character
    ? { renderer: 'none' as const }
    : {
        renderer: 'blender' as const,
        layout: character.characterRenderer.layout,
        sequence: { name: character.characterRenderer.name, frames: character.characterRenderer.crops.length, renderSha256: character.characterRenderer.renderSha256, bridgeSha256: character.characterRenderer.bridgeSha256, environment: character.characterRenderer.environment },
        reveals: character.depthReveals.map((r) => ({ name: r.name, range: r.range, frames: r.frames.length, renderSha256: r.renderSha256, bridgeSha256: r.bridgeSha256, environment: r.environment })),
        // The .blend's bytes change with every build (Blender writes memory addresses); the canonical model hash is the identity.
        identity: Object.fromEntries(Object.entries(character.characterRenderer.identity).filter(([k]) => k !== 'blendArtifactSha256')),
      };

const inputProps = withEngine({ ...buildProps(spec, source, track, config, overlays), ...(overlays.characterless || !character ? {} : character) });
const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
const remotionVersion = readJson<{ version: string }>(path.join(VIDEO_ROOT, 'node_modules', 'remotion', 'package.json')).version;

if (stills) {
  const stillsDir = path.join(out, 'stills');
  mkdirSync(stillsDir, { recursive: true });
  // The design test: every settled frame also renders with WalletWallaby removed.
  // Remotion renders the props resolved by selectComposition, so each variant selects its own.
  const characterlessProps = withEngine(buildProps(spec, source, track, config, { ...overlays, characterless: true }));
  const variants = [
    { suffix: '', props: inputProps, comp: composition },
    { suffix: '.characterless', props: characterlessProps, comp: await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: characterlessProps }) },
  ];
  const stillsOut: { file: string; frame: number; sha256: string }[] = [];
  for (const variant of variants) {
    for (const p of picks) {
      const output = path.join(stillsDir, `${p.name}${variant.suffix}.png`);
      await renderStill({ composition: variant.comp, serveUrl, output, frame: p.frame, inputProps: variant.props });
      stillsOut.push({ file: path.basename(output), frame: p.frame, sha256: sha256Hex(readFileSync(output)) });
    }
  }
  // Lossless frames are the determinism evidence (MP4 bytes are not run-to-run stable).
  writeFileSync(path.join(stillsDir, 'stills.json'), prettyJson({ schema: 'walletwall.stills-info/v3', videoId, revision: spec.revision, specHash, motionEngine, identity: buildIdentity(), character: characterRecord(overlays.characterless), stills: stillsOut }));
  console.log(`[render] ${picks.length * 2} stills -> ${stillsDir}`);
} else {
  const output = path.join(out, `${videoId}.r${spec.revision}.mp4`);
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: output,
    inputProps,
    concurrency: 2,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 20) * 5;
      if (pct !== last) {
        last = pct;
        console.log(`[render] ${pct}%`);
      }
    },
  });
  const info = {
    schema: 'walletwall.render-info/v5',
    videoId,
    revision: spec.revision,
    specHash,
    engine: { name: 'remotion', version: remotionVersion, compositionId: COMPOSITION_ID },
    fps: timeline.fps,
    frames: totalFrames(timeline),
    durationMs: timeline.totalMs,
    output: { path: path.relative(VIDEO_ROOT, output).split(path.sep).join('/'), sha256: sha256Hex(readFileSync(output)) },
    narration: { providerId: track.providerId, estimated: track.estimated, audio: track.lines.some((l) => l.audio) ? 'PRESENT' : 'NONE' },
    overlays,
    identity: buildIdentity(),
    /** Which engine made the motion, down to the exact WASM bytes and plan bytes when it was rust-wasm. */
    motionEngine,
    /** What drew WalletWallaby: the Blender sequences, their identity, and the render environment they were made in. */
    character: characterRecord(overlays.characterless),
  };
  writeFileSync(path.join(out, 'render.json'), prettyJson(info));
  console.log(`[render] ${output}\n[render] sha256 ${info.output.sha256}`);
}
