//! HOP: a ballistic arc from a fixed start to the fixed authored target, chosen to keep the scene's
//! text readable.
//!
//! Timing, trajectory, and the surface-aware arc search are a faithful port of the TypeScript
//! solver (`planHop` in `src/character/walletwallaby/motion.ts`), evaluated with the same IEEE-754
//! operations in the same order. That makes the transitional TypeScript solver an exact oracle for
//! this module: the same arc, the same liftoff and contact instants, and bit-identical flight
//! positions.
//!
//! The arc is `y(s) = y0 + (y1 - y0)s - c·s(1 - s)` with constant horizontal velocity, `s` going
//! from 0 at liftoff to 1 at contact. At `s = 1` it is exactly the target.
//!
//! Surface awareness: when the scene protects text, the solver tries a fixed list of apex heights
//! ([`ARC_CANDIDATES`], fractions of the natural one: natural first, then lower, then higher),
//! counts the flight samples whose figure box crosses protected text ([`FLIGHT_SAMPLES`] per
//! flight), and keeps the arc that crosses least; ties go to the earlier, more natural candidate,
//! and the first arc that crosses nothing ends the search. A higher arc keeps its height and fits
//! the window with stronger gravity; any other arc is lowered further before gravity is raised. The
//! search can only lower or raise the arc: whichever it keeps lands exactly on the target.

use alloc::format;

use crate::config::MotionConfig;
use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::{Vec2, clamp, lerp, sqrt};
use crate::terrain::{FigureBox, Rect};

/// Candidate apex heights, as fractions of the natural one: natural first, then lower, then higher.
pub const ARC_CANDIDATES: [f64; 11] = [1.0, 0.75, 0.5, 0.35, 0.22, 0.12, 0.05, 1.3, 1.65, 2.2, 3.0];
/// A flight is tested against the protected text at `k / FLIGHT_SAMPLES` for `k` in `1..FLIGHT_SAMPLES`.
pub const FLIGHT_SAMPLES: u32 = 32;

/// Share of the window the preload may take (TypeScript v2: 0.3).
const ANTICIPATION_WINDOW_FRAC: f64 = 0.3;
/// A flight shorter than this share of the window is refused (TypeScript v2: 0.5).
const MIN_FLIGHT_WINDOW_FRAC: f64 = 0.5;
/// Share of the spare time spent orienting (TypeScript v2: 0.35).
const ORIENT_SPARE_FRAC: f64 = 0.35;
/// Most extra preload taken from spare time, ms (TypeScript v2: 80).
const EXTRA_ANTICIPATION_MAX_MS: f64 = 80.0;
/// Share of the spare time added to the preload (TypeScript v2: 0.2).
const EXTRA_ANTICIPATION_SPARE_FRAC: f64 = 0.2;

/// One hop's fixed endpoints, its window `[start_ms, arrive_by_ms)`, and what it should not cross.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HopRequest<'a> {
    /// Start, px.
    pub from: Vec2,
    /// Authored target, px.
    pub to: Vec2,
    /// Scale at the start.
    pub from_scale: f64,
    /// Scale at the target.
    pub to_scale: f64,
    /// Window start, ms.
    pub start_ms: f64,
    /// Arrival deadline, ms.
    pub arrive_by_ms: f64,
    /// Text the figure should not cross in flight; empty flies the natural arc.
    pub protected_text: &'a [Rect],
    /// The figure's layout box at scale 1.
    pub figure: FigureBox,
}

/// The solved hop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HopSolution {
    /// End of the orient, ms.
    pub orient_end_ms: f64,
    /// The feet leave the start, ms.
    pub liftoff_ms: f64,
    /// The feet touch the target, ms.
    pub contact_ms: f64,
    /// Parabola depth, px.
    pub depth_px: f64,
    /// Effective gravity, px/s².
    pub gravity_px: f64,
    /// Configured gravity at this scale, px/s².
    pub base_gravity_px: f64,
    /// Apex height above the higher endpoint, px.
    pub apex_above_px: f64,
    /// Body height at the mean scale, px.
    pub body_px: f64,
    /// The candidate the search kept: its apex as a fraction of the natural one.
    pub arc_fraction: f64,
    /// Flight samples (of [`FLIGHT_SAMPLES`]) whose figure box crosses protected text.
    pub text_crossings: u32,
}

/// One candidate arc fitted to the window: its depth, the gravity it needs, and its flight time.
#[derive(Clone, Copy, Debug, PartialEq)]
struct ArcFit {
    depth: f64,
    gravity: f64,
    flight_s: f64,
}

/// What every candidate of one hop shares.
struct Candidates<'a> {
    r: &'a HopRequest<'a>,
    cfg: &'a MotionConfig,
    /// Configured gravity at the mean scale, px/s².
    g0: f64,
    /// Horizontal distance, px.
    dx: f64,
    /// Flight-time budget, s.
    budget_s: f64,
    /// Horizontal speed limit, px/s.
    max_speed: f64,
}

