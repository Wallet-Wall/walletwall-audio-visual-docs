//! The solver: validate, solve the hop (with its surface-aware arc search), lay out the phases,
//! simulate the secondary motion on a fixed time grid, sample one state per video frame, state the
//! plan's contacts with the terrain, and check the plan before returning it.
//!
//! Kinematics and the body's postural channels are closed-form functions of time. The tail, the
//! ears, and the tail's tension are damped responses, integrated once per plan on a fixed 1 ms grid
//! from the start of the window and read at frame times by interpolation, so the dynamics never
//! depend on the frame rate or on which frames a renderer asks for. (The one exception is a perch
//! too short for the configured settle: the settle is hurried to end on the last frame the plan
//! performs, so the body is handed back at rest; see [`Landing::within`].)

use alloc::format;
use alloc::vec;
use alloc::vec::Vec;
use core::f64::consts::PI;

use crate::config::MotionConfig;
use crate::constraints::check_plan;
use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::hop::{self, HopRequest, HopSolution, feet_at, solve_hop, velocity_at};
use crate::landing::{Landing, absorb, settle_taper};
use crate::math::{
    Vec2, ceil, clamp, clamp01, ease_in_out, ease_out, floor, lerp, positive_zero, pow, sin, smoothstep, soft_limit,
    sqrt,
};
use crate::state::{
    ContactEvent, ContactKind, EngineId, FrameRange, MotionInput, MotionPhase, MotionPlan, MotionState, PhaseWindow,
    PlanTiming, Stance, Trajectory,
};
use crate::tail::{Follower, TailSignals, desired_counterbalance, desired_curl, tension_target};
use crate::terrain::{check_geometry, contact_with};
use crate::{ENGINE_NAME, ENGINE_VERSION, INPUT_SCHEMA, PLAN_SCHEMA};

/// Fixed step of the secondary-motion simulation, ms.
pub const SIM_STEP_MS: f64 = 1.0;
/// Share of a range of motion that is exactly linear before the soft limit bends it.
pub const RANGE_KNEE: f64 = 0.75;
/// The push-off takes at most this share of the time between the orient and liftoff.
const PUSH_PRELOAD_FRAC: f64 = 0.4;
/// Latest instant a plan may cover, ms (a day of video).
const MAX_TIME_MS: f64 = 86_400_000.0;
/// Largest character scale.
const MAX_SCALE: f64 = 4.0;

