import { config } from '../config.js';
import { query } from '../db.js';
import * as Docker from './dockerService.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

let isUpdating = false;
const queue = [];

const getRagenodesTunnelHostname = (serverId, targetPort = null, txadminUrl = '') => {
    try {
        const parsed = new URL(txadminUrl);
        if (/^tx[0-9]+\.ragenodes\.com$/i.test(parsed.hostname)) {
            return parsed.hostname.toLowerCase();
        }
    } catch {}

    if (targetPort) {
        return `tx${targetPort}.ragenodes.com`;
    }
    return `tx${serverId.split('-')[0]}.ragenodes.com`; // Fallback (not recommended)
};

const processQueue = async () => {
    if (isUpdating || queue.length === 0) return;
    isUpdating = true;
    const { serverId, targetPort, action, targetIp, hostname, resolve, reject } = queue.shift();
    try {
        await executeUpdate(serverId, targetPort, action, targetIp, hostname);
        // Esperar 10 segundos antes de permitir la siguiente para evitar Rate Limit agresivo
        await new Promise(resolve => setTimeout(resolve, 10000));
        resolve();
    } catch (e) {
        reject(e);
    } finally {
        isUpdating = false;
        processQueue();
    }
};

export const updateTunnelConfig = (serverId, targetPort, action = 'add', targetIp = 'host.docker.internal', hostname = null) => {
    return new Promise((resolve, reject) => {
        const exists = queue.some(q => q.serverId === serverId && q.action === action);
        if (exists) return resolve();
        queue.push({ serverId, targetPort, action, targetIp, hostname, resolve, reject });
        processQueue();
    });
};

export const updateServerTunnelConfig = (serverId, targetPort, txadminUrl, action = 'add', targetIp = 'host.docker.internal') => {
    const hostname = getRagenodesTunnelHostname(serverId, targetPort, txadminUrl);
    return updateTunnelConfig(serverId, targetPort, action, targetIp, hostname);
};

const executeUpdate = async (serverId, targetPort, action = 'add', targetIp = 'host.docker.internal', hostnameOverride = null) => {
    const { cfAccountId, cfTunnelId, cfApiToken, cfZoneId, cfEmail } = config;

    if (!cfApiToken || !cfAccountId || !cfTunnelId || !cfZoneId) {
        console.warn("⚠️ Cloudflare: Faltan credenciales en el .env. Saltando actualización.");
        return;
    }

    if (action === 'add' && targetIp === 'host.docker.internal') {
        try {
            const { rows } = await query("SELECT n.ip_address, s.node_id FROM servers s LEFT JOIN nodes n ON s.node_id = n.id WHERE s.id::text LIKE $1 || '%'", [serverId]);
            if (rows.length > 0 && rows[0].node_id > 0) {
                targetIp = rows[0].ip_address;
                console.log(`☁️ Cloudflare: Target IP resuelta dinámicamente a ${targetIp} para el nodo ${rows[0].node_id}`);
            }
        } catch (e) {
            console.error("❌ Cloudflare: Error resolviendo IP del nodo:", e.message);
        }
    }

    const trimmedToken = cfApiToken.trim();
    const isToken = trimmedToken.startsWith('cfk_') || trimmedToken.startsWith('cfut_') || trimmedToken.length > 40;

    const headers = {};
    if (isToken) {
        headers['Authorization'] = `Bearer ${trimmedToken}`;
    } else {
        headers['X-Auth-Email'] = cfEmail.trim();
        headers['X-Auth-Key'] = trimmedToken;
    }
    headers['Content-Type'] = 'application/json';

    const hostname = hostnameOverride || `tx${targetPort}.ragenodes.com`;
    console.log(`DEBUG: Cloudflare -> Host: ${hostname} | Target: ${targetIp}:${targetPort} | Auth: ${isToken ? 'Bearer (Token)' : 'X-Auth-Key (Global)'}`);

    try {
        // 1. Asegurar registro DNS CNAME
        if (action === 'add') {
            console.log(`☁️ Cloudflare: Verificando DNS para ${hostname}...`);
            const dnsResp = await fetch(`${CF_API}/zones/${cfZoneId}/dns_records?name=${hostname}`, {
                headers: headers
            });
            const dnsData = await dnsResp.json();

            const expectedContent = `${cfTunnelId}.cfargotunnel.com`;
            if (dnsData.result && dnsData.result.length === 0) {
                console.log(`☁️ Cloudflare: Creando CNAME para ${hostname}...`);
                await fetch(`${CF_API}/zones/${cfZoneId}/dns_records`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        type: 'CNAME',
                        name: hostname,
                        content: expectedContent,
                        proxied: true
                    })
                });
            } else if (dnsData.result) {
                for (const record of dnsData.result) {
                    if (record.content !== expectedContent || record.proxied !== true) {
                        await fetch(`${CF_API}/zones/${cfZoneId}/dns_records/${record.id}`, {
                            method: 'PUT',
                            headers: headers,
                            body: JSON.stringify({
                                type: 'CNAME',
                                name: hostname,
                                content: expectedContent,
                                proxied: true
                            })
                        });
                    }
                }
            }
        }

        // 2. Obtener la configuración actual del túnel
        const response = await fetch(`${CF_API}/accounts/${cfAccountId}/cfd_tunnel/${cfTunnelId}/configurations`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            const errorBody = await response.text();
            if (response.status === 401) {
                throw new Error(`Cloudflare: Error de Autenticación (401). El token '${trimmedToken.substring(0, 8)}...' no es válido o le faltan permisos de 'Account: Cloudflare Tunnel'.`);
            }
            throw new Error(`Error obteniendo túnel: ${response.status} - ${errorBody}`);
        }

        const data = await response.json();
        let tunnelConfig = data.result.config;

        if (action === 'add') {
            tunnelConfig.ingress = tunnelConfig.ingress.filter(r => r.hostname !== hostname);
            tunnelConfig.ingress.unshift({
                hostname: hostname,
                service: `http://${targetIp}:${targetPort}`
            });
        } else {
            tunnelConfig.ingress = tunnelConfig.ingress.filter(r => r.hostname !== hostname);
        }

        // 3. Guardar la nueva configuración
        const putResponse = await fetch(`${CF_API}/accounts/${cfAccountId}/cfd_tunnel/${cfTunnelId}/configurations`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ config: tunnelConfig })
        });

        if (!putResponse.ok) {
            const errorBody = await putResponse.text();
            if (putResponse.status === 401) {
                throw new Error(`Cloudflare: Error de Autenticación (401). Verifica que tu API Token tenga permisos de 'Account: Cloudflare Tunnel: Edit' y 'Zone: DNS: Edit'.`);
            }
            throw new Error(`Error actualizando túnel: ${putResponse.status} - ${errorBody}`);
        }

        console.log(`☁️ Cloudflare OK: [${action}] ${hostname} -> ${targetIp}:${targetPort}`);
    } catch (error) {
        console.error("❌ Error Cloudflare API:", error.message);
        throw error; // Re-lanzar para que el loop de mantenimiento sepa que falló
    }
};