impl Candidates<'_> {
    /// The arc whose apex sits `apex` px above the higher endpoint, fitted to the window, or `None`
    /// when no gravity within its bound and no flight within the speed limit fits it (the
    /// TypeScript `solve`, operation for operation). `keep_height`: a deliberately higher arc keeps
    /// its height and fits the window with stronger gravity instead of being lowered.
    fn fit(&self, apex: f64, keep_height: bool) -> Option<ArcFit> {
        let (r, cfg) = (self.r, self.cfg);
        let budget_s = self.budget_s;
        let mut gravity = self.g0;
        let mut depth = arc_depth(r.from.y, r.to.y, apex);
        let mut flight_s = sqrt((2.0 * depth) / gravity);
        if flight_s > budget_s && keep_height {
            gravity = (2.0 * depth) / (budget_s * budget_s);
            if gravity > self.g0 * cfg.max_gravity_boost {
                return None;
            }
            flight_s = budget_s;
        } else if flight_s > budget_s {
            // Lower the arc to fit; then, only if even the lowest arc is too slow, raise gravity.
            depth = arc_depth(r.from.y, r.to.y, 0.0).max(gravity * budget_s * budget_s / 2.0);
            flight_s = sqrt((2.0 * depth) / gravity);
            if flight_s > budget_s {
                gravity = (2.0 * depth) / (budget_s * budget_s);
                if gravity > self.g0 * cfg.max_gravity_boost {
                    return None;
                }
                flight_s = budget_s;
            }
        }
        if self.dx.abs() / flight_s > self.max_speed {
            // A higher arc buys flight time, never past the window.
            let need_s = self.dx.abs() / self.max_speed;
            if need_s > budget_s {
                return None;
            }
            depth = depth.max(gravity * need_s * need_s / 2.0);
            flight_s = sqrt((2.0 * depth) / gravity);
        }
        let min_flight_ms = cfg.hop.min_flight_ms;
        if flight_s * 1000.0 < min_flight_ms && min_flight_ms / 1000.0 <= budget_s {
            flight_s = min_flight_ms / 1000.0;
            depth = gravity * flight_s * flight_s / 2.0;
        }
        (depth.is_finite() && flight_s.is_finite() && flight_s > 0.0).then_some(ArcFit {
            depth,
            gravity,
            flight_s,
        })
    }

    /// Flight samples whose figure box crosses protected text (the TypeScript `crossings`).
    fn crossings(&self, arc: &ArcFit) -> u32 {
        let r = self.r;
        let mut n = 0;
        for k in 1..FLIGHT_SAMPLES {
            let u = f64::from(k) / f64::from(FLIGHT_SAMPLES);
            let figure = r
                .figure
                .at(feet_at(r.from, r.to, arc.depth, u), lerp(r.from_scale, r.to_scale, u));
            if r.protected_text.iter().any(|text| figure.intersects(text)) {
                n += 1;
            }
        }
        n
    }
}

impl HopSolution {
    /// Flight duration as the samples see it (contact minus liftoff), seconds.
    pub fn flight_s(&self) -> f64 {
        (self.contact_ms - self.liftoff_ms) / 1000.0
    }
}

/// Depth `c` of the parabola whose apex sits `h` px above the higher endpoint (y grows downward).
pub fn arc_depth(y0: f64, y1: f64, h: f64) -> f64 {
    let d = y1 - y0;
    let k = y0 - y0.min(y1) + h;
    d + 2.0 * k + 2.0 * sqrt(k * (k + d))
}

