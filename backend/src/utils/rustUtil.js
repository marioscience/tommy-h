import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import crypto from 'crypto';
import { createReadStream } from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeNativeStats(result) {
    const rawCpu = Number.parseFloat(result?.cpu) || 0;
    const rawRam = Number.parseFloat(result?.ram) || 0;
    return {
        cpu: `${rawCpu.toFixed(2)}%`,
        ram: `${rawRam.toFixed(2)}%`,
        ram_gb: result?.ram_gb ?? result?.ramGb ?? '0.00',
        net_rx: result?.net_rx ?? result?.netRx ?? '0',
        net_tx: result?.net_tx ?? result?.netTx ?? '0',
        raw_cpu: rawCpu,
        raw_ram: rawRam
    };
}

// Cargar el módulo nativo compilado por NAPI-RS
let native;
try {
    native = require(path.resolve(__dirname, './ragenodes_napi.node'));
} catch (e) {
    // Modo de compatibilidad / fallback JS puro para entornos heterogéneos (Windows dev / CI)
    native = null;
}

/**
 * 🦀 PUENTE RUST-NODE (N-API Nativo con Fallback Resiliente)
 * Proporciona acceso a funciones de altísimo rendimiento nativas en Rust con
 * degradación elegante a JavaScript puro cuando el binario nativo no está disponible.
 */
export const rustUtil = {
    runtimeInfo() {
        return {
            engine: native ? 'rust-native' : 'javascript-fallback',
            nativeAvailable: Boolean(native)
        };
    },

    /**
     * Suscribirse al flujo de eventos de Docker vía Rust Nativo.
     */
    streamEvents() {
        const emitter = new EventEmitter();
        if (native) {
            native.streamDockerEvents((json) => {
                try {
                    const event = JSON.parse(json);
                    emitter.emit('event', event);
                } catch (e) {}
            });
        }
        return emitter;
    },

    async unzip(source, dest) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.unzipFile(source, dest);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en unzip:', err.message);
            return { success: false, error: err.message };
        }
    },

    async unzipValidated(source, dest, maxExpandedBytes) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.unzipFileValidated(source, dest, Number(maxExpandedBytes));
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error validando ZIP:', err.message);
            return { success: false, error: err.message };
        }
    },

    async sha256File(filePath) {
        if (native) return native.sha256File(filePath);
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const input = createReadStream(filePath);
            input.on('data', chunk => hash.update(chunk));
            input.on('error', reject);
            input.on('end', () => resolve(hash.digest('hex')));
        });
    },

    async getDirSize(dirPath) {
        try {
            if (!native) return 0;
            const size = await native.getDirSize(dirPath);
            return Number(size) || 0;
        } catch (err) {
            console.error('❌ [RustUtil] Error en du:', err.message);
            throw err;
        }
    },

    async calculateStats(rawStats) {
        try {
            if (native) {
                // Docker representa el límite PID ilimitado como UINT64_MAX. Al pasar por
                // Number de JavaScript se redondea por encima de u64 y rompe el parser Rust.
                const { pids_stats: _unusedPidsStats, ...statsForRust } = rawStats || {};
                const result = native.calculateStats(JSON.stringify(statsForRust));
                // Mantener el mismo contrato que el fallback JS independientemente de si
                // el módulo nativo está disponible en la plataforma actual.
                return normalizeNativeStats(result);
            }

            // Fallback en JS Puro (Resiliencia Multi-Plataforma)
            if (!rawStats) return null;
            const cpuStats = rawStats.cpu_stats || {};
            const precpuStats = rawStats.precpu_stats || {};
            const memStats = rawStats.memory_stats || {};

            let cpuPercent = 0.0;
            const cpuDelta = (cpuStats.cpu_usage?.total_usage || 0) - (precpuStats.cpu_usage?.total_usage || 0);
            const systemDelta = (cpuStats.system_cpu_usage || 0) - (precpuStats.system_cpu_usage || 0);
            const onlineCpus = cpuStats.online_cpus || cpuStats.cpu_usage?.percpu_usage?.length || 1;

            if (systemDelta > 0 && cpuDelta > 0) {
                cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100.0;
            }

            const usedMemory = (memStats.usage || 0) - (memStats.stats?.inactive_file || 0);
            const limit = memStats.limit || 1;
            const ramPercent = limit > 0 ? (usedMemory / limit) * 100.0 : 0.0;
            const networks = Object.values(rawStats.networks || {});
            const netRx = networks.reduce((total, network) => total + (Number(network?.rx_bytes) || 0), 0);
            const netTx = networks.reduce((total, network) => total + (Number(network?.tx_bytes) || 0), 0);

            return {
                cpu: `${cpuPercent.toFixed(2)}%`,
                ram: `${ramPercent.toFixed(2)}%`,
                ram_gb: `${Math.max(0, usedMemory / (1024 ** 3)).toFixed(2)}`,
                net_rx: String(netRx),
                net_tx: String(netTx),
                raw_cpu: cpuPercent,
                raw_ram: ramPercent
            };
        } catch (err) {
            console.error('❌ [RustUtil] Error en stats:', err.message);
            return null;
        }
    },

    async calculateStatsBatch(rawStatsItems) {
        const items = Array.isArray(rawStatsItems) ? rawStatsItems : [];
        if (native) {
            const serialized = items.map(rawStats => {
                const { pids_stats: _unusedPidsStats, ...statsForRust } = rawStats || {};
                return JSON.stringify(statsForRust);
            });
            const results = native.calculateStatsBatch(serialized);
            return results.map(normalizeNativeStats);
        }
        return Promise.all(items.map(item => this.calculateStats(item)));
    },

    async patchHtml(filePath, styleTag) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.patchHtml(filePath, styleTag);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en patchHtml:', err.message);
            return { success: false, error: err.message };
        }
    },

    async compress(sourceDir, outputFile) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.compressDir(sourceDir, outputFile);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en compress:', err.message);
            return { success: false, error: err.message };
        }
    },

    async tarGz(sourceDir, outputFile) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.tarGzDir(sourceDir, outputFile);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en tarGz:', err.message);
            return { success: false, error: err.message };
        }
    },

    async tail(filePath, lines = 50) {
        try {
            if (!native) return "Error al leer los logs.";
            return await native.tailFile(filePath, lines);
        } catch (err) {
            console.error('❌ [RustUtil] Error en tail:', err.message);
            return "Error al leer los logs.";
        }
    },

    async zstd(sourceDir, outputFile) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.zstdDir(sourceDir, outputFile);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en zstd:', err.message);
            return { success: false, error: err.message };
        }
    },

    async unzstd(sourceFile, outputDir) {
        try {
            if (!native) throw new Error('Módulo nativo no disponible');
            await native.unzstdDir(sourceFile, outputDir);
            return { success: true };
        } catch (err) {
            console.error('❌ [RustUtil] Error en unzstd:', err.message);
            return { success: false, error: err.message };
        }
    }
};
