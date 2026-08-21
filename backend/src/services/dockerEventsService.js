import { rustUtil } from '../utils/rustUtil.js';
import { query } from '../db.js';
import { repairOneServer } from './serverService.js';

/**
 * 📡 SERVICIO DE EVENTOS REAL-TIME (DOCKER VIA RUST)
 * Escucha eventos críticos del motor de Rust y aplica auto-curación instantánea.
 */
export function startDockerEventsListener() {
    console.log("📡 [RustEvents] Iniciando escucha de eventos Docker en tiempo real...");
    
    const lastRepairs = new Map(); // serverId -> timestamp
    const repairWindows = new Map(); // serverId -> repair timestamps
    const REPAIR_COOLDOWN = 2 * 60 * 1000; // 2 minutos
    const REPAIR_WINDOW_MS = 15 * 60 * 1000;
    const MAX_REPAIRS_PER_WINDOW = 3;
    const events = rustUtil.streamEvents();

    events.on('event', async (event) => {
        // Filtrar solo eventos de contenedores RageNodes (Docker a veces añade un / al inicio)
        const name = (event.Actor?.Attributes?.name || "").replace(/^\//, '');
        if (!name.startsWith('ragenodes-')) return;

        const action = event.Action;
        
        // 🚨 EVENTOS CRÍTICOS: die (crash), oom (fuera de memoria)
        if (action === 'die' || action === 'oom') {
            try {
                // Buscamos el servidor con todos los campos necesarios para Fast-Heal
                const { rows } = await query('SELECT id, name, status, template, fivem_port, txadmin_port, txadmin_url, container_name, data_path, runtime_plan, allocated_ram_gb, cluster_id, db_name, db_user, db_pass, node_id, mc_version, mc_type, cpuset FROM servers WHERE container_name = $1', [name]);
                
                if (rows.length > 0) {
                    const server = rows[0];
                    if (server.status !== 'running') {
                        console.log(`[RustEvents] No se repara ${server.name}: estado actual ${server.status}.`);
                        return;
                    }

                    const now = Date.now();
                    const lastRepair = lastRepairs.get(server.id) || 0;

                    if (now - lastRepair < REPAIR_COOLDOWN) {
                        console.warn(`⏳ [RustEvents] Ignorando reparación repetitiva para ${server.name} (Cooldown activo)`);
                        return;
                    }

                    const recentRepairs = (repairWindows.get(server.id) || []).filter(ts => now - ts < REPAIR_WINDOW_MS);
                    if (recentRepairs.length >= MAX_REPAIRS_PER_WINDOW) {
                        await query("UPDATE servers SET status = 'error' WHERE id = $1", [server.id]);
                        repairWindows.set(server.id, recentRepairs);
                        console.error(`🛑 [RustEvents] ${server.name} superó ${MAX_REPAIRS_PER_WINDOW} reparaciones en 15 minutos. Marcado como ERROR para evitar loop.`);
                        return;
                    }

                    console.log(`🚨 [RustEvents] ¡CAÍDA DETECTADA! Contenedor: ${name} | Razón: ${action.toUpperCase()}`);
                    
                    lastRepairs.set(server.id, now);
                    repairWindows.set(server.id, [...recentRepairs, now]);
                    
                    // En lugar de recrear el contenedor (lo que borra logs y fuerza reinstalaciones como en Minecraft),
                    // simplemente marcamos como offline y dejamos que Docker lo reinicie nativamente si aplica.
                    await query("UPDATE servers SET status = 'offline' WHERE id = $1", [server.id]);
                    console.log(`✅ [RustEvents] Servidor ${server.name} marcado como OFFLINE. Conservando logs en consola.`);
                }
            } catch (e) {
                console.error(`❌ [RustEvents] Error al intentar curar ${name}:`, e.message);
            }
        }
        
        // 🏥 EVENTOS DE SALUD: health_status
        if (action.startsWith('health_status: unhealthy')) {
            console.warn(`⚠️ [RustEvents] Contenedor ${name} reportado como INESTABLE.`);
        }
    });

    return events;
}
