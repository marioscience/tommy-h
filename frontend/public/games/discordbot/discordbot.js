(function() {
    if (window.__discordbotScriptLoaded) return;
    window.__discordbotScriptLoaded = true;

    async function executeAutoInstall(type) {
        if (confirm(`¿Estás seguro de que quieres ejecutar la instalación de dependencias con ${type.toUpperCase()}? Este proceso puede tardar unos segundos.`)) {
            showToast(`Iniciando instalación de dependencias con ${type.toUpperCase()}...`, 'info');
            try {
                const res = await Nexus.api(`/api/servers/${currentServerId}/auto-install`, { method: 'POST', body: JSON.stringify({ type }) });
                if (res.error) throw new Error(res.error);
                showToast(res.message, 'success');
            } catch (e) {
                showToast(e.message, 'error');
            }
        }
    }

    async function loadDiscordEnvFile() {
        const filename = document.getElementById('discord-env-filename').value;
        if (!filename) return showToast('Escribe un nombre de archivo válido.', 'error');
        try {
            const res = await Nexus.api(`/api/files/read?serverId=${currentServerId}&path=${encodeURIComponent(filename)}`);
            if (res.error) throw new Error(res.error);
            document.getElementById('discord-env-content').value = res.content || '';
            showToast(`Archivo ${filename} cargado.`, 'success');
        } catch (e) {
            showToast('No se encontró el archivo. Si es nuevo, guárdalo para crearlo.', 'warning');
            document.getElementById('discord-env-content').value = '';
        }
    }

    async function saveDiscordEnvFile() {
        const filename = document.getElementById('discord-env-filename').value;
        const content = document.getElementById('discord-env-content').value;
        if (!filename) return showToast('Escribe un nombre de archivo válido.', 'error');
        try {
            const res = await Nexus.api('/api/files/write', {
                method: 'PUT',
                body: JSON.stringify({
                    serverId: currentServerId,
                    path: filename,
                    content: content
                })
            });
            if (res.error) throw new Error(res.error);
            showToast('Archivo guardado exitosamente.', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    window.executeAutoInstall = executeAutoInstall;
    window.loadDiscordEnvFile = loadDiscordEnvFile;
    window.saveDiscordEnvFile = saveDiscordEnvFile;

    setTimeout(() => { if (currentServer && currentServer.template === 'discordbot') loadDiscordEnvFile(); }, 1000);
})();
