# WalletWallaby in Blender

> Rust decides. Blender performs. Remotion tells the story.

WalletWallaby is drawn by Blender, from Motion Intelligence's decisions: production renders draw him as small lossless
crops that Remotion places in the frame, and the depth reveal is Blender's one full-scene shot (Production, below). The
Rive rig that drew rigs v3 to v5 was retired in rig v6, after every invariant it proved was proven on the frames Blender
renders (Ported invariants, below; [MOTION_ARCHITECTURE.md](MOTION_ARCHITECTURE.md) has the rig contract).

## Ownership

```text
Docs / VideoSpec ─────────── WHAT and WHERE (the lesson; no renderer, camera, or code fields)
      ↓ choreography
Motion Intelligence ──────── HOW, WHEN, and support legality (TypeScript solver; Rust/WASM on its paths)
      ↓ MotionPlan → sampled per frame
walletwall.blender-motion/v1  (src/character/walletwallaby/blender/bridge.ts)
      ↓
Blender ──────────────────── body, rig mapping, IK solve, geometry, materials, light, camera
      ↓ lossless RGBA PNG per frame (+ identity.json)
Remotion ─────────────────── docs UI, typography, captions, audio, timing, editorial cuts, encoding
```

Blender never chooses a destination, a contact, a time, or a support. It has no input through which it could.

## Toolchain

`config/blender.json` pins the build: **Blender 5.2.2 LTS, build hash `d13f752e3b9c`**, the official Blender
Foundation release, with the SHA-256 of each platform archive from the release's published checksum list. The
orchestrator (`src/blender/toolchain.ts`) finds the executable (`WALLETWALL_BLENDER`, else `blender` on `PATH`),
runs `--version`, and refuses anything but exactly that version and hash. Blender binaries are never in git.

Install (Windows, user level, no admin): download `blender-5.2.2-windows-x64.zip` from download.blender.org or an
official mirror, check its SHA-256 against `config/blender.json`, unzip anywhere, and set `WALLETWALL_BLENDER` to
`blender.exe`. Linux: the same with `blender-5.2.2-linux-x64.tar.xz`.

Every run uses the fixed arguments `--background --factory-startup --disable-autoexec --offline-mode
--python-exit-code 1`, one of the lane's own entry scripts, and one job file (see Security).

| Command | What it does |
|---|---|
| `npm run blender:build` | Builds the character from code: `dist/blender/out/character/walletwallaby.blend` + `model.json` |
| `npm run blender:render -- --frames=a..b [--name=id] [--full-frame]` | Renders lesson frames from the bridge (crops; whole frames with `--full-frame`) |
| `npm run blender:review` | The seven-pose sheet and close-ups, from the motion system's own review states |
| `npm run blender:contact -- --frames=a,b` | Perspective contact views on the declared terrain |
| `npm run blender:determinism -- --frames=a,b,c` | Two builds, two fresh render processes, one shuffled order; compared |
| `npm run blender:invariants` | The ported rig invariants on the frames Blender renders (Ported invariants) |
| `npm run blender:proof -- render\|compare …` | The ten-frame proof set: same-class bytes, cross-class tolerance (Determinism) |
| `npm run publication:proof` | The whole-video publication proof, on the production render host (Production) |
| `node scripts/review/blender-transition.ts --context=<seq>` | The 2D → 3D signature transition at the tiers → signals seam |

## The coordinate contract (2.5D)

```text
frame px (x right, y down; 1920 x 1080)  →  Blender units (X right, Y depth away from the camera, Z up)
    X = (x − 960) · 0.01        Z = (540 − y) · 0.01        Y = scene depth (0 = the teaching plane)

rig px (feet at the origin, x forward, y down)  →  the armature's space at scale 1
    X = rx · 0.01               Z = −ry · 0.01              Y = the body's own depth (near side −Y)

armature object = Translate(frame position, depth) · RotateZ(−yaw · facing) · Scale(facing · s, s, s)
```

The teaching camera is orthographic and looks along +Y, 19.2 units (1920 px) wide, so a frame pixel lands on the
pixel Remotion draws. The rig's 2D rotations (positive = clockwise on screen) are rotations about world +Y: every
bone is rolled so its local Z is world +Y, and a frame's pose is the rig's local rotation less its rest value about
that axis. `facing` mirrors in X, so the near limbs stay on the camera side either way. `yaw` turns the body about
the feet (no contact moves): toward the viewer while it holds and teaches (38°), toward profile while it travels
(18°), as a fixed blend of the frame's own key-pose weights (`config/blender.json` `presentation`), which Motion
Intelligence already blends smoothly in time. Depth views (contact, transition) use perspective cameras built on
the same plane.

