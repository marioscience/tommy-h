## ⚡ Certificación QA: Matriz de Red Adversa y Pruebas de Caos

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Matriz de Red Adversa y Pruebas de Caos](docs/qa/playbooks/es/13_chaos_network.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Jugar bajo 150ms de Latencia (Ping Alto)** (Ver guía: `El juego se siente jugable; el movimiento es fluido y no hay teletransportes bruscos.`)
- [ ] **Paso 2: Desconexión y Reconexión Rápida** (Ver guía: `El cliente se reconecta a la partida en el mismo lugar sin perder inventario.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Inyección de Latencia de 200ms con tc-netem** (`tc qdisc add dev docker0 root netem delay 200ms 20ms`)
- [ ] **TC-DEV-2: Inyección de Pérdida de Paquetes (5% y ráfagas del 20%)** (`tc qdisc change dev docker0 root netem loss 5%`)
- [ ] **TC-DEV-3: Reordenamiento de Paquetes (Jitter y Out-of-Order)** (`tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%`)
- [ ] **TC-DEV-4: Estrangulamiento de Ancho de Banda a 64 kbps** (`tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms`)
- [ ] **TC-DEV-5: Matanza Abrupta de Contenedor (SIGKILL)** (`docker kill <container-name>`)

/label ~"qa::in-progress" ~"game::chaos"
