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
| Public Output (`public-output.yml`) | `Dependency review` | pull requests | not yet: it needs the repository's dependency graph (Settings → Code security), and fails until that is enabled |
| Blender proof (`blender-proof.yml`) | `Blender proof (same-class bytes, cross-class tolerance)` | manual dispatch | no |

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
- The WebVTT and SRT captions exist and are byte-identical to the captions the committed narration produces, which pass the caption QA. Narration the gate cannot re-derive (anything but the fixture voice, or, with `--narration=publication`, the verified publication narration set it replays and bundles under `narration/`) is refused.
- The manifest is internally consistent (platform rules from `checkPublishManifest`, the human review gate, chapters inside the video, and the captions, video, spec hash, and docs identity it names), and it is exactly the manifest this checkout produces: the gate re-derives it with the same function the dry run uses, which also covers inputs the build identity does not hash, such as `config/playlists.json`.
- Provenance exists and matches the committed spec, its canonical docs binding (doc path, URL, blob, content hash), the cue sheet, the render, and this checkout's build identity.
- A render, when present (required with `--require-render`): `render.json` matches the MP4 bytes, the committed spec (its hash: an on-screen text edit changes neither the timeline nor the build identity), this checkout's build identity and renderer, the committed timeline, and a motion engine identity this checkout reproduces (for rust-wasm: the exact WASM artifact, config, and re-solved plans). The debug guides overlay and the characterless design test are refused as a publication render. `publish:dry-run` also refuses a render of a different spec.
- The Blender character, for a render and for stills: the pinned Blender build, this checkout's Blender config, lane source, and pinned character model and materials; frames rendered from exactly the MotionPlan this checkout gives for those frames (the whole lesson, or the stills' frames), and the depth reveal wherever the frames reach it; and an approved render-environment class (`config/blender-environments.json`), re-derived from the recorded environment so a forged label fails. A render to publish must come from a publication class.
- Review stills, with `--stills=<dir>`: every PNG is the bytes `stills.json` names, nothing unlisted is left over, the spec hash, identity, and motion engine are current, every frame has a characterless twin, and a twin differs from its frame wherever WalletWallaby is on canvas (this catches a variant that silently rendered the default props). PNGs may not carry text or unknown metadata chunks.
- Public copy (the YouTube title, description, tags, chapter and playlist titles, the captions, and the on-screen text) has no unresolved placeholder or leaked value: `TODO`, `TBD`, `FIXME`, lorem ipsum, `[object Object]`, `undefined`, `NaN`, `${…}`, `{{…}}`.
- No artifact contains a local machine path: Windows drive and UNC paths, home directories (`/home/`, `/Users/`, `/root/`, `~/`), temporary and system directories (`/tmp/`, `/var/`, `/opt/`, `/mnt/`, `/private/`, and the like), `file://` URLs, or this machine's checkout, home, temporary, and CI workspace directories. Repo-relative paths, `video/…` workspace paths, and URLs are not paths.
- No artifact contains a secret-shaped value (a private key, GitHub, AWS, Google, Slack, or API secret key, a JSON web token, a bearer token, credentials inside a URL; `SECRET_SHAPED`), and no record of the render (render and stills records, PNG and MP4 metadata) names this machine's host or user (`MACHINE_NAME`). Authored copy is not scanned for names, and a name that is a word of the committed records is no leak signal. One policy, `src/core/leak-scan.ts`, serves the gate, the render-environment schema, and the publication proof receipt.
- The render environment each record names is a closed schema (`src/blender/environment.ts`): a field outside it fails closed, and a refusal names what changed against the nearest approved class.

With `--bundle=<empty dir>` and a PASS, the gate copies exactly the files it verified, re-hashing each one, plus its report (`public-output-check.json`). Nothing is bundled from a package with findings.

```bash
npm run validate
npm run publish:dry-run
npm run public:check
```

## Render determinism

WalletWallaby is drawn by the pinned Blender (docs/BLENDER.md), which the job installs and verifies like `blender-proof.yml` does; on a hosted runner it renders in the proof class (CPU software GL), about ten seconds per character frame. Both renders run on the same runner, in sequence: Chrome's software rasterizer and Mesa's llvmpipe choose code paths by the host CPU, so byte identity is a promise about one machine, never across runners. Render A builds the character from code (`--fresh-blender`); render B renders every Blender frame again from that build (two builds of the same source are proven identical by the Blender proof workflow).

The default engine renders the standard review stills (one settled frame per segment and the midpoint of every non-cut transition, each with and without WalletWallaby) twice, each in a fresh Node process, and `npm run stills:compare` requires every PNG and `stills.json` to be byte-identical. The opt-in Rust/WASM engine does the same on one airborne frame of every path it performs: the middle of the frames where the engine's own plan has the feet off every surface (`scripts/engine-path-frames.ts`), so the review set draws the flight the engine solves. Rust frames are never compared with default-engine frames, because the body motion intentionally differs. MP4 bytes are not run-to-run stable, so an MP4 hash is never used as determinism evidence.

