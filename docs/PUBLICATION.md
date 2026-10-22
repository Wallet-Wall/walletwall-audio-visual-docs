# Publication proof, receipt, and production host qualification

> Rust decides. Blender performs. Remotion tells the story.

This is the last boundary of the pipeline:

```text
Docs / VideoSpec → Motion Intelligence → Blender → Remotion → publication proof → receipt
```

It answers two questions, without weakening any determinism guarantee or tolerance:

1. **Which production render environment produced this publishable video, and what exactly passed?** The
   publication proof receipt.
2. **Is the production render host still the approved one after an expected change** (an NVIDIA driver update, a
   Blender patch, a graphics runtime or OS update)? Production host qualification. It produces evidence for a human;
   it never approves anything.

| Command | What it does |
|---|---|
| `npm run publication:proof` | The whole-video proof on the production render host. On PASS, `dist/publication-proof/` holds the proof package and its receipt. |
| `npm run publication:verify-receipt -- <receipt>` | Re-derives and checks everything a receipt says (`--receipt-only` without its package). |
| `npm run blender:qualify-production` | Requalifies the production host. Candidate evidence in `dist/blender/out/qualification/<run>/`; never an approval. |

## Normal publication

```bash
npm run publication:proof
npm run publication:verify-receipt -- dist/publication-proof/publication-proof-receipt.json
```

`publication:proof` (on the production render host, with `WALLETWALL_BLENDER` set to the pinned Blender):

1. validates the spec;
2. proves the ported rig invariants on the frames Blender renders (every 9th lesson frame, every lab frame), on the
   video and motion engine being published, against the bar in `src/blender/invariants-policy.ts`;
3. **stops unless the environment those frames were rendered in is an approved publication class**, printing what
   changed against the nearest approved class (below). On the proof class it says this is not a production host;
4. renders the whole video, runs the publish dry run against that render, and runs the public-output gate with the
   render required (which refuses any class that is not a publication class);
5. writes the receipt: stages the evidence, derives the receipt, and verifies those exact bytes against the whole
   package **before** anything is written. They then go to a temporary file, are read back, and are published under the
   receipt's name by a hard link (atomic, and never over an existing receipt). Finally the receipt is verified once more
   from disk. A receipt that does not verify is never written; a verification that throws leaves nothing behind.

The proof package is deleted at the start of every run, so a failed run never leaves a receipt behind. Human review
of the package remains mandatory before any publication. Nothing here uploads anything.

## When the production environment changes

```text
new driver (or Blender, runtime, OS update)
      ↓
npm run publication:proof            → refuses: the environment is not an approved publication class (with the diff)
      ↓
npm run blender:qualify-production   → QUALIFICATION_CANDIDATE_PASS (evidence only)
      ↓
human review of the candidate evidence
      ↓
a reviewed PR that approves the environment in config/blender-environments.json (and, if needed, a new reference)
      ↓
CI, review, merge
      ↓
npm run publication:proof            → PASS under the newly approved class, with a receipt
```

Never: *new driver → a script rewrites the approved environment → publication proceeds.* No command in this
repository writes `config/blender-environments.json` or the cross-class reference (`blender/proof/reference/`).

### What a publication class binds

A publication class (`config/blender-environments.json`, `walletwall.blender-environments/v2`) states the whole render
environment it approves:

| Field | Pinned as |
|---|---|
| OS | `match.os` |
| Blender version and build | `match.blender.version` and `match.blender.buildHash`: the build the class was qualified on, written as `config/blender.json` pins it |
| Render engine | `match.engine` |
| GPU backend | `match.gpu.backend`, as Blender names it (`OPENGL` today) |
| GPU vendor, renderer, driver | `match.gpu.vendor`, `match.gpu.renderer` (exact, never a prefix), `match.gpu.version` |

Only `gpu.deviceType` stays unpinned: Blender derives it from the vendor. The Blender version is compared without its
release type (`LTS`), because the build hash pins the build. The proof class pins the same Blender build and backend,
and the GPU by renderer prefix. Every pin is required. A class without one (the older v1 shape) is
refused, never read as a wildcard. A class's Blender pin must equal `config/blender.json`'s, or the class approves
nothing:

