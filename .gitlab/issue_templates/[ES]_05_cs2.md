## 🔫 Certificación QA: Counter-Strike 2 (Source 2)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Counter-Strike 2 (Source 2)](docs/qa/playbooks/es/05_cs2.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor y Añadir Token GSLT** (Ver guía: `El servidor arranca y muestra el puerto 27015.`)
- [ ] **Paso 2: Conectar por Consola de Desarrollador** (Ver guía: `Carga el mapa (ejemplo: de_dust2 o de_mirage) y entras a elegir bando (CT o T).`)
- [ ] **Paso 3: Prueba de Humo Volumétrico y Granadas** (Ver guía: `La nube de humo volumétrica tiene la misma forma exacta y se disipa al mismo segundo en ambas pantallas.`)
- [ ] **Paso 4: Consola Matchpad Competitiva** (Ver guía: `En el juego se reinicia la partida al instante o cambia de mapa.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Normalizador de Permisos Rootless Helper** (`docker inspect <cs2-container>`)
- [ ] **TC-DEV-2: Precisión Sub-Tick y Socket UDP 27015** (`docker logs <cs2-container> | grep -i "tick"`)
- [ ] **TC-DEV-3: Editor Visual de server.cfg** (`cat <dataPath>/game/csgo/cfg/server.cfg`)

/label ~"qa::in-progress" ~"game::cs2"
