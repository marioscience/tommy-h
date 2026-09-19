# 🗄️ Guía de Pruebas: Base de Datos Independiente (MariaDB / MySQL)

> **Objetivo**: Instancia MariaDB dedicada con integración phpMyAdmin SSO, conexiones remotas y prueba de estrés de importación SQL.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%97%84%EF%B8%8F+Base+de+Datos+Independiente+%28MariaDB+%2F+MySQL%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Adatabase&issue%5Bdescription%5D=%23%23+%F0%9F%97%84%EF%B8%8F+Certificaci%C3%B3n+QA%3A+Base+de+Datos+Independiente+%28MariaDB+%2F+MySQL%29%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Base+de+Datos+Independiente+%28MariaDB+%2F+MySQL%29%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F12_database.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Crear+Base+de+Datos+y+Encender**+%28Ver+gu%C3%ADa%3A+%60Enciende+en+verde+y+muestra+el+puerto+3306+asignado.%60%29%0A-+%5B+%5D+**Paso+2%3A+Entrar+a+phpMyAdmin+con+1-Clic**+%28Ver+gu%C3%ADa%3A+%60Abre+la+interfaz+de+phpMyAdmin+con+la+sesi%C3%B3n+iniciada+autom%C3%A1ticamente.%60%29%0A-+%5B+%5D+**Paso+3%3A+Crear+Tabla+y+Hacer+Consulta**+%28Ver+gu%C3%ADa%3A+%60La+tabla+se+crea+y+la+consulta+SELECT+muestra+los+datos.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Conexi%C3%B3n+Externa+Remota+con+Cliente+SQL**+%28%60mysql+-h+%3CnodeIp%3E+-P+%3CpublicPort%3E+-u+%3CdbUser%3E+-p%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Prueba+de+Estr%C3%A9s+con+Dump+SQL+de+100MB**+%28%60mysql+-h+localhost+-P+%3Cport%3E+-u+root+-p+%3C+big_dump.sql%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Adatabase%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Crear Base de Datos y Encender 🎮
- **Qué hacer**: Crear instancia de base de datos en el panel. Iniciar.
- ✅ **PASÓ SI**: Enciende en verde y muestra el puerto 3306 asignado.
- ❌ **FALLÓ SI**: Fallo al arrancar contenedor.

### Paso 2: Entrar a phpMyAdmin con 1-Clic 🎮
- **Qué hacer**: Hacer clic en el botón "Abrir phpMyAdmin" en el panel.
- ✅ **PASÓ SI**: Abre la interfaz de phpMyAdmin con la sesión iniciada automáticamente.
- ❌ **FALLÓ SI**: Pide usuario y contraseña o da error de autenticación.

### Paso 3: Crear Tabla y Hacer Consulta 🎮
- **Qué hacer**: En phpMyAdmin, crear una tabla de prueba con 2 columnas e insertar un registro.
- ✅ **PASÓ SI**: La tabla se crea y la consulta SELECT muestra los datos.
- ❌ **FALLÓ SI**: Error de sintaxis o permiso denegado.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Conexión Externa Remota con Cliente SQL ⚙️
- **Comando / Acción**: `mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p`
- **Criterio de Aprobación**: Permite autenticar desde DBeaver/HeidiSQL fuera del host con soporte TLS.

### Verificación Técnica 2: Prueba de Estrés con Dump SQL de 100MB ⚙️
- **Comando / Acción**: `mysql -h localhost -P <port> -u root -p < big_dump.sql`
- **Criterio de Aprobación**: La importación se completa a velocidad máxima sin agotar el buffer de memoria del contenedor.

