# Laboratorio Rust del backend

La primera fase compara el camino estable `tar --zstd` con el módulo Rust N-API usando exactamente los mismos datos. Producción continúa usando `BACKUP_ARCHIVE_ENGINE=tar` hasta que los resultados Linux demuestren equivalencia y una mejora repetible.

En Ubuntu instala `nodejs`, `tar`, `zstd` y `time`, y ejecuta:

```bash
BACKUP_BENCH_SIZE_MIB=256 BACKUP_BENCH_ROUNDS=3 bash benchmarks/rust-runtime/run-backup-benchmark.sh
```

El script falla si el módulo Rust no está cargado, verifica el SHA-256 lógico de todos los archivos restaurados y guarda tiempo, CPU, pico de RAM y tamaño en `results/backup-summary.json`.

Para medir el cruce N-API de telemetría, hashes grandes y el coste real del parser RCON:

```bash
node benchmarks/rust-runtime/profile-native-paths.mjs > benchmarks/rust-runtime/results/native-paths.json
```

El perfil RCON decide si merece una migración: no se cambia de lenguaje cuando su coste por paquete es despreciable frente a la red.

## Decisiones medidas en Cerbero

- SHA-256 de 512 MiB: Rust redujo el CPU aproximadamente un 80 % y produjo el mismo digest.
- Telemetría: Docker se consulta concurrentemente en lotes acotados de 15. El parseo permanece por muestra porque serializar un lote completo para N-API consumió más CPU.
- RCON Source: el parser JavaScript medido ronda 1 microsegundo por paquete; no se justifica migrarlo a Rust.
- Restauración nativa: ZIP y `tar.zst` rechazan rutas inseguras, enlaces y datos expandidos por encima del almacenamiento contratado.

El artefacto Linux se compila para Alpine/musl. En desarrollo sin ese binario, el puente usa sus fallbacks JavaScript y el motor de backups estable continúa siendo `tar`. Para activar deliberadamente el laboratorio usa `BACKUP_ARCHIVE_ENGINE=rust`; nunca cambies este valor global sin repetir pruebas de integridad y restauración en Linux.

La versión de Rust está fijada en `backend/rust-util/rust-toolchain.toml`. Como
el runtime usa Alpine/musl, la comprobación local debe ejecutarse en la misma
imagen fijada que CI (desde la raíz del repositorio):

```bash
docker run --rm -v "$PWD:/workspace" -w /workspace/backend/rust-util \
  rust@sha256:1716b3aa042d735f4566d14dc54e8037de9d69556e2d5dd58131d93a613d173d \
  sh -c 'apk add --no-cache nodejs npm musl-dev && npm ci --ignore-scripts && npm run format:check && npm run build:release'
cd backend/rust-util
cp index.linux-x64-musl.node ../src/utils/ragenodes_napi.node
```

CI repite esa compilación y ejecuta la suite del backend con el módulo nativo
cargado. La imagen backend también lo compila desde los lockfiles: el repositorio
no versiona binarios generados ni puede desplegar accidentalmente uno obsoleto.
