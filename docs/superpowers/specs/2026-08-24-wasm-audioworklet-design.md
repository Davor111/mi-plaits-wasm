# Plaits in the browser: wasm wrapper + AudioWorklet

Date: 2026-08-24
Status: approved, ready for implementation planning

## Goal

Run the `mi-plaits-dsp` synthesis voice in a web browser at 48 kHz, driven from a
demo page with controls for every engine and parameter, with honest per-engine
wasm timing measurements.

## Non-goals

- Polyphony, voice allocation, Web MIDI (a later slice; see Deferred)
- Any modification to the `mi-plaits-dsp` library
- Publishing, bundling, or a JS package

## Context

`mi-plaits-dsp` is a `no_std` + `alloc` crate with no `std` references, no inline
asm, no arch-specific cfgs, and `f32`-only math via `libm`. It compiles for
`wasm32-unknown-unknown` unmodified (verified 2026-08-24, rustc 1.98.0).

Two measured facts shape the design:

- All 24 engines render correctly at a block size of 128, the AudioWorklet render
  quantum. The engines allocate scratch buffers sized to the `block_size` passed
  to `Voice::new`, so this had to be confirmed rather than assumed.
- `render()` performs no allocation. All 20 `vec!`/`Box` sites in the library are
  in `new()`. This is what makes it safe to call on the audio thread.

Native baseline at 48 kHz / 128-frame blocks, triggers firing 4x/sec: worst engine
is 10 (FM) at 174x realtime, 15.4 us of the 2667 us block budget. Median ~400x.

The `mi-plaits-dsp-rs` checkout is a clone of `sourcebox/mi-plaits-dsp-rs`, owned
by a third party. It stays untouched; this project is a sibling directory with a
path dependency, swappable later for a crates.io or git dependency.

## Architecture

```
mi-plaits-wasm/
  Cargo.toml          cdylib + rlib, path dep on ../mi-plaits-dsp-rs
  src/lib.rs          extern "C" FFI surface
  src/params.rs       param id <-> field mapping
  web/index.html      controls
  web/main.js         compiles wasm, owns AudioContext, runs the benchmark
  web/worklet.js      AudioWorkletProcessor, instantiates wasm, calls render
  build.sh            cargo build --release --target wasm32-unknown-unknown, copy to web/
```

### Rust FFI

No `wasm-bindgen`. The API is f32 buffers and scalars, so bindgen adds a build
step and a glue-JS format that does not load inside an AudioWorklet (its
`--target web` output relies on `fetch`/ESM). Raw `extern "C"` over linear memory
is smaller and simpler.

State lives behind an opaque handle rather than a global; `static mut` references
are a hard error in edition 2024.

| Export | Signature | Notes |
|---|---|---|
| `plaits_new` | `(block_size: usize, sample_rate: f32) -> *mut Synth` | allocates; calls `Voice::init` |
| `plaits_free` | `(*mut Synth)` | |
| `plaits_out_ptr` | `(*mut Synth) -> *mut f32` | stable for the handle's lifetime |
| `plaits_aux_ptr` | `(*mut Synth) -> *mut f32` | |
| `plaits_set_param` | `(*mut Synth, id: u32, value: f32)` | unknown id is ignored |
| `plaits_render` | `(*mut Synth)` | fills out/aux with `block_size` frames |

`Synth` owns `Voice<'static>`, `Patch`, `Modulations`, and two `Box<[f32]>`
buffers. `Voice<'static>` is valid because `Resources::default()` is built from
consts.

### Parameter ids

One id-based setter keeps the ABI small. Params change at UI rate, so per-call
overhead is irrelevant. Ranges are grouped for readability:

- `0..` Patch: 0 engine, 1 note, 2 harmonics, 3 timbre, 4 morph, 5 decay,
  6 lpg_colour, 7 frequency_modulation_amount, 8 timbre_modulation_amount,
  9 morph_modulation_amount
- `16..` Modulations: 16 engine, 17 note, 18 frequency, 19 harmonics, 20 timbre,
  21 morph, 22 trigger, 23 level
- `32..` Modulations flags (0.0 false / non-zero true): 32 frequency_patched,
  33 timbre_patched, 34 morph_patched, 35 trigger_patched, 36 level_patched

