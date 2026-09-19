# 🦖 Guía de Pruebas: ARK: Survival Ascended / Evolved

> **Objetivo**: Capacidades de Proton/Wine, montura de dinosaurios, clústeres Cross-ARK y actualización forzada SteamCMD.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%A6%96+ARK%3A+Survival+Ascended+%2F+Evolved&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aark&issue%5Bdescription%5D=%23%23+%F0%9F%A6%96+Certificaci%C3%B3n+QA%3A+ARK%3A+Survival+Ascended+%2F+Evolved%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+ARK%3A+Survival+Ascended+%2F+Evolved%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F06_ark.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+ARK**+%28Ver+gu%C3%ADa%3A+%60Arranca+y+genera+el+mundo+TheIsland_WP.%60%29%0A-+%5B+%5D+**Paso+2%3A+Conectar+al+Servidor+en+el+Juego**+%28Ver+gu%C3%ADa%3A+%60Descarga+los+datos+y+apareces+en+la+playa+para+crear+superviviente.%60%29%0A-+%5B+%5D+**Paso+3%3A+Montar+Dinosaurio+y+Talar+%C3%81rboles**+%28Ver+gu%C3%ADa%3A+%60El+dinosaurio+se+mueve+suave+y+los+%C3%A1rboles+caen+al+mismo+tiempo+para+todos+los+jugadores.%60%29%0A-+%5B+%5D+**Paso+4%3A+Transferencia+por+Obelisco+en+Cl%C3%BAster**+%28Ver+gu%C3%ADa%3A+%60El+dinosaurio+aparece+en+el+segundo+servidor+con+sus+estad%C3%ADsticas+e+inventario+intactos.%60%29%0A-+%5B+%5D+**Paso+5%3A+Forzar+Actualizaci%C3%B3n+de+Versi%C3%B3n+de+ARK**+%28Ver+gu%C3%ADa%3A+%60El+servidor+borra+el+manifest+de+Steam+y+SteamCMD+descarga+la+%C3%BAltima+versi%C3%B3n+al+reiniciar.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Capacidades+Elevadas+de+Proton%2FWine**+%28%60docker+inspect+%3Cark-container%3E+%7C+grep+-A+10+%22CapAdd%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Montaje+de+Cl%C3%BAster+Compartido+Cross-ARK**+%28%60docker+inspect+%3Cark-container%3E+%7C+grep+-i+%22cluster%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Borrado+At%C3%B3mico+de+appmanifest_2430930.acf**+%28%60ls+-la+%3CdataPath%3E%2Fsteamapps%2F%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aark%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor ARK 🎮
- **Qué hacer**: Crear servidor ARK en el panel con al menos 12GB de RAM recomendados. Iniciar.
- ✅ **PASÓ SI**: Arranca y genera el mundo TheIsland_WP.
- ❌ **FALLÓ SI**: Fallo por memoria insuficiente o error de Wine.

### Paso 2: Conectar al Servidor en el Juego 🎮
- **Qué hacer**: Abrir ARK, ir al buscador de servidores no oficiales y unirse por IP.
- ✅ **PASÓ SI**: Descarga los datos y apareces en la playa para crear superviviente.
- ❌ **FALLÓ SI**: No aparece en la lista o se queda en pantalla de carga.

### Paso 3: Montar Dinosaurio y Talar Árboles 🎮
- **Qué hacer**: Domesticar un dinosaurio (Rex o Triceratops), montarlo y arrasar con árboles y rocas.
- ✅ **PASÓ SI**: El dinosaurio se mueve suave y los árboles caen al mismo tiempo para todos los jugadores.
- ❌ **FALLÓ SI**: Tirones bruscos hacia atrás (rubberbanding) al chocar con árboles.

### Paso 4: Transferencia por Obelisco en Clúster 🎮
- **Qué hacer**: Configurar un clusterId en el panel. Subir un dinosaurio a un Obelisco y descargarlo en otro servidor de ARK.
- ✅ **PASÓ SI**: El dinosaurio aparece en el segundo servidor con sus estadísticas e inventario intactos.
- ❌ **FALLÓ SI**: El dinosaurio desaparece o se corrompe el personaje.

### Paso 5: Forzar Actualización de Versión de ARK 🎮
- **Qué hacer**: En el panel, hacer clic en "Forzar Actualización de ARK".
- ✅ **PASÓ SI**: El servidor borra el manifest de Steam y SteamCMD descarga la última versión al reiniciar.
- ❌ **FALLÓ SI**: Error al reiniciar.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Capacidades Elevadas de Proton/Wine ⚙️
- **Comando / Acción**: `docker inspect <ark-container> | grep -A 10 "CapAdd"`
- **Criterio de Aprobación**: El contenedor posee CHOWN, SETUID, SETGID, KILL, DAC_OVERRIDE y ShmSize de 1GB para ejecutar Proton.

### Verificación Técnica 2: Montaje de Clúster Compartido Cross-ARK ⚙️
- **Comando / Acción**: `docker inspect <ark-container> | grep -i "cluster"`
- **Criterio de Aprobación**: El volumen compartido cluster se monta en /home/steam/Steam/steamapps/cluster permitiendo transferencias.

### Verificación Técnica 3: Borrado Atómico de appmanifest_2430930.acf ⚙️
- **Comando / Acción**: `ls -la <dataPath>/steamapps/`
- **Criterio de Aprobación**: La función forceUpdateARK retira el archivo de manifest forzando a SteamCMD a verificar archivos íntegros.