```text
publication class "production-rtx5080" was qualified with Blender build 5.2.2 (d13f752e3b9c), but the current pinned build is 5.2.3 (…)
```

A Blender build update is one reviewed change:

```text
config/blender.json bumped    → every class is incoherent: publication:proof, the gate, and the receipt refuse,
      ↓                         qualification is BLOCKED, and npm run render warns; each names both builds
each class's Blender pin updated in the same change, and a new reference exported on the production host
      ↓
npm run blender:qualify-production   → REVERIFIED against the new reference, or a candidate: never an approval
      ↓
human review, CI, merge → npm run publication:proof
```

A GPU backend change, for example OPENGL to VULKAN on the same GPU and driver, is like a new driver. The environment is
unapproved (`changed: gpu backend`), `publication:proof` stops with the diff, and qualification reaches
`QUALIFICATION_CANDIDATE_PASS` at best, never `QUALIFICATION_REVERIFIED`. Approving it is a reviewed edit of the class.

### What the refusal looks like

The environment is classified from the record Blender wrote (`render.py render_environment()`), and the refusal
names the change. Only fields of the closed environment schema appear:

```text
[publication:proof] this host's render environment is not an approved publication class (not approved; nearest approved class production-rtx5080 (publication); changed: driver 4.6.0 NVIDIA 616.56 -> 4.6.0 NVIDIA 620.10)
approved (production-rtx5080, publication):
  os: windows
  blender version: 5.2.2
  blender build: d13f752e3b9c
  engine: BLENDER_EEVEE
  gpu vendor: NVIDIA Corporation
  gpu: NVIDIA GeForce RTX 5080/PCIe/SSE2
  driver: 4.6.0 NVIDIA 616.56
  gpu backend: OPENGL
observed:
  os: windows
  blender version: 5.2.2
  blender build: d13f752e3b9c
  engine: BLENDER_EEVEE
  gpu vendor: NVIDIA Corporation
  gpu: NVIDIA GeForce RTX 5080/PCIe/SSE2
  driver: 4.6.0 NVIDIA 620.10
  gpu backend: OPENGL
  gpu device type: NVIDIA
changed:
  driver
```

