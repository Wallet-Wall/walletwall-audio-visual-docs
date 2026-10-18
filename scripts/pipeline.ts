// npm run pipeline -> the whole v1 vertical slice for one video, in order:
//   plan:check -> validate -> freshness -> render (stills, then MP4) -> publish:dry-run
// Stops at the first failing gate. Nothing is uploaded or published.
//
// Usage: node scripts/pipeline.ts [videoId] [--skip-render]

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { loadRegistry } from '../src/pipeline/context.ts';

const args = process.argv.slice(2);
const videoId = args.find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;
const skipRender = args.includes('--skip-render');

const steps: [string, string[]][] = [
  ['plan:check', ['scripts/plan.ts', '--check', videoId]],
  ['validate', ['scripts/validate.ts', videoId]],
  ['freshness', ['scripts/freshness.ts', videoId]],
  ...(skipRender
    ? []
    : ([
        ['render:stills', ['scripts/render.ts', videoId, '--stills']],
        ['render', ['scripts/render.ts', videoId]],
      ] as [string, string[]][])),
  ['publish:dry-run', ['scripts/publish-dry-run.ts', videoId]],
];

for (const [name, argv] of steps) {
  console.log(`\n== ${name} ==`);
  const r = spawnSync(process.execPath, argv, { cwd: path.resolve(VIDEO_ROOT), stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[pipeline] ${name} exited ${r.status}; stopping.`);
    process.exit(r.status ?? 1);
  }
}
console.log(`\n[pipeline] ${videoId}: all gates passed. Outputs in dist/${videoId}/ (not committed).`);
