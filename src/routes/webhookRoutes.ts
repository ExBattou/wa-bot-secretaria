import { Router } from 'express';
import { verifyWebhook, handleIncomingMessage } from '../controllers/webhookController';

const router = Router();

router.get('/', verifyWebhook);
router.post('/', handleIncomingMessage);

export default router;
