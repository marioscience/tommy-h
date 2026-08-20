import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { query } from '../db.js';
import * as Docker from './dockerService.js';
import { config } from '../config.js';
import * as Thunderstore from './thunderstoreService.js';

/**
 * 📦 UNIFIED MOD SERVICE
 * Gestor universal de modificaciones para múltiples motores de juego.
 */

export async function getGameMods(serverId, userId, isAdmin) {
    const res = await query('SELECT * FROM servers WHERE id = $1', [serverId]);
    if (res.rowCount === 0) throw new Error("Servidor no encontrado");
    const s = res.rows[0];
    if (!isAdmin && s.owner_id !== userId) throw new Error("No autorizado");

    switch (s.template) {
        case 'zomboid': return await getZomboidMods(s);
        case 'rust': return await getRustMods(s);
        case 'ark': return await getArkMods(s);
        case 'valheim': return await getValheimMods(s);
        case 'sdtd': return await getSDTDMods(s);
        case 'palworld': return await getPalworldMods(s);
        default: return [];
    }
}

// --- 🧟 PROJECT ZOMBOID (Steam Workshop) ---
async function getZomboidMods(s) {
    // Leer el archivo de configuración server.ini
    const iniPath = path.join(s.data_path, 'Zomboid', 'Server', `${s.container_name}.ini`);
    try {
        const content = await fs.readFile(iniPath, 'utf8');
        const workshopIds = content.match(/WorkshopItems=([\d;]+)/)?.[1] || "";
        const modIds = content.match(/Mods=([\w;]+)/)?.[1] || "";
        
        return {
            type: 'workshop',
            activeWorkshopIds: workshopIds.split(';').filter(Boolean),
            activeModNames: modIds.split(';').filter(Boolean)
        };
    } catch (e) {
        return { type: 'workshop', activeWorkshopIds: [], activeModNames: [] };
    }
}

export async function installZomboidMod(serverId, userId, isAdmin, workshopId, modName) {
    const res = await query('SELECT * FROM servers WHERE id = $1', [serverId]);
    const s = res.rows[0];
    
    const iniPath = path.join(s.data_path, 'Zomboid', 'Server', `${s.container_name}.ini`);
    let content = await fs.readFile(iniPath, 'utf8');
    
    // Actualizar WorkshopItems
    let workshopItems = content.match(/WorkshopItems=(.*)/)?.[1] || "";
    if (!workshopItems.includes(workshopId)) {
        workshopItems = workshopItems ? `${workshopItems};${workshopId}` : workshopId;
        content = content.replace(/WorkshopItems=.*/, `WorkshopItems=${workshopItems}`);
    }
    
    // Actualizar Mods
    let mods = content.match(/Mods=(.*)/)?.[1] || "";
    if (!mods.includes(modName)) {
        mods = mods ? `${mods};${modName}` : modName;
        content = content.replace(/Mods=.*/, `Mods=${mods}`);
    }
    
    await fs.writeFile(iniPath, content);
    return { success: true };
}

// --- 🦀 RUST (Oxide Plugins) ---
async function getRustMods(s) {
    const pluginsDir = path.join(s.data_path, 'oxide', 'plugins');
    try {
        const files = await fs.readdir(pluginsDir);
        return {
            type: 'oxide',
            installed: files.filter(f => f.endsWith('.cs')).map(f => f.replace('.cs', ''))
        };
    } catch (e) {
        return { type: 'oxide', installed: [], needsOxide: true };
    }
}

export async function installRustPlugin(serverId, pluginUrl, pluginName) {
    const res = await query('SELECT * FROM servers WHERE id = $1', [serverId]);
    const s = res.rows[0];
    const pluginsDir = path.join(s.data_path, 'oxide', 'plugins');
    
    await fs.mkdir(pluginsDir, { recursive: true });
    const response = await axios.get(pluginUrl, { responseType: 'arraybuffer' });
    await fs.writeFile(path.join(pluginsDir, `${pluginName}.cs`), response.data);
    
    return { success: true };
}

// --- 🐉 ARK: ASCENDED (CurseForge) ---
async function getArkMods(s) {
    const iniPath = path.join(s.data_path, 'common', 'ARK Survival Ascended Dedicated Server', 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'GameUserSettings.ini');
    try {
        const content = await fs.readFile(iniPath, 'utf8');
        const modIds = content.match(/ActiveMods=([\d,]+)/)?.[1] || "";
        return {
            type: 'curseforge',
            activeModIds: modIds.split(',').filter(Boolean)
        };
    } catch (e) {
        return { type: 'curseforge', activeModIds: [] };
    }
}

export async function installArkMod(serverId, modId) {
    const res = await query('SELECT * FROM servers WHERE id = $1', [serverId]);
    const s = res.rows[0];
    const iniPath = path.join(s.data_path, 'common', 'ARK Survival Ascended Dedicated Server', 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'GameUserSettings.ini');
    
    let content = await fs.readFile(iniPath, 'utf8');
    let activeMods = content.match(/ActiveMods=(.*)/)?.[1] || "";
    
    if (!activeMods.includes(modId)) {
        activeMods = activeMods ? `${activeMods},${modId}` : modId;
        if (content.includes('ActiveMods=')) {
            content = content.replace(/ActiveMods=.*/, `ActiveMods=${activeMods}`);
        } else {
            content += `\nActiveMods=${activeMods}`;
        }
    }
    
    await fs.writeFile(iniPath, content);
    return { success: true };
}