/// Solve `input`: a plan whose final position is the authored target, or a refusal.
pub fn solve_motion(input: &MotionInput) -> Result<MotionPlan, MotionError> {
    validate_input(input)?;
    let cfg = &input.config;
    let timing = input.timing;
    let terrain = &input.terrain;
    let hop = solve_hop(
        &HopRequest {
            from: input.start,
            to: input.target,
            from_scale: input.start_scale,
            to_scale: input.target_scale,
            start_ms: timing.start_ms,
            arrive_by_ms: timing.arrive_by_ms,
            protected_text: &terrain.protected_text,
            figure: terrain.figure,
        },
        cfg,
    )?;
    let (takeoff_impulse, landing_impulse) = hop::impulses(&hop, input.start, input.target, cfg);
    let (first, count) = frame_grid(input)?;
    // The last frame this plan performs: the body must be back in its stance by then.
    let landing = Landing::within(hop.contact_ms, &cfg.landing, frame_ms(first + count - 1, input.fps))?;
    let push_ms = cfg
        .hop
        .push_ms
        .min((hop.liftoff_ms - hop.orient_end_ms) * PUSH_PRELOAD_FRAC);
    let push_start_ms = hop.liftoff_ms - push_ms;
    let phases = phase_windows(input, &hop, push_start_ms, &landing);
    let body = Body::new(input, hop, landing, push_start_ms, phases, landing_impulse);
    let sim = Sim::run(&body);
    let samples: Vec<MotionState> = (first..first + count)
        .map(|f| body.sample(frame_ms(f, input.fps), &sim))
        .collect();

    let plan = MotionPlan {
        schema: PLAN_SCHEMA,
        engine: EngineId {
            name: ENGINE_NAME,
            version: ENGINE_VERSION,
        },
        action: input.action,
        start: input.start,
        target: input.target,
        timing: PlanTiming {
            start_ms: timing.start_ms,
            arrive_by_ms: timing.arrive_by_ms,
            end_ms: timing.end_ms,
            orient_end_ms: hop.orient_end_ms,
            push_ms: push_start_ms,
            liftoff_ms: hop.liftoff_ms,
            contact_ms: hop.contact_ms,
            settled_ms: landing.settled_ms,
        },
        trajectory: Trajectory {
            depth_px: hop.depth_px,
            gravity_px_per_s2: hop.gravity_px,
            gravity_boost: hop.gravity_px / hop.base_gravity_px,
            flight_ms: hop.contact_ms - hop.liftoff_ms,
            apex_above_px: hop.apex_above_px,
            arc_fraction: hop.arc_fraction,
            text_crossings: hop.text_crossings,
        },
        events: vec![
            ContactEvent {
                kind: ContactKind::Takeoff,
                at_ms: hop.liftoff_ms,
                impulse: takeoff_impulse,
                position: input.start,
                scale: input.start_scale,
                contact: contact_with(terrain.start.as_ref()),
            },
            ContactEvent {
                kind: ContactKind::Landing,
                at_ms: hop.contact_ms,
                impulse: landing_impulse,
                position: input.target,
                scale: input.target_scale,
                contact: contact_with(terrain.target.as_ref()),
            },
        ],
        phases: body.phases,
        frames: FrameRange {
            fps: input.fps,
            first: first as u32,
            count: count as u32,
        },
        samples,
    };
    check_plan(&plan, input)?;
    Ok(plan)
}

