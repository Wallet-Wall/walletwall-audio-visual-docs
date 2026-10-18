# motion-intelligence

WalletWallaby's deterministic traversal engine: a fixed start, a fixed authored target, and a time budget in; one motion state per video frame out. It decides **how** the body moves and can never change **where** it goes. See [docs/MOTION_INTELLIGENCE.md](../docs/MOTION_INTELLIGENCE.md) for the architecture, the boundary, and the determinism rules.

```rust
pub fn solve_motion(input: &MotionInput) -> Result<MotionPlan, MotionError>;
pub fn solve_json(input: &[u8]) -> Result<Vec<u8>, MotionError>; // exactly what the WASM boundary runs
```

| Module | |
|---|---|
| `state.rs` | `MotionInput`, `MotionAction`, `MotionPhase`, `MotionState`, `MotionPlan` |
| `config.rs` | the versioned physics configuration, validated against explicit ranges |
| `hop.rs` | preload timing and the ballistic flight (a faithful port of the TypeScript `planHop`) |
| `landing.rs` | contact, compression, settle |
| `tail.rs` | tail counterbalance: desired swing, damped follower, curl, tension |
| `terrain.rs` | the stage and the surfaces under the start and the target |
| `solver.rs` | validation, phases, the fixed-step secondary simulation, frame sampling |
| `constraints.rs` | the last gate: every guarantee re-checked before a plan leaves the engine |
| `error.rs` | fail-closed refusal codes |
| `math.rs` | `Vec2` and the deterministic arithmetic (pure-Rust `libm`) |
| `wasm.rs` | wasm32 only: the zero-import ABI, a bump arena, trap on panic |

Dependencies: `libm`, `serde` (derive, no_std + alloc), `serde_json` (no_std + alloc, `float_roundtrip`). The wasm32 build is `no_std`; native builds (tests) use `std` and the same arithmetic.

```text
rustup toolchain install          # the toolchain pinned in rust-toolchain.toml, with its wasm32 target
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo clippy --target wasm32-unknown-unknown --lib -- -D warnings
cargo test                        # unit tests plus tests/{fixture,guarantees,adversarial}.rs
bash build-wasm.sh <out.wasm>     # canonical artifact (Linux or macOS); npm run motion:build / motion:check
```
