//! Determinism: the native engine reproduces the canonical plan byte for byte (the TypeScript
//! integration tests pin the WebAssembly artifact to the same bytes), and identical input always
//! gives identical output.

mod common;

use motion_intelligence::{solve_json, solve_motion};

#[test]
fn the_native_engine_reproduces_the_canonical_plan_byte_for_byte() {
    let out = solve_json(common::INPUT_JSON.as_bytes()).expect("the fixture solves");
    assert!(
        out == common::PLAN_BYTES,
        "the native plan ({} bytes) differs from tests/fixtures/takeaway-hop.plan.json ({} bytes); \
         after a deliberate change run npm run motion:fixtures and bump the crate version",
        out.len(),
        common::PLAN_BYTES.len()
    );
}

#[test]
fn identical_input_gives_identical_bytes_every_time() {
    let first = solve_json(common::INPUT_JSON.as_bytes()).unwrap();
    for _ in 0..5 {
        assert_eq!(solve_json(common::INPUT_JSON.as_bytes()).unwrap(), first);
    }
    // The typed API and the JSON boundary agree.
    let plan = solve_motion(&common::input()).unwrap();
    assert_eq!(plan, solve_motion(&common::input().clone()).unwrap());
    assert_eq!(serde_json::to_vec(&plan).unwrap(), first);
}

#[test]
fn formatting_of_the_input_document_does_not_change_the_plan() {
    let compact = serde_json::to_vec(&common::input()).unwrap();
    let value: serde_json::Value = serde_json::from_str(common::INPUT_JSON).unwrap();
    let pretty = serde_json::to_vec_pretty(&value).unwrap();
    assert_eq!(solve_json(&compact).unwrap(), common::PLAN_BYTES);
    assert_eq!(solve_json(&pretty).unwrap(), common::PLAN_BYTES);
}

#[test]
fn every_number_crosses_the_boundary_exactly() {
    // The exact float parser: the echo of a fractional window edge is the same double, not 1 ULP off.
    let plan = solve_motion(&common::input()).unwrap();
    let input = common::input();
    assert_eq!(plan.timing.arrive_by_ms.to_bits(), input.timing.arrive_by_ms.to_bits());
    let text = String::from_utf8(serde_json::to_vec(&plan).unwrap()).unwrap();
    let back: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        back["timing"]["arriveByMs"].as_f64().unwrap().to_bits(),
        input.timing.arrive_by_ms.to_bits()
    );
}
