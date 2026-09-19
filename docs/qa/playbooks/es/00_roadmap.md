# 🚀 Guía de Pruebas: Hoja de Ruta de la Plataforma y Nuevas Funcionalidades

> **Objetivo**: Guía y seguimiento de las funcionalidades planificadas en RageNodes Ultimate para su validación de QA.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%9A%80+Hoja+de+Ruta+de+la+Plataforma+y+Nuevas+Funcionalidades&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Aroadmap&issue%5Bdescription%5D=%23%23+%F0%9F%9A%80+Certificaci%C3%B3n+QA%3A+Hoja+de+Ruta+de+la+Plataforma+y+Nuevas+Funcionalidades%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Hoja+de+Ruta+de+la+Plataforma+y+Nuevas+Funcionalidades%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F00_roadmap.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Verificar+Despliegue+Instant%C3%A1neo+en+el+Panel**+%28Ver+gu%C3%ADa%3A+%60El+servidor+se+crea%2C+muestra+estado+%22En+l%C3%ADnea%22+en+menos+de+2+minutos+y+genera+su+IP.%60%29%0A-+%5B+%5D+**Paso+2%3A+Probar+el+Editor+de+C%C3%B3digo+Monaco**+%28Ver+gu%C3%ADa%3A+%60El+editor+resalta+la+sintaxis+correctamente+y+guarda+los+cambios+sin+recargar+la+p%C3%A1gina.%60%29%0A-+%5B+%5D+**Paso+3%3A+Probar+la+Protecci%C3%B3n+Vault+en+Archivos+Protegidos**+%28Ver+gu%C3%ADa%3A+%60El+sistema+bloquea+la+edici%C3%B3n+mostrando+%22Vault+Protection%3A+Archivo+protegido%22.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Mitigaci%C3%B3n+DDoS+con+OxideProxy+eBPF%2FXDP**+%28%60docker+logs+ragenodes_oxideproxy+%7C+grep+-i+%22ebpf%22%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Cola+de+Backups+con+Prioridad+por+Rango**+%28%60docker+exec+-it+ragenodes_backend+node+-e+%22import%28%27.%2Fsrc%2Fservices%2FbackupQueue.js%27%29.then%28m+%3D%3E+console.log%28m.backupQueue%29%29%22%60%29%0A-+%5B+%5D+**TC-DEV-3%3A+Migraci%C3%B3n+en+Caliente+Multi-Nodo**+%28%60curl+-s+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fadmin%2Fnodes+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A-+%5B+%5D+**TC-DEV-4%3A+Streaming+de+Logs+con+LogHub+y+Heartbeat+SSE**+%28%60curl+-N+-H+%22Accept%3A+text%2Fevent-stream%22+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fservers%2F1%2Flogs%2Fstream+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Aroadmap%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Verificar Despliegue Instantáneo en el Panel 🎮
- **Qué hacer**: Crear cualquier servidor desde la interfaz web y verificar que la barra de progreso avanza sin errores.
- ✅ **PASÓ SI**: El servidor se crea, muestra estado "En línea" en menos de 2 minutos y genera su IP.
- ❌ **FALLÓ SI**: La barra se queda congelada, da error 500 o no genera puerto público.

### Paso 2: Probar el Editor de Código Monaco 🎮
- **Qué hacer**: Ir al Gestor de Archivos, abrir un archivo de configuración (.cfg, .properties o .ini), modificar un texto y guardar.
- ✅ **PASÓ SI**: El editor resalta la sintaxis correctamente y guarda los cambios sin recargar la página.
- ❌ **FALLÓ SI**: Pantalla en blanco, error de guardado o pérdida de formato.

### Paso 3: Probar la Protección Vault en Archivos Protegidos 🎮
- **Qué hacer**: Intentar editar o descargar recursos marcados con [market].
- ✅ **PASÓ SI**: El sistema bloquea la edición mostrando "Vault Protection: Archivo protegido".
- ❌ **FALLÓ SI**: Permite modificar el código fuente de un script protegido de la tienda.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Mitigación DDoS con OxideProxy eBPF/XDP ⚙️
- **Comando / Acción**: `docker logs ragenodes_oxideproxy | grep -i "ebpf"`
- **Criterio de Aprobación**: El motor eBPF/XDP en Rust compila y enlaza los filtros de red en nanosegundos en la NIC sin pausas de GC.

### Verificación Técnica 2: Cola de Backups con Prioridad por Rango ⚙️
- **Comando / Acción**: `docker exec -it ragenodes_backend node -e "import('./src/services/backupQueue.js').then(m => console.log(m.backupQueue))"`
- **Criterio de Aprobación**: Los jobs de rango Elite se procesan antes que los de rango Hobby en la cola asíncrona.

### Verificación Técnica 3: Migración en Caliente Multi-Nodo ⚙️
- **Comando / Acción**: `curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"`
- **Criterio de Aprobación**: El backend lista todos los nodos remotos y balancea las nuevas instancias según CPU y RAM libre.

### Verificación Técnica 4: Streaming de Logs con LogHub y Heartbeat SSE ⚙️
- **Comando / Acción**: `curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"`
- **Criterio de Aprobación**: El flujo SSE emite un pulso ": heartbeat <timestamp>" cada 15 segundos manteniendo la conexión abierta.

