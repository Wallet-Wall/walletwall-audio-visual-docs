# AGENTS.md

Rules for AI coding agents (Codex, Claude Code, Copilot, and others) working on this repository.

## Branch model

- `main` is the published branch. Do not push to it directly, except for repository scaffolding.
- Create a feature branch for every change, open a draft PR, and never merge your own PR. A human maintainer approves every merge.
- PRs must pass CI before merge.

## What this repository is

A deterministic pipeline that turns one published WalletWall docs page into a versioned video:
docs → normalized source → storyboard (selections only) → `VideoSpec` → validation → timeline → Remotion render → dry-run publish manifest. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything, and [docs/MOTION_ARCHITECTURE.md](docs/MOTION_ARCHITECTURE.md) before touching WalletWallaby.

## Hard rules

- **Docs are authoritative.** Never add a fact, number, or claim that the bound docs page does not state. The fix for a missing fact is a docs change in WalletWall, then a re-plan.
- **No generative channel.** Never add spec fields for JSX, CSS, styling, animation code, camera moves, or image/video/audio prompts. Never add asset kinds for stock footage, generated imagery, or AI presenters.
- **Determinism.** Nothing in the render path may read `Date.now()`, `Math.random()`, `performance.now()`, `requestAnimationFrame` timing, the environment, or the network. Motion is closed-form or fixed-step and pure. If randomness is ever needed it must be explicitly seeded and recorded in provenance; prefer none.
- **The lesson decides WHERE WalletWallaby goes; the motion system decides HOW.** Motion code may never choose, skip, or reorder a destination.
- **Fail closed.** Do not turn a validation error into a warning, skip a gate, or loosen an adversarial test to make a build pass.
- **Version what changes a frame.** A change to rig, motion, palette, or voice/sonic config bumps its declared version; the provenance tests enforce this.
- **Do not add a game engine.** No Phaser, Matter.js, Rapier, Three.js character conversion, ragdolls, particle systems, or camera shake. A new runtime dependency needs a concrete, documented need.
- **Blender performs; it never decides** ([docs/BLENDER.md](docs/BLENDER.md)). The Blender lane receives Motion Intelligence's decisions through `walletwall.blender-motion/v1` and maps them onto its body; it never chooses a destination, contact, time, or support, and no physics simulation, rigid body, or randomness enters it. Blender runs only through `src/blender/toolchain.ts` (the pinned build, fixed arguments, factory settings, auto-run disabled, offline, a minimal environment), only the lane's own entry scripts, and only on job files inside `dist/blender/jobs/`. The VideoSpec never gains a Python, path, camera, or style field, and Blender never renders public copy.
- **Attention direction guides, it never moves** ([docs/ATTENTION.md](docs/ATTENTION.md)). The mode (ESTABLISH, GUIDE, INSPECT, COMPARE, RESOLVE, TRANSITION) is derived from the authored beats, never authored: the VideoSpec never gains a camera, framing, emphasis, or animation field. The hierarchy changes an element's opacity, wash, or rule, never its position; the bounded camera frames the whole content world as one unit (one transform about the frame centre, the character included), is identity through every transition, brand segment, and the end screen, fails closed to identity when a text region would leave title-safe, and never rotates, drifts, or shakes. `config/attention.json` is part of the build identity.
- **Nothing WalletWall authors is white** ([docs/BLENDER_VISUAL.md](docs/BLENDER_VISUAL.md)). Cards and panels are warm parchment, the character's accents and every terrain formation come from the brand's stone, tan and terracotta, and `src/blender/visual-core.ts` refuses any white-ish colour (luma at least 0.80 with chroma at most 0.14). The terrain family under the dedicated supports (the ground, the summit ledge, the pillars, the slabs) is cut inside each support's declared rectangle: its top edge and contact faces stay on the declared coordinates (`src/layout/rock.ts`), and a card or node is never turned into rock. External captured UI may contain white; authored surfaces may not. `npm run test` runs the audit (`src/blender/white-audit.ts`); a new white-reading token in `src/remotion` is forbidden until it is named as an exception there.

