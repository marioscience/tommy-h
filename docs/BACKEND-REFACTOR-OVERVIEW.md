# Overview de la refactorización del backend

Este documento resume la refactorización acumulada en
`refactor/backend-config-boundaries`. Su objetivo fue reducir acoplamiento,
facilitar auditorías y permitir que varios desarrolladores trabajen en el
backend sin depender de archivos monolíticos. No fue una reescritura: se
preservaron rutas HTTP, respuestas públicas, esquema de datos y comportamiento
operativo mediante pruebas de caracterización y contratos arquitectónicos.

## Situación inicial

El backend funcionaba, pero varias responsabilidades convivían en los mismos
archivos:

- rutas HTTP con SQL, reglas de negocio y operaciones Docker;
- ciclo de vida, telemetría y transporte multinodo dentro de `dockerService`;
- protocolo RCON mezclado con parsers específicos de juegos;
- configuración de ARK, requisitos de planes y persistencia INI juntos;
- migraciones base e incrementales en un catálogo cercano al límite estructural;
- workers, temporizadores y tareas duraderas difíciles de distinguir de la API;
- dominios administrativos, pagos y Discord concentrados en compositores de rutas.

Esto aumentaba el riesgo de regresiones, hacía más lenta la revisión y favorecía
que una función nueva terminara duplicando SQL, temporizadores o lógica de
infraestructura.

## Principios aplicados

La dirección de dependencias acordada es:

```text
routes -> middleware -> services -> repositories -> db
                              \-> game adapters / integrations
                    \-> pure policies
workers ------------> services
```

Además:

1. Las rutas traducen HTTP, pero no contienen orquestación extensa ni SQL nuevo.
2. Los servicios coordinan casos de uso y efectos externos.
3. Los repositorios son dueños del SQL de cada agregado.
4. Las políticas puras contienen decisiones deterministas y fáciles de probar.
5. Los adaptadores de juegos encapsulan imágenes, puertos, entorno y volúmenes.
6. Solo los workers inician temporizadores y consumidores de colas.
7. Ningún archivo de `backend/src` puede superar 500 líneas físicas.
8. Las fachadas conservan imports públicos mientras la implementación se divide.

## Trabajo realizado

### Servidores y persistencia

- El antiguo servicio general de servidores se dividió en creación, control,
  eliminación, mantenimiento, selección de nodo y ciclo de vida de runtime.
- Las consultas reutilizadas pasaron a repositorios de servidores, usuarios,
  nodos, backups, notificaciones, despliegues y proxies perimetrales.
- La recreación usa cambios atómicos de estado para impedir dos operaciones
  simultáneas sobre la misma instancia.
- La eliminación borra primero los datos de la instancia y después su registro.

### Despliegues y workers

- El aprovisionamiento durable quedó fuera de las réplicas HTTP.
- Los trabajos se reservan y reclaman mediante repositorios con exclusión
  concurrente, reintentos y recuperación de leases abandonados.
- Los schedulers periódicos viven en workers explícitos para evitar duplicarlos
  al escalar la API.

### Docker

- Transporte multinodo, política de runtime, branding de txAdmin y utilidades de
  Docker fueron separados.
- `dockerTelemetryService.js` posee muestreo por lotes, caché y publicación en
  Redis; `dockerService.js` conserva la fachada de control de contenedores.
- `dockerService.js` quedó en 208 líneas y ya no contiene el recolector periódico.

### RCON

- `rcon/sourceRconClient.js` contiene socket, autenticación, framing, timeout y
  fallback controlado de Source RCON.
- `rconService.js` conserva los parsers y casos de uso de jugadores/chat sin
  implementar el transporte binario; quedó en 215 líneas.
- El decoder binario tiene pruebas para fragmentación, múltiples frames y
  longitudes malformadas.

### ARK

- `arkService.js` es una fachada compatible de 9 líneas.
- `ark/requirements.js` contiene la política pura de capacidad.
- `ark/configStore.js` contiene el catálogo y la persistencia de
  `GameUserSettings.ini`.
