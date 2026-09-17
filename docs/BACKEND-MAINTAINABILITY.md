# Backend mantenible y auditable

Esta guía define cómo ampliar el backend sin volver a concentrar rutas, reglas de
negocio e infraestructura en archivos monolíticos. El objetivo no es producir
archivos pequeños por sí mismos, sino módulos con una responsabilidad clara,
contratos estables y pruebas proporcionales al riesgo.

## Límites y criterio de diseño

- Los archivos de `backend/src` no pueden superar 500 líneas físicas. `npm test`
  ejecuta `npm run audit:structure` antes de las pruebas y falla si se supera.
- Entre 350 y 500 líneas se debe considerar una separación antes de añadir una
  responsabilidad nueva.
- No se compacta código ni se eliminan comentarios útiles para cumplir el límite.
  Se extrae una capacidad completa con nombre y contrato propios.
- Código generado debe vivir fuera de `backend/src` o disponer de una decisión
  arquitectónica documentada antes de introducir una excepción.

## Dirección de dependencias

```text
routes -> middleware -> services -> repositories -> db
                              \-> game adapters / integrations
                    \-> policies (reglas puras)
workers ------------> services
```

- **Rutas:** traducen HTTP, validan la forma de entrada y seleccionan el código
  de respuesta. No contienen consultas extensas ni orquestación de Docker.
- **Middleware:** aplica una política transversal única, como autenticación,
  origen o trazabilidad.
- **Servicios:** contienen casos de uso y coordinan persistencia, Docker y otras
  integraciones. Deben exponer funciones con nombres de dominio.
- **Repositorios:** contienen el SQL de un agregado, usan parámetros y devuelven
  resultados con fallbacks estables. Rutas y servicios no deben añadir consultas
  nuevas de ese agregado fuera de su repositorio.
- **Policies/helpers puros:** resuelven cálculos y decisiones deterministas sin
  red, reloj global ni estado externo; son la unidad preferida para pruebas.
- **Adaptadores de juegos:** describen imágenes, entorno, puertos, volúmenes y
  reinicio de cada carga, sin decisiones HTTP.
- **Workers:** poseen temporizadores y consumidores de colas. Importar un servicio
  desde la API nunca debe iniciar un intervalo como efecto secundario.

## Contratos y documentación dentro del código

Documenta APIs públicas, invariantes de seguridad, decisiones no evidentes y el
motivo de un fallback. Evita comentarios que repitan la siguiente línea. Una
extracción debe preservar rutas, códigos HTTP, formato JSON, auditoría y orden de
efectos salvo que el MR declare explícitamente un cambio funcional.

Ejemplo:

```js
/**
 * Reanuda un contenedor existente después de mantenimiento.
 * No repite admisión de RAM porque no asigna capacidad adicional.
 */
export async function resumeAfterMaintenance(serverId) { /* ... */ }
```

## Procedimiento de refactorización

1. Crea o confirma pruebas de caracterización del comportamiento actual.
2. Extrae una sola responsabilidad sin cambiar el contrato exterior.
3. Mantén las dependencias explícitas mediante imports o parámetros.
4. Ejecuta `npm run audit:structure` y `npm test` dentro de `backend`.
5. Revisa que iniciar la API no active workers ni tareas periódicas duplicadas.
6. Describe en el MR qué se movió, qué contrato se preservó y qué pruebas lo
   demuestran. No mezcles esta clase de refactor con una función nueva.

## Mapa de los módulos separados en esta fase

- `middleware/discordApiKey.js`: única política de autenticación del bot.
- `services/discordDiagnosticsService.js`: consultas y telemetría para el comando
  de diagnóstico; un fallo de Docker aislado no cancela los demás servidores.
- `routes/discord/vendorRoutes.js`: endpoints administrativos de vendedores.
- `services/txAdminCookieService.js`: compatibilidad del parche heredado de
  cookies de txAdmin, aislada del ciclo de vida general.
- `services/serverRuntimeLifecycle.js`: contrato único para construir opciones y
  despachar reinicios a cada adaptador de juego.
- `services/serverMaintenanceScheduler.js`: único temporizador de mantenimiento,
  iniciado explícitamente por el worker de eventos Docker.
