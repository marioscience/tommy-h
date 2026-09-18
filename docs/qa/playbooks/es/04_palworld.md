# 🥚 Guía de Pruebas: Palworld Dedicated Server

> **Objetivo**: Captura de Pals, sincronización de IA en base, visor de gremios y prueba de fuga de memoria Unreal.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%A5%9A+Palworld+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Apalworld&issue%5Bdescription%5D=%23%23+%F0%9F%A5%9A+Certificaci%C3%B3n+QA%3A+Palworld+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Palworld+Dedicated+Server%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F04_palworld.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+de+Palworld**+%28Ver+gu%C3%ADa%3A+%60Enciende+en+verde+y+expone+el+puerto+UDP+8211.%60%29%0A-+%5B+%5D+**Paso+2%3A+Conectar+por+IP+Directa+en+el+Juego**+%28Ver+gu%C3%ADa%3A+%60Carga+la+pantalla+de+creaci%C3%B3n+de+personaje+y+entras+al+mundo.%60%29%0A-+%5B+%5D+**Paso+3%3A+Capturar+Pals+y+Pelear+en+Equipo**+%28Ver+gu%C3%ADa%3A+%60El+porcentaje+de+captura+se+ve+id%C3%A9ntico+para+ambos+jugadores+y+el+Pal+capturado+obedece+%C3%B3rdenes.%60%29%0A-+%5B+%5D+**Paso+4%3A+Automatizaci%C3%B3n+de+Base+y+Retenci%C3%B3n+de+Chunks**+%28Ver+gu%C3%ADa%3A+%60Al+volver%2C+los+Pals+siguen+trabajando+y+la+piedra+acumulada+est%C3%A1+en+los+cofres.%60%29%0A-+%5B+%5D+**Paso+5%3A+Visor+de+Gremios+%28Guilds%29+en+el+Panel**+%28Ver+gu%C3%ADa%3A+%60Muestra+el+nombre+de+tu+gremio%2C+lista+de+miembros+y+coordenadas+de+la+base.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Permisos+de+Usuario+Rootless+en+Contenedor**+%28%60ls+-ld+%3CdataPath%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Soak+Test+de+Memoria+Unreal+Engine+%284+Horas%29**+%28%60docker+stats+%3Cpalworld-container%3E+--no-stream%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Comandos+RCON+de+Gesti%C3%B3n+Administrativa**+%28%60curl+-X+POST+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Frcon%2F%3Cid%3E%2Fcommand+-d+%27%7B%22command%22%3A%22Broadcast+Hola%22%7D%27+-H+%22Content-Type%3A+application%2Fjson%22+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Apalworld%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor de Palworld 🎮
- **Qué hacer**: Crear servidor en el panel con mínimo 6GB de RAM. Iniciar.
- ✅ **PASÓ SI**: Enciende en verde y expone el puerto UDP 8211.
- ❌ **FALLÓ SI**: Fallo al arrancar o error de permisos en carpeta palworld.

### Paso 2: Conectar por IP Directa en el Juego 🎮
- **Qué hacer**: Abrir Palworld en Steam. Seleccionar Multijugador -> Conexión Directa. Pegar IP:8211.
- ✅ **PASÓ SI**: Carga la pantalla de creación de personaje y entras al mundo.
- ❌ **FALLÓ SI**: No encuentra el servidor o se queda colgado en pantalla negra.

### Paso 3: Capturar Pals y Pelear en Equipo 🎮
- **Qué hacer**: Lanzar Pal Spheres a criaturas salvajes con otro jugador disparando al mismo tiempo.
- ✅ **PASÓ SI**: El porcentaje de captura se ve idéntico para ambos jugadores y el Pal capturado obedece órdenes.
- ❌ **FALLÓ SI**: La esfera atraviesa al Pal o los Pals se quedan congelados sin atacar.

### Paso 4: Automatización de Base y Retención de Chunks 🎮
- **Qué hacer**: Construir una base, poner a 3 Pals a picar piedra. Alejarse 1 kilómetro del lugar y volver 10 minutos después.
- ✅ **PASÓ SI**: Al volver, los Pals siguen trabajando y la piedra acumulada está en los cofres.
- ❌ **FALLÓ SI**: Los Pals se quedan atascados en el aire o la base se resetea.

### Paso 5: Visor de Gremios (Guilds) en el Panel 🎮
- **Qué hacer**: Abrir la pestaña Gremios en el panel de RageNodes.
- ✅ **PASÓ SI**: Muestra el nombre de tu gremio, lista de miembros y coordenadas de la base.
- ❌ **FALLÓ SI**: Lista vacía o error 500.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Permisos de Usuario Rootless en Contenedor ⚙️
- **Comando / Acción**: `ls -ld <dataPath>`
- **Criterio de Aprobación**: El directorio está asignado a UID 1000:1000 previniendo errores de escritura en los guardados de mundo.

### Verificación Técnica 2: Soak Test de Memoria Unreal Engine (4 Horas) ⚙️
- **Comando / Acción**: `docker stats <palworld-container> --no-stream`
- **Criterio de Aprobación**: El recolector de basura de Unreal Engine no presenta fugas continuas de RAM sobre el límite de cgroup.

### Verificación Técnica 3: Comandos RCON de Gestión Administrativa ⚙️
- **Comando / Acción**: `curl -X POST http://localhost:3000/api/rcon/<id>/command -d '{"command":"Broadcast Hola"}' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN"`
- **Criterio de Aprobación**: El mensaje de difusión se emite de inmediato en las pantallas de los jugadores.

