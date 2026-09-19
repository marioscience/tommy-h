## 🪓 Certificación QA: Valheim Dedicated Server

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Valheim Dedicated Server](docs/qa/playbooks/es/08_valheim.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor con Contraseña Válida** (Ver guía: `Arranca y genera el mundo vikingo en el puerto 2456.`)
- [ ] **Paso 2: Conectar desde PC y Consola (Crossplay)** (Ver guía: `Ambos vikingos aparecen junto a las piedras de sacrificio.`)
- [ ] **Paso 3: Modificación Masiva de Terreno** (Ver guía: `La deformación de la tierra se sincroniza al instante sin parpadeos.`)
- [ ] **Paso 4: Navegación en Barco bajo Tormenta** (Ver guía: `El barco navega suave, se balancea con las olas y nadie se cae al agua por lag.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Argumento de Arranque -crossplay** (`docker inspect <valheim-container> | grep -i "crossplay"`)
- [ ] **TC-DEV-2: Trío de Puertos UDP Enrutados** (`docker port <valheim-container>`)
- [ ] **TC-DEV-3: Persistencia de Listas de Acceso (adminlist / bannedlist)** (`cat <dataPath>/adminlist.txt`)

/label ~"qa::in-progress" ~"game::valheim"
