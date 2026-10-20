// The WalletWallaby narration bakeoff (docs/NARRATION.md): synthesize the
// evaluation corpus with each provider adapter, measure the audio, transcribe
// it for source agreement, and build the blind review page. Evaluation tooling
// only: nothing here is on the render or publish path, every output lands in
// dist/narration-bakeoff/ (never committed), and no provider is made the
// publication voice by running it.
//
//   node scripts/narration.ts doctor
//   node scripts/narration.ts pull chatterbox [--revision=<ref>]
//   node scripts/narration.ts synthesize --provider=<id> --variant=<name> [--passages=a,b] [--repeat=N]
//   node scripts/narration.ts place --provider=elevenlabs --variant=<name> --passage=<id> --file=<path.wav>
//   node scripts/narration.ts transcribe [--provider=<id>] [--variant=<name>] [--device=cuda|cpu]
//   node scripts/narration.ts review [--lineup=provider:variant,...] [--target-lufs=-20]

import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { estimateSpokenMs } from '../src/audio/voice-provider.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../src/config/load.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { readContainedFile } from '../src/core/contained-read.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { buildNarrationArtifact, staleFor, validateNarrationArtifact, type NarrationArtifact } from '../src/narration/artifact.ts';
import type { PipelineConfig } from '../src/config/types.ts';
import { isNarrationProviderId, NarrationContractError, PLAIN_ID, type NarrationProvider, type NarrationProviderId, type NarrationRequest, type SynthesisResult } from '../src/narration/contract.ts';
import { corpusSha256, loadCorpus, passageRequest, type CorpusPassage, type NarrationCorpus } from '../src/narration/corpus.ts';
import { analyzeAudio, applyGainDb, loudnessMatchGainDb, type AudioMetrics } from '../src/narration/metrics.ts';
import { minimalEnv, probeVersion, resolveExecutable, runChild } from '../src/narration/providers/child.ts';
import { CHATTERBOX_ENTRY, pythonFor } from '../src/narration/providers/chatterbox.ts';
import { ElevenLabsProvider } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig, providerFor, variantNames, variantSettings, type NarrationProvidersConfig } from '../src/narration/providers/index.ts';
import { directoryContent, nemoModelDir, pinnedPath, resolveMagpieModels } from '../src/narration/providers/magpie.ts';
import { compareTranscript, type TranscriptDiff } from '../src/narration/transcript.ts';
import { decodePcm16Mono, encodeWavPcm16, parseWav } from '../src/narration/wav.ts';

const BAKEOFF_ROOT = path.join(DIST_ROOT, 'narration-bakeoff');
const REL_ROOT = 'dist/narration-bakeoff';
const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const log = (line: string): void => console.log(`[narration] ${line}`);

const candidateDir = (provider: string, variant: string): string => path.join(BAKEOFF_ROOT, provider, variant);
const relAudio = (provider: string, variant: string, passageId: string): string => `${REL_ROOT}/${provider}/${variant}/${passageId}.wav`;
const abs = (rel: string): string => path.join(VIDEO_ROOT, ...rel.split('/'));

interface Candidate {
  provider: NarrationProviderId;
  variant: string;
  passageId: string;
  dir: string;
  artifact: NarrationArtifact;
}

function measure(wav: Uint8Array): AudioMetrics {
  const info = parseWav(wav);
  return analyzeAudio(decodePcm16Mono(wav, info), info.sampleRate);
}

/** A bakeoff output by its repository-relative path, read through one handle and refused if it resolves outside dist/narration-bakeoff/. */
function readBakeoffFile(rel: string): Uint8Array | null {
  let root: string;
  try {
    root = realpathSync(BAKEOFF_ROOT);
  } catch {
    return null;
  }
  const bytes = readContainedFile(abs(rel), (real) => {
    const inside = path.relative(root, real);
    return inside !== '' && !inside.startsWith('..') && !path.isAbsolute(inside);
  });
  return bytes ? new Uint8Array(bytes) : null;
}

/** JSON parsed from a file, or null when it is absent or unreadable (no exists-then-read window). */
function readJsonOrNull<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function passagesWanted(corpus: NarrationCorpus): CorpusPassage[] {
  const wanted = opt('passages')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!wanted) return corpus.passages;
  return wanted.map((id) => {
    const p = corpus.passages.find((x) => x.id === id);
    if (!p) throw new NarrationContractError(`unknown passage ${JSON.stringify(id)} (known: ${corpus.passages.map((x) => x.id).join(', ')})`);
    return p;
  });
}

/** The bakeoff bindings must track the canonical identity; a mismatch means one of the two moved without the other. */
function assertIdentityTracked(config: NarrationProvidersConfig, pipeline: PipelineConfig): void {
  if (config.voiceIdentity !== pipeline.voice.id) throw new NarrationContractError(`config/narration-providers.json binds voice identity ${config.voiceIdentity}, but config/voice-identity.json is ${pipeline.voice.id}`);
}

