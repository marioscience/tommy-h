# 🤖 Guía de Pruebas: Discord Bot (Node.js & Python Dual Runtime)

> **Objetivo**: Instalador automático de dependencias (npm/pip), seguridad de tokens y auto-reinicio ante excepciones no controladas.

👉 **[🚀 Iniciar Tarea de Prueba en GitLab (Pre-rellenada en 1 Clic)](https://gitlab.com/mariomatos/ragenodesultimate/-/issues/new?issue%5Btitle%5D=%5BQA-ES%5D+%F0%9F%A4%96+Discord+Bot+%28Node.js+%26+Python+Dual+Runtime%29&issue%5Blabels%5D=qa%3A%3Ain-progress%2Cgame%3A%3Adiscordbot&issue%5Bdescription%5D=%23%23+%F0%9F%A4%96+Certificaci%C3%B3n+QA%3A+Discord+Bot+%28Node.js+%26+Python+Dual+Runtime%29%0A%0A%3E+%F0%9F%93%96+**Gu%C3%ADa+completa+paso+a+paso**%3A+Consulta+la+%5BGu%C3%ADa+de+Pruebas+de+Discord+Bot+%28Node.js+%26+Python+Dual+Runtime%29%5D%28docs%2Fqa%2Fplaybooks%2Fes%2F10_discord_bot.md%29.%0A%0A%23%23%23+%F0%9F%8E%AE+Parte+1%3A+Pruebas+de+Jugador+%28Tester+de+QA%29%0A*Marca+las+casillas+conforme+vayas+jugando+y+probando+cada+funci%C3%B3n%3A*%0A%0A-+%5B+%5D+**Paso+1%3A+Subir+Archivos+del+Bot**+%28Ver+gu%C3%ADa%3A+%60Los+archivos+se+suben+correctamente+a+la+ra%C3%ADz+%2Fdata.%60%29%0A-+%5B+%5D+**Paso+2%3A+Instalar+Dependencias+a+1-Clic**+%28Ver+gu%C3%ADa%3A+%60La+consola+ejecuta+npm+install+o+pip+install+-r+requirements.txt+con+%C3%A9xito.%60%29%0A-+%5B+%5D+**Paso+3%3A+Encender+Bot+y+Verificar+en+Discord**+%28Ver+gu%C3%ADa%3A+%60El+bot+aparece+en+verde+%28%22Online%22%29+en+tu+servidor+de+Discord+y+responde+a+comandos.%60%29%0A%0A%3E+%F0%9F%92%AC+**%C2%BFTerminaste+las+pruebas+de+jugador%3F**+Deja+un+comentario+etiquetando+a+los+desarrolladores%3A++%0A%3E+%60%40devs+Pruebas+de+jugador+terminadas+con+%C3%A9xito.+Listo+para+la+revisi%C3%B3n+t%C3%A9cnica.%60%0A%0A%23%23%23+%E2%9A%99%EF%B8%8F+Parte+2%3A+Pruebas+T%C3%A9cnicas+%28Programadores%29%0A*Comandos+de+terminal+para+el+equipo+de+desarrollo%3A*%0A%0A-+%5B+%5D+**TC-DEV-1%3A+Reinicio+Autom%C3%A1tico+ante+Excepci%C3%B3n+Fatal**+%28%60docker+exec+-it+%3Cbot-container%3E+kill+-9+1%60%29%0A-+%5B+%5D+**TC-DEV-2%3A+Seguridad+y+Ocultaci%C3%B3n+de+Tokens+en+Logs**+%28%60docker+logs+%3Cbot-container%3E%60%29%0A%0A%2Flabel+%7E%22qa%3A%3Ain-progress%22+%7E%22game%3A%3Adiscordbot%22%0A)**

--- 

## 🎮 PARTE 1: Pruebas de Jugador (Para el Tester de QA)

*Instrucciones simples para jugar y probar el servidor como un usuario real.*

### Paso 1: Subir Archivos del Bot 🎮
- **Qué hacer**: Ir al Gestor de Archivos y subir tu index.js (o main.py) con su package.json (o requirements.txt).
- ✅ **PASÓ SI**: Los archivos se suben correctamente a la raíz /data.
- ❌ **FALLÓ SI**: Fallo de subida de archivo.

### Paso 2: Instalar Dependencias a 1-Clic 🎮
- **Qué hacer**: En el panel, hacer clic en "Auto-Instalar Dependencias" (npm o pip).
- ✅ **PASÓ SI**: La consola ejecuta npm install o pip install -r requirements.txt con éxito.
- ❌ **FALLÓ SI**: Error de comando o paquetes incompatibles.

### Paso 3: Encender Bot y Verificar en Discord 🎮
- **Qué hacer**: Configurar el token del bot en las variables de entorno e iniciar el servidor.
- ✅ **PASÓ SI**: El bot aparece en verde ("Online") en tu servidor de Discord y responde a comandos.
- ❌ **FALLÓ SI**: Error de token inválido o bot desconectado.

--- 

## ⚙️ PARTE 2: Pruebas Técnicas de Motor (Para los Programadores)

*Comandos de terminal e inspección de Docker que los desarrolladores ejecutan en 3 minutos.*

### Verificación Técnica 1: Reinicio Automático ante Excepción Fatal ⚙️
- **Comando / Acción**: `docker exec -it <bot-container> kill -9 1`
- **Criterio de Aprobación**: La política restart: on-failure levanta el contenedor automáticamente en menos de 5 segundos.

### Verificación Técnica 2: Seguridad y Ocultación de Tokens en Logs ⚙️
- **Comando / Acción**: `docker logs <bot-container>`
- **Criterio de Aprobación**: Los tokens de Discord no se filtran en texto plano en los registros públicos del contenedor.

