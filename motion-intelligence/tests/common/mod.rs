//! Shared fixtures: the canonical input (the committed lesson's takeaway hop, as the TypeScript
//! converter builds it) and the exact plan bytes the committed WebAssembly artifact returns for it.
//! Regenerate both with `npm run motion:fixtures` after a deliberate behaviour change.
#![allow(dead_code)]

use motion_intelligence::{MotionError, MotionErrorCode, MotionInput, MotionPlan, solve_motion};

pub const INPUT_JSON: &str = include_str!("../fixtures/takeaway-hop.input.json");
pub const PLAN_BYTES: &[u8] = include_bytes!("../fixtures/takeaway-hop.plan.json");

/// The canonical input, parsed.
pub fn input() -> MotionInput {
    serde_json::from_str(INPUT_JSON).expect("the fixture input parses")
}

/// Solve the canonical input after `patch`.
pub fn solve_with(patch: impl FnOnce(&mut MotionInput)) -> Result<MotionPlan, MotionError> {
    let mut i = input();
    patch(&mut i);
    solve_motion(&i)
}

/// The refusal code of a result that must be a refusal.
pub fn code<T: core::fmt::Debug>(r: Result<T, MotionError>, what: &str) -> MotionErrorCode {
    match r {
        Ok(v) => panic!("{what}: expected a refusal, got {v:?}"),
        Err(e) => e.code,
    }
}
