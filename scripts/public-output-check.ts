// npm run public:check -> the public-output gate: verify the publication package that
// publish:dry-run (and, when present, render and render:stills) wrote for a video, against this
// checkout, and optionally write the review bundle CI uploads. Credential-free; never uploads.
//
// Usage: node scripts/public-output-check.ts [videoId] [--dir=<dist dir>] [--stills=<dir>]...
//                                            [--require-render] [--bundle=<empty dir>] [--summary=<file>]
//   --dir             the package directory (default dist/<videoId>)
//   --stills          a directory render:stills wrote (stills.json + PNGs); repeat once per motion engine
//   --require-render  render.json and the MP4 it names must exist (the publication proof)
//   --bundle          after a PASS, copy exactly the verified files and the report into this empty directory
//   --summary         append a Markdown summary (for $GITHUB_STEP_SUMMARY)
// Exit 0 = PASS; 1 = findings (nothing is bundled); 2 = usage error.

import { appendFileSync } from 'node:fs';
import { loadRegistry, distDir } from '../src/pipeline/context.ts';
import { checkPublicOutput, currentPublicState, writeReviewBundle, type PublicOutputReport } from '../src/publish/public-output.ts';

const args = process.argv.slice(2);
const KNOWN = ['--dir=', '--stills=', '--require-render', '--bundle=', '--summary='];
const unknown = args.filter((a) => a.startsWith('--') && !KNOWN.some((k) => (k.endsWith('=') ? a.startsWith(k) : a === k)));
if (unknown.length) {
  console.error(`[public:check] unknown option ${unknown.join(', ')}`);
  process.exit(2);
}
const value = (flag: string): string | undefined => args.find((a) => a.startsWith(flag))?.slice(flag.length);
const videoId = args.find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;
const stills = args.filter((a) => a.startsWith('--stills=')).map((a) => a.slice('--stills='.length));

const state = await currentPublicState(videoId);
const result = checkPublicOutput(value('--dir=') ?? distDir(videoId), state, { requireRender: args.includes('--require-render'), stills });
const { report } = result;

for (const f of report.findings) console.log(`  ${f.code} ${f.path} — ${f.message}`);
const bundle = value('--bundle=');
if (report.ok && bundle) writeReviewBundle(result, bundle);
const summaryFile = value('--summary=');
if (summaryFile) appendFileSync(summaryFile, markdown(report, Boolean(bundle && report.ok)));
console.log(`[public:check] ${videoId}: ${report.ok ? 'PASS' : 'FAIL'} (${report.files.length} files verified, ${report.findings.length} findings)${report.ok && bundle ? '; review bundle written' : ''}`);
process.exitCode = report.ok ? 0 : 1;

function markdown(r: PublicOutputReport, bundled: boolean): string {
  const s = r.summary;
  const rows = [
    ['Title', s.title ?? '(none)'],
    ['Initial privacy', s.privacyStatus ?? '(none)'],
    ['Chapters', String(s.chapters)],
    ['Captions (WebVTT sha256)', s.captionsSha256 ? `\`${s.captionsSha256.slice(0, 16)}…\`` : '(none)'],
    ['Narration', s.narrationProviderId ?? '(none)'],
    ['Spec hash', `\`${s.specHash.slice(0, 16)}…\``],
    ['Node / lockfile', `${s.node} / \`${s.lockfileSha256.slice(0, 16)}…\``],
    ['Render', s.render ? `\`${s.render.sha256.slice(0, 16)}…\` (${s.render.motionEngine})` : 'none (dry run without a render)'],
    ...s.stills.map((x) => [`Stills (${x.engine})`, `${x.stills} stills, ${x.characterlessTwins} characterless twins (${x.onCanvasTwins} with WalletWallaby on canvas)`]),
    ['Files verified', String(r.files.length)],
    ['Review bundle', bundled ? 'written' : 'not written'],
  ];
  const findings = r.findings.map((f) => `- \`${f.code}\` \`${f.path}\` — ${f.message}`);
  return [`### Public output: ${r.ok ? 'PASS' : 'FAIL'} (${r.videoId})`, '', '| Check | Result |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v!.replace(/\|/g, '\\|')} |`), '', ...(findings.length ? ['**Findings**', '', ...findings, ''] : []), 'CI can prove publication readiness; it cannot publish. Nothing here was uploaded to YouTube.', ''].join('\n');
}
