// ==========================================================================
// OxideProxy • L7 Control Plane v2.0 • Client Logic
// ==========================================================================

const urlParams = new URLSearchParams(window.location.search);
const adminToken = urlParams.get('token') || localStorage.getItem('nexus_token') || sessionStorage.getItem('nexus_token') || localStorage.getItem('token') || '';
if (adminToken) {
    sessionStorage.setItem('oxide_token', adminToken);
}
const activeToken = adminToken || sessionStorage.getItem('oxide_token') || '';

function getAuthHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
        headers['x-auth-token'] = activeToken;
    }
    return headers;
}

async function authFetch(urlStr, options = {}) {
    const opts = { ...options };
    opts.headers = getAuthHeaders(opts.headers || {});
    let targetUrl = urlStr;
    if (activeToken && !urlStr.includes('token=')) {
        const sep = urlStr.includes('?') ? '&' : '?';
        targetUrl = `${urlStr}${sep}token=${encodeURIComponent(activeToken)}`;
    }
    return await fetch(targetUrl, opts);
}

let currentConfig = null;
let chartThroughput = null;
let chartPps = null;
let chartSystem = null;
let liveLogsRequest = null;

const MAX_CHART_POINTS = 15;
const timeLabels = [];

// Data structures para los 3 gráficos globales
const dataThroughput = {
    labels: timeLabels,
    datasets: [
        { label: 'Ingress (Mbps)', yAxisID: 'yIngress', borderColor: '#00f0ff', backgroundColor: 'rgba(0, 240, 255, 0.1)', data: [], fill: true, tension: 0.4 },
        { label: 'Egress (Mbps)', yAxisID: 'yEgress', borderColor: '#00ff88', backgroundColor: 'rgba(0, 255, 136, 0.1)', data: [], fill: true, tension: 0.4 }
    ]
};

const dataPps = {
    labels: timeLabels,
    datasets: [
        { label: 'UDP (PPS - ZeroCopy)', borderColor: '#00ff88', backgroundColor: 'rgba(0, 255, 136, 0.1)', data: [], fill: true, tension: 0.4 },
        { label: 'TCP (lecturas/s)', borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.1)', data: [], fill: true, tension: 0.4 }
    ]
};

const dataSystem = {
    labels: timeLabels,
    datasets: [
        { label: 'Bloqueado L4 (PPS)', borderColor: '#ff3366', backgroundColor: 'rgba(255, 51, 102, 0.1)', data: [], fill: true, tension: 0.4 },
        { label: 'RAM Usada (%)', borderColor: '#ffbb00', backgroundColor: 'rgba(255, 187, 0, 0.1)', data: [], fill: true, tension: 0.4 }
    ]
};

// Data structures para gráficos individuales por servidor en Popup
const perServerCharts = {};
const perServerData = {};

let activeServerModalGameId = null;
let consolePaused = false;
let currentLogFilter = 'ALL';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function parseActionIndex(element) {
    const index = Number.parseInt(element?.dataset.index || '', 10);
    return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    fetchAdvancedMetrics();
    fetchConfig();

    // Bucle de actualización rápida (Polling cada 3s para métricas, 1s para logs)
    setInterval(() => {
        fetchAdvancedMetrics();
    }, 3000);

    setInterval(() => {
        fetchLiveLogs();
    }, 1000);

    // Event Listeners
    document.getElementById('btn-save-config').addEventListener('click', saveConfig);
    document.getElementById('btn-add-route').addEventListener('click', () => openRouteModal());
    document.getElementById('modal-close-btn').addEventListener('click', closeRouteModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeRouteModal);
    document.getElementById('form-route-modal').addEventListener('submit', handleRouteSubmit);

    document.getElementById('modal-chart-close-btn').addEventListener('click', closeServerChartModal);
    document.getElementById('btn-console-pause').addEventListener('click', toggleConsolePause);
    document.getElementById('btn-console-clear').addEventListener('click', clearConsole);
    document.getElementById('log-filter-select').addEventListener('change', (e) => {
        currentLogFilter = e.target.value;
        fetchLiveLogs(true);
    });

    document.getElementById('btn-save-firewall').addEventListener('click', saveFirewallRules);
    document.getElementById('btn-add-blacklist').addEventListener('click', addIpToBlacklist);
    fetchFirewallRules();

    // Event Listeners para Pestañas Cero Scroll
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.addEventListener('click', (event) => {
        const presetButton = event.target.closest('[data-preset]');
        if (presetButton) return applyPreset(presetButton.dataset.preset);

        const chartButton = event.target.closest('[data-action="server-chart"]');
        if (chartButton) {
            const index = parseActionIndex(chartButton);
            if (index !== null) return openServerChartModal(index);
        }

        const editButton = event.target.closest('[data-action="route-edit"]');
        if (editButton) {
            const index = parseActionIndex(editButton);
            if (index !== null) return openRouteModal(index);
        }

        const deleteButton = event.target.closest('[data-action="route-delete"]');
        if (deleteButton) {
            const index = parseActionIndex(deleteButton);
            if (index !== null) return deleteRoute(index);
        }

        const unblockButton = event.target.closest('[data-action="blacklist-remove"]');
        if (unblockButton) {
            const index = parseActionIndex(unblockButton);
            if (index !== null) return removeIpFromBlacklist(index);
        }
    });
});

