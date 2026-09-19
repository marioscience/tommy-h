## 🚗 Certificación QA: FiveM (Grand Theft Auto V Roleplay)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de FiveM (Grand Theft Auto V Roleplay)](docs/qa/playbooks/es/01_fivem.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear y Arrancar Servidor FiveM** (Ver guía: `El botón se pone verde, muestra la IP pública y el puerto txAdmin.`)
- [ ] **Paso 2: Entrar a txAdmin por Web** (Ver guía: `Abre la interfaz de txAdmin bajo HTTPS sin advertencias de certificado y te deja iniciar sesión.`)
- [ ] **Paso 3: Conectar al Servidor desde el Juego** (Ver guía: `Ambos cargan el mapa de Los Santos, se ven caminar y se escuchan por voz de proximidad.`)
- [ ] **Paso 4: Prueba de Conducción a 200 km/h** (Ver guía: `El copiloto se mantiene dentro del auto sin salir despedido y las texturas cargan fluido.`)
- [ ] **Paso 5: Probar el Editor 3D Blender WebTop** (Ver guía: `Abre una ventana de Blender en el navegador lista para editar modelos 3D (.ydr / .yft).`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Offset de Puertos y Enrutamiento OxideProxy L4** (`docker port <fivem-container>`)
- [ ] **TC-DEV-2: Aislamiento de Base de Datos MariaDB** (`docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR '<db_user>'@'%';"`)
- [ ] **TC-DEV-3: Heartbeat y Auto-Apagado de Blender WebTop** (`docker ps | grep blender`)
- [ ] **TC-DEV-4: Registro de Disparos bajo Latencia Simulada** (`tc qdisc add dev docker0 root netem delay 120ms`)

/label ~"qa::in-progress" ~"game::fivem"
