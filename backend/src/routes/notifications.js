import express from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5');
  res.json({ items: result.rows });
});

export default router;
