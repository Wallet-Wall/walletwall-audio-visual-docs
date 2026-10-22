// The publication proof receipt (src/publish/proof-receipt.ts, docs/PUBLICATION.md).
//
// npm run publication:verify-receipt -- <receipt> [--receipt-only]
//     Verify a receipt: its closed schema and identity, that it leaks nothing, everything this checkout derives, and
//     (unless --receipt-only) the proof package beside it, re-derived in full: the public-output gate re-run on the
//     package, every file re-hashed, nothing unbound, the evidence re-derived. Exit 0 = PASS, 1 = findings, 2 = usage.
//
// node scripts/publication-receipt.ts environment
//     publication:proof, after the invariants: is the environment Blender just rendered in an approved publication
//     class? If not, print the approved/observed/changed diff and stop before the whole video is rendered.
//
// node scripts/publication-receipt.ts write [videoId] --bundle=<proof package> [--narration=fixture|publication]
//     publication:proof, last: stage the evidence (the invariants report, Blender's render manifests) into the proof
//     package, derive the receipt, write it (temporary file + rename), and verify it from disk; a receipt that does not
//     verify is removed. Never writes outside the proof package. With publication narration the receipt binds the
//     verified narration set the render carries (replayed from dist/<videoId>/narration, never synthesized).
//
// A receipt that names publication narration is verified against the narration set its own proof package holds
// (<package>/<videoId>/narration/), replayed and re-verified against this checkout's script and approved binding.
//
// Fixed arguments only; nothing here uploads, publishes, approves, or edits configuration.

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { publicationEnvironmentCheck } from '../src/blender/environment.ts';
import { loadEnvironments } from '../src/blender/identity.ts';
import { loadBlenderConfig, outFile } from '../src/blender/toolchain.ts';
import { DIST_ROOT, VIDEO_ROOT } from '../src/config/load.ts';
import { loadRegistry } from '../src/pipeline/context.ts';
import { buildReceipt, readReceiptDocument, ReceiptError, RECEIPT_FILE, stageEvidence, verifyReceipt, writeReceipt } from '../src/publish/proof-receipt.ts';
import { parseNarrationMode, publicationNarrationDir } from '../src/narration/publication.ts';
import { currentPublicState } from '../src/publish/public-output.ts';

const [command, ...rest] = process.argv.slice(2);
const usage = (why: string): never => {
  console.error(`[publication:receipt] ${why}\nusage: node scripts/publication-receipt.ts verify <receipt> [--receipt-only] | environment | write [videoId] --bundle=<dir>`);
  process.exit(2);
};
const options = (allowed: string[]) => {
  const unknown = rest.filter((a) => a.startsWith('--') && !allowed.some((k) => (k.endsWith('=') ? a.startsWith(k) : a === k)));
  if (unknown.length) usage(`unknown option ${unknown.join(', ')}`);
};
const registered = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id) && loadRegistry().some((v) => v.videoId === id);
const shown = (abs: string) => path.relative(VIDEO_ROOT, abs).split(path.sep).join('/');

