import cron from 'node-cron';
import { backupQueue } from './backupQueue.js';
import * as serverService from './serverService.js';
import { syncBackupsToRemote } from './backupRemoteService.js';
import { config } from '../config.js';

const PLAN_BACKUP_INTERVAL_HOURS = {
    standard: 24,
    premium: 12,
    platinum: 12,
    game_minecraft: 24,
    game_valheim: 24,
    game_cs2: 24,
    game_sdtd: 24,
    game_zomboid: 24,
    game_fivem: 24,
    game_rust: 12,
    game_palworld: 12,
    game_ark: 12
};

export function startAutoBackups() {
    console.log('[Scheduler] Iniciando sistema de backups automáticos...');

    if (typeof serverService.getAllServers !== 'function') {
        console.error("❌ [Scheduler] ERROR: Falta la función 'getAllServers' en serverService.js.");
        console.error('❌ Los backups automáticos NO se ejecutarán hasta que la añadas.');
        return;
    }

    
    let remoteSyncRunning = false;
    if (config.backupRemoteEnabled) {
        // La sincronizacion remota es opcional y se serializa en el worker de backups.
        cron.schedule('15 * * * *', async () => {
            if (remoteSyncRunning) return;
            remoteSyncRunning = true;
            try {
                await syncBackupsToRemote();
            } catch (err) {
                console.error('[Scheduler] Error en Sync de Backups:', err);
            } finally {
                remoteSyncRunning = false;
            }
        });
    } else {
        console.log('[Scheduler] Sincronizacion remota deshabilitada; los backups locales siguen activos.');
    }

    let scheduleRunning = false;
    cron.schedule('* * * * *', async () => {
        if (scheduleRunning) return;
        scheduleRunning = true;
        try {
        const now = new Date();
        const currentHour = now.getHours().toString().padStart(2, '0');
        const currentMinute = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;
        const servers = await serverService.getAllServers();
        await processAutoBackups(currentTime, servers);
        await processAutoRestarts(currentTime, servers);
        } catch (error) {
            console.error('[Scheduler] Error en ciclo de backups/reinicios:', error);
        } finally {
            scheduleRunning = false;
        }
    });
}

function buildRunTimes(startTime, intervalHours) {
    const [hourRaw, minuteRaw] = String(startTime || '04:00').split(':');
    const startHour = Number.parseInt(hourRaw, 10);
    const minute = String(minuteRaw || '00').padStart(2, '0');
    const safeStartHour = Number.isFinite(startHour) ? startHour : 4;
    const times = [];

    for (let h = safeStartHour; times.length === 0 || h % 24 !== safeStartHour; h += intervalHours) {
        times.push(`${(h % 24).toString().padStart(2, '0')}:${minute}`);
        if (intervalHours >= 24) break;
    }

    return times;
}

async function processAutoBackups(currentTime, servers) {
    try {
        if (!servers || servers.length === 0) return;

        for (const server of servers) {
            const plan = (server.runtime_plan || '').toLowerCase();
            const intervalHours = PLAN_BACKUP_INTERVAL_HOURS[plan];
            if (!intervalHours) continue;

            const timesToRun = buildRunTimes(server.backup_time || '04:00', intervalHours);
            if (!timesToRun.includes(currentTime)) continue;

            try {
                const job = await backupQueue.enqueue(server.id, null, true, 'auto', plan);
                console.log(`[AutoBackup] Encolado ${job.jobId} para servidor ${server.id} (Plan: ${plan}, Hora: ${currentTime})`);
            } catch (err) {
                console.error(`[AutoBackup] Fallo al encolar ${server.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('[AutoBackup] Error crítico al obtener la lista de servidores:', error);
    }
}

async function processAutoRestarts(currentTime, servers) {
    try {
        if (!servers || servers.length === 0) return;

        for (const server of servers) {
            if (!server.auto_restart_enabled) continue;
            if (server.auto_restart_time !== currentTime) continue;

            console.log(`[AutoRestart] Iniciando reinicio programado para servidor ${server.id} (${server.name}) a las ${currentTime}`);

            if (server.backup_before_restart) {
                try {
                    const plan = (server.runtime_plan || 'hobby').toLowerCase();
                    const job = await backupQueue.enqueue(server.id, null, true, 'pre-restart', plan);
                    console.log(`[AutoRestart] Encolado backup previo al reinicio ${job.jobId} para servidor ${server.id}`);
                } catch (err) {
                    console.error(`[AutoRestart] Fallo al encolar backup previo para ${server.id}:`, err.message);
                }
            }

            try {
                const { controlServer } = await import('./serverControlService.js');
                await controlServer(server.id, server.owner_id, 'restart', true);
            } catch (err) {
                console.error(`[AutoRestart] Fallo al reiniciar ${server.id}:`, err.message);
            }
        }
    } catch (error) {
        console.error('[AutoRestart] Error en bucle de reinicios:', error);
    }
}
