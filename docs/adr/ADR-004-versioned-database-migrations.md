# ADR-004: Sistema Unificado de Migraciones Versionadas y Separación DDL/Seeds

## Estado
Aceptado

## Contexto
Anteriormente, la base de datos se inicializaba mediante un bloque imperativo masivo de 250 líneas en `db.js` mezclando creación de tablas (`CREATE TABLE IF NOT EXISTS`), alteración de columnas (`ALTER TABLE`) y datos semilla (planes de hosting y usuario administrador). Esto generaba riesgo de *schema drift* y colisiones cuando múltiples desarrolladores trabajaban en paralelo.

## Decisión
1. **Consolidación en Migraciones Versionadas:** Toda la estructura de tablas e índices se declara como migraciones secuenciales en `backend/src/migrations.js` con identificador timestamp (`202601010001_initial_core_schema`, etc.).
2. **Separación de Datos Semilla (Seeds):** Los datos iniciales (planes de hosting por defecto, nodo maestro 0, usuario admin bootstrap) se trasladan a la función dedicada `seedInitialData()` en `db.js`.
3. **Runner CLI Independiente:** Se añade `backend/src/scripts/migrate.js` y el script de npm `npm run db:migrate` para ejecutar migraciones en CI/CD y despliegues sin necesidad de arrancar el servidor web completo.
4. **Idempotencia y Cero Downtime:** Se mantiene la tabla de control `schema_migrations` asegurando compatibilidad con bases de datos en producción y staging.

## Consecuencias
### Positivas:
- Cero ambigüedad para los nuevos desarrolladores: cualquier cambio de esquema se agrega como un nuevo objeto en `migrations.js`.
- Capacidad de ejecutar migraciones de forma atómica en pipelines de despliegue antes de iniciar los contenedores de backend.
- Separación clara entre arquitectura de datos (DDL) y configuración de negocio (DML).
