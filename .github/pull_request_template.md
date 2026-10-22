<!--
How to fill this in:
- Every PR fills in the sections with headings. The collapsible sections cover one area each: fill in the ones your change touches and delete the rest.
- Report exact results from the final commit. Mark a check you did not run as skipped and say why. Never leave a result blank.
- Never commit dist/. Attach stills and clips through the GitHub UI.
-->

## Summary

<!-- What changed and why, in two or three sentences. Link the docs page, issue, or earlier PR this builds on. -->

## Scope

**In scope:** <!-- the changes, as a short list -->

**Out of scope:** <!-- what a reviewer might expect here and will not find -->

## Change classification

- [ ] Docs / content
- [ ] VideoSpec / planning
- [ ] Motion Intelligence
- [ ] Rust / WASM
- [ ] Rig contract / Blender character
- [ ] Remotion rendering
- [ ] Audio / narration / captions
- [ ] Visual design / layout
- [ ] Provenance / manifests
- [ ] CI / build tooling
- [ ] Publishing / YouTube (dry run only)
- [ ] Security / hardening
- [ ] Refactor only
- [ ] Other: <!-- describe -->

## Behavioral impact

- [ ] No intended behavioral change
- [ ] Intended behavioral change: <!-- what changes, and for which inputs -->
- [ ] Render-only change
- [ ] Internal implementation only
- [ ] Public output changes: <!-- the affected videos, and each declared version bumped (spec revision, rig, motion, Motion Intelligence config, palette, voice/sonic config) -->

## Governing invariants

<!-- Check each invariant this PR keeps. Explain any unchecked box under "Reviewer focus". -->

- [ ] Docs stay authoritative over the generated video: no fact, number, or claim the bound docs page does not state
- [ ] No generative channel: no styling, code, camera, or prompt fields in the spec, and no new generative asset kinds
- [ ] Motion simulation never changes a semantic destination. Motion Intelligence decides how, not where.
- [ ] Blender performs the body; Remotion owns frame and time composition
- [ ] Invalid or unverifiable input fails closed: no error downgraded to a warning, no gate skipped
- [ ] The render path reads no wall clock, randomness, network, or ambient environment
- [ ] Provenance identifies the exact artifacts used, and anything that changes a frame bumps its declared version
- [ ] Default behavior is unchanged, unless this PR documents the change
- [ ] No adversarial test weakened
- [ ] Copy says "this wallet" or "the address", never "your wallet"; no hype, fake urgency, or guarantees

<details>
<summary>Architecture / ownership</summary>

<!-- Fill this in when the change moves work between layers or adds a layer. Edit the After block to show what moves. -->

| Concern | Owner | Changed here? |
|---|---|---|
| Semantic intent: where WalletWallaby goes, what the video says | Docs page → `VideoSpec` | |
| Movement planning: how and when | Motion Intelligence (TypeScript, plus the Rust/WASM engine on bound paths) | |
| Character articulation | Blender (pinned build, crop layout) | |
| Frame and time composition | Remotion | |
| Provenance | Pinned versions and hashes, `render.json`, `provenance.json` | |

Before (optional):

```text
docs page → VideoSpec → timeline → motion plan → resolved pose and IK targets → Blender crop → Remotion frame
```

After (optional):

```text
docs page → VideoSpec → timeline → motion plan → resolved pose and IK targets → Blender crop → Remotion frame
```

</details>

## Evidence

<!-- Results from the final commit, for example "263 tests: 261 pass, 0 fail, 2 skipped (need a WalletWall checkout)". Write n/a when the change cannot affect a check. `npm run check` runs typecheck, tests, plan:check, and validate in one go. -->

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | |
| Unit tests | `npm test` | |
| Integration tests | `node --test test/rust-motion-engine.test.ts` (TS → WASM → TS) | |
| Rust tests | `cargo test` (in `motion-intelligence/`) | |
| Clippy | `cargo clippy --all-targets -- -D warnings`; `cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings` | |
| Rustfmt | `cargo fmt --check` | |
| Build / artifact regeneration | `npm run plan:check`; `npm run motion:check` (Linux or WSL) | |
| Validation | `npm run validate`; `npm run contracts:check` | |
| Public output | `npm run publish:dry-run`; `npm run public:check` (add `--stills=<dir>` after `npm run render:stills`) | |
| Licenses and rights | `npm run rights:check`; before any public release also `npm run rights:check -- --public-release` ([docs/RELEASE_RIGHTS.md](../docs/RELEASE_RIGHTS.md)) | |
| Security audit | `npm audit --audit-level=moderate`; `cargo audit` when crate dependencies change | |
| Diff hygiene | `git diff --check` | |
| CI | Checks: Verify pipeline, Motion Intelligence (Rust/WASM), CodeQL, Public surface, Render determinism, Dependency review ([docs/CI.md](../docs/CI.md)) | |

