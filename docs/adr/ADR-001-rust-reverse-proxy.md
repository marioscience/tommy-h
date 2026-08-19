# ADR-001: Adopción de OxideProxy en Rust como Proxy Inverso de Alta Velocidad

## Estado
Aceptado

## Contexto
RageNodes maneja tráfico concurrente de streaming de logs, métricas de rendimiento por WebSockets, y descargas de assets de servidores de juegos (FiveM, Rust, Minecraft). Un proxy inverso basado en Node.js o proxies tradicionales pesados aumentaba la latencia y consumía recursos innecesarios de CPU.

## Decisión
Desarrollar **`OxideProxy`** en **Rust**, compilado en una imagen minimalista de seguridad *distroless* (`gcr.io/distroless/cc-debian12`).

## Consecuencias
### Positivas:
- Latencia sub-milisegundo en proxying y caché de consultas.
- Consumo mínimo de memoria RAM (< 20MB) en producción.
- Seguridad reforzada con imágenes de solo lectura (*read-only*).

### Negativas / Mitigaciones:
- Requiere compilación multi-etapa en Docker (mitigado con builder caching en Dockerfile).