/// Refuse malformed input before any physics runs: finiteness first (so a NaN is reported as a NaN),
/// then the configuration, then ranges, windows, and geometry.
fn validate_input(input: &MotionInput) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidDuration, InvalidInput, NonFiniteValue, UnsupportedAction};
    if input.schema != INPUT_SCHEMA {
        return refuse(InvalidInput, format!("input.schema must be {INPUT_SCHEMA}"));
    }
    if !input.action.supported() {
        return refuse(
            UnsupportedAction,
            format!("{:?} is not performed by {ENGINE_NAME} {ENGINE_VERSION}", input.action),
        );
    }
    let t = input.timing;
    let (initial, rest) = (input.stance.initial, input.stance.rest);
    let numbers = [
        ("start.x", input.start.x),
        ("start.y", input.start.y),
        ("target.x", input.target.x),
        ("target.y", input.target.y),
        ("startScale", input.start_scale),
        ("targetScale", input.target_scale),
        ("timing.startMs", t.start_ms),
        ("timing.arriveByMs", t.arrive_by_ms),
        ("timing.endMs", t.end_ms),
        ("stance.initial.crouch", initial.crouch),
        ("stance.initial.tailDeg", initial.tail_deg),
        ("stance.initial.tailCurl", initial.tail_curl),
        ("stance.initial.tailTension", initial.tail_tension),
        ("stance.rest.crouch", rest.crouch),
        ("stance.rest.tailDeg", rest.tail_deg),
        ("stance.rest.tailCurl", rest.tail_curl),
        ("stance.rest.tailTension", rest.tail_tension),
    ];
    for (name, v) in numbers {
        if !v.is_finite() {
            return refuse(NonFiniteValue, format!("input.{name} is not finite"));
        }
    }
    input.config.validate()?;
    if !(1..=240).contains(&input.fps) {
        return refuse(InvalidInput, format!("input.fps={} is outside 1..=240", input.fps));
    }
    for (name, s) in [("startScale", input.start_scale), ("targetScale", input.target_scale)] {
        if !(s > 0.0 && s <= MAX_SCALE) {
            return refuse(InvalidInput, format!("input.{name}={s} is outside (0, {MAX_SCALE}]"));
        }
    }
    if t.start_ms < 0.0 {
        return refuse(
            InvalidDuration,
            format!("the window starts at a negative time ({} ms)", t.start_ms),
        );
    }
    // Every number below was checked finite above, so plain comparisons are exact.
    if t.arrive_by_ms <= t.start_ms {
        return refuse(InvalidDuration, "the arrival deadline is not after the window start");
    }
    if t.end_ms <= t.arrive_by_ms {
        return refuse(
            InvalidDuration,
            "the window ends before or at the arrival deadline: no time to perch",
        );
    }
    if t.end_ms > MAX_TIME_MS {
        return refuse(InvalidDuration, format!("the window ends past {MAX_TIME_MS} ms"));
    }
    if t.end_ms - t.start_ms > input.config.limits.max_window_ms {
        return refuse(
            InvalidDuration,
            format!(
                "a {} ms window exceeds the {} ms limit",
                t.end_ms - t.start_ms,
                input.config.limits.max_window_ms
            ),
        );
    }
    let tail_range = input.config.tail.max_deg * RANGE_KNEE;
    let curl_range = input.config.tail.max_curl_deg * RANGE_KNEE;
    for (name, s) in [("initial", initial), ("rest", rest)] {
        if !(0.0..=1.0).contains(&s.crouch) {
            return refuse(
                InvalidInput,
                format!("stance.{name}.crouch={} is outside [0, 1]", s.crouch),
            );
        }
        if s.tail_deg.abs() > tail_range {
            return refuse(
                InvalidInput,
                format!(
                    "stance.{name}.tailDeg={} is outside the tail's exact range (+/-{tail_range})",
                    s.tail_deg
                ),
            );
        }
        if s.tail_curl.abs() > curl_range {
            return refuse(
                InvalidInput,
                format!(
                    "stance.{name}.tailCurl={} is outside the curl's exact range (+/-{curl_range})",
                    s.tail_curl
                ),
            );
        }
        if !(0.0..=1.0).contains(&s.tail_tension) {
            return refuse(
                InvalidInput,
                format!("stance.{name}.tailTension={} is outside [0, 1]", s.tail_tension),
            );
        }
    }
    check_geometry(input.start, input.target, &input.stage, &input.terrain)
}

/// Every phase window in order (an empty orient is omitted). Contiguous by construction.
fn phase_windows(input: &MotionInput, hop: &HopSolution, push_start_ms: f64, landing: &Landing) -> Vec<PhaseWindow> {
    let bounds = [
        (MotionPhase::Idle, input.timing.start_ms, hop.orient_end_ms),
        (MotionPhase::Preload, hop.orient_end_ms, push_start_ms),
        (MotionPhase::Takeoff, push_start_ms, hop.liftoff_ms),
        (MotionPhase::Airborne, hop.liftoff_ms, hop.contact_ms),
        (MotionPhase::Contact, hop.contact_ms, landing.impact_end_ms),
        (MotionPhase::Compression, landing.impact_end_ms, landing.absorbed_ms),
        (MotionPhase::Settle, landing.absorbed_ms, landing.settled_ms),
        (MotionPhase::Perch, landing.settled_ms, input.timing.end_ms),
    ];
    bounds
        .iter()
        .filter(|(phase, start, end)| *phase != MotionPhase::Idle || end > start)
        .map(|&(phase, start_ms, end_ms)| PhaseWindow {
            phase,
            start_ms,
            end_ms,
        })
        .collect()
}

/// Video frame `f` in absolute ms: the same expression the renderer uses (`frame * 1000 / fps`).
fn frame_ms(frame: u64, fps: u32) -> f64 {
    (frame as f64 * 1000.0) / f64::from(fps)
}

