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
- **Nothing WalletWall authors is white** ([docs/BLENDER_VISUAL.md](docs/BLENDER_VISUAL.md)). Cards and panels are warm parchment, the character's accents and every terrain formation come from the brand's stone, tan and terracotta, and `src/blender/visual-core.ts` refuses any white-ish colour (luma at least 0.80 with chroma at most 0.14). The terrain family under the dedicated supports (the ground, the summit ledge, the pillars, the slabs) is cut inside each support's declared rectangle: its top edge and contact faces stay on the declared coordinates (`src/layout/rock.ts`), and a card or node is never turned into rock. External captured UI may contain white; authored surfaces may not. `npm run test` runs the audit (`src/blender/white-audit.ts`); a new white-reading token in `src/remotion` is forbidden until it is named as an exception there.

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
- `npm audit --audit-level=moderate`
- `git diff --check`
- for anything visual: `npm run render:stills migration-readiness`, with before/after stills attached
- for anything that changes an authored colour or a formation under `src/remotion/` or `src/layout/rock.ts`: `node scripts/review/white-audit.ts --before=<main's stills> --after=dist/migration-readiness/stills` (settled characterless stills; must PASS)
- for anything under `blender/` or `src/blender/` (with the pinned Blender, `WALLETWALL_BLENDER`): `npm run blender:determinism -- --frames=1812,1822,1850,1904,1916,1922,1928,1990` and `npm run blender:review`, with before/after stills attached
- for anything under `motion-intelligence/` (in that directory): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings`, `cargo test`; then `npm run motion:build` and `npm run motion:check` on Linux or WSL (the committed WASM is a canonical Linux build), and `npm run motion:fixtures` after a deliberate behaviour change ([docs/MOTION_INTELLIGENCE.md](docs/MOTION_INTELLIGENCE.md))

## Copy

Neutral wallet language ("this wallet", "the address"); never "your wallet". No hype, fake urgency, or guarantees. Calls to action come only from `config/copy-templates.json`.
