// Review-only: the 2D -> 3D signature transition at the lesson's own seam (tiers PUSH_THROUGH, then DEPTH_ENTER into
// signals), end to end:
//   1. Remotion renders the two teaching surfaces, characterless (lossless): the reveal's only imagery.
//   2. Blender renders the depth reveal (blender/walletwallaby/transition.py) from them, the declared terrain of both
//      segments, and the MotionPlan bridge for the range (WalletWallaby's push into depth).
//   3. The frames are verified and staged, and Remotion renders the clip across the seam with the reveal in place
//      (and the Blender character on either side, from the sequence named by --context).
//
// node scripts/review/blender-transition.ts --context=<rendered sequence covering the clip> [--clip=a..b]
//   -> dist/blender/out/renders/reveal-tiers-signals/fNNNNN.png, dist/blender-review/reveal-tiers-signals/reveal.mp4

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../../src/audio/voice-provider.ts';
import { blenderIdentity, CHARACTER } from '../../src/blender/identity.ts';
import { lessonBridge, lessonMotion, lessonTerrain } from '../../src/blender/lesson.ts';
import { stageBlenderSequence, stageBlenderTransition } from '../../src/blender/stage.ts';
import { BLENDER_JOBS, findBlender, loadBlenderConfig, outFile, runBlender, writeJob } from '../../src/blender/toolchain.ts';
import { BLENDER_MOTION_SCHEMA } from '../../src/character/walletwallaby/blender/bridge.ts';
import { blenderRigDocument } from '../../src/character/walletwallaby/blender/rig-export.ts';
import { compileRig } from '../../src/character/walletwallaby/rive/rig-compile.ts';
import { RIG } from '../../src/character/walletwallaby/versions.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../../src/config/load.ts';
import { prettyJson } from '../../src/core/canonical-json.ts';
import { loadCommittedSpec } from '../../src/pipeline/context.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../../src/pipeline/render-input.ts';

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const context = opt('context');
const stillsOnly = args.includes('--stills-only'); // skip the Remotion clip: Blender's reveal frames are the evidence
const reuseLayers = args.includes('--reuse-layers'); // reuse the two characterless surfaces from an earlier run
const clip = (opt('clip') ?? '1690..1840').split('..').map(Number) as [number, number];
const NAME = 'reveal-tiers-signals';
const videoId = 'migration-readiness';
const cfg = loadBlenderConfig();
const blender = findBlender(cfg);
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const lesson = await lessonMotion(videoId);

// The seam, from the lesson itself: the push clip's first frame, and the incoming segment's first content frame.
const fps = lesson.timeline.fps;
const push = lesson.motion.clips.find((c) => c.kind === 'PUSH')!;
const into = lesson.timeline.segments.find((s) => s.startMs >= push.endMs - 1 && s.transitionIn.type === 'DEPTH_ENTER')!;
const first = Math.ceil((push.startMs * fps) / 1000);
const flatAgain = Math.ceil((into.contentStartMs * fps) / 1000);
const last = flatAgain - 1;
console.log(`[reveal] ${push.segmentId} push from frame ${first}; ${into.id} flat again at ${flatAgain}`);

// 1. The two teaching surfaces, as Remotion draws them, characterless.
const layerDir = path.join(BLENDER_JOBS, NAME);
mkdirSync(layerDir, { recursive: true });
if (!(reuseLayers && existsSync(path.join(layerDir, 'layer-0.png')) && existsSync(path.join(layerDir, 'layer-1.png')))) {
  stageDeclaredAssets(spec);
  stageRendererAssets();
  const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
  const bare = buildProps(spec, source, track, config, { captions: false, characterless: true, guides: false });
  const bareComp = await selectComposition({ serveUrl, id: 'WalletWallDocsVideo', inputProps: bare });
  await renderStill({ composition: bareComp, serveUrl, output: path.join(layerDir, 'layer-0.png'), frame: first, inputProps: bare });
  await renderStill({ composition: bareComp, serveUrl, output: path.join(layerDir, 'layer-1.png'), frame: flatAgain, inputProps: bare });
}