The "approved" block lists what the class pins; the field it does not pin (the device type) appears only as observed.
The changed fields are listed in this fixed field order. A class that approves nothing whatever the host reports (its
Blender pin is not `config/blender.json`'s, or it lacks a required pin) adds a last block,
`the class approves nothing:`, saying why. `npm run render` prints the same diff when it renders outside an approved
class, and the public-output gate's `RENDER_ENVIRONMENT_UNAPPROVED` finding carries it in one line.

### Requalifying the host

```bash
npm run blender:qualify-production            # or -- --run=<short id>; the run id is the only option
```

On the production host, with the pinned Blender:

| Check | Rule |
|---|---|
| `blender-pinned` | The installed Blender is the build `config/blender.json` pins. Otherwise nothing renders and the record names the change (BLOCKED). |
| `class-blender-pins` | Every approved class pins that same Blender build. A class qualified on another build is a source/config coherence failure, named with both builds (BLOCKED). Only a reviewed change resolves it. |
| `reference-intact` | Every PNG of the committed reference is the bytes its `proof.json` records, and it was rendered in an approved publication class (BLOCKED otherwise). |
| `reference-fresh` | The reference was rendered from this checkout's Blender config, lane source, canonical model, and plan (BLOCKED otherwise: a stale reference cannot vouch for anything). |
| `environment` | The environment Blender reported, classified and diffed. A record outside the closed schema, a record of another Blender build than the pinned one, or the proof class is no production candidate (BLOCKED). |
| `character-pinned` | Two builds from code, both the pinned canonical model and materials (`BLENDER_CHARACTER`), one realization. |
| `same-class-repeat` | The ten-frame proof set rendered twice, in fresh processes: every PNG byte-identical, one environment. |
| `versus-reference` | Run A against the reference: the same proof frames and crops. Within the reference's own class, every frame must be byte-identical (guarantee A). That covers the same class id, and the same approved class with a field the class does not pin changed (the device type). Another class, or an unapproved environment such as another GPU backend, must hold the pinned cross-class tolerance, frame by frame (guarantee B). |
| `contacts-and-invariants` | The ported invariants (planted feet, paws on the lip, the tail on its supports, the envelope, protected text, title-safe, the palette) at the publication stride, in the same environment. They are judged against this checkout's thresholds and coverage minimums (`src/blender/invariants-policy.ts`), not the ones a report claims. |
| `pins-unchanged` | `config/blender-environments.json`, the reference, `config/blender.json`, and the character pins (`src/character/walletwallaby/versions.ts`) are byte-identical at the end to the start. |

Verdicts:

- **`QUALIFICATION_CANDIDATE_PASS`**: the environment is not approved, and every check passed. This is evidence for a
  human, never an approval. The record states whether the proof frames are byte-identical to the reference (then a
  reviewed PR may simply approve the environment) or only within tolerance (then making it *the* production class also
  needs a new reference, `npm run blender:proof -- export-reference --run=<run>-a`, reviewed in the same PR). It
  includes a proposed class entry as text for that review; the tool does not apply it.
- **`QUALIFICATION_REVERIFIED`**: the environment is already approved and still reproduces the reference. Nothing to
  approve.
- **`QUALIFICATION_FAIL`**: a check failed, stated with the measure and the unchanged pin (three significant digits),
  for example
  `transition-peak (frame 1760): changed fraction 0.570% > approved maximum 0.500% (crossClassTolerance.scene.maxFractionOverNoise)`.
- **`QUALIFICATION_BLOCKED`**: qualification could not mean anything: an unpinned Blender installed or recorded,
  classes whose Blender pin is not `config/blender.json`'s, a stale or damaged reference, an invalid environment record,
  or the proof class.

A **Blender update** is the one reviewed change [above](#what-a-publication-class-binds): `config/blender.json`
(version, build hash, archive SHA-256s), every class's Blender pin, and a new reference. Qualification never renders
with an unpinned Blender, and a different Blender build is never a candidate (BLOCKED).

## Requalification never lowers the bar

The tolerances in `config/blender-environments.json` are **inputs**. Qualification reads them once, before anything
runs, measures against them as written (`src/blender/equivalence.ts`, the same measure `blender:proof compare` uses),
reports them as read, and checks that the file and the reference are byte-identical at the end. A frame over a pin is a
FAIL that states both numbers. It never raises a tolerance, re-exports a reference, or widens a class to pass.

`test/render-qualification.test.ts` holds this in place:
- The decision runs on deep-frozen inputs.
- A write guard finds every filesystem write call in the qualification module and its CLI outside the one record
  writer. There are none. Its positive controls are a write to the approved classes, a copy into the reference, a
  rename, and an `rm`.
- A step guard holds the CLI to one spawn and to the steps in its table (build, proof render, invariants). Its positive
  controls are an `export-reference` step, a widened table, and a spawn outside `step()`.
- The invariants' bar is one module, so a loosened copy of the script cannot set it.

Any change to a tolerance, the reference, or an approved class is a separate, intentional source diff with its own
review.

## The render environment

`src/blender/environment.ts` treats Blender's environment record as a **closed schema**:

- **Fields.** `os`, `blenderVersion`, `blenderBuildHash`, `engine`, and `gpu` with exactly `backend`, `vendor`,
  `renderer`, `version`, `deviceType` (or exactly `{ unavailable }`). Own keys only: `__proto__` or `constructor` is an
  unknown field like any other.
- **Values.** Printable ASCII, at most 160 characters, with no local path and no secret-shaped value. The OS, the
  Blender version and build hash, and the engine must also be shaped as Blender reports them. The GPU fields are free
  text within those bounds.
- **Problems.** A problem names the field, never its value.

`config/blender-environments.json` is validated when it is read. Each class needs a plain unique name and a purpose.
Its match must pin the OS, the Blender build it was qualified on (`blender: { version, buildHash }`), the engine, and
the GPU by backend and by renderer or renderer prefix, with no other field. A publication class must also pin the GPU
vendor, the exact renderer, and the driver. A class that pinned nothing would approve anything, so a malformed
document is refused, never read leniently. That includes a v1 document, whose classes pin no Blender build or backend.
Classification fails closed on its own, too, even for a document that skipped validation. A missing required pin is
never a wildcard: either the field shows as changed or the class reports the problem, and the class approves nothing.
Each class is read once, as plain data. Own members only: a prototype name is an unknown field, and an inherited
member is missing.

A class approves an environment exactly when the diff against it has no changed field, and the class is well formed
and coherent: its Blender pin is the build `config/blender.json` pins. The decision and the explanation cannot
disagree. A record with an unknown field (a host name, a user, a path) is INVALID and never approved. The class id is
derived as before (the record and the render config, hashed), so recorded ids stay valid.

## The receipt

`walletwall.publication-proof-receipt/v2`, at `dist/publication-proof/publication-proof-receipt.json`:

```text
schema                      walletwall.publication-proof-receipt/v2
receiptSha256               the identity (below)
subject
  video                     videoId, revision, specHash, canonical docs source (path, URL, blob, content hash),
                            the MP4 (path, sha256, bytes), frames, durationMs, fps, width, height
  build                     the build identity (toolchain, hashed configs, rig and motion versions, the pinned
                            Blender and character) and its hash
  motion                    the motion engine identity and the MotionPlan (the whole lesson's bridge hash)
  character                 layout; the Blender identity (version, build hash, config, lane source, canonical model,
                            this host's realization, rig version, materials, bridge schema, plan, terrain, camera,
                            render settings); the sequence and each depth reveal (render content hash, bridge hash,
                            frame count, evidence file)
  renderEnvironment         class id, approved publication class, purpose, and the closed environment record
  remotion                  version and composition
  narration                 provider, estimated, audio, and for publication narration the verified set's identity,
                            provider, binding id, model, voice, identity, language, and its binding, synthesis
                            config, script, chunk plan, and audio hashes (v2; null for the fixture voice)
  captions                  WebVTT and SRT sha256
  invariants                the evidence file, the motion engine, the stride, the exact lesson frames, their bridge
                            hash, pass
  files                     every file of the proof package but the receipt: path, sha256, bytes
  gates                     validate, blender-invariants, render, publish-dry-run, public-output: each PASS with the
                            package files it is re-derived from
informational
  writtenAt                 wall-clock time, never part of the identity
```

**Identity:** `receiptSha256 = sha256(canonicalJson({ schema, subject }))`. `canonicalJson` (`src/core/canonical-json.ts`)
sorts keys and drops whitespace, so key order never changes the identity. It defines every member, `__proto__` included,
so no member can ride along outside the hash. `informational.writtenAt` is outside the hash. The subject holds no
timestamp, render timing, local path, host or user name, environment variable, or subprocess output. The leak policy
(`src/core/leak-scan.ts`) refuses them in the receipt, its evidence, and the bundled gate report.

**The proof package holds exactly:** the public-output gate's verified files (`<videoId>/…`), its report
(`public-output-check.json`), the evidence, and the receipt:

- `evidence/blender-invariants.json`: the ported invariants' report (`walletwall.blender-invariants/v2`), with the
  Blender identity, environment, and exact frames it was measured on;
- `evidence/blender/<sequence>.json`: Blender's render manifest for the character sequence and the depth reveal. Each
  shot carries exactly its name, frame, PNG hash, crop, and IK contact error, and no timings. The environment and each
  shot's name, frame, and hash hash to the `renderSha256` the render recorded. The shots must be exactly the frames and
  crops this checkout's plan decides (`src/blender/production.ts` characterShots: the sequence in its layout, the
  reveal's every frame).

### Verification

```bash
npm run publication:verify-receipt -- dist/publication-proof/publication-proof-receipt.json
npm run publication:verify-receipt -- path/to/publication-proof-receipt.json --receipt-only
```

Nothing a receipt says is trusted. The verifier:

- checks the **closed schema** (any unknown, missing, or mistyped field fails, by own keys, and `__proto__` anywhere)
  and the **identity**; it reads at most 1 MiB, through one handle, never a link;
- applies the **leak policy** to the receipt and its evidence;
- **re-derives from this checkout**:
  - the spec and docs identity, the timeline and resolution, and the build identity;
  - the motion engine, the MotionPlan, and the depth reveal;
  - the sequence's and the reveal's frame counts;
  - the pinned Blender identity: version, build, config, lane source, canonical model, materials, rig, camera and
    render settings, terrain;
  - the environment's class, from the record, so a forged label fails;
  - Remotion, the narration (the fixture voice: estimated, no audio; or the publication narration set in the
    receipt's own proof package, replayed and re-verified against this checkout's script and approved binding), and
    the captions;
  - the invariants' engine, frames, and plan;
  - the gate and file structure;
- with the package beside it (the default), **re-derives the whole subject from the package** and requires equality
  over both key sets. It:
  - re-runs the public-output gate on the package as bundled;
  - requires the bundled gate report to be exactly the report the gate gives now;
  - re-hashes every file, and refuses any file it does not bind (or a link);
  - re-derives Blender's evidence: by content the renders the render recorded, and exactly the frames and crops of this
    checkout's plan;
  - checks the invariants evidence: passed this checkout's bar, at the publication stride, on the render's own video,
    engine, and plan (every visible frame at the stride), with the pinned identity, the render's host realization,
    and the render's environment.

A gate's PASS is never a stored boolean: each is re-derived from the evidence it names, and the invariants are judged
against this checkout's bar, not the one their report claims. Verify on the checkout that made the receipt (or one with
the same build identity). Any other checkout derives different identities and says so. `--receipt-only` checks
everything that does not need the package's bytes (the MP4 included), and says that it did not check them.

## Security review

- **Can a malicious or stale render claim the production class?** A label cannot: the class is re-derived from the
  closed environment record, against every field the class pins (the Blender build and the GPU backend included) and
  `config/blender.json`'s pin. A stale render cannot: the
  spec, build identity, MotionPlan, character pins, and the invariants' plan are all re-derived. A fully fabricated
  environment record (a render made elsewhere, edited to read like the production host) cannot be told apart by
  inspecting files. There is no host signing key. It is detectable by audit: the receipt binds every Blender frame's
  hash, and the production class is byte-reproducible (guarantee A), so anyone on the production host can re-render any
  frame and compare. Qualification proves the host still reproduces the committed reference byte for byte.
- **Can someone edit the receipt after publication?** Any edit changes `receiptSha256`. A forger who recomputes it
  must still match everything the verifier re-derives from the checkout and the package. Proving that a receipt is the
  one that existed at publication needs its `receiptSha256` recorded somewhere append-only at publication time (the
  review PR or the publication notes).
- **Can a driver update silently become trusted?** No. The driver is a pinned field of `production-rtx5080`. A new one
  is unapproved: the gate refuses, and `publication:proof` stops before rendering, with the diff. Approval is a
  reviewed edit of `config/blender-environments.json`, which also changes the build identity, so earlier artifacts go
  stale.
- **Can a GPU backend or Blender change keep the old class approved?** No.
  - The backend and the Blender build are pinned fields of every class.
  - A bump of `config/blender.json` alone leaves every class incoherent: they approve nothing, neither the old build nor
    the new one.
  - A class edited alone cannot bless an unpinned Blender: the class and `config/blender.json` must agree, and
    qualification blocks an installed or recorded build that is not the pinned one.
  - A unit test fails on any committed disagreement between the two files.
- **Can qualification rewrite its own threshold?** No. The tolerances are read-only inputs. There is no write path
  outside the record writer, and the CLI runs only its listed steps (both guarded, with positive controls). The pins
  (classes and tolerances, reference, Blender config, character pins) are hashed before and after. The invariants'
  thresholds and coverage live in one module that the receipt also checks.
- **Can a stale reference frame be accepted?** No. Qualification checks every reference PNG against `proof.json`, and
  the reference's config, lane source, model, and plan against this checkout. `blender:proof compare` now verifies
  every PNG against its record before comparing. `blender:proof export-reference` re-derives the run's class from its
  own record with this checkout's classes and Blender pin: a label, even one recorded before a class changed, never
  makes a run the reference.
- **Can a proof from another MotionPlan be attached?** No:
  - the plan and the reveal are re-derived;
  - Blender's manifests must hash to the `renderSha256` the render recorded, and must hold exactly the frames and crops
    of this checkout's plan;
  - the invariants must have been measured on the render's own video and motion engine (`publication:proof` passes
    both), at every visible frame of that plan at the publication stride.
