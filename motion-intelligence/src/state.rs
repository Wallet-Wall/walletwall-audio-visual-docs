//! Domain types: what the lesson asks for ([`MotionInput`]), and what the engine answers
//! ([`MotionPlan`]: phase windows plus one [`MotionState`] per video frame).
//!
//! Boundary documents use camelCase field names and SCREAMING_SNAKE_CASE enum values, matching
//! the TypeScript pipeline's vocabulary.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::config::MotionConfig;
use crate::math::Vec2;
use crate::support::SupportVerdict;
use crate::terrain::{Stage, Terrain};

/// A semantic action, as the lesson names it. The engine performs `Hop`, `Land`, and `Perch` (which
/// all arrive by the same physical traversal); the others are refused with
/// [`crate::MotionErrorCode::UnsupportedAction`] until a later lane implements them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MotionAction {
    /// Stand where you are.
    Idle,
    /// Hop to the target.
    Hop,
    /// Arrive on the target.
    Land,
    /// Arrive on the target and settle into a supported perch.
    Perch,
    /// Lean in to look.
    Inspect,
    /// Follow a drawn route.
    Trace,
    /// Climb onto a ledge.
    Mantle,
    /// Vault over an obstacle.
    Vault,
    /// Push through into depth.
    PushThrough,
}

impl MotionAction {
    /// This engine version performs the action.
    pub fn supported(self) -> bool {
        matches!(self, MotionAction::Hop | MotionAction::Land | MotionAction::Perch)
    }
}

/// Where a body is within a traversal. A hop passes through these in this order (Idle may be
/// empty when there is no time to orient).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MotionPhase {
    /// Standing, oriented toward the target.
    Idle,
    /// Loading: the legs bend, the body squashes, the tail presses down.
    Preload,
    /// Push-off: the legs extend while the feet still touch the surface.
    Takeoff,
    /// Ballistic flight.
    Airborne,
    /// Touchdown, exactly on the target.
    Contact,
    /// Absorbing the landing down to its deepest point.
    Compression,
    /// One small rebound, then back to the stance.
    Settle,
    /// Stable, supported, at rest on the target.
    Perch,
}

impl MotionPhase {
    /// Every phase, in traversal order.
    pub const ORDER: [MotionPhase; 8] = [
        MotionPhase::Idle,
        MotionPhase::Preload,
        MotionPhase::Takeoff,
        MotionPhase::Airborne,
        MotionPhase::Contact,
        MotionPhase::Compression,
        MotionPhase::Settle,
        MotionPhase::Perch,
    ];

    /// The feet are on a surface during this phase.
    pub fn grounded(self) -> bool {
        self != MotionPhase::Airborne
    }

    /// The feet are on the start during this phase (before liftoff).
    pub fn before_liftoff(self) -> bool {
        self < MotionPhase::Airborne
    }

    /// The feet are on the target during this phase (from touchdown on).
    pub fn after_contact(self) -> bool {
        self > MotionPhase::Airborne
    }
}

/// What the feet are touching.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Contact {
    /// Airborne.
    None,
    /// Open ground.
    Ground,
    /// A declared surface (card, node, pillar, ledge).
    Platform,
}

/// The time budget of one traversal, in absolute video milliseconds.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Timing {
    /// When the traversal begins.
    pub start_ms: f64,
    /// When the lesson needs the body standing on the target (touchdown happens before this).
    pub arrive_by_ms: f64,
    /// When this plan hands the body back (the perch holds until then).
    pub end_ms: f64,
}

/// A standing posture at one end of the traversal.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Stance {
    /// Leg bend, 0..1.
    pub crouch: f64,
    /// Tail swing relative to the body, degrees (positive raises the tip).
    pub tail_deg: f64,
    /// Tail curl along its length, degrees per segment (positive curls the tip up): a stance that
    /// leans in to inspect lifts and curls the tail as a counterweight.
    pub tail_curl: f64,
    /// How hard the tail works holding the stance, 0..1.
    pub tail_tension: f64,
}

/// The authored postures the traversal leaves from and settles into (continuity with whatever
/// performs the body before and after this plan).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StanceChange {
    /// Posture at the start of the window.
    pub initial: Stance,
    /// Posture the perch settles into.
    pub rest: Stance,
}