- **A Python file that uses the Blender API is GPL, and nothing is cleared by default** ([docs/LICENSING.md](docs/LICENSING.md), [docs/RELEASE_RIGHTS.md](docs/RELEASE_RIGHTS.md)). The repository is MIT, but a script that reaches the Blender Python API (directly or through a sibling it imports) is `GPL-3.0-or-later` and carries that SPDX header; `npm run rights:check` derives the boundary from the imports, and a new Python file, dependency license, spec asset, sonic asset, or crate must be recorded in `config/release-rights.json` or it fails. Never mark an item `CLEARED` for being available online, for running, or for being in the lockfile: an unknown rights status stays `UNKNOWN`, `UNVERIFIED`, or `OWNER_CONFIRMATION_PENDING`, and only the owner clears a vendor's, provider's, or third party's terms. An owner-authored or generated item is `CLEARED` only on the owner's `provenance` record, bound by sha256 to the committed bytes; never write one the owner has not stated, and an edit to a bound file (a lane module, the rig contract, `versions.ts`, the brand mark, a reference frame) reopens the item until its record is re-established. Only the owner authorizes `UNLISTED` to `PUBLIC`.

- **A narration voice is used on a rights-and-consent basis** ([docs/RELEASE_RIGHTS.md](docs/RELEASE_RIGHTS.md), "Voice rights"). It is allowed only when its rights are established: a provider-designed voice, a Professional Voice Clone its verified owner published for others, or a voice its speaker authorized in writing with the commercial scope documented. Never clone a voice, or use reference audio, without the speaker's authorization; never impersonate; never record a speaker's voice or likeness as WalletWall's; never use a voice outside the scope its provider or rights holder granted; never bypass or ignore a provider control, or evade a takedown, restriction, or withdrawal of authorization. A new or changed narration voice needs its own `voiceRights` record in `config/release-rights.json` (the check binds it to the voice `config/narration-providers.json` names), and clearing it is the owner's.

## Canonical sources and public safety

- This repository is public. Only public-safe material belongs here.
- Canonical WalletWall inputs enter only as byte-identical, blob-bound fixtures listed in `fixtures/canonical/MANIFEST.json`, and only files that are already public (published docs pages, the docs navigation, public brand assets). Never copy internal docs, audits, private application code, or anything the docs site excludes from publishing.
- Brand tokens come from `contracts/walletwall-brand.json`. Do not invent a color; do not hard-code a token value outside the contract.

## Secrets and publishing

- Never add API keys, tokens, service-account JSON, or wallet credentials. Provider bindings name environment variables only.
- Never handle YouTube, voice-provider, or rendering credentials. Never run, dispatch, or add an upload step; never set a video public. Publishing is human-triggered only and, in v1, cannot express `public` at all.
- CI stays read-only and fork-safe: `pull_request` (never `pull_request_target`), `contents: read`, `persist-credentials: false`, no secrets.

## Required checks

Report exact results in the PR:

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run plan:check`
- `npm run validate`
- `npm run rights:check` (and `npm run rights:check -- --public-release` before any public release; it fails while any item is not `CLEARED`)
- `npm audit --audit-level=moderate`
- `git diff --check`
- for anything visual: `npm run render:stills migration-readiness` (WalletWallaby is drawn by the pinned Blender: set `WALLETWALL_BLENDER`), with before/after stills attached
- for anything that changes an authored colour or a formation under `src/remotion/` or `src/layout/rock.ts`: `node scripts/review/white-audit.ts --before=<main's stills> --after=dist/migration-readiness/stills` (settled characterless stills; must PASS)
- for any edit to a file under `blender/walletwallaby/` (even a comment or a license header): the lane source is hashed into the Blender identity, so re-render the proof set on the production class and re-export the reference (`npm run blender:proof -- render --run=<id>`, then `-- export-reference --run=<id>`); the frames must stay byte-identical when the edit was not meant to change them
- for anything under `blender/`, `src/blender/`, or the rig (`src/character/walletwallaby/`) (with the pinned Blender, `WALLETWALL_BLENDER`): `npm run blender:invariants`, `npm run blender:determinism -- --frames=1766,1776,1804,1843,1855,1861,1867,1929`, and `npm run blender:review`, with before/after stills attached; a change to the body or its materials updates `BLENDER_CHARACTER` deliberately
- before any publication: `npm run publication:proof` on the production render host (a publication class in `config/blender-environments.json`); CI never renders the whole video
- for anything under `motion-intelligence/` (in that directory): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings`, `cargo test`; then `npm run motion:build` and `npm run motion:check` on Linux or WSL (the committed WASM is a canonical Linux build), and `npm run motion:fixtures` after a deliberate behaviour change ([docs/MOTION_INTELLIGENCE.md](docs/MOTION_INTELLIGENCE.md))

## Copy

Neutral wallet language ("this wallet", "the address"); never "your wallet". No hype, fake urgency, or guarantees. Calls to action come only from `config/copy-templates.json`.
