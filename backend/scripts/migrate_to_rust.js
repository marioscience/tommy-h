import { query } from '../src/db.js';
import * as Docker from '../src/services/dockerService.js';
import { syncGateway } from '../src/utils/gatewaySync.js';

async function migrate() {
    console.log("🚀 Iniciando MIGRACIÓN GLOBAL al Motor Rust...");
    try {
        const { rows: servers } = await query("SELECT * FROM servers WHERE status = 'running'");
        console.log(`📦 Encontrados ${servers.length} servidores activos.`);

        for (const s of servers) {
            console.log(`🔄 Migrando [${s.name}] (${s.id.slice(0,8)})...`);
            
            // 1. Parar y borrar contenedor actual
            try {
                await Docker.removeContainer(s.container_name);
            } catch (e) {
                console.warn(`⚠️ Aviso al borrar ${s.name}:`, e.message);
            }

            // 2. Recrear con la nueva lógica (que ya está en dockerService.js)
            await Docker.createFivemContainer({
                containerName: s.container_name,
                fivemPort: s.fivem_port,
                txadminPort: s.txadmin_port,
                dataPath: s.data_path,
                plan: s.runtime_plan
            });

            // 3. Iniciar
            await Docker.startContainer(s.container_name);
            console.log(`✅ [${s.name}] Migrado y encendido.`);
        }

        // 4. Sincronizar Gateway de Rust
        await syncGateway();
        console.log("🔥 ¡MIGRACIÓN COMPLETADA! Todos los servidores están bajo el Motor Rust.");

    } catch (error) {
        console.error("❌ La migración falló:", error);
    }
}

migrate();
