# Narration: the WalletWallaby voice and the provider bakeoff

> WalletWall owns what is said and how the character sounds. A provider adapter owns synthesis. The
> artifact is hashed and provenance-bound. Nothing in a VideoSpec can reach a speech provider.

This lane builds the provider-neutral narration layer and a fair listening comparison between the
publication-quality reference (ElevenLabs) and two local candidates (NVIDIA Magpie through
NeMo-Speech.cpp, Chatterbox Multilingual V3). It changes nothing on the render or publish path:
`scripts/render.ts` still uses the silent fixture voice, and `config/voice-identity.json` still reports
the publication binding as `NOT_CONFIGURED`. Promoting a winner is a separate, deliberate change
(see "Integration proposal").

## Production policy (2026-10-20)

- **ElevenLabs Multilingual v2 is the publication narration provider**, on the voice the ElevenLabs binding in
  `config/narration-providers.json` names (`DTLT09E2cxHF0DqjKVbc`).
- **Qwen3-TTS is R&D and a local fallback.** Its candidate voices did not reach the publication bar in blind
  listening against the ElevenLabs anchor (2026-10-20); it is never promoted because it is free or local.
- **Narration length is constrained upstream by the video class** through the narration budget below, and
  **paid synthesis is attempted only after the budget passes.**
- **The architecture stays provider-neutral.** The VideoSpec names no provider, the budget lives in the spec and
  validation layer rather than in any adapter, and the same gate applies to every provider, paid or local.
- **Local voice work continues only if it genuinely matches or beats the publication anchor** in blind listening
  on the same corpus.

Wiring the publication provider into renders is still the integration step at the end of this document:
`scripts/render.ts` uses the fixture voice and the identity's publication binding reads `NOT_CONFIGURED` until
that change lands. The budget gate already sits in front of the route that change will use.

## Narration budget (`walletwall.narration-budget/v1`)

Narration length is a deterministic, validated contract, checked before any synthesis. A class's budget is
derived by `src/spec/narration-budget.ts`; nothing authors one.

| class | maxDurationSeconds | targetWordsPerMinute | maxWords | regenerationReserve |
|---|---|---|---|---|
| QUICK | 180 | 145 | 435 | 0.30 |
| FOCUSED | 300 | 145 | 725 | 0.30 |
| DEEP_DIVE | 600 | 145 | 1450 | 0.30 |

- `maxDurationSeconds` is the class ceiling from `VIDEO_CLASSES` (`src/spec/vocabulary.ts`, the one table of class
  durations) and `targetWordsPerMinute` is the voice identity's planning pace (`pacing.targetWpm` in
  `config/voice-identity.json`). Nothing else holds a copy, so changing either moves every budget with it.
- `maxWords = floor(maxDurationSeconds * targetWordsPerMinute / 60)`, and a check reports
  `estimatedDurationSeconds = wordCount / targetWordsPerMinute * 60`. Words are counted on the spoken text (lexicon
  aliases expanded, so "USDC" is four words), the same count the duration estimate and the pace gate use.
- `regenerationReserve` is capacity planning, not script length: plan synthesis capacity for about 30 % more than
  one full-length script, so a re-render (a fix, a pronunciation change) never needs an unplanned top-up. It never
  raises `maxWords`, and a budget whose `maxWords` includes it is refused.
- A budget handed to the check must equal the derivation exactly: the four fields and no other, finite and in
  range, `maxWords` following from duration and pace, and every value the policy's. A hand-built, stale, or
  planner-authored copy fails closed instead of widening the cap.
- It runs, and fails closed, at every route to a provider. `validateSpec` reports `NARRATION_OVER_BUDGET`, and
  the render command refuses a spec that fails validation. `synthesize()` in `src/pipeline/render-input.ts`, the
  render path's one route to a `VoiceProvider`, throws `NarrationBudgetError` before the provider is called.
  `passageRequest()` in `src/narration/corpus.ts`, where every bakeoff request is built, holds an evaluation
  passage to the longest class (DEEP_DIVE) before any adapter sees it. The error names the class, the spoken word
  count, the word cap, the estimated duration, and the class ceiling.
