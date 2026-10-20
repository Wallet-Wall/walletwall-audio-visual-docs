// NVIDIA Magpie TTS through the installed NeMo-Speech.cpp runtime: the current
// local baseline.
//
// The runtime is an external native tool, so it is a new execution boundary
// and is only ever started here: a fixed argument list built from validated
// settings (voice names and numbers from a closed schema, never a string from
// content), the text passed through a file this process wrote inside the work
// directory, explicit local model paths whose sha256 must match the pins in
// config/narration-providers.json (so synthesis never pulls from the network
// and a silently updated model is refused), and a minimal environment. Only
// the version and the model hashes are recorded; the executable and model
// locations never leave this process. Node-only.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { readContainedFile } from '../../core/contained-read.ts';
import { contentAddress, sha256Hex } from '../../core/hash.ts';
import { NarrationProviderError, validateSettings, type NarrationProvider, type NarrationRequest, type NarrationSettings, type SettingsSchema, type SynthesisContext, type SynthesisResult } from '../contract.ts';
import { parseWav } from '../wav.ts';
import { minimalEnv, probeVersion, readOutput, resolveExecutable, runChild } from './child.ts';

/** The baked speakers of magpie_tts_multilingual_357m v2607 (its tokenizer's speakers.json). */
export const MAGPIE_VOICES = ['Aria', 'Jason', 'John', 'Leo', 'Sofia'] as const;

export const MAGPIE_SCHEMA: SettingsSchema = {
  voice: { kind: 'enum', values: MAGPIE_VOICES },
  seed: { kind: 'number', min: 0, max: 2147483647, integer: true },
  /** null = the model default for each sampling control. */
  cfgScale: { kind: 'number', min: 0.5, max: 5, nullable: true },
  temperature: { kind: 'number', min: 0.05, max: 1.5, nullable: true },
  topK: { kind: 'number', min: 1, max: 500, integer: true, nullable: true },
  steps: { kind: 'number', min: 1, max: 5000, integer: true, nullable: true },
  device: { kind: 'enum', values: ['cuda', 'cpu'] },
};

export interface PinnedFile {
  repo: string;
  revision: string;
  file: string;
  sha256: string;
}

export interface MagpieBinding {
  kind: 'local';
  role: string;
  /** The variety the baked speakers speak (BCP 47). Magpie has no Australian voice; the deviation is recorded, never hidden. */
  accent: string;
  binaryEnv: string;
  modelDirEnv: string;
  runtime: { name: string; version: string };
  model: PinnedFile & { version: string; tokenizerDir: string; tokenizerSha256: string };
  codec: PinnedFile;
  variants: Record<string, unknown>;
}

const HEX = /^[0-9a-f]{40}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function checkPin(p: PinnedFile, where: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p.repo) || !HEX.test(p.revision) || !SAFE_NAME.test(p.file) || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new NarrationProviderError(`${where}: the model pin must name a repo, a 40-hex revision, a plain file name, and a sha256`);
}

/** The runtime's model cache: the directory named by `modelDirEnv`, else the platform default the runtime uses. */
export function nemoModelDir(modelDirEnv: string, env: SynthesisContext['env']): string {
  const explicit = env[modelDirEnv]?.trim();
  if (explicit) return explicit;
  if (process.platform === 'win32') return path.join(env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? 'C:\\', 'AppData', 'Local'), 'NeMoSpeech', 'models');
  return path.join(env.XDG_CACHE_HOME ?? path.join(env.HOME ?? '/', '.cache'), 'nemo-speech', 'models');
}

export function pinnedPath(modelDir: string, p: PinnedFile): string {
  return path.join(modelDir, ...p.repo.split('/'), p.revision, p.file);
}

/** Hash every file of a directory (one level) into one content address; the file list is part of it. */
export function directoryContent(dir: string): { sha256: string; files: { file: string; sha256: string }[] } {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new NarrationProviderError('the Magpie tokenizer directory is not in the model cache');
  }
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => ({ file: e.name, sha256: sha256Hex(readFileSync(path.join(dir, e.name))) }))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { sha256: contentAddress(files), files };
}

export interface MagpieModels {
  gguf: string;
  codec: string;
  tokenizer: string;
  modelContent: Record<string, string>;
}

