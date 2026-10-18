//! Fail closed: every malformed, non-finite, out-of-range, impossible, or unsupported input is
//! refused with its own code, never clamped into something plausible. Every case has a positive
//! control: the unmodified fixture solves.

mod common;

use common::{code, solve_with};
use motion_intelligence::state::MotionAction;
use motion_intelligence::terrain::{MAX_PROTECTED_TEXT, Rect};
use motion_intelligence::{MotionErrorCode as E, MotionInput, solve_json, solve_motion};

type Field = fn(&mut MotionInput) -> &mut f64;
/// One adversarial edit of the fixture input.
type Patch = fn(&mut MotionInput);

/// Every floating-point field a caller supplies, input and configuration.
const FIELDS: &[(&str, Field)] = &[
    ("start.x", |i| &mut i.start.x),
    ("start.y", |i| &mut i.start.y),
    ("target.x", |i| &mut i.target.x),
    ("target.y", |i| &mut i.target.y),
    ("startScale", |i| &mut i.start_scale),
    ("targetScale", |i| &mut i.target_scale),
    ("timing.startMs", |i| &mut i.timing.start_ms),
    ("timing.arriveByMs", |i| &mut i.timing.arrive_by_ms),
    ("timing.endMs", |i| &mut i.timing.end_ms),
    ("stage.width", |i| &mut i.stage.width),
    ("stage.height", |i| &mut i.stage.height),
    ("stance.initial.crouch", |i| &mut i.stance.initial.crouch),
    ("stance.initial.tailDeg", |i| &mut i.stance.initial.tail_deg),
    ("stance.initial.tailCurl", |i| &mut i.stance.initial.tail_curl),
    ("stance.initial.tailTension", |i| &mut i.stance.initial.tail_tension),
    ("stance.rest.crouch", |i| &mut i.stance.rest.crouch),
    ("stance.rest.tailDeg", |i| &mut i.stance.rest.tail_deg),
    ("stance.rest.tailCurl", |i| &mut i.stance.rest.tail_curl),
    ("stance.rest.tailTension", |i| &mut i.stance.rest.tail_tension),
    ("terrain.protectedText[0].x", |i| &mut i.terrain.protected_text[0].x),
    ("terrain.protectedText[0].y", |i| &mut i.terrain.protected_text[0].y),
    ("terrain.protectedText[0].w", |i| &mut i.terrain.protected_text[0].w),
    ("terrain.protectedText[0].h", |i| &mut i.terrain.protected_text[0].h),
    ("terrain.figure.left", |i| &mut i.terrain.figure.left),
    ("terrain.figure.right", |i| &mut i.terrain.figure.right),
    ("terrain.figure.top", |i| &mut i.terrain.figure.top),
    ("terrain.target.topY", |i| &mut i.terrain.target.as_mut().unwrap().top_y),
    ("terrain.target.leftX", |i| {
        &mut i.terrain.target.as_mut().unwrap().left_x
    }),
    ("terrain.target.rightX", |i| {
        &mut i.terrain.target.as_mut().unwrap().right_x
    }),
    ("config.bodyHeightPx", |i| &mut i.config.body_height_px),
    ("config.gravityBodyHeightsPerS2", |i| {
        &mut i.config.gravity_body_heights_per_s2
    }),
    ("config.maxGravityBoost", |i| &mut i.config.max_gravity_boost),
    ("config.maxSpeedBodyHeightsPerS", |i| {
        &mut i.config.max_speed_body_heights_per_s
    }),
    ("config.hop.peakBase", |i| &mut i.config.hop.peak_base),
    ("config.hop.peakMax", |i| &mut i.config.hop.peak_max),
    ("config.hop.anticipationMs", |i| &mut i.config.hop.anticipation_ms),
    ("config.hop.minFlightMs", |i| &mut i.config.hop.min_flight_ms),
    ("config.hop.pushMs", |i| &mut i.config.hop.push_ms),
    ("config.landing.settleMs", |i| &mut i.config.landing.settle_ms),
    ("config.landing.minSettleMs", |i| &mut i.config.landing.min_settle_ms),
    ("config.landing.settleDamping", |i| &mut i.config.landing.settle_damping),
    ("config.pitch.maxDeg", |i| &mut i.config.pitch.max_deg),
    ("config.tail.freqHz", |i| &mut i.config.tail.freq_hz),
    ("config.tail.damping", |i| &mut i.config.tail.damping),
    ("config.tail.loadDeg", |i| &mut i.config.tail.load_deg),
    ("config.tail.maxDeg", |i| &mut i.config.tail.max_deg),
    ("config.tail.tensionLoad", |i| &mut i.config.tail.tension_load),
    ("config.ears.freqHz", |i| &mut i.config.ears.freq_hz),
    ("config.limits.maxHeadDeg", |i| &mut i.config.limits.max_head_deg),
    ("config.limits.maxWindowMs", |i| &mut i.config.limits.max_window_ms),
];

