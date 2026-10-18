// npm run contracts:check -> verify this repository's contracts with the
// canonical WalletWall tree.
//
// Always: every fixture-mirror copy still matches its recorded blob and sha256.
// With WALLETWALL_SOURCE_ROOT (a WalletWall checkout), additionally:
//   - the brand contract's values match the canonical theme, constants, and :root
//   - the withheld docs/.mintignore still excludes no navigation page
//   - each mirrored file is compared with the checkout (moved files are reported;
//     whether a video is stale is `npm run freshness`'s job)
// Exit 1 on any value drift or broken attestation; 0 otherwise.

import { describeSourceRoot, SOURCE_IS_FIXTURE, SOURCE_ROOT } from '../src/config/load.ts';
import { brandDrift } from '../src/contracts/brand-drift.ts';
import { DOCS_URL } from '../src/brand/repo-constants.ts';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { canonicalManifest, gitBlobId } from '../src/source/canonical.ts';
import { FIXTURE_SOURCE_ROOT } from '../src/config/load.ts';
import { buildDocsSite, publishedPage } from '../src/source/docs-site.ts';

let failed = false;
const fail = (msg: string): void => {
  failed = true;
  console.error(`[contracts] FAIL ${msg}`);
};

console.log(`[contracts] ${describeSourceRoot()}`);

const manifest = canonicalManifest();
for (const [rel, entry] of Object.entries(manifest.files)) {
  const bytes = readFileSync(path.join(FIXTURE_SOURCE_ROOT, ...rel.split('/')));
  if (gitBlobId(bytes) !== entry.blob) fail(`fixture ${rel} no longer matches blob ${entry.blob}`);
}
console.log(`[contracts] fixture mirror: ${Object.keys(manifest.files).length} files verified against their blobs`);

if (SOURCE_IS_FIXTURE) {
  console.log('[contracts] brand and .mintignore drift checks need WALLETWALL_SOURCE_ROOT; skipped.');
} else {
  const drift = await brandDrift();
  for (const d of drift.valueDrift) fail(`brand ${d}`);
  for (const d of drift.blobDrift) console.warn(`[contracts] note: brand source moved, values unchanged: ${d}`);
  if (!drift.valueDrift.length) console.log('[contracts] brand contract: every value matches the canonical source');

  const git = (...args: string[]): string => execFileSync('git', ['-C', SOURCE_ROOT, ...args], { encoding: 'utf8' }).trim();
  const site = buildDocsSite(DOCS_URL, git('show', 'HEAD:docs/docs.json'), git('show', 'HEAD:docs/.mintignore'));
  // Only page files that exist count: a navigation slug resolves to whichever of .mdx/.md is in the tree.
  const tracked = new Set(git('ls-tree', '-r', '--name-only', 'HEAD', 'docs').split('\n'));
  let excluded = 0;
  for (const slug of site.pages.keys()) {
    const files = ['.mdx', '.md'].map((ext) => `docs/${slug}${ext}`).filter((f) => tracked.has(f));
    if (files.some((f) => publishedPage(site, f).reason === 'MINTIGNORED')) excluded++;
  }
  const withheld = manifest.withheld['docs/.mintignore'];
  if (excluded !== withheld?.navigationPagesExcluded) fail(`docs/.mintignore now excludes ${excluded} navigation page(s); the mirror attests ${withheld?.navigationPagesExcluded}`);
  else console.log(`[contracts] docs/.mintignore: excludes no navigation page (blob ${git('rev-parse', 'HEAD:docs/.mintignore')})`);

  for (const [rel, entry] of Object.entries(manifest.files)) {
    let live = '';
    try {
      live = git('rev-parse', `HEAD:${rel}`);
    } catch {
      live = '(absent)';
    }
    if (live !== entry.blob) console.warn(`[contracts] note: canonical ${rel} moved: mirror ${entry.blob}, checkout ${live}`);
  }
}

process.exitCode = failed ? 1 : 0;
