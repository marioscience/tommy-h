## 🧟 Certificación QA: 7 Days to Die (The Fun Pimps)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de 7 Days to Die (The Fun Pimps)](docs/qa/playbooks/es/07_sdtd.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor de 7 Days to Die** (Ver guía: `Arranca y expone el puerto 26900 UDP y 26902 TCP.`)
- [ ] **Paso 2: Conectar desde el Juego con EAC Activo** (Ver guía: `Pasa la verificación de EAC y apareces en el mundo vóxel.`)
- [ ] **Paso 3: Prueba de Colapso Físico Estructural** (Ver guía: `El techo y los pisos superiores colapsan en escombros físicos de forma idéntica para todos los jugadores.`)
- [ ] **Paso 4: Horda de Luna de Sangre (Blood Moon)** (Ver guía: `Los zombis corren hacia los jugadores calculando rutas sin congelar el servidor.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Verificación de Integridad de Binarios** (`docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"`)
- [ ] **TC-DEV-2: Aislamiento del Puerto Telnet Administrativo** (`docker port <sdtd-container> | grep 26902`)
- [ ] **TC-DEV-3: Persistencia en serverconfig.xml** (`cat <dataPath>/serverconfig.xml`)

/label ~"qa::in-progress" ~"game::sdtd"
