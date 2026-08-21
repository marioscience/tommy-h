# 📚 RageNodes ULTIMATE | Technical & Operational Blueprint (V0.0.1)

## 1. Visión General del Proyecto
**RageNodes** es una plataforma de orquestación de servidores de juego (enfocada en FiveM) diseñada para ofrecer el máximo rendimiento, aislamiento y facilidad de uso. A diferencia de otros paneles, RageNodes integra un motor nativo en **Rust** para manejar el I/O pesado, garantizando que la interfaz de usuario nunca se bloquee, independientemente de la carga del servidor.

---

## 2. Capacidades del Sistema (Features)

### 🎮 Gestión de Instancias
* **Despliegue Instantáneo:** Creación de contenedores Docker pre-configurados con Alpine Linux y FXServer.
* **Control de Ciclo de Vida:** Encendido, apagado y reinicio con monitorización de estado en tiempo real.
* **Telemetría en Vivo:** Anillos de monitorización para CPU (normalizada por núcleos), RAM (uso real vs reservado) y Disco (espacio ocupado).

### 📂 Gestión de Archivos (File Manager Pro)
* **Monaco Editor Integrado:** Editor de código con resaltado de sintaxis para Lua, CFG, JSON y SQL.
* **Path Traversal Shield:** Sistema de seguridad que impide que los clientes accedan a archivos fuera de su volumen `/data`.
* **Descargas Remotas:** Capacidad de "puxar" recursos directamente desde GitHub o cualquier URL mediante el backend.
* **Compresión Nativa (Rust):** Descarga de carpetas completas comprimidas en `.tar.gz` o `.zip` a alta velocidad.

### 💾 Backups & Disaster Recovery
* **Cola de Prioridad:** Los backups se procesan según el rango del usuario (Elite > Premium > Standard > Hobby).
* **Restauración Atómica:** Capacidad de volver a un estado anterior limpiando archivos y restaurando la base de datos MariaDB asociada automáticamente.
* **Migración en Caliente:** Mueve todos los datos de un servidor a otro con un solo clic.

### 🛠️ Herramientas Administrativas
* **Terminal Remota Interactiva:** Shell completa con soporte para `cd`, aliases (`ll`, `..`) y autocompletado con el tabulador.
* **Editor 3D (Blender WebTop):** Entorno gráfico accesible desde el navegador para editar recursos de FiveM (`txData`) sin descargar nada.
* **Diagnóstico de Red:** Escáner de puertos y tests de latencia integrados para depurar problemas de conectividad del nodo.
* **Auditoría Forense:** Registro exhaustivo de IP, agentes y acciones con capacidad de exportación CSV.

### 🛡️ Ingress & Mitigación DDoS (OxideProxy L7)
* **Motor Asíncrono en Rust:** Proxy L4/L7 ultrarrápido diseñado para mantener millones de conexiones concurrentes con latencia sub-milisegundo sin pausas de recolección de basura (Zero-Copy).
* **Filtros eBPF / XDP:** Capacidad de descartar ataques DDoS en nanosegundos a nivel de tarjeta de red (NIC) antes de que alcancen el stack del kernel.
* **Enrutamiento Dinámico L4:** Tabla O(1) en memoria (`FxHashMap`) que enruta paquetes de juego (UDP/TCP) directamente a las instancias Docker de FiveM activas.

---

## 3. Guía de Despliegue (Para Administradores)

### Requisitos del Sistema
* **Hardware:** Servidor Dedicado o VPS con soporte de Virtualización (VT-x/AMD-V).
* **Disco:** NVMe recomendado (el sistema está optimizado para I/O rápido).
* **Software:** Docker Engine 24+, Docker Compose V2, Git.

### Instalación desde Cero
1. **Preparar el entorno:**
   ```bash
   # Clonar y entrar
   git clone https://github.com/Noko34/ragenodes-ultimate.git
   cd ragenodes-ultimate
   ```
2. **Configuración del `.env`:**
   Copia el ejemplo y ajusta los secretos. **IMPORTANTE:** `JWT_SECRET` debe ser una cadena larga y aleatoria.
3. **Despliegue:**
   ```bash
   docker compose up -d --build
   ```
   *El contenedor `backend` compilará el motor Rust durante el primer despliegue. Esto puede tardar 1-2 minutos.*

### Configuración del Primer Admin
Para acceder a la pestaña "Auditoría" o "Usuarios", regístrate normalmente en la web y luego ejecuta en la base de datos PostgreSQL:
```sql
UPDATE users SET role = 'admin' WHERE username = 'tu_usuario';
```

---

## 4. Guía para Programadores (Desarrollo Interno)

### Arquitectura de Archivos
* `/backend/src/routes/`: Lógica de la API dividida por dominio (servidores, archivos, auth, etc.).
* `/backend/src/services/`: Capa de negocio (Docker, Backups, Email, LogHub).
* `/backend/src/utils/rustUtil.js`: Puente de comunicación entre Node.js y el binario de Rust.
* `/backend/rust-util/`: Código fuente en Rust (Cargo project).
* `/frontend/public/`: Interfaz estática (SPA) servida directamente por OxideProxy.
* `/oxideproxy/`: Motor proxy L4/L7 asíncrono en Rust y panel de control eBPF/XDP integrado en la red `ragenodes_net`.

### El Ciclo de Vida del "Rust Bridge"
Cuando el backend necesita hacer algo "pesado" (como comprimir 10GB de archivos):
1. Node.js invoca a `rustUtil.compress(...)`.
2. El puente (`rustBridge.js`) ejecuta el binario `rust-util` con los argumentos necesarios.
3. Rust realiza el trabajo en hilos nativos y devuelve el resultado (o error) al backend.
4. Esto evita que el "Event Loop" de Node.js se detenga, permitiendo que otros usuarios sigan usando el panel fluidamente.

### Cómo añadir una nueva funcionalidad
1. **Backend:** Crea la ruta en `/routes` y protégela con `requireAuth`.
2. **Servicio:** Si interactúa con Docker, usa `/services/dockerService.js`.
3. **Auditoría:** Siempre registra acciones críticas usando `logAudit(req, 'acción', { detalles })`.
4. **Frontend:** Añade la función en `admin.html` o `panel.html` usando `Nexus.api('/ruta', { ... })`.

---

## 5. Referencia de Seguridad
* **CORS:** Solo permite el origen configurado en `.env`.
* **Rate Limiting:**
  * Global: 1500 peticiones / 15 min.
  * Auth: 15 intentos / 10 min (Prevención de Fuerza Bruta).
  * Files: Ilimitado (para permitir subidas masivas).
* **Aislamiento MariaDB:** Cada servidor de juego tiene su propia DB y usuario MariaDB. El backend nunca expone la contraseña de `root` al cliente.

---

## 6. Resolución de Problemas (Troubleshooting)

| Problema | Causa Probable | Solución |
| :--- | :--- | :--- |
| El panel no carga | OxideProxy caído o error en backend | `docker compose ps` y revisa logs. |
| No se crean servidores | MariaDB no responde o puertos ocupados | Revisa `CENTRAL_DB_PASS` y puertos del host. |
| Error 429 | Demasiadas peticiones | El limitador de tasa ha bloqueado tu IP temporalmente. |
| Los logs no fluyen | El contenedor está detenido o LogHub falló | Verifica el estado del contenedor en Docker. |

---
*Documentación oficial de RageNodes Ultimate. Diseñado para la excelencia.*
