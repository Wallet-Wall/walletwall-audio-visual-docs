//! The versioned physics configuration (`config/motion-intelligence.json`).
//!
//! Lengths are in body heights (the rig's standing height times the character's scale), so a near
//! and a far WalletWallaby move alike; times are in milliseconds; angles in degrees. Every number
//! is checked against an inclusive range and refused, never clamped, when it falls outside.

use alloc::format;
use alloc::string::String;
use serde::{Deserialize, Serialize};

use crate::CONFIG_SCHEMA;
use crate::error::{MotionError, MotionErrorCode, refuse};

/// The complete engine configuration. Unknown fields are refused at parse time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionConfig {
    /// Must be [`CONFIG_SCHEMA`].
    pub schema: String,
    /// Lowercase slug naming this configuration.
    pub id: String,
    /// Positive integer; any change to a value requires a new version.
    pub version: u32,
    /// Free-text note for reviewers (not read by the engine).
    pub note: String,
    /// Rig standing height at scale 1, px (feet to ear tips).
    pub body_height_px: f64,
    /// Gravity in body heights per second squared.
    pub gravity_body_heights_per_s2: f64,
    /// How far gravity may be raised to fit a window (multiple of the base gravity).
    pub max_gravity_boost: f64,
    /// Horizontal speed limit, body heights per second.
    pub max_speed_body_heights_per_s: f64,
    /// Preload, takeoff, and flight.
    pub hop: HopConfig,
    /// Contact, compression, and settle.
    pub landing: LandingConfig,
    /// Body pitch and head stabilisation.
    pub pitch: PitchConfig,
    /// Tail counterbalance.
    pub tail: TailConfig,
    /// Ear follow-through.
    pub ears: EarConfig,
    /// What a body can stand on, grip, or brace against ([`crate::support`]).
    pub support: SupportConfig,
    /// Hard limits on windows and arcs.
    pub limits: Limits,
}

/// Preload, takeoff, and the ballistic flight.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HopConfig {
    /// Natural apex at zero distance, body heights.
    pub peak_base: f64,
    /// Natural apex added per px of horizontal distance, body heights per px.
    pub peak_per_px: f64,
    /// Lowest natural apex, body heights.
    pub peak_min: f64,
    /// Highest natural apex, body heights.
    pub peak_max: f64,
    /// Preload (anticipation) budget, ms.
    pub anticipation_ms: f64,
    /// Share of the preload spent holding the loaded bottom.
    pub anticipation_hold_frac: f64,
    /// Longest orient (turn toward the target) before the preload, ms.
    pub orient_max_ms: f64,
    /// Shortest flight, ms.
    pub min_flight_ms: f64,
    /// Every hop touches down at least this long before its arrival deadline, ms.
    pub settle_reserve_ms: f64,
    /// Ground push-off (the Takeoff phase), carved from the end of the preload, ms.
    pub push_ms: f64,
    /// Body squash at the bottom of the preload, 0..1.
    pub preload_squash: f64,
    /// Share of the flight over which the takeoff extension relaxes.
    pub extension_frac: f64,
    /// Apex height (body heights) at which a takeoff earns full extension; lower skims extend less.
    pub extension_reference_body_heights: f64,
    /// Leg bend while airborne, 0..1.
    pub airborne_crouch: f64,
}

/// Contact, compression, and settle.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LandingConfig {
    /// Impact window right after touchdown (the Contact phase), ms.
    pub contact_ms: f64,
    /// Absorption down to the deepest point (the Compression phase), ms.
    pub compression_ms: f64,
    /// Rebound and return to the stance (the Settle phase), ms.
    pub settle_ms: f64,
    /// Shortest settle a short perch may hurry the settle to, ms: a window whose last frame leaves
    /// less after the absorption is refused.
    pub min_settle_ms: f64,
    /// Natural frequency of the settle rebound, Hz.
    pub settle_freq_hz: f64,
    /// Damping ratio of the settle rebound (underdamped: one small rebound).
    pub settle_damping: f64,
    /// Fall height, body heights, whose touchdown speed is landing impulse 1.
    pub impulse_reference_body_heights: f64,
    /// Leg bend every landing adds to the stance, 0..1.
    pub crouch_base: f64,
    /// Leg bend added per unit landing impulse.
    pub crouch_gain: f64,
    /// Body squash per unit landing impulse.
    pub compression_gain: f64,
    /// Head nod per unit landing impulse, degrees (positive = chin down).
    pub nod_deg: f64,
}

