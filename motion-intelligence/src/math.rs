//! Deterministic arithmetic.
//!
//! Every transcendental function goes through the pure-Rust `libm` crate, never the platform's C
//! library, so a native build and the wasm32 artifact compute bit-identical results from identical
//! inputs. Basic operations (`+ - * /`) are IEEE-754 binary64, correctly rounded on every
//! supported target, and the compiler never fuses or reorders them (no fast-math, no FMA
//! contraction). `clippy.toml` refuses the `f64` methods that would bypass this module.

use serde::{Deserialize, Serialize};

/// A point or vector in frame pixels (y grows downward, as on screen).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vec2 {
    /// Horizontal, px.
    pub x: f64,
    /// Vertical, px, downward.
    pub y: f64,
}

impl Vec2 {
    /// The origin.
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    /// `(x, y)`.
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// Both components are finite.
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }

    /// Bit-for-bit equality (distinguishes `0.0` from `-0.0`; used for the exact-destination
    /// guarantees, where "close" is not good enough).
    pub fn bits_eq(self, other: Vec2) -> bool {
        self.x.to_bits() == other.x.to_bits() && self.y.to_bits() == other.y.to_bits()
    }
}

/// `a + (b - a) * t`: the same expression, evaluated in the same order, as the TypeScript `lerp`,
/// so the ported trajectory is bit-identical to the transitional TypeScript oracle.
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// `v` limited to `[lo, hi]` (same semantics as the TypeScript `clamp`).
pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

/// `v` limited to `[0, 1]`.
pub fn clamp01(v: f64) -> f64 {
    clamp(v, 0.0, 1.0)
}

/// Hermite smoothstep between `edge0` and `edge1`: 0 below, 1 above, zero slope at both edges.
pub fn smoothstep(edge0: f64, edge1: f64, v: f64) -> f64 {
    let t = clamp01((v - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

/// Cubic ease-in-out on `[0, 1]`.
pub fn ease_in_out(t: f64) -> f64 {
    let c = clamp01(t);
    if c < 0.5 {
        4.0 * c * c * c
    } else {
        let k = -2.0 * c + 2.0;
        1.0 - k * k * k / 2.0
    }
}

/// Cubic ease-out on `[0, 1]`: fast start, zero slope at 1.
pub fn ease_out(t: f64) -> f64 {
    let k = 1.0 - clamp01(t);
    1.0 - k * k * k
}

/// Square root (correctly rounded).
pub fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}

/// Sine (libm).
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

/// Cosine (libm).
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

/// `e^x` (libm).
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

/// Two-argument arctangent (libm).
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// `x^y` (libm).
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// Largest integer not above `x` (exact).
pub fn floor(x: f64) -> f64 {
    libm::floor(x)
}

/// Smallest integer not below `x` (exact).
pub fn ceil(x: f64) -> f64 {
    libm::ceil(x)
}

/// `0.0` for either zero, otherwise `x`: serialized plans never carry a negative zero.
pub fn positive_zero(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { x }
}

/// A bounded range of motion: exactly the identity for `|x| <= knee * limit`, then an exponential
/// approach toward `limit`. Continuous with a continuous slope, odd, and never past `limit` (it
/// only rounds onto it for absurdly large inputs). This is a declared part of the output contract
/// (a tail or an ear has a physical range), never a repair of invalid input.
pub fn soft_limit(x: f64, limit: f64, knee: f64) -> f64 {
    let k = limit * knee;
    let a = x.abs();
    if a <= k {
        return x;
    }
    let span = limit - k;
    let y = limit - span * exp(-(a - k) / span);
    if x < 0.0 { -y } else { y }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lerp_matches_the_typescript_expression() {
        // a + (b - a) * t, evaluated left to right; exact at both ends.
        assert_eq!(lerp(1050.0, 1600.0, 0.0), 1050.0);
        assert_eq!(lerp(1050.0, 1600.0, 1.0), 1600.0);
        assert_eq!(lerp(-3.0, 5.0, 0.25), -1.0);
    }

    #[test]
    fn soft_limit_is_exact_inside_the_knee_and_bounded_outside() {
        assert_eq!(soft_limit(12.5, 30.0, 0.75), 12.5);
        assert_eq!(soft_limit(-22.5, 30.0, 0.75), -22.5);
        for x in [23.0, 40.0, 1e3, 1e9, f64::MAX] {
            let y = soft_limit(x, 30.0, 0.75);
            // Far out, exp underflows and the result rounds to the limit itself: never past it.
            assert!(y > 22.5 && y <= 30.0, "{x} -> {y}");
            assert_eq!(soft_limit(-x, 30.0, 0.75), -y, "odd");
        }
        assert!(
            soft_limit(40.0, 30.0, 0.75) < 30.0,
            "strictly inside for any plausible swing"
        );
        // Continuous slope at the knee: the one-sided difference quotients agree.
        let h = 1e-6;
        let inside = (soft_limit(22.5, 30.0, 0.75) - soft_limit(22.5 - h, 30.0, 0.75)) / h;
        let outside = (soft_limit(22.5 + h, 30.0, 0.75) - soft_limit(22.5, 30.0, 0.75)) / h;
        assert!((inside - outside).abs() < 1e-5);
    }

    #[test]
    fn eases_start_and_end_exactly() {
        for f in [ease_in_out, ease_out] {
            assert_eq!(f(0.0), 0.0);
            assert_eq!(f(1.0), 1.0);
            assert_eq!(f(-1.0), 0.0);
            assert_eq!(f(2.0), 1.0);
        }
        assert_eq!(smoothstep(0.7, 1.0, 0.7), 0.0);
        assert_eq!(smoothstep(0.7, 1.0, 1.0), 1.0);
    }
}
