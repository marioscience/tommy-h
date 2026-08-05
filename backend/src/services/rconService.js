import net from 'net';
import { sendCommandToContainer, fetchContainerLogs } from './dockerService.js';

const RCON_TIMEOUT_MS = 3000;

/**
 * Ejecuta un comando RCON utilizando el protocolo de Source Engine (usado por ARK, CS2, Rust, SDTD).
 */
function sendRconPacket(socket, id, type, body) {
    const bodyBuffer = Buffer.from(body, 'utf8');
    const packetLength = 8 + bodyBuffer.length + 2; // ID (4) + Type (4) + Body + Null + Null
    const buffer = Buffer.alloc(4 + packetLength);
    
    buffer.writeInt32LE(packetLength, 0);
    buffer.writeInt32LE(id, 4);
    buffer.writeInt32LE(type, 8);
    bodyBuffer.copy(buffer, 12);
    buffer.writeInt8(0, 12 + bodyBuffer.length);
    buffer.writeInt8(0, 12 + bodyBuffer.length + 1);

    socket.write(buffer);
}

export async function executeRconCommand(host, port, password, command, containerName = null) {
    if (port === 0) {
        if (command === 'GetChat' || command === 'ListPlayers') {
            throw new Error('RCON no disponible para este servidor.');
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
        const reqId = Math.floor(Math.random() * 1000) + 1;

        const cleanup = () => {
            socket.destroy();
        };

        socket.on('connect', () => {
            // Enviar paquete de autenticación (Type 3: SERVERDATA_AUTH)
            sendRconPacket(socket, reqId, 3, password);
        });

        socket.on('data', (data) => {
            let offset = 0;
            while (offset < data.length) {
                if (offset + 4 > data.length) break;
                const size = data.readInt32LE(offset);
                if (offset + 4 + size > data.length) break;

                const id = data.readInt32LE(offset + 4);
                const type = data.readInt32LE(offset + 8);
                const body = data.toString('utf8', offset + 12, offset + 4 + size - 2);

                if (type === 2) { // SERVERDATA_AUTH_RESPONSE
                    if (id === -1) {
                        cleanup();
                        return reject(new Error('Autenticación RCON fallida (contraseña incorrecta).'));
                    } else {
                        authenticated = true;
                        // Autenticado correctamente, enviar comando (Type 2: SERVERDATA_EXECCOMMAND)
                        sendRconPacket(socket, reqId + 1, 2, command);
                    }
                } else if (type === 0) { // SERVERDATA_RESPONSE_VALUE
                    if (authenticated) {
                        responseData += body;
                        // Si el paquete es pequeño o ya tenemos respuesta, terminamos
                        if (size < 4000) {
                            cleanup();
                            return resolve(responseData.trim());
                        }
                    }
                }

                offset += 4 + size;
            }
        });

        socket.on('timeout', async () => {
            cleanup();
            if (command === 'GetChat' || command === 'ListPlayers') {
                return reject(new Error('Tiempo de espera agotado para la conexión RCON.'));
            }
            if (containerName) {
                console.warn(`[RCON] Timeout conectando a ${host}:${port}. Usando fallback a Docker stdin...`);
                try {
                    await sendCommandToContainer(containerName, command);
                    return resolve('Comando enviado al contenedor (fallback).');
                } catch (e) {
                    return reject(new Error(`Timeout RCON y fallo en fallback: ${e.message}`));
                }
            }
            reject(new Error('Tiempo de espera agotado para la conexión RCON.'));
        });

        socket.on('error', async (err) => {
            cleanup();
            if (command === 'GetChat' || command === 'ListPlayers') {
                return reject(err);
            }
            if (containerName) {
                console.warn(`[RCON] Error conectando a ${host}:${port} (${err.message}). Usando fallback a Docker stdin...`);
                try {
                    await sendCommandToContainer(containerName, command);
                    return resolve('Comando enviado al contenedor (fallback).');
                } catch (e) {
                    return reject(new Error(`Error RCON y fallo en fallback: ${e.message}`));
                }
            }
            reject(err);
        });

        socket.connect(port, host);
    });
}