## The bridge: walletwall.blender-motion/v1

`lessonBridge()` samples the lesson exactly as the composition does (`sampleWithEngine`, so the Rust engine's paths
are its frames) and, per frame, records:

- **place**: the feet in frame px, scale, facing; visibility and opacity.
- **semantic** (audit only; the pose already performs it): action, phase, contact, `offStage`, the declared support
  **surface id** under the feet, the support span, platform dip, landing impulse, velocity, pitch, stretch, tail
  intent (swing, curl, tension, lag), and the focus point.
- **pose** (`pose-resolve.ts`): the clip blend weights; every bone's local rotation before IK (the rig contract's
  clip blend and continuous controls, `finalizePose`); the hip; the IK targets (heels,
  toes, paws, tail tip) and each IK group's strength; the face controls.

`validateBridge()` refuses anything that is not exactly v1: unknown fields at any level,
frames that are not strictly ascending frames of the range (a subset is allowed: stills, the proof set, some frames of a
reveal), non-finite or out-of-range values, unknown clips, weights that do not sum to 1, a target across the frame, a path-like
segment id, and **a grounded on-stage frame with no declared supporting top under it**. A test bridges all 5,319
frames of the committed lesson: every grounded frame stands on a declared `SUPPORTED_SURFACE`/`LEDGE`/`NARROW_LEDGE`
top, except the few whose feet are outside the frame, which the contact audit also treats as off stage.

Until the cutover, a test ran the pinned Rive runtime on ~230 lesson frames and proved the bridge's resolved pose was
the Rive player's own pose before IK (every bone, the hip, every IK target); the content hash of those resolved poses,
captured in the same run, is now pinned, with a positive control that a 0.01° change is caught.

## The character (blender/walletwallaby/)

Authored as code; the `.blend` is a generated artifact. The art reference is the reviewed v5 visual-language pass:
WalletWallrus's mascot language extruded into a living wallaby.

- **One mass.** The torso (rump, a full belly, chest, a short thick neck), the head (a rounded crown, a deep muzzle
  to a blunt nose, full cheeks), and the long tail are signed-distance volumes joined by smooth unions, meshed once
  at rest by surface nets on a 1.25 px grid, projected onto the exact surface, relaxed, and skinned to the rig
  contract's 22 bones by a softmax over the volumes. The hind legs (haunch, shin, long foot) and forelimbs are their
  own skinned meshes, set into the body, so their outlines draw the haunch line and the forelimbs read in front of
  the flank, as on the 2D rig.
- **The brick belly.** The WalletWall wall built into the stomach: courses of bricks in the coat's own colour, laid
  level in running bond around the belly's round front (cylindrical coordinates), marked out only by charcoal
  mortar set into shallow grooves (bump). Centred on the front; its ends alternate a three-quarter bat and a whole
  joint (a toothed edge, never a border), about ±61–71° either side of the front; the lowest course has no bed
  joint and fades under the belly. Never armour, never a vest.
- **The tail.** The rig's 182 px tail, thick at the root (a muscle mass where it meets the rump) and tapering to a
  point, with the cream underside band growing from a sliver. It rests on the support through Blender's IK.
- **Colour.** Emblematic flat colour: the light a point receives only chooses between two exact tones, the lit
  colour and the rig's own shade (20% toward charcoal, derived, never typed). Coat = WalletWallrus's `#BA6F38`;
  cream and charcoal from the brand contract, resolved in TypeScript and handed to Blender as data. No gloss, no
  fur, no highlights.
- **Outline.** An inverted hull (charcoal, 3.6 px at scale 1, thinner where a limb lies over the body).
- **Face.** Large charcoal eyes with a cream glint, coat lids that close by rotating over the eye, brows, a charcoal
  nose, a cream muzzle and chin, cupped ears with cream inner faces.

## Blender's IK, Motion Intelligence's targets