### One paint per frame

`DocsVideo` paints nothing until the brand fonts have loaded, and releases its `delayRender` handle only after the frame drawn with the fonts has been committed (`src/remotion/DocsVideo.tsx`). Before that, the composition painted first with the fonts still loading and repainted the text when they arrived. Chromium then re-rasterized only the invalidated parts of tiles it had already rasterized (cc partial raster), and inside such a clipped replay Skia's anti-aliased edge coverage can round one level differently from a full-tile raster. Whether the repaint arrived before or after the first raster was a race, so the same frame came out as one of two bitmaps.

Measured on 2026-10-19 on a Windows 11 host with Chrome Headless Shell 149.0.7790.0 as `@remotion/renderer` 4.0.532 launches it (software compositing and software raster on SwiftShader, not the hardware GPU), frame 1789 of `migration-readiness` (`06-signals-transition`, the DEPTH_ENTER midpoint) came out as one of two bitmaps. They differed in 27 pixels, 26 by one level and 1 by two, on the right edge of the `node:migrate` platform and the left edge of the `pillar:vault-candidate` platform of the exiting scene (screen x 1256..1406, y 595..645). Across 24 renders with three concurrent browsers the alternate bitmap appeared 8 times on main `b169f27` and 3 times on the attention-direction head `a6d89ea`, with identical bitmaps on both. The 3D transform was not the cause: the flip survived with the exit opacity, the platform shadow, the enter layer's transform and opacity, or the perspective removed, and survived `will-change`, `backface-visibility: hidden`, `isolation: isolate`, `contain: paint`, `translateZ(0)`, eased values rounded to 1/1000, `--num-raster-threads=1`, and `--run-all-compositor-stages-before-draw`. Two changes made 24 of 24 renders identical, both to the bitmap main's standard still already had: Chromium's `--disable-partial-raster`, and painting nothing until the fonts are loaded. The composition change is the one that ships, because Remotion exposes no option for that Chromium flag. The Linux check had never flipped; the change removes the race instead of relying on that timing.

When `stills:compare` reports a difference, diff the two PNGs (pixel count, maximum channel delta, bounding box), render the frame repeatedly in fresh processes, and look at which elements the differing pixels sit on. A one-level difference confined to anti-aliased edges that alternates between renders is a repaint race of this kind; a regression shows as a different region, larger deltas, or a difference that does not alternate.

## Review evidence

`Render determinism` uploads `public-output-review-<attempt>` for 14 days: both engines' review stills and `stills.json`, the publication package (manifest, provenance, captions, cue sheet, media QA, validation, receipt), and the gate report. It is exactly the bundle the gate verified, so it holds no credentials, caches, environment dumps, `node_modules`, or local paths.

## Publication proof

The whole-video proof runs on the production render host, not in CI: a hosted runner would render every Blender frame of the lesson in software GL, which takes many hours, and only the production host is a publication class. Run `npm run publication:proof` there (`-- --motion-engine=rust-wasm` for the opt-in engine). It validates the spec, renders the full video with the fixture voice (reusing verified Blender frames), runs the publish dry run against that exact render, and runs the gate with the render required, which refuses a render from any class that is not a publication class. On PASS the proof package is in `dist/publication-proof/`: the MP4, `render.json`, provenance, the manifest, captions, cue sheet, media QA, validation, the dry-run upload receipt, the gate report, the evidence (the invariants report, Blender's render manifests), and the publication proof receipt (`publication-proof-receipt.json`), which binds all of it and is verified with `npm run publication:verify-receipt -- <receipt>` ([PUBLICATION.md](PUBLICATION.md)). The proof stops before rendering the video if the host's render environment is not an approved publication class, and prints what changed; requalifying the host is `npm run blender:qualify-production`, which never approves anything. The proof render is a review render (silent fixture narration, captions burned in), and nothing uploads it anywhere. Human review remains mandatory before any publication.

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
- Every check marked required in the table above must pass, on a branch that is up to date with `main`. Workflow checks are bound to the GitHub Actions app, and `CodeQL` to GitHub code scanning, so a status from anywhere else cannot satisfy them. `Dependency review` joins the required checks once the dependency graph is enabled and the check has passed once.
- No approving review count is set, because the maintainer opens most pull requests and GitHub does not let an author approve their own. Anyone with write access can merge a pull request once every required check passes. Raising the count to 1 would put a second person on every merge; the maintainer's own pull requests would then need a collaborator's approval or a recorded bypass.
- Repository administrators may bypass the rules on a pull request only, as a recorded owner-recovery path. They cannot push to `main` directly.
