# 🧟 Guía de Pruebas: 7 Days to Die (The Fun Pimps)

> **Objetivo**: Prueba de colapso de física vóxel, horda de Luna de Sangre con 64 zombis, chequeo de binarios y Telnet.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%A7%9F+7+Days+to+Die+%28The+Fun+Pimps%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Asdtd&issue%5Bdescription%5D=%23%23+%F0%9F%A7%9F+Certificaci%C3%B3n+QA%3A+7+Days+to+Die+%28The+Fun+Pimps%29%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+7+Days+to+Die+%28The+Fun+Pimps%29%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F07_sdtd.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+de+7+Days+to+Die**+%28Ver+gu%C3%ADa%3A+%60Arranca+y+expone+el+puerto+26900+UDP+y+26902+TCP.%60%29%0A-+%5B+%5D+**Paso+2%3A+Conectar+desde+el+Juego+con+EAC+Activo**+%28Ver+gu%C3%ADa%3A+%60Pasa+la+verificaci%C3%B3n+de+EAC+y+apareces+en+el+mundo+v%C3%B3xel.%60%29%0A-+%5B+%5D+**Paso+3%3A+Prueba+de+Colapso+F%C3%ADsico+Estructural**+%28Ver+gu%C3%ADa%3A+%60El+techo+y+los+pisos+superiores+colapsan+en+escombros+f%C3%ADsicos+de+forma+id%C3%A9ntica+para+todos+los+jugadores.%60%29%0A-+%5B+%5D+**Paso+4%3A+Horda+de+Luna+de+Sangre+%28Blood+Moon%29**+%28Ver+gu%C3%ADa%3A+%60Los+zombis+corren+hacia+los+jugadores+calculando+rutas+sin+congelar+el+servidor.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Verificaci%C3%B3n+de+Integridad+de+Binarios**+%28%60docker+exec+-it+%3Csdtd-container%3E+bash+-c+%22test+-x+%2F7dtd%2F7DaysToDieServer.x86_64+%26%26+echo+OK%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Aislamiento+del+Puerto+Telnet+Administrativo**+%28%60docker+port+%3Csdtd-container%3E+%7C+grep+26902%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Persistencia+en+serverconfig.xml**+%28%60cat+%3CdataPath%3E%2Fserverconfig.xml%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Asdtd%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor de 7 Days to Die 🎮
- **Qué hacer**: Crear servidor en el panel con mínimo 6GB de RAM. Iniciar.
- ✅ **PASÓ SI**: Arranca y expone el puerto 26900 UDP y 26902 TCP.
- ❌ **FALLÓ SI**: Error de validación de archivos de instalación.

### Paso 2: Conectar desde el Juego con EAC Activo 🎮
- **Qué hacer**: Abrir 7 Days to Die con Easy Anti-Cheat activo y unirse por IP.
- ✅ **PASÓ SI**: Pasa la verificación de EAC y apareces en el mundo vóxel.
- ❌ **FALLÓ SI**: Error "EAC Disconnected" o fallo de autenticación.

### Paso 3: Prueba de Colapso Físico Estructural 🎮
- **Qué hacer**: Buscar un edificio grande y destruir los pilares de soporte inferiores con dinamita o pico.
- ✅ **PASÓ SI**: El techo y los pisos superiores colapsan en escombros físicos de forma idéntica para todos los jugadores.
- ❌ **FALLÓ SI**: Los bloques se quedan flotando en el aire desafiando la física.

### Paso 4: Horda de Luna de Sangre (Blood Moon) 🎮
- **Qué hacer**: Configurar o adelantar el tiempo a la noche 7 para desatar la horda con 64 zombis simultáneos.
- ✅ **PASÓ SI**: Los zombis corren hacia los jugadores calculando rutas sin congelar el servidor.
- ❌ **FALLÓ SI**: El servidor se traba, el ping se dispara a más de 1000ms o el juego crashea.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Verificación de Integridad de Binarios ⚙️
- **Comando / Acción**: `docker exec -it <sdtd-container> bash -c "test -x /7dtd/7DaysToDieServer.x86_64 && echo OK"`
- **Criterio de Aprobación**: buildSDTDInstallationCheck certifica que el ejecutable de Unity y globalgamemanagers están completos.

### Verificación Técnica 2: Aislamiento del Puerto Telnet Administrativo ⚙️
- **Comando / Acción**: `docker port <sdtd-container> | grep 26902`
- **Criterio de Aprobación**: El puerto 26902 Telnet está protegido con contraseña generada por deriveServicePassword.

### Verificación Técnica 3: Persistencia en serverconfig.xml ⚙️
- **Comando / Acción**: `cat <dataPath>/serverconfig.xml`
- **Criterio de Aprobación**: Las configuraciones de dificultad y tamaño de mundo guardadas en el panel se escriben en XML válido.

