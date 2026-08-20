import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { getServerByIdForUser } from './serverService.js';

const MODRINTH_API = 'https://api.modrinth.com/v2';

/**
 * Busca mods en Modrinth
 */
export async function searchMods(query = "") {
    try {
        console.log(`🔍 [Modrinth] Buscando: "${query || 'Tendencias'}"...`);
        const response = await axios.get(`${MODRINTH_API}/search`, {
            params: {
                query: query || "",
                facets: '[["project_type:mod"]]',
                index: query ? 'relevance' : 'downloads', // Si no hay query, mostrar los más descargados
                limit: 20
            },
            headers: {
                'User-Agent': 'RageNodes/1.0.0 (admin@ragenodes.com)'
            }
        });
        console.log(`✅ [Modrinth] Encontrados ${response.data.hits.length} resultados.`);
        return response.data.hits;
    } catch (error) {
        console.error('Error buscando mods en Modrinth:', error.message);
        throw new Error('No se pudo conectar con Modrinth');
    }
}

/**
 * Obtiene las versiones de un mod específico
 */
export async function getModVersions(modId) {
    try {
        const response = await axios.get(`${MODRINTH_API}/project/${modId}/version`, {
            headers: { 'User-Agent': 'RageNodes/1.0.0 (admin@ragenodes.com)' }
        });
        return response.data;
    } catch (error) {
        console.error('Error obteniendo versiones del mod:', error.message);
        throw new Error('Error al obtener versiones del mod');
    }
}

/**
 * Instala un mod descargando el archivo a la carpeta mods del servidor
 */
export async function installMod(serverId, userId, isAdmin, versionId) {
    const server = await getServerByIdForUser(serverId, userId, isAdmin, 'files');
    if (!server || server.template !== 'minecraft') {
        throw new Error('Servidor no válido o sin acceso');
    }

    try {
        // 1. Obtener info de la versión (incluyendo descarga)
        const versionResponse = await axios.get(`${MODRINTH_API}/version/${versionId}`, {
            headers: { 'User-Agent': 'RageNodes/1.0.0 (admin@ragenodes.com)' }
        });
        const versionData = versionResponse.data;
        
        const primaryFile = versionData.files.find(f => f.primary) || versionData.files[0];
        if (!primaryFile) throw new Error('No se encontró un archivo descargable para esta versión');

        const downloadUrl = primaryFile.url;
        const fileName = primaryFile.filename;

        // 2. Asegurar carpeta mods
        const modsPath = path.join(server.data_path, 'mods');
        await fs.mkdir(modsPath, { recursive: true });

        // 3. Descargar archivo usando Streams (Mejor rendimiento y menor consumo de RAM)
        console.log(`🚚 Descargando mod ${fileName} para servidor ${serverId}...`);
        const targetPath = path.join(modsPath, fileName);
        
        const writer = (await import('fs')).createWriteStream(targetPath);
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
            headers: { 'User-Agent': 'RageNodes/1.0.0 (admin@ragenodes.com)' }
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve({ success: true, fileName }));
            writer.on('error', (err) => {
                console.error('Error escribiendo mod:', err);
                reject(new Error('Fallo al guardar el archivo en disco'));
            });
        });
    } catch (error) {
        console.error('Error instalando mod:', error.message);
        throw new Error('Error al descargar o instalar el mod: ' + error.message);
    }
}
