import { Router } from 'express';
import { bot } from '../services/telegramService';

const router = Router();

// Si se despliega en producción con Webhook en vez de Polling:
router.post('/', bot.webhookCallback('/webhook'));
router.post('/telegram', bot.webhookCallback('/webhook/telegram'));

// Health check para el endpoint de webhook
router.get('/', (req, res) => {
    res.status(200).json({ status: 'active', service: 'karl-telegram-bot' });
});

export default router;
