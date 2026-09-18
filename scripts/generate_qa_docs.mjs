import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PLAYBOOKS_ES_DIR = path.join(ROOT_DIR, 'docs', 'qa', 'playbooks', 'es');
const PLAYBOOKS_EN_DIR = path.join(ROOT_DIR, 'docs', 'qa', 'playbooks', 'en');
const GITLAB_TEMPLATES_DIR = path.join(ROOT_DIR, '.gitlab', 'issue_templates');

await fs.mkdir(PLAYBOOKS_ES_DIR, { recursive: true });
await fs.mkdir(PLAYBOOKS_EN_DIR, { recursive: true });
await fs.mkdir(GITLAB_TEMPLATES_DIR, { recursive: true });

const GAMES_DATA = [
  {
    id: '00_roadmap',
    key: 'roadmap',
    emoji: '🚀',
    name_es: 'Hoja de Ruta de la Plataforma y Nuevas Funcionalidades',
    name_en: 'Platform Roadmap & Feature Testing Readiness',
    summary_es: 'Guía y seguimiento de las funcionalidades planificadas en RageNodes Ultimate para su validación de QA.',
    summary_en: 'Testing and validation playbook for upcoming RageNodes Ultimate core features.',
    gamer_steps_es: [
      {
        title: 'Verificar Despliegue Instantáneo en el Panel',
        how: 'Crear cualquier servidor desde la interfaz web y verificar que la barra de progreso avanza sin errores.',
        passed: 'El servidor se crea, muestra estado "En línea" en menos de 2 minutos y genera su IP.',
        failed: 'La barra se queda congelada, da error 500 o no genera puerto público.'
      },
      {
        title: 'Probar el Editor de Código Monaco',
        how: 'Ir al Gestor de Archivos, abrir un archivo de configuración (.cfg, .properties o .ini), modificar un texto y guardar.',
        passed: 'El editor resalta la sintaxis correctamente y guarda los cambios sin recargar la página.',
        failed: 'Pantalla en blanco, error de guardado o pérdida de formato.'
      },
      {
        title: 'Probar la Protección Vault en Archivos Protegidos',
        how: 'Intentar editar o descargar recursos marcados con [market].',
        passed: 'El sistema bloquea la edición mostrando "Vault Protection: Archivo protegido".',
        failed: 'Permite modificar el código fuente de un script protegido de la tienda.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Mitigación DDoS con OxideProxy eBPF/XDP',
        cmd: 'docker logs ragenodes_oxideproxy | grep -i "ebpf"',
        verify: 'El motor eBPF/XDP en Rust compila y enlaza los filtros de red en nanosegundos en la NIC sin pausas de GC.'
      },
      {
        title: 'Cola de Backups con Prioridad por Rango',
        cmd: 'docker exec -it ragenodes_backend node -e "import(\'./src/services/backupQueue.js\').then(m => console.log(m.backupQueue))"',
        verify: 'Los jobs de rango Elite se procesan antes que los de rango Hobby en la cola asíncrona.'
      },
      {
        title: 'Migración en Caliente Multi-Nodo',
        cmd: 'curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"',
        verify: 'El backend lista todos los nodos remotos y balancea las nuevas instancias según CPU y RAM libre.'
      },
      {
        title: 'Streaming de Logs con LogHub y Heartbeat SSE',
        cmd: 'curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"',
        verify: 'El flujo SSE emite un pulso ": heartbeat <timestamp>" cada 15 segundos manteniendo la conexión abierta.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Verify Instant Deployment in Web Panel',
        how: 'Create any server from the web UI and verify the progress bar advances smoothly.',
        passed: 'Server creates, shows "Online" in under 2 minutes, and displays its public IP.',
        failed: 'Progress bar gets stuck, returns HTTP 500, or fails to assign a public port.'
      },
      {
        title: 'Test Monaco Code Editor',
        how: 'Open File Manager, edit a config file (.cfg, .properties, .ini), change a value, and click Save.',
        passed: 'Editor highlights syntax and saves cleanly without refreshing the browser.',
        failed: 'Blank screen, save error, or corrupted file formatting.'
      },
      {
        title: 'Test Marketplace Vault Protection',
        how: 'Attempt to edit or download scripts located in [market] folders.',
        passed: 'System denies action with "Vault Protection: Protected source file".',
        failed: 'Allows modifying or leaking protected marketplace code.'
      }
    ],
    dev_steps_en: [
      {
        title: 'DDoS Mitigation with OxideProxy eBPF/XDP',
        cmd: 'docker logs ragenodes_oxideproxy | grep -i "ebpf"',
        verify: 'Aya Rust eBPF/XDP engine binds network filter in nanoseconds at the NIC level without GC pauses.'
      },
      {
        title: 'Rank-Based Backup Priority Queue',
        cmd: 'docker exec -it ragenodes_backend node -e "import(\'./src/services/backupQueue.js\').then(m => console.log(m.backupQueue))"',
        verify: 'Elite tier backup jobs preempt Hobby tier jobs in the async worker queue.'
      },
      {
        title: 'Multi-Node Hot Migration',
        cmd: 'curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"',
        verify: 'Backend lists remote daemon nodes and places instances according to lowest resource saturation.'
      },
      {
        title: 'SSE LogHub Streaming & 15s Heartbeat',
        cmd: 'curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"',
        verify: 'SSE stream emits periodic ": heartbeat <timestamp>" every 15 seconds to prevent NAT timeout.'
      }
    ]
  },
  {
    id: '01_fivem',
    key: 'fivem',
    emoji: '🚗',
    name_es: 'FiveM (Grand Theft Auto V Roleplay)',
    name_en: 'FiveM (GTA V RP FXServer)',
    summary_es: 'Pruebas de sincronización de vehículos a alta velocidad, txAdmin con proxy HTTPS, MariaDB aislada y Blender WebTop 3D.',
    summary_en: 'High-speed vehicle sync across Los Santos, txAdmin reverse proxy, MariaDB isolation, and Blender WebTop 3D.',
    gamer_steps_es: [
      {
        title: 'Crear y Arrancar Servidor FiveM',
        how: 'Crear servidor FiveM en el panel. Poner una clave de Keymaster (License Key) válida y encender.',
        passed: 'El botón se pone verde, muestra la IP pública y el puerto txAdmin.',
        failed: 'Se queda en iniciando o da error de base de datos.'
      },
      {
        title: 'Entrar a txAdmin por Web',
        how: 'Hacer clic en el botón "Abrir txAdmin" en el panel de RageNodes.',
        passed: 'Abre la interfaz de txAdmin bajo HTTPS sin advertencias de certificado y te deja iniciar sesión.',
        failed: 'Error 502 Bad Gateway o pantalla en blanco.'
      },
      {
        title: 'Conectar al Servidor desde el Juego',
        how: 'Abrir FiveM en la PC. Presionar F8 y escribir: connect <IP:Puerto>. Entrar junto con otro jugador.',
        passed: 'Ambos cargan el mapa de Los Santos, se ven caminar y se escuchan por voz de proximidad.',
        failed: 'Error "Connection timed out" o pantalla de carga infinita.'
      },
      {
        title: 'Prueba de Conducción a 200 km/h',
        how: 'Subirse a un superdeportivo. Conducir a toda velocidad por la autopista durante 3 minutos con el copiloto.',
        passed: 'El copiloto se mantiene dentro del auto sin salir despedido y las texturas cargan fluido.',
        failed: 'El auto cae por el mapa o el copiloto se teletransporta 200 metros atrás.'
      },
      {
        title: 'Probar el Editor 3D Blender WebTop',
        how: 'En el panel, ir a la pestaña Blender y hacer clic en "Iniciar Blender". Abrir la sesión gráfica.',
        passed: 'Abre una ventana de Blender en el navegador lista para editar modelos 3D (.ydr / .yft).',
        failed: 'No conecta a la sesión VNC o da error de puerto.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Offset de Puertos y Enrutamiento OxideProxy L4',
        cmd: 'docker port <fivem-container>',
        verify: 'El puerto 30120 TCP/UDP está enrutado por OxideProxy con offset backend 30000, evitando colisión con el puerto 40120 de txAdmin.'
      },
      {
        title: 'Aislamiento de Base de Datos MariaDB',
        cmd: 'docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR \'<db_user>\'@\'%\';"',
        verify: 'El usuario solo tiene permisos sobre su propia base db_name y no puede ver las bases de otros clientes.'
      },
      {
        title: 'Heartbeat y Auto-Apagado de Blender WebTop',
        cmd: 'docker ps | grep blender',
        verify: 'Si el cliente cierra la pestaña, el contenedor de Blender se detiene tras expirar el heartbeat para liberar GPU y RAM.'
      },
      {
        title: 'Registro de Disparos bajo Latencia Simulada',
        cmd: 'tc qdisc add dev docker0 root netem delay 120ms',
        verify: 'Los disparos entre dos jugadores a la carrera son autorizados correctamente por el servidor sin desincronización de vida.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy & Boot FiveM Server',
        how: 'Create FiveM server in panel with a valid Cfx.re Keymaster license key and click Start.',
        passed: 'Status flips to "Online", displays public game IP and txAdmin access.',
        failed: 'Stuck on starting or throws database connection error.'
      },
      {
        title: 'Open txAdmin Web Interface',
        how: 'Click "Open txAdmin" button in the RageNodes dashboard.',
        passed: 'txAdmin loads over HTTPS without security warnings and allows admin login.',
        failed: '502 Bad Gateway or blank page.'
      },
      {
        title: 'In-Game Connection & Spawn',
        how: 'Launch FiveM on PC, press F8, type: connect <IP:Port>. Join with a second player.',
        passed: 'Both players load into Los Santos, see each other move, and proximity voice chat works.',
        failed: 'Connection timed out or stuck on infinite loading screen.'
      },
      {
        title: 'High-Speed 200 km/h Highway Test',
        how: 'Spawn a supercar. Drive at full speed down the highway for 3 minutes with a passenger.',
        passed: 'Passenger remains smoothly seated inside car; road and buildings stream without pop-in.',
        failed: 'Car falls through map or passenger gets rubberbanded onto the road.'
      },
      {
        title: 'Test Blender WebTop 3D Editor',
        how: 'Go to Blender tab in panel and click "Start Blender". Open the browser session.',
        passed: 'Blender 3D interface loads in browser, ready to edit .ydr/.yft vehicle models.',
        failed: 'VNC connection fails or port is refused.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Port Offsets & OxideProxy L4 Routing',
        cmd: 'docker port <fivem-container>',
        verify: 'Port 30120 TCP/UDP maps via OxideProxy with backend offset 30000, preventing collision with txAdmin on 40120.'
      },
      {
        title: 'MariaDB Privilege Isolation',
        cmd: 'docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR \'<db_user>\'@\'%\';"',
        verify: 'Database user only possesses grants on its dedicated database and cannot see other tenant databases.'
      },
      {
        title: 'Blender WebTop Heartbeat Auto-Shutdown',
        cmd: 'docker ps | grep blender',
        verify: 'When browser tab closes, Blender container terminates after heartbeat expiration to free host GPU/RAM.'
      },
      {
        title: 'Authoritative Hitreg under Simulated Latency',
        cmd: 'tc qdisc add dev docker0 root netem delay 120ms',
        verify: 'Server authoritatively validates bullet damage between sprinting players without client desync.'
      }
    ]
  },
  {
    id: '02_minecraft',
    key: 'minecraft',
    emoji: '⛏️',
    name_es: 'Minecraft (Paper, Fabric, Forge, Purpur, Vanilla)',
    name_en: 'Minecraft (Paper, Fabric, Forge, Vanilla)',
    summary_es: 'Pruebas de generación masiva de chunks, estabilidad de 20.0 TPS, resolución de Java por versión y plugins Spiget.',
    summary_en: 'Spectator chunk loading, 20.0 TPS verification, dynamic OpenJDK versioning, and 1-click Spiget plugins.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor y Elegir Versión',
        how: 'Crear servidor Minecraft Paper o Purpur en la versión 1.21.4. Iniciar servidor.',
        passed: 'El servidor enciende, acepta el EULA automáticamente y muestra el puerto 25565.',
        failed: 'Error de EULA o contenedor detenido inmediatamente con código 137.'
      },
      {
        title: 'Instalar Plugin con 1-Clic',
        how: 'Ir a la pestaña Plugins, buscar "EssentialsX" o "LuckPerms", hacer clic en Instalar y reiniciar.',
        passed: 'El archivo .jar aparece en la carpeta /plugins/ y los comandos del plugin funcionan en el juego.',
        failed: 'El plugin no se descarga o rompe el inicio del servidor.'
      },
      {
        title: 'Conectar al Servidor desde Minecraft',
        how: 'Abrir Minecraft Java en PC, ir a Multijugador, añadir la IP:Puerto y entrar.',
        passed: 'Entras al mundo al instante con ping bajo y sin mensajes de error de autenticación.',
        failed: 'Error "Connection Refused" o "Server Outdated".'
      },
      {
        title: 'Vuelo a Toda Velocidad en Espectador (Test de Chunks)',
        how: 'Ponerte en modo espectador (/gamemode spectator) y volar hacia adelante generando nuevo mapa durante 3 minutos.',
        passed: 'El terreno carga delante de ti. Al escribir /tps en la consola, se mantiene entre 19.8 y 20.0 TPS.',
        failed: 'El juego se congela, los chunks tardan 10 segundos en cargar o el TPS cae por debajo de 15.'
      },
      {
        title: 'Prueba de Bloques Fantasma (Ghost Blocks)',
        how: 'Picar una fila de 30 bloques de piedra rápidamente con un pico de diamante con eficiencia.',
        passed: 'Todos los bloques se rompen de forma fluida y dan el item. Ningún bloque roto vuelve a aparecer mágicamente.',
        failed: 'Los bloques rotos reaparecen de golpe sofocando al jugador.'
      },
      {
        title: 'Editor Visual de server.properties',
        how: 'En el panel, ir a Configuración de Minecraft. Cambiar la dificultad a "Hard" y la vista a 10 chunks. Guardar.',
        passed: 'Los cambios se reflejan en el archivo server.properties y aplican tras reiniciar.',
        failed: 'Los cambios no se guardan o se borra el archivo.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Resolución Dinámica de Imagen OpenJDK',
        cmd: 'docker inspect <mc-container> | grep -i "image"',
        verify: 'Minecraft 1.8/1.12 usa Java 11; 1.18/1.20 usa Java 17; 1.21+ usa Java 21/25 automáticamente.'
      },
      {
        title: 'Cálculo Seguro de Memoria JVM Headroom',
        cmd: 'docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"',
        verify: 'calculateMinecraftJvmMemoryMb reserva el 25% y al menos 768MB para el sistema y Netty, evitando OOM Exit 137.'
      },
      {
        title: 'Bloqueo de Identidad de Mundo',
        cmd: 'cat <dataPath>/.ragenodes-minecraft-identity.json',
        verify: 'El archivo identity bloquea cambios accidentales de versión o motor para no corromper el mundo del cliente.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Server & Choose Version',
        how: 'Deploy Minecraft Paper or Purpur on version 1.21.4. Click Start.',
        passed: 'Server turns on, auto-accepts EULA, and binds to port 25565.',
        failed: 'EULA error or container exits with code 137.'
      },
      {
        title: '1-Click Plugin Installation',
        how: 'Go to Plugins tab, search "EssentialsX", click Install, and restart server.',
        passed: '.jar appears in /plugins/ folder and plugin commands work in-game.',
        failed: 'Plugin fails to download or crashes server startup.'
      },
      {
        title: 'Join Server from Client',
        how: 'Open Minecraft Java, go to Multiplayer, enter IP:Port, and connect.',
        passed: 'Immediate connection, low ping, no auth errors.',
        failed: 'Connection Refused or Outdated Server error.'
      },
      {
        title: 'High-Speed Spectator Flight (Chunk Stress)',
        how: 'Switch to spectator mode (/gamemode spectator) and fly across ungenerated terrain for 3 minutes.',
        passed: 'Chunks stream ahead smoothly; running /tps confirms stability between 19.8 - 20.0.',
        failed: 'TPS drops below 15, chunks fail to render, or client rubberbands.'
      },
      {
        title: 'Ghost Block Desync Test',
        how: 'Rapidly mine a tunnel of 30 stone blocks with an efficiency diamond pickaxe.',
        passed: 'Blocks break smoothly and drop items; no blocks reappear magically (no ghost blocks).',
        failed: 'Broken blocks flash and reappear, trapping the player.'
      },
      {
        title: 'Visual server.properties Editor',
        how: 'In panel, open Minecraft Config, change difficulty to Hard, and set view-distance to 10. Click Save.',
        passed: 'Values persist to server.properties on disk and apply upon reboot.',
        failed: 'Settings revert to default or file corrupts.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Dynamic OpenJDK Tag Resolution',
        cmd: 'docker inspect <mc-container> | grep -i "image"',
        verify: 'Versions 1.8/1.12 load Java 11; 1.18/1.20 load Java 17; 1.21+ load Java 21/25 automatically.'
      },
      {
        title: 'JVM Memory Headroom Formula',
        cmd: 'docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"',
        verify: 'calculateMinecraftJvmMemoryMb reserves 25% and at least 768MB native headspace for Netty and Cgroups.'
      },
      {
        title: 'World Identity Lock Integrity',
        cmd: 'cat <dataPath>/.ragenodes-minecraft-identity.json',
        verify: 'Identity file locks edition and version to prevent accidental world corruption across restarts.'
      }
    ]
  },
  {
    id: '03_rust',
    key: 'rust',
    emoji: '☢️',
    name_es: 'Rust Dedicated Server',
    name_en: 'Rust Dedicated Server',
    summary_es: 'Pruebas de balística, hitreg con AK-47, plugins uMod C# con hot-reload y herramienta de Wipe.',
    summary_en: 'AK-47 combatlog ballistics, uMod hot-reload, wipe tool verification, and 3-port proxy routing.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor de Rust y Encender',
        how: 'Crear servidor Rust en el panel con al menos 6GB de RAM. Iniciar.',
        passed: 'Enciende en verde y en la consola ves que descarga el mapa procedural.',
        failed: 'Falta de memoria o error de puertos 28015/28016.'
      },
      {
        title: 'Conectar desde la Consola de Rust',
        how: 'Abrir Rust en Steam. Presionar F1 y escribir: client.connect <IP:28015>.',
        passed: 'Descarga el mapa procedural y apareces en la playa despierto.',
        failed: 'Error "Disconnected: Connection Attempt Failed".'
      },
      {
        title: 'Prueba de Balística y Registro de Disparos',
        how: 'Con un amigo a 50 metros corriendo de lado a lado, dispararle con un rifle AK-47.',
        passed: 'Escuchas el sonido de impacto (hitmarker). Al escribir combatlog en consola F1, registra los impactos con daño real.',
        failed: 'Las balas atraviesan al jugador sin hacer daño o hay retraso de más de medio segundo.'
      },
      {
        title: 'Instalación y Recarga en Caliente de Plugin uMod',
        how: 'En el panel, instalar un plugin de uMod (como GatherManager).',
        passed: 'El plugin se descarga en /oxide/plugins y se compila solo sin tener que reiniciar el servidor.',
        failed: 'Error de compilación de C# o plugin no reconocido.'
      },
      {
        title: 'Probar el Botón de Wipe de Mapa',
        how: 'En el panel de Rust, hacer clic en "Wipe de Servidor" y seleccionar "Solo Mapa".',
        passed: 'El servidor borra los archivos .map y .sav pero conserva los planos (blueprints) de los jugadores.',
        failed: 'No borra nada o borra los blueprints por error.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Enrutamiento Triple de Puertos L4',
        cmd: 'docker port <rust-container>',
        verify: 'OxideProxy enruta los 3 puertos: 28015 (Juego), 28016 (RCON) y 28017 (Query) simultáneamente.'
      },
      {
        title: 'Tickrate de Servidor y Pausas de Garbage Collection',
        cmd: 'docker exec -it <rust-container> rcon "serverinfo"',
        verify: 'El Server FPS se mantiene en 30-60 y las pausas de GC no superan los 20ms.'
      },
      {
        title: 'Monitor de Killfeed y Chat vía API',
        cmd: 'curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"',
        verify: 'La API extrae eventos de muerte y combate en tiempo real de los logs del contenedor.'
      },
      {
        title: 'Aislamiento de Identidad de Servidor',
        cmd: 'ls -la <dataPath>/server/ragenodes',
        verify: 'Todos los datos del mundo se alojan en la carpeta de identidad ragenodes sin mezclar instalaciones.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Rust Server & Start',
        how: 'Deploy Rust server with at least 6GB RAM plan. Click Start.',
        passed: 'Server turns green and console indicates procedural map generation.',
        failed: 'OOM failure or port 28015/28016 conflict.'
      },
      {
        title: 'Connect via In-Game F1 Console',
        how: 'Open Rust on Steam. Press F1 and enter: client.connect <IP:28015>.',
        passed: 'Loads procedural map and spawns player on the beach.',
        failed: 'Connection Attempt Failed error.'
      },
      {
        title: 'AK-47 Ballistics & Combatlog Hitreg',
        how: 'Have a friend sprint 50m away while firing an AK-47 at them.',
        passed: 'Crisp hitmarker audio plays; typing combatlog in F1 console confirms valid server-authoritative hits.',
        failed: 'Bullets pass through without damage or hitmarker has >500ms delay.'
      },
      {
        title: '1-Click uMod Plugin Install & Hot Reload',
        how: 'Install uMod plugin (e.g. GatherManager) from panel.',
        passed: '.cs file downloads to /oxide/plugins and Oxide C# compiler hot-reloads it without rebooting.',
        failed: 'C# compiler error or plugin fails to load.'
      },
      {
        title: 'Test Map Wipe Tool',
        how: 'Click "Server Wipe" in panel and select "Map Only".',
        passed: 'Server unlinks .map and .sav files but preserves player blueprints.',
        failed: 'Fails to wipe world or wipes blueprints accidentally.'
      }
    ],
    dev_steps_en: [
      {
        title: 'L4 Multi-Port Proxy Triplet',
        cmd: 'docker port <rust-container>',
        verify: 'OxideProxy binds Game (28015), RCON (28016), and Query (28017) UDP/TCP ports cleanly.'
      },
      {
        title: 'Server FPS & Garbage Collection Pauses',
        cmd: 'docker exec -it <rust-container> rcon "serverinfo"',
        verify: 'Server maintains target tickrate (30-60 FPS) and GC pauses do not exceed 20ms.'
      },
      {
        title: 'Live Killfeed & Chat API Feed',
        cmd: 'curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"',
        verify: 'API parses live player kills and global chat from server stdout stream.'
      },
      {
        title: 'Server Identity Isolation',
        cmd: 'ls -la <dataPath>/server/ragenodes',
        verify: 'All world data files reside strictly inside /server/ragenodes/ directory.'
      }
    ]
  },
  {
    id: '04_palworld',
    key: 'palworld',
    emoji: '🥚',
    name_es: 'Palworld Dedicated Server',
    name_en: 'Palworld Dedicated Server',
    summary_es: 'Captura de Pals, sincronización de IA en base, visor de gremios y prueba de fuga de memoria Unreal.',
    summary_en: 'Pal capture sync, base worker retention, guild inspector, and Unreal Engine 4-hour memory soak test.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor de Palworld',
        how: 'Crear servidor en el panel con mínimo 6GB de RAM. Iniciar.',
        passed: 'Enciende en verde y expone el puerto UDP 8211.',
        failed: 'Fallo al arrancar o error de permisos en carpeta palworld.'
      },
      {
        title: 'Conectar por IP Directa en el Juego',
        how: 'Abrir Palworld en Steam. Seleccionar Multijugador -> Conexión Directa. Pegar IP:8211.',
        passed: 'Carga la pantalla de creación de personaje y entras al mundo.',
        failed: 'No encuentra el servidor o se queda colgado en pantalla negra.'
      },
      {
        title: 'Capturar Pals y Pelear en Equipo',
        how: 'Lanzar Pal Spheres a criaturas salvajes con otro jugador disparando al mismo tiempo.',
        passed: 'El porcentaje de captura se ve idéntico para ambos jugadores y el Pal capturado obedece órdenes.',
        failed: 'La esfera atraviesa al Pal o los Pals se quedan congelados sin atacar.'
      },
      {
        title: 'Automatización de Base y Retención de Chunks',
        how: 'Construir una base, poner a 3 Pals a picar piedra. Alejarse 1 kilómetro del lugar y volver 10 minutos después.',
        passed: 'Al volver, los Pals siguen trabajando y la piedra acumulada está en los cofres.',
        failed: 'Los Pals se quedan atascados en el aire o la base se resetea.'
      },
      {
        title: 'Visor de Gremios (Guilds) en el Panel',
        how: 'Abrir la pestaña Gremios en el panel de RageNodes.',
        passed: 'Muestra el nombre de tu gremio, lista de miembros y coordenadas de la base.',
        failed: 'Lista vacía o error 500.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Permisos de Usuario Rootless en Contenedor',
        cmd: 'ls -ld <dataPath>',
        verify: 'El directorio está asignado a UID 1000:1000 previniendo errores de escritura en los guardados de mundo.'
      },
      {
        title: 'Soak Test de Memoria Unreal Engine (4 Horas)',
        cmd: 'docker stats <palworld-container> --no-stream',
        verify: 'El recolector de basura de Unreal Engine no presenta fugas continuas de RAM sobre el límite de cgroup.'
      },
      {
        title: 'Comandos RCON de Gestión Administrativa',
        cmd: 'curl -X POST http://localhost:3000/api/rcon/<id>/command -d \'{"command":"Broadcast Hola"}\' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"',
        verify: 'El mensaje de difusión se emite de inmediato en las pantallas de los jugadores.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Palworld Server',
        how: 'Create server in panel with at least 6GB RAM plan and click Start.',
        passed: 'Turns green and binds UDP port 8211.',
        failed: 'Startup failure or permission denied on /palworld volume.'
      },
      {
        title: 'Join via Direct IP in Game',
        how: 'Open Palworld on Steam, select Multiplayer -> Direct Connection, enter IP:8211.',
        passed: 'Character creation loads and player spawns on the island.',
        failed: 'Server not found or black loading screen hangs.'
      },
      {
        title: 'Pal Capture & Co-op Combat Sync',
        how: 'Throw Pal Spheres at wild Pals while a teammate attacks them.',
        passed: 'Capture percentage rolls in sync for all players; captured Pal responds to companion AI commands.',
        failed: 'Sphere phases through Pal or AI companion freezes.'
      },
      {
        title: 'Base Automation & Chunk Retention',
        how: 'Build a base, assign 3 Pals to mining/logging. Travel 1km away and return 10 minutes later.',
        passed: 'Upon return, Pals are still actively working and resources accumulated in storage.',
        failed: 'Pals get stuck in T-pose or production state resets.'
      },
      {
        title: 'Guild Inspector in Panel',
        how: 'Open Guilds tab in RageNodes dashboard.',
        passed: 'Displays active guild names, roster members, and base coordinates accurately.',
        failed: 'Empty response or 500 error.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Rootless UID 1000:1000 Permissions',
        cmd: 'ls -ld <dataPath>',
        verify: 'Volume belongs to UID 1000:1000, preventing permission denied errors during auto-save writes.'
      },
      {
        title: 'Unreal Engine 4-Hour Memory Soak Test',
        cmd: 'docker stats <palworld-container> --no-stream',
        verify: 'Palworld server GC stabilizes memory consumption below cgroup kill threshold over 4 hours.'
      },
      {
        title: 'RCON Broadcast & Admin Commands',
        cmd: 'curl -X POST http://localhost:3000/api/rcon/<id>/command -d \'{"command":"Broadcast Hello"}\' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"',
        verify: 'Broadcast text banner displays instantly across player viewports in-game.'
      }
    ]
  },
  {
    id: '05_cs2',
    key: 'cs2',
    emoji: '🔫',
    name_es: 'Counter-Strike 2 (Source 2)',
    name_en: 'Counter-Strike 2 (Source 2)',
    summary_es: 'Pruebas de sub-tick, sincronización de humo volumétrico, Matchpad de consola y normalizador de permisos rootless.',
    summary_en: 'Sub-tick registration, volumetric smoke sync, console matchpad, and rootless permission normalization.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor y Añadir Token GSLT',
        how: 'Crear servidor CS2 en el panel, colocar tu token GSLT de Steam y encender.',
        passed: 'El servidor arranca y muestra el puerto 27015.',
        failed: 'Error de GSLT o fallo al descargar imagen.'
      },
      {
        title: 'Conectar por Consola de Desarrollador',
        how: 'Abrir CS2 en Steam, abrir la consola (tecla ~) y escribir: connect <IP:27015>.',
        passed: 'Carga el mapa (ejemplo: de_dust2 o de_mirage) y entras a elegir bando (CT o T).',
        failed: 'Error "Connection failed after 30 retries".'
      },
      {
        title: 'Prueba de Humo Volumétrico y Granadas',
        how: 'Lanzar una granada de humo en medio del mapa con dos jugadores mirando.',
        passed: 'La nube de humo volumétrica tiene la misma forma exacta y se disipa al mismo segundo en ambas pantallas.',
        failed: 'Un jugador ve el humo y el otro puede ver a través porque no se sincronizó.'
      },
      {
        title: 'Consola Matchpad Competitiva',
        how: 'En el panel, ir a la pestaña Matchpad y hacer clic en "Reiniciar Ronda" o "Cambiar Mapa".',
        passed: 'En el juego se reinicia la partida al instante o cambia de mapa.',
        failed: 'No responde el comando.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Normalizador de Permisos Rootless Helper',
        cmd: 'docker inspect <cs2-container>',
        verify: 'El helper normalizeCS2DataOwnership ejecutó chown -R 1000:1000 dentro del daemon sin errores de buffer.'
      },
      {
        title: 'Precisión Sub-Tick y Socket UDP 27015',
        cmd: 'docker logs <cs2-container> | grep -i "tick"',
        verify: 'El motor Source 2 procesa los paquetes de cliente sub-tick sin advertencias de desbordamiento de buffer.'
      },
      {
        title: 'Editor Visual de server.cfg',
        cmd: 'cat <dataPath>/game/csgo/cfg/server.cfg',
        verify: 'Las variables competitivas (mp_roundtime, sv_cheats) persisten tras ser modificadas desde la web.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Server & Inject GSLT Token',
        how: 'Deploy CS2 in panel, input Steam Game Server Login Token (GSLT), and start.',
        passed: 'Starts up and binds port 27015 TCP/UDP.',
        failed: 'GSLT invalid error or startup abort.'
      },
      {
        title: 'Connect via Developer Console',
        how: 'Open CS2, open console (~), type: connect <IP:27015>.',
        passed: 'Loads map (de_dust2/de_mirage) and prompts team selection (CT/T).',
        failed: 'Connection failed after 30 retries error.'
      },
      {
        title: 'Volumetric Smoke & Grenade Sync',
        how: 'Throw a smoke grenade while two players watch from different angles.',
        passed: 'Volumetric smoke plume renders identical geometry and dissipates simultaneously on both clients.',
        failed: 'Smoke desync allows one player to see through the cloud.'
      },
      {
        title: 'Competitive Matchpad Console',
        how: 'In panel, open Matchpad tab, click "Restart Round" or send changelevel.',
        passed: 'Match immediately resets in-game or loads designated competitive map.',
        failed: 'Command is ignored or drops connection.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Rootless Ownership Normalization Helper',
        cmd: 'docker inspect <cs2-container>',
        verify: 'normalizeCS2DataOwnership successfully aligned volume UID to 1000:1000 inside Docker namespace.'
      },
      {
        title: 'Sub-Tick Packet Rate & Socket 27015',
        cmd: 'docker logs <cs2-container> | grep -i "tick"',
        verify: 'Source 2 socket operates without packet buffer overflows during rapid rifle spray sequences.'
      },
      {
        title: 'server.cfg Visual Persistence',
        cmd: 'cat <dataPath>/game/csgo/cfg/server.cfg',
        verify: 'Competitive convars edited via web UI persist cleanly to disk.'
      }
    ]
  },
  {
    id: '06_ark',
    key: 'ark',
    emoji: '🦖',
    name_es: 'ARK: Survival Ascended / Evolved',
    name_en: 'ARK: Survival Ascended / Evolved',
    summary_es: 'Capacidades de Proton/Wine, montura de dinosaurios, clústeres Cross-ARK y actualización forzada SteamCMD.',
    summary_en: 'Proton/Wine Linux capabilities, dino mounting, Cross-ARK shared clusters, and forced updates.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor ARK',
        how: 'Crear servidor ARK en el panel con al menos 12GB de RAM recomendados. Iniciar.',
        passed: 'Arranca y genera el mundo TheIsland_WP.',
        failed: 'Fallo por memoria insuficiente o error de Wine.'
      },
      {
        title: 'Conectar al Servidor en el Juego',
        how: 'Abrir ARK, ir al buscador de servidores no oficiales y unirse por IP.',
        passed: 'Descarga los datos y apareces en la playa para crear superviviente.',
        failed: 'No aparece en la lista o se queda en pantalla de carga.'
      },
      {
        title: 'Montar Dinosaurio y Talar Árboles',
        how: 'Domesticar un dinosaurio (Rex o Triceratops), montarlo y arrasar con árboles y rocas.',
        passed: 'El dinosaurio se mueve suave y los árboles caen al mismo tiempo para todos los jugadores.',
        failed: 'Tirones bruscos hacia atrás (rubberbanding) al chocar con árboles.'
      },
      {
        title: 'Transferencia por Obelisco en Clúster',
        how: 'Configurar un clusterId en el panel. Subir un dinosaurio a un Obelisco y descargarlo en otro servidor de ARK.',
        passed: 'El dinosaurio aparece en el segundo servidor con sus estadísticas e inventario intactos.',
        failed: 'El dinosaurio desaparece o se corrompe el personaje.'
      },
      {
        title: 'Forzar Actualización de Versión de ARK',
        how: 'En el panel, hacer clic en "Forzar Actualización de ARK".',
        passed: 'El servidor borra el manifest de Steam y SteamCMD descarga la última versión al reiniciar.',
        failed: 'Error al reiniciar.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Capacidades Elevadas de Proton/Wine',
        cmd: 'docker inspect <ark-container> | grep -A 10 "CapAdd"',
        verify: 'El contenedor posee CHOWN, SETUID, SETGID, KILL, DAC_OVERRIDE y ShmSize de 1GB para ejecutar Proton.'
      },
      {
        title: 'Montaje de Clúster Compartido Cross-ARK',
        cmd: 'docker inspect <ark-container> | grep -i "cluster"',
        verify: 'El volumen compartido cluster se monta en /home/steam/Steam/steamapps/cluster permitiendo transferencias.'
      },
      {
        title: 'Borrado Atómico de appmanifest_2430930.acf',
        cmd: 'ls -la <dataPath>/steamapps/',
        verify: 'La función forceUpdateARK retira el archivo de manifest forzando a SteamCMD a verificar archivos íntegros.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy ARK Server',
        how: 'Deploy ARK in panel with at least 12GB RAM plan. Click Start.',
        passed: 'Boots cleanly and initializes TheIsland_WP.',
        failed: 'OOM failure or Wine prefix abort.'
      },
      {
        title: 'Join Server from In-Game Browser',
        how: 'Open ARK, navigate to Unofficial Sessions, and join by IP.',
        passed: 'Loads map data and prompts survivor spawn screen on beach.',
        failed: 'Session not found or infinite loading screen.'
      },
      {
        title: 'Ride Dinosaur & Tree Collision Sync',
        how: 'Tame a large creature (Rex/Trike), ride it across terrain knocking down trees and rocks.',
        passed: 'Creature moves smoothly; foliage destructions replicate in sync across players.',
        failed: 'Severe rubberbanding when colliding with fallen trees.'
      },
      {
        title: 'Obelisk Clustered Transfer Test',
        how: 'Configure clusterId in panel. Upload creature to an Obelisk; download on a second clustered server.',
        passed: 'Creature transfers with stats, level, and inventory intact.',
        failed: 'Creature is deleted or character gets stuck.'
      },
      {
        title: 'Force Engine Version Update',
        how: 'Click "Force ARK Update" button in panel.',
        passed: 'Server purges manifest and SteamCMD re-validates engine files upon restart.',
        failed: 'Server fails to start or update fails.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Proton/Wine Elevated Capabilities',
        cmd: 'docker inspect <ark-container> | grep -A 10 "CapAdd"',
        verify: 'Container contains CHOWN, SETUID, SETGID, KILL, DAC_OVERRIDE, and 1GB ShmSize for Proton emulation.'
      },
      {
        title: 'Cross-ARK Cluster Shared Volume Mount',
        cmd: 'docker inspect <ark-container> | grep -i "cluster"',
        verify: 'Shared cluster directory mounts into /home/steam/Steam/steamapps/cluster across clustered instances.'
      },
      {
        title: 'Atomic Removal of appmanifest_2430930.acf',
        cmd: 'ls -la <dataPath>/steamapps/',
        verify: 'forceUpdateARK endpoint safely removes manifest file, triggering clean SteamCMD re-download.'
      }
    ]
  },
  {
    id: '07_sdtd',
    key: 'sdtd',
    emoji: '🧟',
    name_es: '7 Days to Die (The Fun Pimps)',
    name_en: '7 Days to Die (The Fun Pimps)',
    summary_es: 'Prueba de colapso de física vóxel, horda de Luna de Sangre con 64 zombis, chequeo de binarios y Telnet.',
    summary_en: 'Voxel structural collapse, 64-zombie Blood Moon horde, binary integrity checks, and Telnet isolation.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor de 7 Days to Die',
        how: 'Crear servidor en el panel con mínimo 6GB de RAM. Iniciar.',
        passed: 'Arranca y expone el puerto 26900 UDP y 26902 TCP.',
        failed: 'Error de validación de archivos de instalación.'
      },
      {
        title: 'Conectar desde el Juego con EAC Activo',
        how: 'Abrir 7 Days to Die con Easy Anti-Cheat activo y unirse por IP.',
        passed: 'Pasa la verificación de EAC y apareces en el mundo vóxel.',
        failed: 'Error "EAC Disconnected" o fallo de autenticación.'
      },
      {
        title: 'Prueba de Colapso Físico Estructural',
        how: 'Buscar un edificio grande y destruir los pilares de soporte inferiores con dinamita o pico.',
        passed: 'El techo y los pisos superiores colapsan en escombros físicos de forma idéntica para todos los jugadores.',
        failed: 'Los bloques se quedan flotando en el aire desafiando la física.'
      },
      {
        title: 'Horda de Luna de Sangre (Blood Moon)',
        how: 'Configurar o adelantar el tiempo a la noche 7 para desatar la horda con 64 zombis simultáneos.',
        passed: 'Los zombis corren hacia los jugadores calculando rutas sin congelar el servidor.',
        failed: 'El servidor se traba, el ping se dispara a más de 1000ms o el juego crashea.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Verificación de Integridad de Binarios',
        cmd: 'docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"',
        verify: 'buildSDTDInstallationCheck certifica que el ejecutable de Unity y globalgamemanagers están completos.'
      },
      {
        title: 'Aislamiento del Puerto Telnet Administrativo',
        cmd: 'docker port <sdtd-container> | grep 26902',
        verify: 'El puerto 26902 Telnet está protegido con contraseña generada por deriveServicePassword.'
      },
      {
        title: 'Persistencia en serverconfig.xml',
        cmd: 'cat <dataPath>/serverconfig.xml',
        verify: 'Las configuraciones de dificultad y tamaño de mundo guardadas en el panel se escriben en XML válido.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy 7 Days to Die Server',
        how: 'Deploy server in panel with at least 6GB RAM plan. Click Start.',
        passed: 'Turns online and exposes UDP 26900 and TCP 26902 ports.',
        failed: 'Installation file integrity check fails.'
      },
      {
        title: 'Join Game with Easy Anti-Cheat (EAC)',
        how: 'Launch 7 Days to Die with EAC enabled and connect via direct IP.',
        passed: 'EAC handshake passes and player enters the voxel world.',
        failed: 'EAC Disconnected or integrity kick.'
      },
      {
        title: 'Structural Integrity & Voxel Collapse',
        how: 'Destroy the bottom support pillars of a two-story building using pickaxes or explosives.',
        passed: 'Upper floors collapse into physical rubble in exact sync across clients.',
        failed: 'Blocks float in mid-air violating voxel physics.'
      },
      {
        title: 'Blood Moon 64-Zombie Horde Night',
        how: 'Trigger Day 7 Blood Moon with 64 concurrent feral zombies.',
        passed: 'Zombies pathfind dynamically toward defenses without freezing server tickrate.',
        failed: 'Ping spikes over 1,000ms or server crashes.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Binary Installation Integrity Verification',
        cmd: 'docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"',
        verify: 'buildSDTDInstallationCheck validates 7DaysToDieServer.x86_64, UnityPlayer.so, and globalgamemanagers.'
      },
      {
        title: 'Administrative Telnet Port Security',
        cmd: 'docker port <sdtd-container> | grep 26902',
        verify: 'Telnet port 26902 is secured by deriveServicePassword and restricted.'
      },
      {
        title: 'serverconfig.xml Formatting & Persistence',
        cmd: 'cat <dataPath>/serverconfig.xml',
        verify: 'XML parser preserves structure and validates custom options edited from dashboard.'
      }
    ]
  },
  {
    id: '08_valheim',
    key: 'valheim',
    emoji: '🪓',
    name_es: 'Valheim Dedicated Server',
    name_en: 'Valheim Dedicated Server',
    summary_es: 'Soporte de juego cruzado (Crossplay), deformación de terreno vóxel con azada/pico y navegación en Drakkar.',
    summary_en: 'Crossplay PC/Console support, voxel terrain deformation sync, and 3-player storm sailing physics.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor con Contraseña Válida',
        how: 'Crear servidor Valheim en el panel. Poner una contraseña de al menos 5 caracteres e iniciar.',
        passed: 'Arranca y genera el mundo vikingo en el puerto 2456.',
        failed: 'El servidor rechaza contraseñas cortas o vacías.'
      },
      {
        title: 'Conectar desde PC y Consola (Crossplay)',
        how: 'Conectar un jugador desde Steam (PC) y otro jugador desde consola o PC con juego cruzado.',
        passed: 'Ambos vikingos aparecen junto a las piedras de sacrificio.',
        failed: 'Error de versión incompatible o fallo de Crossplay.'
      },
      {
        title: 'Modificación Masiva de Terreno',
        how: 'Cavar una zanja profunda con un pico y aplanar un área grande con una azada con dos jugadores viendo.',
        passed: 'La deformación de la tierra se sincroniza al instante sin parpadeos.',
        failed: 'Un jugador ve el pozo y el otro ve la tierra sólida.'
      },
      {
        title: 'Navegación en Barco bajo Tormenta',
        how: 'Construir un Longship (barco grande), subirse 2 o 3 jugadores y navegar en mar con olas grandes.',
        passed: 'El barco navega suave, se balancea con las olas y nadie se cae al agua por lag.',
        failed: 'Los pasajeros salen disparados al océano o el barco da saltos bruscos.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Argumento de Arranque -crossplay',
        cmd: 'docker inspect <valheim-container> | grep -i "crossplay"',
        verify: 'El servidor arranca con el parámetro -crossplay activo para enrutar tráfico PlayFab/Steam.'
      },
      {
        title: 'Trío de Puertos UDP Enrutados',
        cmd: 'docker port <valheim-container>',
        verify: 'OxideProxy mapea los 3 puertos UDP consecutivos: 2456, 2457 y 2458.'
      },
      {
        title: 'Persistencia de Listas de Acceso (adminlist / bannedlist)',
        cmd: 'cat <dataPath>/adminlist.txt',
        verify: 'Los SteamIDs agregados desde el panel de administración persisten en los archivos de texto de Valheim.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Valheim Server with Valid Password',
        how: 'Deploy server with minimum 5-character password and click Start.',
        passed: 'Boots online and initializes viking world on UDP port 2456.',
        failed: 'Refuses startup if password is empty or under 5 characters.'
      },
      {
        title: 'Join from PC and Console (Crossplay)',
        how: 'Connect one PC player and one console player via server code or direct IP.',
        passed: 'Both players spawn at the sacrificial stones.',
        failed: 'Incompatible version or crossplay handshake failure.'
      },
      {
        title: 'Massive Terrain Deformation Sync',
        how: 'Dig a deep moat with a pickaxe and level ground with a hoe with 2 players watching.',
        passed: 'Voxel terrain mesh deformation syncs in real time without visual glitching.',
        failed: 'One player sees a trench while the other sees flat solid ground.'
      },
      {
        title: 'Stormy Ocean Longship Sailing',
        how: 'Build a Longship, board 3 players, and sail through rough ocean waves.',
        passed: 'Boat displacement and water physics sync smoothly; passengers remain firmly on board.',
        failed: 'Passengers get flung into open water due to position jitter.'
      }
    ],
    dev_steps_en: [
      {
        title: '-crossplay Startup Flag Verification',
        cmd: 'docker inspect <valheim-container> | grep -i "crossplay"',
        verify: 'Container initiates with -crossplay flag, activating PlayFab and Steam relay connectivity.'
      },
      {
        title: 'UDP Port Triplet Forwarding',
        cmd: 'docker port <valheim-container>',
        verify: 'OxideProxy maps the 3 consecutive UDP ports: 2456, 2457, and 2458.'
      },
      {
        title: 'Access List Persistence (adminlist / bannedlist)',
        cmd: 'cat <dataPath>/adminlist.txt',
        verify: 'Admin SteamIDs added via web UI write reliably to adminlist.txt and bannedlist.txt.'
      }
    ]
  },
  {
    id: '09_project_zomboid',
    key: 'zomboid',
    emoji: '🧟‍♂️',
    name_es: 'Project Zomboid Dedicated Server',
    name_en: 'Project Zomboid Dedicated Server',
    summary_es: 'Pruebas de viaje en carretera a 100 km/h, horda masiva con escopeta, mods de Steam Workshop a 1-clic y headroom JVM.',
    summary_en: 'Highway road trip vehicle sync, shotgun horde combat, 1-click Steam Workshop mods, and safe JVM heap.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor y Arrancar',
        how: 'Crear servidor Project Zomboid en el panel con mínimo 6GB de RAM. Iniciar.',
        passed: 'El botón se pone verde ("Online") y muestra los puertos 16261 y 16262.',
        failed: 'Se queda colgado o da error de Java.'
      },
      {
        title: 'Instalar Mod de Steam Workshop a 1-Clic',
        how: 'En la pestaña Mods, poner Workshop ID: 2688809268 y Nombre: CommonSense. Instalar y reiniciar.',
        passed: 'La web dice mod instalado y al arrancar se ve que SteamCMD lo descarga.',
        failed: 'Error al instalar o el archivo .ini se desconfigura.'
      },
      {
        title: 'Conectar dos Jugadores al Mundo',
        how: 'Abrir Project Zomboid en Steam, Unirse por IP:16261 con un amigo.',
        passed: 'Ambos aparecen en la casa de inicio, se ven caminar y pueden chatear.',
        failed: 'Error "Server not responding" o pantalla negra.'
      },
      {
        title: 'Prueba de la Autopista a 100 km/h (Test de Autos)',
        how: 'Subirse a una furgoneta (conductor y copiloto) y acelerar a fondo por la carretera durante 3 minutos.',
        passed: 'El copiloto se mantiene dentro del auto sin salir despedido y la carretera carga fluido.',
        failed: 'El copiloto se teletransporta atrás o caen al vacío negro.'
      },
      {
        title: 'Horda del Escopetazo y Registro de Golpes',
        how: 'Pegar 5 tiros de escopeta en medio del pueblo para atraer a 100 zombis y pelear cuerpo a cuerpo.',
        passed: 'Al dar un batazo el zombi retrocede de inmediato; no te muerden a distancia.',
        failed: 'Los zombis patinan o te muerden desde 3 metros.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Cálculo Seguro de Memoria JVM Headroom',
        cmd: 'docker inspect <pz-container> | grep MAX_RAM',
        verify: 'buildProjectZomboidRuntime reserva al menos 1.5GB (1536MB) para Linux y Metaspace evitando Exit Code 137.'
      },
      {
        title: 'Enrutamiento Dual UDP 16261 y 16262',
        cmd: 'docker port <pz-container>',
        verify: 'El puerto 16261 (apretón de manos) y 16262 (datos de juego) están vinculados sin colisión en OxideProxy.'
      },
      {
        title: 'Prueba de Desconexión y Reconexión Brusca',
        cmd: 'tc qdisc add dev docker0 root netem loss 10%',
        verify: 'El servidor tolera micro-cortes y limpia entidades zombi al reconectar el cliente sin duplicar inventario.'
      },
      {
        title: 'Purga Limpia al Destruir Servidor',
        cmd: 'docker ps -a | grep zomboid',
        verify: 'Al borrar el servidor se eliminan los contenedores, volúmenes de guardado y puertos sin dejar procesos huérfanos.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Server & Boot',
        how: 'Create Project Zomboid server in panel with at least 6GB RAM. Click Start.',
        passed: 'Status turns green ("Online") and displays ports 16261 and 16262.',
        failed: 'Hangs on startup or Java memory error.'
      },
      {
        title: '1-Click Steam Workshop Mod Install',
        how: 'In Mods tab, enter Workshop ID: 2688809268 and Mod Name: CommonSense. Click Install and reboot.',
        passed: 'Panel confirms install and startup log verifies SteamCMD downloading mod files.',
        failed: 'Error popup or server.ini corrupts.'
      },
      {
        title: 'Two-Player Co-op Join',
        how: 'Launch Project Zomboid on Steam, join by IP:16261 with a friend.',
        passed: 'Both spawn in starting house, see each other move, and local chat functions.',
        failed: 'Server not responding or black loading screen.'
      },
      {
        title: 'Highway 70 MPH Road Trip (Vehicle Desync)',
        how: 'Board a van (driver + passenger) and accelerate full throttle down highway for 3 minutes.',
        passed: 'Passenger remains firmly seated; road tiles render ahead without void holes.',
        failed: 'Passenger rubberbands onto asphalt or car falls through map.'
      },
      {
        title: 'Shotgun Horde Combat & Hitreg',
        how: 'Fire 5 shotgun blasts in town center to draw 100+ zombies. Fight in melee with bats.',
        passed: 'Melee swings knock zombies back instantly; zero ghost bites from distance.',
        failed: 'Zombies glide without walking animations or bite through walls.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Safe JVM Headspace Calculation',
        cmd: 'docker inspect <pz-container> | grep MAX_RAM',
        verify: 'buildProjectZomboidRuntime reserves 1.5GB (1536MB) for OS and Metaspace, avoiding OOM kill code 137.'
      },
      {
        title: 'Dual UDP Port Routing (16261 & 16262)',
        cmd: 'docker port <pz-container>',
        verify: 'Port 16261 (handshake) and 16262 (direct data) route cleanly through OxideProxy.'
      },
      {
        title: 'Abrupt Disconnect & Reconnect Recovery',
        cmd: 'tc qdisc add dev docker0 root netem loss 10%',
        verify: 'Server tolerates packet bursts, avoids duplicating player inventory on reconnect, and cleans zombie entity.'
      },
      {
        title: 'Clean Teardown & Volume Purge',
        cmd: 'docker ps -a | grep zomboid',
        verify: 'Deleting server purges Docker container, unlinks rootless volume, and leaves zero zombie processes.'
      }
    ]
  },
  {
    id: '10_discord_bot',
    key: 'discordbot',
    emoji: '🤖',
    name_es: 'Discord Bot (Node.js & Python Dual Runtime)',
    name_en: 'Discord Bot (Node.js & Python Dual Runtime)',
    summary_es: 'Instalador automático de dependencias (npm/pip), seguridad de tokens y auto-reinicio ante excepciones no controladas.',
    summary_en: 'Auto dependency installer (npm/pip), token masking, and process supervisor crash recovery.',
    gamer_steps_es: [
      {
        title: 'Subir Archivos del Bot',
        how: 'Ir al Gestor de Archivos y subir tu index.js (o main.py) con su package.json (o requirements.txt).',
        passed: 'Los archivos se suben correctamente a la raíz /data.',
        failed: 'Fallo de subida de archivo.'
      },
      {
        title: 'Instalar Dependencias a 1-Clic',
        how: 'En el panel, hacer clic en "Auto-Instalar Dependencias" (npm o pip).',
        passed: 'La consola ejecuta npm install o pip install -r requirements.txt con éxito.',
        failed: 'Error de comando o paquetes incompatibles.'
      },
      {
        title: 'Encender Bot y Verificar en Discord',
        how: 'Configurar el token del bot en las variables de entorno e iniciar el servidor.',
        passed: 'El bot aparece en verde ("Online") en tu servidor de Discord y responde a comandos.',
        failed: 'Error de token inválido o bot desconectado.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Reinicio Automático ante Excepción Fatal',
        cmd: 'docker exec -it <bot-container> kill -9 1',
        verify: 'La política restart: on-failure levanta el contenedor automáticamente en menos de 5 segundos.'
      },
      {
        title: 'Seguridad y Ocultación de Tokens en Logs',
        cmd: 'docker logs <bot-container>',
        verify: 'Los tokens de Discord no se filtran en texto plano en los registros públicos del contenedor.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Upload Bot Scripts',
        how: 'Open File Manager and upload your index.js (or main.py) along with package.json (or requirements.txt).',
        passed: 'Files upload cleanly into the root container directory.',
        failed: 'Upload error or corrupted files.'
      },
      {
        title: '1-Click Auto Dependency Install',
        how: 'Click "Auto-Install Dependencies" in panel, choosing npm or pip.',
        passed: 'Console executes npm install or pip install -r requirements.txt successfully.',
        failed: 'Command error or dependency installation failure.'
      },
      {
        title: 'Start Bot & Verify Live in Discord',
        how: 'Set DISCORD_TOKEN in environment variables and click Start.',
        passed: 'Bot icon flips to green ("Online") in your Discord guild and responds to slash commands.',
        failed: 'Invalid token error or bot stays offline.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Process Supervisor Crash Recovery',
        cmd: 'docker exec -it <bot-container> kill -9 1',
        verify: 'Docker restart policy (on-failure) revives the bot container in under 5 seconds.'
      },
      {
        title: 'Token Masking & Environment Security',
        cmd: 'docker logs <bot-container>',
        verify: 'Discord bot secrets do not leak into unauthenticated logs or error dumps.'
      }
    ]
  },
  {
    id: '11_wordpress',
    key: 'wordpress',
    emoji: '🌐',
    name_es: 'WordPress CMS & Web Hosting',
    name_en: 'WordPress CMS & Web Hosting',
    summary_es: 'Pila Apache + PHP con MariaDB dedicada, autogeneración de wp-config.php y backup atómico de archivos y SQL.',
    summary_en: 'Apache + PHP with paired MariaDB, auto wp-config.php, and atomic backup of files + mysqldump.',
    gamer_steps_es: [
      {
        title: 'Crear Servidor WordPress',
        how: 'Crear instancia de WordPress en el panel e iniciar.',
        passed: 'Se enciende y te da la URL pública del puerto web.',
        failed: 'Error de enlace con la base de datos.'
      },
      {
        title: 'Completar Asistente de Instalación',
        how: 'Abrir la URL web en el navegador, poner título al sitio y crear usuario admin.',
        passed: 'WordPress se instala sin pedirte credenciales de base de datos porque se autoconfiguraron.',
        failed: 'Error "Error establishing a database connection".'
      },
      {
        title: 'Instalar Plugin y Subir Imagen',
        how: 'Entrar al panel de WordPress (/wp-admin), subir una imagen a la biblioteca e instalar un plugin.',
        passed: 'La imagen sube y el plugin se instala sin problemas de permisos de escritura en disco.',
        failed: 'Error "No se pudo escribir en wp-content/uploads".'
      }
    ],
    dev_steps_es: [
      {
        title: 'Emparejamiento de Contenedor MariaDB Dedicado',
        cmd: 'docker ps | grep wordpress',
        verify: 'El contenedor <nombre> está emparejado con su base <nombre>-db en una red privada aislada.'
      },
      {
        title: 'Copia de Seguridad Atómica de Archivos y Dump SQL',
        cmd: 'curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"',
        verify: 'El archivo tar.gz generado contiene los archivos web y el dump mysqldump de la base de datos.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy WordPress Instance',
        how: 'Deploy WordPress in panel and click Start.',
        passed: 'Turns online and provides public HTTP web port URL.',
        failed: 'Database linkage failure.'
      },
      {
        title: 'Complete 5-Minute Install Wizard',
        how: 'Open web URL in browser, set site title, and create admin user.',
        passed: 'WordPress installs smoothly without prompting for DB credentials (auto-configured).',
        failed: 'Error establishing a database connection error.'
      },
      {
        title: 'Install Plugin & Upload Image',
        how: 'Log into /wp-admin, upload an image to media library, and install a plugin (e.g. WooCommerce).',
        passed: 'Media uploads cleanly and plugin activates without disk permission errors.',
        failed: 'Unable to create directory wp-content/uploads error.'
      }
    ],
    dev_steps_en: [
      {
        title: 'Dedicated Paired MariaDB Container',
        cmd: 'docker ps | grep wordpress',
        verify: 'App container links to dedicated <name>-db instance over private isolated bridge network.'
      },
      {
        title: 'Atomic Files + SQL Dump Backup',
        cmd: 'curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"',
        verify: 'Backup archive packages both /var/www/html files and synchronized mysqldump file.'
      }
    ]
  },
  {
    id: '12_database',
    key: 'database',
    emoji: '🗄️',
    name_es: 'Base de Datos Independiente (MariaDB / MySQL)',
    name_en: 'Standalone Database (MariaDB / MySQL)',
    summary_es: 'Instancia MariaDB dedicada con integración phpMyAdmin SSO, conexiones remotas y prueba de estrés de importación SQL.',
    summary_en: 'Dedicated MariaDB instance with phpMyAdmin SSO, remote connections, and 100MB SQL import stress test.',
    gamer_steps_es: [
      {
        title: 'Crear Base de Datos y Encender',
        how: 'Crear instancia de base de datos en el panel. Iniciar.',
        passed: 'Enciende en verde y muestra el puerto 3306 asignado.',
        failed: 'Fallo al arrancar contenedor.'
      },
      {
        title: 'Entrar a phpMyAdmin con 1-Clic',
        how: 'Hacer clic en el botón "Abrir phpMyAdmin" en el panel.',
        passed: 'Abre la interfaz de phpMyAdmin con la sesión iniciada automáticamente.',
        failed: 'Pide usuario y contraseña o da error de autenticación.'
      },
      {
        title: 'Crear Tabla y Hacer Consulta',
        how: 'En phpMyAdmin, crear una tabla de prueba con 2 columnas e insertar un registro.',
        passed: 'La tabla se crea y la consulta SELECT muestra los datos.',
        failed: 'Error de sintaxis o permiso denegado.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Conexión Externa Remota con Cliente SQL',
        cmd: 'mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p',
        verify: 'Permite autenticar desde DBeaver/HeidiSQL fuera del host con soporte TLS.'
      },
      {
        title: 'Prueba de Estrés con Dump SQL de 100MB',
        cmd: 'mysql -h localhost -P <port> -u root -p < big_dump.sql',
        verify: 'La importación se completa a velocidad máxima sin agotar el buffer de memoria del contenedor.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Deploy Database Instance',
        how: 'Create database instance in panel and click Start.',
        passed: 'Status turns green and displays mapped MySQL port 3306.',
        failed: 'Container startup failure.'
      },
      {
        title: 'Open phpMyAdmin with 1-Click SSO',
        how: 'Click "Open phpMyAdmin" button in panel.',
        passed: 'phpMyAdmin loads with session pre-authenticated into user database.',
        failed: 'Prompts for credentials or access denied.'
      },
      {
        title: 'Create Table & Run Query',
        how: 'Inside phpMyAdmin, create test table with 2 columns and insert 1 row.',
        passed: 'Table creates and SELECT query displays record cleanly.',
        failed: 'Permission denied error.'
      }
    ],
    dev_steps_en: [
      {
        title: 'External Remote Client Connection',
        cmd: 'mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p',
        verify: 'Allows remote TCP connection from external tools (DBeaver, HeidiSQL) with TLS encryption.'
      },
      {
        title: '100MB SQL Dump Import Stress Test',
        cmd: 'mysql -h localhost -P <port> -u root -p < big_dump.sql',
        verify: 'Bulk insertion executes without exhausting innodb_buffer_pool memory.'
      }
    ]
  },
  {
    id: '13_chaos_network',
    key: 'chaos',
    emoji: '⚡',
    name_es: 'Matriz de Red Adversa y Pruebas de Caos',
    name_en: 'Adverse Network & Chaos Netcode Testing',
    summary_es: 'Inyección de latencia (200ms), pérdida de paquetes (5-20%), jitter y recuperación ante caídas forzadas de sockets.',
    summary_en: 'Latency injection (200ms), packet loss (5-20%), jitter, and socket crash recovery.',
    gamer_steps_es: [
      {
        title: 'Jugar bajo 150ms de Latencia (Ping Alto)',
        how: 'Conectarse a un servidor con conexión degradada (Wi-Fi lejano o herramienta Clumsy a 150ms).',
        passed: 'El juego se siente jugable; el movimiento es fluido y no hay teletransportes bruscos.',
        failed: 'El jugador se queda congelado o es expulsado por timeout.'
      },
      {
        title: 'Desconexión y Reconexión Rápida',
        how: 'Desconectar el cable de red o Wi-Fi durante 15 segundos y volverlo a conectar.',
        passed: 'El cliente se reconecta a la partida en el mismo lugar sin perder inventario.',
        failed: 'El servidor duplica tu personaje (personaje zombi) o pierdes tu progreso.'
      }
    ],
    dev_steps_es: [
      {
        title: 'Inyección de Latencia de 200ms con tc-netem',
        cmd: 'tc qdisc add dev docker0 root netem delay 200ms 20ms',
        verify: 'El proxy OxideProxy y los sockets UDP de juego mantienen la sincronización sin pausas de simulación.'
      },
      {
        title: 'Inyección de Pérdida de Paquetes (5% y ráfagas del 20%)',
        cmd: 'tc qdisc change dev docker0 root netem loss 5%',
        verify: 'El protocolo de reconciliación reenvía los inputs no confirmados sin crashear el servidor.'
      },
      {
        title: 'Reordenamiento de Paquetes (Jitter y Out-of-Order)',
        cmd: 'tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%',
        verify: 'Los paquetes UDP desordenados son procesados correctamente por la capa de transporte del juego.'
      },
      {
        title: 'Estrangulamiento de Ancho de Banda a 64 kbps',
        cmd: 'tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms',
        verify: 'El sistema de culling por distancia prioriza entidades cercanas y descarta entidades lejanas sin congelar el juego.'
      },
      {
        title: 'Matanza Abrupta de Contenedor (SIGKILL)',
        cmd: 'docker kill <container-name>',
        verify: 'Docker reinicia el contenedor (on-failure) y el Hub de logs reconecta el flujo SSE sin intervención manual.'
      }
    ],
    gamer_steps_en: [
      {
        title: 'Play under 150ms Latency (High Ping)',
        how: 'Connect to game server under simulated high latency (e.g. Clumsy set to 150ms).',
        passed: 'Gameplay remains smooth; client-side prediction masks delay without rubberbanding.',
        failed: 'Player freezes or gets disconnected by timeout.'
      },
      {
        title: 'Rapid Disconnect & Reconnect Recovery',
        how: 'Disconnect network/Wi-Fi for 15 seconds, then plug back in.',
        passed: 'Player reconnects into the active session at the exact same location with inventory intact.',
        failed: 'Server spawns a duplicate zombie entity or resets progress.'
      }
    ],
    dev_steps_en: [
      {
        title: '200ms Latency Injection with tc-netem',
        cmd: 'tc qdisc add dev docker0 root netem delay 200ms 20ms',
        verify: 'OxideProxy and game UDP sockets maintain sync without simulation stalls.'
      },
      {
        title: 'Packet Loss Injection (5% & 20% bursts)',
        cmd: 'tc qdisc change dev docker0 root netem loss 5%',
        verify: 'Input replay reconciles state drift without server crash.'
      },
      {
        title: 'Packet Reordering (Jitter & Out-of-Order)',
        cmd: 'tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%',
        verify: 'Out-of-order UDP datagrams are reassembled without transport deadlock.'
      },
      {
        title: 'Bandwidth Throttling to 64 kbps',
        cmd: 'tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms',
        verify: 'Distance relevancy culling drops non-essential entities while keeping player movement active.'
      },
      {
        title: 'Abrupt Container Termination (SIGKILL)',
        cmd: 'docker kill <container-name>',
        verify: 'Docker restart policy revives container and LogHub reconnects SSE stream automatically.'
      }
    ]
  }
];

