// Stage the hash-verified, spec-declared assets of every registered video into
// dist/public for Remotion Studio (`npm run studio`).

import { loadCommittedSpec, loadRegistry } from '../src/pipeline/context.ts';
import { PUBLIC_DIR, stageDeclaredAssets, stageRendererAssets } from '../src/pipeline/render-input.ts';

let n = stageRendererAssets().length;
for (const entry of loadRegistry()) n += stageDeclaredAssets(loadCommittedSpec(entry.videoId)).length;
console.log(`[assets] staged ${n} pinned renderer and declared asset(s) into ${PUBLIC_DIR}`);
