//! LAND: contact, compression, settle, and the perch.
//!
//! The feet touch the target at the contact instant and never move again; what follows is the body
//! absorbing the landing. The absorption is a closed-form ease to the deepest point; the release is
//! an underdamped return (one small rebound) tapered to exactly zero, so the body arrives in its
//! authored stance bit for bit, not approximately. A perch too short for the configured settle
//! hurries it: the settle is compressed to end on the last frame the plan performs, never below
//! `landing.minSettleMs`.

use alloc::format;
use core::f64::consts::PI;

use crate::config::LandingConfig;
use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::{clamp01, cos, ease_out, exp, sin, smoothstep, sqrt};

/// Absorption: 0 at touchdown, 1 at the deepest point, arriving with zero slope.
pub fn absorb(u: f64) -> f64 {
    ease_out(u)
}

/// Taper that brings a settling response to exactly zero: 1 until 70% of the settle, then a
/// smoothstep to 0 with zero slope at the end.
pub fn settle_taper(u: f64) -> f64 {
    1.0 - smoothstep(0.7, 1.0, u)
}

/// Release from the deepest point back to the stance over `settle_s` seconds: 1 at `u = 0` with
/// zero slope, an underdamped return with one small rebound below zero (about 13% at damping
/// 0.55), then tapered to exactly 0 with zero slope at `u = 1`.
pub fn release(u: f64, settle_s: f64, freq_hz: f64, damping: f64) -> f64 {
    let u = clamp01(u);
    let t = u * settle_s;
    let w = 2.0 * PI * freq_hz;
    let wd = w * sqrt(1.0 - damping * damping);
    let a = damping * w;
    let x = exp(-a * t) * (cos(wd * t) + (a / wd) * sin(wd * t));
    x * settle_taper(u)
}

/// One landing's key instants (absolute ms) and its rebound shape.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Landing {
    /// Touchdown, exactly on the target.
    pub contact_ms: f64,
    /// End of the impact window (the Contact phase).
    pub impact_end_ms: f64,
    /// Deepest point of the absorption (end of the Compression phase).
    pub absorbed_ms: f64,
    /// Back in the stance (end of the Settle phase).
    pub settled_ms: f64,
    settle_s: f64,
    freq_hz: f64,
    damping: f64,
}

impl Landing {
    /// The landing that starts at `contact_ms`.
    pub fn new(contact_ms: f64, cfg: &LandingConfig) -> Self {
        let impact_end_ms = contact_ms + cfg.contact_ms;
        let absorbed_ms = impact_end_ms + cfg.compression_ms;
        Self {
            contact_ms,
            impact_end_ms,
            absorbed_ms,
            settled_ms: absorbed_ms + cfg.settle_ms,
            settle_s: cfg.settle_ms / 1000.0,
            freq_hz: cfg.settle_freq_hz,
            damping: cfg.settle_damping,
        }
    }

    /// The landing that starts at `contact_ms` and must be back in its stance by `hand_off_ms`, the
    /// last frame the plan performs (whatever performs the body next takes it over at rest). When the
    /// configured settle would run past it, the settle ends exactly there instead, provided that
    /// leaves at least `landing.minSettleMs`; otherwise the window is refused.
    pub fn within(contact_ms: f64, cfg: &LandingConfig, hand_off_ms: f64) -> Result<Self, MotionError> {
        let mut landing = Self::new(contact_ms, cfg);
        if landing.settled_ms > hand_off_ms {
            let settle_ms = hand_off_ms - landing.absorbed_ms;
            // Every operand is finite here (the input and config were validated), so `<` is exact.
            if settle_ms < cfg.min_settle_ms {
                return refuse(
                    MotionErrorCode::InvalidDuration,
                    format!(
                        "the window's last frame ({hand_off_ms} ms) comes before the landing at {contact_ms} ms can settle: \
                         {settle_ms} ms is left for a settle of at least {} ms",
                        cfg.min_settle_ms
                    ),
                );
            }
            landing.settled_ms = hand_off_ms;
            landing.settle_s = settle_ms / 1000.0;
        }
        Ok(landing)
    }

