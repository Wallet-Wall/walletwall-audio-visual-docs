// Review-only: the same composition, the same MotionPlan, two character renderers.
//
// node scripts/review/blender-parity.ts <sequence> --frames=a,b,c [--clip=first..last]
//   -> dist/blender-review/<sequence>/{rive,blender,characterless}/fNNNNN.png (+ rive.mp4, blender.mp4 for --clip)
//
// The Blender sequence must already be rendered (npm run blender:render) and is staged through the same verified
// path a production render would use (src/blender/stage.ts): its bridge must equal the current MotionPlan's.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../../src/audio/voice-provider.ts';
import { lessonMotion } from '../../src/blender/lesson.ts';
import { clearStagedBlender, recordedLayout, stageBlenderSequence } from '../../src/blender/stage.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../../src/config/load.ts';
import { loadCommittedSpec } from '../../src/pipeline/context.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../../src/pipeline/render-input.ts';

const args = process.argv.slice(2);
const sequence = args.find((a) => !a.startsWith('--'))!;
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const frames = (opt('frames') ?? '').split(',').filter(Boolean).map(Number);
const clip = opt('clip')?.split('..').map(Number) as [number, number] | undefined;
const videoId = 'migration-readiness';

const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const lesson = await lessonMotion(videoId);
clearStagedBlender();
const character = stageBlenderSequence(sequence, lesson, recordedLayout(sequence));
stageDeclaredAssets(spec);
stageRendererAssets();
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
const overlays = { captions: false, characterless: false, guides: false };
const variants = {
  rive: buildProps(spec, source, track, config, overlays),
  blender: { ...buildProps(spec, source, track, config, overlays), characterRenderer: character },
  characterless: buildProps(spec, source, track, config, { ...overlays, characterless: true }),
};
const out = path.join(DIST_ROOT, 'blender-review', sequence);
for (const [name, inputProps] of Object.entries(variants)) {
  // Remotion renders the props resolved by selectComposition: every variant selects its own.
  const composition = await selectComposition({ serveUrl, id: 'WalletWallDocsVideo', inputProps });
  mkdirSync(path.join(out, name), { recursive: true });
  for (const frame of frames) {
    await renderStill({ composition, serveUrl, output: path.join(out, name, `f${String(frame).padStart(5, '0')}.png`), frame, inputProps });
  }
  if (clip && name !== 'characterless') {
    const t0 = performance.now();
    await renderMedia({ composition, serveUrl, codec: 'h264', crf: 16, outputLocation: path.join(out, `${name}.mp4`), inputProps, frameRange: clip, concurrency: 2 });
    console.log(`[parity] ${name}.mp4 frames ${clip[0]}..${clip[1]} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log(`[parity] ${name}: ${frames.length} stills`);
}
