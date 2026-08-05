"""
Respuestas del bot para cada intencion detectada.
Cada entrada: intencion -> str o list[str] (se elige aleatoriamente si es lista).
"""
import random

RESPUESTAS = {
    "precio": (
        "🛒 **Precios y Planes:**\n"
        "Todos nuestros planes de servidor FiveM están en **https://ragenodes.com**.\n"
        "Aceptamos **PayPal, tarjeta de crédito/débito y criptomonedas**.\n"
        "Si buscas un plan específico o descuento por volumen, espera a un miembro del staff."
    ),
    "reembolso": (
        "💸 **Reembolsos y Cancelaciones:**\n"
        "Puedes cancelar tu suscripción desde el Área de Cliente para que no se renueve automáticamente.\n"
        "Para reembolsos por fallos técnicos dentro de las primeras **48 horas**, un miembro del staff te ayudará."
    ),
    "conexion_rechazada": (
        "🔌 **Error de Conexión FiveM — Pasos a seguir:**\n"
        "**1.** Verifica que tu servidor aparece como **ONLINE** en el panel.\n"
        "**2.** Revisa la **Consola Live** — busca errores rojos de base de datos o scripts.\n"
        "**3.** Confirma que tienes una licencia CFX válida en `sv_licenseKey` dentro del `server.cfg`.\n"
        "**4.** Si ves `Connection Rejected` o `5:NET_ERROR`, puede ser la licencia o un script con error en el arranque."
    ),
    "dominio_ip": (
        "🌍 **IP y Dominio:**\n"
        "Usa el comando `!ip` en este ticket para ver tu IP y puerto de conexión exactos.\n"
        "Si necesitas una **IP Dedicada** o un dominio personalizado (ej: `play.tuserver.com`), contacta al staff ya que requiere configuración adicional."
    ),
    "lag_rendimiento": (
        "⚡ **Problemas de Rendimiento:**\n"
        "Voy a lanzar un diagnóstico automático. Usa `!diagnostico` para ver CPU, RAM y Disco en tiempo real.\n\n"
        "**Causas frecuentes:**\n"
        "• **RAM llena:** scripts con memory leak, demasiados jugadores\n"
        "• **CPU alta:** scripts mal optimizados, loops pesados, muchos vehículos\n"
        "• **OneSync:** errores de `entity too far` suelen ser por mal config de `onesync_infinity`\n"
        "• **MySQL lento:** queries sin índices o demasiadas conexiones simultáneas"
    ),
    "txadmin": (
        "🛡️ **txAdmin:**\n"
        "Accede desde el botón **txAdmin Web** en tu panel de RageNodes (el servidor debe estar **encendido**).\n"
        "• **Error 502:** el servidor está apagado o aún iniciando.\n"
        "• **PIN de vinculación:** aparece en la **Consola Live** al primer arranque. Formato: `Use the PIN [XXXX]`.\n"
        "• **Contraseña perdida:** en txAdmin ve a Configuración → Contraseña maestra → Restablecer."
    ),
    "mysql_db": (
        "🗄️ **Base de Datos (MySQL/MariaDB):**\n"
        "• **Host para scripts FiveM:** usa `mariadb` o `127.0.0.1` (no la IP pública).\n"
        "• **String de conexión:** `set mysql_connection_string \"server=mariadb;uid=TU_USER;password=TU_PASS;database=TU_DB\"`\n"
        "• **Error `too many connections`:** reduce el pool de oxmysql o reinicia el servidor.\n"
        "• **`Unknown column` / `Table doesn't exist`:** ejecuta el SQL de creación de tablas de tu script.\n"
        "• **Acceso externo (HeidiSQL):** usa el **Endpoint** de la pestaña Base de Datos del panel."
    ),
    "archivos_ftp": (
        "📁 **Gestión de Archivos:**\n"
        "• **Gestor Web (recomendado):** Ve a la pestaña **Archivos** — puedes subir ZIPs y extraerlos con clic derecho → Unarchive.\n"
        "• **SFTP (FileZilla/WinSCP):** Ve a Configuración → Detalles SFTP. Usa la IP, usuario y contraseña del panel.\n"
        "• **Carpeta resources:** todos los scripts van en `resources/[carpeta_del_script]/`.\n"
        "• **`ensure nombrescript`** en `server.cfg` para activarlos."
    ),
    "licencia_cfx": (
        "🔐 **Licencia FiveM (CFX Keymaster):**\n"
        "**1.** Ve a https://keymaster.fivem.net/ e inicia sesión con tu cuenta de FiveM.\n"
        "**2.** Crea una nueva clave (New Server) con la IP de tu nodo RageNodes.\n"
        "**3.** Pega la clave en `server.cfg`: `sv_licenseKey \"TU_CLAVE\"`\n"
        "**4.** Sin espacios antes ni después. Si la clave es inválida verás `License key is not valid`."
    ),
    "esx_scripts": (
        "🔧 **ESX Framework:**\n"
        "• Asegúrate de usar `es_extended` compatible con tu versión de FiveM (legacy vs 1.10).\n"
        "• `GetSharedObject` debe estar al inicio del script server-side.\n"
        "• Si tienes `esx_society` con errores de MySQL, ejecuta su SQL de instalación.\n"
        "• Para ESX Legacy: el string MySQL usa `oxmysql` como dependencia — asegúrate de tenerlo en `server.cfg` antes que ESX."
    ),
    "qbcore_scripts": (
        "🔧 **QBCore Framework:**\n"
        "• Asegúrate de que `qb-core` sea la versión correcta para tus scripts.\n"
        "• `ox_lib` es una dependencia común — `ensure ox_lib` debe ir **antes** de los scripts que lo usen.\n"
        "• Para errores de `bridge`: verifica que el script sea compatible con QBCore o ESX y no mezcles ambos.\n"
        "• `ox_inventory` reemplaza al inventario por defecto — revisa incompatibilidades con `qb-inventory`."
    ),
    "error_arranque": (
        "🚨 **Error al Arrancar el Servidor:**\n"
        "Revisa la **Consola Live** del panel — los errores rojos te indicarán qué script falló.\n\n"
        "**Causas más comunes:**\n"
        "• `Couldn't find native`: versión de FiveM desactualizada o script incompatible.\n"
        "• `Resource failed to start`: error de sintaxis en Lua/JS del script.\n"
        "• `Parse error`: error de sintaxis — revisa el archivo indicado en la línea del error.\n"
        "• `Missing dependency`: un script necesita otro que no está en `server.cfg` o no existe.\n"
        "• `citizen-server-impl`: error crítico del servidor, suele ser la licencia o un script roto."
    ),
    "permisos_ace": (
        "🔑 **Permisos ACE / add_principal:**\n"
        "Los permisos se configuran en `server.cfg`. Ejemplo para dar permiso de admin:\n"
        "```\nadd_ace identifier.steam:TU_STEAM_HEX group.admin allow\nadd_principal identifier.steam:TU_STEAM_HEX group.admin\n```\n"
        "Tu Steam Hex lo ves en txAdmin (Admin Manager) o en la consola con `status`."
    ),
    "error_red": (
        "🌐 **Errores de Red:**\n"
        "• **Error 10061 / Connection Refused:** el puerto no está abierto o el servidor está apagado.\n"
        "• **Sin heartbeat:** el servidor no puede llegar a los servidores de FiveM — revisa la licencia y que el servidor esté online.\n"
        "• **Puerto cerrado:** en RageNodes los puertos están pre-configurados. Usa `!ip` para ver el tuyo."
    ),
    "recursos_manifest": (
        "📋 **fxmanifest.lua / Recursos:**\n"
        "• Todo script necesita un `fxmanifest.lua` (o `__resource.lua` para versiones antiguas).\n"
        "• `fx_version 'cerulean'` y `game 'gta5'` son obligatorios.\n"
        "• Si ves `version mismatch`, el script requiere una versión de FiveM más reciente.\n"
        "• Los archivos YTD/YDR/YMAP van en la carpeta `stream/` dentro del recurso."
    ),
    "voz_chat": (
        "🎙️ **Sistema de Voz / Chat:**\n"
        "• **pma-voice** es el más usado — asegúrate de tenerlo con `ensure pma-voice` en `server.cfg`.\n"
        "• Si nadie se oye: verifica que el cliente tenga el micrófono permitido en FiveM.\n"
        "• **Proximity chat** requiere configuración en `config.lua` de pma-voice (distancia, modo).\n"
        "• Para Mumble-VoIP, revisa que el puerto UDP del mumble no esté bloqueado."
    ),
    "mlo_mapas": (
        "🗺️ **MLOs, Mapas y Editor 3D:**\n"
        "• Los MLOs van en la carpeta `stream/` de tu recurso con sus archivos `.ymap` y `.ytyp`.\n"
        "• Si el interior no carga: verifica que el `fxmanifest.lua` incluya los archivos en `data_file`.\n"
        "• **Editor 3D Blender Web:** disponible desde el menú lateral del panel (plan Standard/Elite). Usa la contraseña temporal que aparece en pantalla."
    ),
    "anticheat": (
        "🛡️ **Anticheat:**\n"
        "• Los bans de anticheat los gestiona el staff de RageNodes o tu propio txAdmin.\n"
        "• Si crees que un ban es injusto, proporciona tu **Steam Hex** y la hora exacta del ban.\n"
        "• Para whitelist en txAdmin: ve a Players → busca el jugador → Whitelist."
    ),
    "backup": (
        "🔄 **Backups:**\n"
        "Ve a la pestaña **Backups** en el panel.\n"
        "⚠️ **Importante:** restaurar un backup **sobreescribe** archivos y base de datos actuales — es irreversible.\n"
        "Los backups automáticos están disponibles en planes Standard y Elite."
    ),
    "facturacion_plan": (
        "💳 **Facturación y Planes:**\n"
        "• **Mejorar plan:** desde la pestaña **Facturación** del panel — pagas solo la diferencia.\n"
        "• **Disco lleno:** amplía el almacenamiento de forma independiente desde Facturación.\n"
        "⚠️ Si el disco está al 100%, la base de datos puede corromperse. ¡Actúa rápido!"
    ),
    "contrasena_cuenta": (
        "🔑 **Acceso y Contraseña:**\n"
        "• **Olvidé mi contraseña:** en la pantalla de Login → '¿Olvidaste tu contraseña?' → recibirás un email.\n"
        "• **No llega el email:** revisa la carpeta de spam o usa otro correo.\n"
        "• **Cambiar email:** contacta al staff con prueba de identidad."
    ),
    "reiniciar_servidor": (
        "🔁 **Control del Servidor:**\n"
        "Desde la pantalla principal del panel puedes **encender**, **apagar** o **reiniciar** tu servidor.\n"
        "• Si no responde: revisa la **Consola Live** por errores rojos.\n"
        "• Si el botón está en gris: espera 30 segundos y recarga la página."
    ),
    "onesync": (
        "🌐 **OneSync:**\n"
        "• En `server.cfg`: `set onesync_enabled true` y `set onesync infinity` para servidores grandes.\n"
        "• **Error `entity too far`:** algún script está creando entidades fuera del routing bucket — revisa con `onesync_distanceCullVehicles true`.\n"
        "• **OneSync Legacy** es más estable para servidores pequeños (<32 players)."
    ),
    "wipe": (
        "🧹 **Wipe de Servidor:**\n"
        "Para empezar de cero, debes borrar los datos de tu Base de Datos (usando phpMyAdmin o HeidiSQL) y limpiar la carpeta `cache/` de tu servidor.\n"
        "**Precaución:** ¡Esta acción no se puede deshacer! Si usas QBCore o ESX, asegúrate de reinstalar las tablas SQL básicas tras el wipe."
    ),
    "whitelist": (
        "📋 **Whitelist:**\n"
        "Si usas **txAdmin**, puedes gestionar la Whitelist desde la pestaña *Players* -> *Whitelist*.\n"
        "Si usas un script propio de Discord Whitelist, asegúrate de que el bot de discord del script tiene el token correcto en tu `server.cfg`."
    ),
    "migracion": (
        "🚚 **Migración de Servidor:**\n"
        "¡Bienvenido a RageNodes! Para traer tu servidor:\n"
        "1. Comprime tu carpeta `resources/` en un archivo `.zip` y súbelo vía Gestor Web.\n"
        "2. Exporta tu base de datos antigua en `.sql` e impórtala usando phpMyAdmin desde nuestro panel.\n"
        "3. Copia tu `server.cfg`, cambia la IP y ajusta tu conexión MySQL a `mariadb`."
    ),
    "mantenimiento_nodo": (
        "🛠️ **Mantenimiento / Nodo Caído:**\n"
        "He revisado la infraestructura y si tu nodo parece estar offline, podría estar en un reinicio programado o aplicando una actualización de seguridad.\n"
        "Revisa el canal de <#109698850653053129> (Avisos) para más información. Si el problema persiste, un staff revisará la máquina host en breve."
    ),
    "saludo": [
        "¡Hola {mention}! 👋 Soy el asistente IA de RageNodes. Cuéntame con detalle qué problema tienes con tu servidor.",
        "¡Buenas {mention}! 🤖 Estoy aquí para ayudarte. ¿Qué está pasando con tu servidor de FiveM?",
        "¡Hey {mention}! Escríbeme tu problema con el mayor detalle posible y lo resolveremos juntos. 🚀",
    ],
    "agradecimiento": [
        "¡Genial {mention}! ⚡ Me alegra que se haya resuelto. Puedes cerrar el ticket con el botón 🔒 de arriba o escribiendo `!cerrar`.",
        "¡Perfecto {mention}! 🎉 Si tienes otra duda en el futuro, no dudes en abrir un nuevo ticket.",
        "¡Excelente {mention}! ✅ Si todo está funcionando, puedes cerrar el ticket. ¡Hasta la próxima!",
    ],
}


def get_respuesta(intencion: str, mention: str = "") -> str | None:
    resp = RESPUESTAS.get(intencion)
    if resp is None:
        return None
    if isinstance(resp, list):
        return random.choice(resp).replace("{mention}", mention)
    return resp
