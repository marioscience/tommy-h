# Etapa 1: Compilación de Alto Rendimiento en Rust
FROM rust:bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS builder

WORKDIR /usr/src/oxide_proxy

# Optimizamos la caché de capas copiando primero solo los manifiestos
COPY Cargo.toml Cargo.lock ./
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    mkdir -p src/bin && echo "fn main() {}" > src/main.rs && echo "fn main() {}" > src/bin/cert_gen.rs \
    && CARGO_NET_RETRY=10 CARGO_HTTP_TIMEOUT=120 CARGO_HTTP_MULTIPLEXING=false cargo build --release --locked \
    && rm -rf src

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
COPY --from=builder /usr/src/oxide_proxy/config /app/config
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
