import { controlServer } from '../../services/serverControlService.js';
import { repairServer } from '../../services/serverRepairService.js';
import { getDiscordUserDiagnostics } from '../../services/discordDiagnosticsService.js';

/** Register Discord-bot operations that act on a user or managed server. */
export function registerServerOperationsRoutes(router, verifyApiKey) {
  router.get('/diagnostico/:discordId', verifyApiKey, async (req, res) => {
    const { discordId } = req.params;
    try {
      const diagnostics = await getDiscordUserDiagnostics(discordId);
      if (!diagnostics) {
        return res.status(404).json({ error: 'Usuario no encontrado o no vinculado.' });
      }
      res.json(diagnostics);
    } catch (error) {
      console.error(`❌ Error fatal consultando datos para Discord ID ${discordId}:`, error);
      res.status(500).json({ error: 'Error interno conectando a la base de datos.' });
    }
  });

  router.post('/control/:serverId/:action', verifyApiKey, async (req, res) => {
    const { serverId, action } = req.params;
    try {
      const result = await controlServer(serverId, 'DISCORD_BOT', action, true);
      res.json(result);
    } catch (error) {
      console.error(`❌ Error controlando server ${serverId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/repair/:serverId', verifyApiKey, async (req, res) => {
    const { serverId } = req.params;
    try {
      const result = await repairServer(serverId, 'DISCORD_BOT', true);
      res.json(result);
    } catch (error) {
      console.error(`❌ Error reparando server ${serverId}:`, error);
      res.status(500).json({ error: error.message });
    }
  });
}
