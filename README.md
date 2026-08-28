# mi-plaits-wasm

[Mutable Instruments Plaits](https://github.com/sourcebox/mi-plaits-dsp-rs) DSP
running in the browser through WebAssembly and an AudioWorklet. __You need to clone this repo as well and have it in the same folder since it is used as a dependency. Needs Rustup for wasm.__


**▶ [Try the live demo](https://davor111.github.io/mi-plaits-wasm/)** — needs a
browser with AudioWorklet support; click **Start audio** first, since browsers
only allow audio after a user gesture.


The `mi-plaits-dsp` library is used unmodified — it is `no_std`, allocation-free
in its render path, and compiles for `wasm32-unknown-unknown` as-is.

## Build

```sh
./build.sh                                  # writes docs/plaits.wasm
python3 -m http.server 8080 --directory docs
```

Then open <http://localhost:8080/> and click **Start audio**. Use the keyboard to play notes or the trigger button.

In case you use Homebrew: This no wasm standard library, so `build.sh` uses the rustup
toolchain by absolute path. Override with `CARGO_BIN=/path/to/cargo ./build.sh`.

The demo lives in `docs/` because that is the folder GitHub Pages serves from
the `main` branch. `docs/plaits.wasm` is committed so the published page has a
module to fetch — re-run `./build.sh` and commit the result whenever the Rust
side changes.

## Test

```sh
cargo test                  # host-target tests: param mapping, render, FFI aliasing
cargo test --test no_alloc  # proves render() never allocates
```
