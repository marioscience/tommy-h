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
    SoftResetCron: '',
    HoursForLootRespawn: '0',
    AllowDestructionByAdmin: 'false'
};

const ALLOWED_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

function safeIniStem(serverName) {
    const value = String(serverName || '').trim();
    return value && value === path.basename(value) && !/[\0/\\]/.test(value)
        ? value
        : 'servertest';
}

async function resolveZomboidIni(cfgDir, serverName, { create = false } = {}) {
    let files;
    try {
        files = (await fs.readdir(cfgDir)).filter((file) => file.endsWith('.ini')).sort();
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        files = [];
    }

    const preferred = `${safeIniStem(serverName)}.ini`;
    if (files.includes(preferred)) return preferred;
    if (create) return preferred; // if saving or creating, use the named file.
    if (files.length === 1) return files[0];
    if (files.length > 1) {
        throw new Error(`Configuración Zomboid ambigua: no se encontró ${preferred}.`);
    }
    return create ? preferred : null;
}

function normalizeConfigPatch(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new TypeError('La configuración Zomboid debe ser un objeto.');
    }
    return Object.fromEntries(Object.entries(config).filter(([key, value]) => {
        if (!ALLOWED_KEYS.has(key)) return false;
        if (/\r|\n/.test(String(value))) throw new Error(`Valor inválido para ${key}.`);
        return true;
    }).map(([key, value]) => [key, String(value)]));
}

/**
 * Lee la configuración de Project Zomboid desde el archivo .ini correspondiente
 */
export async function getZomboidConfig(instancePath, serverName = '') {
    const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
    try {
        const iniFile = await resolveZomboidIni(cfgDir, serverName);
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
    } catch (error) {
        if (error.code === 'ENOENT') return { ...DEFAULT_CONFIG };
        throw error;
    }
}

/**
 * Guarda la configuración en el archivo .ini (detecta el nombre dinámicamente o usa servertest)
 */
export async function saveZomboidConfig(instancePath, config, serverName = '') {
    const cfgDir = path.join(instancePath, 'Zomboid', 'Server');
    await fs.mkdir(cfgDir, { recursive: true });
    const iniFile = await resolveZomboidIni(cfgDir, serverName, { create: true });
    const cfgPath = path.join(cfgDir, iniFile);
    const patch = normalizeConfigPatch(config);
    let content = "";
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        content = '# Configuración generada por RageNodes Elite Panel\n';
    }

    const merged = content.startsWith('# Configuración generada')
        ? { ...DEFAULT_CONFIG, ...patch }
        : patch;
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
    const tempPath = `${cfgPath}.tmp-${process.pid}-${Date.now()}`;
    try {
        await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tempPath, cfgPath);
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
    }
}
