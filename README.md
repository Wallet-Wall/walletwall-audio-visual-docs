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
- semantic audio (narration, music bed, semantic cues, sonic ident)
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
- The LLM planner, voice, renderer, and upload target each sit behind an interface, so any of them can be replaced without changing the spec format. Today the planner is a hand-authored fixture storyboard and narration timing is estimated (silent review renders).
- **YouTube publishing is unlisted and manual-review-first.** The v1 upload type cannot express `public`; a human reviews every upload before it goes public. A materially updated video is a new upload with lineage, never an overwrite.

Remotion is licensed separately from this repository: free for individuals and companies of up to three people; larger organizations need a [company license](https://www.remotion.dev/license).

## Status

The pipeline is being extracted from the WalletWall application repository on the `feat/bootstrap-video-pipeline` branch, with behaviour preserved and proven by re-rendering the same video. Until that lands, `main` holds the repository charter only.

## License

[MIT](./LICENSE). Remotion, fonts, and other dependencies keep their own licenses.
