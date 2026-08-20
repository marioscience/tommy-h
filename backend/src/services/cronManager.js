import { query } from '../db.js';
import { controlServer } from './serverService.js';
import { sendCommandToContainer } from './dockerService.js';

export function startCronManager() {
    console.log("🕒 [Cron] Gestor de Tareas Programadas iniciado.");
    
    // Revisar cada 60 segundos
    setInterval(async () => {
        try {
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, '0');
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const timeString = `${hours}:${minutes}`;

            // Buscar todos los jobs que coincidan con la hora actual
            const res = await query(
                `SELECT j.id, j.server_id, j.action, j.payload, s.container_name, s.node_id, s.status 
                 FROM server_cron_jobs j 
                 JOIN servers s ON j.server_id = s.id 
                 WHERE j.time_hh_mm = $1 AND s.status = 'running'`,
                [timeString]
            );

            for (const job of res.rows) {
                try {
                    console.log(`🕒 [Cron] Ejecutando tarea ${job.id} para servidor ${job.server_id} - Acción: ${job.action}`);
                    
                    if (job.action === 'command' && job.payload) {
                        await sendCommandToContainer(job.container_name, job.payload);
                    } else if (job.action === 'restart' || job.action === 'stop' || job.action === 'start') {
                        // Pasamos role=admin a controlServer porque viene del cron interno
                        await controlServer(job.server_id, null, job.action, true);
                    }
                } catch (err) {
                    console.error(`❌ [Cron] Error ejecutando tarea ${job.id}:`, err.message);
                }
            }
        } catch (e) {
            console.error("❌ [Cron] Error general evaluando tareas:", e.message);
        }
    }, 60 * 1000);
}
