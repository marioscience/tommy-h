import { query } from '../../db.js';

/**
 * Registers the bot knowledge, ticket history, and aggregate-statistics API.
 *
 * These endpoints share one persistence domain and deliberately stay separate
 * from server control and infrastructure routes exposed to OxideProxy.
 */
export function registerKnowledgeRoutes(router, verifyApiKey) {
  router.post('/aprender', verifyApiKey, async (req, res) => {
    const { patron, respuesta, contexto, creado_por } = req.body;
    if (!patron || !respuesta) {
      return res.status(400).json({ error: 'Se requiere patron y respuesta.' });
    }
    try {
      const result = await query(
        `INSERT INTO bot_knowledge (patron, respuesta, contexto, creado_por, activo)
         VALUES ($1, $2, $3, $4, true) RETURNING id, patron, respuesta, contexto, creado_por, created_at`,
        [patron.toLowerCase().trim(), respuesta, contexto || 'general', creado_por || 'admin']
      );
      console.log(`🤖 Nuevo patrón aprendido por ${creado_por}: "${patron}"`);
      res.json({ ok: true, knowledge: result.rows[0] });
    } catch (error) {
      console.error('❌ Error guardando patrón de conocimiento:', error);
      res.status(500).json({ error: 'Error interno al guardar el patrón.' });
    }
  });

  router.get('/conocimiento', verifyApiKey, async (_req, res) => {
    try {
      const result = await query(
        `SELECT id, patron, respuesta, contexto, peso, veces_usado, creado_por, activo, created_at
         FROM bot_knowledge WHERE activo = true ORDER BY peso DESC, veces_usado DESC`
      );
      res.json({ ok: true, total: result.rowCount, knowledge: result.rows });
    } catch (error) {
      console.error('❌ Error listando conocimiento:', error);
      res.status(500).json({ error: 'Error interno al listar el conocimiento.' });
    }
  });

  router.delete('/conocimiento/:id', verifyApiKey, async (req, res) => {
    const { id } = req.params;
    try {
      const result = await query(
        'UPDATE bot_knowledge SET activo = false, updated_at = NOW() WHERE id = $1 RETURNING id, patron',
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Patrón no encontrado.' });
      }
      console.log(`🗑️ Patrón eliminado ID ${id}: "${result.rows[0].patron}"`);
      res.json({ ok: true, deleted: result.rows[0] });
    } catch (error) {
      console.error('❌ Error eliminando patrón:', error);
      res.status(500).json({ error: 'Error interno al eliminar el patrón.' });
    }
  });

  router.post('/conocimiento/:id/uso', verifyApiKey, async (req, res) => {
    const { id } = req.params;
    try {
      await query(
        `UPDATE bot_knowledge
         SET veces_usado = veces_usado + 1,
             peso = LEAST(peso + 0.05, 10.0),
             updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Error al registrar uso.' });
    }
  });

  router.post('/ticket-log', verifyApiKey, async (req, res) => {
    const {
      discord_user_id,
      discord_username,
      canal_id,
      mensajes,
      intenciones_detectadas,
      resuelto_por_ia,
      escalado_a_humano,
      patron_usado_id
    } = req.body;
    if (!discord_user_id || !canal_id) {
      return res.status(400).json({ error: 'Se requiere discord_user_id y canal_id.' });
    }
    try {
      const result = await query(
        `INSERT INTO bot_ticket_logs (discord_user_id, discord_username, canal_id, mensajes, intenciones_detectadas, resuelto_por_ia, escalado_a_humano, patron_usado_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          discord_user_id,
          discord_username || 'unknown',
          canal_id,
          JSON.stringify(mensajes || []),
          intenciones_detectadas || [],
          resuelto_por_ia || false,
          escalado_a_humano || false,
          patron_usado_id || null
        ]
      );
      res.json({ ok: true, log_id: result.rows[0].id });
    } catch (error) {
      console.error('❌ Error guardando log de ticket:', error);
      res.status(500).json({ error: 'Error interno al guardar el log.' });
    }
  });

  router.post('/estadistica', verifyApiKey, async (req, res) => {
    const { intencion, resuelto, escalado, patron_id } = req.body;
    try {
      await query(
        'INSERT INTO bot_stats (intencion, resuelto, escalado, patron_id) VALUES ($1, $2, $3, $4)',
        [intencion || 'desconocida', resuelto || false, escalado || false, patron_id || null]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Error al guardar estadística.' });
    }
  });

  router.get('/estadisticas', verifyApiKey, async (_req, res) => {
    try {
      const [resumen, topIntenciones, topPatrones] = await Promise.all([
        query(`
          SELECT
            COUNT(*) as total_interacciones,
            SUM(CASE WHEN resuelto THEN 1 ELSE 0 END) as resueltas_por_ia,
            SUM(CASE WHEN escalado THEN 1 ELSE 0 END) as escaladas_a_humano
          FROM bot_stats
        `),
        query(`
          SELECT intencion, COUNT(*) as veces
          FROM bot_stats GROUP BY intencion ORDER BY veces DESC LIMIT 10
        `),
        query(`
          SELECT id, patron, veces_usado, peso
          FROM bot_knowledge WHERE activo = true
          ORDER BY veces_usado DESC LIMIT 5
        `)
      ]);
      res.json({
        ok: true,
        resumen: resumen.rows[0],
        top_intenciones: topIntenciones.rows,
        top_patrones: topPatrones.rows
      });
    } catch (error) {
      console.error('❌ Error en estadísticas:', error);
      res.status(500).json({ error: 'Error interno al obtener estadísticas.' });
    }
  });
}