/// Where the lesson sends the body: the stands it authored for this destination (in its order of
/// preference), the subject a perch there faces, and whether a narrow perch was authored. The
/// engine picks the stand the terrain carries best ([`crate::support::select_support`]); it can only
/// pick one of these, never move one, and refuses when none is a plausible perch.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Destination {
    /// The authored stands, px: at least one.
    pub candidates: Vec<Vec2>,
    /// The subject the perch faces, px.
    pub focus: Vec2,
    /// The lesson authored a narrow perch here.
    pub narrow_allowed: bool,
}

/// Everything the engine needs: a semantic action with a fixed start and the lesson's authored
/// destination, a time budget, the frame grid to sample, and the versioned physics configuration.
/// The engine can only reach one of the destination's stands; nothing here lets it choose another.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionInput {
    /// Must be [`crate::INPUT_SCHEMA`].
    pub schema: String,
    /// What the lesson asks for.
    pub action: MotionAction,
    /// Where the feet are when the window opens, px.
    pub start: Vec2,
    /// Where the lesson sends the feet: its authored stands. Immutable.
    pub destination: Destination,
    /// Character scale at the start.
    pub start_scale: f64,
    /// Character scale at the target.
    pub target_scale: f64,
    /// The time budget.
    pub timing: Timing,
    /// Video frame rate: one state is sampled per frame inside the window.
    pub fps: u32,
    /// The visible frame.
    pub stage: Stage,
    /// The declared surfaces (the segment's own and the outgoing one's), the text to keep clear, and
    /// the figure's box.
    pub terrain: Terrain,
    /// Postures at both ends.
    pub stance: StanceChange,
    /// Versioned physics.
    pub config: MotionConfig,
}

/// One frame of motion: everything a renderer (the Rive rig) needs to perform the body, and
/// nothing about where the lesson goes next. Angles use the rig's conventions.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionState {
    /// Traversal phase.
    pub phase: MotionPhase,
    /// Progress through the phase, 0..1.
    pub phase_progress: f64,
    /// Feet position, px.
    pub position: Vec2,
    /// Feet velocity, px/s.
    pub velocity: Vec2,
    /// Character scale.
    pub scale: f64,
    /// What the feet touch.
    pub contact: Contact,
    /// Whole-body pitch, degrees (positive = nose toward the facing direction, i.e. down).
    pub body_pitch: f64,
    /// Leg bend, 0..1.
    pub crouch: f64,
    /// Legs tucked for flight, 0..1.
    pub tuck: f64,
    /// Body squash, 0..1.
    pub compression: f64,
    /// Body extension, 0..1.
    pub stretch: f64,
    /// Tail swing relative to the body, degrees (positive raises the tip).
    pub tail_angle: f64,
    /// Tail curl along its length, degrees per segment (positive curls the tip up).
    pub tail_curl: f64,
    /// How hard the tail is working, 0 (slack) .. 1 (a rigid lever).
    pub tail_tension: f64,
    /// Head counter-rotation and nod, degrees (positive = chin down).
    pub head_angle: f64,
    /// Ear follow-through, degrees (positive = forward).
    pub ear_lag: f64,
    /// Impulse of the landing in progress, 0..1 (0 outside Contact..Settle).
    pub landing_impulse: f64,
}

/// One phase's window, absolute ms, `[start_ms, end_ms)`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseWindow {
    /// The phase.
    pub phase: MotionPhase,
    /// Inclusive start, ms.
    pub start_ms: f64,
    /// Exclusive end, ms.
    pub end_ms: f64,
}

/// The key instants of the traversal, absolute ms.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTiming {
    /// Echo of the input window start.
    pub start_ms: f64,
    /// Echo of the input arrival deadline.
    pub arrive_by_ms: f64,
    /// Echo of the input window end.
    pub end_ms: f64,
    /// End of the orient (start of the preload).
    pub orient_end_ms: f64,
    /// Start of the push-off.
    pub push_ms: f64,
    /// The feet leave the start.
    pub liftoff_ms: f64,
    /// The feet touch the target.
    pub contact_ms: f64,
    /// The body is back in its stance.
    pub settled_ms: f64,
}

