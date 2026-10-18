# WalletWallaby Motion Intelligence (Rust/WASM engine)

> The lesson decides WHERE WalletWallaby goes. Motion Intelligence decides HOW he gets there.
> Simulation may never change the semantic destination.

WalletWallaby's traversal physics is moving out of TypeScript into a small, deterministic Rust engine compiled to WebAssembly. Engine v1 (0.1.0) established the boundary and migrated one path of the committed lesson. Engine v2 (0.2.0) performs **every hop that ends in a perch**: it runs the surface-aware arc search itself, states its contacts with the terrain, and the scene reacts to those contacts. Everything else still runs on the transitional TypeScript solver ([MOTION_ARCHITECTURE.md](MOTION_ARCHITECTURE.md)), which remains the engine's exact oracle.

## Layers

```text
VideoSpec beats                                   ← the lesson: WHAT and WHERE
   │ TypeScript orchestration: choreography (clips), path selection, engine input
   ▼
MotionInput (start, authored target, window, fps, terrain, stances, config)
   │ Rust Motion Intelligence, compiled to WASM (motion-intelligence/)
   ▼
MotionPlan: phase windows, the plan's contacts, one MotionState per video frame   ← HOW
   │ the composition binds the plan to its clips (fails closed), performs each state,
   │ and lets the scene react to the plan's contacts
   ▼
WallabyState → rig controls → Rive (body performance) → Remotion (time and composition)
```

| Owner | Decides |
|---|---|
| The lesson (VideoSpec, choreography) | Where, and when: the anchors, their order, every clip's window |
| Rust Motion Intelligence | How the body moves along an owned path: the arc (the surface-aware search), position and velocity, phase, pitch, leg load, squash and stretch, tail swing, curl and tension, head, ears, landing impulse; and the contacts it makes with the terrain |
| The scene | On owned paths, reacts to the engine's contacts: each platform's dip (and the feet riding it), the contact cues |
| TypeScript (transitional) | Every other clip; on owned paths the expressive layer (key-pose blend, expression, gaze, focus, support), timed by its own hop |
| Rive | The body itself: clip blending, IK, skinning, drawing |
| Remotion | Time and composition: which frame, and everything else in it |

## What the engine performs

`RUST_MOTION_PATHS` (`src/motion/rust-path.ts`) names the lessons whose hops the engine performs. In such a lesson every TRAVEL clip that the transitional solver performs as a single hop ending in a perch on its anchor is an engine path. In `migration-readiness` that is 13 hops: the hook's hop onto the card and its low skim across it, the question's landing, the tiers' landing on the monitor node, the signals' hop between nodes, the reading landing, the vault-conditional skims, the takeaway's hop to the summit ledge, and the four brand-segment hops (call to action, docs reference, outro, end screen). A render opts in with `--motion-engine=rust-wasm`; without it the video renders on the TypeScript solver alone and is unchanged.

