// npm run render         -> dist/<id>/<id>.r<revision>.mp4 (+ render.json)
// npm run render:stills  -> dist/<id>/stills/*.png, with and without WalletWallaby
//
// Usage: node scripts/render.ts [videoId] [--stills] [--guides] [--no-captions] [--characterless]
// Uses the fixture voice (silent, estimated timing) unless a live provider is wired in a later lane.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { loadPipelineConfig, readJson, VIDEO_ROOT } from '../src/config/load.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { distDir, loadCommittedSpec, loadRegistry, validationContextFor } from '../src/pipeline/context.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';
import { buildProps, loadSnapshot, PUBLIC_DIR, stageDeclaredAssets, synthesize } from '../src/pipeline/render-input.ts';
import { buildTimeline, msToFrame, totalFrames } from '../src/timeline/timeline.ts';

const COMPOSITION_ID = 'WalletWallDocsVideo';
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const videoId = args.find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;

const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);

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

stageDeclaredAssets(spec);
console.log(`[render] bundling ${COMPOSITION_ID} (${(timeline.totalMs / 1000).toFixed(1)} s, ${totalFrames(timeline)} frames)…`);
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts'), publicDir: PUBLIC_DIR });

const overlays = { captions: !flag('--no-captions'), characterless: flag('--characterless'), guides: flag('--guides') };
const inputProps = buildProps(spec, source, track, config, overlays);
const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
const remotionVersion = readJson<{ version: string }>(path.join(VIDEO_ROOT, 'node_modules', 'remotion', 'package.json')).version;

if (flag('--stills')) {
  const stillsDir = path.join(out, 'stills');
  mkdirSync(stillsDir, { recursive: true });
  // One settled frame per segment, plus the midpoint of every non-CUT transition.
  const picks: { name: string; frame: number }[] = [];
  for (const s of timeline.segments) {
    picks.push({ name: `${String(picks.length).padStart(2, '0')}-${s.id}`, frame: msToFrame(s.contentStartMs + (s.endMs - s.contentStartMs) * 0.72, timeline.fps) });
    if (s.transitionIn.type !== 'CUT') {
      picks.push({ name: `${String(picks.length).padStart(2, '0')}-${s.id}-transition`, frame: msToFrame((s.startMs + s.contentStartMs) / 2, timeline.fps) });
    }
  }
  // The design test: every settled frame also renders with WalletWallaby removed.
  // Remotion renders the props resolved by selectComposition, so each variant selects its own.
  const characterlessProps = buildProps(spec, source, track, config, { ...overlays, characterless: true });
  const variants = [
    { suffix: '', props: inputProps, comp: composition },
    { suffix: '.characterless', props: characterlessProps, comp: await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: characterlessProps }) },
  ];
  for (const variant of variants) {
    for (const p of picks) {
      const output = path.join(stillsDir, `${p.name}${variant.suffix}.png`);
      await renderStill({ composition: variant.comp, serveUrl, output, frame: p.frame, inputProps: variant.props });
    }
  }
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
    schema: 'walletwall.render-info/v2',
    videoId,
    revision: spec.revision,
    engine: { name: 'remotion', version: remotionVersion, compositionId: COMPOSITION_ID },
    fps: timeline.fps,
    frames: totalFrames(timeline),
    durationMs: timeline.totalMs,
    output: { path: path.relative(VIDEO_ROOT, output).split(path.sep).join('/'), sha256: sha256Hex(readFileSync(output)) },
    narration: { providerId: track.providerId, estimated: track.estimated, audio: track.lines.some((l) => l.audio) ? 'PRESENT' : 'NONE' },
    overlays,
    identity: buildIdentity(),
  };
  writeFileSync(path.join(out, 'render.json'), prettyJson(info));
  console.log(`[render] ${output}\n[render] sha256 ${info.output.sha256}`);
}
