# Etapa 1: Compilación de Alto Rendimiento en Rust
FROM rust:bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS builder

WORKDIR /usr/src/oxide_proxy

# Optimizamos la caché de capas copiando primero solo los manifiestos
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src/bin && echo "fn main() {}" > src/main.rs && echo "fn main() {}" > src/bin/cert_gen.rs \
    && cargo build --release --locked \
    && rm -rf src

# Copiamos el código fuente real y configuraciones
COPY . .

# Generamos los certificados de prueba durante la compilación auxiliar
RUN cargo run --release --locked --bin cert_gen

# Compilamos el binario principal de producción en modo release
RUN touch src/main.rs && cargo build --release --locked

# Etapa 2: Imagen de Producción Minimalista (Distroless cc-debian12)
FROM gcr.io/distroless/cc-debian12@sha256:6e1871c34683dc9ee996d13084497783fd98ac0200213d0826625f4e9d4be1d0

WORKDIR /app

# Copiamos el binario compilado y los certificados generados
COPY --from=builder /usr/src/oxide_proxy/target/release/oxide_proxy /app/oxide_proxy
COPY --from=builder /usr/src/oxide_proxy/config /app/config

# Configuramos variables de entorno para telemetría
ENV RUST_LOG=warn,oxide_proxy=info

# Exponemos puertos Ingress (TCP 8443, UDP 8080)
EXPOSE 8443/tcp
EXPOSE 8080/udp

# Ejecutamos el servidor proxy
CMD ["./oxide_proxy"]
