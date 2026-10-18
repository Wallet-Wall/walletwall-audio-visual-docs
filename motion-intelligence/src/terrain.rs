//! Terrain: the stage, the surfaces under the start and the target, and the text the figure should
//! not cross in flight.
//!
//! There is no collision world here, only the contract that a destination is somewhere a body can
//! stand (on the stage and, when a surface is declared, on that surface's top edge), plus what the
//! surface-aware arc search reads: the scene's protected text and the figure's layout box. Every
//! test is the one the scene layout uses, operation for operation: which platform carries a point,
//! where the figure's box is, and whether two rectangles overlap.

use alloc::format;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::Vec2;
use crate::state::Contact;

/// Vertical tolerance (px) for a point to stand on a surface's top edge.
pub const SURFACE_TOLERANCE_PX: f64 = 1.0;
/// Most protected text rectangles one input may carry.
pub const MAX_PROTECTED_TEXT: usize = 256;
/// Largest reach of the figure's layout box from the feet at scale 1, px.
pub const MAX_FIGURE_PX: f64 = 4096.0;

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

/// What kind of information terrain a surface is. UI captures are evidence, not terrain, and have
/// no kind here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurfaceKind {
    /// A text card.
    Card,
    /// A graph node.
    Node,
    /// A graph node's supporting pillar.
    Pillar,
    /// A summit ledge.
    Ledge,
}

/// A walkable top edge.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Surface {
    /// What the surface is.
    pub kind: SurfaceKind,
    /// The top edge, px.
    pub top_y: f64,
    /// Left end of the top edge, px.
    pub left_x: f64,
    /// Right end of the top edge, px.
    pub right_x: f64,
}

impl Surface {
    /// The surface carries `p`: on its top edge (within tolerance) and between its ends.
    pub fn supports(&self, p: Vec2) -> bool {
        (self.top_y - p.y).abs() <= SURFACE_TOLERANCE_PX && p.x >= self.left_x && p.x <= self.right_x
    }

    fn is_finite(&self) -> bool {
        self.top_y.is_finite() && self.left_x.is_finite() && self.right_x.is_finite()
    }
}

/// What the hop crosses and lands on: the surfaces under the start and under the target (`null` =
/// open ground), the text the figure should not cross in flight, and the figure's layout box.
/// Every key is required: an omitted surface is refused rather than read as open ground, and an
/// omitted list rather than read as empty.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Terrain {
    /// Surface carrying the start, if any.
    #[serde(deserialize_with = "present")]
    pub start: Option<Surface>,
    /// Surface carrying the target, if any.
    #[serde(deserialize_with = "present")]
    pub target: Option<Surface>,
    /// Text the figure should not cross in flight (the scene's text blocks and its eyebrow row), in
    /// the scene's order. Empty: nothing to avoid, so the hop flies its natural arc.
    pub protected_text: Vec<Rect>,
    /// The standing figure's layout box at scale 1.
    pub figure: FigureBox,
}

/// A surface or `null`; with `deserialize_with`, serde reports a missing key as an error instead of
/// silently defaulting the `Option` to `None`.
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Surface>, D::Error> {
    Option::<Surface>::deserialize(d)
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

/// How the feet touch what carries them.
pub fn contact_with(surface: Option<&Surface>) -> Contact {
    if surface.is_some() {
        Contact::Platform
    } else {
        Contact::Ground
    }
}

/// Refuse a start or target the stage and declared surfaces cannot support. The target must be on
/// the visible stage; the start may be off stage (entrances begin outside the frame) but within
/// one stage width or height of it.
pub fn check_geometry(start: Vec2, target: Vec2, stage: &Stage, terrain: &Terrain) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidInput, InvalidTarget, NonFiniteValue, OutOfBounds};
    if !stage.width.is_finite() || !stage.height.is_finite() {
        return refuse(NonFiniteValue, "stage size is not finite");
    }
    if !(16.0..=16_384.0).contains(&stage.width) || !(16.0..=16_384.0).contains(&stage.height) {
        return refuse(
            InvalidInput,
            format!("stage {}x{} is not a plausible frame", stage.width, stage.height),
        );
    }
    if target.x < 0.0 || target.x > stage.width || target.y < 0.0 || target.y > stage.height {
        return refuse(
            OutOfBounds,
            format!(
                "target ({}, {}) is outside the {}x{} stage",
                target.x, target.y, stage.width, stage.height
            ),
        );
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
    check_avoidance(terrain)?;
    for (name, surface, point) in [("start", terrain.start, start), ("target", terrain.target, target)] {
        let Some(s) = surface else { continue };
        if !s.is_finite() {
            return refuse(NonFiniteValue, format!("terrain.{name} is not finite"));
        }
        if s.left_x >= s.right_x {
            return refuse(
                InvalidInput,
                format!("terrain.{name} has an empty or inverted top edge"),
            );
        }
        if !s.supports(point) {
            let code = if name == "target" { InvalidTarget } else { InvalidInput };
            return refuse(
                code,
                format!(
                    "{name} ({}, {}) is not on its declared {:?} surface (top {}, x {}..{})",
                    point.x, point.y, s.kind, s.top_y, s.left_x, s.right_x
                ),
            );
        }
    }
    Ok(())
}

/// Refuse protected text or a figure box the arc search could not test honestly: non-finite
/// numbers, negative sizes, an empty or absurd figure, or more rectangles than a scene has.
fn check_avoidance(terrain: &Terrain) -> Result<(), MotionError> {
    use MotionErrorCode::{InvalidInput, NonFiniteValue};
    let text = &terrain.protected_text;
    if text.len() > MAX_PROTECTED_TEXT {
        return refuse(
            InvalidInput,
            format!(
                "terrain.protectedText has {} rectangles, over the limit of {MAX_PROTECTED_TEXT}",
                text.len()
            ),
        );
    }
    for (k, r) in text.iter().enumerate() {
        if !r.is_finite() {
            return refuse(NonFiniteValue, format!("terrain.protectedText[{k}] is not finite"));
        }
        if r.w < 0.0 || r.h < 0.0 {
            return refuse(InvalidInput, format!("terrain.protectedText[{k}] has a negative size"));
        }
    }
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
