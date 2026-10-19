// The narration contract, adapters, and artifact record, with no network, GPU,
// model, or tool: every adapter runs against a stub runner or fetch, and every
// WAV is synthesized in memory.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { BAKEOFF_DIST_PREFIX, buildNarrationArtifact, validateNarrationArtifact, type NarrationArtifact } from '../src/narration/artifact.ts';
import { NarrationContractError, NarrationProviderError, validateSettings, type ChildRunner, type NarrationRequest, type SynthesisResult } from '../src/narration/contract.ts';
import { analyzeAudio, integratedLoudness, loudnessMatchGainDb } from '../src/narration/metrics.ts';
import { ChatterboxProvider, chatterboxJob, type ChatterboxBinding } from '../src/narration/providers/chatterbox.ts';
import { ELEVENLABS_HOST, ElevenLabsProvider, elevenlabsBody, elevenlabsUrl } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig, providerFor, variantSettings } from '../src/narration/providers/index.ts';
import { directoryContent, magpieArgs, MagpieProvider, resolveMagpieModels, type MagpieBinding } from '../src/narration/providers/magpie.ts';
import { compareTranscript, normalizeWords } from '../src/narration/transcript.ts';
import { decodePcm16Mono, encodeWavPcm16, parseWav, WavFormatError, wrapPcm16 } from '../src/narration/wav.ts';
import { config } from './helpers.ts';

const providers = loadProvidersConfig();

const request: NarrationRequest = {
  passageId: 'short-instruction',
  displayText: 'WalletWall checks the evidence.',
  spokenText: 'Wallet Wall checks the evidence.',
  language: 'en-US',
  voiceProfile: 'walletwallaby',
  identity: config.voice,
};

function sine(hz: number, seconds: number, rate: number, amplitude = 0.1): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

const toneWav = (seconds = 0.5, rate = 22050): Uint8Array => encodeWavPcm16(sine(220, seconds, rate), rate);

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'ww-narration-'));
}

/** A stub runner: answers version probes and lets a test decide what the "tool" writes. */
function stubRunner(onRun: (exe: string, args: readonly string[], cwd: string) => number | void, version = 'nemo-speech 0.2.0'): { run: ChildRunner; calls: { exe: string; args: readonly string[]; env: Record<string, string> }[] } {
  const calls: { exe: string; args: readonly string[]; env: Record<string, string> }[] = [];
  const run: ChildRunner = async (exe, args, opts) => {
    calls.push({ exe, args, env: opts.env });
    if (args[0] === '--version') return { status: 0, stdout: `${version}\n`, stderr: '', wallMs: 1, vramPeakMiB: null };
    const status = onRun(exe, args, opts.cwd) ?? 0;
    return { status, stdout: '', stderr: status === 0 ? '' : 'stub failure', wallMs: 5, vramPeakMiB: 123 };
  };
  return { run, calls };
}

