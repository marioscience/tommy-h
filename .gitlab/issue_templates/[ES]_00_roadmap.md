## 🚀 Certificación QA: Hoja de Ruta de la Plataforma y Nuevas Funcionalidades

> 📖 **Guía completa paso a paso**: Consulta la [Guía de Pruebas de Hoja de Ruta de la Plataforma y Nuevas Funcionalidades](docs/qa/playbooks/es/00_roadmap.md).

### 🎮 Parte 1: Pruebas de Jugador (Tester de QA)
*Marca las casillas conforme vayas jugando y probando cada función:*

- [ ] **Paso 1: Verificar Despliegue Instantáneo en el Panel** (Ver guía: `El servidor se crea, muestra estado "En línea" en menos de 2 minutos y genera su IP.`)
- [ ] **Paso 2: Probar el Editor de Código Monaco** (Ver guía: `El editor resalta la sintaxis correctamente y guarda los cambios sin recargar la página.`)
- [ ] **Paso 3: Probar la Protección Vault en Archivos Protegidos** (Ver guía: `El sistema bloquea la edición mostrando "Vault Protection: Archivo protegido".`)

> 💬 **¿Terminaste las pruebas de jugador?** Deja un comentario etiquetando a los desarrolladores:  
> `@devs Pruebas de jugador terminadas con éxito. Listo para la revisión técnica.`

### ⚙️ Parte 2: Pruebas Técnicas (Programadores)
*Comandos de terminal para el equipo de desarrollo:*

- [ ] **TC-DEV-1: Mitigación DDoS con OxideProxy eBPF/XDP** (`docker logs ragenodes_oxideproxy | grep -i "ebpf"`)
- [ ] **TC-DEV-2: Cola de Backups con Prioridad por Rango** (`docker exec -it ragenodes_backend node -e "import('./src/services/backupQueue.js').then(m => console.log(m.backupQueue))"`)
- [ ] **TC-DEV-3: Migración en Caliente Multi-Nodo** (`curl -s http://localhost:3000/api/admin/nodes -H "Authorization: Bearer $TOKEN"`)
- [ ] **TC-DEV-4: Streaming de Logs con LogHub y Heartbeat SSE** (`curl -N -H "Accept: text/event-stream" http://localhost:3000/api/servers/1/logs/stream -H "Authorization: Bearer $TOKEN"`)

/label ~"qa::in-progress" ~"game::roadmap"
