# Release rights

What must be true about a video's rights before it leaves this machine, how that is recorded, and what the repository enforces. [LICENSING.md](LICENSING.md) explains the source-code and dependency licenses behind it; [PUBLICATION.md](PUBLICATION.md) covers the proof and the receipt.

> Not legal advice. This policy encodes a fail-closed rule: **a video is public only when every material item is `CLEARED`, and nothing becomes `CLEARED` by default.** An item whose rights nobody has established stays `UNKNOWN`, `UNVERIFIED`, or `OWNER_CONFIRMATION_PENDING`, however well it runs and however freely it can be downloaded.

## Release states

```text
LOCAL_PROOF  →  RIGHTS_CLEARED  →  UNLISTED  →  OWNER_REVIEWED  →  PUBLIC
```

| State | Meaning | Rights required |
|---|---|---|
| `LOCAL_PROOF` | Rendered and proven locally ([PUBLICATION.md](PUBLICATION.md)); nothing has left the machine. | None to be here. Open items may be recorded. |
| `RIGHTS_CLEARED` | Every material item is `CLEARED`. | `npm run rights:check -- --public-release` passes. |
| `UNLISTED` | Uploaded as `unlisted` for review (the only privacy the pipeline can express). | Everything `RIGHTS_CLEARED` needs. |
| `OWNER_REVIEWED` | The owner has watched the unlisted upload. | Unchanged. |
| `PUBLIC` | Set public on the platform. | Unchanged, plus the owner's authorization. |

**Hard invariant: only the owner may authorize `UNLISTED` → `PUBLIC`.** The pipeline cannot do it: a v1 upload cannot express `public`, CI has no credential, and `test/guards.test.ts` enforces both. The manifest records the authorization (`release.ownerAuthorization`: `authorizedBy: "OWNER"`, the transition, and the `receiptSha256` of the publication proof receipt being authorized), and a `PUBLIC` record without it is a schema error. That record is a **declaration, not authentication**: someone with write access could type it. What actually holds is the repository's review rules and the owner being the only one with the platform account. The record exists so the decision is auditable in git.

A video's recorded state cannot claim more than its rights support. `rights:check` fails, even in development mode, when a video is recorded as `RIGHTS_CLEARED` or later while any of its material items is not `CLEARED` (`RELEASE_STATE_UNSUPPORTED`).

## Statuses

An item's status says what has been established about its rights. Only `CLEARED` is enough for a public release; every other status blocks it, whichever one it is.

| Status | Meaning | Blocks `RIGHTS_CLEARED` and later |
|---|---|---|
| `CLEARED` | Established. For a vendor's, a provider's, or a third party's terms, it carries the owner's own record. | no |
| `OWNER_CONFIRMATION_PENDING` | The terms leave a question only the owner (or the vendor, through the owner) can answer. | yes |
| `PAID_LICENSE_REQUIRED` | A paid license is required and none is held. | yes |
| `BLOCKED` | Known not usable as is. | yes |
| `UNKNOWN` | Nobody has looked. | yes |
| `UNVERIFIED` | Looked at, but not verified against the license text or an authoritative page. | yes |
| `PERSONAL_USE_ONLY` | The terms allow personal use only. | yes |
| `NONCOMMERCIAL` | The terms allow non-commercial use only. | yes |
| `EXPIRED` | A license or permission has lapsed. | yes |
| `INCOMPATIBLE` | The terms conflict with how the item is used. | yes |

`LOCAL_PROOF` admits all of them, recorded, so development is never blocked by an open decision. There is deliberately **no** status that is permitted before `PUBLIC` except `CLEARED`: the table of permitted statuses is `STATUSES_PERMITTED_IN` in [src/rights/vocabulary.ts](../src/rights/vocabulary.ts), and `test/rights-check.test.ts` fails if it changes, so loosening it is a visible, reviewed edit.

Rules that keep a status honest (the schema enforces them):