- It is not quota tracking: no credits, balances, or spend are recorded anywhere. The contract bounds what one
  video, or one evaluation passage, can ask a provider to speak.

## The boundary

```text
corpus text (display)  ──lexicon──▶  spoken text
        │                                 │
        ▼                                 ▼
NarrationRequest { passageId, displayText, spokenText, language, voiceProfile, identity }
        │
        ▼
NarrationProvider.synthesize(request, settings, ctx)        settings: config/narration-providers.json,
        │                                                     validated by the adapter's closed schema
        ▼
SynthesisResult { wav, modelId, modelVersion, modelContent, voiceId, settings, seed, runtime, performance }
        │
        ▼ parseWav (16-bit PCM only) · sha256 · text hashes
NarrationArtifact (walletwall.narration-artifact/v1)  ──▶  metrics · transcript · review page
```

- **What WalletWall owns:** the corpus (`fixtures/narration-eval/corpus.json`), the pronunciation lexicon
  (`config/pronunciation.json`), and the voice identity's direction and pacing
  (`config/voice-identity.json`). The request carries display text, spoken text, a language from a closed
  list, and the profile name. It carries no setting, no path, no prompt, and no code.
- **What an adapter owns:** `src/narration/providers/<provider>.ts`. Each declares a closed settings schema
  (`src/narration/contract.ts`): every key required, no other key allowed, strings only as enum members,
  numbers in range. A setting can therefore never be a free-form string, so nothing from configuration can
  become a shell argument, a URL, or a file path. Settings are named variants in
  `config/narration-providers.json`; the CLI runs variants, never ad-hoc values.
- **What is authoritative:** the artifact record. Its `identity` is the content address of the provider,
  model id and version, model content hashes, voice, settings, seed, runtime, language, corpus id and
  version, display and spoken text hashes, and the audio bytes (sha256, format, duration). The generation
  timestamp and the performance numbers are recorded outside the identity. Two records with the same
  identity name the same narration; a model, voice, setting, seed, text, or byte change gives a new one.

### The character (voice identity v2)

`config/voice-identity.json` (`walletwallaby-v2`) is the canonical, provider-neutral statement of how
WalletWallaby sounds. It is a character decision, not a provider setting:

> WalletWallaby is an Australian English expedition-guide voice: natural, restrained, technically precise,
> not caricatured. An adult voice in a medium-to-low register; calm, grounded, experienced, evidence-first,
> quietly confident, warm but restrained, capable of dry situational humor. Field documentary, never
> announcer, trailer, mascot, or YouTuber.

The direction carries `language: en-AU` and an `accent` block whose rendering rule is "natural and
regionally Australian, never performed as a gimmick"; the `avoid` list names the caricatured accent, slang
for its own sake and broad comedic delivery alongside the v1 exclusions. The pacing is unchanged from v1.
The identity names no voice id: a provider interprets the direction with its own controls, and
`config/narration-providers.json` declares, per binding, the variety its voice actually speaks.

| Provider | Role | Declared variety | How the direction is honoured |
|---|---|---|---|
| ElevenLabs | publication target | `en-AU` | voice choice; the adapter refuses a binding or an API-labelled voice of another variety before requesting speech |
| Magpie (NeMo-Speech.cpp) | local development and offline fallback | `en-US` | cannot: five fixed American speakers, no Australian voice; the deviation is logged at synthesis and recorded per candidate in `results.json` |
| Chatterbox Multilingual V3 | experimental | `en-US` | cannot without owned, licensed Australian reference audio, which is a separate decision |

Magpie's rendering of "Wallaby" as "wall-uh-bye" is a provider defect, not a text problem (its dictionary
has the word right). No pronunciation alias was added for it: canonical text, the lexicon
(`WalletWallaby` → `Wallet Wallaby`), and what every provider receives are unchanged. If the owner
approves one of the pronunciation probes, the override would live in the Magpie adapter as a
provider-specific substitution recorded in the artifact's settings, never in the lexicon.

