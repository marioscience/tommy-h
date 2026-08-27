<div align="center">
  <img src="frontend/public/assets/icon.png" alt="RageNodes Logo" width="130" />
  <h1>🎮 RageNodes Ultimate</h1>
  <p><strong>High-Performance Game Server & Discord Bot Orchestration Platform</strong></p>
  <p><strong>Plataforma de Alto Rendimiento para Orquestación de Servidores de Juegos y Bots</strong></p>

  <p>
    <a href="#-english"><b>🇬🇧 English Documentation</b></a> | <a href="#-español"><b>🇪🇸 Documentación en Español</b></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-24.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Rust-OxideProxy-DEA584?style=for-the-badge&logo=rust&logoColor=black" alt="Rust" />
    <img src="https://img.shields.io/badge/Docker-Rootless-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" />
    <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/Redis-Cache-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" />
  </p>
</div>

---

# 🇬🇧 English

## 🚀 Overview
**RageNodes Ultimate** is an all-in-one, enterprise-grade game server and application orchestration platform. Built with an Object-Oriented **Node.js** backend architecture, an ultra-fast low-latency reverse proxy written in **Rust (`OxideProxy`)**, and hardened **Docker** container isolation.

Whether deploying a large FiveM roleplay community or a multi-node cluster for Rust and Minecraft, RageNodes provides full hardware orchestration with automated zero-trust security and direct public endpoints managed by OxideProxy.

---

## 🌟 Key Features
- **🕹️ 1-Click Game Deployment:** Instant orchestration for FiveM (txAdmin), Rust, Minecraft (Paper/Java), CS2, Palworld, ARK: Survival Ascended, and 7 Days to Die.
- **🤖 Discord Bot Hosting:** Secure, isolated containers for Node.js and Python bots with automated health monitoring.
- **⚡ OxideProxy (Rust Core & L7 Control Plane):** Hyper-optimized Layer 4/7 reverse proxy with TLS termination, cryptographic CSP nonces, eBPF-ready networking, 30s token caching, and DDoS mitigation.
- **🛡️ Dynamic Private IP CORS & CSRF:** Automated Origin matching for private network IPs (`192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`, `127.0.0.1`, `localhost`) enabling seamless state operations.
- **🐳 Hardened Docker Architecture:** Automated non-root execution (`1000:1000`), minimal capability allowlist, fail-fast volume validations, and Distroless base images.
- **📊 Real-Time Telemetry & iFrame Auth:** Live CPU, memory heap, and I/O metrics streaming over WebSockets, with JWT token auto-propagation (`authFetch`).
- **🩺 Production & Staging Diagnostics:** Native `/healthz`, `/readyz` probes, and an adaptive hardware test suite (`stagingHealthTestRunner.js`) generating PDF/HTML diagnostic reports.
- **📦 Master Image Cache:** FiveM and Blender masters are version-aware, archived locally, refreshed by a hardened systemd timer, and reused by subsequent deployments. Digest-pinned game images are prefetched without replacing active customer containers.

### Game ingress rollout

OxideProxy can act as the public TCP/UDP ingress for newly deployed **Minecraft, FiveM game traffic, and Rust** instances. Public ports are owned by the dedicated, host-networked `oxide_game` service, while game containers bind their shifted backend ports to loopback only. Route inventory is generated from authenticated database and Docker state, written atomically, and reloaded automatically. Existing direct-published containers remain compatible and must be migrated individually; txAdmin and other web panels continue through the HTTPS L7 proxy. Set `OXIDE_GAME_PROXY_ENABLED=true` only after the dedicated ingress service is healthy.

Minecraft deployments pin the requested edition and version in the server data directory. Automatic healing therefore recreates the same runtime instead of silently upgrading it, and hosted servers remain active while empty so proxy handshakes and paused clients are not disconnected.

---

## 🖥️ Supported Game Engines & Services

