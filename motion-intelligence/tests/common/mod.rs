//! Shared fixtures: canonical inputs (engine paths of the committed lesson, as the TypeScript
//! converter builds them) and the exact plan bytes the committed WebAssembly artifact returns for
//! them. Regenerate all of them with `npm run motion:fixtures` after a deliberate behaviour change.
#![allow(dead_code)]

use motion_intelligence::terrain::{Face, SupportClass, TerrainSurface};
use motion_intelligence::{MotionError, MotionErrorCode, MotionInput, MotionPlan, Vec2, solve_motion};

/// The takeaway hop: the natural arc onto the summit ledge (the default fixture below).
pub const INPUT_JSON: &str = include_str!("../fixtures/takeaway-hop.input.json");
pub const PLAN_BYTES: &[u8] = include_bytes!("../fixtures/takeaway-hop.plan.json");

/// Every canonical fixture: `(name, input document, plan bytes)`.
pub const FIXTURES: [(&str, &str, &[u8]); 4] = [
    ("takeaway-hop", INPUT_JSON, PLAN_BYTES),
    (
        // The lowest arc the search offers, and a settle hurried onto a short perch.
        "hook-hop",
        include_str!("../fixtures/hook-hop.input.json"),
        include_bytes!("../fixtures/hook-hop.plan.json"),
    ),
    (
        // A landing at a new scale whose takeoff stands on the outgoing scene's terrain.
        "reading-land",
        include_str!("../fixtures/reading-land.input.json"),
        include_bytes!("../fixtures/reading-land.plan.json"),
    ),
    (
        // A perch that leans in to inspect: the tail settles into a curl.
        "signals-hop",
        include_str!("../fixtures/signals-hop.input.json"),
        include_bytes!("../fixtures/signals-hop.plan.json"),
    ),
];

/// The canonical (takeaway) input, parsed.
pub fn input() -> MotionInput {
    serde_json::from_str(INPUT_JSON).expect("the fixture input parses")
}

/// A named fixture's input, parsed.
pub fn fixture(name: &str) -> MotionInput {
    let (_, json, _) = FIXTURES
        .iter()
        .find(|(n, _, _)| *n == name)
        .unwrap_or_else(|| panic!("no fixture {name}"));
    serde_json::from_str(json).expect("the fixture input parses")
}

/// The authored stand of a canonical input (each canonical destination authors exactly one).
pub fn stand(i: &MotionInput) -> Vec2 {
    assert_eq!(
        i.destination.candidates.len(),
        1,
        "a canonical destination authors one stand"
    );
    i.destination.candidates[0]
}

/// Author `at` as the destination's only stand.
pub fn set_stand(i: &mut MotionInput, at: Vec2) {
    i.destination.candidates = vec![at];
}

/// A surface for hand-built terrain.
pub fn surface(
    id: &str,
    face: Face,
    support: SupportClass,
    (x0, y0, x1, y1): (f64, f64, f64, f64),
    thickness_px: f64,
) -> TerrainSurface {
    TerrainSurface {
        id: id.into(),
        element: id.split(':').next().unwrap_or(id).into(),
        face,
        support,
        x0,
        y0,
        x1,
        y1,
        thickness_px,
    }
}

/// Edge-to-edge ground with its line at `y` (down to the bottom of a 1080 px frame).
pub fn ground(y: f64) -> TerrainSurface {
    surface(
        "ground:top",
        Face::Top,
        SupportClass::SupportedSurface,
        (0.0, y, 1920.0, y),
        1080.0 - y,
    )
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
