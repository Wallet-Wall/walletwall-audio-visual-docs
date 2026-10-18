// npm run validate -> validate every committed spec against the LIVE doc, its
// assets, and the fixture narration estimate. Writes dist/<id>/validation.json
// (machine-readable) and exits 1 on any error.
//
// Usage: node scripts/validate.ts [videoId...] [--json]

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describeSourceRoot, loadPipelineConfig } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { distDir, entryFor, loadCommittedSpec, loadRegistry, validationContextFor } from '../src/pipeline/context.ts';
import { loadDocsSite } from '../src/source/load.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('--'));
const entries = ids.length ? ids.map(entryFor) : loadRegistry();
const config = loadPipelineConfig();
console.log(`[validate] ${describeSourceRoot()}`);
const site = loadDocsSite();

let failed = false;
for (const entry of entries) {
  const spec = loadCommittedSpec(entry.videoId);
  const report = validateSpec(spec, validationContextFor(spec, config, site));
  if (spec.id !== entry.videoId) {
    report.issues.push({ code: 'SPEC_ID_INVALID', severity: 'error', path: 'id', message: `spec id ${JSON.stringify(spec.id)} != registry id ${entry.videoId}` });
    report.ok = false;
    report.errors++;
  }
  mkdirSync(distDir(entry.videoId), { recursive: true });
  writeFileSync(path.join(distDir(entry.videoId), 'validation.json'), prettyJson(report));
  if (args.includes('--json')) console.log(JSON.stringify(report));
  for (const i of report.issues) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path} — ${i.message}`);
  console.log(`[validate] ${entry.videoId}: ${report.ok ? 'PASS' : 'FAIL'} (${report.errors} errors, ${report.warnings} warnings)`);
  failed ||= !report.ok;
}
process.exitCode = failed ? 1 : 0;
