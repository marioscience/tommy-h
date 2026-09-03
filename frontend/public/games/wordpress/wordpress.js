(function() {
    if (window.__wordpressScriptLoaded) return;
    window.__wordpressScriptLoaded = true;

    window.loadWordPressInfo = function() {
        if(currentServer) {
            document.getElementById('wp-url-display').innerText = `http://w${currentServer.id.slice(0,8)}.ragenodes.com`;
            document.getElementById('wp-db-name').value = `wp_ragenodes_${currentServer.id.slice(0,8)}`;
            document.getElementById('wp-db-user').value = `root (Contraseña por defecto: ragenodes_db)`;
        }
    };

    setTimeout(loadWordPressInfo, 500);
})();
