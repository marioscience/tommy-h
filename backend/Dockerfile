# --- Backend Node.js ---
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app

# Herramientas necesarias para el sistema
RUN apk add --no-cache mariadb-client tar gzip zstd

# Instalación de dependencias de Node
COPY package*.json ./
RUN npm ci --omit=dev

# Copiamos el código del backend (incluye el módulo nativo ragenodes_napi.node)
COPY src ./src

# Optimizaciones de entorno para máximo rendimiento
ENV NODE_ENV=production
ENV UV_THREADPOOL_SIZE=12

EXPOSE 3006
# Ejecución directa con flags de alto rendimiento para V8
# --max-old-space-size=4096: Aprovecha la RAM disponible para reducir la frecuencia del GC
# --no-warnings: Reduce el I/O de logs innecesarios
CMD ["node", "--max-old-space-size=4096", "--no-warnings", "src/server.js"]
