import fs from 'fs/promises';
import { existsSync } from 'fs';

// 🔒 MUTEX PARA ARCHIVOS
// Evita que dos procesos escriban en el mismo archivo al mismo tiempo
const fileLocks = new Map();

/**
 * Escribe en un archivo de forma atómica y segura usando una cola de tareas.
 * @param {string} filePath Ruta del archivo
 * @param {string} content Contenido a escribir
 */
export async function safeWriteFile(filePath, content) {
    // Si no hay una cola para este archivo, la creamos
    if (!fileLocks.has(filePath)) {
        fileLocks.set(filePath, Promise.resolve());
    }

    const previousLock = fileLocks.get(filePath);

    // Creamos una nueva promesa que se ejecutará después de la anterior
    const currentLock = previousLock.then(async () => {
        try {
            // Escribimos en un archivo temporal primero para máxima seguridad
            const tempPath = `${filePath}.tmp`;
            await fs.writeFile(tempPath, content, 'utf8');
            await fs.rename(tempPath, filePath);
        } catch (err) {
            console.error(`❌ [SafeWrite] Error escribiendo en ${filePath}:`, err);
            throw err;
        }
    });

    fileLocks.set(filePath, currentLock);
    return currentLock;
}

/**
 * Lee un archivo de forma segura.
 */
export async function safeReadFile(filePath) {
    if (!existsSync(filePath)) return null;
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (err) {
        console.error(`❌ [SafeRead] Error leyendo ${filePath}:`, err);
        return null;
    }
}