/// Body pitch and head stabilisation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PitchConfig {
    /// Largest whole-body pitch, degrees.
    pub max_deg: f64,
    /// How strongly the flight direction drives the pitch.
    pub velocity_gain: f64,
    /// Share of the body pitch the head counter-rotates to keep the gaze steady.
    pub head_stabilization: f64,
}

/// Tail counterbalance: body motion -> desired swing -> bounded damped response. Angles use the
/// rig's convention: a positive swing raises the tip, a positive curl curls it up.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TailConfig {
    /// Natural frequency of the tail's response, Hz.
    pub freq_hz: f64,
    /// Damping ratio of the tail's response.
    pub damping: f64,
    /// Tail pressed down against the surface per unit of leg load beyond the stance, degrees.
    pub load_deg: f64,
    /// Tail counter-rotation per degree of body pitch.
    pub pitch_counter: f64,
    /// Swing per body height per second of vertical speed (rising lifts the tip), degrees.
    pub lift_deg: f64,
    /// Downward whip at touchdown per unit landing impulse, degrees.
    pub impact_deg: f64,
    /// Range of motion of the swing, degrees (a soft limit).
    pub max_deg: f64,
    /// Curl while airborne, degrees per segment.
    pub curl_flight_deg: f64,
    /// Curl flattened per unit of leg load, degrees per segment.
    pub curl_load_deg: f64,
    /// Range of the curl, degrees per segment (a soft limit).
    pub max_curl_deg: f64,
    // There is no resting tension here: a body standing in a stance holds that stance's own tension
    // (`stance.*.tailTension` in the input), so the curl and tension of a perch come from the lesson.
    /// Tension while loading the preload, 0..1.
    pub tension_load: f64,
    /// Tension as a lever at takeoff, 0..1.
    pub tension_lever: f64,
    /// Tension while airborne, 0..1.
    pub tension_flight: f64,
    /// Tension bracing the landing, 0..1.
    pub tension_brace: f64,
    /// Extra tension per unit of tracking effort.
    pub tension_effort: f64,
    /// Time constant of the tension's response, ms.
    pub tension_follow_ms: f64,
}

/// Ear follow-through.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EarConfig {
    /// Natural frequency, Hz.
    pub freq_hz: f64,
    /// Damping ratio.
    pub damping: f64,
    /// Ear swing per g of forward acceleration, degrees (they lag: back on takeoff, forward on landing).
    pub accel_gain_deg: f64,
    /// Range of motion, degrees (a soft limit).
    pub max_deg: f64,
}

/// Support geometry, body heights unless named otherwise: the same section, with the same values and
/// ranges, as the transitional TypeScript planner's `config/motion.json` `support`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SupportConfig {
    /// Both feet's span behind the stand point (heels sprung back).
    pub footprint_back_body_heights: f64,
    /// Both feet's span ahead of the stand point (toes).
    pub footprint_front_body_heights: f64,
    /// The projected centre of mass, ahead of the stand point.
    pub com_ahead_body_heights: f64,
    /// Least distance from the centre of mass to the top's nearer end, holding a perch.
    pub com_margin_body_heights: f64,
    /// Least such distance touching down on the way.
    pub step_com_margin_body_heights: f64,
    /// A top narrower than this holds only an explicitly authored narrow perch.
    pub narrow_width_body_heights: f64,
    /// Broad support is at least this wide ...
    pub broad_width_body_heights: f64,
    /// ... with at least this much top beyond each foot, and the tail resting on it.
    pub broad_margin_body_heights: f64,
    /// Where the resting tail tip comes down, behind the stand point.
    pub tail_reach_body_heights: f64,
    /// How far above the top the feet reach: no protected text may sit there.
    pub contact_height_body_heights: f64,
    /// The shoulder's height above the stand point.
    pub shoulder_height_body_heights: f64,
    /// The shoulder's offset ahead of the stand point.
    pub shoulder_ahead_body_heights: f64,
    /// How far a hand reaches from the shoulder.
    pub arm_reach_body_heights: f64,
    /// A top thinner than this is a drawn line, not a solid, px.
    pub min_thickness_px: f64,
    /// How close a point must be to a surface to be on it, px.
    pub tolerance_px: f64,
}

/// Hard limits.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Limits {
    /// Range of the head's counter-rotation and nod, degrees (a soft limit).
    pub max_head_deg: f64,
    /// Longest window one plan may cover, ms.
    pub max_window_ms: f64,
    /// Highest apex any solved arc may reach above its higher endpoint, body heights.
    pub max_apex_body_heights: f64,
}

