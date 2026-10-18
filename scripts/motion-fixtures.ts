// npm run motion:fixtures -> regenerate the canonical Motion Intelligence fixture: the takeaway
// path's engine input (from the TypeScript converter, for the committed lesson) and the exact plan
// bytes the committed artifact returns for it.
//
// The native Rust tests (motion-intelligence/tests/fixture.rs) pin the native build to the same
// bytes and test/rust-motion-engine.test.ts pins the artifact, so together they prove that the
// native engine and the WebAssembly artifact compute the same plan. Rerun after a deliberate
// behaviour change (and bump the crate version); review the plan diff like any other output.

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

const config = loadPipelineConfig();
const spec = loadCommittedSpec('migration-readiness');
const source = loadSnapshot(spec);
const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const headings = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
const { inputs } = rustInputsFor({ spec, track, templates: config.templates, headings });
const takeaway = inputs.find((i) => i.selection.segmentId === 'takeaway');
if (!takeaway) throw new Error('the committed lesson no longer selects the takeaway path');

const solved = RustMotionEngine.load().solve(takeaway.input);
mkdirSync(FIXTURE_DIR, { recursive: true });
writeFileSync(path.join(FIXTURE_DIR, 'takeaway-hop.input.json'), prettyJson(takeaway.input));
writeFileSync(path.join(FIXTURE_DIR, 'takeaway-hop.plan.json'), solved.bytes);
console.log(`[motion:fixtures] takeaway-hop: ${solved.plan.frames.count} frames, ${solved.bytes.length} bytes, sha256 ${solved.sha256}`);
