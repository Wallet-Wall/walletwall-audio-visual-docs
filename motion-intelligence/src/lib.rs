//! # WalletWallaby Motion Intelligence
//!
//! The lesson decides **where** WalletWallaby goes; this engine decides **how** he gets there.
//!
//! A [`MotionInput`] names a semantic action, a fixed start, the lesson's authored destination (the
//! stands it offers, the subject a perch faces), a time budget, the video frame rate, the terrain
//! (what each drawn surface offers a body, the outgoing scene's terrain while it is still on screen,
//! the text the figure should not cross, the figure's layout box), and a versioned [`MotionConfig`].
//! [`solve_motion`] answers with a [`MotionPlan`]: the stand it chose and how the terrain carries the
//! hop, the phase windows, the plan's contacts with the terrain, and one [`MotionState`] per video
//! frame. It fails closed: any malformed, non-finite, out-of-range, implausibly supported, or
//! unsolvable input is a [`MotionError`], never a clamped guess. The engine can only choose among the
//! authored stands, never move one; from touchdown on, every sampled position is the chosen stand
//! itself, bit for bit.
//!
//! The engine performs **HOP** (and LAND and PERCH, which arrive by the same physical traversal):
//! preload, push-off, a ballistic flight on the arc the surface-aware search keeps clear of the
//! scene's text ([`hop`]), exact contact, landing compression, settle, and a stable perch, with a
//! tail that counterbalances the body's motion ([`tail`]). Whether a stance, a grip, or a brace is
//! physically plausible is judged by [`support`], which also answers standalone support queries so
//! the engine can verify every contact a lesson makes.
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
pub mod support;
pub mod tail;
pub mod terrain;

#[cfg(target_arch = "wasm32")]
mod wasm;

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde::Serialize;
use serde_json::Value;

pub use config::MotionConfig;
pub use error::{MotionError, MotionErrorCode};
pub use math::Vec2;
pub use solver::solve_motion;
pub use state::{Contact, MotionAction, MotionInput, MotionPhase, MotionPlan, MotionState};
pub use support::{SupportQuery, SupportReport, answer_query};

/// Engine name recorded in every plan.
pub const ENGINE_NAME: &str = env!("CARGO_PKG_NAME");
/// Engine version recorded in every plan; a behavioural change ships under a new version.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Schema of an input document (v3: a destination of authored stands replaces the target; terrain
/// declares what each surface offers, and carries the outgoing scene's terrain).
pub const INPUT_SCHEMA: &str = "walletwall.motion-input/v3";
/// Schema of a plan document (v3: the plan names its stand and how the terrain carries the hop).
pub const PLAN_SCHEMA: &str = "walletwall.motion-plan/v3";
/// Schema of the physics configuration (v3: the `support` section).
pub const CONFIG_SCHEMA: &str = "walletwall.motion-intelligence-config/v3";
/// Schema of a support query document.
pub const SUPPORT_QUERY_SCHEMA: &str = "walletwall.support-query/v1";
/// Schema of a support report document.
pub const SUPPORT_REPORT_SCHEMA: &str = "walletwall.support-report/v1";
/// Version of the raw WebAssembly ABI (its exports and their protocol).
pub const ABI_VERSION: u32 = 1;
/// Largest input document the boundary accepts, bytes.
pub const MAX_INPUT_BYTES: usize = 1 << 20;

/// Where a motion input holds JSON arrays: the authored stands, and lists of surfaces and rectangles.
const INPUT_LISTS: &[&[&str]] = &[
    &["destination", "candidates"],
    &["terrain", "surfaces"],
    &["terrain", "protectedText"],
    &["terrain", "outgoing", "surfaces"],
    &["terrain", "outgoing", "protectedText"],
];
/// Where a support query holds JSON arrays.
const QUERY_LISTS: &[&[&str]] = &[
    &["terrain", "surfaces"],
    &["terrain", "protectedText"],
    &["stances"],
    &["grips"],
    &["braces"],
];

/// Refuse a JSON array anywhere the schema has an object. The typed parse refuses unknown, missing,
/// duplicated, and mistyped fields, but serde's derived structs also read an array positionally
/// (`"start": [1050, 370]` would parse as a point), which no schema allows. `lists`: the paths
/// where the schema declares a list, each of objects.
fn refuse_positional<'a>(
    v: &'a Value,
    path: &mut Vec<&'a str>,
    lists: &[&[&str]],
    schema: &str,
) -> Result<(), MotionError> {
    match v {
        Value::Object(fields) => {
            for (key, child) in fields {
                path.push(key);
                refuse_positional(child, path, lists, schema)?;
                path.pop();
            }
            Ok(())
        }
        Value::Array(items) if lists.contains(&path.as_slice()) => {
            for item in items {
                if !item.is_object() {
                    return Err(MotionError::new(
                        MotionErrorCode::InvalidInput,
                        format!("{}.{} holds something other than an object", "input", path.join(".")),
                    ));
                }
                refuse_positional(item, path, lists, schema)?;
            }
            Ok(())
        }
        Value::Array(_) => Err(MotionError::new(
            MotionErrorCode::InvalidInput,
            format!("input.{} is a JSON array where {schema} has an object", path.join(".")),
        )),
        _ => Ok(()),
    }
}

/// Serialize a plan or report whose numbers the engine has already checked finite (serde_json writes
/// NaN and Infinity as null rather than failing; writing into a Vec cannot fail otherwise, so the
/// mapping is defensive only).
fn to_document<T: Serialize>(doc: &T, what: &str) -> Result<Vec<u8>, MotionError> {
    serde_json::to_vec(doc)
        .map_err(|e| MotionError::new(MotionErrorCode::NonFiniteValue, format!("{what} serialization: {e}")))
}

/// Parse a JSON document and answer it: a [`MotionInput`] is solved into a [`MotionPlan`], a
/// [`SupportQuery`] is judged into a [`SupportReport`]. Exactly what the WebAssembly boundary runs,
/// so native tests pin the same bytes the artifact produces.
pub fn solve_json(input: &[u8]) -> Result<Vec<u8>, MotionError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(MotionError::new(
            MotionErrorCode::InvalidInput,
            format!("input is {} bytes, over the {MAX_INPUT_BYTES}-byte limit", input.len()),
        ));
    }
    let not_a = |schema: &str| {
        let schema = String::from(schema);
        move |e: serde_json::Error| {
            MotionError::new(
                MotionErrorCode::InvalidInput,
                format!("input is not a {schema} document: {e}"),
            )
        }
    };
    let value: Value = serde_json::from_slice(input).map_err(not_a("JSON"))?;
    match value.get("schema").and_then(Value::as_str) {
        Some(SUPPORT_QUERY_SCHEMA) => {
            let query: SupportQuery = serde_json::from_slice(input).map_err(not_a(SUPPORT_QUERY_SCHEMA))?;
            refuse_positional(&value, &mut Vec::new(), QUERY_LISTS, SUPPORT_QUERY_SCHEMA)?;
            to_document(&answer_query(&query)?, "report")
        }
        _ => {
            // Anything else is read as a motion input, whose own checks name a wrong schema.
            let parsed: MotionInput = serde_json::from_slice(input).map_err(not_a(INPUT_SCHEMA))?;
            refuse_positional(&value, &mut Vec::new(), INPUT_LISTS, INPUT_SCHEMA)?;
            to_document(&solve_motion(&parsed)?, "plan")
        }
    }
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
