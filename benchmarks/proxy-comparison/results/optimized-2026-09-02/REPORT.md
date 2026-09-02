# OxideProxy UDP optimizado vs NGINX 1.31.4

Fecha: 2026-09-02
Imagen OxideProxy: `ragenodes/oxideproxy:0.1.0-udp-optimized-local`
Host: Intel Core i9-12900HX, Docker Desktop 29.5.3
Límites por proxy: 2 vCPU, 512 MiB, misma red y mismo backend.

## Resultado consolidado (media de 3 rondas nuevas)

| Proxy | Protocolo | operaciones/s | p50 | p95 | p99 | errores/pérdidas | CPU media* | CPU pico* | Memoria pico* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NGINX 1.31.4 | HTTP | 4,396.72 | 28.847 ms | 41.050 ms | 49.713 ms | 0 | 80.10% | 107.54% | 23.23% |
| OxideProxy optimizado | HTTP | 4,480.39 | 29.163 ms | 41.160 ms | 49.870 ms | 0 | 89.42% | 105.69% | 4.08% |
| NGINX 1.31.4 | TCP | 7,365.02 | 15.157 ms | 30.313 ms | 35.620 ms | 0 | 80.10% | 107.54% | 23.23% |
| OxideProxy optimizado | TCP | 9,230.79 | 11.597 ms | 22.967 ms | 26.863 ms | 0 | 89.42% | 105.69% | 4.08% |
| NGINX 1.31.4 | UDP | 8,475.45 | 14.623 ms | 20.493 ms | 28.897 ms | 0 | 80.10% | 107.54% | 23.23% |
| OxideProxy optimizado | UDP | 8,957.92 | 13.957 ms | 18.587 ms | 21.617 ms | 0 | 89.42% | 105.69% | 4.08% |

\* CPU y memoria son muestras conjuntas por proxy durante las tres fases de cada ronda.

## Comparación directa en esta ejecución

- **HTTP:** OxideProxy procesa 1.90% más solicitudes/s; las latencias quedan prácticamente empatadas.
- **TCP:** OxideProxy procesa 25.33% más mensajes/s y reduce el p99 24.59%.
- **UDP:** OxideProxy procesa 5.69% más datagramas/s y reduce el p99 25.19%.
- **Memoria:** OxideProxy alcanza aproximadamente 20.9 MiB frente a 118.9 MiB de NGINX, cerca de 82% menos.
- **Fiabilidad:** ambos completaron 270,000 operaciones medidas sin errores ni pérdida.

## Mejora frente a OxideProxy anterior

| Métrica UDP | Antes | Ahora | Cambio |
|---|---:|---:|---:|
| Rendimiento | 4,400.00 pkt/s | 8,957.92 pkt/s | **+103.59%** |
| p50 | 30.350 ms | 13.957 ms | **−54.01%** |
| p95 | 36.083 ms | 18.587 ms | **−48.49%** |
| p99 | 39.500 ms | 21.617 ms | **−45.27%** |

La carga general de Windows/Docker fue distinta entre sesiones: NGINX también pasó de 25,395 a 8,475 UDP/s. Por eso la evidencia más sólida es la comparación simultánea relativa:

- Antes, OxideProxy alcanzaba el **17.33%** del rendimiento UDP de NGINX.
- Ahora alcanza el **105.69%** del rendimiento UDP de NGINX.
- La posición relativa de OxideProxy mejoró aproximadamente **6.10 veces**.

## Cambios aplicados

- El backend de cada ruta UDP dedicada se resuelve una sola vez al iniciar el listener; se eliminó DNS por datagrama.
- Recepción y reenvío se desacoplaron mediante tareas Tokio concurrentes.
- La concurrencia queda acotada por un semáforo por ruta (`workers × 1024`, mínimo 1024), evitando crecimiento ilimitado durante ataques.
- Las sesiones UDP ahora se identifican por cliente + backend + listener público. Esto impide cruces entre juegos que compartan la dirección de origen.
- Se añadió un contrato de regresión para el aislamiento de sesiones.

## Validación

- Dev Container del proyecto.
- 42/42 pruebas Rust correctas.
- Compilación `release` con optimización máxima y LTO completada.
- Prueba funcional HTTP/TCP/UDP previa a la carga.
- Tres rondas completas por proxy: 90,000 HTTP + 90,000 TCP + 90,000 UDP por proxy.
- XDP/eBPF sigue fuera de la puntuación porque Docker Desktop no reproduce el camino nativo de una NIC Linux.

## Datos crudos

- NGINX: `../2026-09-02T05-01-07-516Z/raw-results.json`
- OxideProxy: `../2026-09-02T05-01-37-670Z/raw-results.json`
- OxideProxy: `../2026-09-02T05-02-26-574Z/raw-results.json`
- NGINX: `../2026-09-02T05-03-51-303Z/raw-results.json`
- NGINX: `../2026-09-02T05-04-32-417Z/raw-results.json`
- OxideProxy: `../2026-09-02T05-05-00-417Z/raw-results.json`

Cada carpeta contiene también las configuraciones exactas y el generador usado.
