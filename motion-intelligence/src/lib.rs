//! # WalletWallaby Motion Intelligence
//!
//! The lesson decides **where** WalletWallaby goes; this engine decides **how** he gets there.
//!
//! A [`MotionInput`] names a semantic action, a fixed start, a fixed authored target, a time
//! budget, the video frame rate, and a versioned [`MotionConfig`]. [`solve_motion`] answers with a
//! [`MotionPlan`]: the phase windows plus one [`MotionState`] per video frame. It fails closed: any
//! malformed, non-finite, out-of-range, or unsolvable input is a [`MotionError`], never a clamped
//! guess. The target is an input the engine can only reach; from touchdown on, every sampled
//! position is the authored target itself, bit for bit.
//!
//! v1 performs one vertical slice: **HOP** (and LAND and PERCH, which arrive by the same physical
//! traversal): preload, push-off, a ballistic flight, exact contact, landing compression, settle,
//! and a stable perch, with a tail that counterbalances the body's motion ([`tail`]).
//!
//! ## Determinism boundary
//!
//! Identical input bytes give identical output bytes, for the native build and for the wasm32
//! artifact alike, because:
//!
//! - the engine reads no clock, randomness, environment, or I/O (the wasm module imports nothing);
//! - arithmetic is IEEE-754 binary64 with every operation separately rounded (no fast-math, no
//!   fused multiply-add), and transcendental functions come from the pure-Rust `libm` crate
//!   rather than the platform's C library (enforced by `clippy.toml`);
//! - iteration is over vectors in index order (no hash maps), and serialization is field order.
//!
//! A canonical fixture (`tests/fixtures/`) pins the output bytes; the native tests and the
//! TypeScript integration tests (against the wasm artifact) both compare to it.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod config;
pub mod constraints;
pub mod error;
pub mod hop;
pub mod landing;
pub mod math;
pub mod solver;
pub mod state;
pub mod tail;
pub mod terrain;

#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::format;
use alloc::vec::Vec;
use serde::Serialize;

pub use config::MotionConfig;
pub use error::{MotionError, MotionErrorCode};
pub use math::Vec2;
pub use solver::solve_motion;
pub use state::{Contact, MotionAction, MotionInput, MotionPhase, MotionPlan, MotionState};

/// Engine name recorded in every plan.
pub const ENGINE_NAME: &str = env!("CARGO_PKG_NAME");
/// Engine version recorded in every plan; a behavioural change ships under a new version.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Schema of an input document.
pub const INPUT_SCHEMA: &str = "walletwall.motion-input/v1";
/// Schema of a plan document.
pub const PLAN_SCHEMA: &str = "walletwall.motion-plan/v1";
/// Schema of the physics configuration.
pub const CONFIG_SCHEMA: &str = "walletwall.motion-intelligence-config/v1";
/// Version of the raw WebAssembly ABI (its exports and their protocol).
pub const ABI_VERSION: u32 = 1;
/// Largest input document the boundary accepts, bytes.
pub const MAX_INPUT_BYTES: usize = 1 << 20;

/// Parse a JSON [`MotionInput`], solve it, and serialize the [`MotionPlan`]: exactly what the
/// WebAssembly boundary runs, so native tests pin the same bytes the artifact produces.
pub fn solve_json(input: &[u8]) -> Result<Vec<u8>, MotionError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(MotionError::new(
            MotionErrorCode::InvalidInput,
            format!("input is {} bytes, over the {MAX_INPUT_BYTES}-byte limit", input.len()),
        ));
    }
    let parsed: MotionInput = serde_json::from_slice(input).map_err(|e| {
        MotionError::new(
            MotionErrorCode::InvalidInput,
            format!("input is not a {INPUT_SCHEMA} document: {e}"),
        )
    })?;
    let plan = solve_motion(&parsed)?;
    // serde_json writes NaN and Infinity as null rather than failing, so finiteness is enforced
    // before this point (constraints::check_plan covers every number in the plan); writing into a
    // Vec cannot fail otherwise. The mapping is defensive only.
    serde_json::to_vec(&plan)
        .map_err(|e| MotionError::new(MotionErrorCode::NonFiniteValue, format!("plan serialization: {e}")))
}

/// A refusal as `{"error":{"code":"...","message":"..."}}`.
pub fn error_json(err: &MotionError) -> Vec<u8> {
    #[derive(Serialize)]
    struct Refusal<'a> {
        error: &'a MotionError,
    }
    serde_json::to_vec(&Refusal { error: err })
        .unwrap_or_else(|_| br#"{"error":{"code":"INVALID_INPUT","message":"unserializable refusal"}}"#.to_vec())
}
