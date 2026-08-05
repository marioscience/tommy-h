import { EventEmitter } from 'events';
import * as Docker from './dockerService.js';

/**
 * 📡 LOG HUB (Shared Log Observer)
 * Optimiza el streaming de logs evitando lecturas redundantes del disco.
 */
class LogHub extends EventEmitter {
    constructor() {
        super();
        this.observers = new Map(); // serverId -> { lastLogs, interval }
    }

    subscribe(serverId, callback) {
        this.on(`logs:${serverId}`, callback);

        if (!this.observers.has(serverId)) {
            this.startPolling(serverId);
        } else {
            // Enviar inmediatamente los últimos logs conocidos si existen
            const obs = this.observers.get(serverId);
            if (obs.lastLogs) callback(obs.lastLogs);
        }
    }

    unsubscribe(serverId, callback) {
        this.removeListener(`logs:${serverId}`, callback);
        
        if (this.listenerCount(`logs:${serverId}`) === 0) {
            this.stopPolling(serverId);
        }
    }

    async startPolling(serverId) {
        console.log(`[LogHub] Iniciando observador compartido para: ${serverId}`);
        
        const poll = async () => {
            try {
                const logs = await Docker.fetchContainerLogs(`ragenodes-${serverId.slice(0,8)}`);
                const obs = this.observers.get(serverId);
                
                if (obs && logs !== obs.lastLogs) {
                    obs.lastLogs = logs;
                    this.emit(`logs:${serverId}`, logs);
                }
            } catch (e) {
                console.error(`[LogHub] Error observando ${serverId}:`, e.message);
            }
        };

        const interval = setInterval(poll, 1500);
        this.observers.set(serverId, { lastLogs: null, interval });
        await poll(); // Primera ejecución inmediata
    }

    stopPolling(serverId) {
        console.log(`[LogHub] Deteniendo observador compartido para: ${serverId}`);
        const obs = this.observers.get(serverId);
        if (obs) {
            clearInterval(obs.interval);
            this.observers.delete(serverId);
        }
    }
}

export const logHub = new LogHub();