/// The frames whose time falls in `[start, end)`: `(first, count)`.
fn frame_grid(input: &MotionInput) -> Result<(u64, u64), MotionError> {
    let fps = input.fps;
    let guess = floor((input.timing.start_ms * f64::from(fps)) / 1000.0);
    let mut f = if guess >= 1.0 { guess as u64 - 1 } else { 0 };
    while frame_ms(f, fps) < input.timing.start_ms {
        f += 1;
    }
    let first = f;
    while frame_ms(f, fps) < input.timing.end_ms {
        f += 1;
    }
    let count = f - first;
    if count == 0 {
        return refuse(
            MotionErrorCode::InvalidDuration,
            "no video frame falls inside the window",
        );
    }
    if first > u64::from(u32::MAX) || count > u64::from(u32::MAX) {
        return refuse(
            MotionErrorCode::InvalidDuration,
            "the frame range does not fit the plan",
        );
    }
    Ok((first, count))
}

/// The traversal as closed-form functions of absolute time.
struct Body<'a> {
    input: &'a MotionInput,
    cfg: &'a MotionConfig,
    hop: HopSolution,
    landing: Landing,
    push_start_ms: f64,
    phases: Vec<PhaseWindow>,
    landing_impulse: f64,
    /// Takeoff extension earned by the arc's height, 0..1 (low skims barely extend).
    extension_peak: f64,
    /// Constant horizontal speed in flight, px/s.
    forward_speed: f64,
}

impl<'a> Body<'a> {
    fn new(
        input: &'a MotionInput,
        hop: HopSolution,
        landing: Landing,
        push_start_ms: f64,
        phases: Vec<PhaseWindow>,
        landing_impulse: f64,
    ) -> Self {
        let cfg = &input.config;
        let from_body = cfg.body_height_px * input.start_scale;
        Self {
            input,
            cfg,
            hop,
            landing,
            push_start_ms,
            phases,
            landing_impulse,
            extension_peak: clamp01(hop.apex_above_px / (cfg.hop.extension_reference_body_heights * from_body)),
            forward_speed: (input.target.x - input.start.x).abs() / hop.flight_s(),
        }
    }

    /// The phase at `t` and the progress through it (past the window's end: the last phase).
    fn window(&self, t: f64) -> (MotionPhase, f64) {
        for w in &self.phases {
            if t < w.end_ms {
                return (w.phase, clamp((t - w.start_ms) / (w.end_ms - w.start_ms), 0.0, 1.0));
            }
        }
        self.phases.last().map_or((MotionPhase::Perch, 1.0), |w| (w.phase, 1.0))
    }

    /// Flight fraction at `t` (0 at liftoff, 1 at contact): the oracle's expression.
    fn flight_fraction(&self, t: f64) -> f64 {
        (t - self.hop.liftoff_ms) / (self.hop.contact_ms - self.hop.liftoff_ms)
    }

    /// Body pitch in flight: the velocity direction drives it, nose up rising, nose down falling.
    fn flight_pitch(&self, s: f64) -> f64 {
        let vy = (self.input.target.y - self.input.start.y) - self.hop.depth_px * (1.0 - 2.0 * s);
        let vx = (self.input.target.x - self.input.start.x).abs();
        let dir = vy / sqrt(vx * vx + vy * vy).max(1.0);
        self.cfg.pitch.max_deg * clamp(self.cfg.pitch.velocity_gain * dir, -1.0, 1.0)
    }

    /// Progress through the preload's loading, with a held bottom.
    fn load(&self, progress: f64) -> f64 {
        ease_in_out(progress / (1.0 - self.cfg.hop.anticipation_hold_frac))
    }

    fn pitch(&self, t: f64, phase: MotionPhase, progress: f64) -> f64 {
        match phase {
            MotionPhase::Takeoff => self.flight_pitch(0.0) * smoothstep(0.0, 1.0, progress),
            MotionPhase::Airborne => self.flight_pitch(self.flight_fraction(t)),
            MotionPhase::Contact | MotionPhase::Compression => {
                self.flight_pitch(1.0) * (1.0 - ease_in_out(self.landing.absorption(t)))
            }
            _ => 0.0,
        }
    }