- An item that is not `CLEARED` carries a `resolution`: the owner action that would clear it and the event that would reopen it.
- A basis of `UNDETERMINED` can only be `UNKNOWN` or `UNVERIFIED`, never `CLEARED`.
- A `VENDOR_LICENSE`, `PROVIDER_TERMS`, or `THIRD_PARTY_ATTRIBUTION_ONLY` basis is `CLEARED` only with a `clearance` record (`clearedBy: "OWNER"`, the date, and why). An owner-authored or generated item needs none.
- An asset cannot be `CLEARED` while the component it is bound to is not, and a component cannot be `CLEARED` while a component it is `producedBy` or `dependsOn` is not. For example the character model depends on the attributed signed-distance primitives, and the Blender frames depend on the model.
- An open-source basis names only recognised SPDX identifiers (`RECOGNISED_SPDX_IDS` in `src/rights/vocabulary.ts`), so a made-up identifier cannot stand in for a license.
- A non-commercial or network-copyleft license (`CC-BY-NC-*`, `AGPL-*`; `RESTRICTED_SPDX_IDS`) cannot be the whole basis of a `CLEARED` open-source item. Such an item is recorded `NONCOMMERCIAL`, `INCOMPATIBLE`, or `OWNER_CONFIRMATION_PENDING`, or its expression names an alternative the owner can take with `OR`. Other copyleft licenses (GPL, LGPL, MPL, OFL, CC-BY-SA) attach their duties to distribution, so a component records `distribution` and its notice, and the review of the manifest is the control on whether that is enough.
- **Who clears what.** A vendor's, a provider's, or a third party's terms are cleared only by a `clearance` record naming the owner. An owner-authored or generated item is cleared by a status edit, as the lane brief's own example shows, and the control on that edit is review of it: the pull request that flips `brand-mark` to `CLEARED` is the owner stating that WalletWall holds the rights.
- **The media inventory is by exact path.** Every tracked image, audio, video, font, 3D, WebAssembly, Python bytecode or extension module, shared library, and zip or wheel archive is listed in `mediaFiles`, each entry naming one `path` or an exact `paths` list and the component or video asset whose rights cover it. There is no directory form: a file dropped beside an inventoried one is unrecorded (`MEDIA_FILE_UNRECORDED`), and an entry that lists a file that is gone is stale (`MEDIA_ENTRY_STALE`).

## Four layers, kept apart

One status never stands for another, so the manifest keeps four things separate:

| Layer | What it answers | Where |
|---|---|---|
| Source-code licensing | What license covers each file of this repository. | `sourceCode`, plus `SOURCE_CODE` components for third-party code inside it |
| Tool and runtime licensing | May this repository use Blender, Remotion, fonts, and dependencies to make a release, and what do they require? | `TOOL_RUNTIME` components, and `dependencies` |
| Generated-media rights | Who holds the rights in what the tools produced (frames, the `.blend`, the MP4, narration audio)? | `GENERATED_MEDIA` components, each naming the tools that produced it |
| Per-video asset rights | Do the specific assets this video shows and plays have rights recorded against their exact bytes? | `videos[].assets` |

For example, Blender's GPL is `CLEARED` as a tool (it may be used for any purpose) while the character frames it produces are the creator's, and the GPL on the scripts says nothing about the video's license. Remotion's eligibility is a separate question from who owns the frames it renders.

## Asset categories

Every video must account for every category below: either it has an asset of that category, or the category is declared `absent`. Declaring a category absent is checked where the repository can check it (a spec asset, a sonic asset, a narration binding, or a source page that exists must have an entry), so `absent` cannot hide something that is there.

