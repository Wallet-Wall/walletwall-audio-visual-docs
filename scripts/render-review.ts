// npm run render:review -> dist/review/*.png: WalletWallaby's pose sheet, close-up, and motion-lab stills.
//
// Review-only: bundles src/remotion/review/index.ts (never the video entry), stages the pinned
// renderer assets the same way the video render does, and renders lossless PNG stills. Motion-lab
// frames are chosen from the lab's own motion plan: the middle frame of each body phase of interest.
//
// Usage: node scripts/render-review.ts [name-prefix]

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { sampleWallaby } from '../src/character/walletwallaby/motion.ts';
import { DIST_ROOT, VIDEO_ROOT } from '../src/config/load.ts';
import { PUBLIC_DIR, stageRendererAssets } from '../src/pipeline/render-input.ts';
import { LAB_DURATION_MS, LAB_FPS, labPlan } from '../src/remotion/review/motion-lab-scene.ts';

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const out = path.join(DIST_ROOT, 'review');
mkdirSync(out, { recursive: true });

// Motion-lab picks: the middle frame of every run of one (action, phase), in timeline order.
const plan = labPlan();
console.log(`[review] motion lab plan: ${plan.motions.map((m) => m.kind).join(' > ')}`);
const runs: { key: string; frames: number[] }[] = [];
for (let f = 0; f < Math.ceil((LAB_DURATION_MS / 1000) * LAB_FPS); f++) {
  const s = sampleWallaby(plan, (f * 1000) / LAB_FPS);
  const key = s.visible ? `${s.motion.action}-${s.motion.phase}`.toLowerCase().replace(/_/g, '-') : 'hidden';
  if (runs.length && runs[runs.length - 1]!.key === key) runs[runs.length - 1]!.frames.push(f);
  else runs.push({ key, frames: [f] });
}
const labPicks = runs.filter((r) => r.key !== 'hidden').map((r) => ({ key: r.key, frame: r.frames[Math.floor(r.frames.length / 2)]! }));
// Contacts can end inside a frame, so every landing also gets two frames of its own: compression and recovery.
for (const e of plan.events.filter((x) => x.kind === 'LANDING')) {
  for (const [label, dt] of [['compress', 60], ['recover', 260]] as const) labPicks.push({ key: `landing-${label}-impulse-${e.impulse.toFixed(2)}`, frame: Math.round(((e.atMs + dt) / 1000) * LAB_FPS) });
}
labPicks.sort((a, b) => a.frame - b.frame);
const labJobs = labPicks.map((p, i) => ({ id: 'WalletWallabyMotionLab', name: `lab-${String(i).padStart(2, '0')}-${p.key}`, frame: p.frame }));

const jobs = [{ id: 'WalletWallabyPoseSheet', name: 'pose-sheet', frame: 0 }, { id: 'WalletWallabyCloseup', name: 'closeup', frame: 0 }, ...labJobs].filter((j) => !only || j.name.startsWith(only));
if (jobs.length === 0) throw new Error(`no review still matches ${only}`);
stageRendererAssets();
const serveUrl = await bundle({ entryPoint: path.join(VIDEO_ROOT, 'src', 'remotion', 'review', 'index.ts'), publicDir: PUBLIC_DIR });
const compositions = new Map<string, Awaited<ReturnType<typeof selectComposition>>>();
for (const job of jobs) {
  const composition = compositions.get(job.id) ?? (await selectComposition({ serveUrl, id: job.id }));
  compositions.set(job.id, composition);
  const output = path.join(out, `${job.name}.png`);
  await renderStill({ composition, serveUrl, output, frame: job.frame });
  console.log(`[review] ${path.relative(VIDEO_ROOT, output)} (frame ${job.frame})`);
}