/** A provider whose declared accent is not the identity's: allowed for development and fallback roles, always said out loud. */
function accentDeviation(config: NarrationProvidersConfig, provider: NarrationProviderId, pipeline: PipelineConfig): { declared: string; identity: string; matches: boolean } {
  const declared = config.providers[provider].accent;
  const identity = pipeline.voice.direction.language;
  return { declared, identity, matches: declared === identity };
}

function readCandidates(config: NarrationProvidersConfig, pipeline: PipelineConfig, corpus: NarrationCorpus, filter: { provider?: string; variant?: string } = {}): Candidate[] {
  assertIdentityTracked(config, pipeline);
  const current = { voiceIdentityId: pipeline.voice.id, corpusId: corpus.id, corpusVersion: corpus.version };
  const out: Candidate[] = [];
  let providers: string[];
  try {
    providers = readdirSync(BAKEOFF_ROOT);
  } catch {
    return out;
  }
  for (const provider of providers) {
    if (!isNarrationProviderId(provider) || (filter.provider && provider !== filter.provider)) continue;
    for (const variant of readdirSync(path.join(BAKEOFF_ROOT, provider))) {
      if (!PLAIN_ID.test(variant) || (filter.variant && variant !== filter.variant)) continue;
      const dir = candidateDir(provider, variant);
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.artifact.json')) continue;
        const artifact = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as NarrationArtifact;
        const errors = validateNarrationArtifact(artifact, process.env);
        if (errors.length) throw new NarrationContractError(`${provider}/${variant}/${file}: ${errors.join('; ')}`);
        if (artifact.provider !== provider || artifact.variant !== variant) throw new NarrationContractError(`${provider}/${variant}/${file}: the record names another provider or variant`);
        const stale = staleFor(artifact, current);
        if (stale) throw new NarrationContractError(`${provider}/${variant}/${file}: ${stale}; re-synthesize it (stale narration is never re-labelled)`);
        const wav = readBakeoffFile(artifact.audio.path);
        if (!wav) throw new NarrationContractError(`${artifact.audio.path} is missing`);
        if (sha256Hex(wav) !== artifact.audio.sha256) throw new NarrationContractError(`${artifact.audio.path} no longer matches its record (stale narration)`);
        out.push({ provider, variant, passageId: artifact.text.passageId, dir, artifact });
      }
    }
  }
  if (!config.providers) throw new NarrationContractError('provider config is missing');
  return out.sort((a, b) => a.provider.localeCompare(b.provider) || a.variant.localeCompare(b.variant) || a.passageId.localeCompare(b.passageId));
}

function writeCandidate(provider: NarrationProvider, variant: string, request: NarrationRequest, corpus: NarrationCorpus, result: SynthesisResult, synthesis: NarrationArtifact['synthesis']): { artifact: NarrationArtifact; metrics: AudioMetrics } {
  const dir = candidateDir(provider.id, variant);
  mkdirSync(dir, { recursive: true });
  const audioPath = relAudio(provider.id, variant, request.passageId);
  const artifact = buildNarrationArtifact({ request, corpus: { id: corpus.id, version: corpus.version }, provider: provider.id, variant, synthesis, result, audioPath, generatedAt: new Date().toISOString() });
  writeFileSync(abs(audioPath), result.wav);
  writeFileSync(path.join(dir, `${request.passageId}.artifact.json`), prettyJson(artifact));
  const metrics = measure(result.wav);
  writeFileSync(path.join(dir, `${request.passageId}.metrics.json`), prettyJson({ schema: 'walletwall.narration-metrics/v1', identity: artifact.identity, audioSha256: artifact.audio.sha256, metrics }));
  return { artifact, metrics };
}

const fmt = (n: number, d = 1): string => n.toFixed(d);

