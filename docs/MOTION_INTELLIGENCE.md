# WalletWallaby Motion Intelligence (Rust/WASM engine, v1)

> The lesson decides WHERE WalletWallaby goes. Motion Intelligence decides HOW he gets there.
> Simulation may never change the semantic destination.

This is the first lane of moving WalletWallaby's traversal physics out of TypeScript into a small, deterministic Rust engine compiled to WebAssembly. It establishes the engine boundary and migrates **one real path** of the committed lesson. It does not try to finish the movement engine: everything else still runs on the transitional TypeScript solver ([MOTION_ARCHITECTURE.md](MOTION_ARCHITECTURE.md)).

## Layers

```text
VideoSpec beats                                   ← the lesson: WHAT and WHERE
   │ TypeScript orchestration: choreography (clips), path selection, engine input
   ▼
MotionInput (start, authored target, window, fps, terrain, stances, config)
   │ Rust Motion Intelligence, compiled to WASM (motion-intelligence/)
   ▼
MotionPlan: phase windows + one MotionState per video frame   ← HOW
   │ the composition binds the plan to its clips (fails closed) and performs each state
   ▼
WallabyState → rig controls → Rive (body performance) → Remotion (time and composition)
```

| Owner | Decides |
|---|---|
| The lesson (VideoSpec, choreography) | Where, and when: the anchors, their order, every clip's window |
| Rust Motion Intelligence | How the body moves along an owned path: position and velocity, phase, pitch, leg load, squash and stretch, tail swing, curl and tension, head, ears, landing impulse |
| TypeScript (transitional) | Every other clip; on owned paths the expressive layer (key-pose blend, expression, gaze, focus, support) and the scene's reactions (platform dip, contact sounds) |
| Rive | The body itself: clip blending, IK, skinning, drawing |
| Remotion | Time and composition: which frame, and everything else in it |

## What v1 performs

`RUST_MOTION_PATHS` (`src/motion/rust-path.ts`) selects one path: the `takeaway` segment's `HOP` to the statement, the landing on the summit ledge, and the perch that follows (frames 3711 to 3943 of `migration-readiness`). A render opts in with `--motion-engine=rust-wasm`; without it the video renders on the TypeScript solver alone and is unchanged.

A selected path the engine cannot perform exactly is refused (`INELIGIBLE_PATH`); it is never silently left to TypeScript. v1 performs a path when it is a single hop (not a skip or a trace) followed by a perch on its anchor, its arc is the natural one (the surface-aware arc search is still TypeScript), no other event's secondary motion is running in its window, the perch is not a narrow one, and the body is at rest at both hand-offs.

Engine actions: `HOP`, `LAND`, and `PERCH` (which arrive by the same traversal). `IDLE`, `INSPECT`, `TRACE`, `MANTLE`, `VAULT`, and `PUSH_THROUGH` are in the vocabulary and refused with `UNSUPPORTED_ACTION`.

### Phases

`IDLE` (orient) → `PRELOAD` (the legs load, the body squashes, the tail presses down) → `TAKEOFF` (the push-off: the legs extend while the feet still touch the surface) → `AIRBORNE` (ballistic) → `CONTACT` (touchdown, exactly on the target) → `COMPRESSION` (absorbing to the deepest point) → `SETTLE` (one small rebound, then the stance) → `PERCH` (exactly at rest).

The flight is a faithful port of the TypeScript `planHop`, evaluated with the same IEEE-754 operations in the same order: the engine's liftoff, contact, depth, and gravity are bit-identical to the oracle's, and so is every flight position. From touchdown on, every position is the authored target itself, bit for bit. Before liftoff, it is the start.

### Tail Motion Intelligence

```text
body motion → desired counterbalance → bounded damped response → swing, curl, tension
```

The desired swing (`desired_counterbalance` in `motion-intelligence/src/tail.rs`) is the authored stance plus four physical terms: leg load presses the tail down against the surface (only while grounded); it counter-rotates against the body's pitch; it streams with the vertical speed (rising lifts the tip, falling sweeps it down to meet the ground); touchdown whips it down before the brace. A damped second-order follower turns that target into the tail's actual swing (it lags, overshoots a little, settles). Curl and tension follow their own targets with a first-order lag; tension rises with the phase's work (a lever at takeoff, a brace at landing) and with tracking effort. A soft range of motion bounds every angle, and the settle tapers everything to the exact stance before the perch. Angles use the Rive rig's conventions (positive swing raises the tip).

## The boundary

The engine is a WebAssembly module that **imports nothing** (no clock, randomness, environment, or I/O can reach it; the adapter checks this every time it loads the module) and exports linear memory and five functions (ABI v1):

| Export | Protocol |
|---|---|
| `mi_abi_version() -> u32` | 1 |
| `mi_input(len) -> ptr` | resets the engine's arena and reserves `len` bytes for one input document (0 = refused) |
| `mi_solve() -> status` | solves it: 0 = plan, 1 = refusal, 2 = no input reserved |
| `mi_output_ptr()`, `mi_output_len()` | the output document |

Documents are JSON with typed schemas: `walletwall.motion-input/v1` in, `walletwall.motion-plan/v1` or `{"error":{"code","message"}}` out. Inside the engine they are typed Rust structs that refuse unknown fields; numbers are parsed exactly (`serde_json`'s `float_roundtrip`: the default parser can land 1 ULP away, which the plan's exact echo of its window would expose).

