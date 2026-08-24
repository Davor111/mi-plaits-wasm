//! Proves `Synth::render` never allocates, which is what makes it safe to call
//! on the audio thread.
//!
//! The counting allocator is global to this test binary, so this file must
//! contain only this test. Run it alone: `cargo test --test no_alloc`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use mi_plaits_wasm::{Synth, params};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        ALLOCS.fetch_add(1, Ordering::SeqCst);
        unsafe { System.alloc_zeroed(layout) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

#[test]
fn render_does_not_allocate() {
    let mut synth = Synth::new(128, 48000.0);
    synth.set_param(params::ENGINE, 0.0);

    // Settle the engine switch and any lazily initialised tables first.
    for _ in 0..16 {
        synth.render();
    }

    let before = ALLOCS.load(Ordering::SeqCst);
    for _ in 0..256 {
        synth.render();
    }
    let after = ALLOCS.load(Ordering::SeqCst);

    assert_eq!(after, before, "render allocated {} time(s)", after - before);
}