Two-bone IK constraints on the legs (heel targets), forelimbs (paw targets), and tail tip, damped-track feet aimed at
their toe targets; pole targets ride each chain's parent on the side the rig contract bends to (knees forward, elbows
down, tail arched), each pole angle calibrated at build time to reproduce the rest pose (≤ 0.21 px). The legacy
solver re-solves from the posed chain on every evaluation (no state between frames). Targets and strengths come only
from the bridge. Every render measures, on Blender's own solved bones, the distance from each fully weighted contact
target to where the chain reaches: **0.0002 px** worst over the parity section (pointing aims at a target it need not
reach and is not a contact).

## Terrain, materialised

`terrain-export.ts` groups the declared surfaces (`src/layout/terrain.ts`) back into blocks under the same ids the
judge and the bridge use: a stand Motion Intelligence found valid on `node:value-at-risk:top` lands on the
`node:value-at-risk` block whose top is that surface. Routes are exported only as thin non-contact lines. Nothing is
inferred from pixels.

## Remotion integration

For normal teaching scenes Blender draws **the character only**. Each frame, WalletWallaby is rendered into a small
transparent canvas (`src/character/walletwallaby/blender/crop.ts`) whose bounds are decided before Blender runs, from
the frame's placement alone: the rig contract's envelope at the feet position, mirrored by facing and scaled, padded
by a fixed 40 rig px (`config/blender.json` `render.crop`), as integer frame pixels clamped to the frame. Blender's
camera stays exactly where the full-frame teaching camera is and lens shift frames the crop, so one crop pixel is the
frame pixel it covers. There is no "grow until it fits": a frame whose ink touches a crop edge that lies inside the
frame fails the render (an edge on the frame's own border is exempt: there he simply leaves the frame). Each sequence
records `crops.json`: `{ frame, x, y, width, height, scale, pngSha256 }`.

`characterRenderer` (a staged, verified crop sequence) makes `DocsVideo` draw `WallabyBlender` (one `<Img>` per frame,
placed at the crop's `x, y`, opacity applied by Remotion, fail closed on a missing visible frame; a frame that shows
him with no staged frames at all also fails closed); `depthReveals` replaces the flat transition for exactly their frames, and only there does Blender
render a whole scene. `src/blender/stage.ts` stages a sequence only if every PNG matches Blender's own manifest and has
exactly its crop's dimensions, every crop equals the one re-derived from the current bridge, the bridge is
byte-for-byte the one the current MotionPlan gives, and the identity matches the current toolchain, config, lane
source, and canonical model. Cards, text, diagrams, captions, UI, audio, timing, and encoding stay in Remotion.

## Production

`npm run render` and `npm run render:stills` draw WalletWallaby with the pinned Blender (`WALLETWALL_BLENDER` names the
executable; `src/blender/production.ts`):

1. **The character**: built from code (`build.py`) and refused unless its canonical model and materials are exactly
   the ones `src/character/walletwallaby/versions.ts` pins (`BLENDER_CHARACTER`). A cached build is reused only while
   the config, lane source, and rig it was built from are today's.
2. **The frames**: the crop layout by default; `--character-layout=full-frame` renders whole frames instead (the
   approved reference and the fallback). A full render covers every frame of the lesson; stills cover exactly their
   frames (the bridge then holds that subset, compared frame by frame with the current plan). A sequence on disk is
   reused only if its bridge is today's and staging verifies all of it; `--fresh-blender` never reuses (determinism
   runs).
3. **The depth reveal** at the lesson's PUSH_THROUGH → DEPTH_ENTER seam, from Remotion's two characterless surfaces,
   verified like a character sequence (identity, plan, environment). Its subset for stills uses the whole reveal's
   terrain and depth, so its frames are exactly the full reveal's.