- **Can evidence from another machine be relabeled?** One environment must hold across the sequence, the reveal,
  Blender's manifests, and the invariants. A single relabelled part fails; replacing all of them consistently is the
  fabrication above.
- **Can a local user name or path leak through environment diagnostics?** No. The record is a closed schema with
  bounded, path-free, secret-free values. Problems print field names only. The gate scans render records, and the
  receipt verifier scans the receipt and evidence, for this machine's directories, host name, and user name.
- **Can a failed proof leave a valid-looking receipt?** No. The package is deleted at the start. The receipt is written
  last, only after every step passed, and only once its exact bytes have verified against the whole package. A
  verification that fails or throws writes nothing. The bytes go through a temporary file, read back and compared, and
  are published by a hard link (never over a receipt). The CLI then verifies once more from disk and reports truthfully
  whether any receipt remains. A stray temporary file, or any unbound file, fails verification.
- **Can a caller inject Blender arguments through qualification?** No. The only option is `--run=<short lowercase
  id>`; anything else exits 2. Blender runs only through `src/blender/toolchain.ts` with fixed arguments.
- **Can qualification make network calls?** Its code makes none, and Blender runs `--offline-mode` in a minimal
  environment. Remotion draws the reveal's two characterless layer stills with its pinned headless browser. Remotion
  downloads that browser only if it is missing (run `npx remotion browser ensure` beforehand to rule it out).
