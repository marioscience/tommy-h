/**
 * 🏭 GameFactory (Módulo 4: Patrón de Diseño Factory & Registry)
 * Centraliza la creación e instanciación polimórfica de cualquier servidor de juegos.
 */
class GameFactoryRegistry {
    constructor() {
        this.services = new Map();
    }

    /**
     * Registra un servicio de juego en la fábrica.
     * @param {string} gameType
     * @param {BaseGameService} serviceInstance
     */
    register(gameType, serviceInstance) {
        this.services.set(gameType.toLowerCase(), serviceInstance);
    }

    /**
     * Obtiene el servicio correspondiente al tipo de juego.
     * @param {string} gameType
     * @returns {BaseGameService}
     */
    get(gameType) {
        const service = this.services.get(String(gameType).toLowerCase());
        if (!service) {
            throw new Error(`[GameFactory] Tipo de juego no soportado: ${gameType}`);
        }
        return service;
    }

    /**
     * Verifica si un tipo de juego está soportado.
     * @param {string} gameType
     * @returns {boolean}
     */
    has(gameType) {
        return this.services.has(String(gameType).toLowerCase());
    }

    /**
     * Lista todos los identificadores de juegos soportados en el sistema.
     * @returns {string[]}
     */
    getSupportedGames() {
        return Array.from(this.services.keys());
    }

    /**
     * Método de conveniencia para instanciar directamente un contenedor.
     */
    async createContainer(gameType, opts) {
        const service = this.get(gameType);
        return service.createContainer(opts);
    }
}

// Instancia singleton exportada
export const GameFactory = new GameFactoryRegistry();
