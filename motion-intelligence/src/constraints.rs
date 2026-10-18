//! The last gate before a plan leaves the engine. A plan that breaks any guarantee is refused, so
//! a bug in the solver surfaces as an error, never as a frame:
//!
//! - the target is the authored stand the plan names, bit for bit, and so is every position from
//!   touchdown on; that stand, the takeoff, and the landing are carried by the terrain;
//! - every position before liftoff is the start, bit for bit, and the flight stays inside its arc;
//! - phases are non-empty, contiguous, in traversal order, and cover the window exactly;
//! - samples follow the phases in order and match the frame grid;
//! - every number is finite and every channel is inside its limit;
//! - the contacts are exactly the takeoff from the start at liftoff and the landing on the target
//!   at touchdown;
//! - the last sample is the perch, at rest in the authored stance.

use alloc::format;

use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::hop::{ARC_CANDIDATES, FLIGHT_SAMPLES};
use crate::solver::Ends;
use crate::state::{Contact, ContactEvent, ContactKind, MotionInput, MotionPhase, MotionPlan, MotionState};

fn finite_state(s: &MotionState) -> bool {
    [
        s.phase_progress,
        s.position.x,
        s.position.y,
        s.velocity.x,
        s.velocity.y,
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
    ]
    .iter()
    .all(|v| v.is_finite())
}

/// Refuse a plan that breaks any of the module's guarantees for `input`, whose ends the solver
/// resolved as `ends`.
pub fn check_plan(plan: &MotionPlan, input: &MotionInput, ends: &Ends) -> Result<(), MotionError> {
    use MotionErrorCode::{ImplausibleSupport, InvalidDuration, InvalidTarget, NonFiniteValue, OutOfBounds};
    let cfg = &input.config;
    let support = &plan.support;
    let chosen = input.destination.candidates.get(support.candidate as usize);
    if !chosen.is_some_and(|c| plan.target.bits_eq(*c) && ends.target.bits_eq(*c)) {
        return refuse(InvalidTarget, "the plan's target is not the authored stand it names");
    }
    if support.candidates.len() != input.destination.candidates.len()
        || !support.candidates.get(support.candidate as usize).is_some_and(|v| v.ok)
        || !support.landing.verdict.ok
        || support.takeoff.as_ref().is_some_and(|t| !t.verdict.ok)
        || support.takeoff.is_some() != input.stage.contains(input.start)
    {
        return refuse(
            ImplausibleSupport,
            "the plan's stand, takeoff, or landing is not carried",
        );
    }
    if !plan.start.bits_eq(input.start) {
        return refuse(InvalidTarget, "the plan's start is not the input start");
    }

    // Every scalar outside the samples is finite (serde_json would write a NaN as null, silently),
    // the key instants are in order, and the impulses are normalised.
    let t = &plan.timing;
    let j = &plan.trajectory;
    let scalars = [
        t.orient_end_ms,
        t.push_ms,
        t.liftoff_ms,
        t.contact_ms,
        t.settled_ms,
        j.depth_px,
        j.gravity_px_per_s2,
        j.gravity_boost,
        j.flight_ms,
        j.apex_above_px,
        j.arc_fraction,
    ];
    if !scalars.iter().all(|v| v.is_finite()) {
        return refuse(NonFiniteValue, "a plan timing or trajectory value is not finite");
    }
    if !ARC_CANDIDATES.contains(&j.arc_fraction) || j.text_crossings >= FLIGHT_SAMPLES {
        return refuse(OutOfBounds, "the plan's arc is not one the search can choose");
    }
    if !(t.start_ms <= t.orient_end_ms
        && t.orient_end_ms < t.push_ms
        && t.push_ms < t.liftoff_ms
        && t.liftoff_ms < t.contact_ms
        && t.contact_ms <= t.arrive_by_ms
        && t.contact_ms < t.settled_ms
        && t.settled_ms < t.end_ms)
    {
        return refuse(InvalidDuration, "the plan's key instants are out of order");
    }
    check_events(plan, input, ends)?;

    // Phases: non-empty, contiguous, strictly in traversal order, covering [start, end).
    let (Some(first), Some(last)) = (plan.phases.first(), plan.phases.last()) else {
        return refuse(InvalidDuration, "the plan has no phases");
    };
    if first.start_ms.to_bits() != input.timing.start_ms.to_bits()
        || last.end_ms.to_bits() != input.timing.end_ms.to_bits()
    {
        return refuse(InvalidDuration, "the phases do not cover the window exactly");
    }
    for w in &plan.phases {
        if !(w.start_ms.is_finite() && w.end_ms.is_finite()) {
            return refuse(NonFiniteValue, format!("{:?} window is not finite", w.phase));
        }
        if w.start_ms >= w.end_ms {
            return refuse(InvalidDuration, format!("{:?} window is empty or inverted", w.phase));
        }
    }
    for pair in plan.phases.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if a.end_ms.to_bits() != b.start_ms.to_bits() || a.phase >= b.phase {
            return refuse(
                InvalidDuration,
                format!("{:?} -> {:?} is not a contiguous, ordered hand-off", a.phase, b.phase),
            );
        }
    }

    // Samples: one per frame, in phase order.
    let Some(last_sample) = plan.samples.last() else {
        return refuse(InvalidDuration, "no frame falls inside the window");
    };
    if plan.samples.len() != plan.frames.count as usize || plan.frames.fps != input.fps {
        return refuse(InvalidDuration, "the samples do not match the frame grid");
    }
    let target = ends.target;
    let apex_y = input.start.y.min(target.y) - plan.trajectory.apex_above_px;
    let (x_lo, x_hi) = (input.start.x.min(target.x), input.start.x.max(target.x));
    let y_hi = input.start.y.max(target.y);
    let mut prev = MotionPhase::Idle;
    for (k, s) in plan.samples.iter().enumerate() {
        let at = |what: &str| {
            format!(
                "frame {} ({:?}): {what}",
                u64::from(plan.frames.first) + k as u64,
                s.phase
            )
        };
        if !finite_state(s) {
            return refuse(NonFiniteValue, at("a channel is not finite"));
        }
        if s.phase < prev {
            return refuse(InvalidDuration, at("phase goes backwards"));
        }
        prev = s.phase;
        let unit = [
            s.phase_progress,
            s.crouch,
            s.tuck,
            s.compression,
            s.stretch,
            s.tail_tension,
            s.landing_impulse,
        ];
        if unit.iter().any(|v| !(0.0..=1.0).contains(v)) || s.phase_progress >= 1.0 {
            return refuse(OutOfBounds, at("a 0..1 channel is out of range"));
        }
        if !(s.scale > 0.0 && s.scale <= 4.0) {
            return refuse(OutOfBounds, at("scale is out of range"));
        }
        let angles = [
            (s.body_pitch, cfg.pitch.max_deg),
            (s.tail_angle, cfg.tail.max_deg),
            (s.tail_curl, cfg.tail.max_curl_deg),
            (s.ear_lag, cfg.ears.max_deg),
            (s.head_angle, cfg.limits.max_head_deg),
        ];
        if angles.iter().any(|(v, max)| v.abs() > *max) {
            return refuse(OutOfBounds, at("an angle exceeds its range of motion"));
        }
        if s.phase.before_liftoff() {
            if !s.position.bits_eq(input.start) || s.contact != ends.start_contact {
                return refuse(InvalidTarget, at("the feet left the start before liftoff"));
            }
        } else if s.phase.after_contact() {
            if !s.position.bits_eq(target) || s.contact != ends.target_contact {
                return refuse(
                    InvalidTarget,
                    at("after touchdown the feet are not on the authored target"),
                );
            }
        } else {
            let p = s.position;
            if s.contact != Contact::None || p.x < x_lo || p.x > x_hi || p.y < apex_y - 1e-6 || p.y > y_hi + 1e-6 {
                return refuse(OutOfBounds, at("the flight leaves its arc"));
            }
        }
    }

    // The window closes on the perch, at rest in the authored stance.
    let rest = input.stance.rest;
    let at_rest = last_sample.phase == MotionPhase::Perch
        && last_sample.crouch == rest.crouch
        && last_sample.tail_angle == rest.tail_deg
        && last_sample.tail_curl == rest.tail_curl
        && last_sample.tail_tension == rest.tail_tension
        && [
            last_sample.tuck,
            last_sample.compression,
            last_sample.stretch,
            last_sample.body_pitch,
            last_sample.head_angle,
            last_sample.ear_lag,
            last_sample.landing_impulse,
        ]
        .iter()
        .all(|v| *v == 0.0)
        && last_sample.velocity.x == 0.0
        && last_sample.velocity.y == 0.0;
    if !at_rest {
        return refuse(
            InvalidDuration,
            "the window closes before the body is at rest in its stance",
        );
    }
    Ok(())
}

