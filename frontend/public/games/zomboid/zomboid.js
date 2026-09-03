(function() {
    if (window.__zomboidScriptLoaded) return;
    window.__zomboidScriptLoaded = true;

    const ZOMBOID_FIELDS = {
        WORKSHOP_ITEMS: 'WorkshopItems',
        MODS: 'Mods',
        PUBLIC_NAME: 'PublicName',
        PASSWORD: 'Password',
        MAX_PLAYERS: 'MaxPlayers',
        PVP: 'PVP'
    };

    const ZOMBOID_DEFAULTS = {
        MAX_PLAYERS: 32,
        PVP: false
    };

    async function loadZomboidSettings() {
        try {
            const config = await Nexus.api(`/api/zomboid/config/${currentServerId}`);
            if (config.error) {
                console.error('Failed to load Zomboid config:', config.error);
                return;
            }

            document.getElementById('zomboid-workshop').value = config[ZOMBOID_FIELDS.WORKSHOP_ITEMS] || '';
            document.getElementById('zomboid-mods').value = config[ZOMBOID_FIELDS.MODS] || '';
            document.getElementById('zomboid-name').value = config[ZOMBOID_FIELDS.PUBLIC_NAME] || '';
            document.getElementById('zomboid-password').value = config[ZOMBOID_FIELDS.PASSWORD] || '';
            document.getElementById('zomboid-maxplayers').value = config[ZOMBOID_FIELDS.MAX_PLAYERS] ?? ZOMBOID_DEFAULTS.MAX_PLAYERS;
            document.getElementById('zomboid-pvp').value = String(config[ZOMBOID_FIELDS.PVP] ?? ZOMBOID_DEFAULTS.PVP);
        } catch (error) {
            console.error('Error loading Zomboid settings:', error);
        }
    }

    function buildZomboidPayload() {
        const maxPlayersInput = document.getElementById('zomboid-maxplayers').value;
        const maxPlayers = parseInt(maxPlayersInput, 10);

        if (Number.isNaN(maxPlayers) || maxPlayers < 1) {
            throw new Error('Max Players must be a positive number');
        }

        return {
            [ZOMBOID_FIELDS.WORKSHOP_ITEMS]: document.getElementById('zomboid-workshop').value.trim(),
            [ZOMBOID_FIELDS.MODS]: document.getElementById('zomboid-mods').value.trim(),
            [ZOMBOID_FIELDS.PUBLIC_NAME]: document.getElementById('zomboid-name').value.trim(),
            [ZOMBOID_FIELDS.PASSWORD]: document.getElementById('zomboid-password').value.trim(),
            [ZOMBOID_FIELDS.MAX_PLAYERS]: maxPlayers,
            [ZOMBOID_FIELDS.PVP]: document.getElementById('zomboid-pvp').value
        };
    }

    async function saveZomboidSettings() {
        let payload;
        try {
            payload = buildZomboidPayload();
        } catch (validationError) {
            showToast('Validation error: ' + validationError.message, 'error');
            return;
        }

        try {
            const res = await Nexus.api(`/api/zomboid/config/${currentServerId}`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (res.error) throw new Error(res.error);
            showToast('Configuración guardada (Reinicio requerido para descargar mods)', 'success');
        } catch (error) {
            console.error('Error saving Zomboid settings:', error);
            showToast('Error: ' + error.message, 'error');
        }
    }

    window.saveZomboidSettings = saveZomboidSettings;
    window.loadZomboidSettings = loadZomboidSettings;

    setTimeout(() => {
        if (currentServer && currentServer.template === 'zomboid') {
            loadZomboidSettings();
        }
    }, 1000);
})();