/// Solve a hop that leaves `from` and lands exactly on `to` inside the window. The natural apex
/// grows with distance; with protected text, the surface-aware search picks among
/// [`ARC_CANDIDATES`] (see the module docs). A candidate that cannot fit is lowered first, then
/// fitted with gravity raised up to its bound; when no candidate fits, the hop is refused. Every hop
/// touches down at least `hop.settleReserveMs` before the deadline.
pub fn solve_hop(r: &HopRequest<'_>, cfg: &MotionConfig) -> Result<HopSolution, MotionError> {
    let hop = &cfg.hop;
    let dur = r.arrive_by_ms - r.start_ms;
    let scale = (r.from_scale + r.to_scale) / 2.0;
    let body = cfg.body_height_px * scale;
    let g0 = cfg.gravity_body_heights_per_s2 * body;
    let dx = r.to.x - r.from.x;
    let d = r.to.y - r.from.y;
    let anticipation = hop.anticipation_ms.min(dur * ANTICIPATION_WINDOW_FRAC);
    let budget_s = (dur - anticipation - hop.settle_reserve_ms) / 1000.0;
    // Every operand is finite here (the input and config were validated), so `<` is exact.
    if budget_s * 1000.0 < hop.min_flight_ms.min(dur * MIN_FLIGHT_WINDOW_FRAC) {
        return refuse(
            MotionErrorCode::InvalidDuration,
            format!("a hop window of {dur} ms leaves no time to fly"),
        );
    }
    let natural = clamp(
        hop.peak_base * body + hop.peak_per_px * dx.abs(),
        hop.peak_min * body,
        hop.peak_max * body,
    );
    let candidates = Candidates {
        r,
        cfg,
        g0,
        dx,
        budget_s,
        max_speed: cfg.max_speed_body_heights_per_s * body,
    };
    // Without protected text there is nothing to avoid: the natural arc only.
    let fractions = if r.protected_text.is_empty() {
        &ARC_CANDIDATES[..1]
    } else {
        &ARC_CANDIDATES[..]
    };
    let mut best: Option<(ArcFit, u32, f64)> = None;
    for &fraction in fractions {
        let Some(arc) = candidates.fit((hop.peak_max * body).min(natural * fraction), fraction > 1.0) else {
            continue;
        };
        let n = candidates.crossings(&arc);
        if best.is_none_or(|(_, fewest, _)| n < fewest) {
            best = Some((arc, n, fraction));
            if n == 0 {
                break;
            }
        }
    }
    let Some((
        ArcFit {
            depth,
            gravity,
            flight_s,
        },
        text_crossings,
        arc_fraction,
    )) = best
    else {
        return refuse(
            MotionErrorCode::UnsolvableTrajectory,
            format!(
                "a hop of {dx} px across and {d} px down cannot land within {dur} ms under the speed and gravity limits"
            ),
        );
    };

    let flight_ms = flight_s * 1000.0;
    let spare = (dur - anticipation - flight_ms).max(0.0);
    let orient = hop.orient_max_ms.min(spare * ORIENT_SPARE_FRAC);
    let extra = EXTRA_ANTICIPATION_MAX_MS.min(spare * EXTRA_ANTICIPATION_SPARE_FRAC);
    let liftoff_ms = r.start_ms + orient + anticipation + extra;
    let contact_ms = (liftoff_ms + flight_ms).min(r.arrive_by_ms);
    let s_star = clamp((1.0 - d / depth) / 2.0, 0.0, 1.0);
    let apex_y = r.from.y + d * s_star - depth * s_star * (1.0 - s_star);
    let apex_above_px = r.from.y.min(r.to.y) - apex_y;
    if apex_above_px > cfg.limits.max_apex_body_heights * body {
        return refuse(
            MotionErrorCode::UnsolvableTrajectory,
            format!(
                "the only arc that fits rises {apex_above_px} px, above the {} body-height limit",
                cfg.limits.max_apex_body_heights
            ),
        );
    }
    Ok(HopSolution {
        orient_end_ms: r.start_ms + orient,
        liftoff_ms,
        contact_ms,
        depth_px: depth,
        gravity_px: gravity,
        base_gravity_px: g0,
        apex_above_px,
        body_px: body,
        arc_fraction,
        text_crossings,
    })
}

/// Feet position at flight fraction `s` (0 at liftoff, 1 at contact): the same expressions, in the
/// same order, as the TypeScript oracle. Exactly `to` at `s = 1`.
pub fn feet_at(from: Vec2, to: Vec2, depth: f64, s: f64) -> Vec2 {
    let d = to.y - from.y;
    Vec2::new(lerp(from.x, to.x, s), from.y + d * s - depth * s * (1.0 - s))
}

/// Feet velocity at flight fraction `s`, px/s (`flight_s` = contact minus liftoff, seconds).
pub fn velocity_at(from: Vec2, to: Vec2, depth: f64, s: f64, flight_s: f64) -> Vec2 {
    let d = to.y - from.y;
    Vec2::new((to.x - from.x) / flight_s, (d - depth * (1.0 - 2.0 * s)) / flight_s)
}

/// Normalised push-off and touchdown impulses, 0..1: vertical speed at each end of the flight
/// over the touchdown speed of a fall from `impulse_reference_body_heights` (TypeScript v2 events).
pub fn impulses(sol: &HopSolution, from: Vec2, to: Vec2, cfg: &MotionConfig) -> (f64, f64) {
    let v_ref = sqrt(2.0 * sol.gravity_px * cfg.landing.impulse_reference_body_heights * sol.body_px);
    let t = sol.flight_s();
    let d = to.y - from.y;
    let takeoff = clamp(((d - sol.depth_px) / t).abs() / v_ref, 0.0, 1.0);
    let landing = clamp(((d + sol.depth_px) / t) / v_ref, 0.0, 1.0);
    (takeoff, landing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_arc_formula_puts_the_apex_where_asked() {
        for (y0, y1, h) in [(600.0, 600.0, 40.0), (600.0, 400.0, 30.0), (400.0, 600.0, 25.0)] {
            let c = arc_depth(y0, y1, h);
            let s = (1.0 - (y1 - y0) / c) / 2.0;
            let apex = y0 + (y1 - y0) * s - c * s * (1.0 - s);
            assert!((y0.min(y1) - apex - h).abs() < 1e-9, "{y0}->{y1} h{h}");
        }
    }

    #[test]
    fn the_flight_ends_exactly_on_the_target() {
        let (from, to) = (Vec2::new(1050.0, 370.0), Vec2::new(1600.0, 600.0));
        for depth in [0.5, 23.39, 403.5360645205965, 1640.0] {
            assert!(feet_at(from, to, depth, 1.0).bits_eq(to), "depth {depth}");
            assert!(feet_at(from, to, depth, 0.0).bits_eq(from), "depth {depth}");
        }
    }
}