| Category | Rule |
|---|---|
| `authored-content` | The docs page a video is made from, recorded against its git blob. Owner-authored. |
| `narration` | Synthetic or recorded speech. Bound to its provider component; the provider's terms at synthesis time decide commercial use. A real person's voice is never cloned, and no reference audio is used. |
| `music` | A music bed. Nothing is cleared for being available online. Needs a license or an owner-authored basis, recorded against the sonic asset id. None is assigned today. |
| `sfx` | The ident and event sounds, under the same rule. None is assigned today. |
| `font` | Bound to its font component and license (OFL-1.1 today). An asset that binds a font-package component is recorded as `font`. |
| `screenshot` | A captured image of a product or a chain explorer. Needs the right to show it. None today. |
| `ui-capture` | A capture of a real UI. Needs the right to show it and no private data. None today. |
| `logo-trademark` | A brand mark, recorded against its bytes. Needs the owner's record of how it was made and who holds it. |
| `illustration` | Drawn artwork shipped as a file. Art drawn by code is owner-authored and has no file to record. None today. |
| `third-party-media` | Third-party video or images. The pipeline has no asset kind for stock footage, generated imagery, or presenters. None today, and a new one would need a new kind. |
| `three-d-asset` | 3D models and materials. The character is generated from owner code (and the attributed signed-distance primitives it depends on); nothing external is imported. A repository with a Blender lane (`config/blender.json`) must record the character as a `generated-model` component on the release path, and every video binds it under this category (`CHARACTER_UNRECORDED`, `COMPONENT_UNBOUND`, `COMPONENT_CATEGORY_MISMATCH`). |

The other two categories the policy names, `source-script` and `software-dependency`, are not per-video: they are the source-code license map and the dependency components.

## The manifest

[config/release-rights.json](../config/release-rights.json) is a **closed schema** (`walletwall.release-rights/v1`): an unknown or missing field, an unknown status, basis, layer, kind, state, or classification is a problem and never a default, and a `__proto__` member is an unknown field. It holds no local path, secret, or address, and no account, plan, or credential detail: the shared leak policy (`src/core/leak-scan.ts`) checks it for local paths and secret-shaped values, and this check adds email addresses, password and key assignments, identifiers shaped like a provider voice id, and subscription plan tiers. Those are patterns, not proof; the record is reviewed as well. Its identity is `manifestSha256` in the report, the sha256 of its canonical JSON.

Recording an owner decision is an edit to this file. Clearing Remotion, for example, after the vendor confirms:

```json
{
  "id": "remotion",
  "status": "CLEARED",
  "clearance": { "clearedBy": "OWNER", "clearedOn": "2026-11-01", "basis": "The vendor confirmed in writing that the Free License applies to this project." }
}
```

