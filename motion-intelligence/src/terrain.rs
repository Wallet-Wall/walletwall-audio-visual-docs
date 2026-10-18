//! Terrain: the stage, the semantic surfaces the scene draws, and the text the figure should not
//! cross in flight.
//!
//! There is no collision world here, only what each drawn element offers a body, as the scene
//! layout declares it (`src/layout/terrain.ts`): a solid top to stand on (graded for a body by
//! [`crate::support`]), a block's side face (a hand may brace on it, its lip may be gripped, never
//! feet), a drawn line or edge (never terrain at all). Every test is the one the TypeScript side
//! uses, operation for operation.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::{Vec2, clamp};
use crate::state::Contact;

/// Most protected text rectangles one input may carry.
pub const MAX_PROTECTED_TEXT: usize = 256;
/// Most surfaces one terrain may carry.
pub const MAX_SURFACES: usize = 512;
/// Largest reach of the figure's layout box from the feet at scale 1, px.
pub const MAX_FIGURE_PX: f64 = 4096.0;
/// Bounds every surface coordinate must lie within, px (far beyond any frame; refuses absurd values).
const MAX_COORD_PX: f64 = 1.0e6;

/// An axis-aligned rectangle in frame pixels: `(x, y)` is the top-left corner.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    /// Left edge, px.
    pub x: f64,
    /// Top edge, px.
    pub y: f64,
    /// Width, px.
    pub w: f64,
    /// Height, px.
    pub h: f64,
}

impl Rect {
    /// The two rectangles overlap with positive area (edges that only touch do not): the scene
    /// layout's `intersects(self, other)`, operation for operation.
    pub fn intersects(&self, other: &Rect) -> bool {
        self.x < other.x + other.w
            && other.x < self.x + self.w
            && self.y < other.y + other.h
            && other.y < self.y + self.h
    }

    fn is_finite(&self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.w.is_finite() && self.h.is_finite()
    }
}

/// The standing figure's layout box at scale 1, measured from the feet: how far it reaches to the
/// left, to the right, and up, px (the scene layout's `WALLABY_EXTENT`).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FigureBox {
    /// Reach to the left of the feet, px.
    pub left: f64,
    /// Reach to the right of the feet, px.
    pub right: f64,
    /// Height above the feet, px.
    pub top: f64,
}

impl FigureBox {
    /// The box with the feet at `feet` and the character at `scale`: the scene layout's
    /// `wallabyBounds(feet, scale)`, operation for operation.
    pub fn at(&self, feet: Vec2, scale: f64) -> Rect {
        Rect {
            x: feet.x - self.left * scale,
            y: feet.y - self.top * scale,
            w: (self.left + self.right) * scale,
            h: self.top * scale,
        }
    }
}

/// What a surface offers, as the scene grammar declares it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SupportClass {
    /// A solid top the feet may stand on (a card, a node, the ground).
    SupportedSurface,
    /// A solid top with a drop beside it (the summit ledge).
    Ledge,
    /// A solid top only just wide enough for the feet: only an authored narrow perch may use it.
    NarrowLedge,
    /// A hairline, underline, divider, or border: drawn, never terrain.
    DecorativeEdge,
    /// The vertical face of a solid block: a hand may brace on it, its lip may be gripped; never feet.
    SideFace,
    /// Information that is not terrain (a route line, a UI capture's top): nothing touches it.
    NonSupporting,
    /// A face a hand may brace against while the feet stand elsewhere; nothing stands on it.
    OptionalBrace,
}

impl SupportClass {
    /// A top of this class carries feet.
    pub fn carries_feet(self) -> bool {
        matches!(
            self,
            SupportClass::SupportedSurface | SupportClass::Ledge | SupportClass::NarrowLedge
        )
    }

    /// A face of this class takes a hand.
    pub fn takes_a_hand(self) -> bool {
        matches!(self, SupportClass::SideFace | SupportClass::OptionalBrace)
    }
}

/// Which way a surface faces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Face {
    /// A horizontal top, from `(x0, y0)` to `(x1, y0)`.
    Top,
    /// A block's left face, the vertical segment at `x0` from its top `y0` down to `y1`.
    Left,
    /// A block's right face, likewise.
    Right,
    /// A drawn line from `(x0, y0)` to `(x1, y1)`.
    Line,
}

/// One declared surface (`src/layout/terrain.ts` `TerrainSurface`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TerrainSurface {
    /// Stable id (`<element>:<face>`, or a route segment).
    pub id: String,
    /// The element the surface belongs to: a platform id, a route id, or `ground`.
    pub element: String,
    /// Which way it faces.
    pub face: Face,
    /// What it offers.
    pub support: SupportClass,
    /// Geometry, px (see [`Face`]).
    pub x0: f64,
    /// Geometry, px.
    pub y0: f64,
    /// Geometry, px.
    pub x1: f64,
    /// Geometry, px.
    pub y1: f64,
    /// Visible thickness behind the surface, px (a solid block's depth; a hairline's width).
    pub thickness_px: f64,
}