| Game / Service | Engine / Stack | Status | Environment Ports |
|---|---|---|---|
| **FiveM (GTA V)** | FXServer + txAdmin | ✅ Fully Supported | 30120 (Game), 40120 (txAdmin) |
| **Rust** | Unity / SteamCMD | ✅ Fully Supported | 28015 (Game), 28016 (RCON) |
| **Minecraft** | Java / Paper / Bedrock | ✅ Fully Supported | 25565 (Default) |
| **Counter-Strike 2** | Source 2 | ✅ Fully Supported | 27015 (Default) |
| **Valheim** | Unity | ✅ Fully Supported | 2456-2457 |
| **Palworld** | Unreal Engine 5 | ✅ Fully Supported | 8211 (Default) |
| **ARK: Ascended** | Unreal Engine 5 | ✅ Fully Supported | 7777, 27020 |
| **Discord Bots** | Node.js / Python | ✅ Fully Supported | Internal isolated socket |
| **Web & Databases** | WordPress / MariaDB / Postgres | ✅ Fully Supported | 8088, 3306, 5432 |

---

## 🛠️ Technology Stack
* **Backend:** Node.js (ESM), Express, PostgreSQL, MariaDB, Redis.
* **Networking/Proxy:** Rust (`oxideproxy`), TLS termination, dynamic CSP nonces, query caching.
* **Design Patterns:** *Template Method* (`BaseGameService`), *Factory & Registry* (`GameFactory`), *Observer* (Docker Events), *Strategy* (Backups).
* **Testing:** Native Node.js test runner (`node:test` and `node:assert/strict`), Adaptive Hardware Health Test Suite.
* **Frontend:** Vanilla JS, Glassmorphism CSS, WebSockets for live metrics.

---

## 💻 Quickstart for New Developers (Local Setup)

### 1. Prerequisites
* **Node.js** >= 20.x (recommended Node 22 or 24).
* **Docker Desktop** (or Linux Docker Engine) with Docker Compose v2.
* **Git**.

### 2. Clone & Setup Workspace
```bash
# 1. Clone the repository
git clone https://gitlab.com/mariomatos/ragenodesultimate.git
cd ragenodesultimate

# 2. Switch/create your working branch (following GitFlow rules)
git checkout -b feat/my-feature

# 3. Configure the Linux local-development environment
cp .env.local.example .env
# Materialize the absolute local paths; the safe dotenv loader never evaluates shell expressions.
sed -i "s|\${HOME}|$HOME|g" .env
mkdir -p "$HOME/.local/share/ragenodes-ultimate/data/templates" \
  "$HOME/.local/share/ragenodes-ultimate/backups"
```

### 3. Install Dependencies, Migrate Database & Run Tests
```bash
# Install backend dependencies
cd backend
npm install

# Run database migrations
npm run db:migrate

# Run the current backend suite (46 tests across 10 suites)
npm test
cd ..
```

### 4. Start the Local Docker Stack
```bash
# Starts the local stack with direct host access
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

### 5. Local Access URLs
* **Web Dashboard:** [http://localhost:8088](http://localhost:8088)
* **Backend API:** [http://localhost:3010](http://localhost:3010)
* **Live Readiness Probe:** [http://localhost:3010/readyz](http://localhost:3010/readyz)
* **phpMyAdmin:** [http://localhost:8089](http://localhost:8089)

---

## 🛡️ GitFlow & Release Management Protocol

To protect production stability and avoid merge conflicts, **all developers must strictly follow this protocol**:

```mermaid
flowchart LR
    DevBranch["💻 Your Working Branch<br/><b>feat/*</b> or <b>fix/*</b>"] -->|Push to your branch| RemoteBranch["☁️ origin/your-branch"]
    RemoteBranch -->|Merge Request| Dev["🔒 origin/dev<br/><i>(Team Integration)</i>"]
    Dev --> Staging["🔒 origin/staging<br/><i>(Pre-Production)</i>"]
    Staging --> Main["🚀 origin/main<br/><i>(Production Real)</i>"]