(the component's other fields stay, and its `resolution` may be dropped). Do not record anything that proves a license exists beyond that statement: no license key, no invoice, no account.

## `npm run rights:check`

```bash
npm run rights:check                       # development: the repository check
npm run rights:check -- --public-release   # strict: every material item must be CLEARED
npm run rights:check -- --json             # either mode, as JSON
```

Exit `0` on PASS, `1` on FAIL, `2` on a usage error. It reads only committed files and makes no network call, reads no environment variable, credential, or clock, and is deterministic: the same files give byte-identical output.

| Mode | Open owner decisions | Everything else |
|---|---|---|
| development | pass, **listed** under `pending` | a falsely cleared, drifted, or invalid record fails |
| `--public-release` | each one is a `RIGHTS_BLOCKING_STATUS` finding | the same |

The finding codes, grouped:

| Group | Codes |
|---|---|
| The manifest | `MANIFEST_UNREADABLE`, `MANIFEST_INVALID`, `DOCUMENT_MISSING`, `NOTICE_MISSING`, `REQUIRED_COMPONENT_MISSING` (also raised when a required tool is relabelled research-only or moved off the release path), `CHARACTER_UNRECORDED`, `EVIDENCE_FILE_MISSING` |
| License files | `LICENSE_FILE_MISSING`, `LICENSE_FILE_MISMATCH`, `LICENSE_TEXT_UNEXPECTED`, `LICENSE_TEXT_UNAVAILABLE`, `LICENSE_FILE_NOT_LISTED`, `LICENSE_MIT_COPY_DIFFERS`, `PACKAGE_JSON_MISSING`, `PACKAGE_LICENSE_MISMATCH` |
| The Blender boundary | `PYTHON_UNCLASSIFIED`, `PYTHON_UNREADABLE`, `PYTHON_CLASSIFICATION_MISMATCH`, `PYTHON_LICENSE_HEADER_MISSING`, `PYTHON_LICENSE_HEADER_WRONG`, `PYTHON_COPYRIGHT_HEADER_WRONG`, `PYTHON_ENTRY_STALE`, `PYTHON_REVIEW_REQUIRED`, `PYTHON_OWNER_REVIEW_STALE`, `PYTHON_OWNER_REVIEW_UNNEEDED`, `BLENDER_PYTHON_IN_NON_PYTHON_FILE` |
| Dependencies | `NPM_LOCK_UNREADABLE`, `NPM_LOCK_OUT_OF_SYNC`, `NPM_LICENSE_UNCLASSIFIED`, `NPM_RULE_MISMATCH`, `NPM_RULE_COMPONENT_MISMATCH`, `FONT_PACKAGE_UNRECORDED`, `NPM_RULE_AMBIGUOUS`, `NPM_RULE_UNUSED`, `NPM_RULE_LICENSE_NOT_ACCEPTABLE`, `CARGO_LOCK_UNREADABLE`, `CARGO_CRATE_UNLISTED`, `CARGO_CRATE_STALE`, `CARGO_CHECKSUM_MISMATCH`, `CARGO_LICENSE_NOT_ACCEPTABLE`, `REASSESSMENT_REQUIRED` |
| Media | `VIDEO_REGISTRY_UNREADABLE`, `VIDEO_NOT_IN_MANIFEST`, `VIDEO_ENTRY_STALE`, `SPEC_UNREADABLE`, `SPEC_ASSET_UNCOVERED`, `SPEC_ASSET_HASH_MISMATCH`, `SPEC_ASSET_KIND_UNKNOWN`, `SPEC_ASSET_CATEGORY_MISMATCH`, `ASSET_BINDING_STALE`, `SONIC_ASSET_UNCOVERED`, `NARRATION_UNCOVERED`, `DOCS_SOURCE_UNCOVERED`, `COMPONENT_UNBOUND`, `COMPONENT_CATEGORY_MISMATCH`, `ASSET_ABOVE_COMPONENT`, `COMPONENT_ABOVE_DEPENDENCY`, `MEDIA_FILE_UNRECORDED`, `MEDIA_ENTRY_STALE` |
| Release | `RELEASE_STATE_UNSUPPORTED`, `RIGHTS_BLOCKING_STATUS` |

## Where it runs

- **CI.** The required `Verify pipeline` job runs `npm run rights:check`, so a pull request that adds a Python file without a classification, a dependency with an unrecorded license, or a spec asset without rights fails. The same job also prints the strict readiness report in its step summary, informationally: it lists what the owner has not yet cleared and never fails the build.
- **Before a release leaves `LOCAL_PROOF`.** `npm run rights:check -- --public-release` must pass. It is a check a person runs, like the publication proof: no script refuses to upload or publish without it, and CI cannot clear anything.
- **Not (yet) bound into the publication proof receipt.** The receipt ([PUBLICATION.md](PUBLICATION.md)) does not yet carry the rights manifest's identity, and `publication:proof` does not run the rights check. That is the immediate follow-up, and it needs a decision first (below). Until then the binding runs the other way: a `PUBLIC` record in the manifest names the `receiptSha256` it authorizes.

### The follow-up: binding the rights manifest into the receipt

Binding `manifestSha256` into `publication-proof-receipt` is a closed-schema change (v2 to v3) in an 805-line verifier and its fixtures, and it raises a design question that should be answered by the owner, not assumed: a receipt that binds the whole manifest would be invalidated by *any* edit, including clearing an item, which changes no frame and would force a whole-video proof to be re-run. The options are to bind a hash of only the rights *facts* (assets, bindings, license map, without statuses), to bind the full manifest but let the verifier report a mismatch as informational, or to bind at the `PUBLIC` decision (already possible through `ownerAuthorization.receiptSha256`) and leave the proof alone. `publication:proof` would also run the development rights check first and refuse to start on an invalid record.

## What this does not do

It does not decide whether an open item is acceptable, authenticate the owner, verify a vendor's claims, read `node_modules`, or look at a rendered video. It cannot see a right it was not told about: a new kind of asset needs a new category, and a new tool needs a component, which is why the detection rules (a spec asset, a sonic asset, a narration binding, a pinned tool, a lockfile entry) fail when something appears that the manifest does not cover.