// ==========================================================================
// 1. Inicialización de Gráficos (Chart.js)
// ==========================================================================

function createChart(ctxId, dataObj) {
    const ctx = document.getElementById(ctxId).getContext('2d');
    const scales = {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
    };
    if (ctxId === 'chartThroughput') {
        delete scales.y;
        scales.yIngress = {
            type: 'linear', position: 'left', beginAtZero: true,
            grid: { color: 'rgba(0, 240, 255, 0.08)' },
            ticks: { color: '#00f0ff' }
        };
        scales.yEgress = {
            type: 'linear', position: 'right', beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: { color: '#00ff88' }
        };
    }
    return new Chart(ctx, {
        type: 'line',
        data: dataObj,
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Inter', weight: 500 } } } },
            scales
        }
    });
}

function initCharts() {
    chartThroughput = createChart('chartThroughput', dataThroughput);
    chartPps = createChart('chartPps', dataPps);
    chartSystem = createChart('chartSystem', dataSystem);
}

// ==========================================================================
// 2. Telemetría Nativa Avanzada
// ==========================================================================

async function fetchAdvancedMetrics() {
    try {
        const res = await authFetch('/api/oxide/metrics/advanced');
        const data = await res.json();
        
        // Actualizar Tarjetas de Estado Rápidas
        document.getElementById('nav-pulse').className = 'pulse-dot online';
        document.getElementById('nav-status-text').innerText = `Tokio Engine • Carga: ${data.system.load_average[0].toFixed(2)}`;
        
        document.getElementById('stat-ebpf-status').innerText = data.proxy_analytics.ebpf_mitigation.status;
        document.getElementById('stat-ebpf-mode').innerText = `Modo: ${data.proxy_analytics.ebpf_mitigation.mode}`;
        
        document.getElementById('stat-total-pps').innerText = `${data.proxy_analytics.throughput.total_pps.toLocaleString()} PPS`;
        const ingressMbps = Number(data.proxy_analytics.throughput.ingress_mbps || 0);
        document.getElementById('stat-bandwidth').innerText = ingressMbps > 0 && ingressMbps < 1
            ? `${(ingressMbps * 1000).toFixed(2)} Kbps Ingress`
            : `${ingressMbps.toFixed(2)} Mbps Ingress`;

        document.getElementById('stat-sys-load').innerText = `${data.system.memory.usage_pct}% RAM`;
        document.getElementById('stat-cpu-cores').innerText = `Cores: ${data.system.cpu_cores} (${data.system.cpu_model.substring(0, 18)}...)`;

        // Actualizar Gráficos Globales
        const now = new Date().toLocaleTimeString();
        if (timeLabels.length >= MAX_CHART_POINTS) {
            timeLabels.shift();
            dataThroughput.datasets[0].data.shift();
            dataThroughput.datasets[1].data.shift();
            dataPps.datasets[0].data.shift();
            dataPps.datasets[1].data.shift();
            dataSystem.datasets[0].data.shift();
            dataSystem.datasets[1].data.shift();
        }

        timeLabels.push(now);
        dataThroughput.datasets[0].data.push(data.proxy_analytics.throughput.ingress_mbps);
        dataThroughput.datasets[1].data.push(data.proxy_analytics.throughput.egress_mbps);

        dataPps.datasets[0].data.push(data.proxy_analytics.throughput.udp_pps);
        dataPps.datasets[1].data.push(data.proxy_analytics.throughput.tcp_pps);

        dataSystem.datasets[0].data.push(data.proxy_analytics.ebpf_mitigation.dropped_packets_per_sec);
        dataSystem.datasets[1].data.push(data.system.memory.usage_pct);

        chartThroughput.update('none');
        chartPps.update('none');
        chartSystem.update('none');

        // Actualizar Gráfico en el Modal de Telemetría si está abierto
        if (activeServerModalGameId !== null && data.proxy_analytics.per_server) {
            const srv = data.proxy_analytics.per_server.find(s => s.game_id === activeServerModalGameId);
            if (srv) {
                document.getElementById(`modal-stat-conns`).innerText = srv.active_connections;
                document.getElementById(`modal-stat-in`).innerText = srv.ingress_mbps;
                document.getElementById(`modal-stat-out`).innerText = srv.egress_mbps;
                document.getElementById(`modal-stat-lat`).innerText = `${srv.latency_ms} ms`;

                const pData = perServerData[srv.game_id];
                if (pData && perServerCharts[srv.game_id]) {
                    if (pData.labels.length >= MAX_CHART_POINTS) {
                        pData.labels.shift();
                        pData.datasets[0].data.shift();
                        pData.datasets[1].data.shift();
                    }
                    pData.labels.push(now);
                    pData.datasets[0].data.push(srv.ingress_mbps);
                    pData.datasets[1].data.push(srv.egress_mbps);
                    perServerCharts[srv.game_id].update('none');
                }
            }
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            console.warn('Reintentando conexión con el motor de métricas...', error.message || error);
        }
        const pulse = document.getElementById('nav-pulse');
        const statusText = document.getElementById('nav-status-text');
        if (pulse) pulse.className = 'pulse-dot offline';
        if (statusText) statusText.innerText = 'Reconectando con el Motor...';
    }
}