```

### 📋 Collaboration & Tagging Rules:
1. **Protected Branches (`dev`, `staging`, `main`):**
   - 🚫 **Direct pushes are strictly prohibited.**
2. **Sequential Promotion:**
   - Develop on your feature branch -> PR to `dev` -> promote to `staging` -> merge to `main`.
3. **Official Releases:**
   - Tag releases on `main` using semantic versioning (e.g. `v55.9.1`).

---

## 🌐 Direct Public Endpoints

The platform exposes OxideProxy and game ports directly, without a tunnel provider. Game traffic remains transparent TCP/UDP; web panels and embedded tools use HTTPS. txAdmin URLs are generated from the public host and assigned port.

When staging sits behind the production edge, production must set `STAGING_UPSTREAM` for HTTP and `STAGING_TLS_UPSTREAM` for raw TLS passthrough. `STAGING_TLS_DOMAINS` limits SNI forwarding to the staging zone, so dynamic hosts such as `tx41120.ragenodes.dev` retain staging's certificate and access gate without weakening production TLS.

TLS passthrough does not create certificates. The staging edge must therefore have a publicly trusted certificate for every name listed in `OXIDE_ACME_DOMAINS`, or use a wildcard certificate provisioned through DNS-01. Never expose the embedded self-signed development certificate on a public endpoint.

| Environment | Public endpoint | Docker policy | Data and ports |
|---|---|---|---|
| Local | `http://localhost:8088` | Rootful exception permitted only in development | Developer-owned paths and local ports |
| Staging | `https://panel.ragenodes.dev` | Isolated runtime socket and `STAGING_PORT_BASE_OFFSET` | Separate databases, volumes, networks and `.dev` endpoints |
| Production | `https://ragenodes.com` / `.app` tools | Rootless socket required by preflight | Production-only volumes and unshifted port bands |

The GitLab pipeline validates tests, security contracts, dependencies, Rust and Compose. It does **not** deploy automatically: promotion remains `feature -> dev -> staging -> main`, followed by the environment's reviewed deployment command.

### Master image refresh

```bash
# Safe manual refresh; active customer containers are not recreated
./scripts/update_image_cache.sh

# Verify the scheduled refresh
systemctl status ragenodes-image-cache.timer
```

---

## 🕹️ Adding a New Game (Extending `GameFactory`)

To add support for a new game, create an OOP service extending `BaseGameService`:

```javascript
import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';

export class NewGameService extends BaseGameService {
    constructor() {
        super('new_game', 'image/docker:latest');
    }

    buildEnvironment(opts) {
        return [
            `SERVER_NAME=${opts.serverName}`,
            `PORT=${opts.gamePort}`
        ];
    }

    buildPortBindings(opts) {
        return {
            exposed: { [`${opts.gamePort}/udp`]: {} },
            bindings: { [`${opts.gamePort}/udp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.gamePort) }] }
        };
    }
}

// Instantiate and register in the factory
export const newGameService = new NewGameService();
GameFactory.register('new_game', newGameService);
```

---

## 🧪 Quality & Security Commands

```bash
# Run all unit and integration tests
npm --prefix backend test

