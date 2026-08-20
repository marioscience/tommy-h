import fs from 'fs/promises';
import path from 'path';

/**
 * Lee la configuración de Palworld (PalWorldSettings.ini)
 */
export async function getPalworldConfig(instancePath) {
    const iniPath = path.join(instancePath, 'Pal', 'Saved', 'Config', 'LinuxServer', 'PalWorldSettings.ini');
    try {
        const content = await fs.readFile(iniPath, 'utf8');
        // El formato de Palworld es: OptionSettings=(Key=Value,Key2=Value2,...)
        const match = content.match(/OptionSettings=\((.*)\)/);
        if (!match) throw new Error("Formato de settings no válido");

        const settingsStr = match[1];
        const settings = {};
        
        // Parseo quirúrgico por comas, teniendo cuidado con posibles valores que contengan comas (aunque en Palworld son simples)
        settingsStr.split(',').forEach(pair => {
            const [key, ...valParts] = pair.split('=');
            if (key) {
                let val = valParts.join('=').trim();
                // Limpiar comillas si existen
                if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                settings[key] = val;
            }
        });

        return settings;
    } catch (e) {
        // Valores por defecto si falla o no existe
        return {
            "ExpRate": "1.000000",
            "PalCaptureRate": "1.000000",
            "PalSpawnNumRate": "1.000000",
            "DeathPenalty": "All",
            "bEnablePlayerToPlayerDamage": "False",
            "bIsPvP": "False",
            "AdminPassword": "",
            "ServerPassword": "",
            "ServerName": "RageNodes Palworld Server"
        };
    }
}

/**
 * Guarda la configuración en el archivo .ini de Palworld
 */
export async function savePalworldConfig(instancePath, settings) {
    const configDir = path.join(instancePath, 'Pal', 'Saved', 'Config', 'LinuxServer');
    const iniPath = path.join(configDir, 'PalWorldSettings.ini');

    await fs.mkdir(configDir, { recursive: true });

    let content = '';
    let currentSettings = {};

    try {
        content = await fs.readFile(iniPath, 'utf8');
        const match = content.match(/OptionSettings=\((.*)\)/);
        if (match) {
            match[1].split(',').forEach(pair => {
                const [k, ...v] = pair.split('=');
                if (k) currentSettings[k] = v.join('=');
            });
        }
    } catch (e) {
        content = '[/Script/Pal.PalGameSetting]\nOptionSettings=()\n';
    }

    if (!content.includes('OptionSettings=')) {
        if (!content.includes('[/Script/Pal.PalGameSetting]')) {
            content += '\n[/Script/Pal.PalGameSetting]\nOptionSettings=()\n';
        } else {
            content = content.replace('[/Script/Pal.PalGameSetting]', '[/Script/Pal.PalGameSetting]\nOptionSettings=()');
        }
    }

    for (const [key, value] of Object.entries(settings)) {
        // Remove quotes if present to avoid double-quoting
        let cleanValue = value;
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
            cleanValue = value.slice(1, -1);
        }
        
        const isString = isNaN(cleanValue) && cleanValue !== "True" && cleanValue !== "False";
        const formattedVal = isString ? `"${cleanValue}"` : cleanValue;
        currentSettings[key] = formattedVal;
    }

    const settingsParts = Object.entries(currentSettings).map(([k, v]) => `${k}=${v}`);
    const newOptionsStr = `OptionSettings=(${settingsParts.join(',')})`;

    content = content.replace(/OptionSettings=\(.*\)/, newOptionsStr);

    await fs.writeFile(iniPath, content, 'utf8');
}
