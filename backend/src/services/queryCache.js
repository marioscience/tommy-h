import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { query } from '../db.js';

const CACHE_DIR = '/app/config-gateway/static';

/**
 * ???? WORKER DE ALTA VELOCIDAD (Optimizaci??n de Concurrencia Inteligente)
 */
export async function startQueryWarmer() {
    console.log('???? [QueryWarmer] Iniciando motor de pre-carga de latencia cero...');
    
    const runCycle = async () => {
        try {
            const { rows: servers } = await query("SELECT id, fivem_port FROM servers WHERE status = 'running'");
            
            // Agrupar en lotes de 15 para no saturar la red y maximizar el paralelismo
            const BATCH_SIZE = 15;
            for (let i = 0; i < servers.length; i += BATCH_SIZE) {
                const batch = servers.slice(i, i + BATCH_SIZE);
                
                await Promise.all(batch.map(async (s) => {
                    const internalPort = parseInt(s.fivem_port) + 20000;
                    const serverDir = path.join(CACHE_DIR, String(s.fivem_port));
                    
                    await fs.mkdir(serverDir, { recursive: true }).catch(() => {});

                    const files = ['info.json', 'players.json', 'dynamic.json'];
                    
                    await Promise.all(files.map(async (file) => {
                        try {
                            const url = `http://172.17.0.1:${internalPort}/${file}`;
                            const response = await axios.get(url, { timeout: 1500 });
                            
                            if (response.status === 200) {
                                await fs.writeFile(path.join(serverDir, file), JSON.stringify(response.data));
                            }
                        } catch (e) {
                            // Ignorar errores (servidor apagado o no responde)
                        }
                    }));
                }));
            }
        } catch (err) {
            // Ignorar fallos de base de datos silenciosamente
        } finally {
            // Programar la siguiente ejecuci??n S??LO despu??s de terminar el ciclo actual
            // Esto elimina la fuga de memoria y el colapso del Event Loop.
            setTimeout(runCycle, 3000);
        }
    };

    // Arrancar el primer ciclo
    runCycle();
}
