# Laboratorio Rust del backend

La primera fase compara el camino estable `tar --zstd` con el módulo Rust N-API usando exactamente los mismos datos. Producción continúa usando `BACKUP_ARCHIVE_ENGINE=tar` hasta que los resultados Linux demuestren equivalencia y una mejora repetible.

En Ubuntu instala `nodejs`, `tar`, `zstd` y `time`, y ejecuta:

```bash
BACKUP_BENCH_SIZE_MIB=256 BACKUP_BENCH_ROUNDS=3 bash benchmarks/rust-runtime/run-backup-benchmark.sh
```

El script falla si el módulo Rust no está cargado, verifica el SHA-256 lógico de todos los archivos restaurados y guarda tiempo, CPU, pico de RAM y tamaño en `results/backup-summary.json`.
