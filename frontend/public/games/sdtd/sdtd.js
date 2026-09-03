(function() {
    if (window.__sdtdScriptLoaded) return;
    window.__sdtdScriptLoaded = true;

    window.announceHorde = function() {
        const day = document.getElementById('sdtd-horde-day').textContent;
        const msg = `La próxima Horda Luna Roja llegará el Día ${day}. ¡Prepárense!`;
        Nexus.api(`/api/sdtd/rcon/${currentServerId}`, {
            method: 'POST',
            body: JSON.stringify({ command: `say "${msg}"` })
        }).then(res => {
            if(res.error) {
                showToast('Error al anunciar: ' + res.error, 'error');
            } else {
                showToast('Anuncio enviado al juego', 'success');
            }
        });
    };

    setTimeout(() => {
        if(currentServer && currentServer.template === 'sdtd') {
            const dayEl = document.getElementById('sdtd-horde-day');
            if(dayEl) {
                const saved = localStorage.getItem(`sdtd-horde-${currentServerId}`);
                if(saved) dayEl.textContent = saved;
            }
        }
    }, 500);
})();
