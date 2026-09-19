# ⚡ Guía de Pruebas: Matriz de Red Adversa y Pruebas de Caos

> **Objetivo**: Inyección de latencia (200ms), pérdida de paquetes (5-20%), jitter y recuperación ante caídas forzadas de sockets.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%E2%9A%A1+Matriz+de+Red+Adversa+y+Pruebas+de+Caos&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Achaos&issue%5Bdescription%5D=%23%23+%E2%9A%A1+Certificaci%C3%B3n+QA%3A+Matriz+de+Red+Adversa+y+Pruebas+de+Caos%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Matriz+de+Red+Adversa+y+Pruebas+de+Caos%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F13_chaos_network.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Jugar+bajo+150ms+de+Latencia+%28Ping+Alto%29**+%28Ver+gu%C3%ADa%3A+%60El+juego+se+siente+jugable%3B+el+movimiento+es+fluido+y+no+hay+teletransportes+bruscos.%60%29%0A-+%5B+%5D+**Paso+2%3A+Desconexi%C3%B3n+y+Reconexi%C3%B3n+R%C3%A1pida**+%28Ver+gu%C3%ADa%3A+%60El+cliente+se+reconecta+a+la+partida+en+el+mismo+lugar+sin+perder+inventario.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Inyecci%C3%B3n+de+Latencia+de+200ms+con+tc-netem**+%28%60tc+qdisc+add+dev+docker0+root+netem+delay+200ms+20ms%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Inyecci%C3%B3n+de+P%C3%A9rdida+de+Paquetes+%285%25+y+r%C3%A1fagas+del+20%25%29**+%28%60tc+qdisc+change+dev+docker0+root+netem+loss+5%25%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Reordenamiento+de+Paquetes+%28Jitter+y+Out-of-Order%29**+%28%60tc+qdisc+change+dev+docker0+root+netem+delay+100ms+30ms+reorder+25%25%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Estrangulamiento+de+Ancho+de+Banda+a+64+kbps**+%28%60tc+qdisc+change+dev+docker0+root+tbf+rate+64kbit+burst+32kbit+latency+400ms%60%29%0A-+%5B+%5D+**TC-DEV-5%3A+Matanza+Abrupta+de+Contenedor+%28SIGKILL%29**+%28%60docker+kill+%3Ccontainer-name%3E%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Achaos%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Jugar bajo 150ms de Latencia (Ping Alto) 🎮
- **Qué hacer**: Conectarse a un servidor con conexión degradada (Wi-Fi lejano o herramienta Clumsy a 150ms).
- ✅ **PASÓ SI**: El juego se siente jugable; el movimiento es fluido y no hay teletransportes bruscos.
- ❌ **FALLÓ SI**: El jugador se queda congelado o es expulsado por timeout.

### Paso 2: Desconexión y Reconexión Rápida 🎮
- **Qué hacer**: Desconectar el cable de red o Wi-Fi durante 15 segundos y volverlo a conectar.
- ✅ **PASÓ SI**: El cliente se reconecta a la partida en el mismo lugar sin perder inventario.
- ❌ **FALLÓ SI**: El servidor duplica tu personaje (personaje zombi) o pierdes tu progreso.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Inyección de Latencia de 200ms con tc-netem ⚙️
- **Comando / Acción**: `tc qdisc add dev docker0 root netem delay 200ms 20ms`
- **Criterio de Aprobación**: El proxy OxideProxy y los sockets UDP de juego mantienen la sincronización sin pausas de simulación.

### Verificación Técnica 2: Inyección de Pérdida de Paquetes (5% y ráfagas del 20%) ⚙️
- **Comando / Acción**: `tc qdisc change dev docker0 root netem loss 5%`
- **Criterio de Aprobación**: El protocolo de reconciliación reenvía los inputs no confirmados sin crashear el servidor.

### Verificación Técnica 3: Reordenamiento de Paquetes (Jitter y Out-of-Order) ⚙️
- **Comando / Acción**: `tc qdisc change dev docker0 root netem delay 100ms 30ms reorder 25%`
- **Criterio de Aprobación**: Los paquetes UDP desordenados son procesados correctamente por la capa de transporte del juego.

### Verificación Técnica 4: Estrangulamiento de Ancho de Banda a 64 kbps ⚙️
- **Comando / Acción**: `tc qdisc change dev docker0 root tbf rate 64kbit burst 32kbit latency 400ms`
- **Criterio de Aprobación**: El sistema de culling por distancia prioriza entidades cercanas y descarta entidades lejanas sin congelar el juego.

### Verificación Técnica 5: Matanza Abrupta de Contenedor (SIGKILL) ⚙️
- **Comando / Acción**: `docker kill <container-name>`
- **Criterio de Aprobación**: Docker reinicia el contenedor (on-failure) y el Hub de logs reconecta el flujo SSE sin intervención manual.

