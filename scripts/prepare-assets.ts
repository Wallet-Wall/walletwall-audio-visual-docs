// Stage the hash-verified, spec-declared assets of every registered video into
// dist/public for Remotion Studio (`npm run studio`).

import { loadCommittedSpec, loadRegistry } from '../src/pipeline/context.ts';
import { PUBLIC_DIR, stageDeclaredAssets } from '../src/pipeline/render-input.ts';

let n = 0;
for (const entry of loadRegistry()) n += stageDeclaredAssets(loadCommittedSpec(entry.videoId)).length;
console.log(`[assets] staged ${n} declared asset(s) into ${PUBLIC_DIR}`);
