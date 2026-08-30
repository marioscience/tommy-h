#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  bpftool clang llvm libelf-dev linux-libc-dev pkg-config build-essential zstd
sudo rm -rf /var/lib/apt/lists/*

# Los builds ejecutados por Docker pueden dejar cachés del bind mount con uid 0.
# Recupera únicamente artefactos ignorados para que Cargo funcione como `node`.
for build_dir in oxideproxy/target oxideproxy/artifacts; do
  if [[ -d "$build_dir" ]]; then
    sudo chown -R "$(id -u):$(id -g)" "$build_dir"
  fi
done

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable
  export PATH="$HOME/.cargo/bin:$PATH"
fi
rustup toolchain install nightly --profile minimal --component rust-src
if ! command -v bpf-linker >/dev/null 2>&1; then
  archive="$(mktemp --suffix=.tar.zst)"
  bpf_linker_version="v0.11.0"
  bpf_linker_sha256="10f62ba9ab7e544d538370552660efcb4f1a19153d5752bbf0f6b51f3bada450"
  curl --proto '=https' --tlsv1.2 --http1.1 -fsSL \
    "https://github.com/aya-rs/bpf-linker/releases/download/${bpf_linker_version}/bpf-linker-x86_64-unknown-linux-musl.tar.zst" \
    -o "$archive"
  printf '%s  %s\n' "$bpf_linker_sha256" "$archive" | sha256sum --check --status
  extract_dir="$(mktemp -d)"
  tar --zstd -xf "$archive" -C "$extract_dir"
  sudo install -m 0755 "$extract_dir/bpf-linker" /usr/local/bin/bpf-linker
  rm -rf "$extract_dir"
  rm -f "$archive"
fi

printf '%s\n' 'eBPF/XDP development toolchain ready.'
bpftool version
