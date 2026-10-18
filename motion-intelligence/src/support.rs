//! Support plausibility: can WalletWallaby's body really be carried here?
//!
//! The scene declares what each drawn element offers ([`crate::terrain`]); this module judges a
//! contact against it, for a body of a given size facing a given way. It is a port of the
//! transitional TypeScript judge (`src/character/walletwallaby/support.ts`), operation for
//! operation, so the two reach the same verdict bit for bit (the integration tests compare them on
//! every contact of the committed lesson and on adversarial sweeps).
//!
//! - A stance (feet on a surface) needs a solid, upward-facing top under BOTH feet, the projected
//!   centre of mass inside that top with a margin, a top of meaningful thickness, the feet ON it (not
//!   inside a block, not on its side, not on a drawn line), and no protected text where the feet
//!   touch. A top that only just holds the feet is a narrow ledge: only an explicitly authored narrow
//!   perch may use it. The tail resting on the same top makes a tripod and can make a perch broad; it
//!   can never carry a body the feet do not.
//! - A grip (a climbing hand) needs a real lip, the corner where a solid top meets its own side face,
//!   within the arm's reach of the shoulder.
//! - A brace (a hand against a face) needs a face that takes one, ahead of the body, within reach,
//!   while the feet themselves stand supported.
//!
//! Selection among a lesson's authored candidate stands takes the best grade (broad, then ledge, then
//! narrow), then a tail on the support, then the lesson's own order, and refuses when none is
//! plausible. It can only pick one of the candidates; it never moves one.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::config::SupportConfig;
use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::{Vec2, sqrt};
use crate::state::EngineId;
use crate::terrain::{
    Face, Rect, Stage, SupportClass, TerrainSurface, check_surfaces, check_text, near_segment, solids_of,
};
use crate::{ENGINE_NAME, ENGINE_VERSION, SUPPORT_QUERY_SCHEMA, SUPPORT_REPORT_SCHEMA};

/// What a contact is for: a perch the body settles and holds, or a step it touches down on the way.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ContactRole {
    /// The body settles and holds here.
    Perch,
    /// It touches down on the way (a takeoff, a chained bound, a trace foothold).
    Step,
}

/// How well a top carries a body, best first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SupportGrade {
    /// Wide, with room beyond both feet and for the resting tail.
    Broad,
    /// A normal ledge, or the edge of a broad top.
    Ledge,
    /// Only just wide enough for the feet: authored narrow perches only.
    Narrow,
}

/// Why a stance is (or is not) carried. The serialized names are a stable contract, shared with the
/// TypeScript judge.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SupportCode {
    /// Carried.
    Supported,
    /// Nothing is drawn under the feet.
    NoSurface,
    /// The feet are inside a solid block, not on top of it.
    InsideSolid,
    /// The feet are on a vertical face.
    SideFace,
    /// The feet are on something drawn that is not terrain.
    NotTerrain,
    /// The top under the feet is too thin to be a solid.
    TooThin,
    /// The feet do not both fit on the top.
    FeetUnsupported,
    /// The feet are off the top and only the tail would touch it.
    TailOnly,
    /// The centre of mass falls outside the top, or too near its end.
    ComUnsupported,
    /// A narrow ledge, and no narrow perch was authored.
    NarrowNotAuthorized,
    /// Protected text sits where the feet touch.
    TextContact,
}

/// Where the resting tail tip comes down.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TailRest {
    /// On the same top: a tripod.
    OnSupport,
    /// Past its end: the tail is released.
    Free,
}

/// A horizontal extent, px.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Span {
    /// Left end.
    pub x0: f64,
    /// Right end.
    pub x1: f64,
}

/// One stance to judge.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StanceQuery {
    /// Where the feet are, px.
    pub at: Vec2,
    /// Character scale.
    pub scale: f64,
    /// +1 facing right, -1 facing left.
    pub facing: i8,
    /// A perch or a passing step.
    pub role: ContactRole,
    /// The lesson authored a narrow perch here.
    pub narrow_allowed: bool,
}

