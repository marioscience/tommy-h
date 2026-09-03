(function() {
    if (window.__arkScriptLoaded) return;
    window.__arkScriptLoaded = true;

    async function loadArkSettings() {
        try {
            const config = await Nexus.api(`/api/ark/config/${currentServerId}`);
            if (config.error) return;

            if (config['TamingSpeedMultiplier']) {
                document.getElementById('ark-taming').value = config['TamingSpeedMultiplier'];
                document.getElementById('ark-val-taming').innerText = 'x' + config['TamingSpeedMultiplier'];
            }
            if (config['HarvestAmountMultiplier']) {
                document.getElementById('ark-harvest').value = config['HarvestAmountMultiplier'];
                document.getElementById('ark-val-harvest').innerText = 'x' + config['HarvestAmountMultiplier'];
            }
            if (config['GenericXPMultiplier']) {
                document.getElementById('ark-xp').value = config['GenericXPMultiplier'];
                document.getElementById('ark-val-xp').innerText = 'x' + config['GenericXPMultiplier'];
            }

            document.getElementById('ark-sessionname').value = config['SessionName'] || '';
            document.getElementById('ark-adminpass').value = config['ServerAdminPassword'] || '';
        } catch (e) {}
    }

    async function saveArkSettings() {
        const body = {
            'TamingSpeedMultiplier': document.getElementById('ark-taming').value,
            'HarvestAmountMultiplier': document.getElementById('ark-harvest').value,
            'GenericXPMultiplier': document.getElementById('ark-xp').value,
            'KillXPMultiplier': document.getElementById('ark-xp').value,
            'HarvestXPMultiplier': document.getElementById('ark-xp').value,
            'CraftXPMultiplier': document.getElementById('ark-xp').value,
            'SessionName': document.getElementById('ark-sessionname').value,
            'ServerAdminPassword': document.getElementById('ark-adminpass').value,
        };

        try {
            const res = await Nexus.api(`/api/ark/config/${currentServerId}`, { method: 'POST', body: JSON.stringify(body) });
            if (res.error) throw new Error(res.error);
            showToast('Configuración de ARK guardada (Reinicia el servidor para aplicar)', 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        }
    }

    window.loadArkSettings = loadArkSettings;
    window.saveArkSettings = saveArkSettings;

    setTimeout(() => { if (currentServer && currentServer.template === 'ark') loadArkSettings(); }, 1000);
})();
