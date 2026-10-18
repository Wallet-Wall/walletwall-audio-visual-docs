// npm run publish:dry-run -> build captions, cue sheet, provenance, and the
// YouTube publish manifest for a video, run media QA, and hand the manifest to
// the credential-free DryRunUploadProvider. Never contacts YouTube.
//
// Usage: node scripts/publish-dry-run.ts [videoId]
// Picks up dist/<id>/render.json when a render exists; otherwise the manifest
// records `files.video: null` (validation-only dry run).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCaptions, checkCaptions, toSrt, toWebVtt } from '../src/audio/captions.ts';
import { buildCueSheet } from '../src/audio/cue-sheet.ts';
import { choreograph, layoutsFor } from '../src/character/walletwallaby/choreography.ts';
import { assertSupported, auditLesson } from '../src/character/walletwallaby/contacts.ts';
import { planMotion } from '../src/character/walletwallaby/motion.ts';
import { FixtureVoiceProvider } from '../src/audio/voice-provider.ts';
import { loadPipelineConfig, readJson, VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { buildProvenanceManifest } from '../src/manifest/provenance.ts';
import { loadVerifiedArtifact } from '../src/motion/artifact.ts';
import { readMotionIntelligenceConfig, typescriptEngineIdentity, type MotionEngineIdentity } from '../src/motion/engine-identity.ts';
import { planRustMotion } from '../src/motion/rust-adapter.ts';
import { distDir, loadCommittedSpec, loadRegistry, validationContextFor } from '../src/pipeline/context.ts';
import { loadSnapshot, synthesize } from '../src/pipeline/render-input.ts';
import { emptyLineage, type Lineage } from '../src/publish/lineage.ts';
import { buildPublishManifest, checkPublishManifest } from '../src/publish/manifest.ts';
import { DryRunUploadProvider } from '../src/publish/upload-provider.ts';
import { loadDocsSite } from '../src/source/load.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { validateSpec } from '../src/validation/validate-spec.ts';

const videoId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? loadRegistry()[0]!.videoId;
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const out = distDir(videoId);
mkdirSync(out, { recursive: true });

const track = await synthesize(spec, new FixtureVoiceProvider(), config);
const timeline = buildTimeline(spec, track, config.templates);
const validation = validateSpec(spec, validationContextFor(spec, config, loadDocsSite(), track));

// Media QA: captions are generated from the narration source and checked against it.
const cues = buildCaptions(timeline);
const qa = new IssueCollector();
checkCaptions(cues, spec, timeline, config.lexicon, qa);
const vtt = toWebVtt(cues);
writeFileSync(path.join(out, `${videoId}.en.vtt`), vtt);
writeFileSync(path.join(out, `${videoId}.en.srt`), toSrt(cues));

const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const motion = planMotion(choreograph(timeline, layouts), layouts);
// Nothing is published while WalletWallaby would stand, grip, or brace on anything the terrain cannot carry.
const judged = auditLesson(timeline, layouts, motion);
try {
  assertSupported(judged);
} catch (err) {
  console.error(`[publish:dry-run] ${videoId}: ${(err as Error).message}`);
  process.exit(1);
}

const renderInfoPath = path.join(out, 'render.json');
const renderInfo = existsSync(renderInfoPath) ? readJson<{ specHash?: string; engine: { name: string; version: string }; output: { path: string; sha256: string }; identity?: unknown; motionEngine?: MotionEngineIdentity }>(renderInfoPath) : null;
// A render made by a different toolchain, configuration, or character version cannot be described by this one.
const identity = buildIdentity();
if (renderInfo && prettyJson(renderInfo.identity ?? null) !== prettyJson(identity)) {
  console.error(`[publish:dry-run] ${videoId}: dist render.json was produced with a different build identity; re-render before publishing.`);
  process.exit(1);
}
// Nor can a render of a different spec (an on-screen text edit keeps the timeline and the identity), or
// a render.json from before renders recorded their spec.
const specHash = contentAddress(spec);
if (renderInfo && renderInfo.specHash !== specHash) {
  console.error(`[publish:dry-run] ${videoId}: dist render.json was rendered from a different spec, or does not record one; re-render before publishing.`);
  process.exit(1);
}
// Nor can a render whose motion came from an engine artifact or engine config this checkout no longer has.
// (A render.json from before the field existed was made by the TypeScript solver.)
const motionEngine: MotionEngineIdentity = renderInfo?.motionEngine ?? typescriptEngineIdentity();
// The contact cues are timed to the contacts the render's scene reacted to: the TypeScript plan's, or,
// on the paths the engine performed, the engine's own.
let contacts = motion.events;
if (renderInfo && motionEngine.motionEngine === 'rust-wasm') {
  // The bytes on disk, verified against their manifest (a swapped .wasm is refused here, not trusted).
  const { manifest: artifact } = loadVerifiedArtifact();
  if (motionEngine.wasm.sha256 !== artifact.sha256 || motionEngine.config.sha256 !== contentAddress(readMotionIntelligenceConfig())) {
    console.error(`[publish:dry-run] ${videoId}: dist render.json was made with a different Motion Intelligence artifact or config; re-render before publishing.`);
    process.exit(1);
  }
  // Solve again (deterministic) and require exactly the plans the render performed, byte for byte.
  const rust = planRustMotion({ spec, track, templates: config.templates, headings });
  if (prettyJson(rust.identity) !== prettyJson(motionEngine)) {
    console.error(`[publish:dry-run] ${videoId}: the Motion Intelligence plans no longer match the ones dist render.json recorded; re-render before publishing.`);
    process.exit(1);
  }
  contacts = [...rust.bound.contacts];
}
const cueSheet = buildCueSheet(timeline, config.sonic, spec.audio.musicBedId, contacts);
writeFileSync(path.join(out, 'cue-sheet.json'), prettyJson(cueSheet));
const manifest = buildPublishManifest({
  spec,
  specHash,
  timeline,
  docDescription: source.description,
  youtube: config.youtube,
  playlists: config.playlists,
  captions: { path: `dist/${videoId}/${videoId}.en.vtt`, sha256: sha256Hex(vtt) },
  video: renderInfo ? { path: renderInfo.output.path, sha256: renderInfo.output.sha256 } : null,
  narration: { providerId: track.providerId, estimated: track.estimated },
});
checkPublishManifest(manifest, config.youtube, process.env, qa);

const provenance = buildProvenanceManifest({
  spec,
  track,
  timeline,
  cueSheet,
  validation,
  render: renderInfo ? { engine: renderInfo.engine.name, version: renderInfo.engine.version, output: renderInfo.output.path, sha256: renderInfo.output.sha256, motionEngine } : null,
  identity,
});
writeFileSync(path.join(out, 'provenance.json'), prettyJson(provenance));
writeFileSync(path.join(out, 'publish-manifest.json'), prettyJson(manifest));

const media = qa.report();
writeFileSync(path.join(out, 'media-qa.json'), prettyJson(media));
for (const i of [...validation.issues, ...media.issues]) console.log(`  ${i.severity.toUpperCase()} ${i.code} ${i.path} — ${i.message}`);
if (!validation.ok || !media.ok) {
  console.error(`[publish:dry-run] ${videoId}: BLOCKED (spec errors ${validation.errors}, media QA errors ${media.errors}); nothing handed to the upload provider.`);
  process.exit(1);
}

const receipt = await new DryRunUploadProvider().upload({
  manifest,
  videoFile: renderInfo ? path.join(VIDEO_ROOT, renderInfo.output.path) : '',
  captionsFile: path.join(out, `${videoId}.en.vtt`),
});
const lineagePath = path.join(VIDEO_ROOT, 'manifests', `${videoId}.lineage.json`);
const lineage: Lineage = existsSync(lineagePath) ? readJson<Lineage>(lineagePath) : emptyLineage(videoId);
writeFileSync(path.join(out, 'receipt.json'), prettyJson({ receipt, lineageUnchanged: lineage }));
console.log(`[publish:dry-run] ${videoId}: "${manifest.snippet.title}" -> ${receipt.mode} ${receipt.privacyStatus}; ${manifest.chapters.length} chapters; video ${renderInfo ? 'attached' : 'not rendered'}; lineage untouched.`);
