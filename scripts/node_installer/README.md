# Ragenodes Core Installer

Este directorio contiene las herramientas necesarias para transformar cualquier servidor Linux virgen en un **Nodo Esclavo (Core)** preparado para alojar servidores de juego y ser controlado remotamente por el panel maestro de Ragenodes Ultimate.

## ¿Por qué no usar OxideProxy en los esclavos?
Ragenodes Ultimate utiliza una arquitectura descentralizada (Edge Computing) para los servidores de juegos.
- **Tráfico Web/API:** Pasa por tu Servidor Maestro y su OxideProxy.
- **Tráfico de Juegos (UDP/TCP):** Pasa **directamente** desde los jugadores hacia la IP pública del Nodo Esclavo. Esto garantiza el menor ping posible sin cuellos de botella.

Para que el Maestro le dé órdenes al Esclavo (como "arranca un servidor de Minecraft"), utilizan la API de Docker asegurada con **mTLS** (Autenticación Mutua por Certificados). El script de esta carpeta se encarga de configurarlo todo automáticamente.

---

## 🛠️ Instrucciones de Instalación

Sigue estos pasos en el servidor remoto que quieres convertir en un nuevo Nodo.

### Paso 1: Ejecutar el script en el servidor remoto
Conéctate por SSH al nuevo servidor (el esclavo) y ejecuta:

```bash
wget https://raw.githubusercontent.com/TuUsuario/ragenodes-ultimate/main/scripts/node_installer/install_node.sh
chmod +x install_node.sh
sudo ./install_node.sh
```
*(Nota: Si no lo tienes en un repositorio público, simplemente copia y pega el contenido del archivo `install_node.sh` usando `nano install_node.sh`).*

### Paso 2: Registrar el Nodo en el Panel Maestro
1. Entra a la base de datos o al panel admin de Ragenodes en tu servidor maestro.
2. Añade el nuevo nodo insertando su IP pública.
3. Anota el ID numérico que se le asigne a este nuevo nodo (ej. `1`, `2`, `3`).

### Paso 3: Copiar los Certificados
Al finalizar la ejecución del script en el esclavo, verás en la pantalla el contenido de tres certificados.
Debes crear estos tres archivos en el **servidor maestro**, exactamente en esta ruta:
`/opt/ragenodes-ultimate/certs/nodes/[ID_DEL_NODO]/`

Ejemplo si el ID del nodo es `1`:
- `/opt/ragenodes-ultimate/certs/nodes/1/cert.pem` -> Pega el contenido del Client Cert impreso en pantalla.
- `/opt/ragenodes-ultimate/certs/nodes/1/key.pem` -> Pega el contenido del Client Key impreso en pantalla.
- `/opt/ragenodes-ultimate/certs/ca/ca.pem` -> Pega el CA (Solo necesario la primera vez, ya que es el mismo para todos).

### Paso 4: Reiniciar el Backend
En el servidor maestro, reinicia el backend de Node.js para que cargue los nuevos certificados en memoria:
```bash
# Si usas pm2
pm2 restart ragenodes-backend
```

¡Listo! Tu servidor maestro ahora puede desplegar servidores de Rust, Palworld, CS2, etc., en la infraestructura remota de forma 100% automatizada y encriptada.
