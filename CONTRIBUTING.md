# Contributing

## Setup

Node.js 24 is required: the TypeScript sources run directly under Node's type stripping, with no build step.

```bash
npm ci
npm run check        # typecheck + tests + plan:check + validate
```

No API keys or `.env` file are needed. Narration timing is estimated, the planner is a committed fixture storyboard, and uploads are dry runs.

## Branch model

- `main` is the published branch. Do not push to it directly.
- Create a feature branch and open a pull request against `main`.
- One change per pull request: extraction, character, motion, audio, providers, and publishing changes stay separate.

## Before opening a pull request

```bash
npm run check
npm run render:stills migration-readiness   # visual review: settled frames, with and without WalletWallaby
npm audit --audit-level=moderate
git diff --check
```

A change that alters what a video shows or says must say so in the PR, attach before/after stills, and bump the relevant version (spec revision, rig version, motion config version).

## Ground rules

- **Docs are the authority.** Do not add facts, numbers, or claims here. If a video needs a fact the docs do not state, change the docs first (in the WalletWall docs), then re-plan.
- **No generative channel.** Do not add spec fields for styling, code, camera moves, prompts, stock footage, or generated imagery.
- **Determinism.** Anything that affects a frame must be a pure function of the spec, the committed config, and the frame number. No `Date.now()`, `Math.random()`, browser timing, or wall-clock simulation in the render path.
- **Fail closed.** Validation errors block rendering and publishing. Do not downgrade an error to a warning to make a build pass.
- **Do not weaken the adversarial tests** (Unicode and quote evasion, path and symlink containment, numeric hardening, occlusion). Extend them.
- **Copy rules.** Neutral wallet language: "this wallet", "the address", never "your wallet". No hype, fake urgency, or guarantees. Calls to action come only from the versioned templates.

## Fixtures and canonical sources

`fixtures/canonical/` holds byte-identical copies of the few canonical WalletWall files the tests need, each bound to its git blob id. They are not an independent source of truth: tests fail if a copy drifts from its recorded blob, and `npm run freshness` compares against a real WalletWall checkout when `WALLETWALL_SOURCE_ROOT` points at one.

## Secrets

Never commit API keys, tokens, credentials, `.env` files, or provider configuration with real values. If you find one, stop and follow [SECURITY.md](./SECURITY.md).