Chained skips, traces, mantles, push-through, drop-in, exit leaps, and a hop that runs straight into a trace (no perch to hand the body back in) stay TypeScript. A selected path the engine cannot perform exactly is refused (`INELIGIBLE_PATH`); it is never silently left to TypeScript. A path is performed when it is a single hop followed by a perch on its anchor, the perch is neither a comparing one nor a narrow one, and the body is standing at both hand-offs. Another move's follow-through may still be running when an engine path opens only if it is a takeoff's or a push's (tail and ears): the composition carries it on top of the engine's own (summed, within the ears' range of motion): the tiers hop starts while the exit leap out of the previous scene still swings the tail. A landing's, a step's, or a weight shift's may not.

Engine actions: `HOP`, `LAND`, and `PERCH` (which arrive by the same traversal; a hop whose beat inspects or resolves is asked for as a `HOP`). `IDLE`, `INSPECT`, `TRACE`, `MANTLE`, `VAULT`, and `PUSH_THROUGH` are in the vocabulary and refused with `UNSUPPORTED_ACTION`.

### Phases

`IDLE` (orient) → `PRELOAD` (the legs load, the body squashes, the tail presses down) → `TAKEOFF` (the push-off: the legs extend while the feet still touch the surface) → `AIRBORNE` (ballistic) → `CONTACT` (touchdown, exactly on the target) → `COMPRESSION` (absorbing to the deepest point) → `SETTLE` (one small rebound, then the stance) → `PERCH` (exactly at rest).

The flight is a faithful port of the TypeScript `planHop`, evaluated with the same IEEE-754 operations in the same order: the engine's arc, liftoff, contact, depth, and gravity are bit-identical to the oracle's, and so is every flight position. From touchdown on, every position is the authored target itself, bit for bit. Before liftoff, it is the start.

The body is handed back at rest on the last frame the plan performs. A perch too short for the configured settle (700 ms) hurries it to end exactly on that frame, never below `landing.minSettleMs` (350 ms); shorter still is refused. In the committed lesson only the hook's first perch is that short, by about one millisecond.

### Surface awareness: the arc search

When the scene protects text (its text blocks and its eyebrow row, exactly the list the transitional solver avoids), the engine tries a fixed list of apex heights, as fractions of the natural one: natural first, then lower (0.75, 0.5, 0.35, 0.22, 0.12, 0.05), then higher (1.3, 1.65, 2.2, 3, capped at the configured peak). For each it counts the 31 interior flight samples (of 32) whose figure box (`WALLABY_EXTENT` at the sample's scale, the scene layout's `wallabyBounds`) overlaps protected text, and keeps the arc that crosses least: ties go to the earlier, more natural candidate, and the first arc that crosses nothing ends the search. A higher arc keeps its height and fits the window with stronger gravity (at most 1.8×); any other arc is lowered further before gravity is raised. Whatever it keeps lands exactly on the target. The plan names the arc (`trajectory.arcFraction`) and its crossings (`trajectory.textCrossings`). On the committed lesson the search lowers six hops to skims, raises the tiers hop (1.3× under 1.73× gravity), and keeps the natural arc where no candidate crosses less (the takeaway statement, the signals nodes) or there is no text (the brand segments).

### Contacts and the scene

Every plan states its contacts with the terrain (`events`): the `TAKEOFF` from the start at liftoff and the `LANDING` on the target at touchdown, each with its impulse (vertical speed at that end of the flight over the touchdown speed of a fall from `landing.impulseReferenceBodyHeights`), position, scale, and what the feet touch. The composition replaces each engine path's own takeoff and landing in the transitional plan with these (`BoundMotionEngine.contacts`). The scene's platform dip (`platformOffsets`), the feet riding that platform, and the contact cue sheet (`npm run publish:dry-run` re-solves the render's plans, requires them byte for byte, and times the cues to them) all react to that list. The spring responses of the transitional events an engine path owns are muted everywhere in the TypeScript layer: the engine produces that secondary motion and settles it inside its own window, so none of it carries on after the hand-off. The expressive layer still reads those events (the landing pose, the tail's brace as it relaxes), and the stance the engine hands the body back in is that layer's own at the hand-off frame, so the hand-off is seamless.

The engine still flies exactly the oracle's hop, so today the dips and cues are unchanged; the tests prove the scene follows the engine anyway (a softer or later stated landing moves the platform and the cue with it).

### Tail Motion Intelligence

```text
body motion → desired counterbalance → bounded damped response → swing, curl, tension
```

The desired swing (`desired_counterbalance` in `motion-intelligence/src/tail.rs`) is the authored stance plus four physical terms: leg load presses the tail down against the surface (only while grounded); it counter-rotates against the body's pitch; it streams with the vertical speed (rising lifts the tip, falling sweeps it down to meet the ground); touchdown whips it down before the brace. A damped second-order follower turns that target into the tail's actual swing (it lags, overshoots a little, settles). Curl and tension follow their own targets with a first-order lag: the stance's own curl, looser in the air and flattened under load, and the stance's own tension while standing, rising with the phase's work (a lever at takeoff, a brace at landing) and with tracking effort. Stances carry the tail's curl and tension, so a perch that leans in to inspect settles into the lifted, curled counterweight that pose holds. A soft range of motion bounds every angle, and the settle tapers everything to the exact stance before the perch. Angles use the Rive rig's conventions (positive swing raises the tip).

## The boundary

The engine is a WebAssembly module that **imports nothing** (no clock, randomness, environment, or I/O can reach it; the adapter checks this every time it loads the module) and exports linear memory and five functions (ABI v1):

| Export | Protocol |
|---|---|
| `mi_abi_version() -> u32` | 1 |
| `mi_input(len) -> ptr` | resets the engine's arena and reserves `len` bytes for one input document (0 = refused) |
| `mi_solve() -> status` | solves it: 0 = plan, 1 = refusal, 2 = no input reserved |
| `mi_output_ptr()`, `mi_output_len()` | the output document |

Documents are JSON with typed schemas: `walletwall.motion-input/v2` in (the terrain carries `protectedText` and the `figure` box; stances carry `tailCurl` and `tailTension`), `walletwall.motion-plan/v2` (with `events` and the arc's `arcFraction` and `textCrossings`) or `{"error":{"code","message"}}` out. Inside the engine they are typed Rust structs that refuse unknown, missing, and duplicated fields, and the boundary refuses a JSON array anywhere the schema has an object (serde would otherwise read `"start": [1050, 370]` as a point); numbers are parsed exactly (`serde_json`'s `float_roundtrip`: the default parser can land 1 ULP away, which the plan's exact echo of its window would expose).

Refusal codes: `INVALID_INPUT`, `NON_FINITE_VALUE`, `INVALID_DURATION`, `INVALID_TARGET`, `UNSOLVABLE_TRAJECTORY`, `OUT_OF_BOUNDS`, `INVALID_CONFIG`, `UNSUPPORTED_ACTION` from the engine, and `ENGINE_UNAVAILABLE`, `ENGINE_FAULT`, `INVALID_PLAN`, `INELIGIBLE_PATH`, `BINDING_MISMATCH` from the adapter. Nothing on the engine path clamps invalid input or falls back.

TypeScript validates in three places: the adapter refuses NaN, Infinity, and undefined before encoding (JSON would silently turn them into `null` or drop them); `validateMotionPlan` re-checks every guarantee of a returned plan (field sets, finiteness, ranges, exact echoes of the start, target, and window, the frame grid, phase order, positions before liftoff and after contact, the contacts at their own instants and places, rest in the authored stance at the hand-off) and freezes it; and the composition binds each plan to the clips it computed itself. Because the expressive layer on an engine path is still the transitional solver's, timed by its own hop, the bind also requires the engine to fly exactly that hop: the same liftoff, contact, and arc, and on every frame the feet exactly where the oracle puts them (compared without the platform dip, before any frame is drawn, and again as each frame is drawn). The scene no longer depends on this; the body's expression does.

## Determinism boundary

Identical input bytes, configuration, and engine version give identical plan bytes, on the native build and in the WebAssembly artifact:

- The engine reads no clock, randomness, environment, or I/O, and the module has no imports.
- Arithmetic is IEEE-754 binary64 with every operation separately rounded: no fast-math, no fused multiply-add (`f64::mul_add` and `powi` are refused by `clippy.toml`).
- Transcendental functions come from the pure-Rust `libm` crate, never the platform's C library (`clippy.toml` refuses the `f64` methods); without that, a native test on Windows and the WASM could differ in the last bit.
- Iteration is in index order; there are no hash maps; serialization is field order.
- Secondary motion is integrated once per plan on a fixed 1 ms grid from the window start and read at frame times by interpolation, so it does not depend on the frame rate or on which frames are rendered; every frame is a lookup, so frames render identically in any order. The one exception is a hurried settle, which ends on the last frame the plan performs (the frame rate is part of the input).

`motion-intelligence/tests/fixtures/` holds the exact plan bytes for four of the committed lesson's paths, chosen to cover what the engine does: the takeaway hop (the natural arc onto the summit ledge), the hook hop (the lowest arc the search offers and a hurried settle), the tiers landing (a higher arc under stronger gravity onto a node at a new scale), and the signals hop (an inspecting perch). The native Rust tests and the TypeScript tests (against the WASM) both compare to them, which proves the two builds compute the same plans. The takeaway plan's samples are the same as engine v1's, bit for bit.

## The artifact and provenance

The canonical WebAssembly artifact is committed (`motion-intelligence/wasm/motion_intelligence.wasm`) with a manifest (`artifact.json`: crate and ABI versions, the toolchain that built it, its sha256 and size, and a hash of the crate sources it was built from). Renders need only Node. The adapter refuses an artifact whose bytes are not exactly the ones the manifest names, and `npm test` fails if the crate sources change without a rebuild.

The canonical build is `motion-intelligence/build-wasm.sh`, run on Linux or macOS (CI, WSL) with the toolchain pinned in `rust-toolchain.toml` (1.96.0) and the dependencies in `Cargo.lock`. It remaps `CARGO_HOME` to `/cargo`, so no machine path or user name ends up in the binary (Rust embeds panic locations even with a trap-only panic handler, and Windows paths keep backslashes after any remapped prefix, which is why Windows cannot produce the canonical bytes). `npm run motion:check` (CI) rebuilds it and requires the committed bytes, byte for byte. A rebuild from a different checkout path with an empty `CARGO_HOME` reproduced the artifact exactly.

`render.json` (`walletwall.render-info/v4`) and the stills manifest (`walletwall.stills-info/v2`) record `motionEngine`: for `rust-wasm`, the crate and ABI versions, the WASM path and sha256, the toolchain, the configuration's schema, id, version, and content address, and, for every plan the render performed, its clip, frames, and content address. The provenance manifest (`walletwall.video-provenance/v3`) carries it, and the publish dry run refuses a render whose engine artifact, configuration, or plans this checkout no longer reproduces.

`config/motion-intelligence.json` (`walletwall.motion-intelligence-config/v2`) is versioned and pinned like the TypeScript motion config (`MOTION_INTELLIGENCE_CONFIG_PINS`); the hop constants it shares with `config/motion.json` must agree while the TypeScript solver is the oracle (`test/rust-motion-engine.test.ts`).

## Building and testing

```text
cd motion-intelligence && rustup toolchain install   # once: the pinned toolchain and its wasm32 target
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings && cargo test
npm run motion:build      # Linux or WSL: rebuild the canonical artifact and its manifest
npm run motion:check      # Linux or WSL: the committed artifact regenerates byte for byte (CI)
npm run motion:fixtures   # after a deliberate behaviour change: regenerate the canonical fixtures
npm run motion:bench      # artifact size, load, solve, bind, and sampling cost
npm run render -- migration-readiness --motion-engine=rust-wasm
npm run render:stills -- migration-readiness --motion-engine=rust-wasm --frames=3715,3725,3731,3733
```

The tests hold the engine to the oracle three ways: every engine path of the lesson flies the TypeScript hop exactly (timing, arc, text crossings, contacts); a sweep of synthetic hops over open ground (several distances, heights, windows, scales, and text layouts, 360 in all) flies the same arc as `planHop`, bit for bit, or both refuse; and every engine frame puts the feet exactly where the oracle does.

## Known weaknesses and what remains TypeScript

- The engine performs hops to perches only. Chained skips, traces, mantles, push-through, drop-in, exit leaps, and a hop that runs straight into a trace are TypeScript; the transitional solver still decides which kind of move each clip is.
- The expressive key-pose blend on an owned path still comes from the TypeScript motion layer (with the engine paths' own spring responses muted), timed by its own hop; the engine drives the blend only before liftoff, where its push-off timing differs. That is why the engine must still fly the oracle's hop exactly. Moving the expressive timing to the engine is what would let its physics diverge from the oracle.
- `MotionState` carries the engine's phase vocabulary; the composition maps it onto the rig's (`ORIENT`, `PRELOAD`, `TAKEOFF`, `FLIGHT`, `REACH`, `CONTACT`, `SETTLE`, `HOLD`).
- The oracle's hop touches down at least 0.45 × 40 ms = 18 ms before its clip ends, not the full 40 ms reserve that MOTION_ARCHITECTURE.md states: the orient and the extra preload take part of the reserve. The engine reproduces this exactly, and its tests assert the real margin.
- The arc search, like the oracle's, tests the standing figure's layout box, not the drawn pose: flight poses extend past it, so text crossings are an estimate.
- The engine is stricter than the oracle in one way: it refuses an arc that rises past `limits.maxApexBodyHeights` (2 body heights), which the transitional solver would fly (for example a screen-wide hop at half scale, where the speed limit buys flight time with a higher arc). Such a path fails closed; no hop of the committed lesson comes near it, and a test pins the divergence.
- Canonical builds need Linux or macOS (WSL on Windows).