// ==========================================================================
// 3. Gestión de Configuración YAML v2.0
// ==========================================================================

async function fetchConfig() {
    try {
        const res = await authFetch('/api/oxide/config');
        currentConfig = await res.json();
        populateConfigUI();
    } catch (error) {
        console.error('Error fetching config:', error);
        showToast('Error al cargar la configuración YAML', 'error');
    }
}

function populateConfigUI() {
    if (!currentConfig) return;

    // Ingress Globales
    document.getElementById('tcp-addr').value = currentConfig.ingress.tcp_listen_addr || "0.0.0.0:8443";
    document.getElementById('udp-addr').value = currentConfig.ingress.udp_listen_addr || "0.0.0.0:8080";
    document.getElementById('max-conn').value = currentConfig.ingress.max_concurrent_connections || 1000000;
    document.getElementById('buf-size').value = currentConfig.ingress.initial_buffer_size || 4096;
    document.getElementById('web-backend').value = currentConfig.routing.default_web_backend || "frontend:80";

    // Advanced Tuning
    if (currentConfig.advanced_tuning) {
        const ebpf = currentConfig.advanced_tuning.ebpf_xdp || {};
        document.getElementById('ebpf-iface').value = ebpf.interface || "eth0";
        document.getElementById('ebpf-mode').value = ebpf.ddos_mitigation_mode || "STRICT_GAMING";
        document.getElementById('ebpf-pps').value = ebpf.max_packet_rate_per_ip || 25000;

        const tcp = currentConfig.advanced_tuning.tcp_settings || {};
        document.getElementById('tcp-cc').value = tcp.congestion_control || "bbr";
        document.getElementById('tcp-nodelay').checked = tcp.tcp_nodelay !== undefined ? tcp.tcp_nodelay : true;

        const sec = currentConfig.advanced_tuning.security || {};
        document.getElementById('rate-limit').value = sec.rate_limit_conns_per_ip || 150;
        document.getElementById('hs-timeout').value = sec.handshake_timeout_ms || 1500;
    }

    if (currentConfig.ingress.socket_rcv_buf) {
        document.getElementById('rcv-buf').value = currentConfig.ingress.socket_rcv_buf;
        document.getElementById('snd-buf').value = currentConfig.ingress.socket_snd_buf;
    }

    if (currentConfig.runtime) {
        document.getElementById('core-pinning').checked = currentConfig.runtime.enable_core_pinning !== undefined ? currentConfig.runtime.enable_core_pinning : true;
    }

    document.getElementById('stat-tcp-cc').innerText = document.getElementById('tcp-cc').value.toUpperCase();

    // Tabla de Ruteo
    renderRoutesTable();
}

