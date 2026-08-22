import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG = {
    SERVER_NAME: 'RageNodes Valheim',
    SERVER_PASS: '',
    WORLD_NAME: 'RageNodesWorld',
    SERVER_PUBLIC: '1',
    SERVER_ARGS: '-crossplay',
    UPDATE_CRON: '0 4 * * *',
    BACKUPS: 'true',
    VALHEIM_PLUS: 'false',
    BEPINEX: 'false',
};

/**
 * Lee la configuración del servidor Valheim desde el archivo .env del contenedor
 */
export async function getValheimConfig(instancePath) {
    const envPath = path.join(instancePath, 'valheim', 'server.env');
    try {
        const content = await fs.readFile(envPath, 'utf8');
        const config = { ...DEFAULT_CONFIG };
        content.split('\n').forEach(line => {
            const match = line.match(/^([A-Z_]+)=(.*)$/);
            if (match) config[match[1]] = match[2].trim().replace(/^"|"$/g, '');
        });
        return config;
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

/**
 * Guarda la configuración del servidor Valheim
 */
export async function saveValheimConfig(instancePath, config) {
    const dir = path.join(instancePath, 'valheim');
    const envPath = path.join(dir, 'server.env');
    await fs.mkdir(dir, { recursive: true });

    const allowed = ['SERVER_NAME', 'SERVER_PASS', 'WORLD_NAME', 'SERVER_PUBLIC', 'SERVER_ARGS', 'UPDATE_CRON', 'BACKUPS', 'VALHEIM_PLUS', 'BEPINEX'];
    let content = '# Configuración generada por RageNodes Elite Panel\n';
    for (const key of allowed) {
        if (config[key] !== undefined) {
            content += `${key}="${config[key]}"\n`;
        }
    }
    await fs.writeFile(envPath, content, 'utf8');
}