- **Test counts:** <!-- total, pass, fail, and skipped, and the change from main -->
- **Positive controls:** <!-- for each new guard, the input that proves it fires -->
- **Negative / adversarial cases:** <!-- what was tried, and how it was refused -->

<details>
<summary>Determinism</summary>

<!-- Fill this in for anything that touches the render path, motion, the rig, or a generated artifact. -->

- [ ] Identical logical input gives identical output. Compared: <!-- plans, rig controls, PNG stills, artifact bytes -->
- [ ] Frame order does not change the output: shuffled or reversed evaluation matches timeline order
- [ ] Reproduced in a fresh process
- [ ] Generated artifacts reproduce byte for byte from source
- [ ] Artifact hashes are pinned, and updated wherever the bytes changed
- [ ] Known nondeterminism is documented: <!-- or "none" -->

> **An MP4 hash does not prove determinism.** Remotion's MP4 bytes are not stable from run to run. Compare PNG stills, plans, rig controls, and pinned artifact hashes instead.

</details>

<details>
<summary>Visual / audiovisual review</summary>

<!-- Required for anything visual: render with npm run render:stills migration-readiness, and also npm run blender:review for the character. -->

- [ ] Before/after stills attached
- [ ] Contact sheet
- [ ] Key frame sequence: <!-- frames -->
- [ ] Short comparison clip
- [ ] Full proof render: <!-- frames, duration, render time -->
- [ ] Captions and audio reviewed, if they changed
- [ ] Protected text and the title-safe area respected
- [ ] No generic AI or crypto filler, in imagery or in copy
- [ ] WalletWallaby stays secondary to the explanation
- [ ] No debug overlays in public output

</details>

<details>
<summary>Motion Intelligence</summary>

Actions touched:

- [ ] `HOP`
- [ ] `LAND`
- [ ] `PERCH`
- [ ] `INSPECT`
- [ ] `TRACE`
- [ ] `MANTLE`
- [ ] `PUSH_THROUGH`
- [ ] `VAULT`
- [ ] `RESOLVE`
- [ ] Other: <!-- name it -->

Invariants:

- [ ] Every authored destination stays exact
- [ ] An unsolvable path is refused, never improvised
- [ ] Contact state stays valid: feet plant only when grounded, never in flight
- [ ] No phantom contact: nothing touches a surface that is not there
- [ ] Tail output stays bounded: swing, curl, and tension within their limits
- [ ] No motion math duplicated across Rust and TypeScript, except the explicit TypeScript oracle
- [ ] The hand-off to Blender stays renderer-neutral: the resolved pose and IK targets (walletwall.blender-motion/v1), never a decision

</details>

<details>
<summary>Rust / WASM</summary>

<!-- Required for any change under motion-intelligence/. Run cargo in that directory. Build the WASM on Linux or WSL, because the committed artifact is a canonical Linux build. -->

- [ ] Toolchain pinned by `rust-toolchain.toml`: unchanged, or the bump is explained
- [ ] `cargo fmt --check`
- [ ] `cargo clippy` with `-D warnings`, native and wasm32
- [ ] `cargo test`
- [ ] WASM built: `npm run motion:build`
- [ ] Byte-identical rebuild: `npm run motion:check`
- [ ] Import surface reviewed (the module imports nothing today)
- [ ] No clock, randomness, or environment imports
- [ ] ABI changes documented, or none
- [ ] Config and schema versioned, and the config pin updated
- [ ] SHA-256 updated in `motion-intelligence/wasm/artifact.json`; `npm run motion:fixtures` re-run after a deliberate behaviour change
- [ ] TypeScript validates both the input and the output

Artifact identity (from `motion-intelligence/wasm/artifact.json` and `src/motion/engine-identity.ts`):