/// The judge's verdict on one stance (the TypeScript `SupportVerdict` without its prose).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportVerdict {
    /// Carried.
    pub ok: bool,
    /// Why.
    pub code: SupportCode,
    /// The surface carrying (or failing to carry) the feet.
    pub surface: Option<String>,
    /// What that surface offers.
    pub support: Option<SupportClass>,
    /// How well it carries the body, when it does.
    pub grade: Option<SupportGrade>,
    /// Width of the top under the feet, px (0 without one).
    pub width_px: f64,
    /// Both feet's span, px.
    pub feet: Span,
    /// The projected centre of mass, px.
    pub com_x: f64,
    /// Top left beyond the feet behind them, px (negative: past the end).
    pub margin_back_px: f64,
    /// Top left beyond the feet ahead of them, px.
    pub margin_front_px: f64,
    /// Top left beyond the centre of mass toward the nearer end, px.
    pub com_margin_px: f64,
    /// Where the resting tail comes down.
    pub tail: TailRest,
}

fn finite_query(q: &StanceQuery) -> Result<(), MotionError> {
    if !q.at.is_finite() || !q.scale.is_finite() {
        return refuse(
            MotionErrorCode::NonFiniteValue,
            "a stance needs a finite point and scale",
        );
    }
    if !(q.scale > 0.0 && q.scale <= 4.0) {
        return refuse(
            MotionErrorCode::InvalidInput,
            format!("stance scale {} is outside (0, 4]", q.scale),
        );
    }
    if q.facing != 1 && q.facing != -1 {
        return refuse(MotionErrorCode::InvalidInput, "a stance faces +1 or -1");
    }
    Ok(())
}

/// Strictly inside a solid: below its top, between its faces, above its bottom.
fn inside_solid(surfaces: &[TerrainSurface], p: Vec2, tol: f64, frame_bottom: f64) -> Option<String> {
    solids_of(surfaces, frame_bottom).into_iter().find_map(|s| {
        let r = s.rect;
        let inside = p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol;
        inside.then_some(s.element)
    })
}

/// What a contact is judged against: the declared surfaces, the text no contact may touch, the
/// support configuration, the body's standing height at scale 1, and the frame's bottom edge (which
/// bounds the ground's solid).
#[derive(Clone, Copy, Debug)]
pub struct Judge<'a> {
    /// The declared surfaces.
    pub surfaces: &'a [TerrainSurface],
    /// The protected text.
    pub text: &'a [Rect],
    /// The support configuration.
    pub cfg: &'a SupportConfig,
    /// Rig standing height at scale 1, px.
    pub body_height_px: f64,
    /// The frame's bottom edge, px.
    pub frame_bottom: f64,
}

