# WalletWallaby in Blender

> Rust decides. Blender performs. Remotion tells the story.

This lane renders WalletWallaby's body with Blender instead of Rive, from the same decisions. It is the
**review lane** for replacing Rive as the long-term character presentation engine: until the owner's visual
review passes, the production renderer is still the Rive rig ([MOTION_ARCHITECTURE.md](MOTION_ARCHITECTURE.md)),
and every render without `characterRenderer` is byte-for-byte what it was.

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
| `npm run blender:render -- --frames=a..b [--name=id]` | Renders lesson frames from the bridge (teaching camera) |
| `npm run blender:review` | The seven-pose sheet and close-ups, from the motion system's own review states |
| `npm run blender:contact -- --frames=a,b` | Perspective contact views on the declared terrain |
| `npm run blender:determinism -- --frames=a,b,c` | Two builds, two fresh render processes, one shuffled order; compared |
| `node scripts/review/blender-parity.ts <seq> --frames=… --clip=a..b` | Same composition, Rive vs Blender stills and clips |
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
- **pose** (`pose-resolve.ts`): the clip blend weights; every bone's local rotation before IK (the Rive player's
  own clip blend and continuous controls, `finalizePose` shared with the Rive path); the hip; the IK targets (heels,
  toes, paws, tail tip) and each IK group's strength; the face controls.

`validateBridge()` refuses anything that is not exactly v1: unknown fields at any level, gaps in the range,
non-finite or out-of-range values, unknown clips, weights that do not sum to 1, a target across the frame, a path-like
segment id, and **a grounded on-stage frame with no declared supporting top under it**. A test bridges all 5,319
frames of the committed lesson: every grounded frame stands on a declared `SUPPORTED_SURFACE`/`LEDGE`/`NARROW_LEDGE`
top, except the few whose feet are outside the frame, which the contact audit also treats as off stage.

Another test runs the pinned Rive runtime on ~230 lesson frames and proves the bridge's resolved pose is the Rive
player's own pose before IK (every bone, the hip, every IK target), with a positive control.

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

`characterRenderer` (a staged, verified Blender sequence) makes `DocsVideo` draw `WallabyBlender` (one `<Img>` per
frame, opacity applied by Remotion, fail closed on a missing visible frame) instead of `WallabyRive`;
`depthReveals` replaces the flat transition for exactly their frames. `src/blender/stage.ts` stages a sequence only
if every PNG matches Blender's own manifest, the bridge it was rendered from is byte-for-byte the bridge the current
MotionPlan gives, and its identity matches the current toolchain, config, lane source, built model, and plan.
Captions, copy, UI, audio, timing, and encoding stay in Remotion.

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
`blendArtifactSha256`, `walletwallabyModelVersion` / `walletwallabyModelSha256` (canonical: rest geometry, weights,
attributes, bones, constraints), `walletwallabyRigVersion`, `materialsVersion` / `materialsSha256` (node graphs and
the mortar map's pixels), `motionBridgeSchema`, `motionPlanSha256`, `terrainSha256`, `cameraDefinitionSha256`,
`renderSettingsSha256`. No path, user, or machine detail.

## Determinism

Measured 2026-10-18 on the pinned build (Windows 11, RTX 5080, driver 616.56) with `npm run blender:determinism`
over ten lesson frames (1812–1990). Lossless frames only: MP4 bytes are not run-to-run stable and prove nothing.

| Test | Result |
|---|---|
| Two builds of the same source: canonical model and materials hashes | identical (`ac81bb8e…`, `21766af8…`) |
| Two builds: `.blend` bytes | differ: Blender writes memory addresses into the file. The `.blend` is a cache; it is pinned by its canonical model hash, never by its bytes, and staging compares the canonical hashes. |
| The frames rendered from build 1 and from build 2, each in a fresh process | 10 / 10 byte-identical PNGs |
| The same frames in a shuffled order | 10 / 10 byte-identical: no frame depends on another |
| The default render (no Blender props) on this branch vs main `ddf27b3`, 30 review stills | 30 / 30 byte-identical (`npm run stills:compare`) |

Every channel is written from the frame alone, the legacy IK solver keeps no state, dither is off, and nothing is
random. The scope is one machine and runtime: other GPUs, drivers, and Linux software GL are not proven, and
`.github/workflows/blender-proof.yml` (written to prove a GPU-less runner) has not run.

## Performance (RTX 5080, 16 GB; EEVEE, 1920 x 1080, 32 samples)

| Measurement | Result |
|---|---|
| Build the character from code (SDF → mesh → rig → materials → .blend) | 31.1 s per build (both builds) (the body mesh itself 4.6 s) |
| First frame in a fresh process (shader compile) | 1019 ms (then steady) |
| 30 review frames | 8.3 s in Blender (0.249 s per steady frame); 9.6 s including process start |
| Representative sequence (1806–2010, 205 frames) | 50.6 s in Blender (0.242 s per steady frame); 51.9 s including process start |
| Whole lesson, every visible frame | 5201 visible frames in 20.2 min in Blender (0.233 s per steady frame; 20.3 min end to end, including the 5,319-frame bridge); worst IK contact error 0.0217 px |
| GPU memory while rendering | 1619 MiB above the desktop's own 4242 MiB (peak 5861 of 16,303 MiB) |
| Remotion composite of the 205-frame section, Rive vs Blender | 7.9 s vs 9.8 s |

Per-frame time includes posing, the IK contact check, and writing a level-15 PNG. Nothing is optimised yet (no render
region around the character, which is a small part of most frames). Remotion then composites the whole lesson (5,319 frames) with the staged Blender frames and the reveal in 257 s, staging and bundling included.

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

Every PR: `npm test` includes `test/blender-lane.test.ts` (bridge parity with the Rive runtime, the full-lesson
support check, the closed v1 schema, the pinned toolchain and its confinement, the Python rules); no Blender needed.
`.github/workflows/blender-proof.yml` (manual) installs the pinned Linux build (SHA-256 verified), builds the character,
and proves deterministic frames; read-only and credential-free. Full renders stay manual.

## Known weaknesses and open decisions

- **The visual gate is the owner's.** In close-up and in depth the Blender body is the stronger one (volume, the wall
  in the belly, the face, and the depth reveal Rive cannot do). At lesson scale (0.5–0.78) the 2D rig still reads as
  the crisper emblem: its tail runs longer in silhouette and its limbs read bolder. Nothing is cut over until the
  owner says so.
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
- **Not proven**: cross-machine frame identity, EEVEE on a GPU-less runner, and Blender's IK under a pole that crosses
  the chain (the calibrated poles reproduce rest within 0.21 px; the contact error gate measures every frame).
- **The full composition with Blender is review-only**: production `npm run render` still draws the Rive rig.