/// One range check: finite, then inside `[lo, hi]`.
fn within(path: &str, v: f64, lo: f64, hi: f64) -> Result<(), MotionError> {
    if !v.is_finite() {
        return refuse(MotionErrorCode::NonFiniteValue, format!("config.{path} is not finite"));
    }
    if v < lo || v > hi {
        return refuse(
            MotionErrorCode::InvalidConfig,
            format!("config.{path}={v} is outside [{lo}, {hi}]"),
        );
    }
    Ok(())
}

impl SupportConfig {
    /// Refuse any value that is non-finite, outside its range, or inconsistent with another.
    pub fn validate(&self) -> Result<(), MotionError> {
        use MotionErrorCode::InvalidConfig;
        let s = self;
        within(
            "support.footprintBackBodyHeights",
            s.footprint_back_body_heights,
            0.02,
            0.5,
        )?;
        within(
            "support.footprintFrontBodyHeights",
            s.footprint_front_body_heights,
            0.02,
            0.5,
        )?;
        within("support.comAheadBodyHeights", s.com_ahead_body_heights, -0.3, 0.3)?;
        within("support.comMarginBodyHeights", s.com_margin_body_heights, 0.0, 0.5)?;
        within(
            "support.stepComMarginBodyHeights",
            s.step_com_margin_body_heights,
            0.0,
            0.5,
        )?;
        within("support.narrowWidthBodyHeights", s.narrow_width_body_heights, 0.1, 3.0)?;
        within("support.broadWidthBodyHeights", s.broad_width_body_heights, 0.1, 6.0)?;
        within("support.broadMarginBodyHeights", s.broad_margin_body_heights, 0.0, 1.0)?;
        within("support.tailReachBodyHeights", s.tail_reach_body_heights, 0.0, 1.5)?;
        within(
            "support.contactHeightBodyHeights",
            s.contact_height_body_heights,
            0.0,
            0.5,
        )?;
        within(
            "support.shoulderHeightBodyHeights",
            s.shoulder_height_body_heights,
            0.1,
            1.2,
        )?;
        within(
            "support.shoulderAheadBodyHeights",
            s.shoulder_ahead_body_heights,
            -0.5,
            0.5,
        )?;
        within("support.armReachBodyHeights", s.arm_reach_body_heights, 0.05, 1.0)?;
        within("support.minThicknessPx", s.min_thickness_px, 1.0, 64.0)?;
        within("support.tolerancePx", s.tolerance_px, 0.0, 4.0)?;
        if s.step_com_margin_body_heights > s.com_margin_body_heights {
            return refuse(
                InvalidConfig,
                "config.support: a passing step cannot need more margin than a perch",
            );
        }
        if s.narrow_width_body_heights >= s.broad_width_body_heights {
            return refuse(
                InvalidConfig,
                "config.support: a narrow ledge must be narrower than broad support",
            );
        }
        if s.narrow_width_body_heights < s.footprint_back_body_heights + s.footprint_front_body_heights {
            return refuse(
                InvalidConfig,
                "config.support: the narrowest ledge must still hold both feet",
            );
        }
        Ok(())
    }
}

impl MotionConfig {
    /// Refuse any value that is non-finite, outside its range, or inconsistent with another.
    pub fn validate(&self) -> Result<(), MotionError> {
        use MotionErrorCode::InvalidConfig;
        if self.schema != CONFIG_SCHEMA {
            return refuse(InvalidConfig, format!("config.schema must be {CONFIG_SCHEMA}"));
        }
        if self.id.is_empty()
            || !self
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return refuse(InvalidConfig, "config.id must be a lowercase slug");
        }
        if self.version < 1 {
            return refuse(InvalidConfig, "config.version must be a positive integer");
        }
        within("bodyHeightPx", self.body_height_px, 16.0, 2048.0)?;
        within("gravityBodyHeightsPerS2", self.gravity_body_heights_per_s2, 4.0, 80.0)?;
        within("maxGravityBoost", self.max_gravity_boost, 1.0, 3.0)?;
        within("maxSpeedBodyHeightsPerS", self.max_speed_body_heights_per_s, 1.0, 60.0)?;