function makeGitLabIssueUrl(title, labels, markdownBody) {
  const baseUrl = 'https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new';
  const params = new URLSearchParams();
  params.set('issue[title]', title);
  params.set('issue[labels]', labels.join(','));
  params.set('issue[description]', markdownBody);
  return `${baseUrl}?${params.toString()}`;
}

const qaStatePath = path.join(ROOT_DIR, 'docs', 'qa', 'qa_state.json');
let qaState = null;
try {
  qaState = JSON.parse(await fs.readFile(qaStatePath, 'utf8'));
} catch (e) {
  console.warn('[generate_qa_docs] Could not load qa_state.json:', e.message);
}

console.log('Generating bilingual playbooks and GitLab issue templates with 1-click issue links...');

for (const g of GAMES_DATA) {
  // 3. GitLab Issue Template (Spanish)
  let tmplEs = `## ${g.emoji} Certificación QA: ${g.name_es}\n\n`;
  tmplEs += `> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de ${g.name_es}](docs/qa/playbooks/es/${g.id}.md).\n\n`;
  tmplEs += `### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)\n`;
  tmplEs += `*Marca las casillas conforme vayas jugando y probando cada función:*\n\n`;
  g.gamer_steps_es.forEach((s, idx) => {
    tmplEs += `- [ ] **Paso ${idx + 1}: ${s.title}** (Ver guía: \`${s.passed}\`)\n`;
  });
  tmplEs += `\n> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  \n`;
  tmplEs += `> \`@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.\`\n\n`;
  tmplEs += `### ⚙️ Parte 2: Pruebas Técnicas (Programadores)\n`;
  tmplEs += `*Comandos de terminal para el equipo de desarrollo:*\n\n`;
  g.dev_steps_es.forEach((s, idx) => {
    tmplEs += `- [ ] **TC-DEV-${idx + 1}: ${s.title}** (\`${s.cmd}\`)\n`;
  });
  tmplEs += `\n/label ~"qa::in-progress" ~"game::${g.key}"\n`;
  await fs.writeFile(path.join(GITLAB_TEMPLATES_DIR, `[ES]_${g.id}.md`), tmplEs, 'utf8');

  // 4. GitLab Issue Template (English)
  let tmplEn = `## ${g.emoji} QA Certification: ${g.name_en}\n\n`;
  tmplEn += `> 📖 **Full step-by-step testing guide**: See the [${g.name_en} Testing Playbook](docs/qa/playbooks/en/${g.id}.md).\n\n`;
  tmplEn += `### 🎮 Part 1: Gamer Tests (QA Tester)\n`;
  tmplEn += `*Check off the boxes as you complete your gameplay session:*\n\n`;
  g.gamer_steps_en.forEach((s, idx) => {
    tmplEn += `- [ ] **Step ${idx + 1}: ${s.title}** (Pass rule: \`${s.passed}\`)\n`;
  });
  tmplEn += `\n> 💬 **Finished gamer testing?** Leave a comment tagging the developers:  \n`;
  tmplEn += `> \`@devs Finished gameplay tests successfully. Ready for tech review.\`\n\n`;
  tmplEn += `### ⚙️ Part 2: Technical Engine Tests (Developers)\n`;
  tmplEn += `*Terminal commands for development team:*\n\n`;
  g.dev_steps_en.forEach((s, idx) => {
    tmplEn += `- [ ] **TC-DEV-${idx + 1}: ${s.title}** (\`${s.cmd}\`)\n`;
  });
  tmplEn += `\n/label ~"qa::in-progress" ~"game::${g.key}"\n`;
  await fs.writeFile(path.join(GITLAB_TEMPLATES_DIR, `[EN]_${g.id}.md`), tmplEn, 'utf8');

  // Generate 1-click issue URLs
  const issueUrlEs = makeGitLabIssueUrl(`[QA-ES] ${g.emoji} ${g.name_es}`, ['qa::in-progress', `game::${g.key}`], tmplEs);
  const issueUrlEn = makeGitLabIssueUrl(`[QA-EN] ${g.emoji} ${g.name_en}`, ['qa::in-progress', `game::${g.key}`], tmplEn);

  if (qaState) {
    if (g.key === 'roadmap') {
      qaState.roadmap.new_issue_url_es = issueUrlEs;
      qaState.roadmap.new_issue_url_en = issueUrlEn;
    } else {
      const stateGame = qaState.games.find(sg => sg.id === g.key);
      if (stateGame) {
        stateGame.new_issue_url_es = issueUrlEs;
        stateGame.new_issue_url_en = issueUrlEn;
      }
    }
  }

  // 1. Spanish Playbook
  let pbEs = `# ${g.emoji} Guía de Pruebas: ${g.name_es}\n\n`;
  pbEs += `> **Objetivo**: ${g.summary_es}\n\n`;
  pbEs += `👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](${issueUrlEs})**\n\n`;
  pbEs += `--- \n\n`;
  pbEs += `## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)\n\n`;
  pbEs += `*Instrucciones simples para jugar y probar el servidor como un usuario real.*\n\n`;
  g.gamer_steps_es.forEach((s, idx) => {
    pbEs += `### Paso ${idx + 1}: ${s.title} 🎮\n`;
    pbEs += `- **Qué hacer**: ${s.how}\n`;
    pbEs += `- ✅ **PASÓ SI**: ${s.passed}\n`;
    pbEs += `- ❌ **FALLÓ SI**: ${s.failed}\n\n`;
  });
  pbEs += `--- \n\n`;
  pbEs += `## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)\n\n`;
  pbEs += `*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*\n\n`;
  g.dev_steps_es.forEach((s, idx) => {
    pbEs += `### Verificación Técnica ${idx + 1}: ${s.title} ⚙️\n`;
    pbEs += `- **Comando / Acción**: \`${s.cmd}\`\n`;
    pbEs += `- **Criterio de Aprobación**: ${s.verify}\n\n`;
  });
  await fs.writeFile(path.join(PLAYBOOKS_ES_DIR, `${g.id}.md`), pbEs, 'utf8');

  // 2. English Playbook
  let pbEn = `# ${g.emoji} QA Testing Playbook: ${g.name_en}\n\n`;
  pbEn += `> **Objective**: ${g.summary_en}\n\n`;
  pbEn += `👉 **[🚀 Launch Test Issue in GitLab (1-Click Pre-filled)](${issueUrlEn})**\n\n`;
  pbEn += `--- \n\n`;
  pbEn += `## 🎮 PART 1: Gamer & Gameplay Tests (For QA Tester)\n\n`;
  pbEn += `*Straightforward instructions to play and stress-test the server like a real customer.*\n\n`;
  g.gamer_steps_en.forEach((s, idx) => {
    pbEn += `### Step ${idx + 1}: ${s.title} 🎮\n`;
    pbEn += `- **What to do**: ${s.how}\n`;
    pbEn += `- ✅ **PASSED IF**: ${s.passed}\n`;
    pbEn += `- ❌ **FAILED IF**: ${s.failed}\n\n`;
  });
  pbEn += `--- \n\n`;
  pbEn += `## ⚙️ PART 2: Technical Engine Tests (For Developers)\n\n`;
  pbEn += `*Terminal commands and Docker inspection verified by developers in 3 minutes.*\n\n`;
  g.dev_steps_en.forEach((s, idx) => {
    pbEn += `### Tech Check ${idx + 1}: ${s.title} ⚙️\n`;
    pbEn += `- **Command / Action**: \`${s.cmd}\`\n`;
    pbEn += `- **Pass Criteria**: ${s.verify}\n\n`;
  });
  await fs.writeFile(path.join(PLAYBOOKS_EN_DIR, `${g.id}.md`), pbEn, 'utf8');
}

if (qaState) {
  qaState.updated_at = new Date().toISOString();
  await fs.writeFile(qaStatePath, JSON.stringify(qaState, null, 2), 'utf8');
  console.log('✅ Updated qa_state.json with 1-click issue URLs.');
}

console.log('✅ Successfully generated all 14 Spanish Playbooks, 14 English Playbooks, and 28 GitLab Issue Templates with 1-click links!');

