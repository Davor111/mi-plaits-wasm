# Plaits wasm + AudioWorklet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one `mi_plaits_dsp::voice::Voice` in a browser AudioWorklet at 48 kHz, controllable from a demo page, with per-engine wasm timing measurements.

**Architecture:** A `cdylib` wrapper crate exposes a raw `extern "C"` surface over wasm linear memory — an opaque `Synth` handle, an id-based parameter setter, and a render call that fills two buffers JS reads directly. The demo page compiles the module on the main thread and `postMessage`s it into an AudioWorklet, which instantiates it synchronously and calls render once per 128-frame quantum.

**Tech Stack:** Rust (edition 2024), `wasm32-unknown-unknown`, no `wasm-bindgen`, Web Audio API AudioWorklet, plain ES modules.

**Spec:** `docs/superpowers/specs/2026-08-24-wasm-audioworklet-design.md`

## Global Constraints

- **Never modify `../mi-plaits-dsp-rs`.** It is a clone of a third-party repo. This project depends on it by path only.
- **Edition 2024:** `#[no_mangle]` is an unsafe attribute and MUST be written `#[unsafe(no_mangle)]`. Plain `#[no_mangle]` is a compile error.
- **wasm builds need the rustup toolchain, not Homebrew's cargo.** Homebrew's rust ships no wasm std. Use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo` for any `--target wasm32-unknown-unknown` build. Host-target tests use the default `cargo`.
- **Block size is 128** everywhere — the AudioWorklet render quantum.
- **Sample rate is 48000** everywhere — the rate the library's DSP was written for.
- `NUM_ENGINES` is 24, so valid engine indices are `0..=23`.

---

### Task 1: Crate skeleton and parameter mapping

**Files:**
- Create: `Cargo.toml`
- Create: `src/lib.rs`
- Create: `src/params.rs`
- Test: `tests/params.rs`

**Interfaces:**
- Consumes: `mi_plaits_dsp::voice::{Patch, Modulations, NUM_ENGINES}`
- Produces: `mi_plaits_wasm::params::{set, ENGINE, NOTE, HARMONICS, TIMBRE, MORPH, DECAY, LPG_COLOUR, FM_AMOUNT, TIMBRE_MOD_AMOUNT, MORPH_MOD_AMOUNT, MOD_ENGINE, MOD_NOTE, MOD_FREQUENCY, MOD_HARMONICS, MOD_TIMBRE, MOD_MORPH, MOD_TRIGGER, MOD_LEVEL, FREQUENCY_PATCHED, TIMBRE_PATCHED, MORPH_PATCHED, TRIGGER_PATCHED, LEVEL_PATCHED}` where `set(patch: &mut Patch, m: &mut Modulations, id: u32, value: f32)`

- [ ] **Step 1: Create `Cargo.toml`**

```toml
[package]
name = "mi-plaits-wasm"
version = "0.1.0"
edition = "2024"
license = "MIT"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
mi-plaits-dsp = { path = "../mi-plaits-dsp-rs" }

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
panic = "abort"
```

`rlib` is required alongside `cdylib` so the integration tests can link the crate.

- [ ] **Step 2: Write the failing test**

Create `tests/params.rs`:

```rust
use mi_plaits_dsp::voice::{Modulations, Patch};
use mi_plaits_wasm::params;

#[test]
fn engine_is_clamped_to_valid_range() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::ENGINE, 7.0);
    assert_eq!(p.engine, 7);

    params::set(&mut p, &mut m, params::ENGINE, 99.0);
    assert_eq!(p.engine, 23, "above range must clamp to NUM_ENGINES - 1");

    params::set(&mut p, &mut m, params::ENGINE, -5.0);
    assert_eq!(p.engine, 0, "below range must clamp to 0");
}

#[test]
fn patch_ids_write_their_own_field() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::NOTE, 60.0);
    params::set(&mut p, &mut m, params::HARMONICS, 0.1);
    params::set(&mut p, &mut m, params::TIMBRE, 0.2);
    params::set(&mut p, &mut m, params::MORPH, 0.3);
    params::set(&mut p, &mut m, params::DECAY, 0.4);
    params::set(&mut p, &mut m, params::LPG_COLOUR, 0.6);
    params::set(&mut p, &mut m, params::FM_AMOUNT, 0.7);
    params::set(&mut p, &mut m, params::TIMBRE_MOD_AMOUNT, 0.8);
    params::set(&mut p, &mut m, params::MORPH_MOD_AMOUNT, 0.9);

    assert_eq!(p.note, 60.0);
    assert_eq!(p.harmonics, 0.1);
    assert_eq!(p.timbre, 0.2);
    assert_eq!(p.morph, 0.3);
    assert_eq!(p.decay, 0.4);
    assert_eq!(p.lpg_colour, 0.6);
    assert_eq!(p.frequency_modulation_amount, 0.7);
    assert_eq!(p.timbre_modulation_amount, 0.8);
    assert_eq!(p.morph_modulation_amount, 0.9);
}