    /// Progress through the absorption (touchdown to the deepest point), 0..1.
    pub fn absorption(&self, t: f64) -> f64 {
        clamp01((t - self.contact_ms) / (self.absorbed_ms - self.contact_ms))
    }

    /// Progress through the impact window, 0..1.
    pub fn impact(&self, t: f64) -> f64 {
        clamp01((t - self.contact_ms) / (self.impact_end_ms - self.contact_ms))
    }

    /// Progress through the settle, 0..1.
    pub fn settling(&self, t: f64) -> f64 {
        clamp01((t - self.absorbed_ms) / (self.settled_ms - self.absorbed_ms))
    }

    /// The release curve at `t` (meaningful during the settle).
    pub fn release_at(&self, t: f64) -> f64 {
        release(self.settling(t), self.settle_s, self.freq_hz, self.damping)
    }

    /// Signed landing response: 0 before touchdown, rising to 1 at the deepest point, then the
    /// release (with its small negative rebound), and exactly 0 from the end of the settle on.
    pub fn response(&self, t: f64) -> f64 {
        if t < self.contact_ms || t >= self.settled_ms {
            0.0
        } else if t < self.absorbed_ms {
            absorb(self.absorption(t))
        } else {
            self.release_at(t)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_starts_at_one_rebounds_slightly_and_ends_exactly_at_rest() {
        let (s, f, z) = (0.7, 2.6, 0.55);
        assert_eq!(release(0.0, s, f, z), 1.0);
        assert_eq!(release(1.0, s, f, z), 0.0);
        let mut min: f64 = 1.0;
        let mut prev = 1.0;
        let mut rises = 0;
        for k in 1..=1000 {
            let v = release(f64::from(k) / 1000.0, s, f, z);
            min = min.min(v);
            if v > prev + 1e-12 {
                rises += 1;
            }
            prev = v;
        }
        assert!(min < 0.0 && min > -0.2, "one small rebound, not a bounce ({min})");
        assert!(rises > 0, "it does come back up after the rebound");
        // Zero slope at the start: the absorption arrives with zero slope too, so the hand-off is smooth.
        assert!((1.0 - release(1e-6, s, f, z)).abs() < 1e-6);
    }

    fn cfg() -> LandingConfig {
        LandingConfig {
            contact_ms: 34.0,
            compression_ms: 110.0,
            settle_ms: 700.0,
            min_settle_ms: 350.0,
            settle_freq_hz: 2.6,
            settle_damping: 0.55,
            impulse_reference_body_heights: 0.6,
            crouch_base: 0.3,
            crouch_gain: 0.32,
            compression_gain: 1.0,
            nod_deg: 5.0,
        }
    }

    #[test]
    fn a_short_perch_hurries_the_settle_onto_its_last_frame_and_no_further() {
        let c = cfg();
        // Room to spare: the configured settle, untouched.
        let free = Landing::within(1000.0, &c, 5000.0).unwrap();
        assert_eq!(free, Landing::new(1000.0, &c));
        assert_eq!(free.settled_ms, 1844.0);
        // One frame short: the settle ends exactly on the hand-off frame, at rest.
        let tight = Landing::within(1000.0, &c, 1833.0).unwrap();
        assert_eq!(tight.settled_ms, 1833.0);
        assert_eq!(tight.response(1833.0), 0.0, "at rest on the hand-off frame");
        assert_eq!(tight.release_at(1833.0), 0.0);
        assert!(tight.response(1700.0) != 0.0, "control: still settling before it");
        // Down to the floor, and not past it.
        assert!(Landing::within(1000.0, &c, 1144.0 + 350.0).is_ok());
        let refused = Landing::within(1000.0, &c, 1144.0 + 349.0).unwrap_err();
        assert_eq!(refused.code, MotionErrorCode::InvalidDuration);
    }
}
