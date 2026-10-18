//! Tail Motion Intelligence: the tail responds to the body's motion instead of playing a canned
//! animation.
//!
//! ```text
//! body motion -> desired counterbalance -> bounded damped response -> tail pose (swing, curl, tension)
//! ```
//!
//! The tail is a biological counterweight, not equipment. On the ground it presses down against
//! the surface as a third support when the legs load. In the air it counter-rotates against the
//! body's pitch and streams with the vertical motion, so it sweeps down to meet the ground before
//! the feet arrive. At touchdown it whips on down, braces, and relaxes. A damped second-order
//! follower turns the desired swing into the tail's actual swing (it lags, overshoots a little,
//! and settles); a soft range of motion bounds it. Curl and tension follow their own targets with
//! a first-order lag, for a renderer that stiffens the tail into a lever or relaxes it into a curve.
//!
//! Angles use the Rive rig's convention: a positive swing raises the tip; a positive curl curls
//! the tip up.

use core::f64::consts::PI;

use crate::config::TailConfig;
use crate::math::clamp01;
use crate::state::MotionPhase;

/// What the body is doing at one instant, as the tail feels it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TailSignals {
    /// The authored resting swing at this moment (blends from the initial to the rest stance across
    /// the flight), degrees.
    pub stance_deg: f64,
    /// Leg bend beyond the stance while the feet are on a surface, 0..1 (0 in the air).
    pub leg_load: f64,
    /// Whole-body pitch, degrees (positive = nose down).
    pub pitch_deg: f64,
    /// Vertical speed of the body, body heights per second (positive = rising).
    pub rise_body_per_s: f64,
    /// Touchdown envelope: the landing impulse through the impact window, else 0.
    pub impact: f64,
    /// 1 while airborne, else 0.
    pub airborne: f64,
}

/// The swing the tail would take if it could move instantly, degrees (positive raises the tip).
/// With the body at rest in its stance, this is exactly the stance's swing.
pub fn desired_counterbalance(s: &TailSignals, cfg: &TailConfig) -> f64 {
    s.stance_deg
        // A loaded body presses its tail down against the surface as a third support.
        - cfg.load_deg * s.leg_load
        // Counter-rotation against the body's pitch: nose up lifts the tail, nose down lowers it.
        - cfg.pitch_counter * s.pitch_deg
        // It streams with the vertical motion: rising carries the tip up, falling sweeps it down.
        + cfg.lift_deg * s.rise_body_per_s
        // Touchdown whips it on down before the brace takes over.
        - cfg.impact_deg * s.impact
}

/// The curl the tail is heading toward, degrees per segment: a loose curl in the air, flattened
/// against the ground under load.
pub fn desired_curl(s: &TailSignals, cfg: &TailConfig) -> f64 {
    cfg.curl_flight_deg * s.airborne - cfg.curl_load_deg * s.leg_load
}

/// A damped spring pulling `x` toward a target, integrated with semi-implicit Euler on a fixed
/// step. Deterministic: the same targets in the same order give the same states.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Follower {
    /// Position (degrees for the tail and ears).
    pub x: f64,
    /// Velocity, per second.
    pub v: f64,
}

impl Follower {
    /// At rest at `x`.
    pub fn at_rest(x: f64) -> Self {
        Self { x, v: 0.0 }
    }

    /// Advance one step of `dt_s` seconds toward `target`. A follower at rest on its target stays
    /// exactly there.
    pub fn step(&mut self, target: f64, freq_hz: f64, damping: f64, dt_s: f64) {
        let w = 2.0 * PI * freq_hz;
        let accel = w * w * (target - self.x) - 2.0 * damping * w * self.v;
        self.v += accel * dt_s;
        self.x += self.v * dt_s;
    }
}

/// How hard the tail works in each phase before effort is added, 0..1.
pub fn base_tension(phase: MotionPhase, cfg: &TailConfig) -> f64 {
    match phase {
        MotionPhase::Idle | MotionPhase::Settle | MotionPhase::Perch => cfg.tension_rest,
        MotionPhase::Preload => cfg.tension_load,
        MotionPhase::Takeoff => cfg.tension_lever,
        MotionPhase::Airborne => cfg.tension_flight,
        MotionPhase::Contact | MotionPhase::Compression => cfg.tension_brace,
    }
}

