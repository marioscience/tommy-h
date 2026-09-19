# 🧟‍♂️ Guía de Pruebas: Project Zomboid Dedicated Server

> **Objetivo**: Pruebas de viaje en carretera a 100 km/h, horda masiva con escopeta, mods de Steam Workshop a 1-clic y headroom JVM.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%A7%9F%E2%80%8D%E2%99%82%EF%B8%8F+Project+Zomboid+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Azomboid&issue%5Bdescription%5D=%23%23+%F0%9F%A7%9F%E2%80%8D%E2%99%82%EF%B8%8F+Certificaci%C3%B3n+QA%3A+Project+Zomboid+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Project+Zomboid+Dedicated+Server%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F09_project_zomboid.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+y+Arrancar**+%28Ver+gu%C3%ADa%3A+%60El+bot%C3%B3n+se+pone+verde+%28%22Online%22%29+y+muestra+los+puertos+16261+y+16262.%60%29%0A-+%5B+%5D+**Paso+2%3A+Instalar+Mod+de+Steam+Workshop+a+1-Clic**+%28Ver+gu%C3%ADa%3A+%60La+web+dice+mod+instalado+y+al+arrancar+se+ve+que+SteamCMD+lo+descarga.%60%29%0A-+%5B+%5D+**Paso+3%3A+Conectar+dos+Jugadores+al+Mundo**+%28Ver+gu%C3%ADa%3A+%60Ambos+aparecen+en+la+casa+de+inicio%2C+se+ven+caminar+y+pueden+chatear.%60%29%0A-+%5B+%5D+**Paso+4%3A+Prueba+de+la+Autopista+a+100+km%2Fh+%28Test+de+Autos%29**+%28Ver+gu%C3%ADa%3A+%60El+copiloto+se+mantiene+dentro+del+auto+sin+salir+despedido+y+la+carretera+carga+fluido.%60%29%0A-+%5B+%5D+**Paso+5%3A+Horda+del+Escopetazo+y+Registro+de+Golpes**+%28Ver+gu%C3%ADa%3A+%60Al+dar+un+batazo+el+zombi+retrocede+de+inmediato%3B+no+te+muerden+a+distancia.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+C%C3%A1lculo+Seguro+de+Memoria+JVM+Headroom**+%28%60docker+inspect+%3Cpz-container%3E+%7C+grep+MAX_RAM%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Enrutamiento+Dual+UDP+16261+y+16262**+%28%60docker+port+%3Cpz-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Prueba+de+Desconexi%C3%B3n+y+Reconexi%C3%B3n+Brusca**+%28%60tc+qdisc+add+dev+docker0+root+netem+loss+10%25%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Purga+Limpia+al+Destruir+Servidor**+%28%60docker+ps+-a+%7C+grep+zomboid%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Azomboid%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor y Arrancar 🎮
- **Qué hacer**: Crear servidor Project Zomboid en el panel con mínimo 6GB de RAM. Iniciar.
- ✅ **PASÓ SI**: El botón se pone verde ("Online") y muestra los puertos 16261 y 16262.
- ❌ **FALLÓ SI**: Se queda colgado o da error de Java.

### Paso 2: Instalar Mod de Steam Workshop a 1-Clic 🎮
- **Qué hacer**: En la pestaña Mods, poner Workshop ID: 2688809268 y Nombre: CommonSense. Instalar y reiniciar.
- ✅ **PASÓ SI**: La web dice mod instalado y al arrancar se ve que SteamCMD lo descarga.
- ❌ **FALLÓ SI**: Error al instalar o el archivo .ini se desconfigura.

### Paso 3: Conectar dos Jugadores al Mundo 🎮
- **Qué hacer**: Abrir Project Zomboid en Steam, Unirse por IP:16261 con un amigo.
- ✅ **PASÓ SI**: Ambos aparecen en la casa de inicio, se ven caminar y pueden chatear.
- ❌ **FALLÓ SI**: Error "Server not responding" o pantalla negra.

### Paso 4: Prueba de la Autopista a 100 km/h (Test de Autos) 🎮
- **Qué hacer**: Subirse a una furgoneta (conductor y copiloto) y acelerar a fondo por la carretera durante 3 minutos.
- ✅ **PASÓ SI**: El copiloto se mantiene dentro del auto sin salir despedido y la carretera carga fluido.
- ❌ **FALLÓ SI**: El copiloto se teletransporta atrás o caen al vacío negro.

### Paso 5: Horda del Escopetazo y Registro de Golpes 🎮
- **Qué hacer**: Pegar 5 tiros de escopeta en medio del pueblo para atraer a 100 zombis y pelear cuerpo a cuerpo.
- ✅ **PASÓ SI**: Al dar un batazo el zombi retrocede de inmediato; no te muerden a distancia.
- ❌ **FALLÓ SI**: Los zombis patinan o te muerden desde 3 metros.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Cálculo Seguro de Memoria JVM Headroom ⚙️
- **Comando / Acción**: `docker inspect <pz-container> | grep MAX_RAM`
- **Criterio de Aprobación**: buildProjectZomboidRuntime reserva al menos 1.5GB (1536MB) para Linux y Metaspace evitando Exit Code 137.

### Verificación Técnica 2: Enrutamiento Dual UDP 16261 y 16262 ⚙️
- **Comando / Acción**: `docker port <pz-container>`
- **Criterio de Aprobación**: El puerto 16261 (apretón de manos) y 16262 (datos de juego) están vinculados sin colisión en OxideProxy.

### Verificación Técnica 3: Prueba de Desconexión y Reconexión Brusca ⚙️
- **Comando / Acción**: `tc qdisc add dev docker0 root netem loss 10%`
- **Criterio de Aprobación**: El servidor tolera micro-cortes y limpia entidades zombi al reconectar el cliente sin duplicar inventario.

### Verificación Técnica 4: Purga Limpia al Destruir Servidor ⚙️
- **Comando / Acción**: `docker ps -a | grep zomboid`
- **Criterio de Aprobación**: Al borrar el servidor se eliminan los contenedores, volúmenes de guardado y puertos sin dejar procesos huérfanos.

