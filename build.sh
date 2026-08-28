#!/usr/bin/env bash
# Builds the wasm module and drops it next to the demo page (docs/, which GitHub Pages serves).
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

# Invoking the toolchain's cargo directly (bypassing rustup's shims) means
# cargo falls back to whatever "rustc" it finds on PATH to compile, which on
# this machine is Homebrew's rustc (no wasm32 std). Pin RUSTC to the sibling
# binary in the same toolchain dir so it matches CARGO_BIN. Likewise the
# linker (rust-lld) needs the toolchain's libLLVM.dylib on its search path
# when invoked outside of rustup's normal proxying.
TOOLCHAIN_DIR="$(dirname "$CARGO_BIN")"
export RUSTC="${RUSTC:-$TOOLCHAIN_DIR/rustc}"
export DYLD_LIBRARY_PATH="$(dirname "$TOOLCHAIN_DIR")/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"

"$CARGO_BIN" build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/mi_plaits_wasm.wasm docs/plaits.wasm
ls -lh docs/plaits.wasm