async function synthesize(): Promise<void> {
  const config = loadProvidersConfig();
  const pipeline = loadPipelineConfig();
  const corpus = loadCorpus();
  const provider = providerFor(opt('provider'), config);
  const variant = opt('variant');
  if (!variant) throw new NarrationContractError(`--variant is required (known: ${variantNames(config, provider.id).join(', ')})`);
  const settings = variantSettings(config, provider, variant);
  const repeat = Number(opt('repeat') ?? '1');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new NarrationContractError('--repeat must be 1..5');
  assertIdentityTracked(config, pipeline);
  log(`${provider.id} / ${variant}: ${JSON.stringify(settings)}`);
  const accent = accentDeviation(config, provider.id, pipeline);
  if (!accent.matches) log(`${provider.id}: speaks ${accent.declared}; the identity ${pipeline.voice.id} asks for ${accent.identity} (recorded as a deviation; this provider cannot honour the direction)`);
  for (const passage of passagesWanted(corpus)) {
    const request = passageRequest(passage, pipeline);
    const workDir = path.join(candidateDir(provider.id, variant), 'work');
    const runs: SynthesisResult[] = [];
    for (let k = 1; k <= repeat; k++) runs.push(await provider.synthesize(request, settings, { workDir, env: process.env }));
    const primary = runs[0]!;
    const { artifact, metrics } = writeCandidate(provider, variant, request, corpus, primary, 'adapter');
    const perf = primary.performance;
    const rtf = perf ? perf.wallMs / artifact.audio.durationMs : null;
    log(`${passage.id}: ${fmt(artifact.audio.durationMs / 1000)} s @ ${artifact.audio.sampleRate} Hz, est ${fmt(estimateSpokenMs(request.spokenText, pipeline.voice.pacing) / 1000)} s, peak ${fmt(metrics.peakDbfs)} dBFS, ${metrics.integratedLufs === null ? 'n/a' : fmt(metrics.integratedLufs)} LUFS, clipped ${metrics.clipping.samples}, pauses ${metrics.silence.pauses.count}${perf ? `, wall ${fmt(perf.wallMs / 1000)} s (RTF ${fmt(rtf!, 2)})` : ''}${perf?.vramPeakMiB != null ? `, VRAM +${perf.vramPeakMiB} MiB` : ''}, sha ${artifact.audio.sha256.slice(0, 12)}, identity ${artifact.identity.slice(0, 12)}`);
    if (repeat > 1) {
      const shas = runs.map((r) => sha256Hex(r.wav));
      runs.slice(1).forEach((r, i) => writeFileSync(path.join(candidateDir(provider.id, variant), `${passage.id}.repeat${i + 2}.wav`), r.wav));
      const identical = shas.every((s) => s === shas[0]);
      writeFileSync(path.join(candidateDir(provider.id, variant), `${passage.id}.determinism.json`), prettyJson({ schema: 'walletwall.narration-determinism/v1', identity: artifact.identity, repeats: repeat, sha256: shas, identical, wallMs: runs.map((r) => r.performance?.wallMs ?? null) }));
      log(`${passage.id}: ${repeat} runs ${identical ? 'IDENTICAL' : 'DIFFER'} (${shas.map((s) => s.slice(0, 8)).join(' ')})`);
    }
  }
}

async function place(): Promise<void> {
  const config = loadProvidersConfig();
  const pipeline = loadPipelineConfig();
  const corpus = loadCorpus();
  const provider = providerFor(opt('provider'), config);
  if (!(provider instanceof ElevenLabsProvider)) throw new NarrationContractError('only reference audio from the external provider can be placed; local providers are always run by their adapter');
  const variant = opt('variant');
  const file = opt('file');
  const passageId = opt('passage');
  if (!variant || !file || !passageId) throw new NarrationContractError('--variant, --passage and --file are required');
  const settings = variantSettings(config, provider, variant);
  assertIdentityTracked(config, pipeline);
  const passage = corpus.passages.find((p) => p.id === passageId);
  if (!passage) throw new NarrationContractError(`unknown passage ${passageId}`);
  if (!file.toLowerCase().endsWith('.wav')) throw new NarrationContractError('the placed file must be a .wav (raw provider output, no transcoding)');
  const wav = new Uint8Array(readFileSync(file));
  const info = parseWav(wav);
  const result: SynthesisResult = {
    wav,
    modelId: String(settings.modelId),
    modelVersion: 'hosted',
    modelContent: {},
    voiceId: provider.voiceId(process.env),
    settings,
    seed: typeof settings.seed === 'number' ? settings.seed : null,
    runtime: { name: 'elevenlabs-external', version: 'placed', device: 'remote' },
    performance: null,
  };
  const { artifact, metrics } = writeCandidate(provider, variant, passageRequest(passage, pipeline), corpus, result, 'external');
  log(`placed ${passage.id}: ${fmt(info.durationMs / 1000)} s @ ${info.sampleRate} Hz, ${info.channels} ch, peak ${fmt(metrics.peakDbfs)} dBFS, sha ${artifact.audio.sha256.slice(0, 12)}, identity ${artifact.identity.slice(0, 12)} (declared settings: ${variant})`);
}

async function nemoSpeechFor(config: NarrationProvidersConfig): Promise<{ exe: string; version: string }> {
  const asr = config.diagnostics.asr;
  const exe = resolveExecutable(process.env[asr.binaryEnv], 'nemo-speech');
  if (!exe) throw new NarrationContractError(`no nemo-speech runtime: set ${asr.binaryEnv}`);
  const out = await probeVersion(runChild, exe, ['--version'], VIDEO_ROOT, minimalEnv());
  const version = /^nemo-speech (\d+\.\d+\.\d+)/.exec(out ?? '')?.[1];
  if (version !== asr.runtime.version) throw new NarrationContractError(`nemo-speech is ${version ?? '?'}; config pins ${asr.runtime.version}`);
  return { exe, version };
}