function renderRoutesTable() {
    const tbody = document.getElementById('routes-table-body');
    tbody.innerHTML = '';

    const filterSelect = document.getElementById('log-filter-select');
    if (filterSelect) {
        filterSelect.innerHTML = `
            <option value="ALL">Mostrar Todos (ALL)</option>
            <option value="SYS">Sistema / Mitigación L4 (SYS)</option>
        `;
    }

    if (!currentConfig.routing || !currentConfig.routing.game_servers) return;

    currentConfig.routing.game_servers.forEach((route, index) => {
        const protoClass = route.protocol === 'TCP' ? 'badge-tcp' : (route.protocol === 'DUAL' ? 'badge-dual' : 'badge-udp');
        
        if (filterSelect) {
            const opt = document.createElement('option');
            opt.value = route.game_id;
            opt.innerText = `[${route.game_id}] ${route.name || route.description || 'Servidor'}`;
            if (currentLogFilter === route.game_id.toString()) opt.selected = true;
            filterSelect.appendChild(opt);
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="badge badge-glow">${escapeHtml(route.game_id)}</span></td>
            <td><span class="badge-proto ${protoClass}">${escapeHtml(route.protocol || 'UDP')}</span></td>
            <td><code>${escapeHtml(route.backend_addr)}</code></td>
            <td>${escapeHtml(route.description)}</td>
            <td>
                <button class="action-btn chart-btn" data-action="server-chart" data-index="${index}" title="Ver Telemetría en Vivo"><i class="fa-solid fa-chart-line"></i></button>
                <button class="action-btn edit" data-action="route-edit" data-index="${index}" title="Editar Configuración"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="action-btn delete" data-action="route-delete" data-index="${index}" title="Eliminar Servidor"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================================================
// 4. Modales & Presets Rápidos de 1-Clic
// ==========================================================================

let editingRouteIndex = null;

const GAME_PRESETS = {
    fivem: { id: 30120, proto: 'DUAL', port: '30120', desc: 'FiveM FXServer Dedicated (GTA V)' },
    mc_java: { id: 25565, proto: 'TCP', port: '25565', desc: 'Minecraft Java Edition Server' },
    mc_bedrock: { id: 19132, proto: 'UDP', port: '19132', desc: 'Minecraft Bedrock Dedicated Server' },
    cs2: { id: 27015, proto: 'DUAL', port: '27015', desc: 'Counter-Strike 2 / Source Engine' },
    ark: { id: 7777, proto: 'UDP', port: '7777-7778', desc: 'ARK: Survival Ascended Cluster' },
    valheim: { id: 2456, proto: 'UDP', port: '2456-2458', desc: 'Valheim Crossplay Dedicated' }
};

function applyPreset(key) {
    const p = GAME_PRESETS[key];
    if (!p) return;

    document.getElementById('modal-game-id').value = p.id;
    document.getElementById('modal-protocol').value = p.proto;
    document.getElementById('modal-backend-addr').value = `10.5.0.20:${p.port.split('-')[0]}`;
    document.getElementById('modal-port-range').value = p.port;
    document.getElementById('modal-desc').value = p.desc;

    showToast(`Preset ${p.desc.split(' ')[0]} cargado`, 'success');
}

function openRouteModal(index = null) {
    editingRouteIndex = index;
    const modal = document.getElementById('route-modal');
    const form = document.getElementById('form-route-modal');

    if (index !== null) {
        const route = currentConfig.routing.game_servers[index];
        document.getElementById('modal-game-id').value = route.game_id;
        document.getElementById('modal-protocol').value = route.protocol || 'UDP';
        document.getElementById('modal-backend-addr').value = route.backend_addr;
        document.getElementById('modal-port-range').value = route.port_range || route.backend_addr.split(':')[1] || '9000';
        document.getElementById('modal-desc').value = route.description;

        if (route.health_check) {
            document.getElementById('modal-hc-enabled').checked = route.health_check.enabled;
            document.getElementById('modal-hc-interval').value = route.health_check.interval_secs || 10;
            document.getElementById('modal-hc-timeout').value = route.health_check.timeout_secs || 2;
        }
    } else {
        form.reset();
        document.getElementById('modal-hc-enabled').checked = true;
    }

    modal.classList.add('active');
}

function closeRouteModal() {
    document.getElementById('route-modal').classList.remove('active');
    editingRouteIndex = null;
}

function handleRouteSubmit(e) {
    e.preventDefault();

    const game_id = parseInt(document.getElementById('modal-game-id').value, 10);
    const protocol = document.getElementById('modal-protocol').value;
    const backend_addr = document.getElementById('modal-backend-addr').value;
    const port_range = document.getElementById('modal-port-range').value;
    const description = document.getElementById('modal-desc').value;

    const health_check = {
        enabled: document.getElementById('modal-hc-enabled').checked,
        interval_secs: parseInt(document.getElementById('modal-hc-interval').value, 10),
        timeout_secs: parseInt(document.getElementById('modal-hc-timeout').value, 10)
    };

    const newRoute = { game_id, protocol, backend_addr, port_range, description, health_check };

    if (!currentConfig.routing.game_servers) currentConfig.routing.game_servers = [];

    if (editingRouteIndex !== null) {
        currentConfig.routing.game_servers[editingRouteIndex] = newRoute;
        showToast(`Ruta ${game_id} actualizada`, 'success');
    } else {
        currentConfig.routing.game_servers.push(newRoute);
        showToast(`Nueva ruta ${game_id} añadida`, 'success');
    }

    closeRouteModal();
    renderRoutesTable();
    saveConfig(); // Guardado automático en disco al modificar rutas
}

function deleteRoute(index) {
    const route = currentConfig.routing.game_servers[index];
    if (confirm(`¿Estás seguro de eliminar el servidor GameID ${route.game_id}?`)) {
        currentConfig.routing.game_servers.splice(index, 1);
        renderRoutesTable();
        showToast(`Servidor ${route.game_id} eliminado`, 'success');
        saveConfig(); // Guardado automático en disco al eliminar rutas
    }
}

async function saveConfig() {
    if (!currentConfig) return;

    // Actualizar currentConfig con valores del DOM
    currentConfig.ingress.tcp_listen_addr = document.getElementById('tcp-addr').value;
    currentConfig.ingress.udp_listen_addr = document.getElementById('udp-addr').value;
    currentConfig.ingress.max_concurrent_connections = parseInt(document.getElementById('max-conn').value, 10);
    currentConfig.ingress.initial_buffer_size = parseInt(document.getElementById('buf-size').value, 10);
    currentConfig.routing.default_web_backend = document.getElementById('web-backend').value;

    currentConfig.ingress.socket_rcv_buf = parseInt(document.getElementById('rcv-buf').value, 10);
    currentConfig.ingress.socket_snd_buf = parseInt(document.getElementById('snd-buf').value, 10);

    if (!currentConfig.advanced_tuning) currentConfig.advanced_tuning = {};
    currentConfig.advanced_tuning.ebpf_xdp = {
        enabled: true,
        interface: document.getElementById('ebpf-iface').value,
        ddos_mitigation_mode: document.getElementById('ebpf-mode').value,
        max_packet_rate_per_ip: parseInt(document.getElementById('ebpf-pps').value, 10)
    };
    currentConfig.advanced_tuning.tcp_settings = {
        tcp_nodelay: document.getElementById('tcp-nodelay').checked,
        keepalive_interval_secs: 30,
        congestion_control: document.getElementById('tcp-cc').value
    };
    currentConfig.advanced_tuning.security = {
        rate_limit_conns_per_ip: parseInt(document.getElementById('rate-limit').value, 10),
        blacklist_enabled: true,
        handshake_timeout_ms: parseInt(document.getElementById('hs-timeout').value, 10)
    };

    if (!currentConfig.runtime) currentConfig.runtime = {};
    currentConfig.runtime.enable_core_pinning = document.getElementById('core-pinning').checked;

    try {
        const res = await authFetch('/api/oxide/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentConfig)
        });

        const data = await res.json();
        if (data.success) {
            showToast('¡Configuración guardada en oxide_proxy.yml!', 'success');
            populateConfigUI();
        } else {
            showToast(data.error || 'Error al guardar la configuración', 'error');
        }
    } catch (error) {
        console.error('Error saving config:', error);
        showToast('Error de red al guardar la configuración', 'error');
    }
}

// ==========================================================================
// 5. Utilidades & Toast
// ==========================================================================

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-solid fa-triangle-exclamation"></i>';
    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => container.removeChild(toast), 300);
    }, 4000);
}

