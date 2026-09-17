import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { registerAgreementRoutes } from './payments/agreementRoutes.js';
import { registerPaymentReadRoutes } from './payments/readRoutes.js';
import { registerProvisioningRoutes } from './payments/provisioningRoutes.js';
import { registerSubscriptionRoutes } from './payments/subscriptionRoutes.js';
import paymentsWebhookRouter from './paymentsWebhook.js';

const router = express.Router();
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de checkout. Inténtalo más tarde.' }
});

registerPaymentReadRoutes(router, requireAuth);
registerAgreementRoutes(router, checkoutLimiter);
registerProvisioningRoutes(router, checkoutLimiter);
registerSubscriptionRoutes(router, requireAuth);
router.use(paymentsWebhookRouter);

export default router;
