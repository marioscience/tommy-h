import axios from 'axios';

/**
 * Función genérica para buscar en Thunderstore
 * Pattern: https://thunderstore.io/c/{community}/api/v1/package/
 */
async function searchThunderstore(community, query = "") {
    const api = `https://thunderstore.io/c/${community}/api/v1/package/`;
    try {
        console.log(`🔍 [Thunderstore] Consultando ${community} Index...`);
        const response = await axios.get(api, {
            headers: { 'User-Agent': 'RageNodes/1.0.0' }
        });

        let mods = response.data;

        if (query) {
            const q = query.toLowerCase();
            mods = mods.filter(m => {
                const latest = m.versions[0];
                return m.name.toLowerCase().includes(q) || 
                       m.full_name.toLowerCase().includes(q) ||
                       (latest.description && latest.description.toLowerCase().includes(q));
            });
        }

        // Mapear al formato unificado de RageNodes
        return mods.slice(0, 50).map(m => {
            const latest = m.versions[0];
            return {
                project_id: m.full_name,
                title: m.name.replace(/_/g, ' '),
                author: m.owner,
                description: latest.description || 'Sin descripción',
                icon_url: latest.icon,
                downloads: m.downloads || 0,
                website_url: m.package_url,
                latest_version: latest.version_number
            };
        });
    } catch (error) {
        console.error(`Error buscando mods en Thunderstore (${community}):`, error.message);
        return [];
    }
}

export async function searchValheimMods(query) {
    return searchThunderstore('valheim', query);
}

export async function searchPalworldMods(query) {
    return searchThunderstore('palworld', query);
}

export async function searchSDTDMods(query) {
    return searchThunderstore('7daystodie', query);
}
