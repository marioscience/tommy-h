# 🏛️ Documento de Arquitectura de Software - RageNodes Ultimate

Este documento define la arquitectura técnica del sistema **RageNodes**, estructurado bajo los principios de **Ingeniería de Software de IBM (Coursera - Módulos 1, 3 y 4)**.

---

## 1. Visión General del Sistema y Diagrama de Componentes (C4 Nivel 2)

```mermaid
graph TD
    Client["🌐 Cliente Web / Navegador / Panel Admin"]
    DiscordBot["🤖 Discord Bot (Notificaciones & Eventos)"]
    
    subgraph "Capa de Entrada y Proxy (Rust)"
        OxideProxy["🦀 OxideProxy (Reverse Proxy / TLS / Cache)<br/><i>High Performance & Low Latency</i>"]
    end

    subgraph "Capa de Aplicación y Lógica de Negocio (Node.js)"
        BackendAPI["⚙️ Backend API REST & WebSockets (Express)"]
        WorkerBackups["📦 Backup Worker (Cron & Queues)"]
        WorkerDocker["📡 Docker Events Worker"]
        GameFactory["🏭 GameFactory & Game Services (POO)"]
    end

    subgraph "Capa de Datos y Persistencia"
        PostgresDB[("🐘 PostgreSQL / MariaDB")]
        RedisCache[("⚡ Redis (Sessions & Query Cache)")]
        DataVol[("💾 /srv/ragenodes-data (Instancias de Juego)")]
        BackupVol[("🗄️ /srv/ragenodes-backups")]
    end

    subgraph "Capa de Virtualización (Docker Daemon)"
        DockerEngine["🐳 Docker Daemon (Rootless Socket)"]
        FiveMNode["🎮 FiveM Game Node"]
        RustNode["☢️ Rust Server Node"]
        MCNode["⛏️ Minecraft Node"]
    end

    Client -->|HTTPS / WSS| OxideProxy
    OxideProxy -->|Reverse Proxy| BackendAPI
    BackendAPI --> PostgresDB
    BackendAPI --> RedisCache
    BackendAPI --> GameFactory
    GameFactory -->|Dockerode / Socket| DockerEngine
    WorkerDocker -->|Events Stream| DockerEngine
    WorkerBackups --> BackupVol
    DockerEngine --> FiveMNode
    DockerEngine --> RustNode
    DockerEngine --> MCNode
    FiveMNode --> DataVol
    DiscordBot -->|Webhooks / API| BackendAPI
```

---

## 2. Diagrama de Clases POO (Módulo 3: Herencia y Patrón Template Method)

```mermaid
classDiagram
    class BaseGameService {
        <<Abstract>>
        +String gameId
        +String defaultImage
        +prepareDirectory(nodeId, dataPath, subdirs)
        +buildEnvironment(opts)*
        +buildVolumes(opts)*
        +buildPortBindings(opts)*
        +buildHostConfig(opts, ports, binds)
        +afterStart(container, opts)
        +createContainer(opts)
    }

    class FiveMService {
        +buildEnvironment(opts)
        +buildVolumes(opts)
        +buildPortBindings(opts)
    }

    class RustGameService {
        +prepareDirectory(nodeId, dataPath)
        +buildEnvironment(opts)
        +buildVolumes(opts)
        +buildPortBindings(opts)
    }

    class MinecraftService {
        +resolveTargetImage(version)
        +buildEnvironment(opts)
        +buildVolumes(opts)
        +buildPortBindings(opts)
        +createContainer(opts)
    }

    class GameFactory {
        -Map~String, BaseGameService~ services
        +register(gameType, serviceInstance)
        +get(gameType) BaseGameService
        +has(gameType) Boolean
        +getSupportedGames() String[]
        +createContainer(gameType, opts)
    }

    BaseGameService <|-- FiveMService
    BaseGameService <|-- RustGameService
    BaseGameService <|-- MinecraftService
    GameFactory o-- BaseGameService
```

---

## 3. Diagrama de Secuencia: Ciclo de Vida del Servidor de Juegos (Módulo 4: Interaction Design)

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 👤 Usuario / Admin
    participant API as ⚙️ Backend API
    participant Factory as 🏭 GameFactory
    participant Service as 🎮 GameService (Polimórfico)
    participant Docker as 🐳 Docker Daemon
    participant DB as 🐘 PostgreSQL

    Admin->>API: POST /api/servers (game: "fivem", plan: "gold")
    API->>DB: INSERT INTO servers (status: "provisioning")
    API->>Factory: createContainer("fivem", opts)
    Factory->>Service: createContainer(opts)
    Service->>Service: prepareDirectory() & buildHostConfig()
    Service->>Docker: createContainer({ Image, Env, Ports, Binds })
    Docker-->>Service: ContainerCreated (id: "srv-101")
    Service->>Docker: startContainer("srv-101")
    Service->>Service: afterStart() -> applyBranding & DiscordWebhook
    API->>DB: UPDATE servers SET status = "online", container_id = "srv-101"
    API-->>Admin: 201 Created { serverId: "srv-101", status: "online" }
```

---

## 4. Estrategia Multi-Lenguaje (*Polyglot Architecture*)

1. **Rust (`oxideproxy` y N-API):**
   - Manejo de conexiones TLS concurrentes, enrutamiento HTTP/2 y proxy inverso sin sobrecarga de recolección de basura (*Zero-cost abstractions*).
   - Acceso nativo y seguro al cálculo de métricas y lectura de logs mediante N-API.
2. **Node.js (`backend`):**
   - Orquestación asíncrona no bloqueante de eventos de Docker, APIs REST, WebSockets en tiempo real y lógica de negocio.
3. **Shell Scripting (Bash & PowerShell):**
   - Automatización de despliegues seguros (`deploy.sh`, `auto_update_prod.sh`) y auto-recuperación de instancias.

---

## 5. Calidad y Observabilidad en Producción (*Quality Attributes*)

- **Liveness Probe:** `GET /healthz` retorna `200 OK` si el proceso Node.js responde.
- **Readiness Probe:** `GET /readyz` valida activamente la conexión a base de datos y la memoria RAM disponible antes de admitir tráfico de usuarios.
- **Testing Automatizado:** Ejecución de pruebas unitarias y de integración con `npm test` (`node:test`).