impl TerrainSurface {
    /// A horizontal top.
    pub fn is_top(&self) -> bool {
        self.face == Face::Top
    }

    /// A vertical block face.
    pub fn is_face(&self) -> bool {
        matches!(self.face, Face::Left | Face::Right)
    }
}

/// What a hop crosses and stands on: the scene's own surfaces, the text the figure should not cross
/// in flight (and no contact may touch), the outgoing scene's terrain (still on screen while this
/// scene transitions in), and the figure's layout box. Every key is required.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Terrain {
    /// The segment's own declared surfaces.
    pub surfaces: Vec<TerrainSurface>,
    /// Text the figure should not cross in flight (the scene's text blocks and its eyebrow row), in
    /// the scene's order. Empty: nothing to avoid, so the hop flies its natural arc.
    pub protected_text: Vec<Rect>,
    /// The previous segment's terrain, on screen under the feet until this segment's content takes
    /// over.
    pub outgoing: OutgoingTerrain,
    /// The standing figure's layout box at scale 1.
    pub figure: FigureBox,
}

/// The previous segment's terrain while this one transitions in: a contact before `until_ms` may
/// stand on it (the previous scene is still on screen under the feet). Empty lists when the
/// segment has no predecessor with terrain.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OutgoingTerrain {
    /// Its declared surfaces.
    pub surfaces: Vec<TerrainSurface>,
    /// Its protected text.
    pub protected_text: Vec<Rect>,
    /// When this segment's own content takes the screen, ms.
    pub until_ms: f64,
}

/// The visible frame.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Stage {
    /// Width, px.
    pub width: f64,
    /// Height, px.
    pub height: f64,
}

impl Stage {
    /// The point is inside the visible frame (edges included).
    pub fn contains(&self, p: Vec2) -> bool {
        p.x >= 0.0 && p.x <= self.width && p.y >= 0.0 && p.y <= self.height
    }
}

/// How close the feet must be to a platform's top to stand on it, px: the transitional planner's
/// `surfaceUnder` tolerance.
pub const PLATFORM_TOLERANCE_PX: f64 = 1.0;

/// What the feet touch at `p`: a platform when a solid platform top in `surfaces` carries the point
/// (level with it, between its ends), otherwise the ground. The transitional planner's `surfaceUnder`
/// for every top that carries feet (the ground and the drawn lines are not platforms).
pub fn contact_at(p: Vec2, surfaces: &[TerrainSurface]) -> Contact {
    let on = surfaces.iter().any(|s| {
        s.is_top()
            && s.support.carries_feet()
            && s.element != "ground"
            && (s.y0 - p.y).abs() <= PLATFORM_TOLERANCE_PX
            && p.x >= s.x0
            && p.x <= s.x1
    });
    if on { Contact::Platform } else { Contact::Ground }
}

/// A block a body can stand on but never pass through.
#[derive(Clone, Debug, PartialEq)]
pub struct Solid {
    /// The element.
    pub element: String,
    /// Its box.
    pub rect: Rect,
}

/// Every solid, in declaration order: each element with both side faces, and the ground below its
/// line down to `frame_bottom` (`src/layout/terrain.ts` `solidsOf`, operation for operation).
pub fn solids_of(surfaces: &[TerrainSurface], frame_bottom: f64) -> Vec<Solid> {
    let mut out = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for s in surfaces {
        if seen.contains(&s.element.as_str()) {
            continue;
        }
        seen.push(&s.element);
        let left = surfaces.iter().find(|x| x.element == s.element && x.face == Face::Left);
        let right = surfaces
            .iter()
            .find(|x| x.element == s.element && x.face == Face::Right);
        if let (Some(l), Some(r)) = (left, right) {
            let y0 = if l.y0 < r.y0 { l.y0 } else { r.y0 };
            let y1 = if l.y1 > r.y1 { l.y1 } else { r.y1 };
            out.push(Solid {
                element: s.element.clone(),
                rect: Rect {
                    x: l.x0,
                    y: y0,
                    w: r.x0 - l.x0,
                    h: y1 - y0,
                },
            });
        } else if s.element == "ground" && s.face == Face::Top {
            out.push(Solid {
                element: s.element.clone(),
                rect: Rect {
                    x: s.x0,
                    y: s.y0,
                    w: s.x1 - s.x0,
                    h: frame_bottom - s.y0,
                },
            });
        }
    }
    out
}

/// The point lies within `tol` of the segment a-b (squares only: the TypeScript `nearSegment`).
pub fn near_segment(p: Vec2, a: Vec2, b: Vec2, tol: f64) -> bool {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let l2 = dx * dx + dy * dy;
    let mut t = if l2 == 0.0 {
        0.0
    } else {
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2
    };
    t = clamp(t, 0.0, 1.0);
    let ex = p.x - (a.x + dx * t);
    let ey = p.y - (a.y + dy * t);
    ex * ex + ey * ey <= tol * tol
}

