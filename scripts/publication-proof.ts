// npm run publication:proof [-- --motion-engine=typescript|rust-wasm] [videoId]
//   -> dist/publication-proof/ (the proof package a human reviews before any publication)
//
// The whole-video publication proof, on the production render host (docs/BLENDER.md, Publication). Hosted CI
// cannot make it: WalletWallaby is drawn by the pinned Blender, and a GPU-less runner renders the whole lesson
// in software GL in many hours. So this runs where the publication class is (config/blender-environments.json):
// validate the spec; render the whole video with the fixture voice; run the publish dry run against that exact
// render; and run the public-output gate with the render required, which refuses a render from any class that is
// not a publication class. It never uploads anything and holds no publication credential: CI CAN prove
// publication readiness, CI MUST NOT publish, and neither may this.

import { spawnSync } from 'node:child_process';
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
const steps: [string, string[]][] = [
  ['validate the spec', ['scripts/validate.ts']],
  ['render the whole video with the fixture voice', ['scripts/render.ts', ...(videoId ? [videoId] : []), `--motion-engine=${engine}`]],
  ['publish dry run against this exact render', ['scripts/publish-dry-run.ts', ...(videoId ? [videoId] : [])]],
  ['public-output gate, render required (writes the proof package)', ['scripts/public-output-check.ts', ...(videoId ? [videoId] : []), '--require-render', `--bundle=${bundle}`]],
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
console.log(`[publication:proof] PASS: the proof package is in ${path.relative(VIDEO_ROOT, bundle)} for human review`);