#[test]
fn positive_control_the_fixture_solves() {
    assert!(solve_motion(&common::input()).is_ok());
    assert!(solve_json(common::INPUT_JSON.as_bytes()).is_ok());
}

#[test]
fn nan_and_infinity_anywhere_fail_closed_as_non_finite() {
    for (name, field) in FIELDS {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(
                code(solve_with(|i| *field(i) = bad), name),
                E::NonFiniteValue,
                "{name} = {bad}"
            );
        }
    }
}

#[test]
fn impossible_windows_fail_closed() {
    let cases: [(&str, Patch); 7] = [
        ("empty hop window", |i| i.timing.arrive_by_ms = i.timing.start_ms),
        ("inverted hop window", |i| {
            i.timing.arrive_by_ms = i.timing.start_ms - 100.0
        }),
        ("negative start", |i| i.timing.start_ms = -1.0),
        ("no time to perch", |i| i.timing.end_ms = i.timing.arrive_by_ms),
        ("closes before the landing settles", |i| {
            i.timing.end_ms = i.timing.arrive_by_ms + 200.0
        }),
        ("longer than the window limit", |i| {
            i.timing.end_ms = i.timing.start_ms + 70_000.0
        }),
        ("no time to fly", |i| i.timing.arrive_by_ms = i.timing.start_ms + 120.0),
    ];
    for (name, patch) in cases {
        assert_eq!(code(solve_with(patch), name), E::InvalidDuration, "{name}");
    }
}

#[test]
fn unreachable_or_unsupported_destinations_fail_closed() {
    assert_eq!(
        code(solve_with(|i| i.target.x = 1900.0), "far target"),
        E::InvalidTarget,
        "off its declared ledge"
    );
    let cases: [(&str, Patch, E); 6] = [
        (
            "too far for the window",
            |i| {
                i.terrain.target = None;
                i.start.x = 0.0;
                i.target.x = 1920.0;
                i.timing.arrive_by_ms = i.timing.start_ms + 400.0
            },
            E::UnsolvableTrajectory,
        ),
        (
            "target off stage",
            |i| {
                i.terrain.target = None;
                i.target.y = 1200.0
            },
            E::OutOfBounds,
        ),
        (
            "negative target",
            |i| {
                i.terrain.target = None;
                i.target.x = -1.0
            },
            E::OutOfBounds,
        ),
        ("start far off stage", |i| i.start.x = 9000.0, E::OutOfBounds),
        ("target above its ledge", |i| i.target.y = 590.0, E::InvalidTarget),
        (
            "inverted ledge",
            |i| i.terrain.target.as_mut().unwrap().right_x = 1000.0,
            E::InvalidInput,
        ),
    ];
    for (name, patch, want) in cases {
        assert_eq!(code(solve_with(patch), name), want, "{name}");
    }
}

#[test]
fn out_of_range_scalars_fail_closed() {
    let cases: [(&str, Patch); 15] = [
        ("zero scale", |i| i.start_scale = 0.0),
        ("negative scale", |i| i.target_scale = -0.5),
        ("absurd scale", |i| i.target_scale = 50.0),
        ("zero fps", |i| i.fps = 0),
        ("absurd fps", |i| i.fps = 10_000),
        ("crouch above 1", |i| i.stance.rest.crouch = 1.5),
        ("tail stance past its exact range", |i| i.stance.initial.tail_deg = 29.0),
        ("tail curl past its exact range", |i| i.stance.rest.tail_curl = 5.0),
        ("tail tension above 1", |i| i.stance.initial.tail_tension = 1.5),
        ("negative tail tension", |i| i.stance.rest.tail_tension = -0.1),
        ("text with a negative size", |i| i.terrain.protected_text[0].w = -1.0),
        ("a figure with no width", |i| {
            i.terrain.figure.left = 0.0;
            i.terrain.figure.right = 0.0
        }),
        ("a figure with no height", |i| i.terrain.figure.top = 0.0),
        ("an absurd figure", |i| i.terrain.figure.left = 1.0e6),
        ("more text than a scene has", |i| {
            i.terrain.protected_text = vec![
                Rect {
                    x: 0.0,
                    y: 0.0,
                    w: 1.0,
                    h: 1.0
                };
                MAX_PROTECTED_TEXT + 1
            ]
        }),
    ];
    for (name, patch) in cases {
        assert_eq!(code(solve_with(patch), name), E::InvalidInput, "{name}");
    }
    // Positive controls at the edges: an inspecting stance, a degenerate (zero-area) text box, and
    // as many rectangles as allowed are all accepted.
    let edges: [Patch; 3] = [
        |i| {
            i.stance.rest.tail_curl = 1.5;
            i.stance.rest.tail_tension = 0.35
        },
        |i| i.terrain.protected_text[0].w = 0.0,
        |i| {
            let first = i.terrain.protected_text[0];
            i.terrain.protected_text = vec![first; MAX_PROTECTED_TEXT]
        },
    ];
    for (k, patch) in edges.into_iter().enumerate() {
        assert!(solve_with(patch).is_ok(), "edge {k}");
    }
}

