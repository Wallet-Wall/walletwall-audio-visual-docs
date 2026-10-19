// Chatterbox Multilingual (Resemble AI, MIT) through an isolated Python
// environment: the local challenger.
//
// The repository hands an interpreter named by WALLETWALL_CHATTERBOX_PYTHON one
// script of its own (tools/chatterbox/synthesize.py) and one job file written
// inside the work directory; the script runs offline against the Hugging Face
// cache (HF_HUB_OFFLINE), loads the pinned checkpoint revision, and refuses to
// proceed if the resolved snapshot is not that revision. No Python, no path,
// and no prompt ever comes from content, and no reference audio is ever passed
// (audioPrompt must be null): the built-in voice is the only voice. Node-only.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VIDEO_ROOT } from '../../config/load.ts';
import { prettyJson } from '../../core/canonical-json.ts';
import { NarrationProviderError, validateSettings, type NarrationProvider, type NarrationRequest, type NarrationSettings, type SettingsSchema, type SynthesisContext, type SynthesisResult } from '../contract.ts';
import { parseWav } from '../wav.ts';
import { minimalEnv, readOutput, runChild } from './child.ts';

export const CHATTERBOX_ENTRY = 'tools/chatterbox/synthesize.py';

export const CHATTERBOX_SCHEMA: SettingsSchema = {
  t3Model: { kind: 'enum', values: ['v3'] },
  languageId: { kind: 'enum', values: ['en'] },
  exaggeration: { kind: 'number', min: 0, max: 1 },
  cfgWeight: { kind: 'number', min: 0, max: 1 },
  temperature: { kind: 'number', min: 0.05, max: 2 },
  repetitionPenalty: { kind: 'number', min: 1, max: 3 },
  minP: { kind: 'number', min: 0, max: 1 },
  topP: { kind: 'number', min: 0, max: 1 },
  seed: { kind: 'number', min: 0, max: 2147483647, integer: true },
  device: { kind: 'enum', values: ['cuda', 'cpu'] },
  /** Reference-audio conditioning is closed: only owned audio could ever be used, and none is. */
  audioPrompt: { kind: 'null' },
  /** Every Chatterbox output carries the Perth watermark; it is declared, not optional. */
  watermark: { kind: 'enum', values: ['perth'] },
};

export interface ChatterboxBinding {
  kind: 'local';
  pythonEnv: string;
  entry: string;
  /** The PyPI name and version, and the upstream commit the environment installed from (the wheel on PyPI lags the V3 API). */
  package: { name: string; version: string; sourceCommit: string };
  /** The checkpoint: a Hugging Face revision plus the sha256 of every file the loader reads at that revision. */
  model: { repo: string; revision: string; t3Model: string; files: Record<string, string> };
  variants: Record<string, unknown>;
}

export const CHATTERBOX_JOB_SCHEMA = 'walletwall.chatterbox-job/v1';

export interface ChatterboxResult {
  schema: 'walletwall.chatterbox-result/v1';
  package: { name: string; version: string; source: { url?: string | null; vcs?: string | null; commit?: string | null; requestedRevision?: string | null } };
  torch: string;
  cuda: string | null;
  device: string;
  deviceName: string;
  repo: string;
  revision: string;
  files: Record<string, string>;
  sampleRate: number;
  loadMs: number;
  generateMs: number;
  maxMemoryMiB: number | null;
  appliedKwargs: string[];
  peakBeforeQuantization: number;
  /** Constant gain (dB, never positive) applied only when the float output exceeded full scale, so int16 quantization does not clip. */
  quantizationGainDb: number;
}

export function chatterboxJob(request: NarrationRequest, s: NarrationSettings, binding: ChatterboxBinding): Record<string, unknown> {
  return {
    schema: CHATTERBOX_JOB_SCHEMA,
    text: request.spokenText,
    languageId: s.languageId,
    t3Model: s.t3Model,
    repo: binding.model.repo,
    revision: binding.model.revision,
    seed: s.seed,
    exaggeration: s.exaggeration,
    cfgWeight: s.cfgWeight,
    temperature: s.temperature,
    repetitionPenalty: s.repetitionPenalty,
    minP: s.minP,
    topP: s.topP,
    device: s.device,
    output: `${request.passageId}.wav`,
    result: `${request.passageId}.result.json`,
  };
}

const PYTHON_NAME = /^python(3(\.\d+)?)?(\.exe)?$/i;

export function pythonFor(binding: ChatterboxBinding, env: SynthesisContext['env']): string {
  const exe = env[binding.pythonEnv]?.trim();
  if (!exe) throw new NarrationProviderError(`${binding.pythonEnv} is not set: point it at the isolated environment's python (tools/chatterbox/README.md)`);
  if (!path.isAbsolute(exe) || !PYTHON_NAME.test(path.basename(exe)) || !existsSync(exe)) throw new NarrationProviderError(`${binding.pythonEnv} must be an absolute path to an existing python executable`);
  return exe;
}