The bump from v1 invalidates everything derived from the identity by construction: the build identity's
hash of `config/voice-identity.json`, the committed spec's `audio.voiceIdentityId` (regenerated with
`npm run plan`), and every narration artifact, whose identity includes `voiceIdentityId`. The bakeoff CLI
refuses an artifact made under another identity or corpus as stale (`staleFor`); it is re-synthesized,
never re-labelled. `test/voice-identity.test.ts` pins all of this.

### Adapters

| Provider | Kind | Runs through | Model identity | Credentials |
|---|---|---|---|---|
| `elevenlabs` | remote reference | `fetch` to `api.elevenlabs.io` (host constant in code) | hosted, not content-addressable; audio hash only | `ELEVENLABS_API_KEY` from the environment at call time; voice id from config, `WALLETWALLABY_ELEVENLABS_VOICE_ID` overrides |
| `magpie-nemo-speech` | local | the pinned `nemo-speech` executable (`WALLETWALL_NEMO_SPEECH` or PATH), argv list, text via a file in the work dir | GGUF, NanoCodec, and tokenizer directory sha256 pins; refused on drift | none |
| `chatterbox-multilingual` | local | `WALLETWALL_CHATTERBOX_PYTHON -I -B tools/chatterbox/synthesize.py --job <file>` | package version + source commit, checkpoint revision, per-file sha256; refused on drift | none |

Both local adapters pass explicit model locations and run offline (`HF_HUB_OFFLINE`, explicit GGUF paths),
so synthesis never downloads. They receive a minimal environment (no tokens, no profile beyond the cache
location) and write only inside `dist/narration-bakeoff/<provider>/<variant>/work/`. The executable and
model paths are resolved in-process and never recorded; provenance names versions, revisions, and hashes.

The ElevenLabs adapter is the one pipeline file allowed to name a speech endpoint; `test/guards.test.ts`
pins that exception and proves no adapter is reachable from the render bundle or from any render or
publish script. The reference voice is never cloned, scraped, or used as conditioning.

## The corpus

`fixtures/narration-eval/corpus.json` (`walletwall.narration-eval-corpus/v1`, versioned). Four passages in
WalletWall's narration register, copy-policy compliant, NFKC-stable, single-spaced:

| id | class | target |
|---|---|---|
| `short-instruction` | one sentence | 4-10 s |
| `normal-explanation` | a vault-candidate label is a starting point, not a conclusion | 20-32 s |
| `technical-passage` | WalletWall, WalletWallaby, stablecoin, provenance, BigQuery, deterministic, migration readiness, wallet address, on-chain | 30-45 s |
| `long-form` | explanatory cadence, a three-item list, one uncertainty, one conclusion | 60-90 s |

`test/narration-corpus.test.ts` pins the display and spoken text hashes, checks the copy policy, and checks
the estimated duration of each passage against its class at the identity's pace.

## Running the bakeoff

Everything lands under `dist/narration-bakeoff/` (never committed).

```bash
node scripts/narration.ts doctor                                   # what is installed, pinned, verified
node scripts/narration.ts synthesize --provider=magpie-nemo-speech --variant=leo --repeat=2
node scripts/narration.ts synthesize --provider=chatterbox-multilingual --variant=default --repeat=2
node scripts/narration.ts synthesize --provider=elevenlabs --variant=reference   # needs ELEVENLABS_API_KEY
node scripts/narration.ts place --provider=elevenlabs --variant=reference --passage=long-form --file=ref.wav
node scripts/narration.ts transcribe                               # Parakeet TDT 0.6B v3 via nemo-speech
node scripts/narration.ts review --lineup=elevenlabs:reference,magpie-nemo-speech:leo,chatterbox-multilingual:default
```

- `synthesize` writes `<passage>.wav`, `<passage>.artifact.json`, and `<passage>.metrics.json`; with
  `--repeat=N` it synthesizes N times from the same settings and seed and records whether the bytes were
  identical (`<passage>.determinism.json`). Nothing is cherry-picked: the first run is the candidate.
- `place` registers reference audio generated outside this repository (when no key is available). The
  record is marked `synthesis: "external"` with the variant's settings as *declared*, not verified.
- `transcribe` runs the pinned Parakeet model and writes a word-level diff against the spoken text:
  missing, extra, and repeated words. It refuses audio whose bytes or source text no longer match the
  record (stale narration).