Refusal codes: `INVALID_INPUT`, `NON_FINITE_VALUE`, `INVALID_DURATION`, `INVALID_TARGET`, `UNSOLVABLE_TRAJECTORY`, `OUT_OF_BOUNDS`, `INVALID_CONFIG`, `UNSUPPORTED_ACTION` from the engine, and `ENGINE_UNAVAILABLE`, `ENGINE_FAULT`, `INVALID_PLAN`, `INELIGIBLE_PATH`, `BINDING_MISMATCH` from the adapter. Nothing on the engine path clamps invalid input or falls back.

TypeScript validates in three places: the adapter refuses NaN, Infinity, and undefined before encoding (JSON would silently turn them into `null` or drop them); `validateMotionPlan` re-checks every guarantee of a returned plan (field sets, finiteness, ranges, exact echoes of the start, target, and window, the frame grid, phase order, positions before liftoff and after contact, rest at the hand-off) and freezes it; and the composition binds each plan to the clips it computed itself, requires bit-exact agreement with the oracle on liftoff, contact, and arc, and checks on every frame that the engine and the oracle put the feet in the same place.

## Determinism boundary

Identical input bytes, configuration, and engine version give identical plan bytes, on the native build and in the WebAssembly artifact:

- The engine reads no clock, randomness, environment, or I/O, and the module has no imports.
- Arithmetic is IEEE-754 binary64 with every operation separately rounded: no fast-math, no fused multiply-add (`f64::mul_add` and `powi` are refused by `clippy.toml`).
- Transcendental functions come from the pure-Rust `libm` crate, never the platform's C library (`clippy.toml` refuses the `f64` methods); without that, a native test on Windows and the WASM could differ in the last bit.
- Iteration is in index order; there are no hash maps; serialization is field order.
- Secondary motion is integrated once per plan on a fixed 1 ms grid from the window start and read at frame times by interpolation, so it does not depend on the frame rate or on which frames are rendered; every frame is a lookup, so frames render identically in any order.

`motion-intelligence/tests/fixtures/takeaway-hop.plan.json` holds the exact plan bytes for the committed lesson's path. The native Rust tests and the TypeScript tests (against the WASM) both compare to it, which proves the two builds compute the same plan.

## The artifact and provenance

The canonical WebAssembly artifact is committed (`motion-intelligence/wasm/motion_intelligence.wasm`) with a manifest (`artifact.json`: crate and ABI versions, the toolchain that built it, its sha256 and size, and a hash of the crate sources it was built from). Renders need only Node. The adapter refuses an artifact whose bytes are not exactly the ones the manifest names, and `npm test` fails if the crate sources change without a rebuild.

The canonical build is `motion-intelligence/build-wasm.sh`, run on Linux or macOS (CI, WSL) with the toolchain pinned in `rust-toolchain.toml` (1.96.0) and the dependencies in `Cargo.lock`. It remaps `CARGO_HOME` to `/cargo`, so no machine path or user name ends up in the binary (Rust embeds panic locations even with a trap-only panic handler, and Windows paths keep backslashes after any remapped prefix, which is why Windows cannot produce the canonical bytes). `npm run motion:check` (CI) rebuilds it and requires the committed bytes, byte for byte. A rebuild from a different checkout path with an empty `CARGO_HOME` reproduced the artifact exactly.

`render.json` (`walletwall.render-info/v3`) and the stills manifest record `motionEngine`: for `rust-wasm`, the crate and ABI versions, the WASM path and sha256, the toolchain, the configuration's schema, id, version, and content address, and the content address and frames of every plan the render performed. The provenance manifest (`walletwall.video-provenance/v3`) carries it, and the publish dry run refuses a render whose engine artifact or configuration this checkout no longer has.

`config/motion-intelligence.json` is versioned and pinned like the TypeScript motion config (`MOTION_INTELLIGENCE_CONFIG_PINS`); the hop constants it shares with `config/motion.json` must agree while the TypeScript solver is the oracle (`test/rust-motion-engine.test.ts`).

## Building and testing

```text
cd motion-intelligence && rustup toolchain install   # once: the pinned toolchain and its wasm32 target
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings && cargo test
npm run motion:build      # Linux or WSL: rebuild the canonical artifact and its manifest
npm run motion:check      # Linux or WSL: the committed artifact regenerates byte for byte (CI)
npm run motion:fixtures   # after a deliberate behaviour change: regenerate the canonical fixture
npm run motion:bench      # artifact size, load, solve, bind, and sampling cost
npm run render -- migration-readiness --motion-engine=rust-wasm
npm run render:stills -- migration-readiness --motion-engine=rust-wasm --frames=3715,3725,3731,3733
```

## Known weaknesses and what remains TypeScript

- One path. Every other clip, the surface-aware arc search, chained skips, traces, mantles, push-through, drop-in, and exit leaps are TypeScript. So are the scene's reactions to the engine's contacts (platform dip, contact sounds), which is why the engine must match the oracle's liftoff and contact exactly for now.
- The expressive key-pose blend on an owned path still comes from the TypeScript motion layer (with that hop's own spring responses muted); the engine drives the blend only before liftoff, where its push-off timing differs.
- `MotionState` carries the engine's phase vocabulary; the composition maps it onto the rig's (`ORIENT`, `PRELOAD`, `TAKEOFF`, `FLIGHT`, `REACH`, `CONTACT`, `SETTLE`, `HOLD`).
- The oracle's hop touches down at least 0.45 × 40 ms = 18 ms before its clip ends, not the full 40 ms reserve that MOTION_ARCHITECTURE.md states: the orient and the extra preload take part of the reserve. The engine reproduces this exactly, and its tests assert the real margin.
- Canonical builds need Linux or macOS (WSL on Windows).