/// The solved flight.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trajectory {
    /// Parabola depth `c` in `y(s) = y0 + (y1 - y0)s - c·s(1 - s)`, px.
    pub depth_px: f64,
    /// Effective gravity, px/s².
    pub gravity_px_per_s2: f64,
    /// Effective gravity as a multiple of the configured gravity.
    pub gravity_boost: f64,
    /// Flight time, ms.
    pub flight_ms: f64,
    /// Apex height above the higher endpoint, px.
    pub apex_above_px: f64,
    /// The arc the surface-aware search kept: its apex as a fraction of the natural apex (one of
    /// [`crate::hop::ARC_CANDIDATES`]; 1 = the natural arc).
    pub arc_fraction: f64,
    /// Flight samples (of [`crate::hop::FLIGHT_SAMPLES`]) whose figure box crosses protected text.
    pub text_crossings: u32,
}

/// Which contact a [`ContactEvent`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContactKind {
    /// The push-off: the feet leave the start.
    Takeoff,
    /// Touchdown: the feet arrive on the target.
    Landing,
}

/// A contact between the feet and the terrain, as the scene should react to it (a platform's dip, a
/// contact sound). The plan states its own contacts so that nothing downstream has to re-derive
/// them from another solver.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactEvent {
    /// Push-off or touchdown.
    pub kind: ContactKind,
    /// When, absolute ms: exactly the liftoff or the contact instant.
    pub at_ms: f64,
    /// Normalised strength, 0..1: vertical speed at that end of the flight over the touchdown speed
    /// of a fall from `landing.impulseReferenceBodyHeights`.
    pub impulse: f64,
    /// Where the feet are: exactly the start (takeoff) or the target (landing).
    pub position: Vec2,
    /// Character scale there.
    pub scale: f64,
    /// What the feet push off from or land on.
    pub contact: Contact,
}

/// Which video frames the plan samples: `first .. first + count`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameRange {
    /// Frames per second.
    pub fps: u32,
    /// First frame index inside the window.
    pub first: u32,
    /// Number of frames sampled.
    pub count: u32,
}

/// Whose terrain carried a contact.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerrainOf {
    /// The segment's own.
    Own,
    /// The outgoing segment's, still on screen while this one transitions in.
    Outgoing,
}

/// One of the plan's own contacts, judged for support at its instant.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JudgedContact {
    /// When, absolute ms.
    pub at_ms: f64,
    /// The terrain that carried it (or, refused, the segment's own).
    pub terrain: TerrainOf,
    /// The judge's verdict.
    pub verdict: SupportVerdict,
}

/// How the plan is carried: the stand the engine chose among the authored ones, every authored
/// stand's verdict, and the verdicts on its own takeoff and landing.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSupport {
    /// Index of the chosen stand in `destination.candidates`.
    pub candidate: u32,
    /// Every authored stand's verdict as a perch facing the focus, in authored order.
    pub candidates: Vec<SupportVerdict>,
    /// The push-off from the start (a passing step), judged at liftoff; `None` when the start is off
    /// the stage (an entrance from beyond the frame: nothing there can be seen standing).
    pub takeoff: Option<JudgedContact>,
    /// The touchdown on the chosen stand (a perch, facing the direction of travel), judged at contact.
    pub landing: JudgedContact,
}

/// Engine identity recorded in every plan.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EngineId {
    /// Crate name.
    pub name: &'static str,
    /// Crate version.
    pub version: &'static str,
}

/// The engine's answer: how the body gets from `start` to `target`, frame by frame.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionPlan {
    /// [`crate::PLAN_SCHEMA`].
    pub schema: &'static str,
    /// Which engine made the plan.
    pub engine: EngineId,
    /// Echo of the input action.
    pub action: MotionAction,
    /// Echo of the input start.
    pub start: Vec2,
    /// The chosen stand (one of `destination.candidates`, bit for bit): the plan's final position.
    pub target: Vec2,
    /// How the start, the stand, and the landing are carried.
    pub support: PlanSupport,
    /// Key instants.
    pub timing: PlanTiming,
    /// The flight.
    pub trajectory: Trajectory,
    /// The plan's contacts with the terrain, in time order: the takeoff, then the landing.
    pub events: Vec<ContactEvent>,
    /// Every non-empty phase window, in order, covering the window exactly.
    pub phases: Vec<PhaseWindow>,
    /// The sampled frame grid.
    pub frames: FrameRange,
    /// One state per frame in `frames`.
    pub samples: Vec<MotionState>,
}
