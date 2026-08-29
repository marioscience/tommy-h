# Etapa 1: Compilación de Alto Rendimiento en Rust
FROM rust:bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS ebpf-builder

ARG BPF_LINKER_VERSION=v0.11.0
ARG BPF_LINKER_SHA256=10f62ba9ab7e544d538370552660efcb4f1a19153d5752bbf0f6b51f3bada450
ARG RUST_NIGHTLY_TOOLCHAIN=nightly-2026-08-29
ENV RUST_NIGHTLY_TOOLCHAIN=${RUST_NIGHTLY_TOOLCHAIN}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/* \
    && attempt=1 \
    && while ! RUSTUP_MAX_RETRIES=5 rustup toolchain install "${RUST_NIGHTLY_TOOLCHAIN}" --profile minimal --component rust-src; do \
         if [ "$attempt" -ge 4 ]; then exit 1; fi; \
         sleep_seconds=$((attempt * 5)); \
         echo "rustup download failed; retrying in ${sleep_seconds}s (attempt ${attempt}/4)" >&2; \
         sleep "$sleep_seconds"; \
         attempt=$((attempt + 1)); \
       done \
    && curl --proto '=https' --tlsv1.2 --http1.1 --retry 5 --retry-all-errors --connect-timeout 30 -fsSL \
      "https://github.com/aya-rs/bpf-linker/releases/download/${BPF_LINKER_VERSION}/bpf-linker-x86_64-unknown-linux-musl.tar.zst" \
      -o /tmp/bpf-linker.tar.zst \
    && printf '%s  %s\n' "${BPF_LINKER_SHA256}" /tmp/bpf-linker.tar.zst | sha256sum --check --status \
    && tar --zstd -xf /tmp/bpf-linker.tar.zst -C /usr/local/bin \
    && rm /tmp/bpf-linker.tar.zst

WORKDIR /usr/src/oxide_proxy
COPY Cargo.toml Cargo.lock ./
COPY ebpf ./ebpf
COPY scripts/build-ebpf.sh ./scripts/build-ebpf.sh
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=120 CARGO_HTTP_MULTIPLEXING=false ./scripts/build-ebpf.sh

FROM rust:bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS builder

WORKDIR /usr/src/oxide_proxy

# Optimizamos la caché de capas copiando primero solo los manifiestos
COPY Cargo.toml Cargo.lock ./
COPY ebpf/Cargo.toml ./ebpf/Cargo.toml
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    mkdir -p src/bin ebpf/src && echo "fn main() {}" > src/main.rs && echo "fn main() {}" > src/bin/cert_gen.rs \
    && echo '#![no_std]' > ebpf/src/main.rs \
    && CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=120 CARGO_HTTP_MULTIPLEXING=false cargo build --release --locked \
    && rm -rf src ebpf/src

# Copiamos el código fuente real y configuraciones
COPY . .

# Generamos los certificados de prueba durante la compilación auxiliar
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    touch src/bin/cert_gen.rs \
    && CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=120 CARGO_HTTP_MULTIPLEXING=false cargo run --release --locked --bin cert_gen

# Compilamos el binario principal de producción en modo release
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    touch src/main.rs && CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=120 CARGO_HTTP_MULTIPLEXING=false cargo build --release --locked

# Preparamos los puntos de montaje que Docker necesita antes de aplicar el
# sistema de archivos de solo lectura de la imagen final.
RUN mkdir -p /runtime-root/var/www/frontend/data/templates \
    /runtime-root/var/www/query-cache \
    /runtime-root/app/acme \
    /runtime-root/app/runtime \
    && chown -R 65532:65532 /runtime-root

# Etapa 2: Imagen de Producción Minimalista (Distroless cc-debian12)
FROM gcr.io/distroless/cc-debian12@sha256:6e1871c34683dc9ee996d13084497783fd98ac0200213d0826625f4e9d4be1d0

WORKDIR /app

# Copiamos el binario compilado y los certificados generados
COPY --from=builder /usr/src/oxide_proxy/target/release/oxide_proxy /app/oxide_proxy
COPY --from=ebpf-builder /usr/src/oxide_proxy/artifacts/oxide-ebpf.o /app/oxide-ebpf.o
COPY --from=builder --chown=65532:65532 /usr/src/oxide_proxy/config /app/config
COPY --from=builder /runtime-root/var/www /var/www
COPY --from=builder --chown=65532:65532 /runtime-root/app/acme /app/acme
COPY --from=builder --chown=65532:65532 /runtime-root/app/runtime /app/runtime

# Configuramos variables de entorno para telemetría
ENV RUST_LOG=warn,oxide_proxy=info

# Exponemos puertos Ingress (TCP 8443, UDP 8080)
EXPOSE 8443/tcp
EXPOSE 8080/udp

# Ejecutamos el servidor proxy
USER 65532:65532
CMD ["./oxide_proxy"]
