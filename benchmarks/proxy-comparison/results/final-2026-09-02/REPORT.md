# OxideProxy 0.0.1 vs NGINX 1.31.4 — resultado local

Fecha: 2026-09-02
Host: Intel Core i9-12900HX, 24 hilos visibles, 63.73 GiB RAM, Docker Desktop 29.5.3
Límites por proxy: 2 vCPU, 512 MiB, misma red Docker, mismo backend Node.js.

## Resultado consolidado (media de 3 rondas)

| Proxy | Protocolo | operaciones/s | p50 | p95 | p99 | errores/pérdidas | CPU media* | CPU pico* | Memoria pico* |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NGINX 1.31.4 | HTTP | 18,424.61 | 6.650 ms | 9.010 ms | 11.203 ms | 0 | 72.84% | 108.44% | 23.20% |
| OxideProxy | HTTP | 17,195.35 | 7.030 ms | 9.770 ms | 12.007 ms | 0 | 74.66% | 105.28% | 4.36% |
| NGINX 1.31.4 | TCP | 27,851.57 | 3.827 ms | 7.680 ms | 8.573 ms | 0 | 72.84% | 108.44% | 23.20% |
| OxideProxy | TCP | 28,943.16 | 3.630 ms | 7.320 ms | 8.583 ms | 0 | 74.66% | 105.28% | 4.36% |
| NGINX 1.31.4 | UDP | 25,395.19 | 4.777 ms | 7.007 ms | 9.290 ms | 0 | 72.84% | 108.44% | 23.20% |
| OxideProxy | UDP | 4,400.00 | 30.350 ms | 36.083 ms | 39.500 ms | 0 | 74.66% | 105.28% | 4.36% |

\* Docker Desktop entrega una muestra conjunta durante las fases HTTP/TCP/UDP de cada ronda; por eso CPU y memoria son valores por proxy/ronda, no costes exclusivos de cada protocolo.

## Lectura directa

- **HTTP:** NGINX entrega 7.15% más solicitudes/s y un p99 6.70% menor.
- **TCP:** OxideProxy entrega 3.92% más mensajes/s. El p99 queda esencialmente empatado (diferencia de 0.01 ms).
- **UDP:** NGINX entrega 5.77 veces más datagramas/s y su p99 es 4.25 veces menor.
- **Memoria:** OxideProxy alcanza aproximadamente 22.3 MiB frente a 118.8 MiB de NGINX; usa cerca de 81% menos memoria dentro del límite de 512 MiB.
- **Fiabilidad bajo esta carga:** ambos completaron 270,000 operaciones medidas sin errores ni pérdida (90,000 HTTP + 90,000 TCP + 90,000 UDP por proxy).

## Veredicto

NGINX gana como proxy general en esta versión: domina HTTP y, sobre todo, UDP. OxideProxy gana en eficiencia de memoria y presenta una pequeña ventaja TCP, además de ofrecer capacidades específicas que NGINX no incorpora por sí solo (ruteo de juegos, telemetría y mitigación XDP/eBPF).

Para tráfico de juegos UDP, **OxideProxy 0.0.1 todavía no debe declararse más rápido que NGINX**. El perfil observado coincide con el diseño actual: el bucle UDP dedicado espera `process_udp_packet_inline(...).await` antes de recibir el siguiente datagrama. La siguiente optimización debe desacoplar recepción y reenvío con una ruta acotada por sesión/worker, conservando orden, límites y protección contra amplificación.

## Metodología y límites

- Tres rondas independientes; se alternó el orden entre las parejas para reducir el efecto de calentamiento.
- Cada ronda/proxy: calentamiento y luego 30,000 HTTP, 30,000 TCP y 30,000 UDP.
- HTTP: 128 conexiones concurrentes con keep-alive. TCP: 128 conexiones persistentes. UDP: ventana de 128 datagramas.
- Se usó NGINX oficial mainline `nginx:1.31.4-alpine`, ajustado para juegos (2 workers, `epoll`, `reuseport`, 131,072 conexiones y proxy TCP/UDP stream).
- XDP nativo no forma parte de la puntuación: Docker Desktop corre dentro de una VM y no reproduce justamente el camino XDP de la NIC del host Linux.
- Es una prueba local de proxy y backend; no sustituye una prueba multi-host sobre Internet, jitter WAN, TLS a escala o mitigación DDoS real.

## Evidencia reproducible

Datos crudos de las rondas oficiales:

- NGINX: `../2026-09-02T03-48-22-463Z/raw-results.json`
- OxideProxy: `../2026-09-02T03-48-35-986Z/raw-results.json`
- OxideProxy: `../2026-09-02T03-49-32-370Z/raw-results.json`
- NGINX: `../2026-09-02T03-50-32-280Z/raw-results.json`
- NGINX: `../2026-09-02T03-51-27-784Z/raw-results.json`
- OxideProxy: `../2026-09-02T03-52-04-245Z/raw-results.json`

Cada carpeta conserva además el `compose.yml`, las configuraciones exactas y el generador empleado.
