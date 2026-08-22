import nodeCron from 'node-cron';
import { query } from '../db.js';
import * as serverService from './serverService.js';
import { getContainerStats } from './dockerService.js';
import { checkServerAlerts } from './alertService.js';

export function startStatsCollector() {
    console.log("📈 [StatsCollector] Iniciando recolector de estadísticas históricas...");

    // Cada 5 minutos recolectamos datos de todos los servidores activos
    nodeCron.schedule('*/5 * * * *', async () => {
        try {
            const servers = await serverService.getAllServers();
            const statsPromises = servers.map(async (server) => {
                if (server.status === 'running') {
                    try {
                        const stats = await getContainerStats(server.container_name);
                        if (stats && stats.cpu !== undefined) {
                            await query(
                                'INSERT INTO server_stats_history (server_id, cpu, ram, ram_gb) VALUES ($1, $2, $3, $4)',
                                [server.id, parseFloat(stats.cpu), parseFloat(stats.ram), parseFloat(stats.ramGb)]
                            );
                            await checkServerAlerts(server, stats);
                        }
                    } catch (e) {
                        console.error(`❌ Error recolectando stats para ${server.name}:`, e.message);
                    }
                }
            });
            await Promise.all(statsPromises);
            
            // Limpieza: Borrar datos de más de 7 días para no saturar la DB
            await query("DELETE FROM server_stats_history WHERE created_at < NOW() - INTERVAL '7 days'");
            
        } catch (error) {
            console.error("❌ [StatsCollector] Error recolectando estadísticas:", error);
        }
    });
}