export const cleanOrphanedTunnels = async () => {
    const { cfAccountId, cfTunnelId, cfApiToken, cfZoneId, cfEmail } = config;

    if (!cfApiToken || !cfAccountId || !cfTunnelId || !cfZoneId) {
        console.warn("⚠️ Cloudflare Limpieza: Faltan credenciales en el .env. Saltando limpieza.");
        return;
    }

    const trimmedToken = cfApiToken.trim();
    const isToken = trimmedToken.startsWith('cfk_') || trimmedToken.startsWith('cfut_') || trimmedToken.length > 40;

    const headers = {};
    if (isToken) {
        headers['Authorization'] = `Bearer ${trimmedToken}`;
    } else {
        headers['X-Auth-Email'] = cfEmail.trim();
        headers['X-Auth-Key'] = trimmedToken;
    }
    headers['Content-Type'] = 'application/json';

    try {
        // 1. Obtener todos los servidores activos de Postgres
        const { rows } = await query("SELECT id, container_name, txadmin_url, txadmin_port FROM servers");
        const activeHostnames = new Set();

        for (const s of rows) {
            const state = await Docker.resolveContainerState(s.container_name);
            if (state.exists) {
                const shortId = s.id.slice(0, 8);
                if (s.txadmin_port) {
                    activeHostnames.add(`tx${s.txadmin_port}.ragenodes.com`);
                }
                activeHostnames.add(`s${shortId}.ragenodes.com`); // Keep for legacy
                activeHostnames.add(getRagenodesTunnelHostname(shortId, s.txadmin_port, s.txadmin_url));
            }
        }

        // 2. Obtener la configuración actual del túnel en Cloudflare
        const response = await fetch(`${CF_API}/accounts/${cfAccountId}/cfd_tunnel/${cfTunnelId}/configurations`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Error obteniendo túnel en limpieza: ${response.status}`);
        }

        const data = await response.json();
        const tunnelConfig = data.result?.config;
        if (!tunnelConfig || !Array.isArray(tunnelConfig.ingress)) return;

        const validIngress = [];
        const orphanedHostnames = [];

        for (const rule of tunnelConfig.ingress) {
            if (rule.hostname && rule.hostname.endsWith('.ragenodes.com')) {
                if (activeHostnames.has(rule.hostname)) {
                    validIngress.push(rule);
                } else {
                    orphanedHostnames.push(rule.hostname);
                    console.log(`☁️ [Cloudflare Limpieza] Detectado túnel huérfano: ${rule.hostname}. Eliminando...`);
                }
            } else {
                validIngress.push(rule);
            }
        }

        if (orphanedHostnames.length === 0) {
            console.log("☁️ [Cloudflare Limpieza] Todo limpio. No se detectaron túneles huérfanos.");
            return;
        }

        // 3. Guardar la nueva configuración limpia del túnel
        const putResponse = await fetch(`${CF_API}/accounts/${cfAccountId}/cfd_tunnel/${cfTunnelId}/configurations`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({ config: { ...tunnelConfig, ingress: validIngress } })
        });

        if (!putResponse.ok) {
            throw new Error(`Error actualizando túnel en limpieza: ${putResponse.status}`);
        }

        console.log(`☁️ Cloudflare OK: Eliminados ${orphanedHostnames.length} túneles huérfanos del Argo Tunnel.`);

        // 4. Eliminar los registros DNS CNAME asociados en Cloudflare
        for (const hostname of orphanedHostnames) {
            try {
                console.log(`☁️ Cloudflare: Buscando DNS CNAME para ${hostname}...`);
                const dnsResp = await fetch(`${CF_API}/zones/${cfZoneId}/dns_records?name=${hostname}`, { headers });
                const dnsData = await dnsResp.json();
                if (dnsData.result && dnsData.result.length > 0) {
                    for (const record of dnsData.result) {
                        console.log(`☁️ Cloudflare: Eliminando DNS CNAME ${record.id} (${hostname})...`);
                        await fetch(`${CF_API}/zones/${cfZoneId}/dns_records/${record.id}`, { method: 'DELETE', headers });
                    }
                }
            } catch (dnsErr) {
                console.error(`❌ Error eliminando DNS CNAME de ${hostname}:`, dnsErr.message);
            }
        }
    } catch (error) {
        console.error("❌ Error en limpieza de Cloudflare API:", error.message);
    }
};