- **Can timestamps or host metadata contaminate identity?** No. The build identity hashes toolchain versions and
  committed configs only. The receipt identity excludes `writtenAt`. Blender's per-frame timings are stripped from the
  evidence and never enter `renderSha256`.

## Known limits

- **No hardware-rooted attestation.** A deliberate insider can fabricate a consistent package. The defenses are human
  review, re-render audit, and recording the receipt identity at publication.
- **`gpu.deviceType` is not pinned.** Blender derives it from the vendor, which the class pins. A device-type change
  under the same class is caught by qualification (the reference's own class must reproduce it byte for byte), not by
  `publication:proof`.
- **The proof class's backend comes from the recorded Linux proof run.** That was WSL with Mesa llvmpipe, approved as
  `proof-linux-software-gl`. The hosted runner reports its own record each time the required Render determinism job
  renders. If a runner ever reported another backend, that job's gate would refuse it as unapproved, which is fail
  closed. Approving it would be a reviewed class change.
- **A Blender update cannot be compared with the old reference.** The reference records the Blender config it was
  rendered with, so on a new pin it is stale (qualification BLOCKED). The update therefore ships with a new reference,
  and the visual difference between builds is reviewed in that change.
- **A reused render from an earlier environment fails late.** Blender frames rendered earlier (verified and reused by
  `npm run render`) may come from another approved environment than the one the invariants just ran in. The receipt
  requires one environment, so such a proof stops at its last step, after the encode. Delete
  `dist/blender/out/renders` (or render with `--fresh-blender`) and run the proof again.
- **MP4 bytes are not run-to-run stable.** A receipt identifies one artifact; determinism is proven on lossless frames.
- **The invariants evidence proves which frames, plan, character, environment, and bar were measured.** Only a
  re-render can re-measure the values.
- **Narration:** the fixture voice, or a verified publication narration set (`--narration=publication`,
  [NARRATION.md](NARRATION.md), "Publication narration"). The set proves which binding it claims and every byte; it
  cannot prove the audio came from ElevenLabs (a hosted model signs nothing).
- **Proven on the production host for the default motion engine.** A `--motion-engine=rust-wasm` proof (invariants on
  the Rust plan) is covered by tests, not yet by a production run.
