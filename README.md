# WalletWall Audio-Visual Docs

Deterministic audiovisual documentation for [WalletWall](https://walletwall.org).

## Official WalletWall links

- Home: https://walletwall.org/
- Docs: https://docs.walletwall.org/

> **This is not "AI makes YouTube videos."** The WalletWall docs are the authority. A video is a versioned derivative of one published docs page: every spoken line and every on-screen word cites a verbatim span of that page (or a hashed repository artifact), and validation refuses anything it cannot trace back.

## The rule

```text
The docs decide WHAT is true.
The planner decides HOW to structure the explanation.
WalletWall defines the visual and sonic language.
WalletWallaby guides the viewer.
The renderer executes deterministically.
Validation decides whether the artifact is publishable.
```

## What this repository owns

- docs normalization (MDX → a hashed, renderer-neutral source model)
- the typed `VideoSpec`
- the storyboard / planner boundary (a planner selects meaning; it cannot emit code, styling, camera moves, or image prompts)
- evidence and claim validation
- the WalletWallaby character rig
- deterministic motion and traversal
- Remotion rendering
- semantic audio (narration, music bed, semantic cues, sonic identity)
- voice-provider adapters
- staleness detection against the canonical docs
- provenance manifests
- YouTube publishing adapters (dry run in v1)
- playlist and release metadata

## What it does not own

- canonical WalletWall product truth or product documentation (those stay in the WalletWall docs; this repository consumes them by exact identity)
- private production application code
- wallet custody, signing, or anything that touches keys (WalletWall is non-custodial and never needs them)
- private secrets of any kind
- arbitrary generative video output: there is no field for stock footage, generated imagery, AI presenters, or free-form prompts

## Source identity

A video binds to its inputs by content, not by name:

| Input | Bound by |
|---|---|
| Docs page | git blob id of the exact doc bytes, plus the normalized content hash and the normalizer version |
| Claims | verbatim quotes, re-verified against the bound doc |
| Assets | sha256 of each declared file |
| Plan | `VideoSpec` content hash; `plan:check` proves the committed spec is byte-identical to a fresh plan |
| Toolchain | lockfile hash, renderer version |
| Performance | character rig version, motion config version, voice and sonic config versions |
| Output | sha256 of the rendered MP4; YouTube id and revision lineage once uploads exist |

Commit SHAs are deliberately not the binding: squash and rebase merges would orphan them.

## Video classes

| Class | Length | Use |
|---|---|---|
| Quick | up to 3 min | one concept, one mechanism |
| Focused | up to 5 min | one page explained end to end |
| Deep dive | up to 10 min | a mechanism with its evidence |

The assembler picks the shortest class the narration fits. Narration is never sped up to fit: an overlong topic is split into parts, and "Part N" labels appear only when there are two or more.

## WalletWallaby

WalletWallaby is the educational guide: a calm, observant, precise, evidence-first expedition guide who moves through the information as terrain — landing on the card that matters, tracing the route between concepts, pushing through into depth only when the lesson earns it. Coat in WalletWall terracotta, cream belly, muzzle, and inner details, charcoal outline, eyes, nose, and claws. No caricature, no costume, no mascot slapstick.

The design test: *if WalletWallaby disappeared, would the explanation still be understandable?* Every review render also produces characterless stills to prove it.

WalletWallrus remains WalletWall's engineering and repository identity; WalletWallaby appears only in the videos.

## Rendering and providers

- **Remotion** is the v1 renderer. Every frame is a pure function of the spec and the frame number.
- The LLM planner, voice, renderer, and upload target each sit behind an interface, so any of them can be replaced without changing the spec format. Today the planner is a hand-authored fixture storyboard; narration is the silent fixture voice (estimated timing) unless a render replays the video's verified publication narration set (`--narration=publication`, [docs/NARRATION.md](docs/NARRATION.md)).
- **YouTube publishing is unlisted and manual-review-first.** The v1 upload type cannot express `public`; a human reviews every upload before it goes public. A materially updated video is a new upload with lineage, never an overwrite.

Remotion is licensed separately from this repository, under the vendor's own terms rather than an open-source license; whether this project qualifies for the Free License is an owner decision recorded in [docs/LICENSING.md](docs/LICENSING.md), and a company license is needed if it does not.

## Run it

Node.js 24 is required (the TypeScript sources run under Node's type stripping; there is no build step). No API keys, `.env` file, or WalletWall account are needed.

```bash
npm ci
npm run check                                  # typecheck + tests + plan:check + validate
npm run render:stills migration-readiness      # review stills, with and without WalletWallaby
npm run pipeline migration-readiness           # every gate, then stills, MP4, and the dry-run publish manifest
```

| Command | What it does |
|---|---|
| `npm test` | Unit, invariant, and adversarial positive-control tests. |
| `npm run typecheck` | `tsc --noEmit` over sources, scripts, and tests. |
| `npm run plan` / `plan:check` | Regenerate (or verify, byte for byte) `specs/<id>/spec.json` and its source snapshot from the storyboard. |
| `npm run validate` | Validate every committed spec against its canonical doc; writes `dist/<id>/validation.json`. |
| `npm run freshness` | Classify how the doc changed since the spec was planned (exit 2 = re-render or a new revision needed). |
| `npm run contracts:check` | Verify the fixture mirror; with a WalletWall checkout, also the brand contract and the withheld `.mintignore`. |
| `npm run render:stills` | Settled frame of every segment and transition, plus characterless variants. |
| `npm run render` | Full MP4 into `dist/<id>/<id>.r<revision>.mp4` plus `render.json`. |
| `npm run publish:dry-run` | Captions (VTT/SRT), semantic cue sheet, provenance, media QA, and the YouTube publish manifest; dry-run receipt only. |
| `npm run public:check` | The public-output gate over `dist/<id>/` after `publish:dry-run`: dry run only, unlisted, captions, manifest, provenance, and build identity, with no placeholder text or local paths. `--stills=<dir>` adds review stills, `--require-render` the MP4. See [docs/CI.md](docs/CI.md). |
| `npm run narration -- publication [<id>]` | Publication narration: synthesize the video's narration with the approved ElevenLabs binding (needs `ELEVENLABS_API_KEY`) into a verified set under `dist/<id>/narration/`, which `--narration=publication` replays; `publication-proof` does the same for one short segment. See [docs/NARRATION.md](docs/NARRATION.md). |
| `node scripts/narration.ts <doctor\|pull\|synthesize\|place\|transcribe\|review>` | The WalletWallaby narration bakeoff: synthesize the evaluation corpus through a provider adapter (ElevenLabs reference, Magpie via NeMo-Speech.cpp, Chatterbox Multilingual), measure, transcribe, and build the blind review page under `dist/narration-bakeoff/`. Off the render path; see [docs/NARRATION.md](docs/NARRATION.md). |
| `npm run stills:compare -- <a> <b>` | Repeat-render determinism: two `render:stills` outputs must be byte-identical. |
| `npm run studio` | Remotion Studio preview of the committed spec. |

The first render downloads Remotion's pinned headless Chrome. Everything generated goes to `dist/`, which is never committed.

### Canonical sources

The docs stay in the WalletWall docs; this repository reads them by identity. Spec paths use the WalletWall workspace namespace: `video/…` is this repository, everything else (`docs/…`) is the canonical tree. Point `WALLETWALL_SOURCE_ROOT` at a WalletWall checkout to plan, validate, and check freshness against the live docs. Without it, the pipeline reads `fixtures/canonical/`: byte-identical copies of the few public files the tests need, each verified against its git blob id on every read.

## Layout

```text
config/             the version-controlled language: copy templates and policy, voice identity,
                    pronunciation, sonic identity, playlists, release plan, YouTube defaults, video registry
contracts/          brand values copied from the canonical WalletWall source, with their blob ids
fixtures/storyboards/  the planner contract (hand-authored until an LLM adapter exists)
fixtures/canonical/ blob-bound copies of public canonical files (see MANIFEST.json)
assets/brand/       reviewed brand marks the renderer may show
specs/<id>/         committed VideoSpec + the normalized source snapshot it was planned against
manifests/          committed lineage (YouTube ids and version history, once uploads exist)
src/spec            VideoSpec types and closed vocabularies
src/source          MDX normalizer, docs-site publish status, the canonical-source gateway
src/planner         StoryboardProvider interface, fixture provider, deterministic assembler
src/validation      the publishability gate (codes in src/core/issues.ts)
src/layout          scene geometry shared by the validator and the renderer
src/timeline        renderer-neutral timing
src/audio           voice-provider interface, pronunciation, captions, semantic cue sheet
src/character       WalletWallaby rig and choreography
src/staleness       docs-change classification and freshness
src/publish         titles, upload-provider interface, publish manifest, lineage, release order
src/remotion        the only Remotion-aware code (composition, scenes, figure)
```

## Adding a video

1. Add the page to `config/videos.json` and write `fixtures/storyboards/<id>.storyboard.json`: claims as verbatim spans of the page; scenes, beats, and transitions from the closed vocabularies.
2. With `WALLETWALL_SOURCE_ROOT` set, `npm run plan`, then `npm run validate` until it passes.
3. `npm run render:stills <id>` and review every still, including the characterless ones.
4. `npm run pipeline <id>`.

## Status

v1, extracted from the WalletWall application repository with behaviour preserved: the extracted pipeline re-renders the same video byte for byte (see [docs/EXTRACTION.md](docs/EXTRACTION.md)). Ready now: the spec, normalizer, validator, layout, timeline, captions, cue sheet, choreography, renderer, staleness, lineage, and read-only CI. Fixture or dry run only: the storyboard planner (hand-authored), narration (silent, estimated timing), sonic assets (unassigned), and YouTube upload (dry-run receipt).

## License

The repository is [MIT](./LICENSE), with one explicit exception: a Python file that uses the Blender Python API (the eight Blender-side scripts under `blender/walletwallaby/`) is `GPL-3.0-or-later`, as Blender's FAQ requires of published scripts that call its API. Every file states its license in an SPDX header, the license texts are in [LICENSES/](./LICENSES), and `npm run rights:check` derives the boundary from the imports and fails if a file disagrees. Generated frames, `.blend` files, MP4s, WalletWall artwork, and narration are not made GPL by being produced with Blender.

Third-party software keeps its own license, and not everything is MIT: Remotion is source-available under the vendor's own terms (whether this project qualifies for its Free License is an open owner question), the bundled fonts are OFL-1.1, Mediabunny is MPL-2.0, and `caniuse-lite` is CC-BY-4.0. Notices are in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md), the reasoning in [docs/LICENSING.md](docs/LICENSING.md), and the rule that nothing is public until its rights are cleared in [docs/RELEASE_RIGHTS.md](docs/RELEASE_RIGHTS.md).
