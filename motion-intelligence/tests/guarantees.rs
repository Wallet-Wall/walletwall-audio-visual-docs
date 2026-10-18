//! What every plan guarantees, on the committed lesson's takeaway hop and on variations of it.

mod common;

use motion_intelligence::state::{Contact, MotionAction, MotionPhase};
use motion_intelligence::{MotionPlan, solve_motion};

fn plan() -> MotionPlan {
    solve_motion(&common::input()).expect("the fixture solves")
}

#[test]
fn from_touchdown_on_the_feet_are_on_the_authored_target_bit_for_bit() {
    let input = common::input();
    let p = plan();
    assert!(p.target.bits_eq(input.target), "the target echo is the input target");
    let landed: Vec<_> = p.samples.iter().filter(|s| s.phase.after_contact()).collect();
    assert!(landed.len() > 200, "the perch is sampled ({} frames)", landed.len());
    for s in &landed {
        assert!(
            s.position.bits_eq(input.target),
            "{:?} at ({}, {})",
            s.phase,
            s.position.x,
            s.position.y
        );
        assert_eq!(s.contact, Contact::Platform, "the ledge carries the feet");
    }
    assert_eq!(p.samples.last().unwrap().phase, MotionPhase::Perch);
}

#[test]
fn before_liftoff_the_feet_stay_on_the_start_bit_for_bit() {
    let input = common::input();
    for s in plan().samples.iter().filter(|s| s.phase.before_liftoff()) {
        assert!(s.position.bits_eq(input.start), "{:?}", s.phase);
        assert_eq!(s.contact, Contact::Ground);
        assert_eq!((s.velocity.x, s.velocity.y), (0.0, 0.0));
    }
}

#[test]
fn phases_run_in_order_and_the_landing_comes_before_the_settle_and_the_perch() {
    let p = plan();
    let order: Vec<_> = p.phases.iter().map(|w| w.phase).collect();
    assert_eq!(order, MotionPhase::ORDER.to_vec(), "every phase of a hop, in order");
    for pair in p.phases.windows(2) {
        assert_eq!(pair[0].end_ms.to_bits(), pair[1].start_ms.to_bits(), "contiguous");
    }
    let first = |ph: MotionPhase| p.samples.iter().position(|s| s.phase == ph);
    let (preload, airborne, settle, perch) = (
        first(MotionPhase::Preload),
        first(MotionPhase::Airborne),
        first(MotionPhase::Settle),
        first(MotionPhase::Perch),
    );
    let contact = p.samples.iter().position(|s| s.phase.after_contact()).unwrap();
    assert!(preload < airborne && airborne < Some(contact) && Some(contact) < settle && settle < perch);
    assert!(
        p.samples.windows(2).all(|w| w[0].phase <= w[1].phase),
        "samples never go back a phase"
    );
    // The flight fits inside (window - preload - reserve), and the orient and the extra preload
    // take at most 0.55 of what is left, so touchdown comes at least 0.45 x reserve before the
    // deadline (18 ms here: exactly the oracle's margin, not the full reserve).
    let reserve = common::input().config.hop.settle_reserve_ms;
    assert!(
        p.timing.contact_ms < p.timing.arrive_by_ms,
        "touchdown before the deadline"
    );
    assert!(
        p.timing.arrive_by_ms - p.timing.contact_ms >= 0.45 * reserve - 1e-9,
        "touchdown margin"
    );
}

#[test]
fn the_hop_is_the_transitional_typescript_solver_s_hop_exactly() {
    // Values from planHop (src/character/walletwallaby/motion.ts) for this clip, at full precision.
    let p = plan();
    assert_eq!(p.timing.orient_end_ms, 123706.0);
    assert_eq!(p.timing.liftoff_ms, 123904.0);
    assert_eq!(p.timing.contact_ms, 124360.92321588083);
    assert_eq!(p.trajectory.depth_px, 403.5360645205965);
    assert_eq!(p.trajectory.gravity_px_per_s2, 3865.6800000000007);
    assert_eq!(p.trajectory.apex_above_px, 18.656799439396536);
    assert_eq!(p.landing_impulse, 1.0);
    assert_eq!(p.takeoff_impulse, 0.4109979383999526);
}

