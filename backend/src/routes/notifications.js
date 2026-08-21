import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  // Omitir anuncios de despliegue y pruebas de staging para clientes; solo visibles en el panel Admin
  const result = await query(`
    SELECT * FROM notifications 
    WHERE title NOT LIKE '%[Staging]%' 
      AND title NOT LIKE '%[ROLLBACK%' 
      AND title NOT LIKE '%Despliegue%' 
      AND title NOT LIKE '%[Deploy%'
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  res.json({ items: result.rows });
});

export default router;
