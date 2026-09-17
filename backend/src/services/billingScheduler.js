import { query, logAudit } from '../db.js';
import { controlServer, deleteServer } from './serverControlService.js';

/**
 * Motor de Suspensión Automática (Billing Scheduler)
 * Ejecuta validaciones periódicas sobre las fechas de expiración de los usuarios.
 */
export function startBillingScheduler() {
    console.log("🕒 [Billing] Iniciando Scheduler de Facturación y Suspensiones.");

    // Ejecutar cada 1 hora
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try { await checkExpiredAccounts(); }
        finally { running = false; }
    };
    setInterval(run, 60 * 60 * 1000);
    
    // Ejecutar una vez al arrancar
    setTimeout(run, 10000);
}

async function checkExpiredAccounts() {
    console.log("🔍 [Billing] Verificando cuentas expiradas...");

    try {
        // 1. ELIMINACIÓN TOTAL: Usuarios que llevan más de 7 días caducados
        const toDeleteResult = await query(`
            SELECT id, username FROM users 
            WHERE expires_at < NOW() - INTERVAL '7 days' AND role != 'admin'
        `);

        for (const user of toDeleteResult.rows) {
            console.log(`🗑️ [Billing] Eliminando cuenta morosa (>7 días): ${user.username} (ID: ${user.id})`);
            
            // Eliminar todos sus servidores
            const userServers = await query('SELECT id FROM servers WHERE owner_id = $1', [user.id]);
            for (const srv of userServers.rows) {
                try {
                    await deleteServer(srv.id, user.id, true); // true = adminOverride
                } catch (err) {
                    console.error(`❌ [Billing] Error borrando servidor ${srv.id} de ${user.username}:`, err.message);
                }
            }

            // Eliminar usuario
            await query('DELETE FROM users WHERE id = $1', [user.id]);
            await logAudit('sistema', 'billing.account_deleted', { userId: user.id, reason: '7_days_unpaid' });
        }

        // 2. SUSPENSIÓN: Usuarios caducados hoy (entre 0 y 7 días de morosidad)
        const toSuspendResult = await query(`
            SELECT id, username FROM users 
            WHERE expires_at < NOW() AND expires_at >= NOW() - INTERVAL '7 days' AND role != 'admin'
        `);

        for (const user of toSuspendResult.rows) {
            // Buscar servidores corriendo o iniciándose
            const serversResult = await query("SELECT id, name FROM servers WHERE owner_id = $1 AND status != 'offline' AND status != 'suspended'", [user.id]);
            
            for (const srv of serversResult.rows) {
                console.log(`🛑 [Billing] Suspendiendo servidor ${srv.name} del usuario moroso ${user.username}`);
                try {
                    // Marcamos primero como suspendido para que el watcher Docker no lo auto-repare al detenerse.
                    await query("UPDATE servers SET status = 'suspended' WHERE id = $1", [srv.id]);

                    // Apagamos el contenedor después de cambiar el estado lógico.
                    await controlServer(srv.id, user.id, 'stop', true);

                    // Reafirmamos el estado por si la operación de control normaliza a stopped.
                    await query("UPDATE servers SET status = 'suspended' WHERE id = $1", [srv.id]);
                } catch (err) {
                    console.error(`❌ [Billing] Error suspendiendo servidor ${srv.id}:`, err.message);
                }
            }
        }

        // 3. LIMPIEZA DE CUENTAS FANTASMA ELIMINADA
        // Se ha desactivado el borrado automático de cuentas sin servidores para 
        // evitar que los usuarios pierdan su acceso cuando un servidor se borra o expira.


    } catch (error) {
        console.error("❌ [Billing] Error crítico en el scheduler:", error.message);
    }
}