describe('wav', () => {
  test('round-trips 16-bit mono PCM and reports the format', () => {
    const wav = toneWav(0.25, 24000);
    const info = parseWav(wav);
    assert.deepEqual({ ...info, dataOffset: undefined, dataLength: undefined }, { sampleRate: 24000, channels: 1, bitsPerSample: 16, frames: 6000, durationMs: 250, dataOffset: undefined, dataLength: undefined });
    const samples = decodePcm16Mono(wav, info);
    assert.equal(samples.length, 6000);
    assert.ok(Math.abs(samples[1]! - 0.1 * Math.sin((2 * Math.PI * 220) / 24000)) < 1e-3);
  });

  test('refuses anything that is not well-formed 16-bit integer PCM', () => {
    const good = toneWav();
    const corrupt = (edit: (b: Uint8Array, v: DataView) => void): Uint8Array => {
      const b = new Uint8Array(good);
      edit(b, new DataView(b.buffer));
      return b;
    };
    const cases: [string, Uint8Array][] = [
      ['not RIFF', corrupt((b) => (b[0] = 0x58))],
      ['float format', corrupt((_b, v) => v.setUint16(20, 3, true))],
      ['8-bit', corrupt((_b, v) => { v.setUint16(34, 8, true); v.setUint16(32, 1, true); v.setUint32(28, 22050, true); })],
      ['24-bit', corrupt((_b, v) => { v.setUint16(34, 24, true); v.setUint16(32, 3, true); v.setUint32(28, 66150, true); })],
      ['three channels', corrupt((_b, v) => { v.setUint16(22, 3, true); v.setUint16(32, 6, true); v.setUint32(28, 132300, true); })],
      ['inconsistent block align', corrupt((_b, v) => v.setUint16(32, 4, true))],
      ['data chunk past the end', corrupt((_b, v) => v.setUint32(40, 1 << 30, true))],
      ['truncated', good.slice(0, 40)],
      ['empty data', wrapPcm16(new Uint8Array(2), 22050, 1).slice(0, 44)],
      ['odd data length', corrupt((_b, v) => v.setUint32(40, 3, true))],
      ['no data chunk', corrupt((b) => b.set([0x4c, 0x49, 0x53, 0x54], 36))],
      ['sample rate out of range', corrupt((_b, v) => { v.setUint32(24, 4000, true); v.setUint32(28, 8000, true); })],
    ];
    for (const [name, bytes] of cases) assert.throws(() => parseWav(bytes), WavFormatError, name);
    assert.throws(() => wrapPcm16(new Uint8Array(3), 22050, 1), WavFormatError, 'odd PCM payload');
    assert.throws(() => wrapPcm16(new Uint8Array(0), 22050, 1), WavFormatError, 'empty PCM payload');
  });

  test('accepts WAVE_FORMAT_EXTENSIBLE only when its sub-format is PCM', () => {
    const pcm = new Uint8Array(400);
    const out = new Uint8Array(12 + 8 + 40 + 8 + pcm.length);
    const v = new DataView(out.buffer);
    const tag = (at: number, s: string) => s.split('').forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
    tag(0, 'RIFF'); v.setUint32(4, out.length - 8, true); tag(8, 'WAVE');
    tag(12, 'fmt '); v.setUint32(16, 40, true); v.setUint16(20, 0xfffe, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    v.setUint16(36, 22, true); v.setUint16(38, 16, true); v.setUint32(40, 4, true); v.setUint16(44, 1, true);
    tag(60, 'data'); v.setUint32(64, pcm.length, true);
    assert.equal(parseWav(out).sampleRate, 16000);
    v.setUint16(44, 3, true);
    assert.throws(() => parseWav(out), WavFormatError, 'extensible float');
  });
});

describe('settings schema', () => {
  const schema = { voice: { kind: 'enum', values: ['Jason', 'Leo'] }, seed: { kind: 'number', min: 0, max: 10, integer: true }, cfg: { kind: 'number', min: 0, max: 1, nullable: true }, on: { kind: 'boolean' }, prompt: { kind: 'null' } } as const;
  const ok = { voice: 'Jason', seed: 7, cfg: null, on: true, prompt: null };

  test('accepts a complete, closed, in-range object and returns a frozen copy', () => {
    const v = validateSettings('t', schema, ok);
    assert.deepEqual(v, ok);
    assert.ok(Object.isFrozen(v));
  });

  test('rejects malformed settings: unknown keys, missing keys, free strings, ranges, types, arrays', () => {
    const bad: [string, unknown][] = [
      ['unknown key', { ...ok, extra: 1 }],
      ['missing key', { voice: 'Jason', seed: 7, cfg: null, on: true }],
      ['free string', { ...ok, voice: '../etc' }],
      ['flag injection', { ...ok, voice: '--tts.magpie-model' }],
      ['out of range', { ...ok, seed: 11 }],
      ['non-integer', { ...ok, seed: 1.5 }],
      ['NaN', { ...ok, seed: Number.NaN }],
      ['string number', { ...ok, seed: '7' }],
      ['non-null prompt', { ...ok, prompt: 'clone.wav' }],
      ['non-boolean', { ...ok, on: 'yes' }],
      ['array', [ok]],
      ['null', null],
      ['prototype key', JSON.parse('{"voice":"Jason","seed":7,"cfg":null,"on":true,"prompt":null,"constructor":1}')],
    ];
    for (const [name, value] of bad) assert.throws(() => validateSettings('t', schema, value), NarrationContractError, name);
  });
});

describe('provider registry', () => {
  test('unknown providers and unknown variants are rejected', () => {
    for (const id of ['openai', 'ElevenLabs', '', null, undefined, 'elevenlabs/../x']) assert.throws(() => providerFor(id, providers), NarrationContractError, String(id));
    const magpie = providerFor('magpie-nemo-speech', providers);
    assert.throws(() => variantSettings(providers, magpie, 'nope'), NarrationContractError);
    assert.throws(() => variantSettings(providers, magpie, '__proto__'), NarrationContractError);
  });

  test('every committed variant validates against its adapter schema', () => {
    for (const id of ['elevenlabs', 'magpie-nemo-speech', 'chatterbox-multilingual'] as const) {
      const p = providerFor(id, providers);
      for (const v of Object.keys(providers.providers[id].variants)) assert.ok(Object.keys(variantSettings(providers, p, v)).length > 0, `${id}/${v}`);
    }
  });
});

describe('artifact record', () => {
  const result = (wav: Uint8Array): SynthesisResult => ({
    wav,
    modelId: 'nvidia/magpie_tts_multilingual_357m',
    modelVersion: 'v2607@19806879b16d3f2ccf28fb112b1bcd16a3c7923e',
    modelContent: { 'model.gguf': 'a'.repeat(64) },
    voiceId: 'Jason',
    settings: { voice: 'Jason', seed: 7 },
    seed: 7,
    runtime: { name: 'nemo-speech', version: '0.2.0', device: 'cuda' },
    performance: { wallMs: 1200, coldStart: true, vramPeakMiB: 900 },
  });
  const build = (wav: Uint8Array, generatedAt: string | null = '2026-10-18T00:00:00.000Z') =>
    buildNarrationArtifact({ request, corpus: { id: 'walletwallaby-narration-eval', version: 1 }, provider: 'magpie-nemo-speech', variant: 'jason', synthesis: 'adapter', result: result(wav), audioPath: `${BAKEOFF_DIST_PREFIX}magpie-nemo-speech/jason/short-instruction.wav`, generatedAt });

  test('the same WAV gives the same identity; the timestamp and measurements sit outside it', () => {
    const wav = toneWav();
    const a = build(wav);
    const b = build(new Uint8Array(wav), '2030-01-01T00:00:00.000Z');
    assert.equal(a.identity, b.identity);
    assert.notEqual(a.generatedAt, b.generatedAt);
    const c = buildNarrationArtifact({ request, corpus: { id: 'walletwallaby-narration-eval', version: 1 }, provider: 'magpie-nemo-speech', variant: 'jason', synthesis: 'adapter', result: { ...result(wav), performance: null }, audioPath: a.audio.path, generatedAt: null });
    assert.equal(c.identity, a.identity);
    assert.notEqual(build(toneWav(0.6)).identity, a.identity, 'different bytes, different identity');
    assert.deepEqual(validateNarrationArtifact(a, {}), []);
  });

  test('text and audio hashes are exact sha256 digests', () => {
    const wav = toneWav();
    const a = build(wav);
    assert.equal(a.audio.sha256, createHash('sha256').update(wav).digest('hex'));
    assert.equal(a.text.spokenSha256, createHash('sha256').update('Wallet Wall checks the evidence.').digest('hex'));
    assert.equal(a.text.displaySha256, sha256Hex('WalletWall checks the evidence.'));
    assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(a.identity, contentAddress({ ...a, identity: undefined, generatedAt: undefined, performance: undefined }));
  });

  test('unknown fields fail closed, at the top level and nested', () => {
    const a = build(toneWav());
    assert.ok(validateNarrationArtifact({ ...a, extra: 1 }, {}).some((e) => e.includes('unknown field "extra"')));
    assert.ok(validateNarrationArtifact({ ...a, audio: { ...a.audio, codec: 'mp3' } }, {}).some((e) => e.includes('audio: unknown field')));
    assert.ok(validateNarrationArtifact({ ...a, text: { ...a.text, prompt: 'x' } }, {}).some((e) => e.includes('text: unknown field')));
    assert.ok(validateNarrationArtifact({ ...a, runtime: { ...a.runtime, path: 'x' } }, {}).some((e) => e.includes('runtime: unknown field')));
    const { seed: _seed, ...missing } = a;
    assert.ok(validateNarrationArtifact(missing, {}).some((e) => e.includes('missing field "seed"')));
  });

  test('a changed model, voice, settings, seed, text, or bytes changes the identity (and a stale identity is refused)', () => {
    const a = build(toneWav());
    for (const mutate of [
      (x: NarrationArtifact) => ({ ...x, modelVersion: 'v2602@19806879b16d3f2ccf28fb112b1bcd16a3c7923e' }),
      (x: NarrationArtifact) => ({ ...x, modelContent: { 'model.gguf': 'b'.repeat(64) } }),
      (x: NarrationArtifact) => ({ ...x, voiceId: 'Leo' }),
      (x: NarrationArtifact) => ({ ...x, settings: { ...x.settings, seed: 8 } }),
      (x: NarrationArtifact) => ({ ...x, seed: 8 }),
      (x: NarrationArtifact) => ({ ...x, text: { ...x.text, spokenSha256: 'c'.repeat(64) } }),
      (x: NarrationArtifact) => ({ ...x, audio: { ...x.audio, sha256: 'd'.repeat(64) } }),
    ]) {
      const m = mutate(a);
      assert.ok(validateNarrationArtifact(m, {}).some((e) => e.includes('identity does not match')), 'the old identity no longer validates');
    }
  });

  test('paths outside the bakeoff output, backslashes, drive letters, and home paths are refused', () => {
    const a = build(toneWav());
    for (const p of ['dist/other/x.wav', 'dist/narration-bakeoff/../x.wav', 'C:/dev/x.wav', 'dist\\narration-bakeoff\\x.wav', '/dist/narration-bakeoff/x.wav', 'dist/narration-bakeoff/x.mp3', 'dist/narration-bakeoff/.hidden/x.wav']) {
      assert.ok(validateNarrationArtifact({ ...a, audio: { ...a.audio, path: p } }, {}).length > 0, p);
      assert.throws(() => buildNarrationArtifact({ request, corpus: { id: 'c', version: 1 }, provider: 'magpie-nemo-speech', variant: 'jason', synthesis: 'adapter', result: result(toneWav()), audioPath: p, generatedAt: null }), NarrationContractError, p);
    }
    for (const leak of ['C:\\Users\\someone\\model.gguf', '/Users/someone/model.gguf', '/home/someone/model.gguf', 'D:/models/x']) {
      assert.ok(validateNarrationArtifact({ ...a, modelContent: { [leak]: 'a'.repeat(64) } }, {}).some((e) => e.includes('local path leaks')), leak);
      assert.ok(validateNarrationArtifact({ ...a, runtime: { ...a.runtime, name: leak } }, {}).some((e) => e.includes('local path leaks')), leak);
    }
  });

  test('a credential-shaped environment value never survives serialization (positive control)', () => {
    const a = build(toneWav());
    const env = { ELEVENLABS_API_KEY: 'test-key-not-real-0123456789abcdef', HOME: '/home/x', SHORT_KEY: 'abc' };
    assert.deepEqual(validateNarrationArtifact(a, env), []);
    assert.ok(validateNarrationArtifact({ ...a, settings: { ...a.settings, note: env.ELEVENLABS_API_KEY } }, env).some((e) => e.includes('ELEVENLABS_API_KEY appears')));
    assert.ok(validateNarrationArtifact({ ...a, modelVersion: `hosted ${env.ELEVENLABS_API_KEY}` }, env).some((e) => e.includes('ELEVENLABS_API_KEY appears')));
  });

  test('a malformed WAV never becomes an artifact', () => {
    assert.throws(() => build(new Uint8Array([1, 2, 3])), WavFormatError);
    assert.throws(() => build(toneWav().slice(0, 50)), WavFormatError);
  });
});

describe('elevenlabs reference adapter', () => {
  const provider = providerFor('elevenlabs', providers) as ElevenLabsProvider;
  const settings = variantSettings(providers, provider, 'reference');
  const key = 'test-key-not-real-0123456789abcdef';

  test('the endpoint host is fixed and the voice id cannot carry a path', () => {
    assert.equal(elevenlabsUrl('DTLT09E2cxHF0DqjKVbc', 'pcm_44100').host, ELEVENLABS_HOST);
    assert.equal(elevenlabsUrl('DTLT09E2cxHF0DqjKVbc', 'pcm_44100').pathname, '/v1/text-to-speech/DTLT09E2cxHF0DqjKVbc');
    for (const bad of ['../voices', 'a/b', 'x?y=1', 'DTLT09E2cxHF0DqjKVbc#frag', '']) assert.throws(() => elevenlabsUrl(bad, 'pcm_44100'), NarrationProviderError, bad);
    assert.throws(() => elevenlabsUrl('DTLT09E2cxHF0DqjKVbc', 'mp3_44100_128'), NarrationProviderError);
    assert.throws(() => provider.voiceId({ WALLETWALLABY_ELEVENLABS_VOICE_ID: '../x' }), NarrationProviderError);
    assert.equal(provider.voiceId({}), 'DTLT09E2cxHF0DqjKVbc');
    assert.equal(provider.voiceId({ WALLETWALLABY_ELEVENLABS_VOICE_ID: 'OtherVoice123' }), 'OtherVoice123');
  });

  test('sends only contract fields, wraps the PCM in a WAV, and keeps the key out of the result', async () => {
    const pcm = new Uint8Array(44100 * 2);
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetchStub = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(pcm, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await provider.synthesize(request, settings, { workDir: tmpdir(), env: { ELEVENLABS_API_KEY: key }, fetch: fetchStub });
    assert.equal(calls.length, 1);
    const seen = calls[0]!;
    assert.equal(new URL(seen.url).host, ELEVENLABS_HOST);
    assert.equal(seen.headers['xi-api-key'], key);
    assert.deepEqual(seen.body, elevenlabsBody(request, settings));
    assert.deepEqual(Object.keys(seen.body).sort(), ['apply_text_normalization', 'model_id', 'seed', 'text', 'voice_settings']);
    const info = parseWav(r.wav);
    assert.equal(info.sampleRate, 44100);
    assert.equal(info.frames, 44100);
    assert.equal(r.modelContent && Object.keys(r.modelContent).length, 0, 'a hosted model has no content identity');
    const artifact = buildNarrationArtifact({ request, corpus: { id: 'c', version: 1 }, provider: 'elevenlabs', variant: 'reference', synthesis: 'adapter', result: r, audioPath: `${BAKEOFF_DIST_PREFIX}elevenlabs/reference/short-instruction.wav`, generatedAt: null });
    assert.ok(!JSON.stringify(artifact).includes(key));
    assert.deepEqual(validateNarrationArtifact(artifact, { ELEVENLABS_API_KEY: key }), []);
  });

  test('without a key it refuses and says where the reference audio can be placed; a refusal never echoes the key', async () => {
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env: {} }), (err: Error) => err instanceof NarrationProviderError && /ELEVENLABS_API_KEY/.test(err.message) && /place/.test(err.message));
    const fetchStub = (async () => new Response(`{"detail":"bad key ${key}"}`, { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env: { ELEVENLABS_API_KEY: key }, fetch: fetchStub }), (err: Error) => /HTTP 401/.test(err.message) && !err.message.includes(key));
  });
});