// ==========================================================================
// 6. Modal de Telemetría Individual (Per-Server Analytics Popup)
// ==========================================================================

function openServerChartModal(index) {
    if (!Number.isSafeInteger(index) || index < 0) return;
    const route = currentConfig.routing.game_servers[index];
    if (!route) return;
    activeServerModalGameId = route.game_id;

    const modal = document.getElementById('server-chart-modal');
    const modalBody = document.getElementById('server-chart-modal-body');
    const chartId = `modal-chart-${index}`;
    const protoBadge = route.protocol === 'TCP' ? 'badge-tcp' : (route.protocol === 'DUAL' ? 'badge-dual' : 'badge-udp');

    modalBody.innerHTML = `
        <div class="srv-header server-header-spaced">
            <div class="srv-title-box">
                <span class="srv-gameid">${escapeHtml(route.game_id)}</span>
                <div>
                    <div class="srv-name">${escapeHtml(route.name || route.description || `Servidor ${route.game_id}`)}</div>
                    <div class="srv-addr"><code>${escapeHtml(route.backend_addr)}</code></div>
                </div>
            </div>
            <div class="srv-badges">
                <span class="badge-proto ${protoBadge}">${escapeHtml(route.protocol || 'UDP')}</span>
                <span class="live-badge"><i class="fa-solid fa-circle live-dot"></i> LIVE</span>
            </div>
        </div>

        <div class="srv-stats-grid server-stats-spaced">
            <div class="srv-stat-box">
                <span class="srv-stat-label">CONEXIONES ACTIVAS</span>
                <span class="srv-stat-val c-cyan" id="modal-stat-conns">0</span>
            </div>
            <div class="srv-stat-box">
                <span class="srv-stat-label">INGRESS (Mbps)</span>
                <span class="srv-stat-val c-emerald" id="modal-stat-in">0.00</span>
            </div>
            <div class="srv-stat-box">
                <span class="srv-stat-label">EGRESS (Mbps)</span>
                <span class="srv-stat-val c-purple" id="modal-stat-out">0.00</span>
            </div>
            <div class="srv-stat-box">
                <span class="srv-stat-label">LATENCIA L4</span>
                <span class="srv-stat-val" id="modal-stat-lat">0.00 ms</span>
            </div>
        </div>

        <div class="srv-chart-container server-chart-sized">
            <canvas id="${chartId}"></canvas>
        </div>
    `;

    // Inicializar data y chart
    perServerData[route.game_id] = {
        labels: [...timeLabels],
        datasets: [
            { label: 'Ingress (Mbps)', borderColor: '#00ff88', backgroundColor: 'rgba(0, 255, 136, 0.1)', data: Array(timeLabels.length).fill(0), fill: true, tension: 0.4 },
            { label: 'Egress (Mbps)', borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.1)', data: Array(timeLabels.length).fill(0), fill: true, tension: 0.4 }
        ]
    };
    perServerCharts[route.game_id] = createChart(chartId, perServerData[route.game_id]);

    modal.classList.add('active');
}

