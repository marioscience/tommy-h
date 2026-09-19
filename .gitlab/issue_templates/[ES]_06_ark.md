## 🦖 Certificación QA: ARK: Survival Ascended / Evolved

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de ARK: Survival Ascended / Evolved](docs/qa/playbooks/es/06_ark.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor ARK** (Ver guía: `Arranca y genera el mundo TheIsland_WP.`)
- [ ] **Paso 2: Conectar al Servidor en el Juego** (Ver guía: `Descarga los datos y apareces en la playa para crear superviviente.`)
- [ ] **Paso 3: Montar Dinosaurio y Talar Árboles** (Ver guía: `El dinosaurio se mueve suave y los árboles caen al mismo tiempo para todos los jugadores.`)
- [ ] **Paso 4: Transferencia por Obelisco en Clúster** (Ver guía: `El dinosaurio aparece en el segundo servidor con sus estadísticas e inventario intactos.`)
- [ ] **Paso 5: Forzar Actualización de Versión de ARK** (Ver guía: `El servidor borra el manifest de Steam y SteamCMD descarga la última versión al reiniciar.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Capacidades Elevadas de Proton/Wine** (`docker inspect <ark-container> | grep -A 10 "CapAdd"`)
- [ ] **TC-DEV-2: Montaje de Clúster Compartido Cross-ARK** (`docker inspect <ark-container> | grep -i "cluster"`)
- [ ] **TC-DEV-3: Borrado Atómico de appmanifest_2430930.acf** (`ls -la <dataPath>/steamapps/`)

/label ~"qa::in-progress" ~"game::ark"
