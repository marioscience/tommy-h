import { config } from '../config.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
const IP_CHECK_SERVICE = 'https://api.ipify.org?format=json';

let lastIp = null;

/**
 * Obtiene la IP pública actual del servidor
 */
const getPublicIp = async () => {
    try {
        const response = await fetch(IP_CHECK_SERVICE);
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.error("❌ DDNS: Error al obtener IP pública:", error.message);
        return null;
    }
};

/**
 * Actualiza el registro DNS en Cloudflare
 */
const updateDnsRecord = async (ip) => {
    const { cfApiToken, cfZoneId, cfDdnsDomain } = config;

    if (!cfApiToken || !cfZoneId || !cfDdnsDomain) {
        console.warn("⚠️ DDNS: Faltan credenciales o dominio en el .env. Saltando actualización.");
        return;
    }

    try {
        const domain = cfDdnsDomain.trim();
        const zone = cfZoneId.trim();

        const listResponse = await fetch(`${CF_API}/zones/${zone}/dns_records?name=${domain}&type=A`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfApiToken.trim()}` }
        });

        const listData = await listResponse.json();
        
        // Si no se encuentra el registro, intentamos crearlo
        if (!listData.success || (listData.result && listData.result.length === 0)) {
            console.warn(`☁️ DDNS: No se encontró el registro A para [${domain}]. Intentando crearlo...`);
            const createResp = await fetch(`${CF_API}/zones/${zone}/dns_records`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${cfApiToken.trim()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    type: 'A',
                    name: domain,
                    content: ip,
                    ttl: 60,
                    proxied: false
                })
            });
            const createData = await createResp.json();
            if (createData.success) {
                console.log(`✅ DDNS: Registro A creado exitosamente para ${domain} -> ${ip}`);
                lastIp = ip;
            } else {
                console.error(`❌ DDNS Error Crítico: No se pudo crear el registro.`, createData.errors);
            }
            return;
        }

        const record = listData.result[0];

        // Si la IP ya es la misma, no hacemos nada
        if (record.content === ip) {
            console.log(`☁️ DDNS: La IP no ha cambiado (${ip}).`);
            return;
        }

        // 2. Actualizar el registro
        const updateResponse = await fetch(`${CF_API}/zones/${cfZoneId}/dns_records/${record.id}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${cfApiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: ip,
                ttl: 60, // TTL bajo para actualizaciones rápidas
                proxied: false // Recomendado desactivar proxy para servidores de juego si se usa el gateway directamente
            })
        });

        const updateData = await updateResponse.json();
        if (updateData.success) {
            console.log(`✅ DDNS: IP actualizada correctamente: ${cfDdnsDomain} -> ${ip}`);
            lastIp = ip;
        } else {
            console.error("❌ DDNS: Error al actualizar registro:", updateData.errors);
        }
    } catch (error) {
        console.error("❌ DDNS: Error en la comunicación con Cloudflare:", error.message);
    }
};

/**
 * Ciclo principal de DDNS
 */
export const startDdnsService = () => {
    console.log("☁️ DDNS: Iniciando servicio de actualización dinámica...");

    const check = async () => {
        const currentIp = await getPublicIp();
        if (currentIp && currentIp !== lastIp) {
            await updateDnsRecord(currentIp);
        }
    };

    // Ejecutar inmediatamente al inicio
    check();

    // Y luego cada 5 minutos
    setInterval(check, 5 * 60 * 1000);
};
