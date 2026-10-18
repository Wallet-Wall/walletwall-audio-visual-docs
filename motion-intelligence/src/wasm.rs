//! The WebAssembly boundary (wasm32 only).
//!
//! The module imports nothing from its host: no clock, no randomness, no environment, no I/O.
//! It exports linear memory and five functions:
//!
//! | export | protocol |
//! |---|---|
//! | `mi_abi_version() -> u32` | [`crate::ABI_VERSION`] |
//! | `mi_input(len) -> ptr` | resets the arena and reserves `len` bytes for one input document (0 = refused) |
//! | `mi_solve() -> status` | solves the reserved input: 0 = plan, 1 = refusal, 2 = no input reserved |
//! | `mi_output_ptr() -> ptr` | the output document (plan or refusal JSON) |
//! | `mi_output_len() -> len` | its length in bytes |
//!
//! Memory is a bump arena reset by every `mi_input`, so each solve starts from the same state and
//! no allocation outlives the next call; the host copies the output before reserving again. A
//! panic traps (`unreachable`); the host treats a trap as a refusal.

#![allow(unsafe_code)]

use alloc::vec;
use core::alloc::{GlobalAlloc, Layout};
use core::arch::wasm32;
use core::cell::Cell;
use core::ptr::null_mut;

use crate::error::{MotionError, MotionErrorCode};
use crate::{ABI_VERSION, MAX_INPUT_BYTES, error_json, solve_json};

const PAGE: usize = 65_536;
/// Most memory the arena may claim, bytes.
const ARENA_LIMIT: usize = 64 << 20;

/// A bump allocator over pages grown past the module's initial memory.
struct Arena {
    base: Cell<usize>,
    next: Cell<usize>,
    end: Cell<usize>,
}

// SAFETY: wasm32-unknown-unknown is built without the atomics feature: one thread, no sharing.
unsafe impl Sync for Arena {}

impl Arena {
    fn init(&self) {
        if self.base.get() == 0 {
            let start = wasm32::memory_size(0) * PAGE;
            self.base.set(start);
            self.next.set(start);
            self.end.set(start);
        }
    }

    fn reset(&self) {
        self.init();
        self.next.set(self.base.get());
    }
}

// SAFETY: every block handed out lies inside memory this arena grew, is aligned as requested, and
// is never handed out twice before a reset; `mi_input` resets only when the host has finished
// with every earlier pointer (the protocol above).
unsafe impl GlobalAlloc for Arena {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.init();
        let align = layout.align();
        let Some(start) = self.next.get().checked_add(align - 1).map(|v| v & !(align - 1)) else {
            return null_mut();
        };
        let Some(end) = start.checked_add(layout.size()) else {
            return null_mut();
        };
        if end > self.end.get() {
            if end - self.base.get() > ARENA_LIMIT {
                return null_mut();
            }
            let pages = (end - self.end.get()).div_ceil(PAGE);
            if wasm32::memory_grow(0, pages) == usize::MAX {
                return null_mut();
            }
            self.end.set(self.end.get() + pages * PAGE);
        }
        self.next.set(end);
        start as *mut u8
    }

    unsafe fn dealloc(&self, _ptr: *mut u8, _layout: Layout) {}
}

#[global_allocator]
static ARENA: Arena = Arena {
    base: Cell::new(0),
    next: Cell::new(0),
    end: Cell::new(0),
};

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    wasm32::unreachable()
}

/// Where the reserved input and the latest output live.
struct Io {
    input_ptr: Cell<usize>,
    input_len: Cell<usize>,
    output_ptr: Cell<usize>,
    output_len: Cell<usize>,
}

// SAFETY: single-threaded (see `Arena`).
unsafe impl Sync for Io {}

static IO: Io = Io {
    input_ptr: Cell::new(0),
    input_len: Cell::new(0),
    output_ptr: Cell::new(0),
    output_len: Cell::new(0),
};

/// The ABI version.
#[unsafe(no_mangle)]
pub extern "C" fn mi_abi_version() -> u32 {
    ABI_VERSION
}

/// Reset the arena and reserve `len` bytes for one input document; returns its address, or 0 when
/// `len` is 0 or over [`MAX_INPUT_BYTES`]. Every earlier pointer becomes invalid.
#[unsafe(no_mangle)]
pub extern "C" fn mi_input(len: u32) -> u32 {
    ARENA.reset();
    IO.input_len.set(0);
    IO.output_ptr.set(0);
    IO.output_len.set(0);
    let len = len as usize;
    if len == 0 || len > MAX_INPUT_BYTES {
        return 0;
    }
    let buffer = vec![0u8; len];
    let ptr = buffer.as_ptr() as usize;
    core::mem::forget(buffer);
    IO.input_ptr.set(ptr);
    IO.input_len.set(len);
    ptr as u32
}

/// Solve the input written at the reserved address: 0 when the output is a plan, 1 when it is a
/// refusal, 2 when no input was reserved. One solve per reservation.
#[unsafe(no_mangle)]
pub extern "C" fn mi_solve() -> u32 {
    let len = IO.input_len.get();
    let (status, output) = if len == 0 {
        (
            2,
            error_json(&MotionError::new(
                MotionErrorCode::InvalidInput,
                "no input reserved: call mi_input first",
            )),
        )
    } else {
        // SAFETY: `mi_input` reserved exactly `len` initialised bytes at `input_ptr`, the arena
        // never moves or frees a block before the next reset, and only `mi_input` resets it.
        let input = unsafe { core::slice::from_raw_parts(IO.input_ptr.get() as *const u8, len) };
        match solve_json(input) {
            Ok(plan) => (0, plan),
            Err(err) => (1, error_json(&err)),
        }
    };
    IO.input_len.set(0);
    IO.output_ptr.set(output.as_ptr() as usize);
    IO.output_len.set(output.len());
    core::mem::forget(output);
    status
}

/// Address of the latest output document.
#[unsafe(no_mangle)]
pub extern "C" fn mi_output_ptr() -> u32 {
    IO.output_ptr.get() as u32
}

/// Length of the latest output document, bytes.
#[unsafe(no_mangle)]
pub extern "C" fn mi_output_len() -> u32 {
    IO.output_len.get() as u32
}
