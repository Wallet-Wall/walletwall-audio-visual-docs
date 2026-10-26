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
- A `VENDOR_LICENSE`, `PROVIDER_TERMS`, or `THIRD_PARTY_ATTRIBUTION_ONLY` basis is `CLEARED` only with a `clearance` record (`clearedBy: "OWNER"`, the date, and why). An owner-authored or generated item takes none: it is `CLEARED` only on its `provenance` record ([Owner-authored and generated items](#owner-authored-and-generated-items)).
- An asset cannot be `CLEARED` while the component it is bound to is not, and a component cannot be `CLEARED` while a component it is `producedBy` or `dependsOn` is not. For example the Blender character frames depend on the model, and the depth-reveal frames on Remotion's output.
- An open-source basis names only recognised SPDX identifiers (`RECOGNISED_SPDX_IDS` in `src/rights/vocabulary.ts`), so a made-up identifier cannot stand in for a license.
- A non-commercial or network-copyleft license (`CC-BY-NC-*`, `AGPL-*`; `RESTRICTED_SPDX_IDS`) cannot be the whole basis of a `CLEARED` open-source item. Such an item is recorded `NONCOMMERCIAL`, `INCOMPATIBLE`, or `OWNER_CONFIRMATION_PENDING`, or its expression names an alternative the owner can take with `OR`. Other copyleft licenses (GPL, LGPL, MPL, OFL, CC-BY-SA) attach their duties to distribution, so a component records `distribution` and its notice, and the review of the manifest is the control on whether that is enough.
- **Who clears what.** A vendor's, a provider's, or a third party's terms are cleared only by a `clearance` record naming the owner. An owner-authored or generated item is cleared on a `provenance` record: the owner's statement, and the exact committed bytes it is about, which the check hashes. Review of that edit is the control on the statement; the check holds the bytes.
- **The media inventory is by exact path.** Every tracked image, audio, video, font, 3D model, texture, material, stored array, WebAssembly, Python bytecode or extension module, shared library, and zip or wheel archive is listed in `mediaFiles`, once, each entry naming one `path` or an exact `paths` list and the component or video asset whose rights cover it. There is no directory form: a file dropped beside an inventoried one is unrecorded (`MEDIA_FILE_UNRECORDED`), and an entry that lists a file that is gone is stale (`MEDIA_ENTRY_STALE`).

## Four layers, kept apart

One status never stands for another, so the manifest keeps four things separate:

| Layer | What it answers | Where |
|---|---|---|
| Source-code licensing | What license covers each file of this repository. | `sourceCode`, plus `SOURCE_CODE` components for third-party code inside it |
| Tool and runtime licensing | May this repository use Blender, Remotion, fonts, and dependencies to make a release, and what do they require? | `TOOL_RUNTIME` components, and `dependencies` |
| Generated-media rights | Who holds the rights in what the tools produced (frames, the `.blend`, the MP4, narration audio)? | `GENERATED_MEDIA` components, each naming the tools that produced it |
| Per-video asset rights | Do the specific assets this video shows and plays have rights recorded against their exact bytes? | `videos[].assets` |

For example, Blender's GPL is `CLEARED` as a tool (it may be used for any purpose) while the character frames it produces are the creator's, and the GPL on the scripts says nothing about the video's license. Remotion's eligibility is a separate question from who owns the frames it renders. The schema holds the line: generated media is never recorded as authored, or under the license of the tool or the scripts that made it (`GENERATED_MEDIA_BASES` in `src/rights/vocabulary.ts`).

## Asset categories

Every video must account for every category below: either it has an asset of that category, or the category is declared `absent`. Declaring a category absent is checked where the repository can check it (a spec asset, a sonic asset, a narration binding, or a source page that exists must have an entry), so `absent` cannot hide something that is there.

| Category | Rule |
|---|---|
| `authored-content` | The docs page a video is made from, recorded against its git blob. Owner-authored. |
| `narration` | Synthetic or recorded speech. Bound to its provider component, whose `voiceRights` record says whose voice it is, why WalletWall may use it, and what lets its output be used commercially ([Voice rights](#voice-rights)); the provider's terms at synthesis time decide commercial use. A voice is used on a rights-and-consent basis: a person's voice is never cloned, and reference audio is never used, without that person's authorization; a voice is never used to impersonate; and WalletWall claims none of a speaker's voice or likeness. |
| `music` | A music bed. Nothing is cleared for being available online. Needs a license or an owner-authored basis, recorded against the sonic asset id. None is assigned today. |
| `sfx` | The ident and event sounds, under the same rule. None is assigned today. |
| `font` | Bound to its font component and license (OFL-1.1 today). An asset that binds a font-package component is recorded as `font`. |
| `screenshot` | A captured image of a product or a chain explorer. Needs the right to show it. None today. |
| `ui-capture` | A capture of a real UI. Needs the right to show it and no private data. None today. |
| `logo-trademark` | A brand mark, recorded against its bytes. Needs the owner's provenance record: who states that WalletWall made it, and the sha256 of the bytes the spec uses. |
| `illustration` | Drawn artwork shipped as a file. Art drawn by code is owner-authored and has no file to record. None today. |
| `third-party-media` | Third-party video or images. The pipeline has no asset kind for stock footage, generated imagery, or presenters. None today, and a new one would need a new kind. |
| `three-d-asset` | 3D models and materials. The character is generated from owner code; nothing external is imported, and an imported mesh or texture could not be folded into the owner's record (a media file is never a provenance `SOURCE`). The signed-distance primitives credited to a third party are code the build runs, recorded as their own item. A repository with a Blender lane (`config/blender.json`) must record the character as a `generated-model` component on the release path, and every video binds it under this category (`CHARACTER_UNRECORDED`, `COMPONENT_UNBOUND`, `COMPONENT_CATEGORY_MISMATCH`). |

The other two categories the policy names, `source-script` and `software-dependency`, are not per-video: they are the source-code license map and the dependency components.

## Owner-authored and generated items

**Policy (owner, 2026-10-25).** An item WalletWall authored (`OWNER_AUTHORED`) or generated from what it authored (`GENERATED_FROM_OWNER_INPUTS`) is cleared on the owner's word, and only for what WalletWall made. It never covers the idea of a wallaby, generic anatomy or geometric primitives, Blender, Remotion, a font, a library, a third party's mathematical implementation, a narrator's voice or likeness, or a mathematical idea.

The word is recorded with what it is about, in a `provenance` record on the item. The basis says whether the clearance is about the asset itself (`OWNER_AUTHORED`) or about output generated from owner inputs (`GENERATED_FROM_OWNER_INPUTS`).

| Field | Question it answers |
|---|---|
| `attestation` | Who states it (`attestedBy: "OWNER"`, no name), the day, and what the statement rests on. |
| `files` | The exact committed bytes the record is about, each by path, sha256, and role: `ASSET` (the item's own bytes, authored items only), `SOURCE` (what it is authored in or generated from, never a media file), `OUTPUT` (what it generated that the repository keeps, generated items only). |
| `thirdPartyCodeInSources` | Third-party-derived code those sources carry, which the item is computed with but does not contain. |

Three relations stay apart, because none stands for another:

| Relation | Means | Effect |
|---|---|---|
| `dependsOn` | The item contains the other (the frames show the model). | The item is not `CLEARED` above it. |
| `producedBy` | A tool made it (Blender). | The item is not `CLEARED` above the tool, which is judged as a tool. |
| `thirdPartyCodeInSources` | Code that computes the item carries third-party-derived source, which is not in the item. | The item may be `CLEARED`. The code stays its own item on the release path and blocks a public release by itself. |

What the check enforces:

- An owner item is `CLEARED` only with a provenance record; a status edit alone is refused. A docs page bound to its published blob is the one exception: that binding is its provenance.
- Every bound file is a file of the repository and still those bytes. Changing one (a lane module, the rig contract, `versions.ts`, the brand mark, a reference frame) makes the record stale in either mode (`PROVENANCE_STALE`, `PROVENANCE_FILE_MISSING`) until the owner re-establishes it and the new sha256 is recorded, or the item goes back to `OWNER_CONFIRMATION_PENDING` without the record (a record is checked whatever the item's status). A spec asset's record binds the bytes the spec uses.
- Nothing rides on a record. A media file the inventory gives the item is one the record binds (`PROVENANCE_MEDIA_UNBOUND`), and an owner item cleared without a record (the docs page) carries no media at all. A file the record binds as the item's own belongs to no other record (`PROVENANCE_MEDIA_ELSEWHERE`), and a file is inventoried once. A media file is never a `SOURCE`: an imported mesh, texture, or sound has rights of its own, so it is recorded as its own item and depended on. An `OUTPUT` is the kind of file the item's generator makes (a model's is a model file, a render's an image or video), never code.
- Third-party code is named, never hidden. A third-party-derived source component that cites any file the record binds, under any role, is named in `thirdPartyCodeInSources` or depended on; nothing else can be named there, and an item never names itself.
- Only an owner basis carries a provenance record. Third-party-derived source never takes an owner basis, an asset bound to generated media is never recorded under an open-source license, and a docs page is cleared on its blob only as the page the video is made from, recorded as `authored-content`.

What the check cannot see, and review must: whether a file bound as an `OUTPUT` really came from the generator and not from elsewhere (the label is the owner's declaration); an item moved to another basis or deleted outright (the repository's tests pin these records, `test/rights-owner-assets.test.ts`, and that the lane modules each record binds are every module its entry script loads); and the frames inside a release, which this record covers as a class and the publication receipt binds by hash.

### Blender: script license, owner inputs, rendered output

- The **scripts** that call the Blender Python API are `GPL-3.0-or-later` in the source-code map. The repository stays MIT around them, and `rights:check` refuses relabelling either way.
- The **inputs** WalletWall supplies (the character, its rig and materials, the scene code) are the owner's, on provenance records.
- The **frames** are output. Blender's license page says what you create with Blender is your sole property, its FAQ that a `.blend` is program output and the user's, and the GNU GPL FAQ that a program's license does not reach its output unless the output copies the program's own text or art (all read 2026-10-25). A frame's rights follow its inputs, so the character frames are the owner's, while the depth-reveal frames project Remotion's own frames and wait for `remotion-render-output`.

### The items cleared on 2026-10-25

| Item | Basis | What its record binds | What it does not cover |
|---|---|---|---|
| `brand-mark` | `OWNER_AUTHORED` | the committed mark (`91926a2e…`), the bytes the footer stages | a trademark search or registration; the fonts and Remotion frames it is drawn in |
| `character` | `OWNER_AUTHORED` | the rig contract, the poses and palette, the body design, the declared versions | the idea of a wallaby, anatomy, primitives, Blender, Remotion, the Quilez-credited code |
| `walletwallaby-character-model` | `GENERATED_FROM_OWNER_INPUTS` | every lane module `build.py` loads, and `versions.ts` (the canonical model pin) | the Quilez-credited code it runs (`quilez-sdf-forms`) |
| `blender-render-output` | `GENERATED_FROM_OWNER_INPUTS` | every lane module `render.py` loads, the two job writers that give a character job no image, and the seven character reference frames | Blender, the GPL scripts, the depth-reveal frames (`blender-depth-reveal-output`) |

The evidence: the brand mark entered in one commit by the maintainer and changed since only by a recorded deterministic polish, which is consistent with the owner's statement and all the repository can say (it does not record the tool the artwork was made with); `build.py` builds the model from an empty factory scene and the frames are rendered in a scene the lane's code builds around it, and no version of the lane in the history imports, downloads, or links a mesh, texture, rig, or material library, or credits anyone but Inigo Quilez. The records are the owner's declarations bound to the bytes they are about, not authentication; review of the edit is the control.

### What this does not establish

- Anything about `quilez-sdf-forms`, `remotion`, `remotion-render-output`, or `blender-depth-reveal-output`. Each stays pending, and each still blocks a public release.
- That WalletWall owns Blender, Remotion, the fonts, a library, Inigo Quilez's work, a narrator's voice or likeness, or a mathematical idea.
- A trademark clearance for the brand mark.
- Any future output made with material these records do not bind: it is not covered until a record of its own says so.

## Voice rights

**Policy (owner, 2026-10-22).** WalletWall must not steal a voice, clone one without authorization, impersonate deceptively, appropriate another person's likeness, violate a person's rights or applicable law, or use a voice outside the rights its provider or rights holder granted. It does **not** refuse a voice merely because a human is behind it. This replaces an earlier rule, written to be over-conservative, that a real person's voice is never used at all ("a real person's voice is never cloned, and no reference audio is used").

A narration voice is **allowed only when its rights are established**, by one of three routes:

1. a synthetic or provider-designed voice (Voice Design): there is no human speaker to authorize;
2. a Professional Voice Clone that its verified owner intentionally made available to others through the provider (the Voice Library);
3. another voice its speaker authorized in writing, with the commercial-use rights and scope documented.

It is **prohibited** to:

1. clone a voice without the speaker's authorization;
2. clone or condition a voice on reference audio without the speaker's authorization;
3. impersonate, or attribute a voice deceptively;
4. present the narrator's voice or likeness as WalletWall's own;
5. bypass the provider's moderation, notice periods, access controls, or other restrictions;
6. use a voice outside the scope the provider or rights holder permits;
7. use a voice whose rights basis cannot be established;
8. evade a takedown, restriction, or withdrawal of authorization.

**What WalletWall owns:** its authored script, its composition, and the audiovisual work. It does not own, and never records as its own, the narrator's underlying voice or likeness.

### How it is recorded

The provider service the publication narration is made with (`elevenlabs-service`) carries a `voiceRights` record. It keeps apart what one status would otherwise blur:

| Field | Question it answers |
|---|---|
| `source`, `voiceType` | What is the voice: `ELEVENLABS_VOICE_LIBRARY` / `PROFESSIONAL_VOICE_CLONE`, `PROVIDER_DESIGNED_SYNTHETIC` / `VOICE_DESIGN`, or a voice licensed directly by its speaker (`SPEAKER_LICENSED_DIRECT`: `RECORDED_SPEAKER`, or `REFERENCE_AUDIO_CLONE`). |
| `authorizationBasis` | How is the speaker's consent established: `VERIFIED_OWNER_PUBLISHED` (the provider verified the speaker and the speaker published the clone for others), `SPEAKER_WRITTEN_AUTHORIZATION`, or `NO_HUMAN_SPEAKER`. |
| `useBasis` | Who lets WalletWall use the voice: `PROVIDER_AUTHORIZED` or `SPEAKER_LICENSED`. |
| `commercialOutputBasis` | What lets the audio it produces be used commercially: `PAID_PLAN_TERMS` or `SPEAKER_LICENSE`. **Separate from the three above.** |
| `ownership` | What WalletWall claims (`AUTHORED_SCRIPT`, `COMPOSITION`, `AUDIOVISUAL_WORK`; nothing else is accepted) and that the speaker keeps their voice and likeness (`SPEAKER_RETAINS`). |
| `attestation` | Who says the voice is what the record states (the owner), the day, and what that rests on. Required once the origin is established, so no route is stated as fact on nobody's word. |
| `speakerAuthorization` | For a speaker's written authorization only: when it was granted, that the owner holds the document (it stays out of this public file), and what it covers (`VOICE_CLONING`, `COMMERCIAL_USE`, `PUBLIC_DISTRIBUTION`). A `CLEARED` one covers commercial use and public distribution, and cloning too when the voice is cloned from reference audio. |
| `providerControls` | The notice period, Live Moderation, custom restrictions, and removal from the Voice Library, each as found or as undetermined with the exact uncertainty. |
| `binding` | The narration binding id and the sha256 of the configured voice id, so a swapped voice cannot inherit the clearance. The voice id itself is not recorded. |

The component's `rightsBasis` stays `PROVIDER_TERMS` (or `VENDOR_LICENSE`): a voice is never `OWNER_AUTHORED`, generated from owner inputs, or open source.

The schema refuses what the policy prohibits and clears only what it establishes:

- **The routes are closed.** Each field must be the one the field before it requires. A Professional Voice Clone is authorized only by its verified owner's publication, and a clone made from reference audio only by the speaker's written authorization; neither can borrow the other's basis, and a `REFERENCE_AUDIO_CLONE` cannot be recorded as a Voice Library voice.
- **An unauthorized voice is `BLOCKED`.** An `authorizationBasis` or `useBasis` of `NOT_ESTABLISHED` is a voice nobody authorized: it is never pending and never `CLEARED`, and a release cannot carry it.
- **An unknown origin is never cleared.** A source, type, authorization, or use basis of `UNDETERMINED` limits the status to `UNKNOWN`, `UNVERIFIED`, or `BLOCKED`. A narration provider with no `voiceRights` at all fails the development check (`VOICE_RIGHTS_MISSING`).
- **The right to the voice and the right to its output are each needed.** A voice whose origin is established is still not `CLEARED` while its `commercialOutputBasis` is not, and an established output basis does not authorize a voice. The generated audio and the video's narration cannot be cleared above the service (`COMPONENT_ABOVE_DEPENDENCY`, `ASSET_ABOVE_COMPONENT`).
- **A provider control is recorded or it is an error.** A Voice Library voice lists all four controls, once each; none can be left out. A control found is recorded with who read it and when (the owner, on the provider's interface); one that cannot be read offline is recorded as `UNDETERMINED` with the exact uncertainty in `note`, and that **does not block** a clearance: a Professional Voice Clone is not blocked as a category. A notice period and Live Moderation are conditions of availability and never block. A `CUSTOM_RESTRICTION` or a `LIBRARY_REMOVAL` in force restricts use, so it carries the owner's `compliance` record (`SATISFIED`, `NOT_SATISFIED`, or, for a withdrawal, `EXISTING_OUTPUT_ONLY`) and a voice is not `CLEARED` while one is `NOT_SATISFIED`.
- **Nothing here can be cleared by proxy.** Only a provider service records a voice, so no other component (Remotion, the character, a render output) is touched by a voice clearance.

### A withdrawal is prospective

A voice's owner may withdraw it, and the provider may remove it (the Voice Library Addendum reserves that right, with or without notice). What follows is the provider's notice and access terms: with a notice period the voice leaves the Library at once, users who saved it keep access until the period ends, and output generated before it ends continues to exist. So a later withdrawal changes what may be synthesized after it takes effect. It is no evidence that output generated while the voice was authorized was unauthorized, and the record does not treat it as such.

When one happens the owner records it under `LIBRARY_REMOVAL`, and there are two honest records. Inside the notice period the voice is still usable, so the owner records `compliance: SATISFIED`. Once the withdrawal has taken effect, the owner records `compliance: EXISTING_OUTPUT_ONLY`: no new synthesis is run with the voice, and the set already generated while it was available stays cleared and is the only output used. `NOT_SATISFIED` is the record of a use that is no longer permitted; it keeps the service from `CLEARED`, and because the audio and the narration can never be cleared above the service (the general dependency rules are not loosened), it takes them out of `CLEARED` with it. Choosing `EXISTING_OUTPUT_ONLY` is the owner's declaration, like every `clearance`.

The check cannot see a withdrawal, the narration set (it lives in the ignored `dist`), or when a set was generated. A clearance names its reassessment triggers (each synthesis run, a change of plan or terms, a withdrawal) as duties of the owner, not something the check enforces; enforcing "a new synthesis reopens this" is the receipt follow-up below.

### The existing narration voice

The publication binding `walletwallaby-elevenlabs-v1` speaks with a voice from the provider's Voice Library: a Professional Voice Clone in Australian English. By the provider's own rules such a clone is created, verified, and published only by the person whose voice it is, for other users; this record rests on those rules and on what the owner saw, not on an independent check of who the speaker is. The owner inspected the voice in the provider's interface and reported, on 2026-10-22, the Professional Voice Clone badge and a 30-day notice period; those two observations are the owner's, are recorded as such, and cannot be re-read offline. The other three controls are recorded `UNDETERMINED`. The narration set generated with it (`412671a1`, 24 lines, through the owner's paid account) is cleared on that basis; it is not resynthesized.

What the provider's own documents say, read on 2026-10-22 (the sections are the ones cited in the manifest evidence):

| Fact | Source |
|---|---|
| Only a Professional Voice Clone can be published to the Voice Library, and the Library accepts only clones verified by a human. | Voice Library documentation |
| A Professional Voice Clone is of the creator's own voice only, and verification confirms the voice belongs to them; even with consent, nobody can clone someone else's voice and share it. | Professional Voice Cloning documentation; Voice Library Addendum §3 (updated 6 March 2026) |
| The sharer represents that they hold the rights and permissions, and authorizes the provider to make the voice available so that others can generate output with it. | Voice Library Addendum §§2–3 |
| The owner chooses a notice period (the documentation gives a minimum of 30 days and a maximum of 2 years) and may enable Live Moderation; the provider can remove any shared voice in its discretion. | Voice Library documentation; Addendum §§4, 8 |
| Paid users' generation counts toward the voice owner's rewards; free-plan use does not. The owner may exclude free users. | Payouts documentation; Addendum §4; Voice Library documentation |
| Free plans are limited to non-commercial use, paid plans may use the services commercially, and as between the user and the provider the user keeps the rights in the output, subject to the Prohibited Use Policy. | Terms of Use §1(c), §4(c) (updated 09 October 2026); help-center article on publishing generated content |
| Cloning, synthesizing, or impersonating a living person's voice or likeness without explicit, informed consent or other valid authorization is prohibited; so is infringing publicity rights. | Prohibited Use Policy §§3, 9 (updated 09 October 2026) |
| The ElevenAPI Terms defer rights in output to the underlying agreement and are silent on voices. The ElevenCreative Terms (§2) require the user to hold consents for the voice or likeness of any identifiable person in the Input; this pipeline supplies none (the voice is the provider's Library voice and no reference audio is used). Neither mentions the Voice Library. | ElevenAPI Terms, ElevenCreative Terms (09 October 2026) |
| Restrictions on the use of a User Voice Model that are disclosed within the Services are part of the agreement, so an owner-set restriction would bind this use. | Terms of Use, supplemental terms |

These are the provider's documents as read; they are not legal advice and they change (the Professional Voice Cloning documentation says "for now" of its own-voice rule, and the Voice Library documentation "currently" of which voices can be shared). The editions read are the general (non-EEA) Terms of Use and Voice Library Addendum; the provider also publishes EU editions, and an account governed by them needs those read before this record is relied on. The owner's statements (that the voice is the Library voice described and that the set was generated on a paid account) are declarations, not authentication, like every `clearance`.

### What the voice record does not do

- It cannot see impersonation, deceptive attribution (prohibition 3), or an attempt to evade a takedown or withdrawal (prohibition 8). Those are duties held by [AGENTS.md](../AGENTS.md) and review; the check gates what it can see: the voice's route, the speaker's authorization and its scope, the output basis, the provider controls, and what WalletWall claims.
- It does not compare the record with the provider. The synthesis step already fetches the configured voice's metadata from the provider, but nothing checks this file against it; the record rests on the owner's attestation.
- Routes it cannot express fail closed. A publication provider with no configured voice id (the local adapters), a Professional Voice Clone shared privately by link, and the provider's own stock voices cannot be recorded, so they cannot be cleared. Recording one needs a reviewed extension of the vocabulary, not a loosened rule.

## The manifest

[config/release-rights.json](../config/release-rights.json) is a **closed schema** (`walletwall.release-rights/v1`): an unknown or missing field, an unknown status, basis, layer, kind, state, or classification is a problem and never a default, and a `__proto__` member is an unknown field. It holds no local path, secret, or address, and no account identifier, plan tier, or credential detail: the shared leak policy (`src/core/leak-scan.ts`) checks it for local paths and secret-shaped values, and this check adds email addresses, password and key assignments, identifiers shaped like a provider voice id, and subscription plan tiers. Those are patterns, not proof; the record is reviewed as well. Its identity is `manifestSha256` in the report, the sha256 of its canonical JSON.

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
| Voice rights | `VOICE_RIGHTS_MISSING`, `VOICE_RIGHTS_UNBOUND`, `VOICE_BINDING_STALE`, `VOICE_SOURCE_PROVIDER_MISMATCH` (the record's own rules are manifest problems, `MANIFEST_INVALID`) |
| Owner provenance | `PROVENANCE_FILE_MISSING`, `PROVENANCE_STALE`, `PROVENANCE_MEDIA_UNBOUND`, `PROVENANCE_MEDIA_ELSEWHERE` (the record's own rules are manifest problems, `MANIFEST_INVALID`) |
| Release | `RELEASE_STATE_UNSUPPORTED`, `RIGHTS_BLOCKING_STATUS` |

## Where it runs

- **CI.** The required `Verify pipeline` job runs `npm run rights:check`, so a pull request that adds a Python file without a classification, a dependency with an unrecorded license, or a spec asset without rights fails. The same job also prints the strict readiness report in its step summary, informationally: it lists what the owner has not yet cleared and never fails the build.
- **Before a release leaves `LOCAL_PROOF`.** `npm run rights:check -- --public-release` must pass. It is a check a person runs, like the publication proof: no script refuses to upload or publish without it, and CI cannot clear anything.
- **Not (yet) bound into the publication proof receipt.** The receipt ([PUBLICATION.md](PUBLICATION.md)) does not yet carry the rights manifest's identity, and `publication:proof` does not run the rights check. That is the immediate follow-up, and it needs a decision first (below). Until then the binding runs the other way: a `PUBLIC` record in the manifest names the `receiptSha256` it authorizes.

Recording or clearing a rights item therefore moves no frame, no build identity, and no receipt: `config/release-rights.json`, these documents, and `src/rights/` are outside both (`test/rights-voice.test.ts` holds that), so clearing the narration voice, and on 2026-10-25 the brand mark, the character, its model, and its frames, did not invalidate a whole-video proof and needed no re-render. A provenance record reads the files it binds and changes none of them.

### The follow-up: binding the rights manifest into the receipt

Binding `manifestSha256` into `publication-proof-receipt` is a closed-schema change (v2 to v3) in an 805-line verifier and its fixtures, and it raises a design question that should be answered by the owner, not assumed: a receipt that binds the whole manifest would be invalidated by *any* edit, including clearing an item, which changes no frame and would force a whole-video proof to be re-run. The options are to bind a hash of only the rights *facts* (assets, bindings, license map, without statuses), to bind the full manifest but let the verifier report a mismatch as informational, or to bind at the `PUBLIC` decision (already possible through `ownerAuthorization.receiptSha256`) and leave the proof alone. `publication:proof` would also run the development rights check first and refuse to start on an invalid record.

## What this does not do

It does not decide whether an open item is acceptable, authenticate the owner, verify a vendor's claims, read `node_modules`, or look at a rendered video. It cannot see a right it was not told about: a new kind of asset needs a new category, and a new tool needs a component, which is why the detection rules (a spec asset, a sonic asset, a narration binding, a pinned tool, a lockfile entry) fail when something appears that the manifest does not cover.