function closeServerChartModal() {
    document.getElementById('server-chart-modal').classList.remove('active');
    if (activeServerModalGameId !== null && perServerCharts[activeServerModalGameId]) {
        perServerCharts[activeServerModalGameId].destroy();
        delete perServerCharts[activeServerModalGameId];
        delete perServerData[activeServerModalGameId];
    }
    activeServerModalGameId = null;
}

// ==========================================================================
// 7. Consola en Vivo (Live Terminal & Log Filtering)
// ==========================================================================

async function fetchLiveLogs(force = false) {
    if (consolePaused && !force) return;
    if (liveLogsRequest && !force) return;

    if (liveLogsRequest && force) {
        liveLogsRequest.abort();
    }

    const controller = new AbortController();
    liveLogsRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await authFetch(`/api/oxide/logs?game_id=${encodeURIComponent(currentLogFilter)}`, {
            signal: controller.signal,
            cache: 'no-store'
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) console.warn('La sesión del panel ya no permite consultar los logs.');
            return;
        }
        const data = await res.json();
        if (!Array.isArray(data.logs)) return;

        const consoleBody = document.getElementById('log-console-body');
        if (!consoleBody) return;

        consoleBody.innerHTML = '';
        data.logs.forEach(log => {
            const line = document.createElement('div');
            line.className = 'log-line';
            const lvlClass = String(log.level || 'INFO').toLowerCase();
            const badgeClass = log.game_id === 'SYS' ? 'sys' : '';
            line.innerHTML = `
                <span class="log-ts">[${escapeHtml(String(log.timestamp).substring(11, 23))}]</span>
                <span class="log-level ${['debug', 'info', 'warn', 'error'].includes(lvlClass) ? lvlClass : 'info'}">${escapeHtml(log.level)}</span>
                <span class="log-badge ${badgeClass}">GameID: ${escapeHtml(log.game_id)}</span>
                <span class="log-msg">${escapeHtml(log.message)}</span>
            `;
            consoleBody.appendChild(line);
        });

        consoleBody.scrollTop = consoleBody.scrollHeight;
    } catch(e) {
        if (e.name !== 'AbortError') {
            console.warn('La consola en vivo se reconectará automáticamente.');
        }
    } finally {
        clearTimeout(timeout);
        if (liveLogsRequest === controller) liveLogsRequest = null;
    }
}