# Run security contract audits
npm run security:secrets
npm run security:csp-bindings
npm run security:inline-code
npm run security:deployment
npm run security:routes
```

---

<br/>
<br/>

# 🇪🇸 Español

## 🚀 Visión General
**RageNodes Ultimate** es una plataforma integral y empresarial para la orquestación y administración de servidores de juegos y aplicaciones. Está construida sobre una arquitectura orientada a objetos en **Node.js**, un proxy inverso de ultra-baja latencia en **Rust (`OxideProxy`)**, y aislamiento estricto de contenedores en **Docker**.

Ya sea para desplegar una comunidad masiva de FiveM o un clúster multi-nodo para Rust y Minecraft, RageNodes proporciona control total del hardware con seguridad *zero-trust* y endpoints públicos directos administrados por OxideProxy.

---

## 🌟 Características Principales
- **🕹️ Despliegue en 1-Clic:** Orquestación instantánea para FiveM (txAdmin), Rust, Minecraft, CS2, Palworld, ARK: Survival Ascended y 7 Days to Die.
- **🤖 Hosting de Bots de Discord:** Contenedores seguros y aislados para bots en Node.js y Python con monitoreo de salud.
- **⚡ OxideProxy (Núcleo en Rust & L7 Control Plane):** Proxy inverso L4/L7 hiper-optimizado con terminación TLS, nonces criptográficos CSP, caché de tokens de 30s y mitigación DDoS.
- **🛡️ CORS y CSRF por entorno:** Producción sólo acepta HTTPS y dominios configurados; los orígenes privados se permiten exclusivamente durante desarrollo local.
- **🐳 Blindaje de Docker:** Ejecución rootless (`1000:1000`), lista de capacidades mínimas, validación fail-fast de volúmenes e imágenes Distroless.
- **📊 Telemetría en Tiempo Real e iframe Autenticado:** Métricas de CPU, memoria heap e I/O transmitidas por WebSockets, con auto-propagación de tokens JWT (`authFetch`).
- **🩺 Diagnóstico Adaptativo de Salud:** Sondas nativas `/healthz`, `/readyz` y runner adaptativo en Staging (`stagingHealthTestRunner.js`) con generación de reportes PDF/HTML.
- **📦 Caché Maestra de Imágenes:** FiveM y Blender se actualizan por versión, se archivan localmente y se reutilizan. Las imágenes fijadas por digest se precargan sin reemplazar contenedores activos de clientes.

Los despliegues de Minecraft fijan en el directorio de datos la edición y versión solicitadas. El auto-curado recrea exactamente ese runtime, sin actualizarlo de forma silenciosa, y los servidores alojados permanecen activos aunque estén vacíos para no interrumpir handshakes del proxy ni clientes en pausa.

---

## 🖥️ Juegos y Servicios Soportados

| Juego / Servicio | Motor / Stack | Estado | Puertos del Entorno |
|---|---|---|---|
| **FiveM (GTA V)** | FXServer + txAdmin | ✅ Soportado al 100% | 30120 (Juego), 40120 (txAdmin) |
| **Rust** | Unity / SteamCMD | ✅ Soportado al 100% | 28015 (Juego), 28016 (RCON) |
| **Minecraft** | Java / Paper / Bedrock | ✅ Soportado al 100% | 25565 (Por defecto) |
| **Counter-Strike 2** | Source 2 | ✅ Soportado al 100% | 27015 (Por defecto) |
| **Valheim** | Unity | ✅ Soportado al 100% | 2456-2457 |
| **Palworld** | Unreal Engine 5 | ✅ Soportado al 100% | 8211 (Por defecto) |
| **ARK: Ascended** | Unreal Engine 5 | ✅ Soportado al 100% | 7777, 27020 |
| **Bots de Discord** | Node.js / Python | ✅ Soportado al 100% | Socket aislado interno |
| **Webs y Bases de Datos** | WordPress / MariaDB / Postgres | ✅ Soportado al 100% | 8088, 3306, 5432 |

---

## 🛠️ Stack Tecnológico
* **Backend:** Node.js (ESM), Express, PostgreSQL, MariaDB, Redis.
* **Capa de Red & Proxy:** Rust (`oxideproxy`), TLS termination, Nonce CSP, caché de consultas y evaluador de seguridad L7.
* **Patrones de Diseño:** *Template Method* (`BaseGameService`), *Factory & Registry* (`GameFactory`), *Observer* (Docker Events), *Strategy* (Backups).
* **Testing:** Test runner nativo de Node.js (`node:test` y `node:assert/strict`) y suite adaptativa de hardware.
* **Frontend:** Vanilla JS moderno, CSS Glassmorphism, WebSockets para métricas en vivo.

---

## 💻 Guía Rápida para Nuevos Desarrolladores (Setup Local)

### 1. Requisitos Previos
* **Node.js** >= 20.x (recomendado Node 22 o 24).
* **Docker Desktop** (o Docker Engine en Linux) con Docker Compose v2.
* **Git**.

### 2. Clonar y Preparar el Entorno
```bash
# 1. Clonar el repositorio
git clone https://gitlab.com/mariomatos/ragenodesultimate.git
cd ragenodesultimate