function asrModel(config: NarrationProvidersConfig): string {
  const asr = config.diagnostics.asr;
  const gguf = pinnedPath(nemoModelDir(asr.modelDirEnv, process.env), asr.model);
  const bytes = readContainedFile(gguf, () => true);
  if (!bytes) throw new NarrationContractError(`the ASR model is not in the model cache: run "nemo-speech pull parakeet-tdt"`);
  const sha = sha256Hex(bytes);
  if (sha !== asr.model.sha256) throw new NarrationContractError(`ASR model content drifted from the pin (${sha.slice(0, 12)})`);
  return gguf;
}

async function transcribe(): Promise<void> {
  const config = loadProvidersConfig();
  const pipeline = loadPipelineConfig();
  const corpus = loadCorpus();
  const device = opt('device') ?? 'cuda';
  if (device !== 'cuda' && device !== 'cpu') throw new NarrationContractError('--device must be cuda or cpu');
  const runtime = await nemoSpeechFor(config);
  const gguf = asrModel(config);
  const asr = config.diagnostics.asr;
  const candidates = readCandidates(config, pipeline, corpus, { provider: opt('provider'), variant: opt('variant') });
  if (!candidates.length) throw new NarrationContractError('nothing to transcribe: synthesize first');
  for (const c of candidates) {
    const passage = corpus.passages.find((p) => p.id === c.passageId);
    if (!passage) throw new NarrationContractError(`${c.provider}/${c.variant}: unknown passage ${c.passageId}`);
    const request = passageRequest(passage, pipeline);
    if (sha256Hex(request.spokenText) !== c.artifact.text.spokenSha256) throw new NarrationContractError(`${c.provider}/${c.variant}/${c.passageId}: the corpus text changed since this audio was made (stale narration)`);
    const out = path.join(c.dir, `${c.passageId}.asr.json`);
    const r = await runChild(runtime.exe, ['transcribe', abs(c.artifact.audio.path), '--model', gguf, '--device', device, '--format', 'json', '--output', out, '--force', '--quiet'], { cwd: c.dir, env: minimalEnv({ [asr.modelDirEnv]: nemoModelDir(asr.modelDirEnv, process.env) }), timeoutMs: 30 * 60_000, sampleVram: false });
    const parsed = r.status === 0 ? readJsonOrNull<{ text?: string; words?: { word: string }[] }>(out) : null;
    if (!parsed) throw new NarrationContractError(`transcribe ${c.provider}/${c.variant}/${c.passageId} failed: ${r.stderr.trim().slice(-400)}`);
    const text = typeof parsed.text === 'string' ? parsed.text : (parsed.words ?? []).map((w) => w.word).join(' ');
    const diff: TranscriptDiff = compareTranscript(request.spokenText, text);
    writeFileSync(path.join(c.dir, `${c.passageId}.transcript.json`), prettyJson({
      schema: 'walletwall.narration-transcript/v1',
      identity: c.artifact.identity,
      audioSha256: c.artifact.audio.sha256,
      asr: { model: asr.model.repo, revision: asr.model.revision, file: asr.model.file, sha256: asr.model.sha256, runtime: { name: asr.runtime.name, version: runtime.version }, device },
      text,
      diff,
    }));
    log(`${c.provider}/${c.variant}/${c.passageId}: WER ${fmt(diff.wordErrorRate * 100)}% (${diff.substitutions}S ${diff.deletions}D ${diff.insertions}I of ${diff.referenceWords})${diff.missing.length ? `, missing: ${diff.missing.join(' ')}` : ''}${diff.extra.length ? `, extra: ${diff.extra.join(' ')}` : ''}${diff.repeatedPhrases.length ? `, repeated: ${diff.repeatedPhrases.join(' | ')}` : ''}`);
  }
}