- `review` writes `results.json` (every artifact's identity, settings, metrics, transcript diff, and
  performance) and the blind page `review/index.html`: candidates are letters, shuffled per passage by
  the hash of passage and identity, with the raw output and a loudness-matched copy (gain only, default
  -20 LUFS, peak-limited at -1 dBFS). `review/reveal.json` holds the mapping; the page never does.

### Evaluation protocol

1. Audition at most two or three voice or configuration variants per local model on one passage, then
   choose one configuration before running the four-passage suite.
2. One canonical generation per passage from a fixed seed. `--repeat` exists to measure variance, not to
   pick a favourite.
3. No mastering, EQ, compression, denoise, reverb, or music. The loudness-matched copies exist only so
   level differences do not bias the listener; the raw copies are the comparison.
4. Rate naturalness, smoothness, prosody, pacing, pause quality, technical pronunciation, long-form
   stability, Wallaby fit, listening fatigue, and artifact defects, each 1-5, with notes. The listening
   decision is authoritative. Objective diagnostics (peak, RMS, integrated loudness, clipping, silence
   and pause distribution, pitch spread, transcript agreement, timing, VRAM) support it and never replace it.
5. The acceptance bar is the reference: a local candidate replaces ElevenLabs only if it is genuinely
   competitive in blind listening on every criterion, not because it is free, local, fast, or deterministic.

## Bakeoff record (corpus v1, 2026-10-19)

The machine: Windows 11, RTX 5080 (16 GB, driver 616.56), Ryzen 7 9800X3D, 32 GB. The full record of every
candidate (identities, settings, metrics, transcript diffs, performance) is `fixtures/narration-eval/results.json`;
the audio stays in `dist/narration-bakeoff/` on the machine that ran it.

**ElevenLabs did not run.** No `ELEVENLABS_API_KEY` exists on this machine, so the reference column is empty
until the owner runs `synthesize --provider=elevenlabs --variant=reference` (or `place`s audio generated
elsewhere) and re-runs `review`. The adapter is exercised against a stub in `test/narration.test.ts`.

### Configurations

| Candidate | Identity | Settings |
|---|---|---|
| Magpie (NeMo-Speech.cpp 0.2.0, CUDA) | `nvidia/magpie_tts_multilingual_357m` v2607 @ `19806879b16d…`, F16 GGUF `30d27551…`, NanoCodec `cc86d36d…`, tokenizer `36529a70…`; 22.05 kHz mono | audition: Jason, Leo, John at the runtime defaults (cfgScale 2.5, temperature 0.6, topK 80; verified byte-identical to the implicit defaults), seed 7 |
| Magpie, selected | same | `jason-cool`: Jason, cfgScale 2.5, temperature 0.4, topK 40, seed 7 |
| Chatterbox Multilingual V3 (chatterbox-tts 0.1.7 @ git `5de7a54a`, torch 2.11.0+cu128, CUDA) | `ResembleAI/chatterbox` @ `5bb1f6ee…` (`t3_mtl23ls_v3.safetensors` `5abca832…`, built-in voice `conds.pt` `6552d705…`); 24 kHz mono; Perth watermark | audition on passage B: `default` (exaggeration 0.5, cfg 0.5, temperature 0.8), `calm` (0.3 / 0.5 / 0.6), `measured` (0.4 / 0.7 / 0.7), `paced` (0.5 / 0.3 / 0.8), `paced-calm` (0.3 / 0.3 / 0.6); repetition penalty 1.2, min_p 0.05, top_p 1, seed 7, no reference audio |
| Chatterbox, selected | same | `paced-calm` |

The selections are objective, not aural: `jason-cool` because it removed the dropped sentence and had the lowest
word error on every passage; `paced-calm` because it had the only 0 % transcript on passage B and the most pauses.
Leo, John, and the other Chatterbox variants remain one `--lineup` away.

### Results per passage (duration, pace, loudness, transcript agreement)

