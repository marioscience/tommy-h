## ☢️ Certificación QA: Rust Dedicated Server

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Rust Dedicated Server](docs/qa/playbooks/es/03_rust.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor de Rust y Encender** (Ver guía: `Enciende en verde y en la consola ves que descarga el mapa procedural.`)
- [ ] **Paso 2: Conectar desde la Consola de Rust** (Ver guía: `Descarga el mapa procedural y apareces en la playa despierto.`)
- [ ] **Paso 3: Prueba de Balística y Registro de Disparos** (Ver guía: `Escuchas el sonido de impacto (hitmarker). Al escribir combatlog en consola F1, registra los impactos con daño real.`)
- [ ] **Paso 4: Instalación y Recarga en Caliente de Plugin uMod** (Ver guía: `El plugin se descarga en /oxide/plugins y se compila solo sin tener que reiniciar el servidor.`)
- [ ] **Paso 5: Probar el Botón de Wipe de Mapa** (Ver guía: `El servidor borra los archivos .map y .sav pero conserva los planos (blueprints) de los jugadores.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Enrutamiento Triple de Puertos L4** (`docker port <rust-container>`)
- [ ] **TC-DEV-2: Tickrate de Servidor y Pausas de Garbage Collection** (`docker exec -it <rust-container> rcon "serverinfo"`)
- [ ] **TC-DEV-3: Monitor de Killfeed y Chat vía API** (`curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"`)
- [ ] **TC-DEV-4: Aislamiento de Identidad de Servidor** (`ls -la <dataPath>/server/ragenodes`)

/label ~"qa::in-progress" ~"game::rust"
