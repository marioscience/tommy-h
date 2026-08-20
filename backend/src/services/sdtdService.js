import fs from 'fs/promises';
import path from 'path';

const DEFAULT_CONFIG = {
    ServerName: 'RageNodes 7DTD Server',
    ServerDescription: 'Sobrevive al horda en RageNodes.',
    ServerPassword: '',
    GameDifficulty: '2',
    DayNightLength: '60',
    BloodMoonFrequency: '7',
    BloodMoonRange: '0',
    BloodMoonWarning: '8',
    ZombieMove: '0',
    ZombieMoveNight: '3',
    ZombieFeralMove: '3',
    ZombieBMMove: '3',
    LootAbundance: '100',
    LootRespawnDays: '7',
    DropOnDeath: '1',
    DropOnQuit: '0',
    MaxSpawnedZombies: '64',
    MaxSpawnedAnimals: '50',
    ServerMaxPlayerCount: '8',
    TelnetEnabled: 'true',
    TelnetPort: '8081',
    TelnetPassword: ''
};

/**
 * Lee la configuración de 7 Days to Die (serverconfig.xml)
 */
export async function getSDTDConfig(instancePath) {
    const cfgPath = path.join(instancePath, 'config', 'serverconfig.xml');
    try {
        const content = await fs.readFile(cfgPath, 'utf8');
        const config = { ...DEFAULT_CONFIG };
        
        // Regex para capturar <property name="Key" value="Value"/>
        const regex = /<property\s+name="([^"]+)"\s+value="([^"]*)"/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            const key = match[1];
            if (key in DEFAULT_CONFIG) {
                config[key] = match[2];
            }
        }
        return config;
    } catch (e) {
        return { ...DEFAULT_CONFIG };
    }
}

/**
 * Guarda la configuración en serverconfig.xml
 */
export async function saveSDTDConfig(instancePath, newConfig) {
    const cfgDir = path.join(instancePath, 'config');
    const cfgPath = path.join(cfgDir, 'serverconfig.xml');
    await fs.mkdir(cfgDir, { recursive: true });

    let content = '';
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (e) {
        // If file doesn't exist, create a basic one (though this shouldn't happen normally)
        content = '<?xml version="1.0"?>\n<ServerSettings>\n</ServerSettings>';
    }

    // Update or append properties
    const merged = { ...DEFAULT_CONFIG, ...newConfig };
    
    for (const [key, value] of Object.entries(merged)) {
        const regex = new RegExp(`(<property\\s+name="${key}"\\s+value=")[^"]*(".*?>)`, 'g');
        if (regex.test(content)) {
            content = content.replace(regex, `$1${value}$2`);
        } else {
            // Insert before the closing tag
            content = content.replace('</ServerSettings>', `    <property name="${key}" value="${value}"/>\n</ServerSettings>`);
        }
    }
    
    await fs.writeFile(cfgPath, content, 'utf8');
}
