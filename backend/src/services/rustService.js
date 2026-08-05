import fs from 'fs/promises';
import path from 'path';

/**
 * Lee la configuración de un servidor Rust (server.cfg)
 * Y la convierte en un objeto JSON para el frontend.
 */
export async function getRustConfig(instancePath) {
    const cfgPath = path.join(instancePath, 'server', 'ragenodes', 'cfg', 'server.cfg');
    try {
        const content = await fs.readFile(cfgPath, 'utf8');
        const config = {};
        
        content.split('\n').forEach(line => {
            const match = line.match(/^(\S+)\s+(.+)$/);
            if (match) {
                let key = match[1];
                let value = match[2].replace(/"/g, '').trim();
                config[key] = value;
            }
        });
        
        return config;
    } catch (e) {
        // Si no existe, devolvemos valores por defecto
        return {
            "server.hostname": "RageNodes Rust Server",
            "server.description": "Bienvenido a mi servidor de Rust alojado en RageNodes",
            "server.url": "https://ragenodes.com",
            "server.headerimage": "",
            "server.maxplayers": "50",
            "server.pve": "false",
            "chat.enabled": "true"
        };
    }
}

/**
 * Guarda la configuración en el archivo server.cfg
 */
export async function saveRustConfig(instancePath, config) {
    const cfgDir = path.join(instancePath, 'server', 'ragenodes', 'cfg');
    const cfgPath = path.join(cfgDir, 'server.cfg');
    
    await fs.mkdir(cfgDir, { recursive: true });
    
    let content = "";
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (e) {
        content = "";
    }

    for (const [key, value] of Object.entries(config)) {
        if (value === "" || value === null) continue;
        
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedKey}\\s+.*$`, 'm');
        
        if (regex.test(content)) {
            content = content.replace(regex, `${key} "${value}"`);
        } else {
            if (content && !content.endsWith('\n')) content += '\n';
            content += `${key} "${value}"\n`;
        }
    }
    
    await fs.writeFile(cfgPath, content, 'utf8');
}