- La separación evita que cambios del panel modifiquen accidentalmente reglas de
  capacidad o preparación Docker.

### Backups

- Archivo/compresión, restauración transaccional, sincronización remota y
  migración de servidores son responsabilidades independientes.
- La restauración mantiene una copia compensatoria y reanuda el servidor tanto
  al confirmar como al revertir.

### Administración, Discord y pagos

- Catálogo comercial, observabilidad y operaciones privilegiadas de servidores
  se dividieron en módulos de rutas administrativos.
- Discord separa conocimiento, vendedores y operaciones de servidores.
- Pagos separa lectura, consentimiento, suscripciones y aprovisionamiento.
- La autenticación y el orden de rutas se preservaron mediante contratos.

### Configuración y migraciones

- La validación de seguridad ya no lee estado global: recibe una configuración
  explícita y se puede auditar/probar de forma aislada.
- El esquema inicial inmutable vive en `coreSchemaMigration.js`.
- Las evoluciones incrementales permanecen ordenadas en
  `migrationStatements.js`, que bajó de 495 a 394 líneas.
- La suite confirma identificadores únicos, orden cronológico e invariantes de
  las migraciones operativas.

## Validación actual

- Suite unitaria/contractual: **169 pruebas**.
- Resultado: **167 aprobadas, 0 fallos y 2 omitidas**.
- Las dos omitidas requieren el artefacto N-API nativo en Linux y se ejecutarán
  en la validación Linux posterior.
- Auditoría estructural: todos los módulos están por debajo de 500 líneas.
- Cobertura medida:
  - líneas: **46,51%**;
  - ramas: **70,69%**;
  - funciones: **31,98%**.
- `npm run test:coverage` protege mínimos iniciales de 45%, 65% y 30% para
  impedir regresiones mientras se amplían las pruebas de infraestructura.

La cobertura no se presenta como 98%. La arquitectura y mantenibilidad están
cerca de ese objetivo, pero la validación automática necesita más casos reales
en Docker, backups, creación de servidores y varios adaptadores de juegos.

## Integración real

`RUN_INTEGRATION=1 npm run test:integration` habilita pruebas contra PostgreSQL,
Redis, Docker y el backend del laboratorio. Estas pruebas verifican:

- migraciones y esquema versionado reales;
- rollback transaccional y salud posterior del pool PostgreSQL;
- ida y vuelta de claves Redis con expiración;
- repositorios contra el esquema real;
- exclusión concurrente e idempotencia de colas de despliegue y backups;
- inspección y telemetría de un contenedor real cuando existe uno disponible;
- endpoints reales de liveness y readiness.

Sin el indicador, la suite se omite explícitamente y no intenta conectarse por
accidente a infraestructura local o de producción.

## Qué no cambió

- No se modificaron intencionadamente URLs, contratos JSON ni códigos HTTP.
- No se reescribió el backend ni se sustituyó Node.js indiscriminadamente.
- No se promovió esta rama a `dev`, `staging` o `main`.
- No se modificaron ramas de otros desarrolladores.
- La rama conserva `dev` como ancestro y reúne toda la cadena de refactorización.

## Riesgos pendientes y siguiente validación

Antes del merge se recomienda:

1. Ejecutar las dos pruebas N-API en Linux.
2. Ejecutar la integración real en un laboratorio aislado.
3. Añadir pruebas de fallo para creación, restauración y transporte Docker.
4. Revisar el diff por propietarios de backend, seguridad y operaciones.
5. Confirmar pipeline verde y desplegar por el flujo `dev -> staging -> main`.

## Cómo revisar la rama

```bash
git fetch origin
git switch refactor/backend-config-boundaries
cd backend
npm ci
npm test
npm run test:coverage
```

Para integración real, usar únicamente el laboratorio preparado:

```bash
RUN_INTEGRATION=1 npm run test:integration
```

La rama está diseñada para fusionarse como una sola unidad. Las antiguas ramas
intermedias ya fueron eliminadas porque todos sus commits están contenidos en la
rama consolidada.
