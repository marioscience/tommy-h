## 🧟‍♂️ Certificación QA: Project Zomboid Dedicated Server

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Project Zomboid Dedicated Server](docs/qa/playbooks/es/09_project_zomboid.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor y Arrancar** (Ver guía: `El botón se pone verde ("Online") y muestra los puertos 16261 y 16262.`)
- [ ] **Paso 2: Instalar Mod de Steam Workshop a 1-Clic** (Ver guía: `La web dice mod instalado y al arrancar se ve que SteamCMD lo descarga.`)
- [ ] **Paso 3: Conectar dos Jugadores al Mundo** (Ver guía: `Ambos aparecen en la casa de inicio, se ven caminar y pueden chatear.`)
- [ ] **Paso 4: Prueba de la Autopista a 100 km/h (Test de Autos)** (Ver guía: `El copiloto se mantiene dentro del auto sin salir despedido y la carretera carga fluido.`)
- [ ] **Paso 5: Horda del Escopetazo y Registro de Golpes** (Ver guía: `Al dar un batazo el zombi retrocede de inmediato; no te muerden a distancia.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Cálculo Seguro de Memoria JVM Headroom** (`docker inspect <pz-container> | grep MAX_RAM`)
- [ ] **TC-DEV-2: Enrutamiento Dual UDP 16261 y 16262** (`docker port <pz-container>`)
- [ ] **TC-DEV-3: Prueba de Desconexión y Reconexión Brusca** (`tc qdisc add dev docker0 root netem loss 10%`)
- [ ] **TC-DEV-4: Purga Limpia al Destruir Servidor** (`docker ps -a | grep zomboid`)

/label ~"qa::in-progress" ~"game::zomboid"