/// Judge one stance: feet on a top, centre of mass, thickness, text, narrow-ness, and the tail.
pub fn evaluate_stance(q: &StanceQuery, judge: &Judge<'_>) -> Result<SupportVerdict, MotionError> {
    let Judge {
        surfaces,
        text,
        cfg,
        body_height_px,
        frame_bottom,
    } = *judge;
    finite_query(q)?;
    let facing = f64::from(q.facing);
    let bh = body_height_px * q.scale;
    let tol = cfg.tolerance_px;
    let back = q.at.x - facing * cfg.footprint_back_body_heights * bh;
    let front = q.at.x + facing * cfg.footprint_front_body_heights * bh;
    let feet = if back < front {
        Span { x0: back, x1: front }
    } else {
        Span { x0: front, x1: back }
    };
    let com_x = q.at.x + facing * cfg.com_ahead_body_heights * bh;
    let tail_x = q.at.x - facing * cfg.tail_reach_body_heights * bh;
    let verdict = |ok: bool, code: SupportCode, s: Option<&TerrainSurface>| SupportVerdict {
        ok,
        code,
        surface: s.map(|s| s.id.clone()),
        support: s.map(|s| s.support),
        grade: None,
        width_px: 0.0,
        feet,
        com_x,
        margin_back_px: 0.0,
        margin_front_px: 0.0,
        com_margin_px: 0.0,
        tail: TailRest::Free,
    };

    // Tops level with the feet whose extent overlaps them; solids before drawn lines, then the most overlap.
    let level: Vec<&TerrainSurface> = surfaces
        .iter()
        .filter(|s| s.is_top() && (s.y0 - q.at.y).abs() <= tol && s.x1 > feet.x0 && s.x0 < feet.x1)
        .collect();
    let overlap = |s: &TerrainSurface| {
        (if s.x1 < feet.x1 { s.x1 } else { feet.x1 }) - (if s.x0 > feet.x0 { s.x0 } else { feet.x0 })
    };
    let mut top: Option<&TerrainSurface> = None;
    for s in &level {
        if !s.support.carries_feet() {
            continue;
        }
        if top.is_none_or(|t| overlap(s) > overlap(t)) {
            top = Some(s);
        }
    }
    let Some(top) = top else {
        let drawn = level.first().copied().or_else(|| {
            surfaces
                .iter()
                .find(|s| s.face == Face::Line && near_segment(q.at, Vec2::new(s.x0, s.y0), Vec2::new(s.x1, s.y1), tol))
        });
        if let Some(d) = drawn {
            return Ok(verdict(false, SupportCode::NotTerrain, Some(d)));
        }
        let side = surfaces
            .iter()
            .find(|s| s.is_face() && (s.x0 - q.at.x).abs() <= tol && q.at.y > s.y0 + tol && q.at.y <= s.y1 + tol);
        if let Some(s) = side {
            return Ok(verdict(false, SupportCode::SideFace, Some(s)));
        }
        if inside_solid(surfaces, q.at, tol, frame_bottom).is_some() {
            return Ok(verdict(false, SupportCode::InsideSolid, None));
        }
        let tail_top = surfaces.iter().find(|s| {
            s.is_top() && s.support.carries_feet() && (s.y0 - q.at.y).abs() <= tol && tail_x >= s.x0 && tail_x <= s.x1
        });
        if let Some(s) = tail_top {
            return Ok(verdict(false, SupportCode::TailOnly, Some(s)));
        }
        return Ok(verdict(false, SupportCode::NoSurface, None));
    };

    let width_px = top.x1 - top.x0;
    let margin_back_px = if q.facing > 0 {
        feet.x0 - top.x0
    } else {
        top.x1 - feet.x1
    };
    let margin_front_px = if q.facing > 0 {
        top.x1 - feet.x1
    } else {
        feet.x0 - top.x0
    };
    let com_margin_px = if com_x - top.x0 < top.x1 - com_x {
        com_x - top.x0
    } else {
        top.x1 - com_x
    };
    let tail = if tail_x >= top.x0 && tail_x <= top.x1 {
        TailRest::OnSupport
    } else {
        TailRest::Free
    };
    let measured = |ok: bool, code: SupportCode, grade: Option<SupportGrade>| SupportVerdict {
        ok,
        code,
        surface: Some(top.id.clone()),
        support: Some(top.support),
        grade,
        width_px,
        feet,
        com_x,
        margin_back_px,
        margin_front_px,
        com_margin_px,
        tail,
    };
    if top.thickness_px < cfg.min_thickness_px {
        return Ok(measured(false, SupportCode::TooThin, None));
    }
    if feet.x0 < top.x0 || feet.x1 > top.x1 {
        return Ok(measured(false, SupportCode::FeetUnsupported, None));
    }
    let need = (if q.role == ContactRole::Perch {
        cfg.com_margin_body_heights
    } else {
        cfg.step_com_margin_body_heights
    }) * bh;
    if com_margin_px < need {
        return Ok(measured(false, SupportCode::ComUnsupported, None));
    }
    let zone = Rect {
        x: feet.x0,
        y: q.at.y - cfg.contact_height_body_heights * bh,
        w: feet.x1 - feet.x0,
        h: cfg.contact_height_body_heights * bh,
    };
    if text.iter().any(|r| zone.intersects(r)) {
        return Ok(measured(false, SupportCode::TextContact, None));
    }
    let narrow = top.support == SupportClass::NarrowLedge || width_px < cfg.narrow_width_body_heights * bh;
    if narrow && q.role == ContactRole::Perch && !q.narrow_allowed {
        return Ok(measured(false, SupportCode::NarrowNotAuthorized, None));
    }
    let broad_margin = cfg.broad_margin_body_heights * bh;
    let grade = if narrow {
        SupportGrade::Narrow
    } else if width_px >= cfg.broad_width_body_heights * bh
        && margin_back_px >= broad_margin
        && margin_front_px >= broad_margin
        && tail == TailRest::OnSupport
    {
        SupportGrade::Broad
    } else {
        SupportGrade::Ledge
    };
    Ok(measured(true, SupportCode::Supported, Some(grade)))
}

