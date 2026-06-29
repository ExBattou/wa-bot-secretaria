import { Router } from 'express';
import { getDB } from '../config/db';
import crypto from 'crypto';

const router = Router();

// Memoria volátil para sesiones de administrador (se borran si el bot se reinicia)
const activeAdminTokens = new Set<string>();

const ADMIN_PASS = 'V4m0s3LT4l4dr0';

router.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) {
        const token = crypto.randomUUID();
        activeAdminTokens.add(token);
        return res.json({ success: true, token });
    }
    return res.status(401).json({ success: false, message: 'Clave incorrecta' });
});

// Middleware para proteger las rutas
const authMiddleware = (req: any, res: any, next: any) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !activeAdminTokens.has(token)) {
        return res.status(401).json({ success: false, message: 'No autorizado' });
    }
    next();
};

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
        const premiumUsers = await db.get('SELECT COUNT(*) as count FROM users WHERE is_premium_until > ?', [now.toISOString()]);

        // Mensajes (Hoy y Mes)
        const messagesData = await db.all(`
            SELECT 
                role,
                CASE 
                    WHEN timestamp >= ? THEN 'today'
                    WHEN timestamp >= ? THEN 'month'
                    ELSE 'older'
                END as timeframe,
                COUNT(*) as count
            FROM conversation_logs
            WHERE timestamp >= ?
            GROUP BY role, timeframe
        `, [startOfDay, startOfMonth, startOfMonth]);

        const stats = {
            users: {
                total: totalUsers.count,
                premium: premiumUsers.count
            },
            messages: {
                today: { sent_by_bot: 0, received_from_user: 0, total: 0 },
                month: { sent_by_bot: 0, received_from_user: 0, total: 0 }
            }
        };

        for (const row of messagesData) {
            const timeKey = row.timeframe; // 'today' or 'month'
            if (timeKey === 'older') continue;

            const count = row.count;
            if (row.role === 'assistant') {
                stats.messages[timeKey as 'today' | 'month'].sent_by_bot += count;
            } else if (row.role === 'user') {
                stats.messages[timeKey as 'today' | 'month'].received_from_user += count;
            }
            stats.messages[timeKey as 'today' | 'month'].total += count;
            
            // Si es 'today', también suma al total del mes (ya que SQLite GROUP BY acá separaría).
            if (timeKey === 'today') {
                if (row.role === 'assistant') stats.messages.month.sent_by_bot += count;
                if (row.role === 'user') stats.messages.month.received_from_user += count;
                stats.messages.month.total += count;
            }
        }

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});

router.get('/users', authMiddleware, async (req, res) => {
    try {
        const db = getDB();
        const users = await db.all('SELECT * FROM users ORDER BY messages_count DESC');
        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});

router.post('/set-premium', authMiddleware, async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Falta el teléfono' });

        const db = getDB();
        const user = await db.get('SELECT * FROM users WHERE phone = ?', [phone]);
        if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

        const premiumUntil = new Date();
        premiumUntil.setDate(premiumUntil.getDate() + 30);

        await db.run('UPDATE users SET is_premium_until = ? WHERE phone = ?', [premiumUntil.toISOString(), phone]);

        res.json({ success: true, message: 'Usuario convertido a Premium por 30 días.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error interno' });
    }
});

export default router;
