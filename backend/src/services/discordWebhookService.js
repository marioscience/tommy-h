import axios from 'axios';

const EVENT_CONFIGS = {
    online: {
        title: '🟢 Servidor Iniciado',
        color: 0x22c55e, // Verde
        text: 'El servidor está ahora en línea y listo para aceptar conexiones.'
    },
    offline: {
        title: '🔴 Servidor Detenido',
        color: 0xef4444, // Rojo
        text: 'El servidor se ha detenido o ha sido apagado.'
    },
    player_join: {
        title: '👤 Jugador Conectado',
        color: 0x38bdf8, // Azul claro
        text: 'Un jugador se ha unido al servidor.'
    },
    player_leave: {
        title: '👋 Jugador Desconectado',
        color: 0xf59e0b, // Ámbar
        text: 'Un jugador ha salido del servidor.'
    },
    update: {
        title: '📦 Copia de Seguridad / Mantenimiento',
        color: 0x8b5cf6, // Morado
        text: 'Se ha completado una tarea de copia de seguridad o mantenimiento programado.'
    }
};

/**
 * Envía una notificación enriquecida (Discord Embed) a una URL de webhook.
 */
export async function sendWebhookNotification(webhookUrl, subscribedEvents = [], eventType, serverName, details = {}) {
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
        return;
    }

    // Verificar si el evento está suscrito
    const safeEvents = Array.isArray(subscribedEvents) ? subscribedEvents : ['online', 'offline', 'player_join', 'player_leave', 'update'];
    if (!safeEvents.includes(eventType)) {
        return;
    }

    const config = EVENT_CONFIGS[eventType] || {
        title: 'ℹ️ Notificación del Servidor',
        color: 0x64748b,
        text: 'Se ha registrado un nuevo evento en el servidor.'
    };

    const embed = {
        title: `${config.title} - ${serverName}`,
        description: details.customText || config.text,
        color: config.color,
        fields: [],
        footer: {
            text: 'RageNodes Ultimate Panel',
            icon_url: 'https://ragenodes.com/logo.png' // Fallback a logo oficial
        },
        timestamp: new Date().toISOString()
    };

    if (details.playerName) {
        embed.fields.push({ name: 'Jugador', value: details.playerName, inline: true });
    }
    if (details.steamId) {
        embed.fields.push({ name: 'SteamID', value: details.steamId, inline: true });
    }
    if (details.backupName) {
        embed.fields.push({ name: 'Archivo de Backup', value: details.backupName, inline: true });
    }
    if (details.sizeMb) {
        embed.fields.push({ name: 'Tamaño', value: `${details.sizeMb} MB`, inline: true });
    }

    try {
        await axios.post(webhookUrl, { embeds: [embed] }, { timeout: 4000 });
    } catch (e) {
        console.warn(`[Discord Webhook] Fallo al enviar webhook a ${webhookUrl.slice(0, 30)}...:`, e.message);
    }
}
