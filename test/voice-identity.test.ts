// WalletWallaby's canonical voice identity (config/voice-identity.json, v2): an
// Australian English expedition guide, stated once at the provider-neutral
// level. Provider bindings stay in config/narration-providers.json, canonical
// text carries no provider-specific alias, and everything derived from the
// identity (the committed spec, the build identity, every narration artifact)
// changes with it rather than being re-labelled.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { toSpokenText } from '../src/audio/pronunciation.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress } from '../src/core/hash.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { BAKEOFF_DIST_PREFIX, buildNarrationArtifact, staleFor } from '../src/narration/artifact.ts';
import { NarrationProviderError, type NarrationRequest } from '../src/narration/contract.ts';
import { loadCorpus, passageRequest } from '../src/narration/corpus.ts';
import { ChatterboxProvider } from '../src/narration/providers/chatterbox.ts';
import { checkVoiceAccent, ElevenLabsProvider } from '../src/narration/providers/elevenlabs.ts';
import { loadProvidersConfig, providerFor, variantSettings } from '../src/narration/providers/index.ts';
import { MagpieProvider } from '../src/narration/providers/magpie.ts';
import { encodeWavPcm16 } from '../src/narration/wav.ts';
import { committedSpec, config } from './helpers.ts';

/** Content address of config/voice-identity.json at walletwallaby-v1 (the identity this lane replaced). */
const V1_VOICE_IDENTITY = 'ea3471412c427a0180457563eba3414230a1f29688ebc459195edde5c3ff6e19';
const ELEVENLABS_REFERENCE_VOICE = 'DTLT09E2cxHF0DqjKVbc';

const providers = loadProvidersConfig();
const corpus = loadCorpus();
const text = (rel: string): string => readFileSync(path.join(VIDEO_ROOT, ...rel.split('/')), 'utf8');