#[test]
fn invalid_configurations_fail_closed() {
    let cases: [(&str, Patch); 11] = [
        ("gravity out of range", |i| i.config.gravity_body_heights_per_s2 = 500.0),
        ("a minimum settle longer than the settle", |i| {
            i.config.landing.min_settle_ms = 800.0
        }),
        ("a minimum settle out of range", |i| {
            i.config.landing.min_settle_ms = 10.0
        }),
        ("negative anticipation", |i| i.config.hop.anticipation_ms = -1.0),
        ("absurd peak height", |i| i.config.hop.peak_max = 5.0),
        ("peak min above max", |i| {
            i.config.hop.peak_min = 0.9;
            i.config.hop.peak_max = 0.5
        }),
        ("peak above the apex limit", |i| {
            i.config.hop.peak_max = 1.5;
            i.config.limits.max_apex_body_heights = 1.0
        }),
        ("overdamped settle", |i| i.config.landing.settle_damping = 1.2),
        ("wrong schema", |i| {
            i.config.schema = "walletwall.motion-intelligence-config/v0".into()
        }),
        ("bad id", |i| i.config.id = "Not A Slug".into()),
        ("version zero", |i| i.config.version = 0),
    ];
    for (name, patch) in cases {
        assert_eq!(code(solve_with(patch), name), E::InvalidConfig, "{name}");
    }
}

#[test]
fn actions_this_version_does_not_perform_are_refused() {
    for action in [
        MotionAction::Idle,
        MotionAction::Inspect,
        MotionAction::Trace,
        MotionAction::Mantle,
        MotionAction::Vault,
        MotionAction::PushThrough,
    ] {
        assert_eq!(
            code(solve_with(|i| i.action = action), "action"),
            E::UnsupportedAction,
            "{action:?}"
        );
    }
    for action in [MotionAction::Hop, MotionAction::Land, MotionAction::Perch] {
        assert!(
            solve_with(|i| i.action = action).is_ok(),
            "control: {action:?} is performed"
        );
    }
}

/// Apply `edit` to the fixture document and return its bytes.
fn document(edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let mut v: serde_json::Value = serde_json::from_str(common::INPUT_JSON).unwrap();
    edit(&mut v);
    serde_json::to_vec(&v).unwrap()
}

#[test]
fn malformed_documents_fail_closed() {
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("unknown field", document(|v| v["wobble"] = 1.into())),
        (
            "unknown nested field",
            document(|v| v["config"]["tail"]["wag"] = 1.into()),
        ),
        (
            "missing field",
            document(|v| {
                v.as_object_mut().unwrap().remove("timing");
            }),
        ),
        (
            "omitted surface (not read as open ground)",
            document(|v| {
                v["terrain"].as_object_mut().unwrap().remove("start");
            }),
        ),
        ("empty terrain", document(|v| v["terrain"] = serde_json::json!({}))),
        (
            "omitted protected text (not read as nothing to avoid)",
            document(|v| {
                v["terrain"].as_object_mut().unwrap().remove("protectedText");
            }),
        ),
        (
            "omitted figure",
            document(|v| {
                v["terrain"].as_object_mut().unwrap().remove("figure");
            }),
        ),
        (
            "unknown field in a text rectangle",
            document(|v| v["terrain"]["protectedText"][0]["z"] = 1.into()),
        ),
        (
            "protected text that is not a list",
            document(|v| v["terrain"]["protectedText"] = serde_json::json!({"x": 1})),
        ),
        (
            "unknown field in the figure",
            document(|v| v["terrain"]["figure"]["tail"] = 1.into()),
        ),
        (
            "omitted stance curl",
            document(|v| {
                v["stance"]["rest"].as_object_mut().unwrap().remove("tailCurl");
            }),
        ),
        ("string number", document(|v| v["target"]["x"] = "1600".into())),
        (
            "null number",
            document(|v| v["timing"]["endMs"] = serde_json::Value::Null),
        ),
        ("fractional fps", document(|v| v["fps"] = 29.97.into())),
        ("negative fps", document(|v| v["fps"] = (-30).into())),
        ("unknown action", document(|v| v["action"] = "TELEPORT".into())),
        (
            "wrong schema",
            document(|v| v["schema"] = "walletwall.motion-input/v0".into()),
        ),
        ("not json", b"{\"schema\": ".to_vec()),
        ("empty", Vec::new()),
        ("trailing garbage", [common::INPUT_JSON.as_bytes(), b"}"].concat()),
        (
            "overflowing number",
            common::INPUT_JSON
                .replacen("\"x\": 1600", "\"x\": 1e400", 1)
                .into_bytes(),
        ),
        (
            "duplicated field (never last-one-wins)",
            common::INPUT_JSON
                .replacen("\"x\": 1050,", "\"x\": 1050,\n    \"x\": 1051,", 1)
                .into_bytes(),
        ),
        ("oversized", vec![b' '; motion_intelligence::MAX_INPUT_BYTES + 1]),
    ];
    for (name, bytes) in cases {
        assert_eq!(code(solve_json(&bytes), name), E::InvalidInput, "{name}");
    }
}

