## 🥚 Certificación QA: Palworld Dedicated Server

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Palworld Dedicated Server](docs/qa/playbooks/es/04_palworld.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor de Palworld** (Ver guía: `Enciende en verde y expone el puerto UDP 8211.`)
- [ ] **Paso 2: Conectar por IP Directa en el Juego** (Ver guía: `Carga la pantalla de creación de personaje y entras al mundo.`)
- [ ] **Paso 3: Capturar Pals y Pelear en Equipo** (Ver guía: `El porcentaje de captura se ve idéntico para ambos jugadores y el Pal capturado obedece órdenes.`)
- [ ] **Paso 4: Automatización de Base y Retención de Chunks** (Ver guía: `Al volver, los Pals siguen trabajando y la piedra acumulada está en los cofres.`)
- [ ] **Paso 5: Visor de Gremios (Guilds) en el Panel** (Ver guía: `Muestra el nombre de tu gremio, lista de miembros y coordenadas de la base.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Permisos de Usuario Rootless en Contenedor** (`ls -ld <dataPath>`)
- [ ] **TC-DEV-2: Soak Test de Memoria Unreal Engine (4 Horas)** (`docker stats <palworld-container> --no-stream`)
- [ ] **TC-DEV-3: Comandos RCON de Gestión Administrativa** (`curl -X POST http://localhost:3000/api/rcon/<id>/command -d '{"command":"Broadcast Hola"}' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::palworld"