/// The chosen candidate: its index in the authored list, the stand itself, and every candidate's verdict.
#[derive(Clone, Debug, PartialEq)]
pub struct SupportChoice {
    /// Index of the chosen candidate.
    pub index: usize,
    /// The chosen stand, px: `candidates[index]`, bit for bit.
    pub at: Vec2,
    /// Every candidate's verdict, in authored order.
    pub verdicts: Vec<SupportVerdict>,
}

/// The facing a perch at `at` takes toward the lesson's subject (`focus`): the motion layer's rule.
pub fn facing_toward(at: Vec2, focus: Vec2) -> i8 {
    if focus.x < at.x - 12.0 { -1 } else { 1 }
}

/// Choose among the lesson's authored candidate stands for one destination: the best grade, then a
/// tail resting on the support, then the authored order. Refuses (`ImplausibleSupport`) when no
/// candidate is a plausible perch. It can only pick one of `candidates`; it never moves one.
pub fn select_support(
    candidates: &[Vec2],
    scale: f64,
    focus: Vec2,
    narrow_allowed: bool,
    judge: &Judge<'_>,
) -> Result<SupportChoice, MotionError> {
    if candidates.is_empty() {
        return refuse(MotionErrorCode::ImplausibleSupport, "the destination authors no stand");
    }
    let mut verdicts = Vec::with_capacity(candidates.len());
    for at in candidates {
        let q = StanceQuery {
            at: *at,
            scale,
            facing: facing_toward(*at, focus),
            role: ContactRole::Perch,
            narrow_allowed,
        };
        verdicts.push(evaluate_stance(&q, judge)?);
    }
    // The best so far: its index, stand, grade, and tail (no indexing, so nothing here can panic).
    let mut best: Option<(usize, Vec2, SupportGrade, TailRest)> = None;
    for (i, (v, at)) in verdicts.iter().zip(candidates).enumerate() {
        let (Some(grade), true) = (v.grade, v.ok) else { continue };
        let better = best.is_none_or(|(_, _, g, tail)| {
            grade < g || (grade == g && v.tail == TailRest::OnSupport && tail == TailRest::Free)
        });
        if better {
            best = Some((i, *at, grade, v.tail));
        }
    }
    match best {
        Some((index, at, _, _)) => Ok(SupportChoice { index, at, verdicts }),
        None => {
            let codes: Vec<String> = verdicts
                .iter()
                .enumerate()
                .map(|(i, v)| format!("#{i} {:?}", v.code))
                .collect();
            refuse(
                MotionErrorCode::ImplausibleSupport,
                format!("no authored stand is a plausible perch: {}", codes.join(", ")),
            )
        }
    }
}

// ── Hands ───────────────────────────────────────────────────────────────────

/// Why a hand contact is (or is not) plausible. A stable contract, shared with the TypeScript judge.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HandCode {
    /// A climbing hand holds a real lip.
    Gripped,
    /// A hand braces against a face that takes one.
    Braced,
    /// Not the lip where a solid top meets its own side face.
    NotALip,
    /// Not a face a hand can brace against.
    NotBraceable,
    /// The face is behind the body.
    BehindTheBody,
    /// Further than the arm reaches from the shoulder.
    OutOfReach,
    /// The feet are not supported (a brace never replaces support).
    FeetNotSupported,
}

/// The judge's verdict on one hand contact.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandVerdict {
    /// Plausible.
    pub ok: bool,
    /// Why.
    pub code: HandCode,
    /// The face (or top) involved.
    pub surface: Option<String>,
    /// Distance from the shoulder to the hand, px.
    pub reach_px: f64,
    /// How far the arm reaches at this scale, px.
    pub limit_px: f64,
}

/// One climbing grip to judge.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GripQuery {
    /// The lip the hand holds, px.
    pub corner: Vec2,
    /// The shoulder it reaches from, px.
    pub shoulder: Vec2,
    /// Character scale.
    pub scale: f64,
}

