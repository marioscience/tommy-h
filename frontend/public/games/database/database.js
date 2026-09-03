(function() {
    if (window.__databaseScriptLoaded) return;
    window.__databaseScriptLoaded = true;

    setTimeout(() => {
        if (currentServer) {
            const shortId = currentServer.id.slice(0, 8);
            const containerName = `ragenodes-${shortId}`;

            document.getElementById('db-host').value = globalVpsIp;
            document.getElementById('db-port').value = currentServer.fivem_port;

            document.getElementById('db-name').value = `db_${containerName}`;
            document.getElementById('db-user').value = `user_${containerName}`;
            document.getElementById('db-pass').value = `pass_${containerName}_!2026`;
        }
    }, 500);

    function togglePasswordVisibility(inputId, btnElem) {
        const input = document.getElementById(inputId);
        if (input.type === 'password') {
            input.type = 'text';
            btnElem.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        } else {
            input.type = 'password';
            btnElem.innerHTML = '<i class="fa-solid fa-eye"></i>';
        }
    }

    window.togglePasswordVisibility = togglePasswordVisibility;
})();