/// Refuse a terrain the support judge could not read honestly: too many surfaces, non-finite or
/// absurd numbers, an empty id, a top that is not level or has no width, a face that is not vertical,
/// or a negative thickness (`src/character/walletwallaby/support.ts` `checkTerrain`).
pub fn check_surfaces(surfaces: &[TerrainSurface], what: &str) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidInput, NonFiniteValue};
    if surfaces.len() > MAX_SURFACES {
        return refuse(
            InvalidInput,
            format!(
                "{what} has {} surfaces, over the limit of {MAX_SURFACES}",
                surfaces.len()
            ),
        );
    }
    for (k, s) in surfaces.iter().enumerate() {
        let at = || format!("{what}[{k}] ({})", s.id);
        let numbers = [s.x0, s.y0, s.x1, s.y1, s.thickness_px];
        if !numbers.iter().all(|v| v.is_finite()) {
            return refuse(NonFiniteValue, format!("{} is not finite", at()));
        }
        if numbers.iter().any(|v| v.abs() > MAX_COORD_PX) {
            return refuse(InvalidInput, format!("{} has an absurd coordinate", at()));
        }
        if s.id.is_empty() || s.element.is_empty() {
            return refuse(InvalidInput, format!("{what}[{k}] has no id or element"));
        }
        if s.thickness_px < 0.0 {
            return refuse(InvalidInput, format!("{} has a negative thickness", at()));
        }
        match s.face {
            Face::Top if !(s.x1 > s.x0 && s.y0.to_bits() == s.y1.to_bits()) => {
                return refuse(InvalidInput, format!("{} is not a level top with positive width", at()));
            }
            Face::Left | Face::Right if !(s.x0.to_bits() == s.x1.to_bits() && s.y1 > s.y0) => {
                return refuse(InvalidInput, format!("{} is not a vertical face", at()));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Refuse protected text the arc search and the support judge could not test honestly.
pub fn check_text(text: &[Rect], what: &str) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidInput, NonFiniteValue};
    if text.len() > MAX_PROTECTED_TEXT {
        return refuse(
            InvalidInput,
            format!(
                "{what} has {} rectangles, over the limit of {MAX_PROTECTED_TEXT}",
                text.len()
            ),
        );
    }
    for (k, r) in text.iter().enumerate() {
        if !r.is_finite() {
            return refuse(NonFiniteValue, format!("{what}[{k}] is not finite"));
        }
        if r.w < 0.0 || r.h < 0.0 {
            return refuse(InvalidInput, format!("{what}[{k}] has a negative size"));
        }
    }
    Ok(())
}

/// Refuse a stage, start, candidates, or terrain the engine cannot reason about honestly. Every
/// candidate must be on the visible stage; the start may be off stage (entrances begin outside the
/// frame) but within one stage width or height of it.
pub fn check_geometry(start: Vec2, candidates: &[Vec2], stage: &Stage, terrain: &Terrain) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidInput, NonFiniteValue, OutOfBounds};
    if !stage.width.is_finite() || !stage.height.is_finite() {
        return refuse(NonFiniteValue, "stage size is not finite");
    }
    if !(16.0..=16_384.0).contains(&stage.width) || !(16.0..=16_384.0).contains(&stage.height) {
        return refuse(
            InvalidInput,
            format!("stage {}x{} is not a plausible frame", stage.width, stage.height),
        );
    }
    for (k, c) in candidates.iter().enumerate() {
        if !stage.contains(*c) {
            return refuse(
                OutOfBounds,
                format!(
                    "destination.candidates[{k}] ({}, {}) is outside the {}x{} stage",
                    c.x, c.y, stage.width, stage.height
                ),
            );
        }
    }
    let (w, h) = (stage.width, stage.height);
    if start.x < -w || start.x > 2.0 * w || start.y < -h || start.y > 2.0 * h {
        return refuse(
            OutOfBounds,
            format!(
                "start ({}, {}) is more than a stage away from the frame",
                start.x, start.y
            ),
        );
    }
    if !terrain.outgoing.until_ms.is_finite() {
        return refuse(NonFiniteValue, "terrain.outgoing.untilMs is not finite");
    }
    check_surfaces(&terrain.surfaces, "terrain.surfaces")?;
    check_text(&terrain.protected_text, "terrain.protectedText")?;
    check_surfaces(&terrain.outgoing.surfaces, "terrain.outgoing.surfaces")?;
    check_text(&terrain.outgoing.protected_text, "terrain.outgoing.protectedText")?;
    let f = terrain.figure;
    if !(f.left.is_finite() && f.right.is_finite() && f.top.is_finite()) {
        return refuse(NonFiniteValue, "terrain.figure is not finite");
    }
    let reach = 0.0..=MAX_FIGURE_PX;
    let plausible = reach.contains(&f.left)
        && reach.contains(&f.right)
        && f.left + f.right > 0.0
        && f.top > 0.0
        && f.top <= MAX_FIGURE_PX;
    if !plausible {
        return refuse(
            InvalidInput,
            format!(
                "terrain.figure (left {}, right {}, top {}) is not a figure's box",
                f.left, f.right, f.top
            ),
        );
    }
    Ok(())
}