/// One bracing hand to judge.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BraceQuery {
    /// The stance the body braces from.
    pub stance: StanceQuery,
    /// Where the hand presses, px.
    pub hand: Vec2,
}

/// Distance from explicit squares (sqrt is correctly rounded on every target, like the TypeScript side).
fn distance(a: Vec2, b: Vec2) -> f64 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    sqrt(dx * dx + dy * dy)
}

/// A climbing grip: `corner` must be a real lip (the end of a solid top that drops away into a face of
/// the same block) within the arm's reach of `shoulder`.
pub fn evaluate_grip(g: &GripQuery, judge: &Judge<'_>) -> Result<HandVerdict, MotionError> {
    let Judge {
        surfaces,
        cfg,
        body_height_px,
        ..
    } = *judge;
    let finite = g.corner.is_finite() && g.shoulder.is_finite() && g.scale.is_finite();
    if !(finite && g.scale > 0.0 && g.scale <= 4.0) {
        return refuse(
            MotionErrorCode::InvalidInput,
            "a grip needs finite points and a scale in (0, 4]",
        );
    }
    let tol = cfg.tolerance_px;
    let limit_px = cfg.arm_reach_body_heights * body_height_px * g.scale;
    let reach_px = distance(g.corner, g.shoulder);
    let top = surfaces.iter().find(|s| {
        s.is_top()
            && s.support.carries_feet()
            && (s.y0 - g.corner.y).abs() <= tol
            && ((s.x0 - g.corner.x).abs() <= tol || (s.x1 - g.corner.x).abs() <= tol)
    });
    let face = top.and_then(|t| {
        surfaces.iter().find(|s| {
            s.element == t.element && s.is_face() && s.support.takes_a_hand() && (s.x0 - g.corner.x).abs() <= tol
        })
    });
    let verdict = |ok: bool, code: HandCode, surface: Option<&TerrainSurface>| HandVerdict {
        ok,
        code,
        surface: surface.map(|s| s.id.clone()),
        reach_px,
        limit_px,
    };
    let (Some(_), Some(face)) = (top, face) else {
        return Ok(verdict(false, HandCode::NotALip, top));
    };
    if reach_px > limit_px {
        return Ok(verdict(false, HandCode::OutOfReach, Some(face)));
    }
    Ok(verdict(true, HandCode::Gripped, Some(face)))
}

/// A bracing hand: on a face that takes one, ahead of the body, within reach, while the feet stand supported.
pub fn evaluate_brace(b: &BraceQuery, judge: &Judge<'_>) -> Result<HandVerdict, MotionError> {
    let Judge {
        surfaces,
        cfg,
        body_height_px,
        ..
    } = *judge;
    let feet = evaluate_stance(&b.stance, judge)?;
    if !b.hand.is_finite() {
        return refuse(MotionErrorCode::NonFiniteValue, "a brace needs a finite hand point");
    }
    let s = &b.stance;
    let facing = f64::from(s.facing);
    let bh = body_height_px * s.scale;
    let shoulder = Vec2::new(
        s.at.x + facing * cfg.shoulder_ahead_body_heights * bh,
        s.at.y - cfg.shoulder_height_body_heights * bh,
    );
    let limit_px = cfg.arm_reach_body_heights * bh;
    let reach_px = distance(b.hand, shoulder);
    let tol = cfg.tolerance_px;
    let face = surfaces
        .iter()
        .find(|f| f.is_face() && (f.x0 - b.hand.x).abs() <= tol && b.hand.y >= f.y0 - tol && b.hand.y <= f.y1 + tol);
    let verdict = |ok: bool, code: HandCode| HandVerdict {
        ok,
        code,
        surface: face.map(|f| f.id.clone()),
        reach_px,
        limit_px,
    };
    if !feet.ok {
        return Ok(verdict(false, HandCode::FeetNotSupported));
    }
    if !face.is_some_and(|f| f.support.takes_a_hand()) {
        return Ok(verdict(false, HandCode::NotBraceable));
    }
    if (b.hand.x - s.at.x) * facing <= 0.0 {
        return Ok(verdict(false, HandCode::BehindTheBody));
    }
    if reach_px > limit_px {
        return Ok(verdict(false, HandCode::OutOfReach));
    }
    Ok(verdict(true, HandCode::Braced))
}