/// The contacts are exactly two, in order: the takeoff from the start at liftoff and the landing on
/// the target at touchdown, each with a finite impulse in `[0, 1]`, the exact position and scale,
/// and the contact the terrain declares there.
fn check_events(plan: &MotionPlan, input: &MotionInput, ends: &Ends) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidDuration, InvalidTarget, NonFiniteValue, OutOfBounds};
    let [takeoff, landing] = plan.events.as_slice() else {
        return refuse(
            InvalidDuration,
            "the plan does not state exactly one takeoff and one landing",
        );
    };
    let expected = [
        (
            takeoff,
            ContactKind::Takeoff,
            plan.timing.liftoff_ms,
            input.start,
            input.start_scale,
            ends.start_contact,
        ),
        (
            landing,
            ContactKind::Landing,
            plan.timing.contact_ms,
            ends.target,
            input.target_scale,
            ends.target_contact,
        ),
    ];
    for (e, kind, at_ms, position, scale, contact) in expected {
        let ContactEvent { impulse, .. } = *e;
        if !impulse.is_finite() {
            return refuse(NonFiniteValue, format!("the {kind:?} impulse is not finite"));
        }
        if !(0.0..=1.0).contains(&impulse) {
            return refuse(OutOfBounds, format!("the {kind:?} impulse is outside [0, 1]"));
        }
        if e.kind != kind || e.at_ms.to_bits() != at_ms.to_bits() {
            return refuse(
                InvalidDuration,
                format!("the {kind:?} is not stated at its own instant"),
            );
        }
        if !e.position.bits_eq(position) || e.scale.to_bits() != scale.to_bits() || e.contact != contact {
            return refuse(InvalidTarget, format!("the {kind:?} is not where the feet are"));
        }
    }
    Ok(())
}
