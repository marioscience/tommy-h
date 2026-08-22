import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG = {
    PublicName: 'RageNodes | Project Zomboid',
    PublicDescription: 'Servidor gestionado por RageNodes',
    Password: '',
    MaxPlayers: '32',
    PVP: 'false',
    GlobalChat: 'true',
    Open: 'true',
    ServerWelcomeMessage: 'Bienvenido a RageNodes Zomboid Server',
    Map: 'Muldraugh, KY',
    AutoSave: '0',
    SaveWorldEveryMinutes: '15',
};

/**
 * Lee la configuración de Project Zomboid desde el archivo .ini correspondiente
 */
export async function getZomboidConfig(instancePath) {
    const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
    try {
        const files = await fs.readdir(cfgDir);
        const iniFile = files.find(f => f.endsWith('.ini'));
        if (!iniFile) return { ...DEFAULT_CONFIG };

        const cfgPath = path.join(cfgDir, iniFile);
        const content = await fs.readFile(cfgPath, 'utf8');
        const config = { ...DEFAULT_CONFIG };
        content.split('\n').forEach(line => {
            const match = line.match(/^([^=\n]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                if (key in DEFAULT_CONFIG) config[key] = match[2].trim();
            }
        });
        return config;
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

/**
 * Guarda la configuración en el archivo .ini (detecta el nombre dinámicamente o usa servertest)
 */
export async function saveZomboidConfig(instancePath, config) {
    const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
    await fs.mkdir(cfgDir, { recursive: true });

    let iniFile = 'servertest.ini';
    try {
        const files = await fs.readdir(cfgDir);
        iniFile = files.find(f => f.endsWith('.ini')) || 'servertest.ini';
    } catch (e) {}

    const cfgPath = path.join(cfgDir, iniFile);
    let content = "";
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (e) {
        content = '# Configuración generada por RageNodes Elite Panel\n';
    }

    const merged = { ...DEFAULT_CONFIG, ...config };
    for (const [key, value] of Object.entries(merged)) {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^${escapedKey}=.*$`, 'm');
        
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
        } else {
            if (content && !content.endsWith('\n')) content += '\n';
            content += `${key}=${value}\n`;
        }
    }
    await fs.writeFile(cfgPath, content, 'utf8');
}