    /// The authored resting posture at `t`: initial until liftoff, blended across the flight,
    /// the rest stance from touchdown on.
    fn stance(&self, t: f64, phase: MotionPhase) -> Stance {
        let (a, b) = (self.input.stance.initial, self.input.stance.rest);
        if phase.before_liftoff() {
            a
        } else if phase.after_contact() {
            b
        } else {
            let s = self.flight_fraction(t);
            Stance {
                crouch: lerp(a.crouch, b.crouch, s),
                tail_deg: lerp(a.tail_deg, b.tail_deg, s),
                tail_curl: lerp(a.tail_curl, b.tail_curl, s),
                tail_tension: lerp(a.tail_tension, b.tail_tension, s),
            }
        }
    }

    /// Peak leg bend of this landing.
    fn landing_crouch_peak(&self) -> f64 {
        let l = &self.cfg.landing;
        clamp01(self.input.stance.rest.crouch + l.crouch_base + l.crouch_gain * self.landing_impulse)
    }

    fn crouch(&self, t: f64, phase: MotionPhase, progress: f64) -> f64 {
        let initial = self.input.stance.initial.crouch;
        let rest = self.input.stance.rest.crouch;
        let air = self.cfg.hop.airborne_crouch;
        match phase {
            MotionPhase::Idle => initial,
            MotionPhase::Preload => lerp(initial, 1.0, self.load(progress)),
            MotionPhase::Takeoff => lerp(1.0, air, ease_out(progress)),
            MotionPhase::Airborne => air,
            MotionPhase::Contact | MotionPhase::Compression => {
                lerp(air, self.landing_crouch_peak(), absorb(self.landing.absorption(t)))
            }
            MotionPhase::Settle => clamp01(rest + (self.landing_crouch_peak() - rest) * self.landing.release_at(t)),
            MotionPhase::Perch => rest,
        }
    }

    /// Signed deformation: positive squashes the body, negative is the rebound's extension.
    fn deformation(&self, t: f64, phase: MotionPhase, progress: f64) -> f64 {
        let squash = self.cfg.hop.preload_squash;
        match phase {
            MotionPhase::Preload => squash * self.load(progress),
            MotionPhase::Takeoff => squash * (1.0 - ease_out(progress)),
            MotionPhase::Contact | MotionPhase::Compression | MotionPhase::Settle => {
                clamp01(self.cfg.landing.compression_gain * self.landing_impulse) * self.landing.response(t)
            }
            _ => 0.0,
        }
    }

    /// Takeoff extension: builds through the push-off, relaxes early in the flight.
    fn extension(&self, t: f64, phase: MotionPhase, progress: f64) -> f64 {
        match phase {
            MotionPhase::Takeoff => self.extension_peak * ease_out(progress),
            MotionPhase::Airborne => {
                self.extension_peak * (1.0 - self.flight_fraction(t) / self.cfg.hop.extension_frac).max(0.0)
            }
            _ => 0.0,
        }
    }

    /// Legs tucked for flight: zero at liftoff and at contact.
    fn tuck(&self, t: f64, phase: MotionPhase) -> f64 {
        if phase == MotionPhase::Airborne {
            clamp01(pow(sin(PI * self.flight_fraction(t)).max(0.0), 0.8))
        } else {
            0.0
        }
    }

    /// Vertical speed of the body, body heights per second, positive rising. The push-off ramps
    /// it up from rest, the flight is ballistic, the impact window brings it back to rest.
    fn rise(&self, t: f64, phase: MotionPhase, progress: f64) -> f64 {
        let flight_s = self.hop.flight_s();
        let speed_at = |s: f64| velocity_at(self.input.start, self.input.target, self.hop.depth_px, s, flight_s).y;
        let body = self.hop.body_px;
        match phase {
            MotionPhase::Takeoff => -speed_at(0.0) / body * progress,
            MotionPhase::Airborne => -speed_at(self.flight_fraction(t)) / body,
            MotionPhase::Contact => -speed_at(1.0) / body * (1.0 - progress),
            _ => 0.0,
        }
    }

