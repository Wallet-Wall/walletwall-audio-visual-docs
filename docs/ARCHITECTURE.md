# Architecture

> Docs supply authority. The planner selects meaning. WalletWall defines the visual and sonic language. WalletWallaby guides the viewer through the information terrain. Remotion renders deterministically. Validation decides whether the artifact is publishable.

## Pipeline

```text
canonical docs page ──normalize──▶ NormalizedSource (+ committed snapshot, content hashes)
                                        │
StoryboardProvider (fixture today, LLM later) ──▶ Storyboard (selections only)
                                        │ assemble (provenance, brand templates, video class)
                                        ▼
                                    VideoSpec ──validate──▶ ValidationReport (machine-readable codes)
                                        │
VoiceProvider ──▶ NarrationTrack ──▶ Timeline (integer ms) ──▶ captions · semantic cue sheet · choreography
                                        │
                     RendererAdapter (Remotion) ──▶ MP4 + render.json
                                        │
                     UploadProvider (dry run in v1) ──▶ publish manifest · provenance · lineage
```

The `VideoSpec` names no renderer, voice provider, upload target, or model. Each of those sits behind an interface: `StoryboardProvider`, `VoiceProvider`, the Remotion adapter, and `UploadProvider`. The narration adapters and the voice bakeoff that evaluates them live behind the same boundary and off the render path; see [NARRATION.md](NARRATION.md).

Narration length is constrained upstream by the video class. The narration budget (`src/spec/narration-budget.ts`; [NARRATION.md](NARRATION.md), "Narration budget") gives each class a spoken-word cap at the voice identity's planning pace: validation rejects a spec over it (`NARRATION_OVER_BUDGET`), and no voice provider, paid or local, is called with narration over it.

## Two trees, one namespace

This repository consumes the canonical WalletWall source tree; it never becomes a second source of truth.

- **Workspace paths.** Every path inside a spec is a WalletWall workspace path. `video/…` names a file in *this* repository (it was born as the `video/` package of the WalletWall workspace, and keeping the namespace keeps every committed spec and hash byte-stable). Every other path (`docs/…`) names a file in the canonical WalletWall tree.
- **The canonical source root** is a local WalletWall checkout named by `WALLETWALL_SOURCE_ROOT`. Without one, the pipeline falls back to `fixtures/canonical/`: byte-identical copies of the few public canonical files the tests need, each listed with its git blob id and sha256 in `fixtures/canonical/MANIFEST.json`. Every load re-hashes the copy and fails closed on drift. The mirror holds only public files: it withholds `docs/.mintignore` (it names internal material) and records instead that, at its blob, it excluded no existing navigation page, which `npm run contracts:check` re-verifies against a checkout.
- **Freshness** compares the committed snapshot with whatever the source root holds. Against the fixture mirror it can only say "unchanged since extraction"; real staleness detection runs against a real checkout.
- **Brand tokens** come from `contracts/walletwall-brand.json`: the values, plus the blob ids of the canonical files they were read from. `npm run contracts:check` re-reads those files from a canonical checkout and fails on any drift.

## Claims are verbatim spans

Every substantive spoken line and on-screen text element cites claims. Every claim cites evidence: a verbatim span (at least three words, word-boundary matched, whitespace- and emphasis-insensitive) of a named doc section, or a hashed repository artifact for `MEASURED` / `DEMONSTRATED`, where only a verbatim excerpt of the artifact's own text counts. Numbers and quantity words must appear in the cited evidence; graph labels must appear as whole words in theirs; an ascending layout must match a cited order. `INTERPRETATION` lines must open with a configured marker ("In other words", …). Brand copy (ident, CTA, docs reference, outro, end screen) comes only from versioned templates. Spoken and on-screen text must be NFKC-stable, visible, Latin-script text, which closes zero-width and look-alike-character bypasses.

## No generative channel

The spec has no field for styling, code, camera, or prompts; validation rejects unknown keys and flags generative-looking keys separately. Asset kinds follow a preferred-source hierarchy and have no value for stock footage, generated imagery, or presenters. Each kind may only come from its reviewed location. Paths must be plain relative POSIX paths with no parent, hidden, or dependency segments, and are re-checked after symlink resolution. Only spec-declared, hash-verified assets are staged into the render bundle, and the render command refuses any spec that fails validation.

## Small grammars

Scene types `CARD`, `GRAPH`, `UI`, `TAKEAWAY`, each with fixed layouts. WalletWallaby has ten actions (`HOP`, `LAND`, `PERCH`, `INSPECT`, `TRACE`, `REVEAL`, `COMPARE`, `PUSH_THROUGH`, `DIMENSION_JUMP`, `RESOLVE`), six expressions, and nine poses. The planner picks an action and a target anchor. The choreography fixes where and when; a deterministic motion system (ballistic hops, ledge mantles, contact, compression, settle, a tail that balances, braces, and rests as a support, a tiny bounded platform response) decides how, and can never change a destination. Each scene grammar also declares what its drawn elements offer a body (a top to stand on, a ledge, a face to brace or grip, or drawn information that is never terrain), and every contact WalletWallaby makes is judged against it: where an anchor authors several stands, the best-supported one is chosen, and a render is refused if any contact could not really carry him. WalletWallaby is drawn by the pinned Blender, as WalletWallrus's sibling (one rounded mass in WalletWallrus's coat colour, charcoal outline, warm stone accents, the wall built into the belly, a long signature tail): the rig contract resolves each frame's pose and IK targets from the frame alone, Blender poses its code-built body on them and renders a small lossless crop, and Remotion places the crop and owns time ([BLENDER.md](BLENDER.md)). See [MOTION_ARCHITECTURE.md](MOTION_ARCHITECTURE.md).

