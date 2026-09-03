(function() {
    if (window.__palworldScriptLoaded) return;
    window.__palworldScriptLoaded = true;

    async function loadPalworldSettings() {
        try {
            const config = await Nexus.api(`/api/palworld/config/${currentServerId}`);
            if (config.error) return;

            if (config['ExpRate']) {
                document.getElementById('pal-exp').value = parseFloat(config['ExpRate']);
                document.getElementById('pal-val-exp').innerText = 'x' + parseFloat(config['ExpRate']);
            }
            if (config['PalCaptureRate']) {
                document.getElementById('pal-catch').value = parseFloat(config['PalCaptureRate']);
                document.getElementById('pal-val-catch').innerText = 'x' + parseFloat(config['PalCaptureRate']);
            }
            if (config['DeathPenalty']) {
                document.getElementById('pal-death').value = config['DeathPenalty'];
            }
        } catch (e) {}
    }

    async function savePalworldSettings() {
        const body = {
            'ExpRate': parseFloat(document.getElementById('pal-exp').value).toFixed(6),
            'PalCaptureRate': parseFloat(document.getElementById('pal-catch').value).toFixed(6),
            'DeathPenalty': document.getElementById('pal-death').value
        };

        try {
            const res = await Nexus.api(`/api/palworld/config/${currentServerId}`, { method: 'POST', body: JSON.stringify(body) });
            if (res.error) throw new Error(res.error);
            showToast('Configuración guardada (Reinicio requerido)', 'success');
        } catch (e) {
            showToast('Error: ' + e.message, 'error');
        }
    }

    async function executePalworldBroadcast() {
        let msg = document.getElementById('palworld-broadcast-msg').value.trim();
        if (!msg) return showToast('Escribe un mensaje.', 'error');

        msg = msg.replace(/ /g, '_');
        const command = `Broadcast ${msg}`;

        try {
            const res = await Nexus.api(`/api/servers/${currentServerId}/command`, { method: 'POST', body: JSON.stringify({ command }) });
            if (res.error) throw new Error(res.error);
            showToast(`Mensaje enviado.`, 'success');
            document.getElementById('palworld-broadcast-msg').value = '';
        } catch (e) {
            showToast(e.message, 'error');
        }
    }

    window.loadPalworldSettings = loadPalworldSettings;
    window.savePalworldSettings = savePalworldSettings;
    window.executePalworldBroadcast = executePalworldBroadcast;

    setTimeout(() => { if (currentServer && currentServer.template === 'palworld') loadPalworldSettings(); }, 1000);
})();