// 2. The reveal in Blender.
const bridge = lessonBridge(lesson, first, last);
const terrain = lessonTerrain(lesson, bridge);
const t = cfg.transitions as { depthReveal: Record<string, number> };
const dr = t.depthReveal;
const transition = {
  primitive: 'depth-reveal',
  layers: [
    { segment: push.segmentId, image: `${NAME}/layer-0.png`, depthPx: 0, blockDepthPx: dr.blockDepthPx },
    { segment: into.id, image: `${NAME}/layer-1.png`, depthPx: dr.layerGapPx, blockDepthPx: dr.blockDepthPx },
  ],
  camera: { ...dr, focusA: [960, 540], focusB: [960, 540] },
};
// WalletWallaby's depth: the push's falling scale becomes depth toward the deeper surface; in the incoming segment he
// stands on that surface (its blocks' mid-depth), at the plan's own scale.
const pushFrames = bridge.frames.filter((f) => f.segment === push.segmentId && f.visible);
const s0 = pushFrames[0]!.place.scale;
const sEnd = pushFrames.at(-1)!.place.scale;
const k = (dr.layerGapPx as number) / Math.max(1e-6, s0 / sEnd - 1);
const mid = (dr.blockDepthPx as number) / 2;
const shots = bridge.frames.map((f) => ({
  name: `f${String(f.frame).padStart(5, '0')}`,
  frame: f.frame,
  camera: { kind: 'transition', t: (f.frame - first) / (flatAgain - first) },
  ...(f.segment === push.segmentId ? { depthFromScale: { s0, k, base: mid } } : { depthPx: (dr.layerGapPx as number) + mid }),
}));
const outDir = `renders/${NAME}`;
mkdirSync(outFile(outDir), { recursive: true });
writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
writeFileSync(outFile(`${outDir}/identity.json`), prettyJson({ ...blenderIdentity(cfg, blender, RIG.version, bridge, BLENDER_MOTION_SCHEMA, terrain), transition: 'depth-reveal' }));
const rig = blenderRigDocument(compileRig().model);
const job = writeJob(`render.${NAME}`, { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig, blend: CHARACTER.blend, bridge, terrain, transition, shots, outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
const { ms } = runBlender(blender, cfg, 'render.py', job);
console.log(`[reveal] ${shots.length} frames in ${(ms / 1000).toFixed(1)} s`);

if (stillsOnly) {
  console.log('[reveal] --stills-only: frames are in dist/blender/out/' + outDir);
  process.exit(0);
}

// 3. Verified, staged, and composited across the seam.
const reveal = stageBlenderTransition(NAME, { first, last });
const props = {
  ...buildProps(spec, source, track, config, { captions: false, characterless: false, guides: false }),
  depthReveals: [reveal],
  ...(context ? { characterRenderer: stageBlenderSequence(context, lesson) } : {}),
};
// The bundle copies the public dir when it is made: bundle again now that the reveal's frames are staged.
const serveUrl2 = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
const comp = await selectComposition({ serveUrl: serveUrl2, id: 'WalletWallDocsVideo', inputProps: props });
const review = path.join(DIST_ROOT, 'blender-review', NAME);
mkdirSync(review, { recursive: true });
await renderMedia({ composition: comp, serveUrl: serveUrl2, codec: 'h264', crf: 16, outputLocation: path.join(review, 'reveal.mp4'), inputProps: props, frameRange: clip, concurrency: 2 });
for (const f of [first, first + 12, first + 24, first + 36, last - 20, last - 8]) copyFileSync(outFile(`${outDir}/f${String(f).padStart(5, '0')}.png`), path.join(review, `f${String(f).padStart(5, '0')}.png`));
console.log(`[reveal] clip ${clip[0]}..${clip[1]} -> ${path.relative(VIDEO_ROOT, review)}/reveal.mp4`);
