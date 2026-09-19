## 🤖 Certificación QA: Discord Bot (Node.js & Python Dual Runtime)

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Discord Bot (Node.js & Python Dual Runtime)](docs/qa/playbooks/es/10_discord_bot.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Subir Archivos del Bot** (Ver guía: `Los archivos se suben correctamente a la raíz /data.`)
- [ ] **Paso 2: Instalar Dependencias a 1-Clic** (Ver guía: `La consola ejecuta npm install o pip install -r requirements.txt con éxito.`)
- [ ] **Paso 3: Encender Bot y Verificar en Discord** (Ver guía: `El bot aparece en verde ("Online") en tu servidor de Discord y responde a comandos.`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Reinicio Automático ante Excepción Fatal** (`docker exec -it <bot-container> kill -9 1`)
- [ ] **TC-DEV-2: Seguridad y Ocultación de Tokens en Logs** (`docker logs <bot-container>`)

/label ~"qa::in-progress" ~"game::discordbot"
