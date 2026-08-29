#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/ebpf"
cargo +nightly build --release --target bpfel-unknown-none -Z build-std=core
install -Dm0644 \
  "$ROOT_DIR/target/bpfel-unknown-none/release/oxide-ebpf" \
  "$ROOT_DIR/artifacts/oxide-ebpf.o"
printf 'Built %s\n' "$ROOT_DIR/artifacts/oxide-ebpf.o"
