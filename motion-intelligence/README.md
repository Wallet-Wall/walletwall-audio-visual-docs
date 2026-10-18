# motion-intelligence

WalletWallaby's deterministic traversal engine: a fixed start, the lesson's authored stands for the destination, a time budget, and the semantic terrain in; the chosen stand, its support verdicts, the plan's contacts with the terrain, and one motion state per video frame out. It decides **how** the body moves, and whether a contact is physically plausible, and can never change **where** it goes: it only chooses among the authored stands, and refuses when none is plausible. See [docs/MOTION_INTELLIGENCE.md](../docs/MOTION_INTELLIGENCE.md) for the architecture, the boundary, and the determinism rules.

```rust
pub fn solve_motion(input: &MotionInput) -> Result<MotionPlan, MotionError>;
pub fn answer_query(query: &SupportQuery) -> Result<SupportReport, MotionError>;
pub fn solve_json(input: &[u8]) -> Result<Vec<u8>, MotionError>; // exactly what the WASM boundary runs (either document)
```

| Module | |
|---|---|
| `state.rs` | `MotionInput` (with its `Destination`), `MotionAction`, `MotionPhase`, `MotionState`, `ContactEvent`, `PlanSupport`, `MotionPlan` |
| `support.rs` | support plausibility: stances, grips, braces, stand selection, and the support-query document |
| `config.rs` | the versioned physics configuration, validated against explicit ranges |
| `hop.rs` | preload timing, the ballistic flight, and the surface-aware arc search (a faithful port of the TypeScript `planHop`) |
| `landing.rs` | contact, compression, settle (hurried onto a short perch's last frame, within `landing.minSettleMs`) |
| `tail.rs` | tail counterbalance: desired swing, damped follower, curl, tension |
| `terrain.rs` | the stage, the semantic surfaces (face, support class, thickness), the outgoing scene's terrain, the protected text, the figure's layout box, and the solids they imply |
| `solver.rs` | validation, stand selection and support verdicts, phases, the fixed-step secondary simulation, frame sampling, the plan's contacts |
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
cargo test                        # unit tests plus tests/{fixture,guarantees,arc_search,adversarial,support}.rs
bash build-wasm.sh <out.wasm>     # canonical artifact (Linux or macOS); npm run motion:build / motion:check
```
