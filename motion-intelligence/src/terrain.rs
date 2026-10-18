//! Terrain, v1: the stage and the surfaces under the start and the target.
//!
//! There is no collision world here, only the contract that a destination is somewhere a body can
//! stand: on the stage and, when a surface is declared, on that surface's top edge. The test is
//! the same one the scene layout uses to decide which platform carries a point.

use alloc::format;
use serde::{Deserialize, Serialize};

use crate::error::{MotionError, MotionErrorCode, refuse};
use crate::math::Vec2;
use crate::state::Contact;

/// Vertical tolerance (px) for a point to stand on a surface's top edge.
pub const SURFACE_TOLERANCE_PX: f64 = 1.0;

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

/// The surfaces under the start and under the target (`null` = open ground). Both keys are
/// required: an omitted surface is refused rather than read as open ground.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Terrain {
    /// Surface carrying the start, if any.
    #[serde(deserialize_with = "present")]
    pub start: Option<Surface>,
    /// Surface carrying the target, if any.
    #[serde(deserialize_with = "present")]
    pub target: Option<Surface>,
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
