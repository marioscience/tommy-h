# Checklist de preparación para producción

El despliegue se detiene de forma preventiva si el host no cumple los controles de `scripts/security/production_preflight.sh`.

Para actualizar un `.env` de desarrollo antiguo sin reutilizar la clave global, ejecutar `bash scripts/migrate_local_env.sh`. El script genera credenciales locales separadas y no imprime sus valores.

## Una vez por host

- Ejecutar Docker en modo rootless para el usuario de RageNodes.
- Definir `DOCKER_SOCKET=/run/user/<uid>/docker.sock` y mantener `ALLOW_ROOTFUL_DOCKER_SOCKET=false`.
- Configurar `APP_UID`, `APP_GID` y `DOCKER_GID` con los propietarios reales del socket y de los datos.
- Entregar `INSTANCE_DATA_ROOT` y `BACKUP_ROOT` al usuario de la aplicación, nunca a UID 0 dentro del contenedor.
- Mantener `FRONTEND_BIND_IP=127.0.0.1`; solamente OxideProxy publica 80/443.
- Deshabilitar RPC/portmapper del puerto 111 si el host no presta NFS. La excepción `ALLOW_RPC_PORTMAPPER=true` exige una justificación operativa.

## Secretos

Antes del primer despliegue de esta versión hay que rotar todas las credenciales que se hayan compartido fuera del gestor de secretos. Como mínimo:

- Discord y su clave de servicio.
- Clave independiente de enrolamiento de nodos.
- JWT y credenciales administrativas.
- PostgreSQL y MariaDB.
- PayPal y el identificador de webhook.
- Resend, webhooks de personal y cualquier credencial antigua de Cloudflare.

`DISCORD_API_KEY` y `NODE_ENROLLMENT_API_KEY` deben ser diferentes. La variable antigua `API_KEY` solamente se conserva como compatibilidad en desarrollo y no se acepta como sustituto en producción.

## Backups

- Los backups locales funcionan aunque un servidor no tenga MariaDB.
- La creación escribe primero un archivo parcial y lo publica mediante un cambio de nombre atómico.
- La restauración extrae en una carpeta nueva y conserva archivos y base de datos anteriores hasta completar la operación.
- La copia remota es opcional. Se activa con `BACKUP_REMOTE_ENABLED=true`, requiere `config/rclone/rclone.conf` como archivo regular y el despliegue debe incluir `-f docker-compose.backup-remote.yml`. La imagen normal no contiene `rclone`.
- Antes de promover a producción debe completarse una restauración real sobre un servidor descartable.

## Promoción

1. Fusionar la rama de corrección en `dev` mediante merge request.
2. Ejecutar CI y las pruebas de seguridad con capacidad de runner disponible.
3. Promover el mismo commit a `staging` y realizar pruebas de autenticación, despliegue, consola, Blender, txAdmin y backups.
4. Promover exactamente el commit probado a `main`; no copiar archivos manualmente.
5. Conservar las imágenes por digest o etiqueta inmutable para permitir rollback.