Every render clears the bundle's Blender staging area first (the bundle copies the whole public dir, so frames left
from other renders would ride along), stages its own frames, and bundles again. `render.json` (`walletwall.render-info/v5`)
and `stills.json` (`walletwall.stills-info/v3`) record the character: the layout, the sequence and reveal (frame
counts, content hashes of what Blender recorded, never its timings), their bridge hashes, the Blender identity (without
the `.blend` cache's bytes), and the render environment and its class. `npm run public:check` re-derives all of it from
the repository alone and refuses a render to publish from any class that is not a publication class.

**Publication** runs on the production render host: `npm run publication:proof` validates the spec, proves the ported
invariants, renders the whole video, runs the publish dry run against that exact render, and runs the gate with the
render required, writing the proof package to `dist/publication-proof/` for human review. Nothing uploads it.

In Remotion Studio, a frame that shows WalletWallaby without staged Blender frames stops with an error rather than
rendering without him; preview such frames with `npm run render:stills -- --frames=…`.

## Ported invariants

What the Rive runtime proved on its own transforms before the cutover is proved on the frames Blender renders:
`npm run blender:invariants` (`scripts/blender-invariants.ts`) renders every 9th lesson frame and every frame of the
motion lab (the ledge it climbs and the narrow perch whose edge the tail passes) in the crop layout, with each bone's
projected position recorded by `render.py` on request, and checks:

| Invariant | Rule | Measured 2026-10-18 (RTX) |
|---|---|---|
| Finite poses | every bone finite | 786 / 786 frames |
| Planted feet, knees forward | IK within 0.05 px of every toe and heel target on grounded frames | 691 grounded frames; worst 0.0046 px |
| The tail rests where there is a surface | full strength within 0.05 px, a blend within 2 px of the surface; released on fewer than 10% of supported holds | 312 supported holds: 310 resting, 2 released |
| The tail hangs past an edge | released, never solved onto a target past the edge | 48 lab perch frames |
| The paws hold the lip | the paw target is the lip; the paw within 3 rig px of it | 3 hang frames, within 2.5 px |
| The tail never folds | no joint bends 70° or more | all frames |
| Inside the envelope | the drawn pixels inside `RIG_ENVELOPE` at the placement, unpadded | all frames (closest: 1.8 rig px) |
| Holds off protected text, inside title-safe | the drawn pixels vs the layout's text, the eyebrow, and title-safe | 405 scene holds |
| Brand colours on pixels | every opaque pixel a mix of palette colours in linear light (at most 0.01% not); at least 30% exactly one | 0 of 11,084,922 off; 72.2% exact (worst frame 44.6%) |
| Shuffled-frame purity | frames rendered in a shuffled order equal the in-order frames, byte for byte | 12 / 12 |

Coverage minimums are Rive's (400 grounded frames, 300 supported holds, 300 scene holds at every 9th frame), scaled to
the stride. The motion lab's two MANTLE/PULL frames the support judge refuses to bridge are excluded and listed. Not
ported, because they describe the 2D shapes Rive drew: the belly polygon inside the torso polygon, the underlay draw
order, and per-shape area retention; the Blender body is pinned instead and passed the owner's visual gate. The pose
the Rive runtime evaluated is pinned too: `test/blender-lane.test.ts` holds the content hash of the resolved pose on
every 23rd lesson frame and of the rig document, captured while the runtime parity test still passed.

## The 2D → 3D signature transition (depth reveal)

`blender/walletwallaby/transition.py`: the outgoing and incoming teaching surfaces, as Remotion drew them
(characterless, lossless), are projected onto the declared blocks' front faces and a paper sheet behind them, so the
flat view is exactly the flat frame. One closed-form camera move: a dolly-zoom in (the frame keeps its size) with a
small rise, so the blocks stand out with real depth while WalletWallaby's push into depth (the plan's falling scale)
becomes real depth at true size; the outgoing surface dissolves; the camera travels to the incoming surface laid out
700 px deeper and settles orthographic on exactly the frame Remotion draws next. No glow, portal, particles, or
shake. Blender draws no copy of its own. Constants: `config/blender.json` `transitions.depthReveal`.

## Provenance