    /// Forward acceleration in g: pushing off speeds the body up, the impact stops it.
    fn forward_accel_g(&self, phase: MotionPhase) -> f64 {
        let g = self.hop.base_gravity_px;
        match phase {
            MotionPhase::Takeoff => self.forward_speed / ((self.hop.liftoff_ms - self.push_start_ms) / 1000.0) / g,
            MotionPhase::Contact => {
                -self.forward_speed / ((self.landing.impact_end_ms - self.hop.contact_ms) / 1000.0) / g
            }
            _ => 0.0,
        }
    }

    fn tail_signals(&self, t: f64, phase: MotionPhase, progress: f64) -> TailSignals {
        let stance = self.stance(t, phase);
        let airborne = phase == MotionPhase::Airborne;
        TailSignals {
            stance_deg: stance.tail_deg,
            stance_curl: stance.tail_curl,
            stance_tension: stance.tail_tension,
            // Only a surface can take the tail's weight: leg load presses it down on the ground only.
            leg_load: if airborne {
                0.0
            } else {
                (self.crouch(t, phase, progress) - stance.crouch).max(0.0)
            },
            pitch_deg: self.pitch(t, phase, progress),
            rise_body_per_s: self.rise(t, phase, progress),
            impact: if phase == MotionPhase::Contact {
                self.landing_impulse * (1.0 - smoothstep(0.0, 1.0, progress))
            } else {
                0.0
            },
            airborne: if airborne { 1.0 } else { 0.0 },
        }
    }

    /// The ears lag acceleration: back while the body speeds up, forward when it stops.
    fn ear_target(&self, phase: MotionPhase) -> f64 {
        -self.cfg.ears.accel_gain_deg * self.forward_accel_g(phase)
    }

    fn kinematics(&self, t: f64, phase: MotionPhase) -> (Vec2, Vec2, f64) {
        let input = self.input;
        if phase.before_liftoff() {
            (input.start, Vec2::ZERO, input.start_scale)
        } else if phase.after_contact() {
            (input.target, Vec2::ZERO, input.target_scale)
        } else {
            let s = self.flight_fraction(t);
            (
                feet_at(input.start, input.target, self.hop.depth_px, s),
                velocity_at(input.start, input.target, self.hop.depth_px, s, self.hop.flight_s()),
                lerp(input.start_scale, input.target_scale, s),
            )
        }
    }

    fn sample(&self, t: f64, sim: &Sim) -> MotionState {
        let cfg = self.cfg;
        let (phase, progress) = self.window(t);
        let (position, velocity, scale) = self.kinematics(t, phase);
        let pitch = self.pitch(t, phase, progress);
        let deformation = self.deformation(t, phase, progress);
        let nod = cfg.landing.nod_deg * self.landing_impulse * self.landing.response(t);
        let head = soft_limit(
            -cfg.pitch.head_stabilization * pitch + nod,
            cfg.limits.max_head_deg,
            RANGE_KNEE,
        );

        let rest = self.input.stance.rest;
        let tail = soft_limit(sim.read(&sim.tail, t), cfg.tail.max_deg, RANGE_KNEE);
        let curl = soft_limit(sim.read(&sim.curl, t), cfg.tail.max_curl_deg, RANGE_KNEE);
        let ears = soft_limit(sim.read(&sim.ears, t), cfg.ears.max_deg, RANGE_KNEE);
        let tension = sim.read(&sim.tension, t);
        // The perch is exact: the settle tapers every response to the stance, and the perch holds it.
        let (tail_angle, tail_curl, tail_tension, ear_lag) = match phase {
            MotionPhase::Perch => (rest.tail_deg, rest.tail_curl, rest.tail_tension, 0.0),
            MotionPhase::Settle => {
                let k = settle_taper(progress);
                (
                    rest.tail_deg + (tail - rest.tail_deg) * k,
                    rest.tail_curl + (curl - rest.tail_curl) * k,
                    rest.tail_tension + (tension - rest.tail_tension) * k,
                    ears * k,
                )
            }
            _ => (tail, curl, tension, ears),
        };
        let contact = match phase {
            MotionPhase::Airborne => crate::state::Contact::None,
            p if p.before_liftoff() => contact_with(self.input.terrain.start.as_ref()),
            _ => contact_with(self.input.terrain.target.as_ref()),
        };
        let landing_impulse = match phase {
            MotionPhase::Contact | MotionPhase::Compression | MotionPhase::Settle => self.landing_impulse,
            _ => 0.0,
        };
        let z = positive_zero;
        MotionState {
            phase,
            phase_progress: z(progress),
            position,
            velocity: Vec2::new(z(velocity.x), z(velocity.y)),
            scale,
            contact,
            body_pitch: z(pitch),
            crouch: z(self.crouch(t, phase, progress)),
            tuck: z(self.tuck(t, phase)),
            compression: z(deformation.max(0.0)),
            stretch: z(clamp01(self.extension(t, phase, progress) + (-deformation).max(0.0))),
            tail_angle: z(tail_angle),
            tail_curl: z(tail_curl),
            tail_tension: z(tail_tension),
            head_angle: z(head),
            ear_lag: z(ear_lag),
            landing_impulse,
        }
    }
}

