# Desarrollo local rápido (Linux, WSL2 y Dev Container)

Requisitos: Git, Node.js 24 y Docker con Compose v2. En Windows ejecuta los comandos
dentro de WSL2 y guarda el repositorio en el filesystem Linux (`~/proyectos`),
o abre el Dev Container. Docker Desktop debe tener integración con tu WSL activa.
En Linux tu usuario debe poder ejecutar `docker info`.

En Ubuntu Server 24.04 LTS recién instalado, esta preparación cubre las
dependencias del flujo ligero:

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo snap install node --classic --channel=24
sudo usermod -aG docker "$USER"
```

Cierra la sesión y vuelve a entrar después de añadir el grupo `docker`; confirma
`node --version`, `docker info` y `docker compose version`. En WSL2 utiliza el
Docker Desktop del equipo con su integración WSL activada. Si usas Dev Container,
esas herramientas vienen dentro del contenedor y no necesitas instalarlas en el
sistema anfitrión.

```bash
git clone git@gitlab.com:mariomatos/ragenodesultimate.git
cd ragenodesultimate
git switch dev
bash dev setup
bash dev doctor
bash dev up frontend
```

También puedes ejecutar `./dev`. En Windows con Node instalado se admite
`node scripts/dev/cli.mjs help`; para el Dev Container usa **Reopen in Container**.

El acelerador N-API de backups, hashes y validación es opcional. La aplicación
mantiene fallbacks portables si el artefacto Linux/musl no está disponible, por
lo que no es necesario compilar Rust para trabajar en frontend o en rutas HTTP.
Las instrucciones reproducibles y los perfiles están en
[`benchmarks/rust-runtime/README.md`](../benchmarks/rust-runtime/README.md).
La primera descarga/construcción depende de la conexión y CPU. Los siguientes
arranques reutilizan imágenes y datos. No hace falta iniciar sesión en un registry
para construir imágenes internas desde este repositorio.

## Elegir qué ejecutar

| Comando | Qué inicia | URL predeterminada |
| --- | --- | --- |
| `./dev up frontend` | HTML/JS actuales + API simulada, sin BD ni juegos | `http://localhost:18088/panel` |
| `./dev up backend` o `./dev up core` | Backend real, PostgreSQL, MariaDB y Redis; sirve también frontend | `http://localhost:13010/login` |
| `./dev up data` | Solo las tres bases de datos/servicios de datos | Sin puertos públicos |
| `./dev up proxy` | OxideProxy compilado desde código y backend real con BD | `http://localhost:18089` |

El frontend actual es HTML/JavaScript: editar `frontend/public` y refrescar basta.
No se presupone React/Vite ni se modifica la rama de frontend de otros autores.
El backend usa `node --watch`: editar `backend/src` reinicia el proceso. Cambiar
dependencias requiere repetir `./dev up backend` para reconstruir. Cambiar Rust
requiere repetir `./dev up proxy`; el perfil prueba HTTP, no XDP/NIC reales.

`setup` genera `.env.development` con secretos aleatorios exclusivos de esa copia
del repositorio y conserva el archivo si ya existe. No modifica `.env`, no necesita
credenciales compartidas y no toma valores de staging o producción. El proyecto
Compose recibe un nombre local único (`DEV_PROJECT_NAME`) y usa red y volúmenes
propios, por lo que dos clones en el mismo equipo no comparten bases de datos y
`up` o `down` no afectan otros proyectos Docker. Las instalaciones creadas con una
versión anterior que no tengan esa variable siguen usando `ragenodes-dev` para
conservar sus datos. Se puede establecer `RAGENODES_DEV_PROJECT` solo cuando sea
necesario seleccionar explícitamente otra instancia.

Los puertos se publican únicamente en `127.0.0.1`: cuando el desarrollador trabaja
en el mismo equipo, abre directamente la URL que muestra `./dev status`. No debe
copiar nombres de host, usuarios, direcciones IP ni rutas de otro desarrollador.

### Acceso remoto opcional

Esta sección solo aplica cuando Docker se ejecuta en otro equipo. Crea un túnel SSH
reemplazando los marcadores por los datos de tu propio entorno:

```bash
ssh -L <puerto-local>:127.0.0.1:<puerto-remoto> <usuario>@<host-remoto>
```

Por ejemplo, para el frontend con su puerto predeterminado:

```bash
ssh -L 18088:127.0.0.1:18088 developer@dev-host
```

Después abre `http://localhost:18088/panel` en el equipo desde el que creaste el
túnel. El nombre `developer@dev-host` es deliberadamente ficticio. Si cambiaste
`DEV_FRONTEND_PORT` en `.env.development`, usa ese mismo valor a ambos lados del
túnel. Backend y proxy siguen el mismo patrón con `DEV_BACKEND_PORT` y
`DEV_PROXY_PORT`. No expongas estos puertos en `0.0.0.0` para evitar el túnel.