function toggleConsolePause() {
    consolePaused = !consolePaused;
    const btnText = document.getElementById('console-pause-text');
    const btn = document.getElementById('btn-console-pause');
    if (consolePaused) {
        btnText.innerText = 'Reanudar';
        btn.classList.add('glow-btn');
        btn.classList.remove('glass-btn');
    } else {
        btnText.innerText = 'Pausar';
        btn.classList.add('glass-btn');
        btn.classList.remove('glow-btn');
        fetchLiveLogs(true);
    }
}

function clearConsole() {
    const consoleBody = document.getElementById('log-console-body');
    if (consoleBody) consoleBody.innerHTML = '';
}

// ==========================================================================
// 8. Gestión de Firewall & Listas Negras en Tiempo Real
// ==========================================================================

let currentFirewall = { ebpf_xdp: {}, security: { blacklisted_ips: [] } };

async function fetchFirewallRules() {
    try {
        const res = await authFetch('/api/oxide/firewall');
        currentFirewall = await res.json();
        if (!currentFirewall.security.blacklisted_ips) {
            currentFirewall.security.blacklisted_ips = [];
        }
        populateFirewallUI();
    } catch(e) {
        console.error('Error fetching firewall rules:', e);
    }
}

function populateFirewallUI() {
    const ebpf = currentFirewall.ebpf_xdp || {};
    const sec = currentFirewall.security || { blacklisted_ips: [] };

    document.getElementById('fw-ebpf-mode').value = ebpf.ddos_mitigation_mode || 'STRICT_GAMING';
    document.getElementById('fw-ebpf-pps').value = ebpf.max_packet_rate_per_ip || 25000;
    document.getElementById('fw-sec-conns').value = sec.rate_limit_conns_per_ip || 150;

    renderBlacklistTable();
}

