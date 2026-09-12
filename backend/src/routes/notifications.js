import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listClientNotifications } from '../repositories/notificationRepository.js';

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  // Omitir anuncios de despliegue y pruebas de staging para clientes; solo visibles en el panel Admin
  res.json({ items: await listClientNotifications() });
});

export default router;