// ── Queries ─────────────────────────────────────────────────────────────────

/// Most stances, grips, or braces one query may carry, each.
pub const MAX_QUERIES: usize = 4096;

/// What a query judges against: declared surfaces and the text no contact may touch.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct QueryTerrain {
    /// The declared surfaces.
    pub surfaces: Vec<TerrainSurface>,
    /// The protected text.
    pub protected_text: Vec<Rect>,
}

/// A `walletwall.support-query/v1` document: any number of stances, grips, and braces to judge
/// against one terrain, so that the engine itself can verify every contact a lesson makes, not only
/// the ones it plans.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SupportQuery {
    /// Must be [`crate::SUPPORT_QUERY_SCHEMA`].
    pub schema: String,
    /// The support section of the versioned configuration.
    pub config: SupportConfig,
    /// Rig standing height at scale 1, px.
    pub body_height_px: f64,
    /// The visible frame (its bottom edge bounds the ground's solid).
    pub stage: Stage,
    /// The terrain.
    pub terrain: QueryTerrain,
    /// Stances to judge.
    pub stances: Vec<StanceQuery>,
    /// Climbing grips to judge.
    pub grips: Vec<GripQuery>,
    /// Bracing hands to judge.
    pub braces: Vec<BraceQuery>,
}

/// The answer to a [`SupportQuery`]: one verdict per query, in order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportReport {
    /// [`crate::SUPPORT_REPORT_SCHEMA`].
    pub schema: &'static str,
    /// Which engine judged.
    pub engine: EngineId,
    /// One verdict per stance.
    pub stances: Vec<SupportVerdict>,
    /// One verdict per grip.
    pub grips: Vec<HandVerdict>,
    /// One verdict per brace.
    pub braces: Vec<HandVerdict>,
}

/// Judge every query in `q`, or refuse a malformed one.
pub fn answer_query(q: &SupportQuery) -> Result<SupportReport, MotionError> {
    use MotionErrorCode::{InvalidInput, NonFiniteValue};
    if q.schema != SUPPORT_QUERY_SCHEMA {
        return refuse(InvalidInput, format!("query.schema must be {SUPPORT_QUERY_SCHEMA}"));
    }
    q.config.validate()?;
    if !q.body_height_px.is_finite() || !q.stage.width.is_finite() || !q.stage.height.is_finite() {
        return refuse(NonFiniteValue, "query.bodyHeightPx or query.stage is not finite");
    }
    if !(16.0..=2048.0).contains(&q.body_height_px) {
        return refuse(
            InvalidInput,
            format!("query.bodyHeightPx={} is outside [16, 2048]", q.body_height_px),
        );
    }
    if !(16.0..=16_384.0).contains(&q.stage.width) || !(16.0..=16_384.0).contains(&q.stage.height) {
        return refuse(InvalidInput, "query.stage is not a plausible frame");
    }
    if q.stances.len() > MAX_QUERIES || q.grips.len() > MAX_QUERIES || q.braces.len() > MAX_QUERIES {
        return refuse(
            InvalidInput,
            format!("a query judges at most {MAX_QUERIES} of each contact"),
        );
    }
    let t = &q.terrain;
    check_surfaces(&t.surfaces, "terrain.surfaces")?;
    check_text(&t.protected_text, "terrain.protectedText")?;
    let judge = Judge {
        surfaces: &t.surfaces,
        text: &t.protected_text,
        cfg: &q.config,
        body_height_px: q.body_height_px,
        frame_bottom: q.stage.height,
    };
    let stances = q
        .stances
        .iter()
        .map(|s| evaluate_stance(s, &judge))
        .collect::<Result<Vec<_>, _>>()?;
    let grips = q
        .grips
        .iter()
        .map(|g| evaluate_grip(g, &judge))
        .collect::<Result<Vec<_>, _>>()?;
    let braces = q
        .braces
        .iter()
        .map(|b| evaluate_brace(b, &judge))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SupportReport {
        schema: SUPPORT_REPORT_SCHEMA,
        engine: EngineId {
            name: ENGINE_NAME,
            version: ENGINE_VERSION,
        },
        stances,
        grips,
        braces,
    })
}