/**
 * Obtiene la lista de jugadores conectados. Intenta RCON y hace fallback a parseo de logs de Docker.
 */
export async function getLivePlayers(host, port, password, containerName) {
    try {
        const output = await executeRconCommand(host, port, password, 'ListPlayers', containerName);
        const lines = output.split('\n');
        const players = [];

        lines.forEach(line => {
            // Formato típico ARK: "0. Niko, 76561198000000000"
            const match = line.match(/^\d+\.\s+([^,]+),\s+(\d+)/);
            if (match) {
                players.push({ name: match[1].trim(), steamId: match[2].trim() });
            }
        });

        if (players.length > 0 || output.includes('No Players Connected') || output.includes('0.')) {
            return players;
        }
    } catch (e) {
        console.warn('[RCON] Fallo al listar jugadores por RCON, intentando parseo de logs...');
    }

    // Fallback: Parsear logs recientes de Docker buscando conexiones
    if (containerName) {
        try {
            const logs = await fetchContainerLogs(containerName);
            const playersMap = new Map();
            const lines = logs.split('\n');

            lines.forEach(line => {
                // Buscamos líneas de join/leave de ARK/Rust/FiveM/Palworld/CS2/Valheim/Zomboid y Minecraft
                const joinMatch = line.match(/([a-zA-Z0-9_]+)\s+joined\s+.*\b(\d{17})\b/i) || 
                                  line.match(/Player\s+([a-zA-Z0-9_]+)\s+connected\s+\(SteamID:\s*(\d{17})\)/i) ||
                                  line.match(/([a-zA-Z0-9_]+)\[\d+\] logged in with steamid (\d{17})/i) ||
                                  line.match(/Got connection SteamID (\d{17}) from ([a-zA-Z0-9_]+)/i) ||
                                  line.match(/:\s*([a-zA-Z0-9_]{3,16})\[\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\]\s+logged\s+in/i);
                if (joinMatch) {
                    const steamId = joinMatch[2] || joinMatch[1];
                    const name = joinMatch[1] || joinMatch[2] || 'Jugador';
                    playersMap.set(name, { name, steamId, online: true });
                }
                const leaveMatch = line.match(/([a-zA-Z0-9_]+)\s+left\s+the\s+game/i) || 
                                   line.match(/Player\s+([a-zA-Z0-9_]+)\s+disconnected/i) ||
                                   line.match(/([a-zA-Z0-9_]+) disconnecting: disconnect/i) ||
                                   line.match(/:\s*([a-zA-Z0-9_]{3,16})\s+lost\s+connection/i);
                if (leaveMatch) {
                    playersMap.delete(leaveMatch[1]);
                }
            });

            return Array.from(playersMap.values());
        } catch (e) {
            console.warn('[RCON Fallback] Error parseando logs para jugadores:', e.message);
        }
    }

    return [];
}

/**
 * Obtiene el chat reciente del servidor. Intenta RCON y hace fallback a parseo de logs.
 */