const CRITERIA: readonly [string, string, string][] = [
  ['naturalness', 'Naturalness', 'A person speaking, not a synthesizer'],
  ['smoothness', 'Smoothness', 'Syllables, phrase joins, consonants and breaths are fluid'],
  ['prosody', 'Prosody', 'Emphasis follows meaning'],
  ['pacing', 'Pacing', 'Neither rushed nor artificial dead space'],
  ['pauses', 'Pause quality', 'Commas, colons, sentence ends and lists feel authored'],
  ['pronunciation', 'Technical pronunciation', 'WalletWall, WalletWallaby, stablecoin, provenance, BigQuery, deterministic, on-chain'],
  ['stability', 'Long-form stability', 'Character and cadence stay coherent to the end'],
  ['fit', 'Wallaby fit', 'An experienced expedition guide through technical terrain'],
  ['fatigue', 'Listening fatigue', 'Would stay pleasant through a 5-10 minute deep dive'],
  ['defects', 'Artifact defects', '5 = none heard; note clicks, pops, clipping, dropped or duplicated words, hallucinated speech, breaths, pitch jumps'],
];

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function reviewHtml(corpus: NarrationCorpus, lineup: { passage: CorpusPassage; letters: string[] }[], targetLufs: number): string {
  const sections = lineup
    .map(({ passage, letters }) => {
      const cards = letters
        .map(
          (L) => `
      <div class="card" data-passage="${passage.id}" data-letter="${L}">
        <h3>Candidate ${L}</h3>
        <div class="players">
          <label>Raw (native output)<audio controls preload="none" src="audio/${passage.id}/${L}.raw.wav"></audio></label>
          <label>Loudness-matched copy (gain only, ${targetLufs} LUFS)<audio controls preload="none" src="audio/${passage.id}/${L}.matched.wav"></audio></label>
        </div>
        <table class="ratings">
          ${CRITERIA.map(([key, name, hint]) => `<tr><th title="${esc(hint)}">${esc(name)}</th><td>${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${passage.id}.${L}.${key}" value="${n}">${n}</label>`).join('')}</td></tr>`).join('\n          ')}
        </table>
        <textarea name="${passage.id}.${L}.notes" placeholder="What did you hear? Defects, mispronunciations, moments that broke the character."></textarea>
      </div>`,
        )
        .join('\n');
      return `
  <section class="passage" id="${passage.id}">
    <h2>${esc(passage.title)}</h2>
    <p class="text">${esc(passage.text)}</p>
    <div class="cards">${cards}</div>
    <p class="prefer">Preferred for this passage: ${letters.map((L) => `<label><input type="radio" name="${passage.id}.preferred" value="${L}">${L}</label>`).join(' ')} <label><input type="radio" name="${passage.id}.preferred" value="none">none meet the bar</label></p>
  </section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WalletWallaby narration bakeoff: blind listening</title>
<style>
  :root { color-scheme: light dark; --ink: #222; --paper: #fafafa; --line: #cfcfcf; --soft: #f0f0f0; }
  @media (prefers-color-scheme: dark) { :root { --ink: #e6e6e6; --paper: #161616; --line: #3a3a3a; --soft: #222; } }
  body { margin: 0; padding: 24px 16px 64px; font: 15px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); max-width: 1180px; margin-inline: auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .lead { margin: 0 0 20px; opacity: .8; }
  .protocol { border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin-bottom: 28px; background: var(--soft); }
  .protocol ol { margin: 6px 0 0 18px; padding: 0; }
  section.passage { margin-bottom: 40px; border-top: 1px solid var(--line); padding-top: 18px; }
  .text { font-size: 15px; max-width: 70ch; opacity: .9; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .card h3 { margin: 0 0 8px; font-size: 16px; }
  .players label { display: block; font-size: 12px; opacity: .8; margin-bottom: 8px; }
  .players audio { display: block; width: 100%; margin-top: 2px; }
  table.ratings { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
  table.ratings th { text-align: left; font-weight: 500; padding: 3px 4px 3px 0; white-space: nowrap; }
  table.ratings td label { margin-right: 8px; white-space: nowrap; }
  textarea { width: 100%; min-height: 64px; box-sizing: border-box; font: inherit; font-size: 13px; }
  .prefer { margin-top: 12px; }
  .prefer label { margin-right: 10px; }
  .bar { position: sticky; bottom: 0; background: var(--paper); border-top: 1px solid var(--line); padding: 10px 0; display: flex; gap: 12px; align-items: center; }
  button { font: inherit; padding: 6px 12px; }
  .hint { font-size: 12px; opacity: .7; }
</style>
</head>
<body>
<h1>WalletWallaby narration bakeoff: blind listening</h1>
<p class="lead">Corpus ${esc(corpus.id)} v${corpus.version}. Candidates are anonymous letters, shuffled per passage. The mapping is in <code>reveal.json</code> next to this page: open it only after exporting your ratings.</p>
<div class="protocol">
  <strong>Protocol.</strong> Headphones, a quiet room, one passage at a time.
  <ol>
    <li>Listen to the raw copies first. The loudness-matched copies exist only so level differences do not bias you; they change nothing else.</li>
    <li>Rate every criterion 1 (poor) to 5 (publication quality). Write down what you actually heard.</li>
    <li>Pick a preferred candidate per passage, or none. Then click Export: the ratings download as JSON.</li>
    <li>The question that decides it: would you willingly listen to this voice explain a difficult technical topic for ten minutes?</li>
  </ol>
</div>
${sections}
<div class="bar">
  <button id="export">Export ratings (JSON)</button>
  <button id="clear">Clear draft</button>
  <span class="hint" id="status">Draft autosaves in this browser.</span>
</div>
<script>
(function () {
  var KEY = 'walletwallaby-narration-ratings:' + ${JSON.stringify(`${corpus.id}:${corpus.version}`)};
  var status = document.getElementById('status');
  function collect() {
    var out = { schema: 'walletwall.narration-ratings/v1', corpus: ${JSON.stringify({ id: corpus.id, version: corpus.version })}, targetLufs: ${targetLufs}, passages: {} };
    document.querySelectorAll('section.passage').forEach(function (sec) {
      var pid = sec.id; out.passages[pid] = { candidates: {}, preferred: null };
      sec.querySelectorAll('.card').forEach(function (card) {
        var L = card.getAttribute('data-letter'); var r = { notes: card.querySelector('textarea').value };
        card.querySelectorAll('input[type=radio]:checked').forEach(function (i) { r[i.name.split('.').pop()] = Number(i.value); });
        out.passages[pid].candidates[L] = r;
      });
      var pref = sec.querySelector('input[name="' + pid + '.preferred"]:checked'); if (pref) out.passages[pid].preferred = pref.value;
    });
    return out;
  }
  function restore() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!saved) return;
      Object.keys(saved.passages || {}).forEach(function (pid) {
        var p = saved.passages[pid];
        Object.keys(p.candidates || {}).forEach(function (L) {
          var r = p.candidates[L];
          Object.keys(r).forEach(function (k) {
            if (k === 'notes') { var t = document.querySelector('textarea[name="' + pid + '.' + L + '.notes"]'); if (t) t.value = r[k]; return; }
            var i = document.querySelector('input[name="' + pid + '.' + L + '.' + k + '"][value="' + r[k] + '"]'); if (i) i.checked = true;
          });
        });
        if (p.preferred) { var pr = document.querySelector('input[name="' + pid + '.preferred"][value="' + p.preferred + '"]'); if (pr) pr.checked = true; }
      });
    } catch (e) {}
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(collect())); status.textContent = 'Draft saved ' + new Date().toLocaleTimeString() + '.'; } catch (e) {} }
  document.addEventListener('change', save); document.addEventListener('input', save);
  document.getElementById('export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'narration-ratings.json'; a.click();
  });
  document.getElementById('clear').addEventListener('click', function () { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); });
  restore();
})();
</script>
</body>
</html>
`;
}

async function review(): Promise<void> {
  const config = loadProvidersConfig();
  const pipeline = loadPipelineConfig();
  const corpus = loadCorpus();
  const targetLufs = Number(opt('target-lufs') ?? '-20');
  if (!Number.isFinite(targetLufs) || targetLufs > -6 || targetLufs < -40) throw new NarrationContractError('--target-lufs must be between -40 and -6');
  const lineupOpt = opt('lineup')?.split(',').map((s) => s.trim()).filter(Boolean);
  const all = readCandidates(config, pipeline, corpus);
  const chosen = lineupOpt ? all.filter((c) => lineupOpt.includes(`${c.provider}:${c.variant}`)) : all;
  if (!chosen.length) throw new NarrationContractError('no candidates: synthesize or place audio first');
  const results = {
    schema: 'walletwall.narration-bakeoff-results/v2',
    voiceIdentity: { id: pipeline.voice.id, language: pipeline.voice.direction.language, accent: pipeline.voice.direction.accent.variety },
    corpus: { id: corpus.id, version: corpus.version, sha256: corpusSha256(corpus) },
    lineup: [...new Set(chosen.map((c) => `${c.provider}:${c.variant}`))].sort(),
    candidates: chosen.map((c) => {
      const read = <T>(suffix: string): T | null => readJsonOrNull<T>(path.join(c.dir, `${c.passageId}.${suffix}.json`));
      const metrics = read<{ identity: string; metrics: AudioMetrics }>('metrics');
      const transcript = read<{ identity: string; text: string; diff: TranscriptDiff; asr: unknown }>('transcript');
      const determinism = read<{ identity: string; repeats: number; identical: boolean; sha256: string[] }>('determinism');
      const a = c.artifact;
      return {
        provider: c.provider,
        variant: c.variant,
        passageId: c.passageId,
        accent: accentDeviation(config, c.provider, pipeline),
        artifact: { identity: a.identity, synthesis: a.synthesis, audioSha256: a.audio.sha256, durationMs: a.audio.durationMs, sampleRate: a.audio.sampleRate, channels: a.audio.channels, modelId: a.modelId, modelVersion: a.modelVersion, modelContent: a.modelContent, voiceId: a.voiceId, voiceIdentityId: a.voiceIdentityId, seed: a.seed, settings: a.settings, runtime: a.runtime, text: a.text },
        performance: a.performance,
        metrics: metrics && metrics.identity === a.identity ? metrics.metrics : null,
        transcript: transcript && transcript.identity === a.identity ? { text: transcript.text, diff: transcript.diff, asr: transcript.asr } : null,
        determinism: determinism && determinism.identity === a.identity ? { repeats: determinism.repeats, identical: determinism.identical, sha256: determinism.sha256 } : null,
      };
    }),
  };
  mkdirSync(BAKEOFF_ROOT, { recursive: true });
  writeFileSync(path.join(BAKEOFF_ROOT, 'results.json'), prettyJson(results));
  const reviewDir = path.join(BAKEOFF_ROOT, 'review');
  const reveal: Record<string, Record<string, unknown>> = {};
  const lineup: { passage: CorpusPassage; letters: string[] }[] = [];
  for (const passage of corpus.passages) {
    const here = chosen.filter((c) => c.passageId === passage.id);
    if (!here.length) continue;
    // Blind order: by the hash of passage + identity, so letters never follow provider names or generation order.
    const ordered = [...here].sort((x, y) => sha256Hex(`${passage.id}:${x.artifact.identity}`).localeCompare(sha256Hex(`${passage.id}:${y.artifact.identity}`)));
    const dir = path.join(reviewDir, 'audio', passage.id);
    mkdirSync(dir, { recursive: true });
    const letters: string[] = [];
    reveal[passage.id] = {};
    ordered.forEach((c, i) => {
      const L = String.fromCharCode(65 + i);
      letters.push(L);
      const wav = readBakeoffFile(c.artifact.audio.path);
      if (!wav) throw new NarrationContractError(`${c.artifact.audio.path} is missing`);
      writeFileSync(path.join(dir, `${L}.raw.wav`), wav);
      const info = parseWav(wav);
      const samples = decodePcm16Mono(wav, info);
      const m = analyzeAudio(samples, info.sampleRate);
      const current = m.integratedLufs ?? m.rmsDbfs;
      const { gainDb, limited } = loudnessMatchGainDb(current, targetLufs, m.peakDbfs, -1);
      writeFileSync(path.join(dir, `${L}.matched.wav`), encodeWavPcm16(applyGainDb(samples, gainDb), info.sampleRate));
      reveal[passage.id]![L] = { provider: c.provider, variant: c.variant, identity: c.artifact.identity, audio: c.artifact.audio.path, matchedGainDb: Number(gainDb.toFixed(2)), peakLimited: limited };
    });
    lineup.push({ passage, letters });
  }
  writeFileSync(path.join(reviewDir, 'index.html'), reviewHtml(corpus, lineup, targetLufs));
  writeFileSync(path.join(reviewDir, 'reveal.json'), prettyJson({ schema: 'walletwall.narration-reveal/v1', corpus: results.corpus, note: 'Open after rating. Letters are per passage.', passages: reveal }));
  writeFileSync(path.join(reviewDir, 'README.txt'), `Blind listening page for the WalletWallaby narration bakeoff.\n\nOpen index.html in a browser (file:// is fine). Rate, export the JSON, then open reveal.json.\nThe raw copies are the candidates' native output; the matched copies only apply a gain to ${targetLufs} LUFS (peak-limited at -1 dBFS).\n`);
  log(`review page: ${path.relative(VIDEO_ROOT, path.join(reviewDir, 'index.html'))} (${lineup.length} passages, lineup ${results.lineup.join(', ')}); results: ${REL_ROOT}/results.json`);
}

async function doctor(): Promise<void> {
  const config = loadProvidersConfig();
  const pipeline = loadPipelineConfig();
  const corpus = loadCorpus();
  assertIdentityTracked(config, pipeline);
  log(`voice identity ${pipeline.voice.id}: ${pipeline.voice.direction.language} (${pipeline.voice.direction.accent.variety}); providers declare ${(['elevenlabs', 'magpie-nemo-speech', 'chatterbox-multilingual'] as const).map((p) => `${p} ${config.providers[p].accent}`).join(', ')}`);
  log(`corpus ${corpus.id} v${corpus.version} ${corpusSha256(corpus).slice(0, 12)}: ${corpus.passages.map((p) => `${p.id} ~${fmt(estimateSpokenMs(passageRequest(p, pipeline).spokenText, pipeline.voice.pacing) / 1000, 0)} s`).join(', ')}`);
  const el = config.providers.elevenlabs;
  // Only the presence of the credential is reported, as a boolean. Neither its value nor the binding's
  // credential field reaches a log line (the variable's name is in config/narration-providers.json).
  const keyPresent = Object.hasOwn(process.env, el.apiKeyEnv) && (process.env[el.apiKeyEnv]?.length ?? 0) > 0;
  const voiceFromEnv = Object.hasOwn(process.env, el.voiceIdEnv) && (process.env[el.voiceIdEnv]?.length ?? 0) > 0;
  log(`elevenlabs: credential ${keyPresent ? 'present' : 'ABSENT (set the variable named by apiKeyEnv in config, or use "place" for reference audio)'}; voice id from ${voiceFromEnv ? 'the environment' : 'config'}; variants ${variantNames(config, 'elevenlabs').join(', ')}`);
  try {
    const rt = await nemoSpeechFor(config);
    log(`nemo-speech ${rt.version}: ok`);
  } catch (err) {
    log(`nemo-speech: ${(err as Error).message}`);
  }
  const mb = config.providers['magpie-nemo-speech'];
  try {
    const models = resolveMagpieModels(mb, process.env);
    log(`magpie: ${mb.model.version}@${mb.model.revision.slice(0, 12)} verified (${Object.keys(models.modelContent).join(', ')}); variants ${variantNames(config, 'magpie-nemo-speech').join(', ')}`);
  } catch (err) {
    log(`magpie: ${(err as Error).message}`);
    const tok = path.join(path.dirname(pinnedPath(nemoModelDir(mb.modelDirEnv, process.env), mb.model)), mb.model.tokenizerDir);
    try {
      log(`magpie: tokenizer directory content is ${directoryContent(tok).sha256} (pin this if the model was re-pulled deliberately)`);
    } catch {
      // No tokenizer directory to report.
    }
  }
  try {
    asrModel(config);
    log(`asr: ${config.diagnostics.asr.model.repo}@${config.diagnostics.asr.model.revision.slice(0, 12)} verified`);
  } catch (err) {
    log(`asr: ${(err as Error).message}`);
  }
  const cb = config.providers['chatterbox-multilingual'];
  try {
    const python = pythonFor(cb, process.env);
    const r = await runChild(python, ['-I', '-c', 'import importlib.metadata as m, json, torch; print(json.dumps({"chatterbox": m.version("chatterbox-tts"), "torch": torch.__version__, "cuda": torch.cuda.is_available(), "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}))'], { cwd: VIDEO_ROOT, env: minimalEnv({ PYTHONNOUSERSITE: '1' }), timeoutMs: 120_000, sampleVram: false });
    log(`chatterbox: ${r.status === 0 ? r.stdout.trim() : `python failed: ${r.stderr.trim().slice(-300)}`}; package ${cb.package.name} ${cb.package.version} @ ${cb.package.sourceCommit.slice(0, 12)}; model ${cb.model.repo} ${/^[0-9a-f]{40}$/.test(cb.model.revision) ? `pinned ${cb.model.revision.slice(0, 12)}` : 'NOT PINNED (run "pull chatterbox")'}; variants ${variantNames(config, 'chatterbox-multilingual').join(', ')}`);
  } catch (err) {
    log(`chatterbox: ${(err as Error).message}`);
  }
}

async function pull(): Promise<void> {
  const config = loadProvidersConfig();
  if (args[1] !== 'chatterbox') throw new NarrationContractError('pull knows: chatterbox (Magpie and Parakeet are pulled with "nemo-speech pull")');
  const cb = config.providers['chatterbox-multilingual'];
  const python = pythonFor(cb, process.env);
  const revision = opt('revision') ?? (/^[0-9a-f]{40}$/.test(cb.model.revision) ? cb.model.revision : 'main');
  if (!/^[A-Za-z0-9._/-]{1,80}$/.test(revision)) throw new NarrationContractError('--revision must be a plain git ref');
  log(`pulling ${cb.model.repo}@${revision} (online; the only network step for this provider)`);
  // A machine behind TLS inspection may need a CA bundle (SSL_CERT_FILE); it is passed through for this online step only.
  const passthrough: Record<string, string> = {};
  for (const k of ['HF_HOME', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) if (process.env[k]) passthrough[k] = process.env[k]!;
  const env = minimalEnv({ HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1', PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...passthrough });
  const r = await runChild(python, ['-I', '-B', path.join(VIDEO_ROOT, ...CHATTERBOX_ENTRY.split('/')), '--pull', '--repo', cb.model.repo, '--revision', revision, '--t3-model', cb.model.t3Model], { cwd: VIDEO_ROOT, env, timeoutMs: 2 * 3600_000, sampleVram: false });
  if (r.status !== 0) throw new NarrationContractError(`pull failed: ${r.stderr.trim().slice(-800)}`);
  console.log(r.stdout.trim());
  log('pin "revision" in config/narration-providers.json to the resolved commit above');
}

const commands: Record<string, () => Promise<void>> = { doctor, pull, synthesize, place, transcribe, review };
const run = command ? commands[command] : undefined;
if (!run) {
  console.error(`usage: node scripts/narration.ts <${Object.keys(commands).join('|')}> [--option=value ...]`);
  process.exit(2);
}
try {
  await run();
} catch (err) {
  console.error(`[narration] ${(err as Error).name}: ${(err as Error).message}`);
  process.exit(1);
}