#[test]
fn modulation_ids_write_their_own_field() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    params::set(&mut p, &mut m, params::MOD_ENGINE, 0.1);
    params::set(&mut p, &mut m, params::MOD_NOTE, 12.0);
    params::set(&mut p, &mut m, params::MOD_FREQUENCY, 0.2);
    params::set(&mut p, &mut m, params::MOD_HARMONICS, 0.3);
    params::set(&mut p, &mut m, params::MOD_TIMBRE, 0.4);
    params::set(&mut p, &mut m, params::MOD_MORPH, 0.5);
    params::set(&mut p, &mut m, params::MOD_TRIGGER, 1.0);
    params::set(&mut p, &mut m, params::MOD_LEVEL, 0.75);

    assert_eq!(m.engine, 0.1);
    assert_eq!(m.note, 12.0);
    assert_eq!(m.frequency, 0.2);
    assert_eq!(m.harmonics, 0.3);
    assert_eq!(m.timbre, 0.4);
    assert_eq!(m.morph, 0.5);
    assert_eq!(m.trigger, 1.0);
    assert_eq!(m.level, 0.75);
}

#[test]
fn flag_ids_are_boolean_by_nonzero() {
    let mut p = Patch::default();
    let mut m = Modulations::default();

    for id in [
        params::FREQUENCY_PATCHED,
        params::TIMBRE_PATCHED,
        params::MORPH_PATCHED,
        params::TRIGGER_PATCHED,
        params::LEVEL_PATCHED,
    ] {
        params::set(&mut p, &mut m, id, 1.0);
    }
    assert!(m.frequency_patched);
    assert!(m.timbre_patched);
    assert!(m.morph_patched);
    assert!(m.trigger_patched);
    assert!(m.level_patched);

    params::set(&mut p, &mut m, params::TRIGGER_PATCHED, 0.0);
    assert!(!m.trigger_patched);
}

#[test]
fn unknown_id_changes_nothing() {
    let mut p = Patch::default();
    let mut m = Modulations::default();
    let before = format!("{p:?}|{m:?}");

    params::set(&mut p, &mut m, 9999, 1.0);

    assert_eq!(before, format!("{p:?}|{m:?}"));
}
```

The `unknown_id_changes_nothing` test compares `Debug` output because neither
`Patch` nor `Modulations` implements `PartialEq`. Both derive `Debug`, so this is
a complete structural comparison without touching the library.

- [ ] **Step 2b: Create the lib root so the test can resolve the crate**

Create `src/lib.rs`:

```rust
//! Browser/wasm wrapper around `mi-plaits-dsp`.

pub mod params;
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --test params`
Expected: FAIL — `file not found for module 'params'`.

- [ ] **Step 4: Write the implementation**

Create `src/params.rs`:

```rust
//! Parameter id mapping for the FFI setter.
//!
//! Ids are grouped by destination so the JS side stays readable:
//! `0..` writes `Patch`, `16..` writes `Modulations`, `32..` writes the
//! `Modulations` "patched" flags.

use mi_plaits_dsp::voice::{Modulations, NUM_ENGINES, Patch};

// Patch
pub const ENGINE: u32 = 0;
pub const NOTE: u32 = 1;
pub const HARMONICS: u32 = 2;
pub const TIMBRE: u32 = 3;
pub const MORPH: u32 = 4;
pub const DECAY: u32 = 5;
pub const LPG_COLOUR: u32 = 6;
pub const FM_AMOUNT: u32 = 7;
pub const TIMBRE_MOD_AMOUNT: u32 = 8;
pub const MORPH_MOD_AMOUNT: u32 = 9;

// Modulations
pub const MOD_ENGINE: u32 = 16;
pub const MOD_NOTE: u32 = 17;
pub const MOD_FREQUENCY: u32 = 18;
pub const MOD_HARMONICS: u32 = 19;
pub const MOD_TIMBRE: u32 = 20;
pub const MOD_MORPH: u32 = 21;
pub const MOD_TRIGGER: u32 = 22;
pub const MOD_LEVEL: u32 = 23;

// Modulations flags
pub const FREQUENCY_PATCHED: u32 = 32;
pub const TIMBRE_PATCHED: u32 = 33;
pub const MORPH_PATCHED: u32 = 34;
pub const TRIGGER_PATCHED: u32 = 35;
pub const LEVEL_PATCHED: u32 = 36;

