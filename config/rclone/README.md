# Configuración opcional de backups remotos

Los backups locales no dependen de rclone. Para habilitar una segunda copia remota:

1. Crea `config/rclone/rclone.conf` en el servidor. El archivo está ignorado por Git.
2. Limita sus permisos al usuario de la aplicación (`chmod 600`).
3. Configura en `.env`:

   - `BACKUP_REMOTE_ENABLED=true`
   - `BACKUP_REMOTE_NAME=<nombre del remote en rclone>`
   - `BACKUP_REMOTE_PATH=<carpeta remota>`

Si el interruptor está desactivado, el worker conserva los backups locales y no intenta conectarse a ningún proveedor externo.