// --- ⚔️ VALHEIM (BepInEx) ---
async function getValheimMods(s) {
    const modsDir = path.join(s.data_path, 'BepInEx', 'plugins');
    try {
        const files = await fs.readdir(modsDir);
        return {
            type: 'bepinex',
            installed: files.filter(f => f.endsWith('.dll'))
        };
    } catch (e) {
        return { type: 'bepinex', installed: [], needsBepInEx: true };
    }
}

// --- 🛠️ 7 DAYS TO DIE (Modlets) ---
async function getSDTDMods(s) {
    const modsDir = path.join(s.data_path, 'Mods');
    try {
        const folders = await fs.readdir(modsDir);
        return {
            type: 'modlets',
            installed: folders
        };
    } catch (e) {
        return { type: 'modlets', installed: [] };
    }
}

// --- 🥚 PALWORLD (.pak / UE4SS) ---
async function getPalworldMods(s) {
    const modsDir = path.join(s.data_path, 'Pal', 'Content', 'Paks');
    try {
        const files = await fs.readdir(modsDir);
        return {
            type: 'pak',
            installed: files.filter(f => f.endsWith('.pak'))
        };
    } catch (e) {
        return { type: 'pak', installed: [] };
    }
}

// --- 🐉 ARK: ASCENDED (Discovery & Search) ---
export async function searchArkMods(query = "") {
    const curated = [
        { project_id: '928501', title: 'Awesome Spyglass!', author: '7028741', description: 'The most popular spyglass mod. Shows stats and info of dinos.', icon_url: 'https://media.forgecdn.net/avatars/908/300/638343350171224853.png', downloads: 1200000 },
        { project_id: '928793', title: 'Structures Plus (S+)', author: 'OrionSun', description: 'Essential building mod with many utility structures.', icon_url: 'https://media.forgecdn.net/avatars/908/320/638343354452145620.png', downloads: 2500000 },
        { project_id: '929555', title: 'Pelayoris Cryo Storage', author: 'Pelayori', description: 'Advanced cryopod system for storing dinos.', icon_url: 'https://media.forgecdn.net/avatars/921/484/638367000000000000.png', downloads: 850000 },
        { project_id: '928575', title: 'Automated Ark', author: 'Blitzfire91', description: 'Automation systems for various ARK tasks.', icon_url: 'https://media.forgecdn.net/avatars/908/400/638343358000000000.png', downloads: 900000 },
        { project_id: '927131', title: 'TGs Stacking Mod', author: 'The_Great_Nico', description: 'Increases stack sizes and reduces weight.', icon_url: 'https://media.forgecdn.net/avatars/905/100/638340000000000000.png', downloads: 1500000 }
    ];

    if (!query) return curated;
    const q = query.toLowerCase();
    return curated.filter(m => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
}

export async function searchValheimMods(query = "") {
    return await Thunderstore.searchValheimMods(query);
}

export async function searchPalworldMods(query = "") {
    return await Thunderstore.searchPalworldMods(query);
}

export async function searchSDTDMods(query = "") {
    const curated = [
        { project_id: 'UndeadLegacy', title: 'Undead Legacy', author: 'Subquake', description: 'A massive overhaul mod that changes almost everything in the game.', icon_url: '', downloads: 500000 },
        { project_id: 'DarknessFalls', title: 'Darkness Falls', author: 'KhaineGB', description: 'A popular overhaul focusing on increased difficulty and new classes.', icon_url: '', downloads: 750000 },
        { project_id: 'Sorcery', title: 'Sorcery', author: 'Devidale', description: 'Adds magic, spells, and elemental powers to the game.', icon_url: '', downloads: 300000 },
        { project_id: 'Ravenhearst', title: 'Ravenhearst', author: 'JaxTeller718', description: 'Hardcore survival overhaul focusing on realistic crafting and terrifying nights.', icon_url: '', downloads: 420000 },
        { project_id: 'WarOfTheWalkers', title: 'War of the Walkers', author: 'Dwallorde', description: 'Massive mod with new loot, perks, biomes, and custom enemies.', icon_url: '', downloads: 380000 },
        { project_id: 'AgeOfOblivion', title: 'Age of Oblivion', author: 'Ragnarok', description: 'Adds farming, vehicles, cloning, and a massive amount of new weapons.', icon_url: '', downloads: 150000 },
        { project_id: 'RomeroMod', title: 'Romero Mod', author: 'KhaineGB', description: 'Classic zombie experience: zombies only walk but are extremely tough and spawn in massive hordes.', icon_url: '', downloads: 90000 },
        { project_id: 'TrueSurvival', title: 'True Survival', author: 'Spider', description: 'Forces players to play smart, making basic survival much more challenging.', icon_url: '', downloads: 110000 },
        { project_id: 'BdubVehicles', title: 'Bdub\'s Vehicles', author: 'Bdubyah', description: 'Adds a huge variety of custom cars, trucks, and helicopters.', icon_url: '', downloads: 850000 }
    ];

    if (!query) return curated;
    const q = query.toLowerCase();
    return curated.filter(m => m.title.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
}
