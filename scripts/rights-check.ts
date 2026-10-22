// npm run rights:check [-- --public-release] [--json]
//
// The repository's licensing boundaries and release rights, judged from the committed files (docs/LICENSING.md,
// docs/RELEASE_RIGHTS.md). Deterministic, offline, and blind to the environment: it makes no network call, reads no
// credential or environment variable, and draws no legal conclusion beyond the policy encoded in src/rights/.
//
//   (no flag)         development check: the source-code licenses, the Blender boundary, the lockfiles, and the media
//                     assets must all agree with config/release-rights.json. Owner decisions recorded as pending pass,
//                     listed, because they are not falsely cleared.
//   --public-release  the strict check a release needs before it leaves LOCAL_PROOF: every material item must be
//                     CLEARED. Any other status fails.
//   --json            print the report as JSON instead of text.
//
// Exit 0 on PASS, 1 on FAIL, 2 on a usage error. It does not run in the render path and changes nothing.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettyJson } from '../src/core/canonical-json.ts';
import { checkRights, renderReport, type RightsMode } from '../src/rights/check.ts';
import { fsRepo } from '../src/rights/repo.ts';

const FLAGS = new Set(['--public-release', '--json']);
const args = process.argv.slice(2);
const unknown = args.filter((a) => !FLAGS.has(a));
if (unknown.length > 0 || new Set(args).size !== args.length) {
  console.error(`[rights] usage: npm run rights:check [-- --public-release] [--json]${unknown.length > 0 ? ` (unknown: ${unknown.join(' ')})` : ''}`);
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode: RightsMode = args.includes('--public-release') ? 'public-release' : 'development';
const report = checkRights(fsRepo(root), { mode });

if (args.includes('--json')) process.stdout.write(prettyJson(report));
else for (const line of renderReport(report)) console.log(line);
process.exitCode = report.result === 'PASS' ? 0 : 1;
