// Review-only: the narrow perch. The committed lesson has no narrow support (its perches are broad cards and the summit
// ledge), so the narrow case is the review motion lab's: a 150 px node WalletWallaby lands on and balances on.
//
// node scripts/review/narrow-perch.ts [--frame=<lab frame>]
//   -> dist/blender-review/visual/narrow-perch.png   Blender's body (the same bridge, rig and light as the lesson) over the lab's
//                                                     terrain drawn with the same terrain family (ground strata, ledge formation, parchment node)
//
// The lab terrain is synthetic and review-only: nothing here reaches the video.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { blenderIdentity, CHARACTER } from '../../src/blender/identity.ts';
import { BLENDER_OUT, findBlender, loadBlenderConfig, outFile, runBlender, writeJob } from '../../src/blender/toolchain.ts';
import { BLENDER_MOTION_SCHEMA, bridgeFrame, PLANE_ORIGIN, UNITS_PER_PX, validateBridge } from '../../src/character/walletwallaby/blender/bridge.ts';
import { blenderRigDocument } from '../../src/character/walletwallaby/blender/rig-export.ts';
import { blenderTerrainDocument } from '../../src/character/walletwallaby/blender/terrain-export.ts';
import { sampleWallaby } from '../../src/character/walletwallaby/motion.ts';
import { compileRig } from '../../src/character/walletwallaby/rive/rig-compile.ts';
import { DIST_ROOT, VIDEO_ROOT } from '../../src/config/load.ts';
import { prettyJson } from '../../src/core/canonical-json.ts';
import { sceneTerrain } from '../../src/layout/terrain.ts';
import { PUBLIC_DIR, stageRendererAssets } from '../../src/pipeline/render-input.ts';
import { LAB_DURATION_MS, LAB_FPS, LAB_LAYOUT, LAB_SEGMENT, labPlan } from '../../src/remotion/review/motion-lab-scene.ts';
import { RIG } from '../../src/character/walletwallaby/versions.ts';
import { over, readPng, writePng } from './png.ts';

const args = process.argv.slice(2);
const plan = labPlan();
// The middle of the PERCH / HOLD run: balanced on the narrow node.
let frame = Number(args.find((a) => a.startsWith('--frame='))?.slice(8) ?? NaN);
if (!Number.isFinite(frame)) {
  const perch: number[] = [];
  for (let f = 0; f < Math.ceil((LAB_DURATION_MS / 1000) * LAB_FPS); f++) {
    const s = sampleWallaby(plan, (f * 1000) / LAB_FPS);
    if (s.visible && s.motion.action === 'PERCH' && s.motion.phase === 'HOLD') perch.push(f);
  }
  if (perch.length === 0) throw new Error('the lab plan has no PERCH / HOLD frame');
  frame = perch[Math.floor(perch.length / 2)]!;
}
console.log(`[narrow-perch] lab frame ${frame}`);

const out = path.join(DIST_ROOT, 'blender-review', 'visual');
mkdirSync(out, { recursive: true });

// 1. The lab's terrain alone, as Remotion draws it.
stageRendererAssets();
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'review', 'index.ts'), publicDir: PUBLIC_DIR });
const composition = await selectComposition({ serveUrl, id: 'WalletWallabyMotionLab', inputProps: { characterless: true } });
const bgFile = path.join(out, 'narrow-perch.terrain.png');
await renderStill({ composition, serveUrl, output: bgFile, frame, inputProps: { characterless: true } });

// 2. Blender's body on that terrain: one bridge frame from the lab's own motion plan.
const cfg = loadBlenderConfig();
const blender = findBlender(cfg);
const model = compileRig().model;
const state = sampleWallaby(plan, (frame * 1000) / LAB_FPS);
const terrain = sceneTerrain(LAB_LAYOUT);
const bf = bridgeFrame(model, 0, LAB_SEGMENT, state, [terrain]);
const bridge = validateBridge(JSON.parse(JSON.stringify({ schema: BLENDER_MOTION_SCHEMA, videoId: 'lab', fps: LAB_FPS, range: { first: 0, last: 0 }, motionEngine: 'typescript:motion-lab', coordinates: { unitsPerPx: UNITS_PER_PX, planeOrigin: { ...PLANE_ORIGIN } }, frames: [bf] })));
const terrainDoc = blenderTerrainDocument(new Map([[LAB_SEGMENT, terrain]]), [LAB_SEGMENT]);
const outDir = 'renders/narrow-perch';
mkdirSync(path.join(BLENDER_OUT, ...outDir.split('/')), { recursive: true });
writeFileSync(outFile(`${outDir}/bridge.json`), prettyJson(bridge));
writeFileSync(outFile(`${outDir}/identity.json`), prettyJson(blenderIdentity(cfg, blender, RIG.version, bridge, BLENDER_MOTION_SCHEMA, terrainDoc)));
const job = writeJob('render.narrow-perch', { schema: 'walletwall.blender-job/v1', kind: 'render', config: cfg, rig: blenderRigDocument(model), blend: CHARACTER.blend, bridge, terrain: terrainDoc, shots: [{ name: 'f00000', frame: 0, camera: { kind: 'teaching' } }], outputs: { dir: outDir, manifest: `${outDir}/render.json` } });
const { ms } = runBlender(blender, cfg, 'render.py', job);
console.log(`[narrow-perch] ${bf.semantic.action}/${bf.semantic.phase} on ${bf.semantic.surface?.id ?? '(air)'} [${bf.semantic.surface?.support ?? '-'}], rendered in ${(ms / 1000).toFixed(1)} s`);

// 3. Composite.
const bg = readPng(bgFile);
over(bg, readPng(outFile(`${outDir}/f00000.png`)), 0, 0);
writePng(path.join(out, 'narrow-perch.png'), bg);
console.log(`[narrow-perch] -> ${path.relative(process.cwd(), path.join(out, 'narrow-perch.png'))}`);
