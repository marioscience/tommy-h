(function() {
    if (window.__rustScriptLoaded) return;
    window.__rustScriptLoaded = true;

    async function executeRustWipe(type) {
        if(confirm('¿Estás seguro de que deseas hacer este wipe? ¡Los datos no se podrán recuperar! Recomendamos que el servidor esté APAGADO antes de hacerlo.')) {
            try {
                const res = await Nexus.api(`/api/rust/wipe/${currentServerId}`, { method: 'POST', body: JSON.stringify({type}) });
                if(res.error) throw new Error(res.error);
                showToast(res.message || 'Wipe ejecutado correctamente', 'success');
            } catch(e) {
                showToast(e.message, 'error');
            }
        }
    }

    async function loadRustSettings() {
        try {
            const config = await Nexus.api(`/api/rust/config/${currentServerId}`);
            if(config.error) return;
            document.getElementById('rust-hostname').value = config['server.hostname'] || '';
            document.getElementById('rust-seed').value = config['server.seed'] || '';
            document.getElementById('rust-mapsize').value = config['server.worldsize'] || '';
        } catch(e) {}
    }

    async function saveRustSettings() {
        const body = {};
        const hostname = document.getElementById('rust-hostname').value;
        const seed = document.getElementById('rust-seed').value;
        const mapsize = document.getElementById('rust-mapsize').value;

        if(hostname) body['server.hostname'] = hostname;
        if(seed) body['server.seed'] = seed;
        if(mapsize) body['server.worldsize'] = mapsize;

        try {
            const res = await Nexus.api(`/api/rust/config/${currentServerId}`, { method: 'POST', body: JSON.stringify(body) });
            if(res.error) throw new Error(res.error);
            showToast('Configuración guardada (Reinicio requerido)', 'success');
        } catch(e) {
            showToast('Error: ' + e.message, 'error');
        }
    }

    async function searchRustPlugins() {
        const q = document.getElementById('rust-plugin-search').value;
        const container = document.getElementById('rust-plugins-results');
        if(!q) return showToast('Escribe algo para buscar', 'error');
        
        container.innerHTML = '<div style="color:var(--primary); grid-column: 1/-1; text-align:center;"><i class="fa-solid fa-spinner fa-spin"></i> Buscando...</div>';
        
        try {
            const res = await Nexus.api(`/api/plugins/search?game=rust&q=${encodeURIComponent(q)}`);
            if(res.error) throw new Error(res.error);
            
            if(!res.items || res.items.length === 0) {
                container.innerHTML = '<div style="color:var(--muted); grid-column: 1/-1; text-align:center;">No se encontraron resultados.</div>';
                return;
            }
            
            let html = '';
            res.items.forEach(p => {
                html += `
                    <div class="plugin-card">
                        <div class="plugin-card-header">
                            <img src="${p.iconUrl}" ${rnBind("error", (event, element) => { element.src='https://umod.org/images/icon.png' })}>
                            <div>
                                <h5>${p.name}</h5>
                                <span>${p.author} | <i class="fa-solid fa-download"></i> ${p.downloads}</span>
                            </div>
                        </div>
                        <div class="plugin-card-body">
                            <p>${p.description}</p>
                            <button class="btn btn-primary" ${rnBind("click", (event, element) => { installPlugin((p.id), 'rust', element) })}><i class="fa-solid fa-download"></i> Instalar (1-Clic)</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = `<div style="color:var(--danger); grid-column: 1/-1; text-align:center;">Error: ${e.message}</div>`;
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
            if(res.error) throw new Error(res.error);
            showToast(res.message, 'success');
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Instalado';
            btn.style.background = 'var(--success)';
        } catch(e) {
            showToast(e.message, 'error');
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    window.executeRustWipe = executeRustWipe;
    window.loadRustSettings = loadRustSettings;
    window.saveRustSettings = saveRustSettings;
    window.searchRustPlugins = searchRustPlugins;
    window.installPlugin = installPlugin;

    setTimeout(() => { if(currentServer && currentServer.template === 'rust') loadRustSettings(); }, 1000);
})();
