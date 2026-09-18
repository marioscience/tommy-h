## 🌐 Certificación QA: WordPress CMS & Web Hosting

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de WordPress CMS & Web Hosting](docs/qa/playbooks/es/11_wordpress.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Servidor WordPress** (Ver guía: `Se enciende y te da la URL pública del puerto web.`)
- [ ] **Paso 2: Completar Asistente de Instalación** (Ver guía: `WordPress se instala sin pedirte credenciales de base de datos porque se autoconfiguraron.`)
- [ ] **Paso 3: Instalar Plugin y Subir Imagen** (Ver guía: `La imagen sube y el plugin se instala sin problemas de permisos de escritura en disco.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Emparejamiento de Contenedor MariaDB Dedicado** (`docker ps | grep wordpress`)
- [ ] **TC-DEV-2: Copia de Seguridad Atómica de Archivos y Dump SQL** (`curl -X POST http://localhost:3000/api/servers/<id>/backup -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::wordpress"
