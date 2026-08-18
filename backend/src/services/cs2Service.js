import fs from 'fs/promises';
import path from 'path';

/**
 * Lee la configuración de un servidor CS2 (server.cfg)
 */
export async function getCS2Config(instancePath) {
    const cfgPath = path.join(instancePath, 'game', 'csgo', 'cfg', 'server.cfg');
    try {
        const content = await fs.readFile(cfgPath, 'utf8');
        const config = {};
        
        content.split('\n').forEach(line => {
            // CS2 usa: comando "valor" o comando valor
            const match = line.match(/^(\S+)\s+"?([^"\n]*)"?/);
            if (match) {
                let key = match[1];
                let value = match[2].trim();
                config[key] = value;
            }
        });
        
        return config;
    } catch (e) {
        // Valores por defecto si no existe
        return {
            "hostname": "RageNodes CS2 Server",
            "sv_password": "",
            "rcon_password": "",
            "mp_maxrounds": "24",
            "mp_roundtime": "1.92",
            "sv_cheats": "0",
            "sv_lan": "0"
        };
    }
}

/**
 * Guarda la configuración en server.cfg
 */
export async function saveCS2Config(instancePath, config) {
    const cfgDir = path.join(instancePath, 'game', 'csgo', 'cfg');
    const cfgPath = path.join(cfgDir, 'server.cfg');
    
    await fs.mkdir(cfgDir, { recursive: true });
    
    let content = "";
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (e) {
        content = "// Configuración generada por RageNodes Elite Panel\n";
    }

    for (const [key, value] of Object.entries(config)) {
        if (value === "" && key !== "sv_password") continue;
        
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