if (command === 'verify') {
  options(['--receipt-only']);
  const positional = rest.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) usage('name exactly one receipt');
  const receiptPath = path.resolve(positional[0]!);
  // The video the receipt names, if it is a registered one; the verifier itself refuses anything else.
  let videoId = loadRegistry()[0]!.videoId;
  // Bounded and link-refusing, like the verifier's own read; an unreadable receipt is reported by verifyReceipt.
  const doc = readReceiptDocument(receiptPath).doc as { subject?: { video?: { videoId?: unknown }; narration?: { publication?: unknown } } } | null;
  const named = doc?.subject?.video?.videoId;
  if (registered(named)) videoId = named;
  const receiptOnly = rest.includes('--receipt-only');
  // Publication narration is re-derived from the narration set inside the receipt's own proof package; a receipt
  // checked alone (--receipt-only, no package beside it) is checked against this checkout's own set instead.
  const publicationNarration = doc?.subject?.narration?.publication != null;
  const packaged = path.join(path.dirname(receiptPath), videoId, 'narration');
  const narrationDir = receiptOnly && !existsSync(packaged) ? publicationNarrationDir(videoId) : packaged;
  let state;
  try {
    state = await currentPublicState(videoId, process.env, publicationNarration ? { narration: 'publication', narrationDir } : {});
  } catch (err) {
    console.log(`[publication:verify-receipt] FAIL: the narration this receipt names cannot be re-derived: ${(err as Error).message}`);
    process.exit(1);
  }
  const r = verifyReceipt(receiptPath, state, { receiptOnly });
  console.log(`[publication:verify-receipt] receipt ${r.receiptSha256 ?? '(no identity)'} for ${videoId}`);
  console.log(`  checked: schema, identity, leak policy, this checkout (spec, build, motion and MotionPlan, character, environment class, captions, invariants, gates)${receiptOnly ? '; NOT the proof package (--receipt-only): file bytes, including the MP4, were not re-checked' : '; the proof package (gate re-run, every file, evidence)'}`);
  for (const f of r.findings) console.log(`  ${f.code} ${f.path} — ${f.message}`);
  console.log(`[publication:verify-receipt] ${r.ok ? 'PASS' : `FAIL (${r.findings.length} findings)`}`);
  process.exitCode = r.ok ? 0 : 1;
} else if (command === 'environment') {
  options([]);
  if (rest.length) usage('environment takes no arguments');
  // The environment the invariants' renders just ran in (render.py), as the invariants report records it.
  let record: unknown;
  try {
    record = (JSON.parse(readFileSync(outFile('invariants/report.json'), 'utf8')) as { environment?: { record?: unknown } }).environment?.record;
  } catch {
    record = undefined;
  }
  if (record === undefined) {
    console.error('[publication:proof] the invariants report records no render environment: run npm run blender:invariants first');
    process.exit(1);
  }
  const check = publicationEnvironmentCheck(record, loadBlenderConfig(), loadEnvironments());
  if (check.ok) console.log(`[publication:proof] ${check.lines.join('\n')}`);
  else {
    console.error(`[publication:proof] ${check.lines.join('\n')}`);
    process.exit(1);
  }
} else if (command === 'write') {
  options(['--bundle=', '--narration=']);
  const positional = rest.filter((a) => !a.startsWith('--'));
  const videoId = positional[0] ?? loadRegistry()[0]!.videoId;
  if (positional.length > 1 || !registered(videoId)) usage('name at most one registered video');
  const bundleArg = rest.find((a) => a.startsWith('--bundle='))?.slice('--bundle='.length);
  if (!bundleArg) usage('--bundle names the proof package');
  const bundle = path.resolve(bundleArg!);
  // The receipt is written only inside dist/: a proof package is generated output, never a source directory.
  const rel = path.relative(DIST_ROOT, bundle);
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') usage('the proof package must be a directory inside dist/');
  const finalReceipt = path.join(bundle, RECEIPT_FILE);
  /** Say what is actually on disk: a receipt that is there but did not verify must never pass for one. */
  const failed = (why: string): never => {
    console.error(`[publication:receipt] FAILED: ${why}`);
    let left = false;
    try {
      unlinkSync(finalReceipt);
    } catch (err) {
      left = (err as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    console.error(left ? `[publication:receipt] ${RECEIPT_FILE} could NOT be removed from the proof package: it is not a verified receipt; delete the whole package` : `[publication:receipt] no ${RECEIPT_FILE} is in the proof package`);
    process.exit(1);
  };
  try {
    const state = await currentPublicState(videoId, process.env, { narration: parseNarrationMode(rest) });
    stageEvidence(bundle, { invariantsReport: outFile('invariants/report.json'), blenderManifest: (name) => outFile(`renders/${name}/render.json`) });
    const receipt = buildReceipt(bundle, state, new Date().toISOString());
    const written = writeReceipt(bundle, receipt, state);
    // Verified before it was written; now once more as anyone will read it: from disk, against the whole package.
    const fromDisk = verifyReceipt(written, state);
    if (!fromDisk.ok) failed(`the written receipt does not verify from disk: ${fromDisk.findings.map((f) => `${f.code} ${f.path}`).join('; ')}`);
    console.log(`[publication:receipt] ${receipt.subject.renderEnvironment.approvedClass} (class ${receipt.subject.renderEnvironment.classId}); video ${receipt.subject.video.file.sha256.slice(0, 16)}…`);
    console.log(`[publication:receipt] receipt ${receipt.receiptSha256} written and verified from disk: ${shown(written)}`);
  } catch (err) {
    // A receipt already in the package is not this run's: leave it, and say so.
    if (err instanceof ReceiptError && /already exists/.test(err.message)) {
      console.error(`[publication:receipt] FAILED: ${err.message}`);
      process.exit(1);
    }
    failed(err instanceof ReceiptError ? err.message : (err as Error).message);
  }
} else usage(`unknown command ${JSON.stringify(command ?? '')}`);