describe('WalletWallaby voice identity v2', () => {
  test('is the Australian English expedition guide, versioned, with the v1 traits kept', () => {
    const v = config.voice;
    assert.equal(v.schema, 'walletwall.voice-identity/v2');
    assert.equal(v.id, 'walletwallaby-v2');
    assert.equal(v.character, 'WalletWallaby');
    assert.equal(v.direction.language, 'en-AU');
    assert.equal(v.direction.accent.variety, 'Australian English');
    assert.match(v.direction.accent.rendering, /never performed as a gimmick/i);
    assert.match(v.direction.concept, /expedition guide/i);
    assert.match(v.direction.summary, /Australian English/);
    assert.equal(v.direction.register, 'medium-to-low');
    for (const q of ['calm', 'grounded', 'experienced', 'precise technical diction', 'field-documentary tone', 'evidence-first', 'quietly confident', 'measured pacing', 'comfortable pauses', 'capable of dry situational humor']) assert.ok(v.direction.qualities.includes(q), q);
    for (const a of ['caricatured or exaggerated Australian accent', 'cartoon mascot voice', 'announcer voice', 'movie-trailer gravitas', 'hyperactive YouTuber cadence', 'salesy', 'imitating any real, identifiable person']) assert.ok(v.direction.avoid.includes(a), a);
    assert.deepEqual(v.pacing, { targetWpm: 145, maxWpm: 165, linePauseMs: 350, sentencePauseMs: 220, commaPauseMs: 90 }, 'pacing is unchanged from v1');
  });

  test('the committed spec binds the current identity and lexicon (regenerated, never hand-edited)', () => {
    const spec = committedSpec();
    assert.equal(spec.audio.voiceIdentityId, config.voice.id);
    assert.equal(spec.audio.pronunciationDictionaryId, config.lexicon.id);
  });

  test('provider bindings stay out of the identity, and the bakeoff bindings track it', () => {
    const identityText = text('config/voice-identity.json');
    assert.ok(!identityText.includes(ELEVENLABS_REFERENCE_VOICE), 'no voice id in the canonical identity');
    assert.ok(!/"voiceId"\s*:/.test(identityText), 'no voiceId field in the canonical identity');
    // The publication binding approves a versioned binding by its content address (src/narration/publication.ts); the
    // voice, model, and settings stay in config/narration-providers.json, and no credential name or value is here.
    const binding = config.voice.providerBindings.publication as Record<string, unknown>;
    assert.deepEqual(Object.keys(binding).sort(), ['binding', 'bindingSha256', 'provider', 'status'], 'the publication binding is a reference and a pin');
    assert.equal(binding.status, 'APPROVED');
    assert.equal(binding.provider, 'elevenlabs');
    assert.ok(!/ELEVENLABS_API_KEY|apiKey|sk_/.test(identityText), 'no credential in the identity');
    assert.equal(providers.voiceIdentity, config.voice.id, 'config/narration-providers.json follows the identity');
    assert.equal(providers.providers.elevenlabs.accent, config.voice.direction.language, 'the publication target speaks the identity variety');
    for (const id of ['magpie-nemo-speech', 'chatterbox-multilingual'] as const) {
      assert.match(providers.providers[id].accent, /^[a-z]{2}-[A-Z]{2}$/, `${id} declares what it speaks`);
      assert.match(providers.providers[id].role, /fallback|experimental/i, `${id} is not a publication provider`);
    }
  });

  test('canonical text carries no provider-specific pronunciation alias', () => {
    assert.equal(toSpokenText('WalletWallaby', config.lexicon), 'Wallet Wallaby');
    assert.equal(toSpokenText('Wallaby', config.lexicon), 'Wallaby');
    const entry = config.lexicon.entries.find((e) => e.term === 'WalletWallaby')!;
    assert.deepEqual({ spoken: entry.spoken, ipa: entry.ipa }, { spoken: 'Wallet Wallaby', ipa: 'ˈwɒlɪt ˈwɒləbi' });
    for (const e of config.lexicon.entries) assert.ok(!/bee|wolla|wol a/i.test(e.spoken), `${e.term}: no respelling for one provider`);
    const technical = corpus.passages.find((p) => p.class === 'TECHNICAL_PASSAGE')!;
    assert.ok(passageRequest(technical, config).spokenText.includes('Wallet Wallaby'), 'every provider receives the canonical spoken form');
    for (const file of ['src/narration/providers/magpie.ts', 'src/narration/providers/chatterbox.ts', 'src/narration/providers/elevenlabs.ts']) {
      assert.ok(!/replace\(|Wallab/.test(text(file)), `${file} does not rewrite the text it is given`);
    }
  });

  test('the identity bump changed the build identity and every derived narration artifact identity', () => {
    assert.notEqual(contentAddress(config.voice), V1_VOICE_IDENTITY, 'the identity content address moved');
    assert.notEqual(buildIdentity().configs['config/voice-identity.json'], V1_VOICE_IDENTITY, 'the build identity moved with it');
    const request: NarrationRequest = { passageId: 'short-instruction', displayText: 'WalletWall checks the evidence.', spokenText: 'Wallet Wall checks the evidence.', language: 'en-US', voiceProfile: 'walletwallaby', identity: config.voice };
    const wav = encodeWavPcm16(new Float32Array(2205), 22050);
    const result = { wav, modelId: 'm', modelVersion: 'v', modelContent: {}, voiceId: 'Jason', settings: { seed: 7 }, seed: 7, runtime: { name: 'r', version: '1', device: 'cpu' }, performance: null };
    const build = (identity: typeof config.voice) => buildNarrationArtifact({ request: { ...request, identity }, corpus: { id: corpus.id, version: corpus.version }, provider: 'magpie-nemo-speech', variant: 'jason-cool', synthesis: 'adapter', result, audioPath: `${BAKEOFF_DIST_PREFIX}magpie-nemo-speech/jason-cool/short-instruction.wav`, generatedAt: null });
    const v2 = build(config.voice);
    const v1 = build({ ...config.voice, id: 'walletwallaby-v1' });
    assert.equal(v2.voiceIdentityId, 'walletwallaby-v2');
    assert.notEqual(v1.identity, v2.identity, 'same bytes, different identity under a different voice identity');
    assert.equal(staleFor(v2, { voiceIdentityId: config.voice.id, corpusId: corpus.id, corpusVersion: corpus.version }), null);
    assert.match(staleFor(v1, { voiceIdentityId: config.voice.id, corpusId: corpus.id, corpusVersion: corpus.version }) ?? '', /made for voice identity walletwallaby-v1/);
    assert.match(staleFor(v2, { voiceIdentityId: config.voice.id, corpusId: corpus.id, corpusVersion: corpus.version + 1 }) ?? '', /corpus/);
  });

  test('the committed bakeoff record was regenerated under the current identity', () => {
    const results = JSON.parse(text('fixtures/narration-eval/results.json')) as { schema: string; voiceIdentity: { id: string; language: string }; candidates: { provider: string; accent: { declared: string; identity: string; matches: boolean }; artifact: { voiceIdentityId: string } }[] };
    assert.equal(results.schema, 'walletwall.narration-bakeoff-results/v2');
    assert.equal(results.voiceIdentity.id, config.voice.id);
    assert.equal(results.voiceIdentity.language, 'en-AU');
    assert.ok(results.candidates.length > 0);
    for (const c of results.candidates) {
      assert.equal(c.artifact.voiceIdentityId, config.voice.id, `${c.provider}: not a stale v1 artifact`);
      assert.equal(c.accent.identity, 'en-AU');
      assert.equal(c.accent.matches, c.accent.declared === 'en-AU', `${c.provider}: the deviation is stated, not hidden`);
    }
  });

  test('the ElevenLabs adapter honours the direction through voice choice and refuses a voice of another variety', () => {
    checkVoiceAccent('en-AU', 'en-AU', ELEVENLABS_REFERENCE_VOICE, { accent: 'Australian', gender: 'male' });
    checkVoiceAccent('en-AU', 'en-AU', ELEVENLABS_REFERENCE_VOICE, undefined);
    assert.throws(() => checkVoiceAccent('en-AU', 'en-US', ELEVENLABS_REFERENCE_VOICE, { accent: 'Australian' }), NarrationProviderError, 'a binding that declares another variety');
    assert.throws(() => checkVoiceAccent('en-AU', 'en-AU', ELEVENLABS_REFERENCE_VOICE, { accent: 'American' }), NarrationProviderError, 'a voice the API labels as another variety');
  });

  test('no provider substitutes another: each id resolves to its own adapter and fails on its own', async () => {
    assert.ok(providerFor('elevenlabs', providers) instanceof ElevenLabsProvider);
    assert.ok(providerFor('magpie-nemo-speech', providers) instanceof MagpieProvider);
    assert.ok(providerFor('chatterbox-multilingual', providers) instanceof ChatterboxProvider);
    const request: NarrationRequest = { passageId: 'short-instruction', displayText: 'x', spokenText: 'x', language: 'en-US', voiceProfile: 'walletwallaby', identity: config.voice };
    const elevenlabs = providerFor('elevenlabs', providers);
    const outage = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await assert.rejects(elevenlabs.synthesize(request, variantSettings(providers, elevenlabs, 'reference'), { workDir: VIDEO_ROOT, env: { ELEVENLABS_API_KEY: 'test-key-not-real-0123456789abcdef' }, fetch: outage }), (err: Error) => err instanceof NarrationProviderError && /ElevenLabs/.test(err.message));
    const magpie = providerFor('magpie-nemo-speech', providers);
    await assert.rejects(magpie.synthesize(request, variantSettings(providers, magpie, 'jason-cool'), { workDir: VIDEO_ROOT, env: { WALLETWALL_NEMO_SPEECH: path.join(VIDEO_ROOT, 'no-such-runtime.exe'), PATH: '' } }), (err: Error) => err instanceof NarrationProviderError && /nemo-speech/.test(err.message));
  });
});