#[test]
fn no_field_silently_accepts_a_non_number() {
    // Replace every numeric leaf of the document, one at a time, with null: each must be refused.
    fn leaves(v: &serde_json::Value, at: String, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Number(_) => out.push(at),
            serde_json::Value::Object(m) => m.iter().for_each(|(k, c)| leaves(c, format!("{at}/{k}"), out)),
            serde_json::Value::Array(a) => a
                .iter()
                .enumerate()
                .for_each(|(k, c)| leaves(c, format!("{at}/{k}"), out)),
            _ => {}
        }
    }
    let base: serde_json::Value = serde_json::from_str(common::INPUT_JSON).unwrap();
    let mut paths = Vec::new();
    leaves(&base, String::new(), &mut paths);
    assert!(
        paths.len() > 60,
        "control: the sweep covers the whole document ({})",
        paths.len()
    );
    for p in paths {
        let bytes = document(|v| *v.pointer_mut(&p).unwrap() = serde_json::Value::Null);
        assert_eq!(code(solve_json(&bytes), &p), E::InvalidInput, "{p}");
    }
}

#[test]
fn no_object_is_read_positionally() {
    use serde_json::{Value, json};
    // serde's derived structs alone would read a point given as [x, y]; the boundary refuses it.
    let positional = document(|v| v["start"] = json!([v["start"]["x"].clone(), v["start"]["y"].clone()]));
    assert!(
        serde_json::from_slice::<MotionInput>(&positional).is_ok(),
        "control: the typed parse alone accepts the array"
    );
    assert_eq!(code(solve_json(&positional), "positional start"), E::InvalidInput);
    let rect_as_list = document(|v| v["terrain"]["protectedText"][0] = json!([160, 104, 1100, 32]));
    assert!(
        serde_json::from_slice::<MotionInput>(&rect_as_list).is_ok(),
        "control: the typed parse alone accepts the array"
    );
    assert_eq!(code(solve_json(&rect_as_list), "rectangle as a list"), E::InvalidInput);

    // Every object in the document (except the document itself), given as the array of its values
    // instead, is refused.
    fn objects(v: &Value, at: String, out: &mut Vec<String>) {
        match v {
            Value::Object(m) => {
                if !at.is_empty() {
                    out.push(at.clone());
                }
                m.iter().for_each(|(k, c)| objects(c, format!("{at}/{k}"), out));
            }
            Value::Array(a) => a
                .iter()
                .enumerate()
                .for_each(|(k, c)| objects(c, format!("{at}/{k}"), out)),
            _ => {}
        }
    }
    let base: Value = serde_json::from_str(common::INPUT_JSON).unwrap();
    let mut paths = Vec::new();
    objects(&base, String::new(), &mut paths);
    assert!(
        paths.len() > 20,
        "control: the sweep covers every object ({})",
        paths.len()
    );
    for p in paths {
        let bytes = document(|v| {
            let node = v.pointer_mut(&p).unwrap();
            let values: Vec<Value> = node.as_object().unwrap().values().cloned().collect();
            *node = Value::Array(values);
        });
        assert_eq!(code(solve_json(&bytes), &p), E::InvalidInput, "{p}");
    }

    // Positive controls: the one declared list is accepted, full or empty.
    assert!(solve_json(common::INPUT_JSON.as_bytes()).is_ok());
    assert!(solve_json(&document(|v| v["terrain"]["protectedText"] = json!([]))).is_ok());
}
