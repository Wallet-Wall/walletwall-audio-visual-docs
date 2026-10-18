# Continuous integration

This repository produces public-facing WalletWall videos, so CI checks two things: that the source is correct, and that the public output is. Every workflow is read-only and credential-free, and safe on fork pull requests.

## Checks

| Workflow | Check | Runs on | Required to merge |
|---|---|---|---|
| CI (`ci.yml`) | `Verify pipeline` | pull requests, pushes to `main` | yes |
| CI (`ci.yml`) | `Motion Intelligence (Rust/WASM)` | pull requests, pushes to `main` | yes |
| CodeQL (`codeql.yml`) | `Analyze (actions)`, `Analyze (javascript-typescript)` | pull requests to `main`, pushes to `main`, weekly | yes |
| CodeQL (code scanning) | `CodeQL` (the alert verdict on a pull request) | pull requests to `main` | yes |
| Public Output (`public-output.yml`) | `Public surface` | pull requests, pushes to `main` | yes |
| Public Output (`public-output.yml`) | `Render determinism` | pull requests, pushes to `main` | yes |
| Public Output (`public-output.yml`) | `Dependency review` | pull requests | yes |
| Publication Proof (`publication-proof.yml`) | `Publication proof` | manual dispatch; pushes to `main` that change render inputs | no |

No required check is path-filtered: a required check that does not run on a pull request would block it forever.

## Publication safety invariant

CI can prove publication readiness. CI must not publish.

- No workflow can obtain a YouTube, Google OAuth, voice-provider, or repository-write credential. The token is read-only (`contents: read`), checkouts do not persist it, and no workflow references a secret or a repository variable (`test/guards.test.ts` enforces this). The public-output gate also fails if a publication credential appears in its environment.
- The only upload provider in the codebase is the credential-free `DryRunUploadProvider`, and no code can state a live receipt (also enforced by `test/guards.test.ts`). The gate refuses a package that describes a live upload or an initial privacy other than unlisted.
- Actual YouTube publication is a separate, explicitly authorized, human-triggered action after human review (`publish-manifest.json`: `review.gate` is `HUMAN_REVIEW_BEFORE_PUBLIC`). Initial uploads stay unlisted under the current publication policy (`config/youtube.json`).
- A stronger check that needs a credential (a live voice, a private checkout) belongs in a separate, non-required, trusted workflow, never in a pull-request check.

## Public surface

`npm run public:check` (`scripts/public-output-check.ts`, logic in `src/publish/public-output.ts`) inspects the package that `publish:dry-run` actually wrote to `dist/<id>/`, and fails closed:

- Validation and media QA have no blocking error, including a report that claims `ok` while listing errors, and a fresh validation of the committed spec agrees with what provenance recorded.
- The receipt and the manifest describe a dry run: mode `DRY_RUN`, no YouTube id, the lineage unchanged, and initial privacy `unlisted`.
- The WebVTT and SRT captions exist and are byte-identical to the captions the committed narration produces, which pass the caption QA. Narration the gate cannot re-derive (anything but the fixture voice) is refused.
- The manifest is internally consistent (platform rules from `checkPublishManifest`, the human review gate, chapters inside the video, and the captions, video, spec hash, and docs identity it names), and it is exactly the manifest this checkout produces: the gate re-derives it with the same function the dry run uses, which also covers inputs the build identity does not hash, such as `config/playlists.json`.
- Provenance exists and matches the committed spec, its canonical docs binding (doc path, URL, blob, content hash), the cue sheet, the render, and this checkout's build identity.
- A render, when present (required with `--require-render`): `render.json` matches the MP4 bytes, the committed spec (its hash: an on-screen text edit changes neither the timeline nor the build identity), this checkout's build identity and renderer, the committed timeline, and a motion engine identity this checkout reproduces (for rust-wasm: the exact WASM artifact, config, and re-solved plans). The debug guides overlay and the characterless design test are refused as a publication render. `publish:dry-run` also refuses a render of a different spec.
- Review stills, with `--stills=<dir>`: every PNG is the bytes `stills.json` names, nothing unlisted is left over, the spec hash, identity, and motion engine are current, every frame has a characterless twin, and a twin differs from its frame wherever WalletWallaby is on canvas (this catches a variant that silently rendered the default props). PNGs may not carry text or unknown metadata chunks.
- Public copy (the YouTube title, description, tags, chapter and playlist titles, the captions, and the on-screen text) has no unresolved placeholder or leaked value: `TODO`, `TBD`, `FIXME`, lorem ipsum, `[object Object]`, `undefined`, `NaN`, `${…}`, `{{…}}`.
- No artifact contains a local machine path: Windows drive and UNC paths, home directories (`/home/`, `/Users/`, `/root/`, `~/`), temporary and system directories (`/tmp/`, `/var/`, `/opt/`, `/mnt/`, `/private/`, and the like), `file://` URLs, or this machine's checkout, home, temporary, and CI workspace directories. Repo-relative paths, `video/…` workspace paths, and URLs are not paths.

