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

Measured with the in-page benchmark (**Run benchmark** button), which spins up a
second wasm instance on the main thread and times 2 (virtual) seconds of 128-frame
blocks per engine at 48 kHz, in Chromium 151.0.0.0 (Playwright-bundled build, run
on macOS/aarch64; `navigator.userAgent` reports `Chrome/151.0.0.0`).

| engine | x realtime | µs/block |
|---|---|---|
| 0 — virtual analog VCF | 488 | 5.47 |
| 1 — phase distortion | 392 | 6.80 |
| 2 — six-op FM 1 | 286 | 9.33 |
| 3 — six-op FM 2 | 339 | 7.87 |
| 4 — six-op FM 3 | 357 | 7.47 |
| 5 — wave terrain | 303 | 8.80 |
| 6 — string machine | 351 | 7.60 |
| 7 — chiptune | 1000 | 2.67 |
| 8 — virtual analog | 541 | 4.93 |
| 9 — waveshaping | 455 | 5.87 |
| 10 — FM | **143** | **18.67** |
| 11 — grain | 308 | 8.67 |
| 12 — additive | 313 | 8.53 |
| 13 — wavetable | 263 | 10.13 |
| 14 — chord | 408 | 6.53 |
| 15 — speech | 1429 | 1.87 |
| 16 — swarm | 274 | 9.73 |
| 17 — noise | 417 | 6.40 |
| 18 — particle | 189 | 14.13 |
| 19 — string | 274 | 9.73 |
| 20 — modal | 290 | 9.20 |
| 21 — bass drum | 345 | 7.73 |
| 22 — snare drum | 588 | 4.53 |
| 23 — hi-hat | 303 | 8.80 |

Worst engine is 10 (FM), at **143x realtime, 18.67 µs per 128-frame block** — well
inside the 2667 µs render-quantum budget at 48 kHz. The native aarch64 baseline
(from the design spec, same engine, same block/sample rate, same 4 Hz trigger)
is 174x realtime, 15.4 µs/block. Comparing block times, wasm is about **1.2x
slower than native** for the worst engine (18.67 / 15.4 ≈ 1.21). All other
engines stayed above 189x realtime in this run.

## Known issues

- Switching to engines 2, 3, or 4 parses a 4 KB sysex bank on the audio thread
  inside `Voice::render`, which can click.
- The demo is a single voice. Polyphony and Web MIDI are not implemented.
- Chromium silently **drops** a `postMessage` payload that carries a
  `WebAssembly.Module` when the target is an `AudioWorkletProcessor`'s port
  (reproduced with a minimal 8-byte module; `ArrayBuffer` payloads deliver
  fine). Because of this, the transport here is: the main thread sends the raw
  wasm **bytes**, and the worklet compiles them itself with a synchronous
  `new WebAssembly.Module(bytes)` before instantiating. Anyone reworking the
  main-thread/worklet transport should know this before reaching for the more
  obvious "compile once, postMessage the Module" approach.
