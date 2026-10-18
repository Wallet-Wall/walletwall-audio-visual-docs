// npm run motion:fixtures -> regenerate the canonical Motion Intelligence fixtures: for a few engine
// paths of the committed lesson, chosen to cover what the engine does, the engine input (from the
// TypeScript converter) and the exact plan bytes the committed artifact returns for it.
//
// The native Rust tests (motion-intelligence/tests/fixture.rs) pin the native build to the same
// bytes and test/rust-motion-engine.test.ts pins the artifact, so together they prove that the
// native engine and the WebAssembly artifact compute the same plans. Rerun after a deliberate
// behaviour change (and bump the crate version); review the plan diffs like any other output.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { loadPipelineConfig } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { MOTION_CRATE_DIR } from '../src/motion/artifact.ts';
import { rustInputsFor, RustMotionEngine } from '../src/motion/rust-adapter.ts';
import { loadCommittedSpec } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';

export const FIXTURE_DIR = path.join(MOTION_CRATE_DIR, 'tests', 'fixtures');

/** Each fixture is the first engine path in its segment. */
export const MOTION_FIXTURES = [
  { name: 'takeaway-hop', segmentId: 'takeaway', covers: 'the natural arc onto the summit ledge' },
  { name: 'hook-hop', segmentId: 'hook', covers: 'the lowest arc the search offers, and a settle hurried onto a short perch' },
  { name: 'tiers-land', segmentId: 'tiers', covers: 'a higher arc kept with stronger gravity, onto a graph node at a new scale' },
  { name: 'signals-hop', segmentId: 'signals', covers: 'a perch that leans in to inspect, where the tail settles into a curl' },
] as const;

const config = loadPipelineConfig();
const spec = loadCommittedSpec('migration-readiness');
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const headings = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
const { inputs } = rustInputsFor({ spec, track, templates: config.templates, headings });
const engine = RustMotionEngine.load();
mkdirSync(FIXTURE_DIR, { recursive: true });
for (const f of MOTION_FIXTURES) {
  const path0 = inputs.find((i) => i.selection.segmentId === f.segmentId);
  if (!path0) throw new Error(`the committed lesson no longer has an engine path in ${f.segmentId}`);
  const solved = engine.solve(path0.input);
  writeFileSync(path.join(FIXTURE_DIR, `${f.name}.input.json`), prettyJson(path0.input));
  writeFileSync(path.join(FIXTURE_DIR, `${f.name}.plan.json`), solved.bytes);
  console.log(`[motion:fixtures] ${f.name} (clip ${path0.selection.clip}, ${f.covers}): ${solved.plan.frames.count} frames, ${solved.bytes.length} bytes, sha256 ${solved.sha256}`);
}
