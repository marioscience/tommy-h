## 🗄️ Certificación QA: Base de Datos Independiente (MariaDB / MySQL)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Base de Datos Independiente (MariaDB / MySQL)](docs/qa/playbooks/es/12_database.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Crear Base de Datos y Encender** (Ver guía: `Enciende en verde y muestra el puerto 3306 asignado.`)
- [ ] **Paso 2: Entrar a phpMyAdmin con 1-Clic** (Ver guía: `Abre la interfaz de phpMyAdmin con la sesión iniciada automáticamente.`)
- [ ] **Paso 3: Crear Tabla y Hacer Consulta** (Ver guía: `La tabla se crea y la consulta SELECT muestra los datos.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Conexión Externa Remota con Cliente SQL** (`mysql -h <nodeIp> -P <publicPort> -u <dbUser> -p`)
- [ ] **TC-DEV-2: Prueba de Estrés con Dump SQL de 100MB** (`mysql -h localhost -P <port> -u root -p < big_dump.sql`)

/label ~"qa::in-progress" ~"game::database"