#[test]
fn every_channel_is_finite_and_inside_its_limit() {
    let input = common::input();
    let c = &input.config;
    for s in plan().samples {
        for v in [
            s.phase_progress,
            s.scale,
            s.body_pitch,
            s.crouch,
            s.tuck,
            s.compression,
            s.stretch,
            s.tail_angle,
            s.tail_curl,
            s.tail_tension,
            s.head_angle,
            s.ear_lag,
            s.landing_impulse,
        ] {
            assert!(v.is_finite());
        }
        assert!(s.body_pitch.abs() <= c.pitch.max_deg);
        assert!(s.tail_angle.abs() <= c.tail.max_deg && s.tail_curl.abs() <= c.tail.max_curl_deg);
        assert!(s.ear_lag.abs() <= c.ears.max_deg && s.head_angle.abs() <= c.limits.max_head_deg);
        for u in [
            s.crouch,
            s.tuck,
            s.compression,
            s.stretch,
            s.tail_tension,
            s.landing_impulse,
        ] {
            assert!((0.0..=1.0).contains(&u));
        }
    }
}

#[test]
fn the_tail_counterbalances_the_body_instead_of_holding_a_pose() {
    let p = plan();
    let flight: Vec<_> = p.samples.iter().filter(|s| s.phase == MotionPhase::Airborne).collect();
    let n = flight.len();
    let mean =
        |xs: &[&motion_intelligence::MotionState]| xs.iter().map(|s| s.tail_angle).sum::<f64>() / xs.len() as f64;
    let (rising, falling) = (mean(&flight[..n / 3]), mean(&flight[2 * n / 3..]));
    // Nose up and rising early in the flight lifts the tail; nose down and falling late lowers it.
    assert!(
        flight[0].body_pitch < 0.0 && flight[n - 1].body_pitch > 0.0,
        "control: the body pitches through the flight"
    );
    assert!(rising > falling + 5.0, "rising {rising:.2} vs falling {falling:.2}");
    let preload_min = p
        .samples
        .iter()
        .filter(|s| s.phase == MotionPhase::Preload)
        .map(|s| s.tail_angle)
        .fold(0.0, f64::min);
    assert!(
        preload_min < -2.0,
        "the loaded body presses the tail down ({preload_min:.2})"
    );
    let landing_min = p
        .samples
        .iter()
        .filter(|s| matches!(s.phase, MotionPhase::Contact | MotionPhase::Compression))
        .map(|s| s.tail_angle)
        .fold(0.0, f64::min);
    assert!(landing_min < -8.0, "the landing braces it ({landing_min:.2})");
    // And it settles exactly to the stance for the perch.
    let rest = common::input().stance.rest;
    for s in p.samples.iter().filter(|s| s.phase == MotionPhase::Perch) {
        assert_eq!(
            (s.tail_angle, s.tail_curl, s.tail_tension),
            (rest.tail_deg, 0.0, common::input().config.tail.tension_rest)
        );
    }
}

#[test]
fn the_solver_cannot_change_where_the_lesson_goes() {
    let input = common::input();
    let variants: [fn(&mut motion_intelligence::MotionInput); 6] = [
        |i| i.config.gravity_body_heights_per_s2 = 30.0,
        |i| i.config.hop.peak_base = 0.6,
        |i| i.config.tail.freq_hz = 5.0,
        |i| i.config.landing.settle_ms = 400.0,
        |i| i.action = MotionAction::Land,
        |i| i.action = MotionAction::Perch,
    ];
    for (k, patch) in variants.iter().enumerate() {
        let p = common::solve_with(patch).unwrap_or_else(|e| panic!("variant {k}: {e}"));
        assert!(p.target.bits_eq(input.target), "variant {k}");
        assert!(
            p.samples.last().unwrap().position.bits_eq(input.target),
            "variant {k} ends on the target"
        );
        assert!(
            p.timing.contact_ms <= input.timing.arrive_by_ms,
            "variant {k} lands in time"
        );
    }
    // Positive control: a different physics config does produce different motion.
    let other = common::solve_with(|i| i.config.gravity_body_heights_per_s2 = 30.0).unwrap();
    assert_ne!(other.trajectory.depth_px, plan().trajectory.depth_px);
}

#[test]
fn the_frame_grid_is_the_renderers_frame_times() {
    let input = common::input();
    let p = plan();
    let ms = |f: u64| (f as f64 * 1000.0) / f64::from(input.fps);
    let (first, count) = (u64::from(p.frames.first), u64::from(p.frames.count));
    assert!(ms(first) >= input.timing.start_ms && ms(first - 1) < input.timing.start_ms);
    assert!(ms(first + count - 1) < input.timing.end_ms && ms(first + count) >= input.timing.end_ms);
    assert_eq!(p.samples.len() as u64, count);
}
