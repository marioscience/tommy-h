(function() {
    if (window.__fivemScriptLoaded) return;
    window.__fivemScriptLoaded = true;

    async function executeFiveMResource(action) {
        const resourceName = document.getElementById('fivem-resource-name').value.trim();
        if (!resourceName) return showToast('Escribe el nombre del recurso.', 'error');

        const command = `${action} ${resourceName}`;
        try {
            const res = await Nexus.api(`/api/servers/${currentServerId}/command`, { method: 'POST', body: JSON.stringify({ command }) });
            if (res.error) throw new Error(res.error);
            showToast(`Comando '${command}' enviado al servidor.`, 'success');
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    window.executeFiveMResource = executeFiveMResource;
})();
