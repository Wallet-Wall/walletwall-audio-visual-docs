//! Fail-closed refusals. Every refusal carries a stable machine code (the same string on both
//! sides of the WebAssembly boundary) and a human-readable message for diagnostics.

use alloc::string::String;
use core::fmt;
use serde::Serialize;

/// Why the engine refused to produce a plan. The serialized names are a stable contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MotionErrorCode {
    /// Malformed input: wrong shape or type, an unknown field, or an out-of-range scalar.
    InvalidInput,
    /// A NaN or infinite number anywhere in the input or configuration.
    NonFiniteValue,
    /// A time window that is negative, empty, inverted, too long, or too short for the move.
    InvalidDuration,
    /// A destination the declared terrain cannot support.
    InvalidTarget,
    /// No trajectory reaches the target inside the window under the physics limits.
    UnsolvableTrajectory,
    /// A coordinate outside the stage, or an output channel outside its limit.
    OutOfBounds,
    /// A configuration value that is missing, out of range, or inconsistent with another.
    InvalidConfig,
    /// An action this engine version does not perform (mantle, vault, push-through, ...).
    UnsupportedAction,
    /// No authored stand is a plausible perch, or the takeoff or the landing is not carried by the
    /// terrain on screen ([`crate::support`]).
    ImplausibleSupport,
}

/// A refusal: the engine produced no plan.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MotionError {
    /// Stable reason code.
    pub code: MotionErrorCode,
    /// What exactly was refused, for a human reading the log.
    pub message: String,
}

impl MotionError {
    /// A refusal with `code` and `message`.
    pub fn new(code: MotionErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for MotionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl core::error::Error for MotionError {}

/// Shorthand for building a refusal.
pub(crate) fn refuse<T>(code: MotionErrorCode, message: impl Into<String>) -> Result<T, MotionError> {
    Err(MotionError::new(code, message))
}
