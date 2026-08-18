import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar el módulo nativo compilado por NAPI-RS
let native;
try {
    native = require(path.resolve(__dirname, './ragenodes_napi.node'));
} catch (e) {
    console.error('❌ [RustUtil] No se pudo cargar ragenodes-util.node. ¿Ejecutaste napi build?', e);
}

/**
 * 🦀 PUENTE RUST-NODE (N-API Nativo)
 * Proporciona acceso a funciones de altísimo rendimiento nativas.
 */
export const rustUtil = {
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
            if (!native) return null;
            // Docker representa el límite PID ilimitado como UINT64_MAX. Al pasar por
            // Number de JavaScript se redondea por encima de u64 y rompe el parser Rust.
            // Este bloque no se usa para los cálculos de CPU/RAM/red, así que se omite.
            const { pids_stats: _unusedPidsStats, ...statsForRust } = rawStats || {};
            return native.calculateStats(JSON.stringify(statsForRust));
        } catch (err) {
            console.error('❌ [RustUtil] Error en stats:', err.message);
            return null;
        }
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
