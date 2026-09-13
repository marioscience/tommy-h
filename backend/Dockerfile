# --- Dependencias de produccion (npm no llega a la imagen final) ---
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS dependencies
WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Acelerador N-API: compilado desde lockfiles para evitar binarios obsoletos ---
FROM rust@sha256:1716b3aa042d735f4566d14dc54e8037de9d69556e2d5dd58131d93a613d173d AS native-builder
WORKDIR /native
RUN apk add --no-cache nodejs npm musl-dev
COPY rust-util/package*.json rust-util/Cargo.toml rust-util/Cargo.lock rust-util/build.rs rust-util/rust-toolchain.toml ./
COPY rust-util/src ./src
RUN npm ci --ignore-scripts \
    && npm run format:check \
    && npm run build:release \
    && test -s index.linux-x64-musl.node

# --- Runtime comun: sin npm, corepack ni rclone ---
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime-base
WORKDIR /app

RUN apk add --no-cache mariadb-client tar gzip zstd rsync \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node src ./src
COPY --from=native-builder --chown=node:node /native/index.linux-x64-musl.node ./src/utils/ragenodes_napi.node

ENV NODE_ENV=production
ENV UV_THREADPOOL_SIZE=12

EXPOSE 3006
USER node
CMD ["node", "--max-old-space-size=4096", "--no-warnings", "src/server.js"]

# Variante optativa y aislada para el worker de copias remotas.
# Se activa unicamente con docker-compose.backup-remote.yml.
FROM runtime-base AS backup-remote
USER root
RUN apk add --no-cache rclone
USER node

# La etapa final predeterminada nunca contiene rclone.
FROM runtime-base AS runtime
