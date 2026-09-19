## ⛏️ Certificación QA: Minecraft (Paper, Fabric, Forge, Purpur, Vanilla)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Minecraft (Paper, Fabric, Forge, Purpur, Vanilla)](docs/qa/playbooks/es/02_minecraft.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor y Elegir Versión** (Ver guía: `El servidor enciende, acepta el EULA automáticamente y muestra el puerto 25565.`)
- [ ] **Paso 2: Instalar Plugin con 1-Clic** (Ver guía: `El archivo .jar aparece en la carpeta /plugins/ y los comandos del plugin funcionan en el juego.`)
- [ ] **Paso 3: Conectar al Servidor desde Minecraft** (Ver guía: `Entras al mundo al instante con ping bajo y sin mensajes de error de autenticación.`)
- [ ] **Paso 4: Vuelo a Toda Velocidad en Espectador (Test de Chunks)** (Ver guía: `El terreno carga delante de ti. Al escribir /tps en la consola, se mantiene entre 19.8 y 20.0 TPS.`)
- [ ] **Paso 5: Prueba de Bloques Fantasma (Ghost Blocks)** (Ver guía: `Todos los bloques se rompen de forma fluida y dan el item. Ningún bloque roto vuelve a aparecer mágicamente.`)
- [ ] **Paso 6: Editor Visual de server.properties** (Ver guía: `Los cambios se reflejan en el archivo server.properties y aplican tras reiniciar.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Resolución Dinámica de Imagen OpenJDK** (`docker inspect <mc-container> | grep -i "image"`)
- [ ] **TC-DEV-2: Cálculo Seguro de Memoria JVM Headroom** (`docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"`)
- [ ] **TC-DEV-3: Bloqueo de Identidad de Mundo** (`cat <dataPath>/.ragenodes-minecraft-identity.json`)

/label ~"qa::in-progress" ~"game::minecraft"