| Passage (spoken words) | Magpie `jason-cool` | Chatterbox `paced-calm` |
|---|---|---|
| A short-instruction (15) | 5.8 s, 156 wpm, -23.5 LUFS, peak -6.8 dBFS, WER 0 % | 4.9 s, 183 wpm, -17.9 LUFS, peak -0.2 dBFS, WER 0 % |
| B normal-explanation (68) | 27.8 s, 147 wpm, -23.9 LUFS, 16 pauses, WER 5.9 % (1S 0D 3I: "yay", "um") | 16.6 s, 246 wpm, -17.6 LUFS, 5 pauses, WER 0 % |
| C technical-passage (94) | 39.6 s, 142 wpm, -24.2 LUFS, 18 pauses, WER 5.5 % (0S 0D 5I: "howdy") | 27.8 s, 203 wpm, -17.6 LUFS, 6 pauses, WER 0 % |
| D long-form (178) | 77.2 s, 138 wpm, -23.9 LUFS, 40 pauses, WER 6.7 % (1S 1D 10I: "yo yo", "thor") | 30.3 s, **truncated**: 74 of 178 words missing (WER 45.5 %), 1 pause |

Magpie at the runtime defaults, for the record: Jason dropped the entire last sentence of passage C (19 deletions,
WER 25.3 %) and seven words of D; John ran at 155-188 wpm and hallucinated "da da da da da da day" and "na na na na"
in D; Leo sat at 147-164 wpm with 8-9 % WER. Every Chatterbox variant on passage B came out at 15.6-16.6 s
(246-264 wpm) with no pause over 160 ms, regardless of `cfg_weight` or `exaggeration`: the pace belongs to the
built-in conditioning voice, and the only lever Chatterbox offers for it is reference audio, which this lane does
not use.

### Determinism and performance

- Magpie reproduces bytes exactly for a fixed seed on CUDA (every repeat identical). Each CLI run loads the model
  cold: 1.0-3.2 s wall per passage, real-time factor 0.04 for long passages (0.2 for the short one, where load
  dominates), nvidia-smi delta +1.4-1.9 GB.
- Chatterbox reproduces bytes exactly for a fixed seed on CUDA (every repeat identical). Per passage: 55-66 s
  process wall, of which the cold load is about 17.5 s and generation 10.5-11.6 s for 16 s of audio (generation
  real-time factor about 0.7); peak torch allocation 3.4 GB, nvidia-smi delta +3.6-5.3 GB. Its float output
  peaks at 1.004-1.019, so `synthesize.py` applies a unity-gain quantization (-0.03 to -0.16 dB) rather than clip.
- Neither candidate clips. Magpie sits near -24 LUFS, Chatterbox near -17.5 LUFS; the review copies are matched to
  -20 LUFS (Magpie copies gain +3.5 to +4.2 dB, peak-limited on two passages; Chatterbox copies -2.1 to -3 dB).

### Owner listening notes (2026-10-19, first pass)

- On the technical passage, candidate A (Magpie, `jason-cool`) was "more the vibe" than Chatterbox, but it rendered
  the last syllable of "Wallaby" and "WalletWallaby" as "bye" rather than "bee". The runtime's IPA dictionary has the
  word right (`WALLABY ˈwɑləbi`), so this is the model's rendering, not a lookup miss. Eight spellings of the word
  were synthesized with the same settings for listening under `dist/narration-bakeoff/probes/pronunciation/`; the
  respellings that leave the dictionary (`Wollaby`, `wol a bee`) derail the recognizer, so a lexicon fix must stay
  with in-dictionary words. A lexicon alias change bumps `config/pronunciation.json`'s id, which the committed spec
  binds as `pronunciationDictionaryId`, so it is a small separate change with a spec regeneration.
- The reference voice is an Australian English voice, and that accent is the intended character (the wallaby's
  geography), natural rather than caricatured. Neither local candidate can offer it: Magpie ships five fixed
  American English speakers and no `en-AU`, and Chatterbox's built-in voice is American, so an Australian
  Chatterbox voice would need owned, licensed Australian reference audio. Done: voice identity v2 states the
  Australian direction (see "The character"), the spec's `voiceIdentityId` was regenerated, and the bakeoff
  record was re-synthesized under v2.

