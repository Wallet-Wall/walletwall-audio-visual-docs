// npm run publication:proof [-- --motion-engine=typescript|rust-wasm] [videoId]
//   -> dist/publication-proof/ (the proof package a human reviews before any publication, and its receipt)
//
// The whole-video publication proof, on the production render host (docs/BLENDER.md, Publication; docs/PUBLICATION.md).
// Hosted CI cannot make it: WalletWallaby is drawn by the pinned Blender, and a GPU-less runner renders the whole lesson
// in software GL in many hours. So this runs where the publication class is (config/blender-environments.json):
// validate the spec; prove the rig invariants on the frames Blender renders (npm run blender:invariants); stop unless
// the environment those frames were rendered in is an approved publication class, printing what changed against it;
// render the whole video with the fixture voice; run the publish dry run against that exact render; run the
// public-output gate with the render required, which refuses a render from any class that is not a publication class;
// and, last, bind the passed proof in its receipt (publication-proof-receipt.json), written only after every step has
// passed and verified from disk before this reports PASS. It never uploads anything and holds no publication credential:
// CI CAN prove publication readiness, CI MUST NOT publish, and neither may this.

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { DIST_ROOT, VIDEO_ROOT } from '../src/config/load.ts';

const args = process.argv.slice(2);
const engine = args.find((a) => a.startsWith('--motion-engine='))?.slice('--motion-engine='.length) ?? 'typescript';
if (engine !== 'typescript' && engine !== 'rust-wasm') {
  console.error(`[publication:proof] unknown motion engine ${JSON.stringify(engine)}: use typescript or rust-wasm`);
  process.exit(2);
}
const videoId = args.find((a) => !a.startsWith('--'));
if (videoId !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(videoId)) {
  console.error('[publication:proof] the video id must be a plain slug');
  process.exit(2);
}
const bundle = path.join(DIST_ROOT, 'publication-proof');
// The gate writes the package only into an empty directory: a run replaces the previous package (and its receipt)
// before anything else, never mixes with it, so a failed run leaves no receipt behind.
rmSync(bundle, { recursive: true, force: true });
const steps: [string, string[]][] = [
  ['validate the spec', ['scripts/validate.ts']],
  ['the rig invariants on the frames Blender renders (every 9th lesson frame, every lab frame)', ['scripts/blender-invariants.ts', ...(videoId ? [videoId] : []), `--motion-engine=${engine}`]],
  ['the render environment is an approved publication class', ['scripts/publication-receipt.ts', 'environment']],
  ['render the whole video with the fixture voice', ['scripts/render.ts', ...(videoId ? [videoId] : []), `--motion-engine=${engine}`]],
  ['publish dry run against this exact render', ['scripts/publish-dry-run.ts', ...(videoId ? [videoId] : [])]],
  ['public-output gate, render required (writes the proof package)', ['scripts/public-output-check.ts', ...(videoId ? [videoId] : []), '--require-render', `--bundle=${bundle}`]],
  ['the publication proof receipt (evidence, receipt, verified from disk)', ['scripts/publication-receipt.ts', 'write', ...(videoId ? [videoId] : []), `--bundle=${bundle}`]],
];
for (const [what, argv] of steps) {
  console.log(`[publication:proof] ${what}`);
  // Fixed arguments, no shell: nothing from content reaches a command line.
  const r = spawnSync(process.execPath, argv, { cwd: VIDEO_ROOT, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`[publication:proof] FAILED: ${what} (exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
}
const shown = (abs: string) => path.relative(VIDEO_ROOT, abs).split(path.sep).join('/');
console.log(`[publication:proof] PASS: the proof package and its receipt are in ${shown(bundle)} for human review (npm run publication:verify-receipt -- ${shown(path.join(bundle, 'publication-proof-receipt.json'))})`);
