// npm run motion:bench -> measure the Rust/WASM Motion Intelligence engine on the committed lesson's
// takeaway path: artifact size, module compile and instantiate time, solve time, and the cost of
// binding and sampling the plan in the composition. Informational; nothing here is a gate, and the
// numbers are machine-dependent (they are not part of any committed fixture).

import { gzipSync } from 'node:zlib';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { planMotion, sampleWallaby } from '../src/character/walletwallaby/motion.ts';
import { loadPipelineConfig } from '../src/config/load.ts';
import { loadVerifiedArtifact } from '../src/motion/artifact.ts';
import { rustInputsFor, RustMotionEngine, planRustMotion } from '../src/motion/rust-adapter.ts';
import { bindMotionEngine, sampleWithEngine } from '../src/motion/rust-path.ts';
import { loadCommittedSpec } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';

const now = (): number => Number(process.hrtime.bigint()) / 1e6;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const time = (n: number, fn: () => void): { median: number; min: number } => {
  const xs: number[] = [];
  for (let k = 0; k < n; k++) {
    const t = now();
    fn();
    xs.push(now() - t);
  }
  return { median: median(xs), min: Math.min(...xs) };
};
const fmt = (r: { median: number; min: number }): string => `median ${r.median.toFixed(3)} ms (min ${r.min.toFixed(3)} ms)`;

const config = loadPipelineConfig();
const spec = loadCommittedSpec('migration-readiness');
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const headings = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
const args = { spec, track, templates: config.templates, headings };

const { bytes, manifest } = loadVerifiedArtifact();
console.log(`artifact     ${bytes.length} bytes (${gzipSync(bytes, { level: 9 }).length} gzipped), sha256 ${manifest.sha256}`);
console.log(`compile      ${fmt(time(20, () => new WebAssembly.Module(bytes)))}`);
const module = new WebAssembly.Module(bytes);
console.log(`instantiate  ${fmt(time(50, () => new WebAssembly.Instance(module, {})))}`);
console.log(`engine load  ${fmt(time(10, () => RustMotionEngine.load()))} (read + sha256 + hermetic check + compile + instantiate)`);

const engine = RustMotionEngine.load();
const { inputs } = rustInputsFor(args);
const input = inputs[0]!.input;
const solved = engine.solve(input);
const raw = new TextEncoder().encode(JSON.stringify(input));
console.log(`plan         ${solved.plan.frames.count} frames, ${solved.bytes.length} bytes, sha256 ${solved.sha256}`);
console.log(`solve (raw)  ${fmt(time(200, () => engine.solveBytes(raw)))} (WASM only: parse, solve, simulate, sample, check, serialize)`);
console.log(`solve        ${fmt(time(200, () => engine.solve(input)))} (+ JSON encode/decode and TypeScript plan validation)`);
console.log(`plan render  ${fmt(time(20, () => planRustMotion(args, engine)))} (everything the render script adds: choreography, eligibility, solve, bind)`);

const timeline = buildTimeline(spec, track, config.templates);
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const ts = planMotion(choreograph(timeline, layouts), layouts);
const props = planRustMotion(args, engine).props;
console.log(`bind         ${fmt(time(50, () => bindMotionEngine(props, ts, timeline.fps, spec.id)))} (once per composition model)`);
const bound = bindMotionEngine(props, ts, timeline.fps, spec.id);
const path0 = bound.paths[0]!;
const frames = Array.from({ length: path0.end - path0.first }, (_, k) => path0.first + k);
const perFrame = (fn: (f: number) => void) => time(20, () => frames.forEach(fn));
const engineFrames = perFrame((f) => sampleWithEngine(bound, ts, f, (f * 1000) / timeline.fps));
const tsFrames = perFrame((f) => sampleWallaby(ts, (f * 1000) / timeline.fps));
console.log(`sample/frame engine ${(engineFrames.median / frames.length * 1000).toFixed(2)} us vs TypeScript ${(tsFrames.median / frames.length * 1000).toFixed(2)} us (over the ${frames.length} engine frames)`);
