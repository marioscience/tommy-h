import fs from 'fs/promises';
import path from 'path';

export async function getPalworldSettings(dataPath) {
    const filePath = path.join(dataPath, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini');
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        // Parsear PalWorldSettings.ini (formato: OptionSettings=(Param=Val,Param2=Val2...))
        const match = content.match(/OptionSettings=\((.*)\)/);
        if (!match) return {};

        const params = match[1].split(',');
        const settings = {};
        params.forEach(p => {
            const [key, val] = p.split('=');
            if (key && val) settings[key.trim()] = val.trim().replace(/^"(.*)"$/, '$1');
        });
        return settings;
    } catch (e) {
        console.error("❌ Error leyendo PalWorldSettings:", e.message);
        return {};
    }
}

export async function savePalworldSettings(dataPath, newSettings) {
    const filePath = path.join(dataPath, 'Pal/Saved/Config/LinuxServer/PalWorldSettings.ini');
    try {
        const current = await getPalworldSettings(dataPath);
        const merged = { ...current, ...newSettings };
        
        const paramsString = Object.entries(merged)
            .map(([k, v]) => `${k}=${isNaN(v) || v === '' ? `"${v}"` : v}`)
            .join(',');

        const content = `[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(${paramsString})`;
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true };
    } catch (e) {
        return { error: e.message };
    }
}