describe('magpie adapter', () => {
  /** A fake model cache whose pins are computed from its own bytes, so the adapter's hash checks are exercised for real. */
  function fakeBinding(): { binding: MagpieBinding; root: string } {
    const root = tmpdir();
    const modelDir = path.join(root, 'nvidia', 'magpie_tts_multilingual_357m', 'a'.repeat(40));
    const codecDir = path.join(root, 'nvidia', 'nemo-nano-codec-22khz-1.89kbps-21.5fps', 'b'.repeat(40));
    mkdirSync(path.join(modelDir, 'tokenizer'), { recursive: true });
    mkdirSync(codecDir, { recursive: true });
    writeFileSync(path.join(modelDir, 'magpie.gguf'), 'magpie-bytes');
    writeFileSync(path.join(modelDir, 'tokenizer', 'speakers.json'), '{"Jason":1}');
    writeFileSync(path.join(codecDir, 'codec.gguf'), 'codec-bytes');
    const binding: MagpieBinding = {
      kind: 'local',
      binaryEnv: 'TEST_NEMO',
      modelDirEnv: 'TEST_NEMO_MODELS',
      runtime: { name: 'nemo-speech', version: '0.2.0' },
      model: { repo: 'nvidia/magpie_tts_multilingual_357m', revision: 'a'.repeat(40), version: 'v2607', file: 'magpie.gguf', sha256: sha256Hex('magpie-bytes'), tokenizerDir: 'tokenizer', tokenizerSha256: directoryContent(path.join(modelDir, 'tokenizer')).sha256 },
      codec: { repo: 'nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps', revision: 'b'.repeat(40), file: 'codec.gguf', sha256: sha256Hex('codec-bytes') },
      variants: {},
    };
    return { binding, root };
  }
  const settings = { voice: 'Jason', seed: 7, cfgScale: 2.5, temperature: null, topK: null, steps: null, device: 'cuda' };
  const exe = path.join(tmpdir(), 'nemo-speech.exe');
  writeFileSync(exe, '');

  test('the argument list holds only fixed flags, validated values, and paths this process resolved', () => {
    const provider = new MagpieProvider(fakeBinding().binding);
    const s = provider.validateSettings(settings);
    const argv = magpieArgs(s, { input: 'in.txt', output: 'out.wav', gguf: 'm.gguf', codec: 'c.gguf', tokenizer: 'tok' });
    assert.deepEqual(argv.slice(0, 3), ['synthesize', '--input', 'in.txt']);
    assert.ok(argv.includes('--voice') && argv[argv.indexOf('--voice') + 1] === 'Jason');
    assert.ok(argv.includes('--cfg-scale') && argv[argv.indexOf('--cfg-scale') + 1] === '2.5');
    assert.ok(!argv.includes('--temperature'), 'null settings are left to the model default');
    assert.ok(!argv.some((a) => /[;&|`$<>]/.test(a)), 'no shell metacharacters');
    for (const bad of [{ ...settings, voice: 'Jason; rm -rf' }, { ...settings, voice: '--tts.magpie-model' }, { ...settings, seed: -1 }, { ...settings, device: 'vulkan:0' }, { ...settings, model: 'x' }]) assert.throws(() => provider.validateSettings(bad), NarrationContractError);
  });

  test('model files are verified against the pins; a drifted or missing file is refused and nothing is downloaded', () => {
    const { binding, root } = fakeBinding();
    const env = { TEST_NEMO_MODELS: root };
    const ok = resolveMagpieModels(binding, env);
    assert.deepEqual(Object.keys(ok.modelContent).sort(), ['codec.gguf', 'magpie.gguf', 'tokenizer/']);
    assert.throws(() => resolveMagpieModels({ ...binding, model: { ...binding.model, sha256: 'e'.repeat(64) } }, env), /drifted/);
    writeFileSync(path.join(root, 'nvidia', 'magpie_tts_multilingual_357m', 'a'.repeat(40), 'tokenizer', 'extra.txt'), 'x');
    assert.throws(() => resolveMagpieModels(binding, env), /tokenizer content drifted/);
    assert.throws(() => resolveMagpieModels(binding, { TEST_NEMO_MODELS: tmpdir() }), /not in the model cache/);
    assert.throws(() => resolveMagpieModels({ ...binding, model: { ...binding.model, file: '../../escape.gguf' } }, env), NarrationProviderError);
  });

  test('a run that writes no output, or an invalid WAV, is rejected; a valid WAV is accepted with its hashes', async () => {
    const { binding, root } = fakeBinding();
    const provider = new MagpieProvider(binding);
    const env = { TEST_NEMO: exe, TEST_NEMO_MODELS: root };
    const outputOf = (args: readonly string[]) => args[args.indexOf('--output') + 1]!;
    const nothing = stubRunner(() => 0);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: nothing.run }), /wrote no output/);
    const failing = stubRunner(() => 3);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: failing.run }), /exited with 3/);
    const garbage = stubRunner((_exe, args) => void writeFileSync(outputOf(args), 'RIFF garbage'));
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: garbage.run }), WavFormatError);
    const wav = toneWav(0.3);
    const good = stubRunner((_exe, args) => void writeFileSync(outputOf(args), wav));
    const r = await provider.synthesize(request, settings, { workDir: tmpdir(), env, run: good.run });
    assert.equal(sha256Hex(r.wav), sha256Hex(wav));
    assert.equal(r.voiceId, 'Jason');
    assert.equal(r.seed, 7);
    assert.equal(r.modelVersion, `v2607@${'a'.repeat(40)}`);
    assert.equal(r.performance?.vramPeakMiB, 123);
    const call = good.calls.find((c) => c.args[0] === 'synthesize')!;
    assert.equal(call.exe, exe);
    assert.equal(readFileSync(call.args[call.args.indexOf('--input') + 1]!, 'utf8'), request.spokenText, 'the text goes through a file, never an argument');
    assert.ok(!('ELEVENLABS_API_KEY' in call.env) && !('USERNAME' in call.env), 'minimal child environment');
    const wrongVersion = stubRunner(() => 0, 'nemo-speech 0.3.0');
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: wrongVersion.run }), /config pins 0\.2\.0/);
  });
});

describe('chatterbox adapter', () => {
  const python = path.join(tmpdir(), 'python.exe');
  writeFileSync(python, '');
  const binding: ChatterboxBinding = {
    kind: 'local',
    pythonEnv: 'TEST_CB_PYTHON',
    entry: 'tools/chatterbox/synthesize.py',
    package: { name: 'chatterbox-tts', version: '0.1.7', sourceCommit: '5de7a54aa4e5e2baadb0182dde554908b48b85c2' },
    model: { repo: 'ResembleAI/chatterbox', revision: 'f'.repeat(40), t3Model: 'v3', files: { 'conds.pt': 'a'.repeat(64) } },
    variants: {},
  };
  const settings = { t3Model: 'v3', languageId: 'en', exaggeration: 0.5, cfgWeight: 0.5, temperature: 0.8, repetitionPenalty: 1.2, minP: 0.05, topP: 1, seed: 7, device: 'cuda', audioPrompt: null, watermark: 'perth' };
  const result = (overrides: Record<string, unknown> = {}) => ({
    schema: 'walletwall.chatterbox-result/v1',
    package: { name: 'chatterbox-tts', version: '0.1.7', source: { commit: binding.package.sourceCommit } },
    torch: '2.11.0+cu128',
    cuda: '12.8',
    device: 'cuda',
    deviceName: 'GPU',
    repo: binding.model.repo,
    revision: binding.model.revision,
    files: { 'conds.pt': 'a'.repeat(64) },
    sampleRate: 24000,
    loadMs: 10,
    generateMs: 20,
    maxMemoryMiB: 2000,
    appliedKwargs: ['cfg_weight'],
    peakBeforeQuantization: 0.5,
    ...overrides,
  });

  test('reference-audio conditioning is closed and an unpinned checkpoint never runs', async () => {
    const provider = new ChatterboxProvider(binding);
    assert.throws(() => provider.validateSettings({ ...settings, audioPrompt: 'owned.wav' }), NarrationContractError);
    assert.throws(() => provider.validateSettings({ ...settings, t3Model: 'v2' }), NarrationContractError);
    assert.throws(() => provider.validateSettings({ ...settings, watermark: 'none' }), NarrationContractError);
    const unpinned = new ChatterboxProvider({ ...binding, model: { ...binding.model, revision: 'main' } });
    const runner = stubRunner(() => 0);
    await assert.rejects(unpinned.synthesize(request, settings, { workDir: tmpdir(), env: { TEST_CB_PYTHON: python }, run: runner.run }), /not pinned/);
    assert.equal(runner.calls.length, 0, 'nothing was started');
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env: {}, run: runner.run }), /TEST_CB_PYTHON is not set/);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env: { TEST_CB_PYTHON: 'python' }, run: runner.run }), /absolute path/);
    const job = chatterboxJob(request, provider.validateSettings(settings), binding);
    assert.equal(job.text, request.spokenText);
    assert.ok(!('audioPrompt' in job), 'no conditioning field at all');
    for (const v of Object.values(job)) if (typeof v === 'string' && v !== request.spokenText) assert.ok(!/^[A-Za-z]:|\\|\.\.|^\//.test(v), `the job carries no path: ${v}`);
    assert.equal(job.output, 'short-instruction.wav', 'outputs are plain names resolved by the script inside the job directory');
  });

  test('the result must name the pinned revision, package, and commit; the output must be a valid WAV', async () => {
    const provider = new ChatterboxProvider(binding);
    const env = { TEST_CB_PYTHON: python };
    const write = (dir: string, res: object, wav: Uint8Array | null) => {
      writeFileSync(path.join(dir, 'short-instruction.result.json'), JSON.stringify(res));
      if (wav) writeFileSync(path.join(dir, 'short-instruction.wav'), wav);
    };
    const expectRun = (res: object, wav: Uint8Array | null) => stubRunner((exe, args, cwd) => {
      assert.equal(exe, python);
      assert.deepEqual(args.slice(0, 2), ['-I', '-B']);
      assert.ok(args[2]!.endsWith(path.join('tools', 'chatterbox', 'synthesize.py')));
      write(cwd, res, wav);
    });
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result(), null).run }), /wrote no output/);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result({ revision: 'e'.repeat(40) }), toneWav()).run }), /not the pinned revision/);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result({ package: { name: 'chatterbox-tts', version: '0.1.7', source: { commit: 'deadbeef' } } }), toneWav()).run }), /config pins commit/);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result({ files: { 'C:\\x\\y.pt': 'a'.repeat(64) } }), toneWav()).run }), /plain name/);
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result({ files: { 'conds.pt': 'b'.repeat(64) } }), toneWav()).run }), /config pins/, 'a drifted checkpoint file is refused');
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result({ files: { 'conds.pt': 'a'.repeat(64), 'extra.pt': 'c'.repeat(64) } }), toneWav()).run }), /pin does not list/, 'an unlisted file is refused');
    await assert.rejects(provider.synthesize(request, settings, { workDir: tmpdir(), env, run: expectRun(result(), new Uint8Array([1, 2, 3])).run }), WavFormatError);
    const good = expectRun(result(), toneWav(0.3, 24000));
    const r = await provider.synthesize(request, settings, { workDir: tmpdir(), env, run: good.run });
    assert.equal(parseWav(r.wav).sampleRate, 24000);
    assert.equal(r.voiceId, 'built-in');
    assert.deepEqual(r.modelContent, { 'conds.pt': 'a'.repeat(64) });
    const call = good.calls[0]!;
    assert.equal(call.env.HF_HUB_OFFLINE, '1', 'synthesis is offline');
    assert.equal(call.env.TRANSFORMERS_OFFLINE, '1');
  });
});

describe('metrics', () => {
  test('a 997 Hz sine at -20 dBFS measures -23 dBFS RMS and about -23 LUFS; silence is gated out', () => {
    const rate = 48000;
    const s = sine(997, 3, rate, 0.1);
    const m = analyzeAudio(s, rate);
    assert.ok(Math.abs(m.peakDbfs - -20) < 0.05, `${m.peakDbfs}`);
    assert.ok(Math.abs(m.rmsDbfs - -23.01) < 0.05, `${m.rmsDbfs}`);
    assert.ok(m.integratedLufs !== null && Math.abs(m.integratedLufs - -23.01) < 0.5, `${m.integratedLufs}`);
    assert.equal(m.clipping.samples, 0);
    assert.equal(integratedLoudness(new Float32Array(rate), rate), null);
    assert.equal(analyzeAudio(new Float32Array(rate), rate).peakDbfs, -120);
    assert.ok(Math.abs(analyzeAudio(sine(997, 3, 22050, 0.1), 22050).integratedLufs! - -23.01) < 0.5, 'any sample rate');
  });

  test('clipping, pauses, leading and trailing silence, and pitch are detected', () => {
    const rate = 22050;
    const square = new Float32Array(rate);
    for (let i = 0; i < square.length; i++) square[i] = i % 100 < 50 ? 1 : -1;
    const c = analyzeAudio(square, rate);
    assert.ok(c.clipping.samples > rate / 2 && c.clipping.runs > 0 && c.clipping.longestRun >= 50);
    const tone = sine(150, 1, rate, 0.3);
    const silence = new Float32Array(Math.round(0.5 * rate));
    const lead = new Float32Array(Math.round(0.2 * rate));
    const joined = new Float32Array(lead.length + tone.length * 2 + silence.length * 2);
    joined.set(lead, 0);
    joined.set(tone, lead.length);
    joined.set(silence, lead.length + tone.length);
    joined.set(tone, lead.length + tone.length + silence.length);
    joined.set(silence, lead.length + tone.length * 2 + silence.length);
    const m = analyzeAudio(joined, rate);
    assert.equal(m.silence.pauses.count, 1);
    assert.ok(Math.abs(m.silence.pauses.maxMs - 500) <= 20, `${m.silence.pauses.maxMs}`);
    assert.ok(Math.abs(m.silence.leadingMs - 200) <= 20 && Math.abs(m.silence.trailingMs - 500) <= 20);
    assert.ok(Math.abs(m.silence.speechMs - 2000) <= 40);
    assert.ok(m.pitch && Math.abs(m.pitch.medianHz - 150) < 5, JSON.stringify(m.pitch));
    assert.deepEqual(loudnessMatchGainDb(-30, -20, -12, -1), { gainDb: 10, limited: false });
    assert.deepEqual(loudnessMatchGainDb(-30, -20, -3, -1), { gainDb: 2, limited: true });
  });
});

describe('transcript agreement', () => {
  test('normalizes case, punctuation, hyphens, and the lexicon compounds', () => {
    assert.deepEqual(normalizeWords('Wallet Wall reads on-chain Big Query data.'), ['walletwall', 'reads', 'onchain', 'bigquery', 'data']);
    assert.deepEqual(normalizeWords('WalletWall’s stable coins'), ['walletwalls', 'stablecoin']);
  });

  test('counts missing, extra, and repeated words', () => {
    const ref = 'Before you move stablecoins into a vault, check whether the evidence supports the move.';
    assert.equal(compareTranscript(ref, 'before you move stable coins into a vault check whether the evidence supports the move').wordErrorRate, 0);
    const d = compareTranscript(ref, 'before you move stablecoins into a vault check the evidence supports the the move');
    assert.deepEqual(d.missing, ['whether']);
    assert.deepEqual(d.extra, ['the']);
    assert.equal(d.deletions, 1);
    assert.equal(d.insertions, 1);
    const r = compareTranscript('one two three four', 'one two three one two three four');
    assert.deepEqual(r.repeatedPhrases, ['one two three']);
    assert.equal(compareTranscript('', '').wordErrorRate, 0);
    assert.equal(compareTranscript('a b', 'a c').substitutions, 1);
  });
});
