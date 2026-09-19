# 🚗 Guía de Pruebas: FiveM (Grand Theft Auto V Roleplay)

> **Objetivo**: Pruebas de sincronización de vehículos a alta velocidad, txAdmin con proxy HTTPS, MariaDB aislada y Blender WebTop 3D.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%9A%97+FiveM+%28Grand+Theft+Auto+V+Roleplay%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Afivem&issue%5Bdescription%5D=%23%23+%F0%9F%9A%97+Certificaci%C3%B3n+QA%3A+FiveM+%28Grand+Theft+Auto+V+Roleplay%29%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+FiveM+%28Grand+Theft+Auto+V+Roleplay%29%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F01_fivem.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+y+Arrancar+Servidor+FiveM**+%28Ver+gu%C3%ADa%3A+%60El+bot%C3%B3n+se+pone+verde%2C+muestra+la+IP+p%C3%BAblica+y+el+puerto+txAdmin.%60%29%0A-+%5B+%5D+**Paso+2%3A+Entrar+a+txAdmin+por+Web**+%28Ver+gu%C3%ADa%3A+%60Abre+la+interfaz+de+txAdmin+bajo+HTTPS+sin+advertencias+de+certificado+y+te+deja+iniciar+sesi%C3%B3n.%60%29%0A-+%5B+%5D+**Paso+3%3A+Conectar+al+Servidor+desde+el+Juego**+%28Ver+gu%C3%ADa%3A+%60Ambos+cargan+el+mapa+de+Los+Santos%2C+se+ven+caminar+y+se+escuchan+por+voz+de+proximidad.%60%29%0A-+%5B+%5D+**Paso+4%3A+Prueba+de+Conducci%C3%B3n+a+200+km%2Fh**+%28Ver+gu%C3%ADa%3A+%60El+copiloto+se+mantiene+dentro+del+auto+sin+salir+despedido+y+las+texturas+cargan+fluido.%60%29%0A-+%5B+%5D+**Paso+5%3A+Probar+el+Editor+3D+Blender+WebTop**+%28Ver+gu%C3%ADa%3A+%60Abre+una+ventana+de+Blender+en+el+navegador+lista+para+editar+modelos+3D+%28.ydr+%2F+.yft%29.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Offset+de+Puertos+y+Enrutamiento+OxideProxy+L4**+%28%60docker+port+%3Cfivem-container%3E%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Aislamiento+de+Base+de+Datos+MariaDB**+%28%60docker+exec+-it+ragenodes_mariadb+mysql+-u+root+-p+-e+%22SHOW+GRANTS+FOR+%27%3Cdb_user%3E%27%40%27%25%27%3B%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Heartbeat+y+Auto-Apagado+de+Blender+WebTop**+%28%60docker+ps+%7C+grep+blender%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Registro+de+Disparos+bajo+Latencia+Simulada**+%28%60tc+qdisc+add+dev+docker0+root+netem+delay+120ms%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Afivem%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear y Arrancar Servidor FiveM 🎮
- **Qué hacer**: Crear servidor FiveM en el panel. Poner una clave de Keymaster (License Key) válida y encender.
- ✅ **PASÓ SI**: El botón se pone verde, muestra la IP pública y el puerto txAdmin.
- ❌ **FALLÓ SI**: Se queda en iniciando o da error de base de datos.

### Paso 2: Entrar a txAdmin por Web 🎮
- **Qué hacer**: Hacer clic en el botón "Abrir txAdmin" en el panel de RageNodes.
- ✅ **PASÓ SI**: Abre la interfaz de txAdmin bajo HTTPS sin advertencias de certificado y te deja iniciar sesión.
- ❌ **FALLÓ SI**: Error 502 Bad Gateway o pantalla en blanco.

### Paso 3: Conectar al Servidor desde el Juego 🎮
- **Qué hacer**: Abrir FiveM en la PC. Presionar F8 y escribir: connect <IP:Puerto>. Entrar junto con otro jugador.
- ✅ **PASÓ SI**: Ambos cargan el mapa de Los Santos, se ven caminar y se escuchan por voz de proximidad.
- ❌ **FALLÓ SI**: Error "Connection timed out" o pantalla de carga infinita.

### Paso 4: Prueba de Conducción a 200 km/h 🎮
- **Qué hacer**: Subirse a un superdeportivo. Conducir a toda velocidad por la autopista durante 3 minutos con el copiloto.
- ✅ **PASÓ SI**: El copiloto se mantiene dentro del auto sin salir despedido y las texturas cargan fluido.
- ❌ **FALLÓ SI**: El auto cae por el mapa o el copiloto se teletransporta 200 metros atrás.

### Paso 5: Probar el Editor 3D Blender WebTop 🎮
- **Qué hacer**: En el panel, ir a la pestaña Blender y hacer clic en "Iniciar Blender". Abrir la sesión gráfica.
- ✅ **PASÓ SI**: Abre una ventana de Blender en el navegador lista para editar modelos 3D (.ydr / .yft).
- ❌ **FALLÓ SI**: No conecta a la sesión VNC o da error de puerto.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Offset de Puertos y Enrutamiento OxideProxy L4 ⚙️
- **Comando / Acción**: `docker port <fivem-container>`
- **Criterio de Aprobación**: El puerto 30120 TCP/UDP está enrutado por OxideProxy con offset backend 30000, evitando colisión con el puerto 40120 de txAdmin.

### Verificación Técnica 2: Aislamiento de Base de Datos MariaDB ⚙️
- **Comando / Acción**: `docker exec -it ragenodes_mariadb mysql -u root -p -e "SHOW GRANTS FOR '<db_user>'@'%';"`
- **Criterio de Aprobación**: El usuario solo tiene permisos sobre su propia base db_name y no puede ver las bases de otros clientes.

### Verificación Técnica 3: Heartbeat y Auto-Apagado de Blender WebTop ⚙️
- **Comando / Acción**: `docker ps | grep blender`
- **Criterio de Aprobación**: Si el cliente cierra la pestaña, el contenedor de Blender se detiene tras expirar el heartbeat para liberar GPU y RAM.

### Verificación Técnica 4: Registro de Disparos bajo Latencia Simulada ⚙️
- **Comando / Acción**: `tc qdisc add dev docker0 root netem delay 120ms`
- **Criterio de Aprobación**: Los disparos entre dos jugadores a la carrera son autorizados correctamente por el servidor sin desincronización de vida.