```text
rustc:         …
target:        wasm32-unknown-unknown
abi:           …
wasm bytes:    …
wasm sha256:   …
config:        walletwall.motion-intelligence-config/v…, version …
config sha256: …
```

</details>

<details>
<summary>Provenance</summary>

<!-- Copy from dist/<id>/render.json (npm run render) and dist/<id>/provenance.json (npm run publish:dry-run). Write "unchanged" for any field this PR does not affect. -->

| Field | Value |
|---|---|
| Source revision | |
| Source blob / hash | |
| VideoSpec hash | |
| Motion engine | `typescript` or `rust-wasm` |
| Motion engine version | |
| Motion artifact hash | |
| Rig version | |
| Blender character (model / materials hash) | |
| Renderer version | |
| Theme / motion version | |
| Audio identity / version | |
| Render hash | |

</details>

## Security & privacy

- [ ] No secrets, `.env` files, API keys, or provider credentials; provider bindings name environment variables only
- [ ] Only public-safe material: no internal docs, audits, or private code, and no local usernames or private absolute paths in code, generated files, or this description
- [ ] No unexpected network access
- [ ] No writable external side effects: no upload step, nothing set public; publishing stays a human-triggered dry run
- [ ] No unsafe shell interpolation
- [ ] The native/WASM boundary validates untrusted input
- [ ] Generated files checked for sensitive metadata: embedded paths, usernames, hostnames
- [ ] Dependency audit reviewed; every new dependency has a documented need, and none is a game engine
- [ ] CI stays read-only and fork-safe: `pull_request`, `contents: read`, `persist-credentials: false`, no secrets

<details>
<summary>Performance</summary>

<!-- Measure on the same machine, back to back. Say if anything else was running. -->

| Measure | Before | After | Delta |
|---|---|---|---|
| Full render (`migration-readiness`) | | | |
| Stills render | | | |
| Plan or solve time | | | |
| Artifact size | | | |

</details>

<details>
<summary>Compatibility / migration</summary>

- [ ] Backward compatible
- [ ] Existing manifests (`render.json`, `stills.json`, `provenance.json`) stay readable
- [ ] Migration required: <!-- steps -->
- [ ] Breaking change: <!-- what breaks, and for whom -->

</details>

<details>
<summary>Failure modes</summary>

<!-- What this change does in each case. The repository default is to fail closed. -->

| Failure | Expected behavior |
|---|---|
| Invalid input | |
| Missing artifact | |
| Hash mismatch | |
| Unsolvable motion | |
| Renderer failure | |
| Provider failure | |

</details>

## Rollback

- **Smallest rollback:** <!-- for example git revert of one commit; name any later PR that must be reverted first -->
- **Pins and generated artifacts that revert with it:** <!-- versions, config pins, the Blender character pin, .wasm, fixtures, or "none" -->
- **External or public artifacts that need separate action:** <!-- or "none" -->

> [!WARNING]
> A merge revert removes everything the merge brought in. If this branch was built on another unmerged branch, `git revert -m 1` removes that branch's work too. In that case, name the exact commits to revert.

## Reviewer focus

<!-- Where the risk is: the files, functions, and decisions you are least sure of. -->

## Adversarial review

<!-- Claims a reviewer should try to falsify, and how to try. Keep the ones that apply, and add your own. -->

- Can a semantic destination drift?
- Can stale WASM, Blender frames, or config bytes still render or publish?
- Can frame order change the output?
- Can invalid numeric input (NaN, ±Infinity, out-of-range values) cross the boundary?

## Known limitations / follow-up

<!-- What this PR does not do, any known flakes, and the follow-up PRs or issues. -->

## Author gate

- [ ] Scope matches this PR, with no unrelated cleanup
- [ ] Required checks pass on the final commit
- [ ] Every new guard has a positive control
- [ ] Evidence reflects the final commit
- [ ] Generated artifacts correspond to the final source
- [ ] Reviewer findings fixed or explicitly dispositioned
- [ ] Known flakes documented
- [ ] No claim in this PR goes beyond its evidence
- [ ] This PR can be understood and reverted without session memory

**Merge recommendation:**

- [ ] Ready to merge
- [ ] Draft: evidence pending
- [ ] Blocked: <!-- on what -->

> [!IMPORTANT]
> A human maintainer approves every merge. Never merge your own PR, and never merge before CI passes.
