import axios from 'axios';
import { query } from '../db.js';

const ALERT_THRESHOLD_CPU = 90; // %
const ALERT_THRESHOLD_RAM = 95; // %
const ALERT_COOLDOWN = 1000 * 60 * 30; // 30 minutos entre alertas

const lastAlerts = new Map(); // serverId -> timestamp

export async function checkServerAlerts(server, stats) {
    if (!server.alert_webhook) return;

    const cpu = parseFloat(stats.cpu);
    const ram = parseFloat(stats.ram);

    let alertMsg = "";
    if (cpu >= ALERT_THRESHOLD_CPU) {
        alertMsg = `⚠️ **Uso Crítico de CPU:** El servidor **${server.name}** está al **${cpu}%** de carga.`;
    } else if (ram >= ALERT_THRESHOLD_RAM) {
        alertMsg = `⚠️ **Uso Crítico de RAM:** El servidor **${server.name}** está al **${ram}%** de su capacidad.`;
    }

    if (alertMsg) {
        const now = Date.now();
        const lastAlert = lastAlerts.get(server.id) || 0;

        if (now - lastAlert > ALERT_COOLDOWN) {
            try {
                await sendDiscordAlert(server.alert_webhook, alertMsg);
                lastAlerts.set(server.id, now);
                console.log(`[AlertService] Alerta enviada para ${server.name}`);
            } catch (e) {
                console.error(`[AlertService] Error enviando alerta a Discord:`, e.message);
            }
        }
    }
}

async function sendDiscordAlert(webhookUrl, message) {
    await axios.post(webhookUrl, {
        embeds: [{
            title: "📈 RageNodes Monitoring",
            description: message,
            color: 0xef4444, // Rojo Danger
            timestamp: new Date().toISOString(),
            footer: { text: "RageNodes High Performance Infrastructure" }
        }]
    });
}