        let h = &self.hop;
        within("hop.peakBase", h.peak_base, 0.0, 2.0)?;
        within("hop.peakPerPx", h.peak_per_px, 0.0, 1.0)?;
        within("hop.peakMin", h.peak_min, 0.01, 2.0)?;
        within("hop.peakMax", h.peak_max, 0.01, 2.0)?;
        within("hop.anticipationMs", h.anticipation_ms, 1.0, 600.0)?;
        within("hop.anticipationHoldFrac", h.anticipation_hold_frac, 0.0, 0.8)?;
        within("hop.orientMaxMs", h.orient_max_ms, 0.0, 600.0)?;
        within("hop.minFlightMs", h.min_flight_ms, 60.0, 2000.0)?;
        within("hop.settleReserveMs", h.settle_reserve_ms, 0.0, 400.0)?;
        within("hop.pushMs", h.push_ms, 10.0, 300.0)?;
        within("hop.preloadSquash", h.preload_squash, 0.0, 1.0)?;
        within("hop.extensionFrac", h.extension_frac, 0.01, 0.5)?;
        within(
            "hop.extensionReferenceBodyHeights",
            h.extension_reference_body_heights,
            0.05,
            2.0,
        )?;
        within("hop.airborneCrouch", h.airborne_crouch, 0.0, 1.0)?;
        if h.peak_min > h.peak_max {
            return refuse(InvalidConfig, "config.hop.peakMin exceeds hop.peakMax");
        }

        let l = &self.landing;
        within("landing.contactMs", l.contact_ms, 1.0, 200.0)?;
        within("landing.compressionMs", l.compression_ms, 10.0, 600.0)?;
        within("landing.settleMs", l.settle_ms, 100.0, 3000.0)?;
        within("landing.minSettleMs", l.min_settle_ms, 50.0, 3000.0)?;
        within("landing.settleFreqHz", l.settle_freq_hz, 0.2, 12.0)?;
        within("landing.settleDamping", l.settle_damping, 0.1, 0.95)?;
        within(
            "landing.impulseReferenceBodyHeights",
            l.impulse_reference_body_heights,
            0.05,
            4.0,
        )?;
        within("landing.crouchBase", l.crouch_base, 0.0, 1.0)?;
        within("landing.crouchGain", l.crouch_gain, 0.0, 1.0)?;
        within("landing.compressionGain", l.compression_gain, 0.0, 1.0)?;
        within("landing.nodDeg", l.nod_deg, -20.0, 20.0)?;
        if l.min_settle_ms > l.settle_ms {
            return refuse(InvalidConfig, "config.landing.minSettleMs exceeds landing.settleMs");
        }

        let p = &self.pitch;
        within("pitch.maxDeg", p.max_deg, 0.0, 30.0)?;
        within("pitch.velocityGain", p.velocity_gain, 0.0, 4.0)?;
        within("pitch.headStabilization", p.head_stabilization, 0.0, 1.0)?;

        let t = &self.tail;
        within("tail.freqHz", t.freq_hz, 0.2, 12.0)?;
        within("tail.damping", t.damping, 0.1, 1.5)?;
        within("tail.loadDeg", t.load_deg, -40.0, 40.0)?;
        within("tail.pitchCounter", t.pitch_counter, 0.0, 4.0)?;
        within("tail.liftDeg", t.lift_deg, -10.0, 10.0)?;
        within("tail.impactDeg", t.impact_deg, -40.0, 40.0)?;
        within("tail.maxDeg", t.max_deg, 1.0, 60.0)?;
        within("tail.curlFlightDeg", t.curl_flight_deg, -10.0, 10.0)?;
        within("tail.curlLoadDeg", t.curl_load_deg, -10.0, 10.0)?;
        within("tail.maxCurlDeg", t.max_curl_deg, 0.5, 20.0)?;
        for (name, v) in [
            ("tail.tensionLoad", t.tension_load),
            ("tail.tensionLever", t.tension_lever),
            ("tail.tensionFlight", t.tension_flight),
            ("tail.tensionBrace", t.tension_brace),
            ("tail.tensionEffort", t.tension_effort),
        ] {
            within(name, v, 0.0, 1.0)?;
        }
        within("tail.tensionFollowMs", t.tension_follow_ms, 1.0, 1000.0)?;

        let e = &self.ears;
        within("ears.freqHz", e.freq_hz, 0.2, 12.0)?;
        within("ears.damping", e.damping, 0.1, 1.5)?;
        within("ears.accelGainDeg", e.accel_gain_deg, -10.0, 10.0)?;
        within("ears.maxDeg", e.max_deg, 1.0, 30.0)?;

        self.support.validate()?;

        let m = &self.limits;
        within("limits.maxHeadDeg", m.max_head_deg, 1.0, 30.0)?;
        within("limits.maxWindowMs", m.max_window_ms, 100.0, 120_000.0)?;
        within("limits.maxApexBodyHeights", m.max_apex_body_heights, 0.1, 4.0)?;
        if h.peak_max > m.max_apex_body_heights {
            return refuse(InvalidConfig, "config.hop.peakMax exceeds limits.maxApexBodyHeights");
        }
        Ok(())
    }
}