function renderBlacklistTable() {
    const tbody = document.getElementById('fw-blacklist-tbody');
    tbody.innerHTML = '';

    const ips = currentFirewall.security.blacklisted_ips || [];
    document.getElementById('fw-blacklist-count').innerText = `${ips.length} IPs Bloqueadas`;

    if (ips.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-table-cell">No hay direcciones IP bloqueadas</td></tr>';
        return;
    }

    ips.forEach((ip, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${escapeHtml(ip)}</code></td>
            <td class="action-cell">
                <button class="action-btn delete" data-action="blacklist-remove" data-index="${index}" title="Desbloquear IP"><i class="fa-solid fa-trash-can"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function saveFirewallRules() {
    const ebpf_xdp = {
        ddos_mitigation_mode: document.getElementById('fw-ebpf-mode').value,
        max_packet_rate_per_ip: parseInt(document.getElementById('fw-ebpf-pps').value, 10)
    };
    const security = {
        rate_limit_conns_per_ip: parseInt(document.getElementById('fw-sec-conns').value, 10),
        blacklisted_ips: currentFirewall.security.blacklisted_ips || []
    };
    const runtime = {
        enable_core_pinning: document.getElementById('core-pinning').checked
    };

    try {
        const res = await authFetch('/api/oxide/firewall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ebpf_xdp, security, runtime })
        });
        const data = await res.json();
        if (data.success) {
            if (currentConfig?.runtime) {
                currentConfig.runtime.enable_core_pinning = runtime.enable_core_pinning;
            }
            showToast('¡Firewall y afinidad de CPU guardados en el motor!', 'success');
            fetchAdvancedMetrics(); // Refrescar estado global
        } else {
            showToast(data.error || 'Error al guardar firewall', 'error');
        }
    } catch(e) {
        console.error('Error saving firewall:', e);
        showToast('Error de red al guardar firewall', 'error');
    }
}

function addIpToBlacklist() {
    const input = document.getElementById('fw-new-ip');
    const ip = input.value.trim();
    if (!ip) return;

    // Validación básica de IP
    const ipRegex = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    if (!ipRegex.test(ip)) {
        showToast('Por favor ingresa una dirección IPv4 válida', 'error');
        return;
    }

    if (!currentFirewall.security.blacklisted_ips) currentFirewall.security.blacklisted_ips = [];
    if (currentFirewall.security.blacklisted_ips.includes(ip)) {
        showToast('La IP ya se encuentra en la lista negra', 'warning');
        return;
    }

    currentFirewall.security.blacklisted_ips.push(ip);
    input.value = '';
    renderBlacklistTable();
    saveFirewallRules();
}

function removeIpFromBlacklist(index) {
    if (!currentFirewall.security.blacklisted_ips) return;
    const ip = currentFirewall.security.blacklisted_ips[index];
    if (confirm(`¿Estás seguro de desbloquear la IP ${ip}?`)) {
        currentFirewall.security.blacklisted_ips.splice(index, 1);
        renderBlacklistTable();
        saveFirewallRules();
        showToast(`IP ${ip} desbloqueada exitosamente`, 'success');
    }
}

// ==========================================================================
// 9. Navegación Cero Scroll (Tabbed Dashboard Switcher)
// ==========================================================================

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Redimensionar gráficos de Chart.js si la pestaña activa es Telemetría
    if (tabId === 'tab-telemetry') {
        setTimeout(() => {
            if (chartThroughput) chartThroughput.resize();
            if (chartPps) chartPps.resize();
            if (chartSystem) chartSystem.resize();
        }, 50);
    }
}
