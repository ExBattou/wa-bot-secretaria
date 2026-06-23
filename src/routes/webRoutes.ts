import { Router } from 'express';
import { getDB } from '../config/db';

const router = Router();

router.post('/auth', async (req, res) => {
    try {
        const { token, pin } = req.body;
        
        if (!token || !pin) {
            return res.status(400).json({ success: false, message: 'Faltan credenciales' });
        }

        const db = getDB();
        
        // Buscar la sesión en SQLite
        const session = await db.get('SELECT * FROM web_sessions WHERE token = ? AND pin = ?', [token, pin]);
        
        if (!session) {
            return res.status(401).json({ success: false, message: 'PIN o enlace incorrecto' });
        }

        // Verificar expiración
        const now = new Date().toISOString();
        if (now > session.expires_at) {
            // Opcional: borrar sesión expirada para limpiar DB
            await db.run('DELETE FROM web_sessions WHERE token = ?', [token]);
            return res.status(401).json({ success: false, message: 'La sesión expiró (pasaron los 10 minutos). Pídele a Karl un link nuevo.' });
        }

        const user_phone = session.user_phone;

        // Si pasó la seguridad, buscamos los datos reales del usuario
        const tasks = await db.all('SELECT * FROM tasks WHERE user_phone = ? AND status = "pending" ORDER BY id DESC', [user_phone]);
        const reminders = await db.all('SELECT * FROM reminders WHERE user_phone = ? AND status = "pending" ORDER BY execute_at ASC', [user_phone]);

        return res.json({
            success: true,
            data: {
                tasks,
                reminders
            }
        });

    } catch (error) {
        console.error('Error en Web Auth:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

router.delete('/item', async (req, res) => {
    try {
        const { token, pin, type, id } = req.body;
        
        if (!token || !pin || !type || !id) {
            return res.status(400).json({ success: false, message: 'Datos incompletos' });
        }

        const db = getDB();
        const session = await db.get('SELECT * FROM web_sessions WHERE token = ? AND pin = ?', [token, pin]);
        
        if (!session) {
            return res.status(401).json({ success: false, message: 'PIN incorrecto o sesión inválida' });
        }

        const now = new Date().toISOString();
        if (now > session.expires_at) {
            return res.status(401).json({ success: false, message: 'La sesión expiró. Pide un link nuevo.' });
        }

        const user_phone = session.user_phone;

        if (type === 'task') {
            await db.run('DELETE FROM tasks WHERE id = ? AND user_phone = ?', [id, user_phone]);
        } else if (type === 'reminder') {
            await db.run('DELETE FROM reminders WHERE id = ? AND user_phone = ?', [id, user_phone]);
        } else {
            return res.status(400).json({ success: false, message: 'Tipo de ítem inválido' });
        }

        return res.json({ success: true, message: 'Ítem eliminado correctamente' });

    } catch (error) {
        console.error('Error borrando ítem desde la web:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

export default router;