El backend ejecuta sus migraciones/arranque habitual y crea el administrador
`admin` con `DEV_ADMIN_PASSWORD` del archivo local. `./dev credentials` indica
dónde consultarla. Nunca copies credenciales de producción. Cambiar la contraseña
del archivo no implica cambiar una cuenta ya existente en la BD.

## Comprobación reproducible de una instalación nueva

Ejecuta esto desde una copia recién clonada, sin reutilizar `.env.development` de
otro equipo:

```bash
./dev setup
./dev doctor
./dev up frontend
./dev status
curl --fail http://127.0.0.1:18088/healthz
./dev scenario minecraft-running
./dev down
```

El resultado esperado es un diagnóstico válido, el servicio `frontend` saludable,
una respuesta HTTP satisfactoria y el escenario confirmado. `down` detiene esa
instancia y conserva sus volúmenes. Si personalizaste `DEV_FRONTEND_PORT`, reemplaza
`18088` en la prueba. Luego inicia solamente el componente en el que vas a trabajar.

## Escenarios de interfaz sin recursos reales

```bash
./dev scenario minecraft-running
./dev scenario node-full
./dev scenario node-offline
./dev scenario backup-failed
```

Estos escenarios requieren `frontend` iniciado. El banner y la cabecera
`X-RageNodes-Simulation: true` identifican el simulador. Incluye identidad ficticia,
listado/detalle de un servidor, inicio/parada simulados, consola SSE, listas vacías
de métricas/backups y errores de creación por capacidad y backup fallido. No
aprovisiona contenedores, ni crea backups, ni valida DNS, SSL, pagos o FiveM OAuth.
Las rutas no cubiertas devuelven **501** explícito: al desarrollar otra pantalla
añade su fixture con la forma de respuesta de la ruta real y prueba ambas.
La simulación se reinicia al reiniciar su proceso.

## Logs y diagnóstico

```bash
./dev logs backend
./dev logs frontend
./dev logs proxy
./dev logs all
./dev status
./dev doctor
./dev stop frontend
./dev down
```

`logs` sigue las últimas 100 líneas (Ctrl+C sale sin detener servicios). El backend
conserva sus logs de solicitudes; el simulador emite `X-Request-ID` para relacionar
Network del navegador con sus logs. `doctor` comprueba Docker/Compose, memoria/CPU
del daemon, configuración y contenedores. Si el arranque falla consulta el log
del servicio; no elimina datos ni intenta reparar automáticamente el sistema.

- **Node no encontrado:** instala Node 24 o usa el Dev Container.
- **Docker inaccesible:** inicia Docker y verifica `docker info` y su contexto.
- **Puerto ocupado:** cambia `DEV_FRONTEND_PORT`, `DEV_BACKEND_PORT` o
  `DEV_PROXY_PORT` en `.env.development`, luego repite `up`.
- **Pull access denied de ragenodes/oxideproxy:** usa `./dev up proxy`, que construye
  desde código. No uses `--pull always` sobre las imágenes internas del stack completo.
- **Dependencias lentas:** deja terminar el primer build; los cambios de código no
  necesitan volver a instalar dependencias.
- **No hay recursos para un juego:** los perfiles ligeros no tienen acceso al daemon
  de juegos. Para integración real utiliza el flujo completo de README. La memoria
  disponible del daemon puede ser menor que la RAM física y debe cubrir las reservas
  de todos los servicios; no desactives los límites de producción para desarrollar.

`down` conserva las bases de datos. No hay borrado automático ni `reset` destructivo.
Para pruebas con juegos reales, workers, DNS o certificados usa el stack completo
documentado en README con `.env.local.example`, directorios y socket locales.
El entorno ligero no cambia esas configuraciones ni instala un nodo real simulado
en la base de datos de la aplicación.

## Dev Container y contribuciones

El Dev Container instala dependencias bloqueadas y herramientas de desarrollo;
no inicia servicios automáticamente. eBPF es optativo:
`bash .devcontainer/setup-ebpf.sh` solo si vas a trabajar en esa parte.
Docker-in-Docker sigue siendo privilegiado y aislado del daemon del host.
Los puertos 13010/18088/18089 están reenviados al editor.

Antes de contribuir: actualiza `origin/dev`, crea tu rama desde esa referencia,
ejecuta las pruebas del componente y abre MR hacia `dev`. Sigue el proceso de
promoción del README; los comandos `./dev` nunca despliegan staging o producción.
Una simulación aprobada no sustituye la validación real en staging.
