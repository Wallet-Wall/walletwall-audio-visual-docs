// Prints, comma-separated, one airborne frame of every path the Rust/WASM Motion Intelligence engine
// performs for a video (the middle of the frames where its own plan has the feet off every surface and,
// when any are, inside the frame), for `npm run render:stills -- --motion-engine=rust-wasm --frames=<list>`:
// a bounded review set that draws the flight the engine solves, chosen from the engine's plans rather
// than hard-coded frame numbers.
//
// Usage: node scripts/engine-path-frames.ts [videoId]

import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { loadPipelineConfig } from '../src/config/load.ts';
import { planRustMotion } from '../src/motion/rust-adapter.ts';
import { loadCommittedSpec, loadRegistry } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';

const videoId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const { props } = planRustMotion({ spec, track, templates: config.templates, headings: Object.fromEntries(source.sections.map((s) => [s.id, s.heading])) });
const { width, height } = spec.output;
const frames = props.paths.map(({ segmentId, clip, plan }) => {
  const airborne = plan.samples.flatMap((s, k) => (s.contact === 'NONE' ? [{ frame: plan.frames.first + k, at: s.position }] : []));
  if (airborne.length === 0) throw new Error(`${segmentId} clip ${clip}: the engine's plan has no airborne frame`);
  // A flight that enters from outside the frame (a drop into the scene) is drawn only once the feet are inside it.
  const drawn = airborne.filter(({ at }) => at.x >= 0 && at.x <= width && at.y >= 0 && at.y <= height);
  const pool = drawn.length > 0 ? drawn : airborne;
  return pool[Math.floor(pool.length / 2)]!.frame;
});
process.stdout.write(`${frames.join(',')}\n`);
