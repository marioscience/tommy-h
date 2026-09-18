# ⛏️ Guía de Pruebas: Minecraft (Paper, Fabric, Forge, Purpur, Vanilla)

> **Objetivo**: Pruebas de generación masiva de chunks, estabilidad de 20.0 TPS, resolución de Java por versión y plugins Spiget.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%E2%9B%8F%EF%B8%8F+Minecraft+%28Paper%2C+Fabric%2C+Forge%2C+Purpur%2C+Vanilla%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aminecraft&issue%5Bdescription%5D=%23%23+%E2%9B%8F%EF%B8%8F+Certificaci%C3%B3n+QA%3A+Minecraft+%28Paper%2C+Fabric%2C+Forge%2C+Purpur%2C+Vanilla%29%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Minecraft+%28Paper%2C+Fabric%2C+Forge%2C+Purpur%2C+Vanilla%29%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F02_minecraft.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+y+Elegir+Versi%C3%B3n**+%28Ver+gu%C3%ADa%3A+%60El+servidor+enciende%2C+acepta+el+EULA+autom%C3%A1ticamente+y+muestra+el+puerto+25565.%60%29%0A-+%5B+%5D+**Paso+2%3A+Instalar+Plugin+con+1-Clic**+%28Ver+gu%C3%ADa%3A+%60El+archivo+.jar+aparece+en+la+carpeta+%2Fplugins%2F+y+los+comandos+del+plugin+funcionan+en+el+juego.%60%29%0A-+%5B+%5D+**Paso+3%3A+Conectar+al+Servidor+desde+Minecraft**+%28Ver+gu%C3%ADa%3A+%60Entras+al+mundo+al+instante+con+ping+bajo+y+sin+mensajes+de+error+de+autenticaci%C3%B3n.%60%29%0A-+%5B+%5D+**Paso+4%3A+Vuelo+a+Toda+Velocidad+en+Espectador+%28Test+de+Chunks%29**+%28Ver+gu%C3%ADa%3A+%60El+terreno+carga+delante+de+ti.+Al+escribir+%2Ftps+en+la+consola%2C+se+mantiene+entre+19.8+y+20.0+TPS.%60%29%0A-+%5B+%5D+**Paso+5%3A+Prueba+de+Bloques+Fantasma+%28Ghost+Blocks%29**+%28Ver+gu%C3%ADa%3A+%60Todos+los+bloques+se+rompen+de+forma+fluida+y+dan+el+item.+Ning%C3%BAn+bloque+roto+vuelve+a+aparecer+m%C3%A1gicamente.%60%29%0A-+%5B+%5D+**Paso+6%3A+Editor+Visual+de+server.properties**+%28Ver+gu%C3%ADa%3A+%60Los+cambios+se+reflejan+en+el+archivo+server.properties+y+aplican+tras+reiniciar.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Resoluci%C3%B3n+Din%C3%A1mica+de+Imagen+OpenJDK**+%28%60docker+inspect+%3Cmc-container%3E+%7C+grep+-i+%22image%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+C%C3%A1lculo+Seguro+de+Memoria+JVM+Headroom**+%28%60docker+exec+-it+%3Cmc-container%3E+env+%7C+grep+-E+%22%28MEMORY%7CJVM%29%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Bloqueo+de+Identidad+de+Mundo**+%28%60cat+%3CdataPath%3E%2F.ragenodes-minecraft-identity.json%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aminecraft%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor y Elegir Versión 🎮
- **Qué hacer**: Crear servidor Minecraft Paper o Purpur en la versión 1.21.4. Iniciar servidor.
- ✅ **PASÓ SI**: El servidor enciende, acepta el EULA automáticamente y muestra el puerto 25565.
- ❌ **FALLÓ SI**: Error de EULA o contenedor detenido inmediatamente con código 137.

### Paso 2: Instalar Plugin con 1-Clic 🎮
- **Qué hacer**: Ir a la pestaña Plugins, buscar "EssentialsX" o "LuckPerms", hacer clic en Instalar y reiniciar.
- ✅ **PASÓ SI**: El archivo .jar aparece en la carpeta /plugins/ y los comandos del plugin funcionan en el juego.
- ❌ **FALLÓ SI**: El plugin no se descarga o rompe el inicio del servidor.

### Paso 3: Conectar al Servidor desde Minecraft 🎮
- **Qué hacer**: Abrir Minecraft Java en PC, ir a Multijugador, añadir la IP:Puerto y entrar.
- ✅ **PASÓ SI**: Entras al mundo al instante con ping bajo y sin mensajes de error de autenticación.
- ❌ **FALLÓ SI**: Error "Connection Refused" o "Server Outdated".

### Paso 4: Vuelo a Toda Velocidad en Espectador (Test de Chunks) 🎮
- **Qué hacer**: Ponerte en modo espectador (/gamemode spectator) y volar hacia adelante generando nuevo mapa durante 3 minutos.
- ✅ **PASÓ SI**: El terreno carga delante de ti. Al escribir /tps en la consola, se mantiene entre 19.8 y 20.0 TPS.
- ❌ **FALLÓ SI**: El juego se congela, los chunks tardan 10 segundos en cargar o el TPS cae por debajo de 15.

### Paso 5: Prueba de Bloques Fantasma (Ghost Blocks) 🎮
- **Qué hacer**: Picar una fila de 30 bloques de piedra rápidamente con un pico de diamante con eficiencia.
- ✅ **PASÓ SI**: Todos los bloques se rompen de forma fluida y dan el item. Ningún bloque roto vuelve a aparecer mágicamente.
- ❌ **FALLÓ SI**: Los bloques rotos reaparecen de golpe sofocando al jugador.

### Paso 6: Editor Visual de server.properties 🎮
- **Qué hacer**: En el panel, ir a Configuración de Minecraft. Cambiar la dificultad a "Hard" y la vista a 10 chunks. Guardar.
- ✅ **PASÓ SI**: Los cambios se reflejan en el archivo server.properties y aplican tras reiniciar.
- ❌ **FALLÓ SI**: Los cambios no se guardan o se borra el archivo.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Resolución Dinámica de Imagen OpenJDK ⚙️
- **Comando / Acción**: `docker inspect <mc-container> | grep -i "image"`
- **Criterio de Aprobación**: Minecraft 1.8/1.12 usa Java 11; 1.18/1.20 usa Java 17; 1.21+ usa Java 21/25 automáticamente.

### Verificación Técnica 2: Cálculo Seguro de Memoria JVM Headroom ⚙️
- **Comando / Acción**: `docker exec -it <mc-container> env | grep -E "(MEMORY|JVM)"`
- **Criterio de Aprobación**: calculateMinecraftJvmMemoryMb reserva el 25% y al menos 768MB para el sistema y Netty, evitando OOM Exit 137.

### Verificación Técnica 3: Bloqueo de Identidad de Mundo ⚙️
- **Comando / Acción**: `cat <dataPath>/.ragenodes-minecraft-identity.json`
- **Criterio de Aprobación**: El archivo identity bloquea cambios accidentales de versión o motor para no corromper el mundo del cliente.

