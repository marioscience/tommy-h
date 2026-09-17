import net from 'net';
import { sendCommandToContainer } from '../dockerService.js';
import { encodeSourceRconPacket, SourceRconDecoder } from '../../utils/sourceRconProtocol.js';

const RCON_TIMEOUT_MS = 3000;
export const SOURCE_RCON_GAMES = Object.freeze(['cs2', 'palworld', 'ark', 'zomboid']);

function sendRconPacket(socket, id, type, body) {
  socket.write(encodeSourceRconPacket(id, type, body));
}

/** Execute one authenticated Source RCON command with a controlled stdin fallback. */
export async function executeRconCommand(host, port, password, command, containerName = null, template = null) {
  if (port === 0 || (template && !SOURCE_RCON_GAMES.includes(template))) {
    if (['GetChat', 'ListPlayers', 'ShowPlayers', 'status'].includes(command)) {
      throw new Error('RCON de lectura no disponible por red directa para este servidor.');
    }
    if (containerName) {
      await sendCommandToContainer(containerName, command);
      return 'Comando enviado al contenedor.';
    }
    throw new Error('No se puede ejecutar el comando sin contenedor.');
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(RCON_TIMEOUT_MS);
    let authenticated = false;
    let responseData = '';
    const decoder = new SourceRconDecoder();
    const requestId = Math.floor(Math.random() * 1000) + 1;
    const cleanup = () => socket.destroy();

    socket.on('connect', () => sendRconPacket(socket, requestId, 3, password));
    socket.on('data', data => {
      try {
        for (const { id, type, body, size } of decoder.push(data)) {
          if (type === 2) {
            if (id === -1) {
              cleanup();
              return reject(new Error('Autenticación RCON fallida (contraseña incorrecta).'));
            }
            authenticated = true;
            sendRconPacket(socket, requestId + 1, 2, command);
          } else if (type === 0 && authenticated) {
            responseData += body;
            if (body.length > 0 && size < 4000) {
              cleanup();
              return resolve(responseData.trim());
            }
          }
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    const fallback = async error => {
      cleanup();
      if (command === 'GetChat' || command === 'ListPlayers') return reject(error);
      if (!containerName) return reject(error);
      try {
        await sendCommandToContainer(containerName, command);
        resolve('Comando enviado al contenedor (fallback).');
      } catch (fallbackError) {
        reject(new Error(`${error.message} y fallo en fallback: ${fallbackError.message}`));
      }
    };

    socket.on('timeout', () => fallback(new Error('Tiempo de espera agotado para la conexión RCON.')));
    socket.on('error', error => fallback(error));
    socket.connect(port, host);
  });
}
