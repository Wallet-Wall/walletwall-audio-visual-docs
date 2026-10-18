// npm run plan        -> regenerate specs/<id>/spec.json + source.snapshot.json from the storyboard
// npm run plan:check  -> fail if the committed artifacts differ from a fresh regeneration
//
// Usage: node scripts/plan.ts [--check] [videoId...]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describeSourceRoot, loadPipelineConfig } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { entryFor, loadRegistry, planVideo, snapshotPath, specDir, specPath } from '../src/pipeline/context.ts';
import { loadDocsSite } from '../src/source/load.ts';

const args = process.argv.slice(2);
const check = args.includes('--check');
const ids = args.filter((a) => !a.startsWith('--'));
const entries = ids.length ? ids.map(entryFor) : loadRegistry();
const config = loadPipelineConfig();
console.log(`[plan] ${describeSourceRoot()}`);
const site = loadDocsSite();

const read = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
};

let failed = false;
for (const entry of entries) {
  const { spec, source, dirtyDoc } = await planVideo(entry, config, site);
  if (dirtyDoc) console.warn(`[plan] ${entry.docPath} has uncommitted edits; the blob refers to HEAD while contentHash reflects the working tree.`);
  const outputs: [string, string][] = [
    [specPath(entry.videoId), prettyJson(spec)],
    [snapshotPath(entry.videoId), prettyJson(source)],
  ];
  if (check) {
    for (const [file, bytes] of outputs) {
      if (read(file) !== bytes) {
        failed = true;
        console.error(`[plan:check] ${file} is stale. Run \`npm run freshness\` to classify the change, then \`npm run plan\`.`);
      }
    }
    if (!failed) console.log(`[plan:check] ${entry.videoId}: committed spec and snapshot match regeneration (${spec.videoClass}).`);
  } else {
    mkdirSync(specDir(entry.videoId), { recursive: true });
    for (const [file, bytes] of outputs) writeFileSync(file, bytes);
    console.log(`[plan] ${entry.videoId}: wrote spec (${spec.videoClass}, ${spec.segments.length} segments, ${spec.claims.length} claims) and source snapshot.`);
  }
}
process.exitCode = failed ? 1 : 0;