The terrain metaphor is geometry, not a game: cards and graph nodes are platforms, edges are dashed trails that turn terracotta when traced (WalletWallaby bounds between the nodes; the trail is never stood on), ascending order is shown as rising masonry pillars only when a claim states the order, and depth is a pair of stacked masonry slabs. No HUD, score, or collectibles.

**The 2D → 3D move is earned.** `DEPTH_ENTER` requires a `PUSH_THROUGH` beat, one of four lesson reasons (summary → internals, result → evidence, interface → mechanism, flat → layered), a budget of two per video unless justified, and a balanced return to the surface.

**The design test is enforced.** WalletWallaby beats carry no text, so the character is never the only carrier of information. `WALLABY_OCCLUDES_TEXT` fails any beat that would stand the character over text, layout tests prove every anchor of every scene grammar is clear, and every review render also produces characterless stills.

## Timing and audio

The planner orders lines and cues; the voice track supplies durations (the fixture estimates at 145 wpm with punctuation pauses); the timeline is integer milliseconds; the renderer converts to frames at the edge. The assembler picks the shortest class the runtime fits: Quick (≤ 3 min), Focused (≤ 5 min), Deep dive (≤ 10 min). Narration above 165 wpm fails validation — split, never speed up.

Audio is semantic: actions and transitions map to a small sonic vocabulary with per-event minimum gaps; `INSPECT` is deliberately silent; quantum sonic events are valid only for sources in a quantum docs domain. Sonic identity, music bed, and cue assets are versioned ids, currently unassigned (silence), never generated at render time.

## Staleness

The committed normalized snapshot is compared with the live doc. Line-ending, emphasis, and link-target edits are cosmetic; a single-character edit of a long word inside a cited span is `TYPO_ONLY` (numbers, signs, short words, and affix changes are always meaning changes); title, description, and outline edits are `MINOR_EXPLANATION`; a missing cited span is `CLAIM_CHANGED`, escalated to `MECHANISM_CHANGED` when it backs graph structure and `CONCLUSION_CHANGED` when it backs the takeaway; diagram structure changes are `DIAGRAM_CHANGED`. Freshness: `CURRENT` < `COSMETICALLY_STALE` < `REGENERATION_REQUIRED` < `MATERIALLY_STALE`.

## Provenance

A rendered video traces back to: the doc blob id, normalized content hash, and normalizer version; every claim's quote hash; every asset's sha256; the `VideoSpec` hash; the lockfile hash and renderer version; the character rig, motion config, voice, and sonic config versions; the pinned Blender build, its config and lane source, the pinned character model and materials, and the render environment class the frames were made in; the validation outcome; and the MP4 sha256. Uploads are lineage, never overwrites: a materially updated video is a new revision and a new upload, waiting in `UNLISTED_REVIEW` until a human publishes it.

## Security

- No credentials in the repository, specs, manifests, logs, frames, or the browser bundle. Provider bindings name environment variables only; the render bundle never reads the environment; publish manifests fail QA if a credential-shaped environment value appears in them.
- CI is `contents: read`, uses only GitHub-owned actions with `persist-credentials: false`, takes no secrets, and runs on `pull_request`, never `pull_request_target`.
- There is no publishing workflow in v1. A future one must be a separate `workflow_dispatch` workflow gated to this repository, bound to a protected environment with required reviewers, holding least-privilege upload scope, and consuming only artifacts from the read-only verify job.

## Ready now vs fixture or dry run

| Ready now | Fixture or dry run only |
|---|---|
| Spec types and vocabularies; normalizer; validator; layout and text fit; timeline; captions; semantic cue sheet; choreography; Remotion composition and render; staleness classification; lineage and release planning; read-only CI | Storyboard (hand-authored fixture standing in for an LLM planner); narration (silent, estimated durations); sonic identity, music bed, and cue assets (unassigned); YouTube upload (dry-run receipt); playlist ids (null until created) |

## Open owner decisions

1. Remotion company-license status.
2. Voice provider. Decided for now: ElevenLabs Multilingual v2 is the publication narration provider and Qwen3-TTS is R&D and a local fallback ([NARRATION.md](NARRATION.md), "Production policy"); wiring the provider into renders is the integration step there. The WalletWallaby voice identity itself is decided: an Australian English expedition guide, natural and not caricatured (`config/voice-identity.json` v2, [NARRATION.md](NARRATION.md)); casting must not imitate a real person.
3. Freshness severity order (`MATERIALLY_STALE` is treated as more severe than `REGENERATION_REQUIRED`: wrong beats visually outdated).
4. Release-plan weights (`config/release-plan.json`) are an initial proposal.
5. Synthetic-media disclosure default (`containsSyntheticMedia: true`).
