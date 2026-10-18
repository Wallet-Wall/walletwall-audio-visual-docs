#!/usr/bin/env bash
# Canonical build of the Motion Intelligence WebAssembly artifact.
#
#   bash motion-intelligence/build-wasm.sh <out.wasm>
#
# Builds with the toolchain pinned in rust-toolchain.toml and the dependencies pinned in Cargo.lock,
# remapping CARGO_HOME to /cargo so no machine-specific path (a home directory, a user name) ends up
# in the binary. Runs on Linux or macOS (CI, WSL); a Windows host embeds backslash paths and cannot
# produce the canonical bytes, so it is refused. Writes <out.wasm> and <out.wasm>.build.json (the
# toolchain that made it). `node scripts/motion-wasm.ts --write|--check <out.wasm>` takes it from there.
set -euo pipefail

out="${1:?usage: build-wasm.sh <out.wasm>}"
# Resolve the output against the caller's directory before this script changes directory.
case "$out" in
  /*) ;;
  *) out="$PWD/$out" ;;
esac
case "$(uname -s)" in
  Linux | Darwin) ;;
  *)
    echo "build-wasm.sh: canonical builds run on Linux or macOS (CI, WSL); $(uname -s) embeds host paths." >&2
    exit 2
    ;;
esac

crate_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
cargo_home="$(cd "$cargo_home" && pwd)"
target_dir="${CARGO_TARGET_DIR:-$crate_dir/target}"
rustflags="--remap-path-prefix=$cargo_home=/cargo"

cd "$crate_dir"
# The pinned toolchain comes from rust-toolchain.toml; install it (with its wasm32 target) once with
# `rustup toolchain install` in this directory. CI does that in its own step.
RUSTFLAGS="$rustflags" CARGO_TARGET_DIR="$target_dir" \
  cargo build --release --locked --target wasm32-unknown-unknown

mkdir -p "$(dirname "$out")"
cp "$target_dir/wasm32-unknown-unknown/release/motion_intelligence.wasm" "$out"
rustc_version="$(rustc --version)"
host="$(rustc -vV | sed -n 's/^host: //p')"
cat >"$out.build.json" <<EOF
{
  "rustc": "$rustc_version",
  "host": "$host",
  "target": "wasm32-unknown-unknown",
  "profile": "release",
  "rustflags": "--remap-path-prefix=<CARGO_HOME>=/cargo"
}
EOF
echo "build-wasm.sh: $out ($(wc -c <"$out") bytes, $rustc_version on $host)"