- `repositories/serverRepository.js`: lecturas y escrituras reutilizadas del
  agregado servidor, incluidos cambios atómicos de estado.
- `repositories/nodeRepository.js`: persistencia de nodos y única lista segura de
  campos editables; evita construir columnas SQL desde entradas HTTP.
- `repositories/backupRepository.js`: metadatos PostgreSQL de copias; el sistema
  de archivos y MariaDB continúan coordinados por `backupService.js`.
- `repositories/userRepository.js`: identidad y edición administrativa con una
  lista cerrada de columnas modificables.
- `repositories/notificationRepository.js`: lectura pública filtrada y escritura
  uniforme de avisos operativos.
- `repositories/edgeProxyRepository.js`: inventario del proxy perimetral y
  selección atómica del único proxy activo.
- `services/dockerTelemetryService.js`: muestreo Docker por lotes, caché y
  publicación efímera en Redis; no controla el ciclo de vida de contenedores.
- `services/rcon/sourceRconClient.js`: transporte y framing Source RCON; los
  parsers y fallbacks específicos de juegos permanecen fuera del protocolo.
- `services/ark/requirements.js`: política pura de capacidad mínima de ARK.
- `services/ark/configStore.js`: catálogo y persistencia de GameUserSettings.ini.
- `migrations/coreSchemaMigration.js`: esquema inicial inmutable, separado de
  las evoluciones incrementales y operativas.

Este mapa debe actualizarse cuando una nueva separación cambie la ubicación
esperada de una responsabilidad importante.

## Pruebas de integración reales

La suite unitaria no requiere infraestructura. Antes de promover cambios del
backend, ejecutar también `RUN_INTEGRATION=1 npm run test:integration` dentro
de un contenedor conectado a PostgreSQL, Redis, Docker y al backend del
laboratorio. La suite realiza sondas no destructivas, usa claves Redis efímeras
y revierte cualquier escritura de prueba en PostgreSQL.

`RUN_INTEGRATION=1` habilita todas las pruebas reales. `RUN_DB_INTEGRATION=1`
se conserva como alias temporal para automatizaciones antiguas que ejecutan
solo las colas PostgreSQL. Sin uno de esos indicadores, las pruebas se omiten
explícitamente y nunca intentan conectarse por accidente a infraestructura.

## Cobertura

Ejecuta `npm run test:coverage` para obtener cobertura de líneas, ramas y
funciones usando el runner nativo de Node. La cobertura es una señal de riesgo,
no un objetivo para rellenar líneas: cualquier módulo crítico con baja cobertura
debe recibir primero pruebas de contrato, fallo y rollback antes de imponer un
umbral global más alto.

## Transacciones e invariantes

Una transacción protege una regla de negocio que abarque varias escrituras; no
se añade solo para agrupar consultas. El servicio delimita el caso de uso y pasa
el ejecutor transaccional a los repositorios implicados.

- **Registro:** consumir una invitación y crear el usuario confirman juntos. Una
  invitación agotada o un usuario duplicado revierte ambos efectos.
- **Edición administrativa:** la caducidad del usuario y la de todos sus
  servidores cambian juntas. Ningún servidor puede conservar una caducidad
  distinta por un fallo intermedio.
- **Proxy perimetral activo:** desactivar el anterior y activar el elegido es una
  sola transacción. Si el identificador no existe, se restaura el proxy anterior.
- **Restauración de backups:** la sustitución de archivos y la restauración de la
  base de datos del juego no son una transacción PostgreSQL. El servicio usa una
  copia compensatoria, conserva la carpeta previa y reanuda el servidor tanto al
  confirmar como al revertir. Este orden no debe cambiar sin una prueba de fallo.
- **Recreación de servidores:** el cambio condicional a `recreating` funciona
  como compare-and-set y evita dos recreaciones simultáneas.

## Observabilidad PostgreSQL

`db.js` mide consultas totales, fallidas, lentas, duración media/máxima y muestras
de saturación. `PG_SLOW_QUERY_MS` controla el umbral (250 ms por defecto). Los
logs guardan solo la operación SQL abreviada y la duración, nunca parámetros.
`/readyz` publica capacidad, conexiones totales, libres, en espera y el indicador
de saturación del pool; no publica credenciales ni consultas.