/// Applies one parameter. Unknown ids are ignored so the JS side can evolve
/// without breaking an older `.wasm`.
pub fn set(patch: &mut Patch, m: &mut Modulations, id: u32, value: f32) {
    match id {
        ENGINE => {
            // `as i32` saturates on out-of-range and maps NaN to 0.
            patch.engine = (value as i32).clamp(0, NUM_ENGINES as i32 - 1) as usize
        }
        NOTE => patch.note = value,
        HARMONICS => patch.harmonics = value,
        TIMBRE => patch.timbre = value,
        MORPH => patch.morph = value,
        DECAY => patch.decay = value,
        LPG_COLOUR => patch.lpg_colour = value,
        FM_AMOUNT => patch.frequency_modulation_amount = value,
        TIMBRE_MOD_AMOUNT => patch.timbre_modulation_amount = value,
        MORPH_MOD_AMOUNT => patch.morph_modulation_amount = value,

        MOD_ENGINE => m.engine = value,
        MOD_NOTE => m.note = value,
        MOD_FREQUENCY => m.frequency = value,
        MOD_HARMONICS => m.harmonics = value,
        MOD_TIMBRE => m.timbre = value,
        MOD_MORPH => m.morph = value,
        MOD_TRIGGER => m.trigger = value,
        MOD_LEVEL => m.level = value,

        FREQUENCY_PATCHED => m.frequency_patched = value != 0.0,
        TIMBRE_PATCHED => m.timbre_patched = value != 0.0,
        MORPH_PATCHED => m.morph_patched = value != 0.0,
        TRIGGER_PATCHED => m.trigger_patched = value != 0.0,
        LEVEL_PATCHED => m.level_patched = value != 0.0,

        _ => {}
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --test params`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add Cargo.toml src/lib.rs src/params.rs tests/params.rs
git commit -m "feat: parameter id mapping for the wasm FFI"
```

---

### Task 2: Synth wrapper

**Files:**
- Create: `src/synth.rs`
- Modify: `src/lib.rs`
- Test: `tests/synth.rs`

**Interfaces:**
- Consumes: `params::set` from Task 1
- Produces: `mi_plaits_wasm::Synth` with `Synth::new(block_size: usize, sample_rate: f32) -> Synth`, `set_param(&mut self, id: u32, value: f32)`, `render(&mut self)`, `out(&self) -> &[f32]`, `aux(&self) -> &[f32]`, `out_ptr(&mut self) -> *mut f32`, `aux_ptr(&mut self) -> *mut f32`

- [ ] **Step 1: Write the failing test**

Create `tests/synth.rs`:

```rust
use mi_plaits_dsp::voice::NUM_ENGINES;
use mi_plaits_wasm::{Synth, params};

const BLOCK: usize = 128;
const SR: f32 = 48000.0;

fn triggered_synth(engine: usize) -> Synth {
    let mut s = Synth::new(BLOCK, SR);
    s.set_param(params::ENGINE, engine as f32);
    s.set_param(params::TRIGGER_PATCHED, 1.0);
    s.set_param(params::LEVEL_PATCHED, 1.0);
    s.set_param(params::MOD_LEVEL, 1.0);
    s.set_param(params::MOD_TRIGGER, 1.0);
    s
}

#[test]
fn buffers_have_the_requested_block_size() {
    let s = Synth::new(BLOCK, SR);
    assert_eq!(s.out().len(), BLOCK);
    assert_eq!(s.aux().len(), BLOCK);
}

#[test]
fn every_engine_renders_finite_non_silent_audio() {
    for engine in 0..NUM_ENGINES {
        let mut s = triggered_synth(engine);
        let mut peak = 0.0f32;

        for _ in 0..200 {
            s.render();
            for &x in s.out().iter().chain(s.aux().iter()) {
                assert!(x.is_finite(), "engine {engine} produced a non-finite sample: {x}");
                peak = peak.max(x.abs());
            }
        }

        assert!(peak > 1e-5, "engine {engine} rendered silence (peak {peak})");
    }
}

#[test]
fn out_and_aux_pointers_address_the_rendered_buffers() {
    let mut s = triggered_synth(0);
    for _ in 0..64 {
        s.render();
    }

    let ptr = s.out_ptr();
    let via_ptr = unsafe { std::slice::from_raw_parts(ptr, BLOCK) };
    assert_eq!(via_ptr, s.out(), "out_ptr must alias the out buffer");

    let ptr = s.aux_ptr();
    let via_ptr = unsafe { std::slice::from_raw_parts(ptr, BLOCK) };
    assert_eq!(via_ptr, s.aux(), "aux_ptr must alias the aux buffer");
}
```

The peak threshold is `1e-5` deliberately: engine 3 (a six-op bank) measured a
peak of only 0.009 in an untriggered sweep, so a higher bar would be flaky.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --test synth`
Expected: FAIL — `unresolved import mi_plaits_wasm::Synth`.

- [ ] **Step 3: Write the implementation**

Create `src/synth.rs`:

```rust
//! One Plaits voice plus its parameter state and render buffers.

use mi_plaits_dsp::voice::{Modulations, Patch, Voice};

use crate::params;

pub struct Synth {
    voice: Voice<'static>,
    patch: Patch,
    modulations: Modulations,
    out: Box<[f32]>,
    aux: Box<[f32]>,
}

impl Synth {
    /// `block_size` must equal the number of frames passed to each `render`.
    pub fn new(block_size: usize, sample_rate: f32) -> Self {
        let mut voice = Voice::new(block_size, sample_rate);
        voice.init();

        Self {
            voice,
            patch: Patch::default(),
            modulations: Modulations::default(),
            out: vec![0.0; block_size].into_boxed_slice(),
            aux: vec![0.0; block_size].into_boxed_slice(),
        }
    }

    pub fn set_param(&mut self, id: u32, value: f32) {
        params::set(&mut self.patch, &mut self.modulations, id, value);
    }

    /// Renders one block. Allocation-free; safe to call on the audio thread.
    pub fn render(&mut self) {
        self.voice
            .render(&self.patch, &self.modulations, &mut self.out, &mut self.aux);
    }

    pub fn out(&self) -> &[f32] {
        &self.out
    }

    pub fn aux(&self) -> &[f32] {
        &self.aux
    }

    pub fn out_ptr(&mut self) -> *mut f32 {
        self.out.as_mut_ptr()
    }

    pub fn aux_ptr(&mut self) -> *mut f32 {
        self.aux.as_mut_ptr()
    }
}
```

`Voice<'static>` is valid because `Resources::default()` borrows only `const`
tables from the library.

- [ ] **Step 4: Export it from the lib root**

Replace `src/lib.rs` with:

```rust
//! Browser/wasm wrapper around `mi-plaits-dsp`.

pub mod params;
mod synth;

pub use synth::Synth;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test`
Expected: PASS — 5 tests in `params`, 3 in `synth`.

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs src/synth.rs tests/synth.rs
git commit -m "feat: Synth wrapper owning voice, params and render buffers"
```

---

### Task 3: FFI exports, allocation-free proof, and the wasm build

**Files:**
- Modify: `src/lib.rs`
- Create: `tests/no_alloc.rs`
- Create: `build.sh`
- Create: `.gitignore` (already present — verify it covers `/target` and `web/*.wasm`)

**Interfaces:**
- Consumes: `Synth` from Task 2
- Produces: wasm exports `plaits_new(usize, f32) -> *mut Synth`, `plaits_free(*mut Synth)`, `plaits_out_ptr(*mut Synth) -> *mut f32`, `plaits_aux_ptr(*mut Synth) -> *mut f32`, `plaits_set_param(*mut Synth, u32, f32)`, `plaits_render(*mut Synth)`, plus the standard `memory` export. Task 4 and Task 5 call exactly these names.

- [ ] **Step 1: Write the failing allocation test**

Create `tests/no_alloc.rs`:

```rust
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
```

- [ ] **Step 2: Run it to verify it passes for the right reason**

Run: `cargo test --test no_alloc`
Expected: PASS. If it FAILS, that is a real finding about the library, not a
broken test — report it rather than weakening the assertion.

- [ ] **Step 3: Add the FFI exports**

Replace `src/lib.rs` with:

```rust
//! Browser/wasm wrapper around `mi-plaits-dsp`.
//!
//! The exported C ABI is deliberately tiny: an opaque handle, an id-based
//! parameter setter, and a render call. JS reads the rendered audio straight
//! out of linear memory via the pointers returned here.

pub mod params;
mod synth;

pub use synth::Synth;

/// Creates a synth. `block_size` must match the frame count JS renders per call.
#[unsafe(no_mangle)]
pub extern "C" fn plaits_new(block_size: usize, sample_rate: f32) -> *mut Synth {
    Box::into_raw(Box::new(Synth::new(block_size, sample_rate)))
}

/// # Safety
/// `ptr` must come from `plaits_new` and must not be used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_free(ptr: *mut Synth) {
    if !ptr.is_null() {
        drop(unsafe { Box::from_raw(ptr) });
    }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_out_ptr(ptr: *mut Synth) -> *mut f32 {
    unsafe { (*ptr).out_ptr() }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_aux_ptr(ptr: *mut Synth) -> *mut f32 {
    unsafe { (*ptr).aux_ptr() }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_set_param(ptr: *mut Synth, id: u32, value: f32) {
    unsafe { (*ptr).set_param(id, value) }
}

/// # Safety
/// `ptr` must be a live handle from `plaits_new`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn plaits_render(ptr: *mut Synth) {
    unsafe { (*ptr).render() }
}
```

- [ ] **Step 4: Add a handle-lifecycle test for the C ABI**

Create `tests/ffi.rs`:

```rust
//! Exercises the exported C ABI the way JS does.

use mi_plaits_wasm::{params, plaits_aux_ptr, plaits_free, plaits_new, plaits_out_ptr,
                     plaits_render, plaits_set_param};

const BLOCK: usize = 128;

#[test]
fn handle_lifecycle_renders_then_frees() {
    let synth = plaits_new(BLOCK, 48000.0);
    assert!(!synth.is_null());

    unsafe {
        plaits_set_param(synth, params::TRIGGER_PATCHED, 1.0);
        plaits_set_param(synth, params::LEVEL_PATCHED, 1.0);
        plaits_set_param(synth, params::MOD_LEVEL, 1.0);
        plaits_set_param(synth, params::MOD_TRIGGER, 1.0);

        let out = plaits_out_ptr(synth);
        let aux = plaits_aux_ptr(synth);
        assert!(!out.is_null() && !aux.is_null());

        let mut peak = 0.0f32;
        for _ in 0..200 {
            plaits_render(synth);
            let block = std::slice::from_raw_parts(out, BLOCK);
            for &v in block {
                assert!(v.is_finite());
                peak = peak.max(v.abs());
            }
        }
        assert!(peak > 1e-5, "FFI render produced silence");

        plaits_free(synth);
    }
}

#[test]
fn free_tolerates_null() {
    unsafe { plaits_free(std::ptr::null_mut()) };
}
```

Run under the address sanitiser if available, but a plain run catches the
lifecycle bugs that matter here.

- [ ] **Step 5: Verify the host build and tests still pass**

Run: `cargo test`
Expected: PASS, all suites including `ffi`.

- [ ] **Step 6: Create `build.sh`**

```bash
#!/usr/bin/env bash
# Builds the wasm module and drops it next to the demo page.
#
# Homebrew's rust has no wasm std, so this uses the rustup toolchain by
# absolute path. Override with CARGO_BIN=/path/to/cargo if your setup differs.
set -euo pipefail

CARGO_BIN="${CARGO_BIN:-$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo}"

if [ ! -x "$CARGO_BIN" ]; then
  echo "error: no cargo at $CARGO_BIN" >&2
  echo "install with: rustup target add wasm32-unknown-unknown" >&2
  exit 1
fi

"$CARGO_BIN" build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/mi_plaits_wasm.wasm web/plaits.wasm
ls -lh web/plaits.wasm
```

Then: `chmod +x build.sh`

- [ ] **Step 7: Build the wasm and verify its exports and imports**

Run: `./build.sh`
Expected: `web/plaits.wasm` exists, roughly 200-300 KB.

Then verify the module's shape with node (imports MUST be empty — the worklet
instantiates with `{}` and any import would throw there):

```bash
node -e '
const fs = require("fs");
const m = new WebAssembly.Module(fs.readFileSync("web/plaits.wasm"));
console.log("imports:", WebAssembly.Module.imports(m));
console.log("exports:", WebAssembly.Module.exports(m).map(e => e.name + ":" + e.kind).join(" "));
'
```

Expected: `imports: []`, and exports including `memory`, `plaits_new`,
`plaits_free`, `plaits_out_ptr`, `plaits_aux_ptr`, `plaits_set_param`,
`plaits_render`. If imports is non-empty, stop and report what it wants — the
worklet design depends on this being empty.

- [ ] **Step 8: Smoke-test the wasm outside the browser**

```bash
node -e '
const fs = require("fs");
const m = new WebAssembly.Module(fs.readFileSync("web/plaits.wasm"));
const i = new WebAssembly.Instance(m, {});
const x = i.exports;
const BLOCK = 128;
const s = x.plaits_new(BLOCK, 48000);
x.plaits_set_param(s, 35, 1);   // TRIGGER_PATCHED
x.plaits_set_param(s, 36, 1);   // LEVEL_PATCHED
x.plaits_set_param(s, 23, 1);   // MOD_LEVEL
x.plaits_set_param(s, 22, 1);   // MOD_TRIGGER
const out = new Float32Array(x.memory.buffer, x.plaits_out_ptr(s), BLOCK);
let peak = 0;
for (let b = 0; b < 200; b++) { x.plaits_render(s); for (const v of out) peak = Math.max(peak, Math.abs(v)); }
console.log("peak:", peak);
if (!(peak > 1e-5)) { console.error("FAIL: wasm rendered silence"); process.exit(1); }
console.log("wasm renders audio OK");
'
```

Expected: a non-zero peak and `wasm renders audio OK`. This proves the whole FFI
works in a real wasm engine before any browser is involved.

- [ ] **Step 9: Commit**

```bash
git add src/lib.rs tests/no_alloc.rs build.sh
git commit -m "feat: C ABI exports and wasm build script"
```

---

### Task 4: AudioWorklet processor and demo page

**Files:**
- Create: `web/worklet.js`
- Create: `web/main.js`
- Create: `web/index.html`

**Interfaces:**
- Consumes: the wasm exports from Task 3, and `web/plaits.wasm` produced by `build.sh`
- Produces: a page served from `web/` that plays audio; `main.js` exports nothing but defines the `PARAMS` id table mirroring `src/params.rs`

- [ ] **Step 1: Write `web/worklet.js`**

```js
// Runs on the audio thread. Has no fetch, so the compiled WebAssembly.Module
// arrives by postMessage and is instantiated synchronously here.

const BLOCK = 128;

class PlaitsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.mix = 0; // 0 = out, 1 = aux
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    switch (msg.type) {
      case 'wasm': {
        const instance = new WebAssembly.Instance(msg.module, {});
        this.x = instance.exports;
        this.memory = this.x.memory;
        this.synth = this.x.plaits_new(BLOCK, sampleRate);
        this.outPtr = this.x.plaits_out_ptr(this.synth);
        this.auxPtr = this.x.plaits_aux_ptr(this.synth);
        this.cachedBuffer = null;
        this.refreshViews();
        this.ready = true;
        this.port.postMessage({ type: 'ready', sampleRate });
        break;
      }
      case 'param':
        if (this.ready) this.x.plaits_set_param(this.synth, msg.id, msg.value);
        break;
      case 'mix':
        this.mix = msg.value;
        break;
    }
  }

  // A Float32Array over wasm memory detaches if the memory ever grows, and a
  // detached view reads as silence rather than throwing. Everything is
  // allocated up front so this should never fire, but the check is cheap.
  refreshViews() {
    if (this.cachedBuffer !== this.memory.buffer) {
      this.cachedBuffer = this.memory.buffer;
      this.outView = new Float32Array(this.memory.buffer, this.outPtr, BLOCK);
      this.auxView = new Float32Array(this.memory.buffer, this.auxPtr, BLOCK);
    }
  }

  process(_inputs, outputs) {
    const channels = outputs[0];
    const frames = channels[0].length;

    if (!this.ready || frames !== BLOCK) {
      for (const channel of channels) channel.fill(0);
      return true;
    }

    this.refreshViews();
    this.x.plaits_render(this.synth);

    const out = this.outView;
    const aux = this.auxView;
    const mix = this.mix;

    for (let i = 0; i < frames; i++) {
      const sample = out[i] * (1 - mix) + aux[i] * mix;
      for (let c = 0; c < channels.length; c++) channels[c][i] = sample;
    }

    return true;
  }
}

registerProcessor('plaits', PlaitsProcessor);
```

- [ ] **Step 2: Write `web/main.js`**

```js
// Mirrors src/params.rs. Keep in sync.
export const PARAMS = {
  ENGINE: 0, NOTE: 1, HARMONICS: 2, TIMBRE: 3, MORPH: 4,
  DECAY: 5, LPG_COLOUR: 6, FM_AMOUNT: 7,
  TIMBRE_MOD_AMOUNT: 8, MORPH_MOD_AMOUNT: 9,
  MOD_ENGINE: 16, MOD_NOTE: 17, MOD_FREQUENCY: 18, MOD_HARMONICS: 19,
  MOD_TIMBRE: 20, MOD_MORPH: 21, MOD_TRIGGER: 22, MOD_LEVEL: 23,
  FREQUENCY_PATCHED: 32, TIMBRE_PATCHED: 33, MORPH_PATCHED: 34,
  TRIGGER_PATCHED: 35, LEVEL_PATCHED: 36,
};

export const ENGINE_NAMES = [
  'virtual analog VCF', 'phase distortion', 'six-op FM 1', 'six-op FM 2',
  'six-op FM 3', 'wave terrain', 'string machine', 'chiptune',
  'virtual analog', 'waveshaping', 'FM', 'grain',
  'additive', 'wavetable', 'chord', 'speech',
  'swarm', 'noise', 'particle', 'string',
  'modal', 'bass drum', 'snare drum', 'hi-hat',
];

let ctx = null;
let node = null;
let analyser = null;
let wasmModule = null;

const status = (text) => { document.getElementById('status').textContent = text; };

async function start() {
  if (ctx) return;

  const bytes = await (await fetch('plaits.wasm')).arrayBuffer();
  wasmModule = await WebAssembly.compile(bytes);

  // The library's DSP is written for 48 kHz; other rates sound different.
  ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.sampleRate !== 48000) {
    status(`warning: context is ${ctx.sampleRate} Hz, not 48000`);
  }

  await ctx.audioWorklet.addModule('worklet.js');
  node = new AudioWorkletNode(ctx, 'plaits', { outputChannelCount: [2] });

  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(analyser);
  analyser.connect(ctx.destination);

  node.port.onmessage = (event) => {
    if (event.data.type === 'ready') {
      status(`running at ${event.data.sampleRate} Hz`);
      sendAll();
    }
  };
  node.port.postMessage({ type: 'wasm', module: wasmModule });

  await ctx.resume();
  requestAnimationFrame(meter);
}

const send = (id, value) => node && node.port.postMessage({ type: 'param', id, value });

function sendAll() {
  for (const input of document.querySelectorAll('[data-param]')) {
    send(PARAMS[input.dataset.param], Number(input.value));
  }
  node.port.postMessage({ type: 'mix', value: Number(document.getElementById('mix').value) });
  // Use the internal envelope + level so the demo is audible without a gate.
  send(PARAMS.TRIGGER_PATCHED, 1);
  send(PARAMS.LEVEL_PATCHED, 1);
  send(PARAMS.MOD_LEVEL, 1);
}

// Exposed for the automated check; reports output RMS.
export function rms() {
  if (!analyser) return 0;
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

function meter() {
  document.getElementById('rms').textContent = rms().toFixed(4);
  requestAnimationFrame(meter);
}

function buildUi() {
  const select = document.getElementById('engine');
  ENGINE_NAMES.forEach((name, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = `${i} — ${name}`;
    select.append(option);
  });

  for (const input of document.querySelectorAll('[data-param]')) {
    input.addEventListener('input', () => {
      send(PARAMS[input.dataset.param], Number(input.value));
      const readout = document.getElementById(`${input.id}-value`);
      if (readout) readout.textContent = Number(input.value).toFixed(2);
    });
  }

  document.getElementById('mix').addEventListener('input', (e) => {
    node && node.port.postMessage({ type: 'mix', value: Number(e.target.value) });
  });

  document.getElementById('trigger').addEventListener('pointerdown', () => send(PARAMS.MOD_TRIGGER, 1));
  document.getElementById('trigger').addEventListener('pointerup', () => send(PARAMS.MOD_TRIGGER, 0));
  document.getElementById('start').addEventListener('click', start);
}

buildUi();
window.plaitsDemo = { start, rms, send, PARAMS };
```

- [ ] **Step 3: Write `web/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Plaits in the browser</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 2rem; max-width: 40rem; }
    .row { display: grid; grid-template-columns: 10rem 1fr 3rem; gap: .5rem; align-items: center; margin: .35rem 0; }
    input[type=range] { width: 100%; }
    #status { font-family: ui-monospace, monospace; }
  </style>
</head>
<body>
  <h1>Plaits in the browser</h1>
  <p><button id="start">Start audio</button> <span id="status">stopped</span></p>

  <div class="row"><label for="engine">engine</label><select id="engine" data-param="ENGINE"></select><span></span></div>
  <div class="row"><label for="note">note</label><input id="note" data-param="NOTE" type="range" min="0" max="96" step="1" value="48"><span id="note-value">48.00</span></div>
  <div class="row"><label for="harmonics">harmonics</label><input id="harmonics" data-param="HARMONICS" type="range" min="0" max="1" step="0.01" value="0.5"><span id="harmonics-value">0.50</span></div>
  <div class="row"><label for="timbre">timbre</label><input id="timbre" data-param="TIMBRE" type="range" min="0" max="1" step="0.01" value="0.5"><span id="timbre-value">0.50</span></div>
  <div class="row"><label for="morph">morph</label><input id="morph" data-param="MORPH" type="range" min="0" max="1" step="0.01" value="0.5"><span id="morph-value">0.50</span></div>
  <div class="row"><label for="decay">decay</label><input id="decay" data-param="DECAY" type="range" min="0" max="1" step="0.01" value="0.5"><span id="decay-value">0.50</span></div>
  <div class="row"><label for="lpg">lpg colour</label><input id="lpg" data-param="LPG_COLOUR" type="range" min="0" max="1" step="0.01" value="0.5"><span id="lpg-value">0.50</span></div>
  <div class="row"><label for="mix">out / aux</label><input id="mix" type="range" min="0" max="1" step="0.01" value="0"><span></span></div>

  <p><button id="trigger">trigger (hold)</button> &nbsp; output RMS: <span id="rms">0.0000</span></p>

  <script type="module" src="main.js"></script>
</body>
</html>
```

Note `id="lpg"` carries `data-param="LPG_COLOUR"`; the readout id convention is
`<input id>-value`, so its readout span is `lpg-value`.

- [ ] **Step 4: Serve the page**

Run: `python3 -m http.server 8080 --directory web`
(`file://` will not work — ES modules and wasm fetch both require http.)

- [ ] **Step 5: Verify in a real browser**

Open `http://localhost:8080/`, click **Start audio**, confirm:
- status shows `running at 48000 Hz`
- output RMS is non-zero
- moving harmonics/timbre/morph audibly changes the sound
- switching engines works across all 24 (expect a click on engines 2/3/4 — known and accepted)

Automated equivalent, using the Playwright browser tools:
1. navigate to `http://localhost:8080/`
2. click `#start`
3. evaluate `() => window.plaitsDemo.rms()` after ~500 ms
4. assert the value is > 0.001, and check the console for errors

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/main.js web/worklet.js
git commit -m "feat: AudioWorklet demo page"
```

---

### Task 5: Main-thread benchmark and README

**Files:**
- Modify: `web/main.js`
- Modify: `web/index.html`
- Create: `README.md`

**Interfaces:**
- Consumes: `wasmModule` compiled in `start()`, the wasm exports from Task 3
- Produces: `window.plaitsDemo.benchmark()` returning `Array<{engine, name, xRealtime, usPerBlock}>`

- [ ] **Step 1: Add the benchmark to `web/main.js`**

Append (and add `benchmark` to the `window.plaitsDemo` object):

```js
// Runs on the main thread, not in the worklet: performance.now() is not
// reliably exposed in AudioWorkletGlobalScope, and timing the audio thread
// would perturb what it measures. Uses a second instance of the same module.
export async function benchmark({ seconds = 2, blockSize = 128, sampleRate = 48000 } = {}) {
  if (!wasmModule) {
    const bytes = await (await fetch('plaits.wasm')).arrayBuffer();
    wasmModule = await WebAssembly.compile(bytes);
  }

  const x = new WebAssembly.Instance(wasmModule, {}).exports;
  const blocks = Math.round((sampleRate * seconds) / blockSize);
  const results = [];

  for (let engine = 0; engine < ENGINE_NAMES.length; engine++) {
    const synth = x.plaits_new(blockSize, sampleRate);
    x.plaits_set_param(synth, PARAMS.ENGINE, engine);
    x.plaits_set_param(synth, PARAMS.TRIGGER_PATCHED, 1);
    x.plaits_set_param(synth, PARAMS.LEVEL_PATCHED, 1);
    x.plaits_set_param(synth, PARAMS.MOD_LEVEL, 1);

    for (let i = 0; i < 32; i++) x.plaits_render(synth); // settle engine switch

    const triggerEvery = Math.round(sampleRate / 4 / blockSize); // 4 Hz, matches the native baseline
    const t0 = performance.now();
    for (let b = 0; b < blocks; b++) {
      x.plaits_set_param(synth, PARAMS.MOD_TRIGGER, b % triggerEvery < 2 ? 1 : 0);
      x.plaits_render(synth);
    }
    const elapsedMs = performance.now() - t0;
    x.plaits_free(synth);

    results.push({
      engine,
      name: ENGINE_NAMES[engine],
      xRealtime: (seconds * 1000) / elapsedMs,
      usPerBlock: (elapsedMs * 1000) / blocks,
    });
  }

  return results;
}
```

- [ ] **Step 2: Add a button and results table to `web/index.html`**

Insert before the closing `</body>`:

```html
  <p><button id="bench">Run benchmark</button> <span id="bench-status"></span></p>
  <table id="bench-results"></table>
```

And wire it in `buildUi()` in `web/main.js`:

```js
  document.getElementById('bench').addEventListener('click', async () => {
    document.getElementById('bench-status').textContent = 'running…';
    const rows = await benchmark();
    const worst = rows.reduce((a, b) => (a.xRealtime < b.xRealtime ? a : b));
    document.getElementById('bench-results').innerHTML =
      '<tr><th>engine</th><th>x realtime</th><th>µs/block</th></tr>' +
      rows.map((r) => `<tr><td>${r.engine} — ${r.name}</td><td>${r.xRealtime.toFixed(0)}</td><td>${r.usPerBlock.toFixed(2)}</td></tr>`).join('');
    document.getElementById('bench-status').textContent =
      `worst: ${worst.name} at ${worst.xRealtime.toFixed(0)}x realtime`;
  });
```

- [ ] **Step 3: Run the benchmark and capture the numbers**

Open the page, click **Run benchmark**, and record the worst-engine figure.
Compare against the native aarch64 baseline from the spec: worst engine 10 (FM)
at 174x realtime, 15.4 µs/block. The ratio is the real wasm slowdown.

- [ ] **Step 4: Write `README.md`**

```markdown
# mi-plaits-wasm

[Mutable Instruments Plaits](https://github.com/sourcebox/mi-plaits-dsp-rs) DSP
running in the browser through WebAssembly and an AudioWorklet.

The `mi-plaits-dsp` library is used unmodified — it is `no_std`, allocation-free
in its render path, and compiles for `wasm32-unknown-unknown` as-is.

## Build

```sh
./build.sh                                  # writes web/plaits.wasm
python3 -m http.server 8080 --directory web
```

Then open <http://localhost:8080/> and click **Start audio**.

Homebrew's rust ships no wasm standard library, so `build.sh` uses the rustup
toolchain by absolute path. Override with `CARGO_BIN=/path/to/cargo ./build.sh`.

## Test

```sh
cargo test                  # host-target tests: param mapping, render, FFI aliasing
cargo test --test no_alloc  # proves render() never allocates
```

## Design

See `docs/superpowers/specs/2026-08-24-wasm-audioworklet-design.md`.

## Measured performance

[fill in from the in-page benchmark: worst engine, x realtime, µs per 128-frame
block, and the browser used. Native aarch64 baseline for comparison: engine 10
(FM), 174x realtime, 15.4 µs/block.]

## Known issues

- Switching to engines 2, 3, or 4 parses a 4 KB sysex bank on the audio thread
  inside `Voice::render`, which can click.
- The demo is a single voice. Polyphony and Web MIDI are not implemented.
```

Replace the bracketed paragraph with the actual numbers from Step 3 — leaving a
placeholder in a README is a defect.

- [ ] **Step 5: Commit**

```bash
git add web/main.js web/index.html README.md
git commit -m "feat: in-page benchmark and project README"
```