# 2. Crear tu rama de trabajo (según las reglas de GitFlow)
git checkout -b feat/mi-caracteristica

# 3. Configurar el entorno de desarrollo local en Linux
cp .env.local.example .env
# Convertir las rutas locales a absolutas; el lector seguro de dotenv no evalúa expresiones shell.
sed -i "s|\${HOME}|$HOME|g" .env
mkdir -p "$HOME/.local/share/ragenodes-ultimate/data/templates" \
  "$HOME/.local/share/ragenodes-ultimate/backups"
```

### 3. Instalar Dependencias, Migrar Base de Datos y Correr Tests
```bash
# En el backend
cd backend
npm install

# Ejecutar migraciones de base de datos
npm run db:migrate

# Ejecutar la suite actual: 46 pruebas en 10 suites
npm test
cd ..
```

### 4. Levantar el Stack Completo en Local
```bash
# Levanta el stack local con acceso directo desde el host
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

### 5. Acceso al Panel en Local
* **Panel de Control Web:** [http://localhost:8088](http://localhost:8088)
* **API Backend:** [http://localhost:3010](http://localhost:3010)
* **Sonda de Salud en Vivo:** [http://localhost:3010/readyz](http://localhost:3010/readyz)
* **phpMyAdmin:** [http://localhost:8089](http://localhost:8089)

---

## 🛡️ Protocolo de Git y Ramas para el Equipo (*GitFlow*)

Para garantizar la estabilidad y prevenir conflictos o regresiones en los servidores de producción, **todos los desarrolladores deben seguir estas reglas estrictas**:

```mermaid
flowchart LR
    DevBranch["💻 Tu Rama de Trabajo<br/><b>feat/*</b> o <b>fix/*</b>"] -->|Push a tu rama| RemoteBranch["☁️ origin/tu-rama"]
    RemoteBranch -->|Merge Request| Dev["🔒 origin/dev<br/><i>(Integración del equipo)</i>"]
    Dev --> Staging["🔒 origin/staging<br/><i>(Pre-producción)</i>"]
    Staging --> Main["🚀 origin/main<br/><i>(Producción Real)</i>"]
```

### 📋 Reglas de Colaboración y Etiquetado:
1. **Ramas Protegidas (`dev`, `staging`, `main`):**
   - 🚫 **PROHIBIDO hacer push directo** a `dev`, `staging` o `main`.
2. **Flujo de Trabajo:**
   - Trabaja siempre en tu rama asignada (ej: `feat/nombre-feature`, `fix/nombre-bug`).
   - Sube los cambios a tu rama remota: `git push origin mi-rama`.
   - Abre un **Merge Request (MR)** en GitLab hacia la rama **`dev`** para revisión del equipo.
   - Una vez aprobado y probado en `dev`, se promueve a `staging` y posteriormente a `main`.
3. **Versionado Oficial:**
   - Cada release oficial en `main` debe ser etiquetado mediante tags semánticos (ej: `v55.9.1`).

---

## 🌐 Endpoints Públicos Directos

La plataforma expone OxideProxy y los puertos de juego directamente, sin depender de túneles. El tráfico de juego permanece TCP/UDP transparente; los paneles web e iframes usan HTTPS. Las URLs de txAdmin se construyen con el host público y el puerto asignado.

Cuando staging está detrás del borde de producción, producción configura `STAGING_UPSTREAM` para HTTP y `STAGING_TLS_UPSTREAM` para passthrough TLS en crudo. `STAGING_TLS_DOMAINS` restringe el reenvío SNI a la zona de preproducción, permitiendo subdominios dinámicos como `tx41120.ragenodes.dev` sin compartir claves privadas ni debilitar TLS.

El passthrough TLS no genera certificados. El borde de staging debe disponer de un certificado público válido para cada nombre de `OXIDE_ACME_DOMAINS`, o de un certificado wildcard emitido mediante DNS-01. El certificado autofirmado incluido para desarrollo nunca debe exponerse públicamente.

| Entorno | Endpoint público | Política Docker | Aislamiento |
|---|---|---|---|
| Local | `http://localhost:8088` | Excepción rootful permitida solo en desarrollo | Rutas y puertos del desarrollador |
| Staging | `https://panel.ragenodes.dev` | Socket aislado y `STAGING_PORT_BASE_OFFSET` | Bases de datos, volúmenes, redes y dominios `.dev` separados |
| Producción | `https://ragenodes.com` / herramientas `.app` | El preflight exige Docker rootless | Volúmenes productivos y bandas de puertos sin desplazamiento |

Si el plano de control se ejecuta con Docker rootful y los juegos con Docker
rootless, los datos de juego aparecen en el host con un GID remapeado. Configura
`GAME_DATA_GID` para producción y `STAGING_GAME_DATA_GID` para staging con el
GID que devuelve `stat -c '%g'` sobre un directorio de instancia. Mantener ambos
valores separados evita que el gestor de archivos y los editores de configuración
pierdan acceso, sin ampliar permisos ni mezclar datos entre entornos.

El pipeline de GitLab valida pruebas, contratos de seguridad, dependencias, Rust y Compose. Actualmente **no despliega automáticamente**: la promoción sigue `feature -> dev -> staging -> main` y después se ejecuta el despliegue revisado del entorno.

### Actualización de imágenes maestras

```bash
# Actualización manual segura; no recrea contenedores activos de clientes
./scripts/update_image_cache.sh

# Comprobar la actualización programada
systemctl status ragenodes-image-cache.timer
```

---

## 🕹️ Cómo Añadir un Nuevo Juego (Extender `GameFactory`)

Añadir soporte para un nuevo juego requiere únicamente crear su clase especializada heredando de `BaseGameService`:

```javascript
import { BaseGameService } from './BaseGameService.js';
import { GameFactory } from './GameFactory.js';

export class NuevoJuegoService extends BaseGameService {
    constructor() {
        super('nuevo_juego', 'imagen/docker:latest');
    }

    buildEnvironment(opts) {
        return [
            `SERVER_NAME=${opts.serverName}`,
            `PORT=${opts.gamePort}`
        ];
    }

    buildPortBindings(opts) {
        return {
            exposed: { [`${opts.gamePort}/udp`]: {} },
            bindings: { [`${opts.gamePort}/udp`]: [{ HostIp: "0.0.0.0", HostPort: String(opts.gamePort) }] }
        };
    }
}

// Instanciar y registrar en la fábrica
export const nuevoJuegoService = new NuevoJuegoService();
GameFactory.register('nuevo_juego', nuevoJuegoService);
```

---

## 🧪 Comandos de Calidad y Seguridad

```bash
# Ejecutar todas las pruebas unitarias e integración del backend
npm --prefix backend test

# Ejecutar migraciones de base de datos
npm --prefix backend run db:migrate

# Ejecutar auditorías de contratos de seguridad
npm run security:secrets
npm run security:csp-bindings
npm run security:inline-code
npm run security:deployment
npm run security:routes
```

---

## 📚 Technical Documentation / Documentación Técnica
* [System Architecture & UML Diagrams / Arquitectura del Sistema](docs/ARCHITECTURE.md)
* [ADR-001: Rust OxideProxy](docs/adr/ADR-001-rust-reverse-proxy.md)
* [ADR-002: OOP Architecture & GameFactory](docs/adr/ADR-002-game-factory-oop-architecture.md)
* [ADR-003: Direct Public Endpoints](docs/adr/ADR-003-direct-public-endpoints.md)
* [ADR-004: Versioned Database Migrations](docs/adr/ADR-004-versioned-database-migrations.md)
* [ADR-005: Structured JSON Logging & Request Correlation](docs/adr/ADR-005-structured-logging-and-request-correlation.md)
* [Production Readiness Checklist / Lista de preparación](docs/production-readiness-checklist.md)

---

## 🤝 Contributors / Contribuidores
* [@payniko24](https://gitlab.com/payniko24)
* [@marioscience](https://github.com/marioscience)

---

## 📜 License / Licencia
This project is private. Please ensure compliance with the terms and EULAs of the respective game servers (FiveM, SteamCMD, etc.).
