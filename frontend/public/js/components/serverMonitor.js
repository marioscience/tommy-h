/**
 * 📊 ServerMonitor Component (Telemetría & Ciclo de Vida)
 * Encapsula la monitorización en vivo de CPU, RAM, Disco y controles de estado.
 */
export class ServerMonitor {
    constructor(serverId, options = {}) {
        this.serverId = serverId;
        this.cpuElement = document.getElementById(options.cpuId || 'cpu-usage');
        this.ramElement = document.getElementById(options.ramId || 'ram-usage');
        this.diskElement = document.getElementById(options.diskId || 'disk-usage');
        this.statusBadge = document.getElementById(options.statusId || 'server-status');
        this.updateInterval = null;
    }

    startMonitoring(intervalMs = 3000) {
        this.stopMonitoring();
        this.updateStats();
        this.updateInterval = setInterval(() => this.updateStats(), intervalMs);
    }

    stopMonitoring() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    async updateStats() {
        try {
            const res = await fetch(`/api/servers/${this.serverId}/stats`);
            if (res.ok) {
                const stats = await res.json();
                this.renderStats(stats);
            }
        } catch (e) {
            console.error('⚠️ [ServerMonitor] Error obteniendo estadísticas:', e);
        }
    }

    renderStats(stats) {
        if (this.cpuElement) this.cpuElement.textContent = `${stats.cpu || 0}%`;
        if (this.ramElement) this.ramElement.textContent = `${stats.ram || 0}%`;
        if (this.diskElement) this.diskElement.textContent = `${stats.disk || 0}%`;
        if (this.statusBadge) {
            this.statusBadge.textContent = stats.status || 'Desconocido';
            this.statusBadge.className = `badge badge-${stats.status === 'online' ? 'success' : 'danger'}`;
        }
    }

    async sendCommand(command) {
        try {
            const res = await fetch(`/api/servers/${this.serverId}/power`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: command })
            });
            return res.ok;
        } catch (e) {
            console.error(`⚠️ [ServerMonitor] Error enviando comando ${command}:`, e);
            return false;
        }
    }
}