/** Locate and verify the pinned model files. Refuses a missing or drifted file; never downloads. */
export function resolveMagpieModels(binding: MagpieBinding, env: SynthesisContext['env']): MagpieModels {
  checkPin(binding.model, 'model');
  checkPin(binding.codec, 'codec');
  if (!SAFE_NAME.test(binding.model.tokenizerDir) || !/^[0-9a-f]{64}$/.test(binding.model.tokenizerSha256)) throw new NarrationProviderError('model.tokenizerDir / tokenizerSha256 must be pinned');
  const dir = nemoModelDir(binding.modelDirEnv, env);
  const gguf = pinnedPath(dir, binding.model);
  const codec = pinnedPath(dir, binding.codec);
  const tokenizer = path.join(path.dirname(gguf), binding.model.tokenizerDir);
  // Each model file is read through one handle: there is no exists-then-read window, and a link is refused.
  const ggufBytes = readContainedFile(gguf, () => true);
  if (!ggufBytes) throw new NarrationProviderError('Magpie GGUF is not in the model cache: run "nemo-speech pull magpie" (the adapter never downloads)');
  const codecBytes = readContainedFile(codec, () => true);
  if (!codecBytes) throw new NarrationProviderError('NanoCodec GGUF is not in the model cache: run "nemo-speech pull magpie" (the adapter never downloads)');
  const ggufSha = sha256Hex(ggufBytes);
  if (ggufSha !== binding.model.sha256) throw new NarrationProviderError(`Magpie GGUF content drifted from the pin (${ggufSha.slice(0, 12)} != ${binding.model.sha256.slice(0, 12)})`);
  const codecSha = sha256Hex(codecBytes);
  if (codecSha !== binding.codec.sha256) throw new NarrationProviderError(`NanoCodec GGUF content drifted from the pin (${codecSha.slice(0, 12)} != ${binding.codec.sha256.slice(0, 12)})`);
  const tok = directoryContent(tokenizer);
  if (tok.sha256 !== binding.model.tokenizerSha256) throw new NarrationProviderError(`Magpie tokenizer content drifted from the pin (${tok.sha256.slice(0, 12)} != ${binding.model.tokenizerSha256.slice(0, 12)})`);
  return { gguf, codec, tokenizer, modelContent: { [binding.model.file]: ggufSha, [binding.codec.file]: codecSha, [`${binding.model.tokenizerDir}/`]: tok.sha256 } };
}

/** The exact argument list for one synthesis. Values come only from validated settings and from paths this process resolved. */
export function magpieArgs(s: NarrationSettings, files: { input: string; output: string; gguf: string; codec: string; tokenizer: string }): string[] {
  const args = [
    'synthesize',
    '--input', files.input,
    '--output', files.output,
    '--format', 'wav',
    '--language', 'en-US',
    '--voice', String(s.voice),
    '--seed', String(s.seed),
    '--device', String(s.device),
    '--magpie-model', files.gguf,
    '--codec-model', files.codec,
    '--tokenizer-dir', files.tokenizer,
    '--force',
    '--quiet',
  ];
  if (s.cfgScale !== null) args.push('--cfg-scale', String(s.cfgScale));
  if (s.temperature !== null) args.push('--temperature', String(s.temperature));
  if (s.topK !== null) args.push('--top-k', String(s.topK));
  if (s.steps !== null) args.push('--steps', String(s.steps));
  return args;
}

export class MagpieProvider implements NarrationProvider {
  readonly id = 'magpie-nemo-speech' as const;
  readonly schema = MAGPIE_SCHEMA;
  readonly binding: MagpieBinding;

  constructor(binding: MagpieBinding) {
    this.binding = binding;
  }

  validateSettings(settings: unknown): NarrationSettings {
    return validateSettings(this.id, this.schema, settings);
  }

  /** The runtime executable, refused unless `--version` reports exactly the pinned version. */
  async findRuntime(ctx: SynthesisContext): Promise<{ exe: string; version: string }> {
    const exe = resolveExecutable(ctx.env[this.binding.binaryEnv], 'nemo-speech');
    if (!exe) throw new NarrationProviderError(`no nemo-speech runtime: set ${this.binding.binaryEnv} to the executable`);
    const out = await probeVersion(ctx.run ?? runChild, exe, ['--version'], ctx.workDir, minimalEnv());
    const version = /^nemo-speech (\d+\.\d+\.\d+)/.exec(out ?? '')?.[1];
    if (version !== this.binding.runtime.version) throw new NarrationProviderError(`nemo-speech is ${version ?? '?'}; config pins ${this.binding.runtime.version}`);
    return { exe, version };
  }

  async synthesize(request: NarrationRequest, settings: NarrationSettings, ctx: SynthesisContext): Promise<SynthesisResult> {
    const s = this.validateSettings(settings);
    mkdirSync(ctx.workDir, { recursive: true });
    const runtime = await this.findRuntime(ctx);
    const models = resolveMagpieModels(this.binding, ctx.env);
    const input = path.join(ctx.workDir, `${request.passageId}.txt`);
    const output = path.join(ctx.workDir, `${request.passageId}.wav`);
    writeFileSync(input, request.spokenText, 'utf8');
    const env = minimalEnv({ [this.binding.modelDirEnv]: nemoModelDir(this.binding.modelDirEnv, ctx.env) });
    const r = await (ctx.run ?? runChild)(runtime.exe, magpieArgs(s, { input, output, ...models }), { cwd: ctx.workDir, env, timeoutMs: 30 * 60_000, sampleVram: s.device === 'cuda' });
    if (r.status !== 0) throw new NarrationProviderError(`nemo-speech synthesize exited with ${r.status}: ${r.stderr.trim().slice(-500)}`);
    const wav = readOutput(ctx.workDir, `${request.passageId}.wav`);
    if (!wav) throw new NarrationProviderError('nemo-speech exited 0 but wrote no output');
    parseWav(wav);
    return {
      wav,
      modelId: this.binding.model.repo,
      modelVersion: `${this.binding.model.version}@${this.binding.model.revision}`,
      modelContent: models.modelContent,
      voiceId: String(s.voice),
      settings: s,
      seed: Number(s.seed),
      runtime: { name: this.binding.runtime.name, version: runtime.version, device: String(s.device) },
      performance: { wallMs: r.wallMs, coldStart: true, vramPeakMiB: r.vramPeakMiB },
    };
  }
}
