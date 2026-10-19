// Review-only: the whole lesson composited by Remotion with the Blender character and the depth reveal.
//
// node scripts/review/blender-full.ts <sequence covering every visible frame> <reveal name> [--out=<name>]
//   -> dist/blender-review/<name, default full>/migration-readiness.blender.mp4 (+ render-info.json)
//
// Both Blender inputs are staged through the verified path (src/blender/stage.ts) BEFORE bundling: the bundle copies
// the public dir when it is made.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../../src/audio/voice-provider.ts';
import { lessonMotion } from '../../src/blender/lesson.ts';
import { clearStagedBlender, recordedLayout, stageBlenderSequence, stageBlenderTransition } from '../../src/blender/stage.ts';
import { outFile } from '../../src/blender/toolchain.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../../src/config/load.ts';
import { prettyJson } from '../../src/core/canonical-json.ts';
import { sha256Hex } from '../../src/core/hash.ts';
import { loadCommittedSpec } from '../../src/pipeline/context.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets, synthesize } from '../../src/pipeline/render-input.ts';

const [sequence, revealName] = process.argv.slice(2);
const outName = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'full';
if (!/^[a-z0-9-]+$/.test(outName)) throw new Error('--out must be a plain lowercase name');
if (!sequence || !revealName) throw new Error('usage: blender-full.ts <sequence> <reveal>');
const videoId = 'migration-readiness';
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const lesson = await lessonMotion(videoId);
clearStagedBlender();
const character = stageBlenderSequence(sequence, lesson, recordedLayout(sequence));
const revealManifest = JSON.parse(readFileSync(outFile(`renders/${revealName}/render.json`), 'utf8')) as { shots: { frame: number }[] };
const frames = revealManifest.shots.map((s) => s.frame);
const reveal = stageBlenderTransition(revealName, lesson);
stageDeclaredAssets(spec);
stageRendererAssets();
const t0 = performance.now();
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });
const props = { ...buildProps(spec, source, track, config, { captions: true, characterless: false, guides: false }), characterRenderer: character, depthReveals: [reveal] };
const composition = await selectComposition({ serveUrl, id: 'WalletWallDocsVideo', inputProps: props });
const out = path.join(DIST_ROOT, 'blender-review', outName);
mkdirSync(out, { recursive: true });
const output = path.join(out, `${videoId}.blender.mp4`);
await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: output, inputProps: props, concurrency: 2 });
const seconds = (performance.now() - t0) / 1000;
writeFileSync(path.join(out, 'render-info.json'), prettyJson({ schema: 'walletwall.blender-review-render/v1', videoId, frames: composition.durationInFrames, seconds: Math.round(seconds), characterRenderer: { name: character.name, renderSha256: character.renderSha256, bridgeSha256: character.bridgeSha256, identity: character.identity }, depthReveals: [{ name: reveal.name, range: reveal.range, renderSha256: reveal.renderSha256 }], output: { sha256: sha256Hex(readFileSync(output)) } }));
console.log(`[full] ${composition.durationInFrames} frames composited in ${seconds.toFixed(0)} s -> ${path.relative(VIDEO_ROOT, output)}`);
