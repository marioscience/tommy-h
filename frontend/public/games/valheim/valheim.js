(function() {
    if (window.__valheimScriptLoaded) return;
    window.__valheimScriptLoaded = true;

    async function addValheimToList() {
        const type = document.getElementById('valheim-list-type').value;
        const steamId = document.getElementById('valheim-list-input').value.trim();
        if(!steamId) return showToast('Introduce un SteamID', 'error');
        
        try {
            const res = await Nexus.api(`/api/valheim/list/${currentServerId}`, {
                method: 'POST',
                body: JSON.stringify({ type, steamId })
            });
            if(res.error) throw new Error(res.error);
            showToast('Jugador añadido a la lista', 'success');
            document.getElementById('valheim-list-input').value = '';
            loadValheimLists();
        } catch(e) {
            showToast(e.message, 'error');
        }
    }

    async function loadValheimLists() {
        const type = document.getElementById('valheim-list-type').value;
        const container = document.getElementById('valheim-lists-box');
        try {
            const res = await Nexus.api(`/api/valheim/list/${currentServerId}?type=${type}`);
            if(res.error) throw new Error(res.error);
            const items = res.items || [];
            
            if(items.length === 0) {
                container.innerHTML = '<div style="color:var(--muted); text-align:center; padding:20px;">No hay jugadores en esta lista</div>';
                return;
            }
            
            container.innerHTML = items.map(id => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                    <span style="font-family:monospace; color:#94a3b8;">${id}</span>
                    <button class="btn" style="background:rgba(239,68,68,0.1); color:#fca5a5; border:1px solid rgba(239,68,68,0.3);" data-rn-onclick="priv_0216"><i class="fa-solid fa-trash"></i></button>
                </div>
            `).join('');
        } catch(e) {
            container.innerHTML = `<div style="color:var(--danger); text-align:center;">Error: ${e.message}</div>`;
        }
    }

    window.addValheimToList = addValheimToList;
    window.loadValheimLists = loadValheimLists;

    document.getElementById('valheim-list-type').addEventListener('change', loadValheimLists);
    document.getElementById('valheim-list-input').addEventListener('keypress', (e) => {
        if(e.key === 'Enter') addValheimToList();
    });

    setTimeout(() => {
        if(currentServer && currentServer.template === 'valheim') {
            loadValheimLists();
        }
    }, 500);
})();