/// Tension the tail is heading toward: the phase's base plus effort (how far the tail lags its
/// desired swing and how fast it is swinging), within 0..1. At rest it is exactly the base.
pub fn tension_target(phase: MotionPhase, desired: f64, tail: &Follower, cfg: &TailConfig) -> f64 {
    let lag = (desired - tail.x).abs() / cfg.max_deg;
    let swing = tail.v.abs() / (2.0 * PI * cfg.freq_hz * cfg.max_deg);
    clamp01(base_tension(phase, cfg) + cfg.tension_effort * (lag + swing))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> TailConfig {
        TailConfig {
            freq_hz: 2.4,
            damping: 0.45,
            load_deg: 8.0,
            pitch_counter: 0.9,
            lift_deg: 1.4,
            impact_deg: 6.0,
            max_deg: 30.0,
            curl_flight_deg: 1.5,
            curl_load_deg: 1.5,
            max_curl_deg: 6.0,
            tension_rest: 0.1,
            tension_load: 0.5,
            tension_lever: 0.85,
            tension_flight: 0.55,
            tension_brace: 0.8,
            tension_effort: 0.5,
            tension_follow_ms: 80.0,
        }
    }

    const STILL: TailSignals = TailSignals {
        stance_deg: 0.0,
        leg_load: 0.0,
        pitch_deg: 0.0,
        rise_body_per_s: 0.0,
        impact: 0.0,
        airborne: 0.0,
    };

    #[test]
    fn at_rest_in_its_stance_the_tail_holds_the_stance_exactly() {
        let still = TailSignals {
            stance_deg: 2.0,
            ..STILL
        };
        assert_eq!(desired_counterbalance(&still, &cfg()), 2.0);
        assert_eq!(desired_curl(&still, &cfg()), 0.0);
        let mut f = Follower::at_rest(2.0);
        for _ in 0..1000 {
            f.step(2.0, 2.4, 0.45, 0.001);
        }
        assert_eq!(f, Follower::at_rest(2.0));
        assert_eq!(tension_target(MotionPhase::Idle, 2.0, &f, &cfg()), 0.1);
    }

    #[test]
    fn the_tail_counterbalances_the_body() {
        let c = cfg();
        let swing = |s: TailSignals| desired_counterbalance(&s, &c);
        assert!(
            swing(TailSignals {
                pitch_deg: -6.0,
                ..STILL
            }) > 0.0,
            "nose up lifts the tail"
        );
        assert!(
            swing(TailSignals {
                pitch_deg: 6.0,
                ..STILL
            }) < 0.0,
            "nose down lowers it"
        );
        assert!(
            swing(TailSignals { leg_load: 1.0, ..STILL }) < 0.0,
            "loaded legs press it down"
        );
        assert!(
            swing(TailSignals {
                rise_body_per_s: 3.0,
                ..STILL
            }) > 0.0,
            "rising carries the tip up"
        );
        assert!(
            swing(TailSignals {
                rise_body_per_s: -6.0,
                ..STILL
            }) < 0.0,
            "falling sweeps it down"
        );
        assert!(
            swing(TailSignals { impact: 1.0, ..STILL }) < 0.0,
            "touchdown whips it down"
        );
        assert!(
            desired_curl(&TailSignals { airborne: 1.0, ..STILL }, &c) > 0.0,
            "a loose curl in the air"
        );
        assert!(
            desired_curl(&TailSignals { leg_load: 1.0, ..STILL }, &c) < 0.0,
            "flattened under load"
        );
    }

    #[test]
    fn the_follower_lags_overshoots_a_little_and_settles() {
        let mut f = Follower::at_rest(0.0);
        let mut peak: f64 = 0.0;
        for _ in 0..3000 {
            f.step(10.0, 2.4, 0.45, 0.001);
            peak = peak.max(f.x);
        }
        assert!(peak > 10.0 && peak < 12.5, "a small overshoot ({peak})");
        assert!((f.x - 10.0).abs() < 0.05, "settled ({})", f.x);
    }
}
