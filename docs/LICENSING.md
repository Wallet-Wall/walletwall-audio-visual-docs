# Licensing

This repository is MIT, with one explicit exception: **a Python file that uses the Blender Python API is `GPL-3.0-or-later`.** Everything else a reader might ask about (what Blender's GPL does and does not reach, what Remotion's license needs, what the fonts, Mediabunny, and `caniuse-lite` require, what is still an owner decision) is recorded here, grounded in the license text or the upstream's own pages.

> This is a record of what the licenses say and how this repository applies them. It is not legal advice, and it draws no conclusion beyond what the cited texts support. Where a text does not settle a question, the question is recorded as an open owner decision and is never silently treated as cleared. Upstream pages were read on **2026-10-22 (UTC)**; Blender's two pages, the GNU GPL FAQ, and Inigo Quilez's smooth-minimum article on **2026-10-25**.

Three companion files: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) (the notices), [RELEASE_RIGHTS.md](RELEASE_RIGHTS.md) (what must be cleared before a video is public), and [config/release-rights.json](../config/release-rights.json) (the machine-readable record). `npm run rights:check` verifies that the record, the license headers, the lockfiles, and the media assets agree.

## The license map

| What | License | Where it is stated |
|---|---|---|
| Everything not listed below: the TypeScript, the Rust, the docs, the configs, `tools/chatterbox/synthesize.py` | MIT | [LICENSE](../LICENSE), [LICENSES/MIT.txt](../LICENSES/MIT.txt) (byte-identical), `package.json`, `motion-intelligence/Cargo.toml` |
| `build.py`, `controls.py`, `materials.py`, `render.py`, `rig.py`, `scene.py`, `terrain.py`, `transition.py` under `blender/walletwallaby/` | **GPL-3.0-or-later** | an SPDX header in each file; [LICENSES/GPL-3.0-or-later.txt](../LICENSES/GPL-3.0-or-later.txt) |
| `common.py` and `geometry.py` under `blender/walletwallaby/` | MIT, stated in an explicit header because the directory mixes licenses | an SPDX header in each file |
| Third-party dependencies | their own licenses, not MIT in every case | [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), `config/release-rights.json` |
| Generated frames, `.blend` files, MP4s, captions, WalletWall artwork, narration | their own rights, separate from the source licenses; **not** made GPL by being produced with Blender | [RELEASE_RIGHTS.md](RELEASE_RIGHTS.md) |

The copyright line in every header is `SPDX-FileCopyrightText: 2026 WalletWall`, the holder the top-level `LICENSE` already names. No ownership is asserted beyond that line. The Author field of every commit in the history of `blender/` and `tools/` is the maintainer, and most of those commits carry a `Co-Authored-By: Claude` trailer because the code was written with an AI coding assistant working for the maintainer. This record takes no position on how AI-assisted authorship is treated beyond the maintainer's own statement of the holder in `LICENSE`. The two places where third-party work is involved are recorded below, not hidden in this line.

## What Blender says

Read from the Blender Foundation's own pages on 2026-10-22:

- **License page** (https://www.blender.org/about/license/). Blender is released under the GNU GPL. The source is GPL version 2 or later, and version 3 or later is the license to use for any distribution of Blender's binaries. Blender may be used commercially and "for any purpose". What you create with Blender, including images, movie files, and `.blend` files, is your sole property. Because the Python API is an integral part of the software, published scripts that use it must be shared under a GPL-compliant license.
- **FAQ** (https://www.blender.org/support/faq/):
  - Python scripts that are shared or published "have to be made available licensed as GNU GPL" if they use Blender Python API calls.
  - The output of Blender in `.blend` form is program output and the sole copyright of the user. The `.blend` format stores only data definitions; a `.blend` that *embeds Python scripts* which provide bindings to other facilities is a different case.
  - Software may be licensed freely if and only if it operates outside Blender, uses no Blender source code or API calls (the Python API included), produces data for Blender to operate on, and executes Blender to read and operate on that data.
  - The FAQ carries an edit note dated 16 August 2024 saying it removed "confusing wording about GPL compatibility"; its current sentence asks for "GNU GPL", while the license page says "a GPL compliant license". This repository takes the stricter reading, `GPL-3.0-or-later` itself rather than merely a GPL-compatible license such as MIT, for the files that call the API. That is a choice made on those two wordings, not something either page states.
- The Blender manual's extensions-licensing page (docs.blender.org) refused a scripted request (HTTP 403) and is **not** relied on.
- Read again on 2026-10-25, both pages say the same. The FAQ also notes that items inside a screenshot of a GPL application, such as its icons, stay GPL; the lane renders no Blender interface, icon, or bundled asset (its scenes start empty and are built by its own code).
- **GNU GPL FAQ** (https://www.gnu.org/licenses/gpl-faq.html, the entries on output, updated 2026-01-13, read 2026-10-25): the output of a program is not, in general, covered by the copyright on its code, so the code's license does not apply to it, unless the output copies text or art from the program; where a program translates its input, the output's status follows the input.

### How this repository applies it

The TypeScript that drives Blender (`scripts/blender.ts`, `src/blender/*`) satisfies each condition of the FAQ's independence test, so it stays MIT:

| Condition | Evidence |
|---|---|
| Operates outside Blender | It is a Node process; Blender is a child process started by `spawnSync` ([src/blender/toolchain.ts](../src/blender/toolchain.ts)). |
| Uses no Blender source or API calls | No TypeScript file contains Blender Python. `rights:check` scans every non-Python source file for it (`BLENDER_PYTHON_IN_NON_PYTHON_FILE`). |
| Produces data for Blender | It writes a JSON job file under `dist/blender/jobs/`; the job holds data only. |
| Executes Blender | It runs the pinned build with fixed arguments, an allowlisted entry script, and one job file. |

The generated artifacts are program output. The `.blend` is data only: nothing in the lane embeds a script, driver, or text block, and every reopen passes `use_scripts=False`. The frames, the `.blend`, and the MP4s are therefore not GPL, and the GPL on the eight scripts does not reach them. Their rights follow their inputs, each class on its own record ([RELEASE_RIGHTS.md](RELEASE_RIGHTS.md#blender-script-license-owner-inputs-rendered-output)): the model and the character frames are the owner's, and the depth-reveal frames, which project Remotion's frames, wait for Remotion's output.

## The Blender boundary, file by file

The classification is **derived from the code**, not from file names or descriptions: `npm run rights:check` reads each Python file's imports (including ones inside functions, `try` blocks, and after a semicolon), follows imports between sibling files, and requires the manifest to agree. The manifest can record the result; it cannot change it.

| File | Classification | License | Why |
|---|---|---|---|
| `build.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` and `mathutils` |
| `controls.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `mathutils` and `rig.py`. The lane README calls it a "pure mapping"; it is not independent of Blender. |
| `materials.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` |
| `render.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy`, `mathutils`, and `gpu` (inside a function, which a top-of-file scan would miss) |
| `rig.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` and `mathutils` |
| `scene.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` and `mathutils` |
| `terrain.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` and `mathutils` |
| `transition.py` | `BLENDER_API_COUPLED` | GPL-3.0-or-later | imports `bpy` and `mathutils` |
| `common.py` | `BLENDER_INDEPENDENT` | MIT | standard library only |
| `geometry.py` | `BLENDER_INDEPENDENT` | MIT | `math` and `numpy` only |
| `tools/chatterbox/synthesize.py` | `BLENDER_INDEPENDENT` | MIT (default) | standard library, numpy, torch, chatterbox; runs outside Blender |

No file is `REVIEW_REQUIRED`. A file the analysis cannot decide (an import it cannot read, the Blender API named without an import, a name that reaches Python's import machinery, source it cannot tokenize) is `REVIEW_REQUIRED`: pending in development, a blocker for a public release, and treated as GPL until decided. Relative imports, `from . import x`, submodule imports, and imports of a parent package are resolved against the files of the repository and are not review triggers. A literal `__import__("x")` or `importlib.import_module("x")` is read as an ordinary import of `x`.

### The two helpers that stay MIT, and the decision that is the owner's

`common.py` and `geometry.py` use no Blender API, but they do run inside Blender's interpreter, imported by the GPL files. The FAQ ties the GPL to scripts "if they use Blender Python API calls", which these do not, so the repository keeps them MIT. They are **GPL-compatible**, so a combined distribution is not in conflict with the GPL, and each states its license in a header so nobody takes the directory to be uniformly GPL. The cost of the alternative is small too: relicensing them `GPL-3.0-or-later` would also be consistent. That is a choice about the owner's own code and is left as one; the check accepts either (an independent file must carry a GPL-compatible license, and `GPL-3.0-or-later` is on that list).

### Adding or changing a Python file

1. Add the file, with its SPDX header (`GPL-3.0-or-later` if it reaches the Blender API, directly or through a sibling).
2. Add its entry to `sourceCode.python` in `config/release-rights.json`. `npm run rights:check` tells you the classification it derived; recording a coupled file as independent fails with `PYTHON_CLASSIFICATION_MISMATCH`, and an unlisted file fails with `PYTHON_UNCLASSIFIED`.
3. Remember that the lane source is hashed into the Blender identity (below).
4. If the check reports `REVIEW_REQUIRED` for a file that does not touch Blender (a local variable called `gpu` reads as the Blender module of that name), there are two honest ways to settle it. Record it `BLENDER_API_COUPLED` with `GPL-3.0-or-later`, the conservative reading. Or, once the owner has read the file and it is independent, record it `BLENDER_INDEPENDENT` with an `ownerReview`:

   ```json
   "ownerReview": { "reviewedBy": "OWNER", "reviewedOn": "2026-11-01", "fileSha256": "<sha256 of the file's bytes>", "basis": "gpu is a local variable holding a hardware probe; the file never reaches Blender." }
   ```

   The review is pinned to the bytes it covers: editing the file re-opens it (`PYTHON_OWNER_REVIEW_STALE`). It settles only a file the analysis could not decide. It cannot downgrade a file the analysis decides is coupled, and a review on a file the analysis decides by itself is refused (`PYTHON_OWNER_REVIEW_UNNEEDED`). Like a clearance, it is the owner's declaration, and review of that edit is the control.

### A history note

Before this change the eight scripts carried no per-file license and so inherited the repository's MIT license. Copies obtained under MIT keep the terms they were given under; the files are now `GPL-3.0-or-later` going forward.

### The lane identity

`blenderSceneSourceSha256` hashes every file in `blender/walletwallaby/`, the Python and the README, so adding the license headers is an identity change even though no frame changes. The committed cross-class reference (`blender/proof/reference/proof.json`) records that hash, so it was re-exported from a render of the new source on the production render host (`production-rtx5080`): see [Verification](#verification-that-nothing-rendered-changed). The syntax tree of all ten files, docstrings included, is identical to what it was before the headers.

## Third-party inventory

Locked npm packages: **303**. Every one is accounted for by `rights:check` from `package-lock.json` alone.

| Group | Packages | Handling |
|---|---|---|
| MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, Python-2.0 | 278 | permissive; admitted without a record, grouped in the `npm-permissive-dependencies` component. They are not redistributed, so the notice conditions that attach to redistribution are not triggered. |
| Remotion's own license (`SEE LICENSE IN LICENSE.md`, `Remotion License`, or a URL) | 9 | the `remotion` component, `OWNER_CONFIRMATION_PENDING` |
| No license field at all (7 `@remotion/compositor-*` binaries and `@remotion/media`) | 8 | treated under Remotion's license until the vendor says otherwise, never as MIT |
| MPL-2.0 | 4 | the `mediabunny` component |
| OFL-1.1 | 3 | the three font components |
| CC-BY-4.0 | 1 | the `caniuse-lite` component |

Rust crates: **12** (seven compiled into the committed `.wasm`, five build-time only), all MIT, MIT-or-Apache-2.0, or Unlicense-or-MIT, read from the crates.io record of each locked version (the registry checksum equals `Cargo.lock`'s).

A package whose license is anything else, or that the lockfile records none for, fails `rights:check` until a rule and a component cover it. A rule must name the license the lockfile records, so it cannot wave through a different one.

### Remotion

Remotion is the one dependency whose license is **not** open source, and it has an open owner question.

**What the texts say.** The installed `remotion` 4.0.532 `LICENSE.md` is the vendor's own license. It grants a Free License to: an individual; a for-profit organization with up to 3 employees; a non-profit or not-for-profit organization; or someone evaluating Remotion without using it commercially. Others need a Company License. The Free License permits commercial use for creating videos and images, and forbids copying or modifying Remotion to sell, license, or sublicense your own derivative. It also says the license "will slightly change" in Remotion 5.0.

The wording of the eligibility test is not the same everywhere the vendor states it:

| Source | Wording |
|---|---|
| Installed `LICENSE.md` (4.0.532) | "a for-profit organization with up to 3 employees" |
| Pricing page (https://www.remotion.pro/license) | "companies of up to 3 people"; a Company License for "collaborations and companies of 4+ people"; it does not define how people are counted |
| Terms (https://www.remotion.dev/docs/terms), labelled version 5.0 and not yet in effect | "an organization or team of individuals with up to 3 people"; a Company License when the combined **headcount of all involved parties** reaches 4; headcount means all personnel, whether or not they use Remotion; a client who only receives finished media is not counted |
| License FAQ (https://www.remotion.dev/docs/license/faq) | incorporation does not change eligibility; the test is total headcount; freelancers or an agency brought in on the same project add to it; GitHub organizations are not mentioned |

**The fact pattern.** This repository lives in the Wallet-Wall GitHub organization, which has more than one human member. The development and operation of the Remotion project is currently done by the owner. Whether that qualifies for the Free License depends on how the vendor counts headcount, which the texts above do not settle, so it is an owner and vendor clarification item. **A GitHub organization's member count is not a legal headcount, and nothing here uses it as one.** The record states no number of people.

**Status: `OWNER_CONFIRMATION_PENDING`.** No paid license is claimed to exist, none was bought, and `CLEARED` requires the owner's own record (`clearance.clearedBy: "OWNER"`). Remotion is also why the generated MP4 (`remotion-render-output`) is not treated as cleared yet. The Terms labelled 5.0 say users hold the rights in media they generate; the installed 4.0.532 text says nothing about output.

**Reassessment triggers.** The Remotion version is pinned: `rights:check` fails with `REASSESSMENT_REQUIRED` when the lockfile resolves a Remotion package at a version other than the one assessed, so reading the new `LICENSE.md` is part of any bump. Also: Remotion 5.0 taking effect; a change in who develops or operates the project or in its team size; a change in the vendor's terms.

### Fonts

Sora and Manrope (`@fontsource-variable/*` 5.2.8) and IBM Plex Mono (`@fontsource/ibm-plex-mono` 5.2.7) are under the SIL Open Font License 1.1, read from each package's `LICENSE`. Copyright holders: The Sora Project Authors, The Manrope Project Authors, IBM Corp. None of the three license files names a Reserved Font Name. The font files are not committed and the video carries rendered glyph images, not font files; the OFL's conditions that bite on redistribution (ship the license and copyright notice, do not sell the font by itself) would apply only if the font files were redistributed. Status `CLEARED`.

### Mediabunny (MPL-2.0)

Mediabunny and its three encoder extensions (version 1.56.1) are MPL-2.0. MPL-2.0 is **file-level** copyleft, not repository-wide: if MPL-covered files are distributed, those files and changes to them must be available under the MPL, and the rest of a program can keep its license. This repository does not modify or redistribute them, and they reach it only through Remotion Studio's packages, so no obligation is triggered. The encoder extensions embed WebAssembly builds of FFmpeg's AAC encoder, libFLAC, and LAME (LGPL), which have their own terms and are likewise not distributed here. Status `CLEARED` for the current use; redistributing any of it reopens the question.

### CC-BY-4.0 data

`caniuse-lite` (CC-BY-4.0, by Ben Briggs per its `package.json`) is loaded by `browserslist` for the bundler's tooling. It is not committed or modified, and it is in no release artifact, so CC BY's attribution duty (which attaches to sharing the material) is not triggered. Attribution is given in the notices anyway. Status `CLEARED`.

### Rust crates in the committed `.wasm`

The committed `motion_intelligence.wasm` is distributed with the repository, so the crates compiled into it need their notices to accompany it: `serde`, `serde_core`, `serde_json`, `itoa`, `zmij`, `memchr`, and `libm`. `libm` carries additional copyright notices for musl and for Sun Microsystems and others. Rust's own `core` and `alloc` libraries are compiled in as well (MIT or Apache-2.0, "Copyright (c) The Rust Project Contributors"); the toolchain's separately tracked third-party parts (its `COPYRIGHT.html`) were not itemised. All are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), and `rights:check` fails if a compiled crate lacks its notice.

### ElevenLabs

ElevenLabs is an external proprietary service, **not** an open-source dependency, and its terms are not treated as a license of the software. Its Terms of Use (last updated 09 October 2026 when read) limit free plans to non-commercial use and allow commercial use on paid plans, leave the user's rights in the output with the user subject to the Terms, and require that you hold the rights to what you input. Commercial-use eligibility therefore derives from the owner's plan and the terms in force **at the time of each synthesis**; the manifest records that requirement, and that synthesis was on a paid plan, but no plan tier, account identifier, or credential. The supplemental documents were read on 2026-10-22 (the general, non-EEA editions): the Prohibited Use Policy, the Voice Library Addendum, and the API and Creative service terms. The API terms defer rights in output to the Terms and are silent on voices; the Creative terms (§2) require the user to hold consents for the voice or likeness of any identifiable person in the input, which this pipeline never supplies (no reference audio is used); neither mentions the Voice Library.

The narration voice is a Professional Voice Clone from the provider's Voice Library. Its rights are a rights-and-consent matter, recorded in the `voiceRights` of `elevenlabs-service` ([RELEASE_RIGHTS.md](RELEASE_RIGHTS.md), "Voice rights"): the provider lets only the person whose voice it is create, verify, and publish such a clone for other users, so the voice is used under the provider's authorization and WalletWall claims none of the speaker's voice or likeness (only its authored script, composition, and audiovisual work). Cloning a person's voice, or using reference audio, without that person's authorization stays prohibited, as does impersonation. The right to use the voice and the right to use its output commercially are recorded separately.

Output and provenance evidence for a synthesis run belong to the narration receipt path ([NARRATION.md](NARRATION.md)). Status `CLEARED` by the owner's record of 2026-10-22 for the service, the narration audio, and the video's narration; it is reassessed before each synthesis run, on a change of plan or terms, and if the voice is withdrawn.

### A provenance finding: Inigo Quilez's forms

`geometry.py` says its signed-distance primitives are "Inigo Quilez's forms, vectorised". Reading the source (https://iquilezles.org/articles/distfunctions/): the page states no license, copyright, or reuse terms, and the reference implementations it links live on Shadertoy, whose licenses are set per shader and were not reviewed. The two functions (`sd_ellipsoid`, `sd_round_cone`) are short formulas re-expressed in numpy. Nothing here decides whether anything more is owed: the item is `OWNER_CONFIRMATION_PENDING` and blocks a public release by itself. The owner can accept the attribution as sufficient, ask the author, or replace the two primitives.

The item is about the code in this repository, not about what the code computes. The model, the character, and the character frames name it as third-party code in their sources (`thirdPartyCodeInSources`), not as something inside them: the `.blend` holds no code. Clearing them while this item stays open is the owner's decision (2026-10-25), and the record states only what supports it, that none of this code is in the model or the frames; it decides nothing about the code itself, which has no stated license. Replacing the primitives would change the model and reopen those records. One scope note for the owner's decision: the section of `geometry.py` under that credit also holds `smin` and `smax`, the quadratic polynomial smooth minimum in the form Quilez's smooth-minimum article publishes (https://iquilezles.org/articles/smin/, read 2026-10-25, which states no license either), and the record names only the two primitives.

### The brand mark

`assets/brand/walletwall-brick-wallet.png` entered in one commit by the maintainer (2026-10-17), supplied as a 496 × 496 PNG and changed only by the deterministic edge polish its README records; no attribution, source comment, or later commit names another origin. The owner states (2026-10-25) that it is a WalletWall-authored project asset into which WalletWall is not knowingly incorporating a third-party logo or trademark. It is `CLEARED` on that provenance record, bound to the mark's sha256, which is the hash the spec stages for the footer. That covers the artwork, not a trademark search, and nothing in the fonts or the frames it is drawn in.

### What was not assessed

Not part of any release artifact and not assessed here: Node.js, the Chrome Headless Shell that Remotion downloads on first render, the FFmpeg that Remotion's compositor bundles, the operating system and GPU drivers, and the GitHub Actions runners. The local narration adapters (Magpie, Chatterbox) are recorded as research-only: no render or publish path imports them (`test/guards.test.ts`), and their model licenses are unverified. If any of these ever ships in, or contributes to, a release, it needs a component.

## What `rights:check` does and does not do

It reads only committed files: no network, no environment variable, no credential, no clock, no subprocess. It never makes a legal inference beyond the policy in `src/rights/vocabulary.ts`. It checks that:

- the manifest is a closed schema and holds no local path, secret, personal address, or account-shaped detail (patterns, not proof: the record is reviewed as well);
- the license texts exist and are the pinned bytes, `LICENSE` is MIT, and `package.json` and `Cargo.toml` still say so;
- every Python file (any extension case, or an extensionless Python script) is listed, classified as the code derives, and carries the right SPDX header, and a file the check cannot read is a finding; Blender Python hidden in other source types is found;
- every locked npm package and Cargo crate is accounted for, a lockfile rule only borrows a component whose license covers what the lockfile records, and the Remotion assessment is pinned to the version the lockfile resolves;
- every font package is recorded as a font, every tracked media or compiled file is in the media inventory once, by its exact path (images, audio, video, fonts, 3D models and their textures and materials, stored arrays, WebAssembly, Python bytecode and extension modules, shared libraries, and zip and wheel archives; a file dropped beside an inventoried one is not covered by it), and every spec asset, sonic asset (in any section of the sonic identity), narration, font, and source page of every video has a rights entry against the exact bytes or blob;
- the tools the repository's own configuration requires (Blender, Remotion, the narration provider) are recorded as release-path tool components, so they cannot be relabelled research-only, and a repository with a Blender lane records the character as a generated-model component that every video binds under the `three-d-asset` category (a font package likewise under `font`), so a video cannot file it elsewhere and declare the category absent;
- a `CLEARED` open-source item does not rest on a non-commercial or network-copyleft license alone (`CC-BY-NC-*`, `AGPL-*`): the status must say why it is not cleared, or the expression must name an alternative the owner can take with `OR`;
- no component is CLEARED above a tool it is produced by or a component it depends on;
- an owner-authored or generated item is CLEARED only on a provenance record whose files are still the committed bytes, no media rides on it, every third-party-derived source its files carry is named, generated media is never recorded as authored or under a tool's license, and an asset bound to generated media is never recorded under an open-source license;
- every component has a notice, and no release state claims more than the rights support.

It does **not** decide whether an open item is acceptable, read `node_modules`, or verify a vendor's claims. Those are the owner's.

### Limits of the analysis

- **The Python analysis is a token-level scan, not a parser.** It fails closed on what it can see: an import it cannot read, and every name in code that reaches Python's import machinery or its live namespaces (`__import__` and `import_module` other than with a string literal, `builtins`, `exec`, `eval`, `compile`, `sys.modules`, `globals`, `importlib` beyond `metadata` and `resources`, `runpy`, `pkgutil`, `ctypes`, and the like). A string that spells `__import__`, `import_module`, `__builtins__`, or `__loader__` is flagged too, because a string can be handed to `getattr`. Non-ASCII outside strings and comments, a non-UTF-8 source cookie, an unterminated string, and f-string expressions that do any of these are also `REVIEW_REQUIRED`. **It cannot close a module name that is assembled at run time** (a string built by concatenation or decoded from data, then imported through a route the scan does not name): a determined author can write Python that reaches the Blender API in a way no static scan sees. Running Python's own `ast` in CI would be a stronger second opinion, and neither replaces review of the code.
- **What is scanned is what is on disk, except `.gitignore`'s own directories.** A file that git tracks under an ignored name would escape the scan; `test/rights-repo.test.ts` fails if the scan misses any file `git ls-files` lists.
- **Tests are exempt from the embedded-Python scan** because they spell the pattern on purpose. A script handed to Blender can only be one of the lane's own entries (`BLENDER_ENTRIES` in `src/blender/toolchain.ts`).
- **Owner-authored and generated items clear on a provenance record**: the owner's statement and the exact committed bytes it is about. The check holds the bytes; it cannot verify the statement, which is a declaration, like a clearance, and review of the edit is the control. A vendor's, a provider's, or a third party's terms need a clearance record naming the owner. `dependsOn` and `producedBy` make a component unable to be CLEARED above what it depends on; `thirdPartyCodeInSources` records third-party code an item is computed with and does not make it so.
- **`linkage` of a Cargo crate (compiled in, or build-time only) is a recorded fact**, derived from the dependency graph by hand; the lockfile alone cannot prove it.
- **The `ownerAuthorization` record is a declaration, not authentication** ([RELEASE_RIGHTS.md](RELEASE_RIGHTS.md)).

## Verification that nothing rendered changed

The headers and the README paragraph are comments and prose, but the lane source is hashed into the Blender identity, so the claim "no frame changed" was measured rather than assumed. On the production render host (`production-rtx5080`, RTX 5080, driver 616.56, Blender 5.2.2 `d13f752e3b9c`), with the final source:

- The syntax tree of all ten Python files, docstrings included, is identical to `HEAD`'s.
- The rebuilt character has the same canonical model hash as the reference (`f8124e59…`), and the same materials.
- The proof set (ten frames, including the depth reveal) renders in the same environment class as the reference. **All ten frames are byte-identical to the committed reference**, and the two reveal layer images have the same hashes. The only field of `blender/proof/reference/proof.json` that differs is `blenderSceneSourceSha256` (`c7196071…` to `ad53c844…`), so the reference was re-exported with `npm run blender:proof -- export-reference`; its PNGs did not change.
- `npm run blender:invariants` passes on 786 frames, and `npm run blender:determinism` holds (two builds, 8 of 8 frames; shuffled order, 8 of 8).

The Blender proof workflow's cross-class comparison against the reference (`.github/workflows/blender-proof.yml`, manual dispatch) requires the reference and the run to record the same lane source; that is why the reference had to be re-exported.

## Keeping it true

| When | Do |
|---|---|
| A dependency is added or bumped | `npm run rights:check`. A new non-permissive license needs a rule and a component; a Remotion bump needs the new `LICENSE.md` read. |
| A Rust crate changes | Update its entry (version, checksum, license) from the registry record, and its notice if it is compiled in. |
| A media or compiled file is added, renamed, or removed | Add, update, or remove its exact path in a `mediaFiles` entry that names the component or video asset whose rights cover it. There is no directory form. |
| A Python file is added | See [Adding or changing a Python file](#adding-or-changing-a-python-file). |
| A spec asset, sonic asset, or narration changes | Add or update its rights entry against the new bytes. |
| An owner decision is made | Set the status, with `clearance.clearedBy: "OWNER"` where a vendor's, provider's, or third party's terms are involved, and the owner's `provenance` record where the item is owner-authored or generated. |
| A file an owner item's provenance binds changes (a lane module, the rig contract, `versions.ts`, the brand mark, a reference frame) | `rights:check` reports the record stale (`PROVENANCE_STALE`). Re-establish the item's rights and record the new sha256 with the owner's attestation, or set it back to `OWNER_CONFIRMATION_PENDING` and remove its record (a record is checked whatever the status). |