### Objective verdict (the listening verdict is the owner's)

- Magpie is deterministic, fast, and paced like the identity, but at default sampling it drops sentences and
  emits non-words; the cooler sampling removes the dropped sentence yet still leaves 3-10 inserted syllables per
  passage. Hallucinated speech and dropped words are hard failures in the acceptance bar, before any judgement of
  naturalness.
- Chatterbox's built-in voice is intelligible (0 % WER on three passages) but speaks at 180-260 wpm, far above the
  165 wpm ceiling the pipeline enforces, and truncates the long passage. Making it usable means owned reference
  audio for pace and character (an owner decision about rights, not a tuning knob) plus sentence chunking in the
  adapter for long-form.
- Provisional recommendation, pending the owner's blind listening and the reference column: **C**. ElevenLabs
  remains the publication voice; Magpie (`jason-cool`) is retained as the development, offline, and fallback
  provider; Chatterbox stays an experiment until owned reference audio exists.

## Security review

| Question | Answer |
|---|---|
| Can a VideoSpec cause arbitrary speech-provider arguments? | No. A VideoSpec never reaches an adapter: the bakeoff reads the corpus, and the only adapter inputs are the request's text fields and a validated settings object whose strings are enum members. `magpieArgs` and `chatterboxJob` are built from those alone; the text travels through a file, never an argument. |
| Can content expose the API key? | The key is read inside the ElevenLabs adapter at call time, sent only to the constant host, and never placed in a result or record; refusals redact it. `validateNarrationArtifact` fails any record that contains a credential-shaped environment value, and the guard rules refuse committed `sk_` keys. |
| Can absolute paths leak? | Records name repository-relative POSIX paths under `dist/narration-bakeoff/` only; any backslash, drive letter, or home-directory shape anywhere in a record (keys included) fails validation. Executable and model locations are resolved in-process and not recorded. |
| Can stale narration be mistaken for current narration? | `transcribe` and `review` re-hash every WAV against its record and re-hash the corpus text against the record's spoken-text hash; either mismatch is refused. |
| Can a model, voice, or setting change without invalidating provenance? | No. All of them are inside the identity; local model content is hashed and pinned, so a re-pulled or updated model is refused before it runs, and a hosted model is identified by its audio hash alone (a documented limitation of remote providers). |
| Can stochastic generation produce a different artifact under the same declared identity? | The identity includes the audio hash, so different bytes are a different artifact by construction. Whether a provider reproduces bytes is measured with `--repeat` and recorded, never assumed. |
| Can generated audio contain words absent from the source? | The transcript diff reports extra, missing, and repeated words as diagnostics; a human listens for hallucinated speech. |
| Can a provider outage silently substitute another provider? | No. The provider is an explicit argument, the record names it, and every adapter fails closed (missing key, missing tool, drifted model, non-zero exit, missing or malformed output). |
| Can local model updates silently change speech? | No. The GGUF, codec, tokenizer directory, Chatterbox revision, package version, and source commit are pinned and verified on every run. |
| Can review audio be mistaken for publication audio? | Review copies live under `review/audio/` as anonymous letters, are gain-adjusted, and carry no record; publication would take an artifact's WAV by identity through the voice-provider boundary, which this lane does not wire. |

## Integration proposal (after the bakeoff; not done in this lane)

1. Add `audio.narrationArtifacts` to the publish inputs: one artifact identity per narration line, bound
   in `render.json` and the provenance manifest next to the existing `narration` block.
2. Implement a `VoiceProvider` (the existing boundary in `src/audio/voice-provider.ts`) that maps the
   winning adapter's artifacts to `NarrationTrack` lines (`durationMs` from the WAV, `audio.sha256` from
   the record); keep the fixture voice as the default and CI voice.
3. Configure the chosen binding in `config/voice-identity.json` (`status` leaves `NOT_CONFIGURED`,
   which bumps the identity hash), gate any live synthesis behind a separate, non-required, trusted
   workflow (docs/CI.md), and extend the public-output gate to refuse a render whose narration artifacts
   do not match their records.
4. Retain the local provider as the development, offline, and fallback voice regardless of the winner.
