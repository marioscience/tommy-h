# 🪓 Guía de Pruebas: Valheim Dedicated Server

> **Objetivo**: Soporte de juego cruzado (Crossplay), deformación de terreno vóxel con azada/pico y navegación en Drakkar.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%AA%93+Valheim+Dedicated+Server&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Avalheim&issue%5Bdescription%5D=%23%23+%F0%9F%AA%93+Certificaci%C3%B3n+QA%3A+Valheim+Dedicated+Server%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Valheim+Dedicated+Server%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F08_valheim.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+con+Contrase%C3%B1a+V%C3%A1lida**+%28Ver+gu%C3%ADa%3A+%60Arranca+y+genera+el+mundo+vikingo+en+el+puerto+2456.%60%29%0A-+%5B+%5D+**Paso+2%3A+Conectar+desde+PC+y+Consola+%28Crossplay%29**+%28Ver+gu%C3%ADa%3A+%60Ambos+vikingos+aparecen+junto+a+las+piedras+de+sacrificio.%60%29%0A-+%5B+%5D+**Paso+3%3A+Modificaci%C3%B3n+Masiva+de+Terreno**+%28Ver+gu%C3%ADa%3A+%60La+deformaci%C3%B3n+de+la+tierra+se+sincroniza+al+instante+sin+parpadeos.%60%29%0A-+%5B+%5D+**Paso+4%3A+Navegaci%C3%B3n+en+Barco+bajo+Tormenta**+%28Ver+gu%C3%ADa%3A+%60El+barco+navega+suave%2C+se+balancea+con+las+olas+y+nadie+se+cae+al+agua+por+lag.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Argumento+de+Arranque+-crossplay**+%28%60docker+inspect+%3Cvalheim-container%3E+%7C+grep+-i+%22crossplay%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Tr%C3%ADo+de+Puertos+UDP+Enrutados**+%28%60docker+port+%3Cvalheim-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Persistencia+de+Listas+de+Acceso+%28adminlist+%2F+bannedlist%29**+%28%60cat+%3CdataPath%3E%2Fadminlist.txt%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Avalheim%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor con Contraseña Válida 🎮
- **Qué hacer**: Crear servidor Valheim en el panel. Poner una contraseña de al menos 5 caracteres e iniciar.
- ✅ **PASÓ SI**: Arranca y genera el mundo vikingo en el puerto 2456.
- ❌ **FALLÓ SI**: El servidor rechaza contraseñas cortas o vacías.

### Paso 2: Conectar desde PC y Consola (Crossplay) 🎮
- **Qué hacer**: Conectar un jugador desde Steam (PC) y otro jugador desde consola o PC con juego cruzado.
- ✅ **PASÓ SI**: Ambos vikingos aparecen junto a las piedras de sacrificio.
- ❌ **FALLÓ SI**: Error de versión incompatible o fallo de Crossplay.

### Paso 3: Modificación Masiva de Terreno 🎮
- **Qué hacer**: Cavar una zanja profunda con un pico y aplanar un área grande con una azada con dos jugadores viendo.
- ✅ **PASÓ SI**: La deformación de la tierra se sincroniza al instante sin parpadeos.
- ❌ **FALLÓ SI**: Un jugador ve el pozo y el otro ve la tierra sólida.

### Paso 4: Navegación en Barco bajo Tormenta 🎮
- **Qué hacer**: Construir un Longship (barco grande), subirse 2 o 3 jugadores y navegar en mar con olas grandes.
- ✅ **PASÓ SI**: El barco navega suave, se balancea con las olas y nadie se cae al agua por lag.
- ❌ **FALLÓ SI**: Los pasajeros salen disparados al océano o el barco da saltos bruscos.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Argumento de Arranque -crossplay ⚙️
- **Comando / Acción**: `docker inspect <valheim-container> | grep -i "crossplay"`
- **Criterio de Aprobación**: El servidor arranca con el parámetro -crossplay activo para enrutar tráfico PlayFab/Steam.

### Verificación Técnica 2: Trío de Puertos UDP Enrutados ⚙️
- **Comando / Acción**: `docker port <valheim-container>`
- **Criterio de Aprobación**: OxideProxy mapea los 3 puertos UDP consecutivos: 2456, 2457 y 2458.

### Verificación Técnica 3: Persistencia de Listas de Acceso (adminlist / bannedlist) ⚙️
- **Comando / Acción**: `cat <dataPath>/adminlist.txt`
- **Criterio de Aprobación**: Los SteamIDs agregados desde el panel de administración persisten en los archivos de texto de Valheim.