/// The secondary motion, integrated once on a fixed grid from the start of the window.
struct Sim {
    start_ms: f64,
    tail: Vec<f64>,
    curl: Vec<f64>,
    ears: Vec<f64>,
    tension: Vec<f64>,
}

impl Sim {
    fn run(body: &Body<'_>) -> Self {
        let cfg = body.cfg;
        let start_ms = body.input.timing.start_ms;
        let steps = ceil((body.input.timing.end_ms - start_ms) / SIM_STEP_MS) as usize + 1;
        let dt_s = SIM_STEP_MS / 1000.0;
        // First-order follow of curl and tension toward their targets.
        let follow = SIM_STEP_MS / (cfg.tail.tension_follow_ms + SIM_STEP_MS);
        let initial = body.input.stance.initial;
        let mut tail = Follower::at_rest(initial.tail_deg);
        let mut ears = Follower::at_rest(0.0);
        let mut curl = initial.tail_curl;
        let mut tension = initial.tail_tension;
        let mut sim = Sim {
            start_ms,
            tail: Vec::with_capacity(steps + 1),
            curl: Vec::with_capacity(steps + 1),
            ears: Vec::with_capacity(steps + 1),
            tension: Vec::with_capacity(steps + 1),
        };
        sim.push(&tail, curl, &ears, tension);
        for k in 1..=steps {
            // Signals are held over each step, sampled at its start.
            let t = start_ms + (k - 1) as f64 * SIM_STEP_MS;
            let (phase, progress) = body.window(t);
            let signals = body.tail_signals(t, phase, progress);
            let desired = desired_counterbalance(&signals, &cfg.tail);
            tension += (tension_target(phase, &signals, desired, &tail, &cfg.tail) - tension) * follow;
            curl += (desired_curl(&signals, &cfg.tail) - curl) * follow;
            tail.step(desired, cfg.tail.freq_hz, cfg.tail.damping, dt_s);
            ears.step(body.ear_target(phase), cfg.ears.freq_hz, cfg.ears.damping, dt_s);
            sim.push(&tail, curl, &ears, tension);
        }
        sim
    }

    fn push(&mut self, tail: &Follower, curl: f64, ears: &Follower, tension: f64) {
        self.tail.push(tail.x);
        self.curl.push(curl);
        self.ears.push(ears.x);
        self.tension.push(tension);
    }

    /// A simulated channel at `t`, interpolated between its two grid points.
    fn read(&self, values: &[f64], t: f64) -> f64 {
        let x = (t - self.start_ms) / SIM_STEP_MS;
        let k = floor(x);
        let i = k as usize;
        match (values.get(i), values.get(i + 1)) {
            (Some(&a), Some(&b)) => lerp(a, b, x - k),
            (Some(&a), None) => a,
            _ => values.last().copied().unwrap_or(0.0),
        }
    }
}
