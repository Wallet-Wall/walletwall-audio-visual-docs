// npm run freshness -> classify how the live doc differs from the snapshot each
// committed spec was planned against, and what that means for the video.
// Exit 0 when every video is CURRENT or COSMETICALLY_STALE; 2 when any needs a
// re-render or a new revision (so CI can flag it without calling it a crash).
//
// Usage: node scripts/freshness.ts [videoId...] [--json]

import { describeSourceRoot, loadPipelineConfig } from '../src/config/load.ts';
import { entryFor, loadCommittedSpec, loadRegistry } from '../src/pipeline/context.ts';
import { loadSnapshot } from '../src/pipeline/render-input.ts';
import { loadDocsSite, loadNormalizedDoc } from '../src/source/load.ts';
import { classifyDocChange } from '../src/staleness/classify.ts';
import { deriveFreshness } from '../src/staleness/freshness.ts';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const entries = ids.length ? ids.map(entryFor) : loadRegistry();
const config = loadPipelineConfig();
console.log(`[freshness] ${describeSourceRoot()}`);
const site = loadDocsSite();

let needsWork = false;
for (const entry of entries) {
  const spec = loadCommittedSpec(entry.videoId);
  const before = loadSnapshot(spec);
  const after = loadNormalizedDoc(spec.source.docPath, config.domains.navigationGroups, site);
  const report = classifyDocChange(spec, before, after);
  const verdict = deriveFreshness(report);
  if (args.includes('--json')) console.log(JSON.stringify({ report, verdict }));
  for (const r of verdict.reasons) console.log(`  ${r}`);
  console.log(`[freshness] ${entry.videoId}: ${verdict.freshness} -> ${verdict.action}${verdict.affectedSegments.length ? ` (segments: ${verdict.affectedSegments.join(', ')})` : ''}`);
  needsWork ||= verdict.freshness === 'REGENERATION_REQUIRED' || verdict.freshness === 'MATERIALLY_STALE';
}
process.exitCode = needsWork ? 2 : 0;
