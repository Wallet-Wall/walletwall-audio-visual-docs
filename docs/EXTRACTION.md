# Extraction record

How this repository's pipeline was extracted from the WalletWall application repository, and the evidence that behaviour was preserved.

## Source

- **Frozen baseline:** the `video/` package at commit `62055faa84ee26eeeb649f22082c1559a64e0ff2` (branch `feat/docs-video-pipeline` of the WalletWall application repository). That branch is a reference point only; it was never merged, and the pipeline's permanent home is this repository.
- **Moved:** the whole package (sources, scripts, tests, config, storyboard, committed spec and snapshot, lineage, lockfile) to this repository's root. The application repository's verify workflow became `.github/workflows/ci.yml`; its internal decision record became the public [ARCHITECTURE.md](ARCHITECTURE.md).
- **Not moved:** anything internal to the application repository: its lint scripts, internal docs, the docs-site exclusion list, and any private code.

## What changed, and why it is not a behaviour change

| In the application repository | Here |
|---|---|
| `REPO_ROOT` (the parent of `video/`) for every path | Two explicit trees: this repository for `video/…` workspace paths, the canonical WalletWall tree (`WALLETWALL_SOURCE_ROOT`, or the blob-verified `fixtures/canonical/` mirror) for the rest. Spec paths keep the `video/` namespace, so the committed spec is byte-identical. |
| `git rev-parse HEAD:<doc>` for the doc blob | The same in a checkout; in the mirror, the git blob id is computed from the verified bytes (equal by construction). |
| Brand values imported from the app's `src/theme.js` and `src/constants.js`, CSS tokens checked against its `src/index.css` | `contracts/walletwall-brand.json`, generated from those files at the frozen commit (values copied, not retyped) with their blob ids; `npm run contracts:check` re-verifies every value against a checkout. |
| Injection-sink and secret rules imported from the app's lint tables | The same rule entries carried verbatim into `test/guard-rules.ts`, with the source blob recorded. |
| Hard-coded alpha variants of brand colors in three places | Derived from tokens (`TOKENS.inkAlpha`, `withAlpha`); the strings are identical. |

Added during extraction, none of which changes a frame:

- `src/source/canonical.ts`: the single gateway to the canonical tree, which verifies fixture reads against `fixtures/canonical/MANIFEST.json`.
- Containment tests for both trees, including directory links that point outside a tree, with positive controls. Removing either realpath check fails its test.
- A test that walks the render bundle's whole import closure and refuses environment reads or Node built-ins anywhere in it, not only under `src/remotion/`.
- A fork-safety test over every workflow, plus CodeQL and Dependabot configs matching the other public WalletWall repositories.
- Provenance v2: `render.json` and the provenance manifest record the toolchain (Node, the lockfile sha256, pinned package versions), hashes of the version-controlled config and contracts, and WalletWallaby's declared rig and motion versions. Each version pins its definition hash, and `publish:dry-run` refuses a render made under a different identity.

## Equivalence evidence

Same machine, same pinned toolchain (Node 24.16.0, Remotion 4.0.532).

| | Baseline (application repository) | Extracted (this repository, before the brand-mark change) |
|---|---|---|
| Doc blob | `f8c294eecaef6142ab947ce16d8664a8bec743c0` | same |
| Normalized content hash | `958c4a37fe87e103f4d633e0d696bdb5354b603a77932362f45e3aff51e3b1ff` | same |
| Normalizer | `walletwall-mdx-normalizer/2` | same |
| VideoSpec hash | `b7c017a384905afadafc5a93521fe32a7255c47032c43405a7fb76fd9e01a6c9` | same (`plan:check` byte-identical, in both fixture and checkout mode) |
| Validation | PASS, 0 errors, 0 warnings | same, in both modes |
| Freshness | `CURRENT` | `CURRENT`, in both modes |
| Review stills (15 settled frames + 15 characterless) | 30 PNGs | **30 of 30 byte-identical** |
| MP4, first run | 5319 frames, 177.3 s, sha256 `f1033f8b…2dc9` | 5319 frames, 177.3 s, sha256 `79478272…693f` |
| MP4, baseline re-run (same frozen code, later) | sha256 `79478272…693f` | **byte-identical to the extracted render** |

The MP4 container bytes differ while every lossless review frame is identical. The decoded MP4s differ only at the level of H.264 encoding noise (179 frames sampled at 1 fps: PSNR 47 to 64 dB, mean absolute difference about 0.1 of 255 per channel). Re-rendering the frozen baseline code produced `79478272…693f`, byte-identical to the extracted render. So the extraction reproduces the original code exactly, and only the first baseline run's container differs. Remotion's H.264 output is therefore not guaranteed byte-stable from run to run, even though the frames are.

**Conclusion:** the extraction preserved behaviour. Spec, provenance identifiers, validation outcome, and every lossless rendered frame we compared are identical. The determinism claim for this repository is therefore made at the frame and spec level (`plan:check`, lossless stills), not at the level of encoded MP4 bytes.

## Deliberate change after the proof

The application's legacy raster icon (`public/brand/wallet-wall-icon-only.png`) was retired at the maintainer's request and never committed here. The ident and outro now show the WalletWall brick-wallet mark supplied by the maintainer, edge-polished deterministically (anti-aliased contour, filled pinholes, baked-in backdrop removed; see [assets/brand/README.md](../assets/brand/README.md)) and committed as `assets/brand/walletwall-brick-wallet.png` (sha256 `91926a2eebc1777194ecf491049b8a7af3cf0892b09b363c5b2a17cd17d5dbad`). `BRAND_MARK` assets may now come only from this repository's reviewed `assets/brand/`, and a test proves the legacy path is refused. The mark boxes became square to fit the new mark without distortion. At the same request, the ident wordmark and the outro address are now set in WalletWall terracotta instead of charcoal.

Effect: the VideoSpec hash moves to `dd5ee8d46dd076da622c0b76f65894cf2977c6f7d1c91e75e0cd00ebcac12e77`, which differs only in the asset entry. The source binding is unchanged, and only the ident and outro frames change.

## Remaining repository-boundary work

- Delete the reference branch in the application repository once this repository's bootstrap PR merges, or keep it as an archive.
- Run `npm run contracts:check` with a WalletWall checkout on a schedule, or from the application repository's CI, so brand drift is caught without anyone remembering to.
- Move canonical-doc freshness to a trigger on WalletWall docs changes (today it runs on demand, or in CI against the mirror).
- A future publishing workflow belongs here, separate and manually dispatched (see [SECURITY.md](../SECURITY.md)).
