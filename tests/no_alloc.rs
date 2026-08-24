//! Proves `Synth::render` never allocates, which is what makes it safe to call
//! on the audio thread.
//!
//! The counting allocator is global to this test binary, so this file must
//! contain only these tests. Run it alone: `cargo test --test no_alloc`.
//!
//! `cargo test` runs the `#[test]` functions in a binary on separate threads
//! by default. `ALLOCS` is one process-global counter, so without
//! serialisation a `before`/`after` window in one test can be polluted by
//! allocations another test makes concurrently -- not a real allocation in
//! the code under test, just cross-talk between tests. `ALLOC_TEST_LOCK`
//! below forces the tests in this file to run one at a time.

use std::alloc::{GlobalAlloc, Layout, System};
use std::hint::black_box;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use mi_plaits_dsp::voice::NUM_ENGINES;
use mi_plaits_wasm::{Synth, params};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static ALLOC_TEST_LOCK: Mutex<()> = Mutex::new(());

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

/// Sanity check that the counting allocator above is actually installed and
/// wired up. Without this, if `#[global_allocator]` were ever dropped or
/// shadowed (e.g. by a different allocator elsewhere, or a build
/// misconfiguration), `ALLOCS` would silently stay at 0 forever and every
/// test below would pass vacuously no matter what `render` actually does.
#[test]
fn counting_allocator_is_installed() {
    let _guard = ALLOC_TEST_LOCK.lock().unwrap();

    let before = ALLOCS.load(Ordering::SeqCst);
    let v = black_box(Vec::<f32>::with_capacity(1024));
    let after = ALLOCS.load(Ordering::SeqCst);
    black_box(&v);

    assert!(
        after > before,
        "a deliberate allocation did not increment ALLOCS ({before} -> {after}); \
         the counting global allocator is not actually installed, which would make \
         every other test in this file pass vacuously"
    );
}

/// Builds a synth on `engine`, patched so it renders audible sound, and
/// settles it with warm-up renders (outside any counting window) so the
/// engine's own first-use lazy setup doesn't get blamed on `render` itself.
fn settled_synth(engine: usize) -> Synth {
    let mut synth = Synth::new(128, 48000.0);
    synth.set_param(params::ENGINE, engine as f32);
    synth.set_param(params::TRIGGER_PATCHED, 1.0);
    synth.set_param(params::LEVEL_PATCHED, 1.0);
    synth.set_param(params::MOD_LEVEL, 1.0);
    synth.set_param(params::MOD_TRIGGER, 1.0);

    // Settle the engine switch and any lazily initialised tables first.
    for _ in 0..16 {
        synth.render();
    }
    synth
}

#[test]
fn render_does_not_allocate_for_any_engine() {
    let _guard = ALLOC_TEST_LOCK.lock().unwrap();

    for engine in 0..NUM_ENGINES {
        let mut synth = settled_synth(engine);

        let before = ALLOCS.load(Ordering::SeqCst);
        for _ in 0..256 {
            synth.render();
        }
        let after = ALLOCS.load(Ordering::SeqCst);

        assert_eq!(
            after,
            before,
            "engine {engine} allocated {} time(s) while rendering",
            after - before
        );
    }
}

/// `Voice::render` runs the engine-switch path (including sysex bank
/// loading) on the audio thread whenever the engine id changes -- that path
/// is exactly where a future regression would allocate, so it must be
/// exercised *inside* the counted window, not settled beforehand like
/// `render_does_not_allocate_for_any_engine` does.
#[test]
fn render_does_not_allocate_when_switching_engines() {
    let _guard = ALLOC_TEST_LOCK.lock().unwrap();

    for engine in 0..NUM_ENGINES {
        // Start settled on a different engine, then switch into `engine`
        // while the counting window is open.
        let previous = (engine + 1) % NUM_ENGINES;
        let mut synth = settled_synth(previous);

        let before = ALLOCS.load(Ordering::SeqCst);
        synth.set_param(params::ENGINE, engine as f32);
        for _ in 0..256 {
            synth.render();
        }
        let after = ALLOCS.load(Ordering::SeqCst);

        assert_eq!(
            after,
            before,
            "switching from engine {previous} to engine {engine} allocated {} time(s)",
            after - before
        );
    }
}