export class ChatterboxProvider implements NarrationProvider {
  readonly id = 'chatterbox-multilingual' as const;
  readonly schema = CHATTERBOX_SCHEMA;
  readonly binding: ChatterboxBinding;

  constructor(binding: ChatterboxBinding) {
    this.binding = binding;
  }

  validateSettings(settings: unknown): NarrationSettings {
    return validateSettings(this.id, this.schema, settings);
  }

  async synthesize(request: NarrationRequest, settings: NarrationSettings, ctx: SynthesisContext): Promise<SynthesisResult> {
    const s = this.validateSettings(settings);
    if (this.binding.entry !== CHATTERBOX_ENTRY) throw new NarrationProviderError(`the Chatterbox entry is fixed to ${CHATTERBOX_ENTRY}`);
    if (!/^[0-9a-f]{40}$/.test(this.binding.model.revision)) throw new NarrationProviderError('the Chatterbox checkpoint revision is not pinned: run "narration pull chatterbox" and pin the commit it reports');
    if (s.t3Model !== this.binding.model.t3Model) throw new NarrationProviderError('t3Model disagrees with the pinned model');
    mkdirSync(ctx.workDir, { recursive: true });
    const python = pythonFor(this.binding, ctx.env);
    const jobFile = path.join(ctx.workDir, `${request.passageId}.job.json`);
    writeFileSync(jobFile, prettyJson(chatterboxJob(request, s, this.binding)));
    const entry = path.join(VIDEO_ROOT, ...CHATTERBOX_ENTRY.split('/'));
    const env = minimalEnv({ HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1', PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...(ctx.env.HF_HOME ? { HF_HOME: ctx.env.HF_HOME } : {}) });
    const r = await (ctx.run ?? runChild)(python, ['-I', '-B', entry, '--job', jobFile], { cwd: ctx.workDir, env, timeoutMs: 60 * 60_000, sampleVram: s.device === 'cuda' });
    if (r.status !== 0) throw new NarrationProviderError(`chatterbox synthesize exited with ${r.status}: ${r.stderr.trim().slice(-800)}`);
    const wav = readOutput(ctx.workDir, `${request.passageId}.wav`);
    const resultBytes = readOutput(ctx.workDir, `${request.passageId}.result.json`);
    if (!wav || !resultBytes) throw new NarrationProviderError('chatterbox exited 0 but wrote no output');
    const result = JSON.parse(new TextDecoder().decode(resultBytes)) as ChatterboxResult;
    if (result.schema !== 'walletwall.chatterbox-result/v1') throw new NarrationProviderError('unexpected chatterbox result schema');
    if (result.repo !== this.binding.model.repo || result.revision !== this.binding.model.revision) throw new NarrationProviderError(`chatterbox loaded ${result.repo}@${result.revision}, not the pinned revision`);
    if (result.package.name !== this.binding.package.name || result.package.version !== this.binding.package.version) throw new NarrationProviderError(`chatterbox package is ${result.package.name} ${result.package.version}; config pins ${this.binding.package.version}`);
    if (result.package.source?.commit !== this.binding.package.sourceCommit) throw new NarrationProviderError(`chatterbox was installed from ${result.package.source?.commit ?? 'an unknown source'}; config pins commit ${this.binding.package.sourceCommit}`);
    for (const [name, sha] of Object.entries(result.files)) if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || !/^[0-9a-f]{64}$/.test(sha)) throw new NarrationProviderError('chatterbox result lists a file that is not a plain name with a sha256');
    const pinned = this.binding.model.files;
    if (!pinned || Object.keys(pinned).length === 0) throw new NarrationProviderError('the Chatterbox checkpoint files are not pinned: run "narration pull chatterbox" and pin the hashes it reports');
    for (const [name, sha] of Object.entries(pinned)) if (result.files[name] !== sha) throw new NarrationProviderError(`chatterbox loaded ${name} with content ${result.files[name]?.slice(0, 12) ?? 'missing'}; config pins ${sha.slice(0, 12)}`);
    for (const name of Object.keys(result.files)) if (!(name in pinned)) throw new NarrationProviderError(`chatterbox loaded ${name}, which the pin does not list`);
    parseWav(wav);
    return {
      wav,
      modelId: this.binding.model.repo,
      modelVersion: `${this.binding.model.t3Model}@${this.binding.model.revision}`,
      modelContent: { ...result.files },
      voiceId: 'built-in',
      settings: s,
      seed: Number(s.seed),
      runtime: { name: `${result.package.name}@${this.binding.package.sourceCommit.slice(0, 12)} / torch ${result.torch}${result.cuda ? ` cuda ${result.cuda}` : ''}`, version: result.package.version, device: result.device },
      performance: { wallMs: r.wallMs, coldStart: true, vramPeakMiB: r.vramPeakMiB ?? result.maxMemoryMiB },
    };
  }
}