Every sequence carries `identity.json` (`src/blender/identity.ts`), passed into the composition's props:
`blenderVersion`, `blenderBuildHash`, `blenderConfigSha256`, `blenderSceneSourceSha256` (the lane's source files),
`blendArtifactSha256`, `walletwallabyModelVersion`, `walletwallabyModelSha256`, `walletwallabyRealizationSha256`,
`walletwallabyRigVersion`, `materialsVersion` / `materialsSha256`, `motionBridgeSchema`, `motionPlanSha256`,
`terrainSha256`, `cameraDefinitionSha256`, `renderSettingsSha256`; and Blender's own render manifest records the
**render environment** it actually ran in (OS family, Blender version and build hash, engine, and the GPU or software
renderer with its driver or Mesa identity, as Blender's GPU module reports it). No path, user, or host name.

**Canonical model identity vs host realization.** `walletwallabyModelSha256` hashes the model as canonical content:
vertex positions quantized to 1/256 px and ordered by position (not by generation order), faces rotated to their
lowest vertex (winding kept) and sorted, weights (1/4096), attributes (1/256) and UVs (1/65536) quantized in that
order, bones (1e-6 units) and pole angles (0.001°) quantized, and the materials (node graphs, quantized inputs, the
mortar map's pixels). Every quantum is far coarser than the last-bit float noise that separates hosts (different libm
and numpy builds) and far finer than anything a render shows. **Measured: Windows and Linux builds of the same source
give the same canonical model (`f8124e59dab3…`) and materials (`852617c0edcd…`) hashes**, while their exact float
realizations differ (`ac81bb8e…` vs `30b5446b…`); `walletwallabyRealizationSha256` records the host's realization and
is compared only within a host. The `.blend` file is a cache: its bytes differ per build (Blender writes memory
addresses) and are recorded, never compared.

## Determinism

Two guarantees, over lossless frames only (MP4 bytes are not run-to-run stable and prove nothing):

- **A. Same approved render-environment class: byte-identical frames.**
- **B. Different approved classes: bounded pixel equivalence**, at the tolerance pinned in
  `config/blender-environments.json` (kept apart from `config/blender.json`, so approving a class never changes the
  render config hash a class is defined by).

A render's environment class is the hash of the environment Blender reported plus the render config hash. Two
classes are approved today: `production-rtx5080` (Windows, NVIDIA GeForce RTX 5080, driver 616.56; purpose:
publication) and `proof-linux-software-gl` (Linux, Mesa llvmpipe; purpose: proof). A driver update is a new class
until it is approved. Every pinned tolerance is the worst measured value times a stated margin, and none lets a drawn
pixel appear or vanish:

| Tolerance (channels beyond ±2 / mean \|Δ\| / coverage) | Measured worst | Pinned |
|---|---|---|
| Cross-class, character crops | 1.39e-5 / 4.3e-4 / 0 | 1e-4 / 2e-3 / 0 |
| Cross-class, full-scene frames (the reveal) | 1.54e-3 / 2.75e-2 / 0 | 5e-3 / 0.08 / 0 |
| Crop composite vs full-frame composite (whole lesson) | 1.99e-5 / 1.80e-4 / 0 | 1e-4 / 1e-3 / 0 |

**The proof set** (`src/blender/proof-set.ts`) is ten lesson frames chosen by fixed rules from the lesson's own bridge:
idle (39), crouch (196), airborne (20), landing (30), perch (2721), inspect (64), tail brace (2341; a hard landing,
impulse 0.95), and the reveal's entry (1719), peak depth (1760), and exit (1814). `npm run blender:proof` renders it,
records the environment and class, and compares two runs: same class, every PNG byte-identical; approved classes, the
pinned tolerance. The production class's run is kept as the cross-class reference (`blender/proof/reference/`, 10
lossless PNGs, 900 KB).

Measured 2026-10-18:

| Test | Result |
|---|---|
| A, production class: proof set, two fresh runs (RTX) | 10 / 10 byte-identical |
| A, proof class: proof set, two fresh runs (WSL Ubuntu 26.04, Mesa 26.0.3 llvmpipe, CPU only) | 10 / 10 byte-identical |
| B, RTX vs software GL, same canonical model and plan | pass: character crops ≤ 9 levels on ≤ 0.0014% of channels; reveal frames ≤ 10 levels on ≤ 0.15% |
| Canonical model hash, Windows build vs Linux build | identical (`f8124e59dab3…`) |
| Two builds on one host, rendered in fresh processes; shuffled render order | 10 / 10 byte-identical each |
| Crops vs the approved full-frame output, final 1920x1080 composites, all 205 frames of 1806–2010 | pass: ≤ 11 levels on ≤ 0.0013% of channels, 0 pixels appearing or vanishing, 0 of the reference's ink outside a crop |
| The same, whole lesson: every 10th frame (519) plus the five frames whose character layers differ most | pass: ≤ 14 levels on ≤ 0.0020% of channels, mean \|Δ\| ≤ 1.8e-4, 0 pixels appearing or vanishing, 4 of 519 identical; worst five: 34, 692, 725, 794, 854 all pass (≤ 13 levels on ≤ 0.0016% of channels) |
| Character layers alone, whole lesson, every visible frame (5,185 crops) | 0 of the reference's ink outside a crop; 21 frames identical; at most 167 channels per frame beyond ±2 (on near-transparent edge pixels, where a straight-alpha colour delta vanishes once composited) |
| The full-frame reference re-rendered today vs the approved full-frame output | 205 / 205 (section) and 5,201 / 5,201 (whole lesson) byte-identical |
| MotionPlan and contact, crop vs full-frame layout, whole lesson | bridge byte-identical to the approved one (`042a14d9bf16…`); IK contact error identical on every frame (5,185 / 5,185; worst 0.0217 px, frame 1212, in all three renders) |
| The default render (no Blender props) on this branch vs main `ddf27b3`, 30 review stills | 30 / 30 byte-identical |

Crops are not pixel-identical to full-frame renders (0 of 205 frames): a crop camera's projection is not bit-for-bit
the full frame's, so a few pixels on silhouette and toon-band edges land in the other tone. Moving the camera,
snapping crop origins to 64 px, and anchoring crops at the frame origin were each tried and change nothing, so the
crop layout is held to the pinned crop-equivalence tolerance instead. Every channel is written from the frame alone,
the legacy IK solver keeps no state, dither is off, and nothing is random. MotionPlan, support decisions, authored
destinations, and contact timing are unchanged by any of this: the crop and reference sequences were rendered from
the same plan (`1590e023ee02…` for the section, `042a14d9bf16…` for the whole lesson), and the IK contact error is
the same on every frame.

## Performance

Three costs, measured separately (2026-10-18). Production is the publication class (NVIDIA GeForce RTX 5080, 16 GB,
Windows 11, EEVEE, 1920 x 1080, 32 samples); CI is the proof class (Mesa llvmpipe, CPU only), which pays only for
the ten-frame proof set. The two are separate budgets: the crop layout is chosen for the production renderer, and
nothing is tuned for software GL.

**A. Blender process and build**

| Measurement | Production class | Proof class (WSL, 16 threads) |
|---|---|---|
| Build the character from code (SDF → mesh → rig → materials → .blend), once per lane-source change | 31–35 s | 39.4 s |
| Start a render process (load the .blend, bind the rig) before its first shot | 2.7–3.6 s per invocation (Node plans the lesson, derives the bridge and crops, writes the job; Blender starts and loads the .blend) | |
| First frame in a fresh process (shader compile) | 976 ms (crop); 1184 ms (full frame) | 7.7–8.0 s |

**B. Per-frame character render** (posing, the IK contact check, and a level-15 PNG included)

| Measurement | Crop (production layout) | Full frame (the approved layout) |
|---|---|---|
| Pixels Blender draws per frame | mean 5.8% of the frame, at most 9.9% | 100% |
| Warm frame, median / p95 (whole lesson) | 195 / 244 ms | 230 / 256 ms (approved run); 263 / 294 ms (today's re-render) |
| 30 frames (1850–1879), in Blender / end to end | 7.3 / 6.9 s in Blender (warm median 204 / 199 ms); 10.9 / 9.7 s end to end | 9.3 / 9.5 s in Blender (warm median 283 / 283 ms); 12.0 / 12.3 s end to end |
| Whole lesson (0–5318) | 5,185 frames in 17.2 min | 5,201 frames in 20.2 min (approved run); 23.0 min (today's re-render) |
| Lossless output for the lesson | 158 MB | 339 MB |
| Proof class, per frame | 9.9 s median (character crops); 10.9–12.3 s (reveal frames) | |

The whole lesson has 16 more visible frames than crops: there WalletWallaby is entirely outside the frame, so no crop
exists and Remotion draws nothing (`offFrame`), as the full-frame render's fully transparent PNGs showed. Crops cut
the pixels by 94% but the frame time by only 15–30%: on the RTX the cost is mostly per-frame work that does not
scale with pixels (evaluating the posed rig and its IK, EEVEE's shadow and sample passes over the same geometry, the
PNG write). On software GL a crop saves nothing measurable: there cost scales with geometry times samples.
GPU memory while rendering: 1619 MiB above the desktop's own 4242 MiB (peak 5861 of 16,303 MiB).

**C. Remotion composite** (whole lesson, 5,319 frames, the reveal in place; staging and bundling included)

| Measurement | Crop layout | Full-frame layout |
|---|---|---|
| Final composite, shared host (a game and other sessions running), back to back | 719 s (an earlier run: 699 s) | 932 s |
| Final composite, quiet host | not yet measured | 257 s |

Remotion's cost is not higher with crops: under the same (heavy, uneven) load the crop layout was faster, and it
reads half the bytes. The clean quiet-host crop figure is still to be measured. On a quiet host the publication cost
is roughly 0.5 min to build, 17 min of crop renders, and a few minutes of composite.

## Security

Blender is a native program with its own Python: a new execution boundary.

- Only `src/blender/toolchain.ts` starts it, with the fixed arguments above (factory settings: no user add-ons or
  preferences; auto-run of scripts in `.blend` files disabled; offline), `shell: false`, a minimal environment (no
  tokens, credentials, or profile), and one of the lane's own entries (`build.py`, `render.py`), never a path from
  content.
- The only input is a job file the orchestrator wrote inside `dist/blender/jobs/`, read through one bounded handle;
  it holds data only. Outputs are confined to `dist/blender/out/` (plain relative POSIX paths, no parent or hidden
  segments, re-checked after resolution). Transition layers are PNGs staged inside the job directory.
- The VideoSpec gains no field: no Python, no paths, no camera, no style. The bridge's ids are validated.
- A test refuses lane Python that imports `subprocess`, `socket`, `urllib`, `http`, `ctypes`, or `shutil`, reads the
  environment, calls `eval`/`exec`, or enables scripts in a loaded file; every lane file is hashed into the identity.
- Public provenance records versions and hashes only.

## CI

Every PR: `npm test` includes `test/blender-lane.test.ts`, with no Blender needed: the resolved pose and rig document
pinned as the Rive runtime proved them, the full-lesson support check, the closed v1 schema, crop bounds (integer, in frame, holding the envelope,
recomputed identically), the proof set's selection rules, environment-class matching and tolerance pins, the pinned
toolchain and its confinement, the pinned character, the palette check's controls, and the Python rules.

Every PR: the required `Render determinism` check installs the pinned Blender and renders the review stills twice on
one runner (proof class, CPU software GL): render A builds the character, render B renders every Blender frame again,
and every PNG and `stills.json` must be byte-identical; the public-output gate then checks the stills' character
identity, plan, and environment class ([CI.md](CI.md)).

`.github/workflows/blender-proof.yml` (manual) installs the pinned Linux build (SHA-256 verified) on a hosted runner,
builds the character and checks its canonical model hash against the reference's, renders the proof set twice (A:
byte-identical) and compares it with the production reference (B: pinned tolerance), and proves the ported invariants
on a sample (every 270th lesson frame, every 6th lab frame); read-only and credential-free.
It has not run on GitHub yet: the same steps ran locally under WSL with CPU-only Mesa llvmpipe. At about 10 s per
proof frame on 16 cores, a 4-core runner should need roughly 15–25 minutes. The full-lesson render stays on the
production render host as an explicit proof and publication step: on software GL it would take hours.

## Known weaknesses and open decisions

- **The visual gate was passed by the owner (2026-10-18).** At lesson scale (0.5–0.78) the retired 2D rig read as the
  crisper emblem (a longer tail in silhouette, bolder limbs); the presentation turn below is the lever for that.
- **The presentation turn** (38° teaching, 18° travelling) trades the profile's long tail for a readable belly and
  face; it is one config block.
- **The contact shadow** is a soft camera-facing ellipse at the feet while grounded, as on the 2D rig: in the flat
  orthographic view a top surface is edge-on, so a cast shadow cannot show there. The depth views have real geometry.
- **The depth reveal's surfaces are still images** of the hand-off frames: anything the outgoing scene animates during
  the push is held, the provenance chip travels with the sheet, and projected text softens slightly while the camera
  moves (filtered sampling, to avoid shimmer). Its seams match the flat frames on average; edges differ by up to a
  pixel through the render's antialiasing filter.
- **Lane source is hashed, not versioned by review discipline alone**: any change under `blender/walletwallaby/`
  changes `blenderSceneSourceSha256`, and staging refuses older frames.
- **Byte identity is per render-environment class, by design**: Windows NVIDIA EEVEE and Linux software-GL EEVEE agree
  within the pinned tolerance, never byte for byte. Public renders come from the publication class.
- **Not proven**: the proof workflow on a GitHub-hosted runner (proven only under WSL), other GPUs and drivers, and
  Blender's IK under a pole that crosses
  the chain (the calibrated poles reproduce rest within 0.21 px; the contact error gate measures every frame).
- **Publication needs the production render host**: hosted CI renders stills and the proof set in software GL, never
  the whole lesson.
