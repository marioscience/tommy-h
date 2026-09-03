(function() {
    if (window.__minecraftScriptLoaded) return;
    window.__minecraftScriptLoaded = true;

    async function sendMcCmd(cmd) {
        if (!cmd || cmd.trim().split(' ').length < 2) return showToast('Introduce un nombre de jugador válido', 'warning');
        try {
            const res = await Nexus.api(`/api/rcon/${currentServerId}/command`, { method: 'POST', body: JSON.stringify({ command: cmd }) });
            if (res.error) throw new Error(res.error);
            showToast(res.output || 'Comando enviado con éxito', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    async function loadMcProperties() {
        try {
            const props = await Nexus.api(`/api/minecraft/${currentServerId}/properties`);
            if (props.error) return;
            document.getElementById('mc-online-mode').value = props['online-mode'] || 'true';
            document.getElementById('mc-difficulty').value = props['difficulty'] || 'easy';
            document.getElementById('mc-max-players').value = props['max-players'] || '20';
            document.getElementById('mc-motd').value = props['motd'] || 'Un servidor de RageNodes';
        } catch (e) { console.error('Error loading MC props:', e); }
    }

    async function saveMcProperties() {
        const body = {
            'online-mode': document.getElementById('mc-online-mode').value,
            'difficulty': document.getElementById('mc-difficulty').value,
            'max-players': document.getElementById('mc-max-players').value,
            'motd': document.getElementById('mc-motd').value
        };
        try {
            const res = await Nexus.api(`/api/minecraft/${currentServerId}/properties`, { method: 'POST', body: JSON.stringify(body) });
            if (res.error) throw new Error(res.error);
            showToast('Propiedades guardadas. Requiere reiniciar el servidor.', 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        }
    }

    async function searchMcPlugins() {
        const q = document.getElementById('mc-plugin-search').value;
        const container = document.getElementById('mc-plugins-results');
        if (!q) return showToast('Escribe algo para buscar', 'error');

        container.innerHTML = '<div class="mc-placeholder-text" style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Buscando...</div>';

        try {
            const res = await Nexus.api(`/api/plugins/search?game=minecraft&q=${encodeURIComponent(q)}`);
            if (res.error) throw new Error(res.error);

            if (!res.items || res.items.length === 0) {
                container.innerHTML = '<div class="mc-placeholder-text">No se encontraron resultados.</div>';
                return;
            }

            let html = '';
            res.items.forEach(p => {
                html += `
                    <div class="mc-plugin-card-item">
                        <div class="mc-plugin-card-header">
                            <img src="${p.iconUrl}" ${rnBind("error", (event, element) => { element.src = 'https://static.wikia.nocookie.net/minecraft_gamepedia/images/4/44/Grass_Block_Revision_6.png' })}>
                            <div>
                                <h5>${p.name}</h5>
                                <span>${p.author} | <i class="fa-solid fa-download"></i> ${p.downloads}</span>
                            </div>
                        </div>
                        <div class="mc-plugin-card-body">
                            <p>${p.description}</p>
                            <button class="btn btn-primary" ${rnBind("click", (event, element) => { installPlugin((p.id), 'minecraft', element) })}><i class="fa-solid fa-download"></i> Instalar (1-Clic)</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<div class="mc-placeholder-text" style="color:var(--danger);">Error: ${e.message}</div>`;
        }
    }

    async function installPlugin(pluginId, game, btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando...';
        btn.disabled = true;
        try {
            const res = await Nexus.api(`/api/plugins/install/${currentServerId}`, {
                method: 'POST',
                body: JSON.stringify({ pluginId, game })
            });
            if (res.error) throw new Error(res.error);
            showToast(res.message, 'success');
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Instalado';
            btn.style.background = 'var(--success)';
        } catch (e) {
            showToast(e.message, 'error');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    window.sendMcCmd = sendMcCmd;
    window.loadMcProperties = loadMcProperties;
    window.saveMcProperties = saveMcProperties;
    window.searchMcPlugins = searchMcPlugins;
    window.installPlugin = installPlugin;

    setTimeout(() => { if (currentServer && currentServer.template === 'minecraft') loadMcProperties(); }, 1000);
})();
