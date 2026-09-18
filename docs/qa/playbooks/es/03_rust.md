# ☢️ Guía de Pruebas: Rust Dedicated Server

> **Objetivo**: Pruebas de balística, hitreg con AK-47, plugins uMod C# con hot-reload y herramienta de Wipe.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%E2%98%A2%EF%B8%8F+Rust+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Arust&issue%5Bdescription%5D=%23%23+%E2%98%A2%EF%B8%8F+Certificaci%C3%B3n+QA%3A+Rust+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Rust+Dedicated+Server%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F03_rust.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+de+Rust+y+Encender**+%28Ver+gu%C3%ADa%3A+%60Enciende+en+verde+y+en+la+consola+ves+que+descarga+el+mapa+procedural.%60%29%0A-+%5B+%5D+**Paso+2%3A+Conectar+desde+la+Consola+de+Rust**+%28Ver+gu%C3%ADa%3A+%60Descarga+el+mapa+procedural+y+apareces+en+la+playa+despierto.%60%29%0A-+%5B+%5D+**Paso+3%3A+Prueba+de+Bal%C3%ADstica+y+Registro+de+Disparos**+%28Ver+gu%C3%ADa%3A+%60Escuchas+el+sonido+de+impacto+%28hitmarker%29.+Al+escribir+combatlog+en+consola+F1%2C+registra+los+impactos+con+da%C3%B1o+real.%60%29%0A-+%5B+%5D+**Paso+4%3A+Instalaci%C3%B3n+y+Recarga+en+Caliente+de+Plugin+uMod**+%28Ver+gu%C3%ADa%3A+%60El+plugin+se+descarga+en+%2Foxide%2Fplugins+y+se+compila+solo+sin+tener+que+reiniciar+el+servidor.%60%29%0A-+%5B+%5D+**Paso+5%3A+Probar+el+Bot%C3%B3n+de+Wipe+de+Mapa**+%28Ver+gu%C3%ADa%3A+%60El+servidor+borra+los+archivos+.map+y+.sav+pero+conserva+los+planos+%28blueprints%29+de+los+jugadores.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Enrutamiento+Triple+de+Puertos+L4**+%28%60docker+port+%3Crust-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Tickrate+de+Servidor+y+Pausas+de+Garbage+Collection**+%28%60docker+exec+-it+%3Crust-container%3E+rcon+%22serverinfo%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Monitor+de+Killfeed+y+Chat+v%C3%ADa+API**+%28%60curl+-s+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Frcon%2F%3Cid%3E%2Fkillfeed+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Aislamiento+de+Identidad+de+Servidor**+%28%60ls+-la+%3CdataPath%3E%2Fserver%2Fragenodes%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Arust%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor de Rust y Encender 🎮
- **Qué hacer**: Crear servidor Rust en el panel con al menos 6GB de RAM. Iniciar.
- ✅ **PASÓ SI**: Enciende en verde y en la consola ves que descarga el mapa procedural.
- ❌ **FALLÓ SI**: Falta de memoria o error de puertos 28015/28016.

### Paso 2: Conectar desde la Consola de Rust 🎮
- **Qué hacer**: Abrir Rust en Steam. Presionar F1 y escribir: client.connect <IP:28015>.
- ✅ **PASÓ SI**: Descarga el mapa procedural y apareces en la playa despierto.
- ❌ **FALLÓ SI**: Error "Disconnected: Connection Attempt Failed".

### Paso 3: Prueba de Balística y Registro de Disparos 🎮
- **Qué hacer**: Con un amigo a 50 metros corriendo de lado a lado, dispararle con un rifle AK-47.
- ✅ **PASÓ SI**: Escuchas el sonido de impacto (hitmarker). Al escribir combatlog en consola F1, registra los impactos con daño real.
- ❌ **FALLÓ SI**: Las balas atraviesan al jugador sin hacer daño o hay retraso de más de medio segundo.

### Paso 4: Instalación y Recarga en Caliente de Plugin uMod 🎮
- **Qué hacer**: En el panel, instalar un plugin de uMod (como GatherManager).
- ✅ **PASÓ SI**: El plugin se descarga en /oxide/plugins y se compila solo sin tener que reiniciar el servidor.
- ❌ **FALLÓ SI**: Error de compilación de C# o plugin no reconocido.

### Paso 5: Probar el Botón de Wipe de Mapa 🎮
- **Qué hacer**: En el panel de Rust, hacer clic en "Wipe de Servidor" y seleccionar "Solo Mapa".
- ✅ **PASÓ SI**: El servidor borra los archivos .map y .sav pero conserva los planos (blueprints) de los jugadores.
- ❌ **FALLÓ SI**: No borra nada o borra los blueprints por error.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Enrutamiento Triple de Puertos L4 ⚙️
- **Comando / Acción**: `docker port <rust-container>`
- **Criterio de Aprobación**: OxideProxy enruta los 3 puertos: 28015 (Juego), 28016 (RCON) y 28017 (Query) simultáneamente.

### Verificación Técnica 2: Tickrate de Servidor y Pausas de Garbage Collection ⚙️
- **Comando / Acción**: `docker exec -it <rust-container> rcon "serverinfo"`
- **Criterio de Aprobación**: El Server FPS se mantiene en 30-60 y las pausas de GC no superan los 20ms.

### Verificación Técnica 3: Monitor de Killfeed y Chat vía API ⚙️
- **Comando / Acción**: `curl -s http://localhost:3000/api/rcon/<id>/killfeed -H "Authorization: Bearer $TOKEN"`
- **Criterio de Aprobación**: La API extrae eventos de muerte y combate en tiempo real de los logs del contenedor.

### Verificación Técnica 4: Aislamiento de Identidad de Servidor ⚙️
- **Comando / Acción**: `ls -la <dataPath>/server/ragenodes`
- **Criterio de Aprobación**: Todos los datos del mundo se alojan en la carpeta de identidad ragenodes sin mezclar instalaciones.