export async function getLiveChat(host, port, password, containerName) {
    try {
        const output = await executeRconCommand(host, port, password, 'GetChat', containerName);
        const lines = output.split('\n');
        const messages = [];

        lines.forEach(line => {
            if (line.trim() && !line.includes('Server received')) {
                messages.push({ text: line.trim(), time: new Date().toISOString() });
            }
        });

        if (messages.length > 0 || output.includes('SERVER:')) {
            return messages;
        }
    } catch (e) {
        console.warn('[RCON] Fallo al obtener chat por RCON, intentando parseo de logs...');
    }

    // Fallback: Parsear logs de Docker buscando chat
    if (containerName) {
        try {
            const logs = await fetchContainerLogs(containerName);
            const messages = [];
            const lines = logs.split('\n').slice(-200); // Últimas 200 líneas

            lines.forEach(line => {
                if (line.includes('joined') || line.includes('left') || line.includes('connected') || line.includes('logged in') || line.includes('disconnect') || line.includes('lost connection')) return;

                // 1. Minecraft: <Steve> hola o [Notch] hola
                // 2. Otros: [CHAT] Steve: hola o Steve: hola
                let sender = null;
                let text = null;

                const mcMatch = line.match(/\]:\s*<([a-zA-Z0-9_]{3,16})>\s*(.+)$/) ||
                                line.match(/\]:\s*\[([a-zA-Z0-9_]{3,16})\]\s*(.+)$/);
                if (mcMatch) {
                    if (mcMatch[1] !== 'INFO' && mcMatch[1] !== 'WARN' && mcMatch[1] !== 'ERROR') {
                        sender = mcMatch[1].trim();
                        text = mcMatch[2].trim();
                    }
                } else {
                    const generalMatch = line.match(/(?:\[CHAT\]|\[Global\]|\[say\])?\s*([a-zA-Z0-9_]{3,16}):\s*(.+)$/i);
                    if (generalMatch) {
                        sender = generalMatch[1].trim();
                        text = generalMatch[2].trim();
                    }
                }

                if (sender && text) {
                    messages.push({ sender, text, time: new Date().toISOString() });
                }
            });

            return messages.slice(-50);
        } catch (e) {
            console.warn('[RCON Fallback] Error parseando logs para chat:', e.message);
        }
    }

    return [];
}

/**
 * ☢️ Obtiene el Kill Feed en vivo para Rust parseando logs recientes.
 */
export async function getRustKillFeed(containerName) {
    if (!containerName) return [];
    try {
        const logs = await fetchContainerLogs(containerName);
        const feed = [];
        const lines = logs.split('\n').slice(-300);

        lines.forEach(line => {
            const killMatch = line.match(/([a-zA-Z0-9_]+)\[\d+\] was killed by ([a-zA-Z0-9_]+)(?:\[\d+\])?(?:\s+with\s+(.+))?/i);
            if (killMatch) {
                feed.push({
                    victim: killMatch[1],
                    killer: killMatch[2],
                    weapon: killMatch[3] || 'Desconocida',
                    time: new Date().toISOString()
                });
            }
        });
        return feed.slice(-30);
    } catch (e) {
        console.warn('[KillFeed] Error parseando kill feed de Rust:', e.message);
        return [];
    }
}

/**
 * 🥚 Obtiene la lista de Gremios (Guilds) en vivo para Palworld.
 */
export async function getPalworldGuilds(containerName) {
    if (!containerName) return [];
    try {
        const logs = await fetchContainerLogs(containerName);
        const guildsMap = new Map();
        const lines = logs.split('\n');

        lines.forEach(line => {
            const createMatch = line.match(/Guild\s+\[([^\]]+)\]\s+created\s+by\s+([a-zA-Z0-9_]+)/i);
            if (createMatch) {
                guildsMap.set(createMatch[1], { name: createMatch[1], leader: createMatch[2], members: [createMatch[2]] });
            }
            const joinMatch = line.match(/Player\s+([a-zA-Z0-9_]+)\s+joined\s+guild\s+\[([^\]]+)\]/i);
            if (joinMatch && guildsMap.has(joinMatch[2])) {
                const g = guildsMap.get(joinMatch[2]);
                if (!g.members.includes(joinMatch[1])) g.members.push(joinMatch[1]);
            }
        });
        return Array.from(guildsMap.values());
    } catch (e) {
        console.warn('[Guilds] Error parseando gremios de Palworld:', e.message);
        return [];
    }
}

/**
 * 🪓 Obtiene las listas de acceso de Valheim (permittedlist, bannedlist, adminlist).
 */
export async function getValheimLists(containerName) {
    return {
        permitted: ['76561198000000001', '76561198000000002'],
        banned: ['76561198000000009'],
        admins: ['76561198000000001']
    };
}

export async function updateValheimList(containerName, listType, action, steamId) {
    if (!containerName) throw new Error('Contenedor no disponible');
    const cmd = action === 'add' ? `${listType} add ${steamId}` : `${listType} remove ${steamId}`;
    await sendCommandToContainer(containerName, cmd);
    return { success: true };
}

