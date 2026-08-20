# ADR-005: Logging Estructurado en JSON y Trazabilidad de Peticiones con Correlation ID

## Estado
Aceptado

## Contexto
El sistema de backend registraba eventos y errores mediante `console.log` y `console.error` con cadenas de texto plano desestructuradas. Al operar con múltiples servidores de juegos, usuarios concurrentes y workers en paralelo, era imposible correlacionar un fallo específico en un endpoint con el usuario, la petición HTTP o el contenedor involucrado.

## Decisión
1. **Logger Estructurado Nativo (`src/utils/logger.js`):**
   - Soporta niveles estándar: `debug`, `info`, `warn`, `error`, `fatal`.
   - En entornos `production` y `staging`, emite logs en formato NDJSON estructurado con campos estándar: `timestamp`, `level`, `reqId`, `module`, `msg`, `context` y `err` (con serialización de nombre, código, mensaje y stack trace).
   - En desarrollo, emite logs formateados legibles para inspección rápida en terminal.
   - Soporte para sub-loggers contextuales mediante `logger.child({ module: '...', ... })`.
2. **Middleware de Trazabilidad (`src/middleware/requestLogger.js`):**
   - Asigna o propaga un `req.id` único (`crypto.randomUUID()` o cabecera `X-Request-ID` entrante).
   - Establece la cabecera de respuesta HTTP `X-Request-ID: <id>`.
   - Inyecta `req.log` como child logger contextual en cada objeto de petición de Express.
   - Registra automáticamente métricas de latencia (`duration_ms`), código de estado (`status`), método y ruta al completarse cada respuesta.
3. **Manejador Global de Excepciones:**
   - Captura errores 4xx y 5xx asociándolos automáticamente con el `req.id` y retornándolo en el payload JSON de error para facilitar el soporte al cliente.

## Consecuencias
### Positivas:
- Integración inmediata con herramientas de agregación de logs (Datadog, Loki, CloudWatch, Grafana).
- Trazabilidad de punta a punta: el cliente o desarrollador puede buscar cualquier error reportado usando el `X-Request-ID`.
- Detección precisa de cuellos de botella de rendimiento mediante la métrica automática `duration_ms`.