With `--bundle=<empty dir>` and a PASS, the gate copies exactly the files it verified, re-hashing each one, plus its report (`public-output-check.json`). Nothing is bundled from a package with findings.

```bash
npm run validate
npm run publish:dry-run
npm run public:check
```

## Render determinism

The default engine renders the standard review stills (one settled frame per segment and the midpoint of every non-cut transition, each with and without WalletWallaby) twice, each in a fresh Node process, and `npm run stills:compare` requires every PNG and `stills.json` to be byte-identical. The opt-in Rust/WASM engine does the same on one airborne frame of every path it performs: the middle of the frames where the engine's own plan has the feet off every surface (`scripts/engine-path-frames.ts`), so the review set draws the flight the engine solves. Rust frames are never compared with default-engine frames, because the body motion intentionally differs. MP4 bytes are not run-to-run stable, so an MP4 hash is never used as determinism evidence.

## Review evidence

`Render determinism` uploads `public-output-review-<attempt>` for 14 days: both engines' review stills and `stills.json`, the publication package (manifest, provenance, captions, cue sheet, media QA, validation, receipt), and the gate report. It is exactly the bundle the gate verified, so it holds no credentials, caches, environment dumps, `node_modules`, or local paths.

## Publication proof

Run **Actions → Publication Proof → Run workflow** and choose the motion engine (`typescript` by default; `rust-wasm` stays opt-in). It renders the full video with the fixture voice, runs the publish dry run against that exact render, runs the gate with the render required, and uploads `publication-proof-<attempt>` for 14 days: the MP4, `render.json`, provenance, the manifest, captions, cue sheet, media QA, validation, receipt, and the gate report. The proof render is a review render (silent fixture narration, captions burned in), and it is never uploaded anywhere else. Human review remains mandatory before any publication.

## Supply chain

Every action is pinned to a full commit SHA, and the comment names the release the pin was resolved from (`test/guards.test.ts` enforces both). The existing actions were pinned to the exact commits their floating major tags pointed to, so behaviour did not change. Dependabot (`.github/dependabot.yml`, `github-actions` ecosystem) proposes pin updates; review a pin bump like a code change.

| Action | Release | Commit |
|---|---|---|
| `actions/checkout` | v5.1.0 | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` |
| `actions/setup-node` | v5.0.0 | `a0853c24544627f65ddf259abe73b1d18a591444` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `actions/dependency-review-action` | v5.0.0 | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` |
| `github/codeql-action` (`init`, `analyze`) | v4.39.0 | `6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee` |

`Dependency review` blocks a pull request that adds a dependency (npm, Cargo, or GitHub Actions) with a known vulnerability of moderate severity or worse in any scope: the same bar as `npm audit --audit-level=moderate`, which also covers development dependencies.

It sets no license policy. The repository is MIT, and the installed tree is mostly MIT, ISC, BSD, and Apache-2.0, but the renderer is not: nine Remotion packages carry Remotion's own source-available license (not an SPDX identifier), eight Remotion packages declare no license field, and the tree also includes MPL-2.0 (`mediabunny`), OFL-1.1 (the bundled fonts), and CC-BY-4.0 (`caniuse-lite`). An SPDX allowlist would either block the renderer or admit everything, and Remotion's company license is an owner decision (see the README), not a CI rule.

## Branch protection

`main` is protected by a repository ruleset:

- Changes arrive through pull requests; direct pushes, force pushes, and deletion of `main` are blocked.
- Every required check in the table above must pass, on a branch that is up to date with `main`. Workflow checks are bound to the GitHub Actions app, and `CodeQL` to GitHub code scanning, so a status from anywhere else cannot satisfy them.
- No approving review count is set, because the maintainer opens most pull requests and GitHub does not let an author approve their own. Anyone with write access can merge a pull request once every required check passes. Raising the count to 1 would put a second person on every merge; the maintainer's own pull requests would then need a collaborator's approval or a recorded bypass.
- Repository administrators may bypass the rules on a pull request only, as a recorded owner-recovery path. They cannot push to `main` directly.
