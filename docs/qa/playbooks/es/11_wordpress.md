# 🌐 Guía de Pruebas: WordPress CMS & Web Hosting

> **Objetivo**: Pila Apache + PHP con MariaDB dedicada, autogeneración de wp-config.php y backup atómico de archivos y SQL.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%8C%90+WordPress+CMS+%26+Web+Hosting&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Awordpress&issue%5Bdescription%5D=%23%23+%F0%9F%8C%90+Certificaci%C3%B3n+QA%3A+WordPress+CMS+%26+Web+Hosting%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+WordPress+CMS+%26+Web+Hosting%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F11_wordpress.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Servidor+WordPress**+%28Ver+gu%C3%ADa%3A+%60Se+enciende+y+te+da+la+URL+p%C3%BAblica+del+puerto+web.%60%29%0A-+%5B+%5D+**Paso+2%3A+Completar+Asistente+de+Instalaci%C3%B3n**+%28Ver+gu%C3%ADa%3A+%60WordPress+se+instala+sin+pedirte+credenciales+de+base+de+datos+porque+se+autoconfiguraron.%60%29%0A-+%5B+%5D+**Paso+3%3A+Instalar+Plugin+y+Subir+Imagen**+%28Ver+gu%C3%ADa%3A+%60La+imagen+sube+y+el+plugin+se+instala+sin+problemas+de+permisos+de+escritura+en+disco.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Emparejamiento+de+Contenedor+MariaDB+Dedicado**+%28%60docker+ps+%7C+grep+wordpress%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Copia+de+Seguridad+At%C3%B3mica+de+Archivos+y+Dump+SQL**+%28%60curl+-X+POST+http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fservers%2F%3Cid%3E%2Fbackup+-H+%22Authorization%3A+Bearer+%24TOKEN%22%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Awordpress%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Servidor WordPress 🎮
- **Qué hacer**: Crear instancia de WordPress en el panel e iniciar.
- ✅ **PASÓ SI**: Se enciende y te da la URL pública del puerto web.
- ❌ **FALLÓ SI**: Error de enlace con la base de datos.

### Paso 2: Completar Asistente de Instalación 🎮
- **Qué hacer**: Abrir la URL web en el navegador, poner título al sitio y crear usuario admin.
- ✅ **PASÓ SI**: WordPress se instala sin pedirte credenciales de base de datos porque se autoconfiguraron.
- ❌ **FALLÓ SI**: Error "Error establishing a database connection".

### Paso 3: Instalar Plugin y Subir Imagen 🎮
- **Qué hacer**: Entrar al panel de WordPress (/wp-admin), subir una imagen a la biblioteca e instalar un plugin.
- ✅ **PASÓ SI**: La imagen sube y el plugin se instala sin problemas de permisos de escritura en disco.
- ❌ **FALLÓ SI**: Error "No se pudo escribir en wp-content/uploads".

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Emparejamiento de Contenedor MariaDB Dedicado ⚙️
- **Comando / Acción**: `docker ps | grep wordpress`
- **Criterio de Aprobación**: El contenedor <nombre> está emparejado con su base <nombre>-db en una red privada aislada.

### Verificación Técnica 2: Copia de Seguridad Atómica de Archivos y Dump SQL ⚙️
- **Comando / Acción**: `curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"`
- **Criterio de Aprobación**: El archivo tar.gz generado contiene los archivos web y el dump mysqldump de la base de datos.