`engine` is clamped to `0..=NUM_ENGINES-1` (0..=23) and cast to `usize`; the rest
are stored as `f32` and left to the library's own clamping.

### Browser side

`main.js` fetches the wasm bytes, creates `new AudioContext({ sampleRate: 48000
})`, adds the worklet module, then `postMessage`s the raw `ArrayBuffer` of wasm
bytes to the processor. The worklet global scope has no `fetch`, so the
processor compiles the module itself, synchronously, with
`new WebAssembly.Module(bytes)` in its message handler, then instantiates it.

**Tried and rejected:** the more obvious design compiles the module once on the
main thread (`WebAssembly.compile()`) and `postMessage`s the resulting
`WebAssembly.Module` — it is structured-cloneable in the spec, and this is the
pattern most examples use. In practice, Chromium silently **drops** a message
whose payload contains a `WebAssembly.Module` when the target is an
`AudioWorkletProcessor`'s port: the message never reaches `onmessage`, no error
is raised anywhere, and the worklet just never becomes ready. This was
reproduced with a minimal 8-byte module, so it is not specific to this
project's wasm output. `ArrayBuffer` payloads deliver fine, which is why bytes,
not a compiled `Module`, cross the port.

`block_size` is fixed at 128 to match the render quantum. The context is pinned to
48 kHz because the library's README warns that other rates sound noticeably
different, and Safari and some Macs default to 44.1 kHz.

`process()` calls `plaits_render`, then copies out/aux from linear memory into the
output channels with a user-controlled mix. UI changes reach the processor by
`postMessage` and are applied via `plaits_set_param` before the next render.

**Detached buffer guard:** the `Float32Array` views over `memory.buffer` are
re-created whenever `memory.buffer` differs from the cached reference. Everything
is allocated up front and `render` does not allocate, so memory should never grow,
but a detached view fails silently as noise rather than as an error.

**Benchmark on the main thread:** `performance.now()` is not reliably exposed in
`AudioWorkletGlobalScope`. The demo instantiates a second copy of the same module
on the main thread and times N blocks per engine there. This yields the real
wasm-vs-native comparison without perturbing the audio thread.

### Build profile

`opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"`. This is DSP;
optimise for speed, not size. Expect roughly a 200-300 KB `.wasm` (~134 KB of it
is the library's const lookup tables: wavetables, sysex banks, LPC/fold/sine).
`wasm-opt` is not installed and is not required.

Serving requires a local HTTP server (`python3 -m http.server`); module scripts and
`WebAssembly` instantiation do not work over `file://`.

## Testing

Rust, on the host target (the crate is `rlib` too, so tests run normally):

- param id mapping: each id writes the field it claims to, unknown ids are ignored
- handle lifecycle: `new` then `free`; render into a freshly created handle
- render fills the buffer: output is non-silent for a triggered engine, and finite
  (no NaN/inf) across all 24 engines
- allocation-free render: assert no allocation occurs during `plaits_render`, using
  a counting `#[global_allocator]` declared in a dedicated integration test file
  (a global allocator applies to the whole test binary, so it cannot share a file
  with tests that allocate freely)

Browser: load the page under Playwright, confirm the module instantiates, the
worklet starts, and the output is non-silent (read back via an AnalyserNode).

## Risks

- Switching to engines 2/3/4 parses a 4 KB sysex bank inside `Voice::render` on the
  audio thread, and the six-op `spin::Once` algorithm table initialises on first
  use. Non-allocating but potentially audible as a click on engine change.
  Accepted for this slice; the fix is pre-warming off-thread.
- wasm has no flush-to-zero control, unlike native SSE. Decaying envelopes and
  filter tails can produce denormals, which are slow on some hardware. The timing
  margin is large enough that this is unlikely to matter; the benchmark will show
  it if it does.
- Browsers require a user gesture before an AudioContext starts. The page needs an
  explicit start button, which also matters for the Playwright check.

## Deferred

Polyphony and voice allocation; Web MIDI with the CC map from the library's
`midi_control` example; a SharedArrayBuffer/worker architecture (only worth its
COOP/COEP requirements if voice count grows); `wasm-opt` size reduction.
