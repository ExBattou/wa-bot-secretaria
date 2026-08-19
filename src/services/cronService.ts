import cron from 'node-cron';
import { getDB } from '../config/db';
import { sendWhatsAppMessage } from '../controllers/webhookController';
import { generateProactiveGreeting, getValidGroqModel } from './groqService';
import crypto from 'crypto';

export const startCronJobs = () => {
    // Inicialización del modelo de Groq al arrancar los cron jobs
    getValidGroqModel(true).catch(err => console.error('Error al inicializar modelo de Groq:', err));

    // Cron mensual de actualización de modelos de Groq (1º de cada mes a las 00:00 hs)
    cron.schedule('0 0 1 * *', async () => {
        console.log('⏰ [Cron Mensual] Actualizando lista de modelos de Groq...');
        try {
            const updatedModel = await getValidGroqModel(true);
            console.log(`✅ [Cron Mensual] Modelo de Groq actualizado con éxito: ${updatedModel}`);
        } catch (error) {
            console.error('❌ [Cron Mensual] Error al actualizar modelo de Groq:', error);
        }
    }, {
        timezone: 'America/Argentina/Buenos_Aires'
    });

    // Se ejecuta cada minuto (* * * * *)
    cron.schedule('* * * * *', async () => {

        try {
            const db = getDB();
            
            // Obtenemos la hora actual en ISO para comparar fácilmente en SQLite
            // (Aseguramos estar comparando correctamente la hora en UTC o local dependiendo de cómo la guardó la IA,
            // pero le dijimos a la IA que use ISO que por defecto podemos comparar lexicográficamente).
            const now = new Date();
            // Ajustamos la fecha local de Argentina para que la comparación sea directa
            now.setHours(now.getHours() - 3); // Restamos 3 hs por GMT-3
            const isoString = now.toISOString().replace('Z', ''); 

            // Buscamos recordatorios pendientes que ya deban ejecutarse
            // Usamos un simple comparador de strings ya que el formato es YYYY-MM-DDTHH:mm:ss
            const pendingReminders = await db.all(
                `SELECT * FROM reminders WHERE status = 'pending' AND execute_at <= $1`,
                [isoString]
            );

            for (const reminder of pendingReminders) {
                console.log(`⏰ [Cron] Ejecutando recordatorio para ${reminder.user_phone}: "${reminder.message}"`);
                
                const token = crypto.randomUUID();
                const pin = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = new Date();
                expiresAt.setMinutes(expiresAt.getMinutes() + 10);
                await db.run('INSERT INTO web_sessions (token, user_phone, pin, expires_at) VALUES ($1, $2, $3, $4)', [token, reminder.user_phone, pin, expiresAt.toISOString()]);
                const baseUrl = process.env.BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
                const dashboardUrl = `${baseUrl}/status.html?token=${token}`;

                const textToSend = `⏰ *Recordatorio programado:*\n${reminder.message}\n\n🔐 Acá tenés el link a tu tablero web privado:\n${dashboardUrl}\n\n🔑 Tu clave de acceso es: *${pin}*\n_(Ojo: Este link y la clave se autodestruirán en 10 minutos)_`;
                await sendWhatsAppMessage(reminder.user_phone, textToSend);

                // Lo borramos de la base de datos (como pidió el usuario)
                await db.run('DELETE FROM reminders WHERE id = $1', [reminder.id]);
            }
        } catch (error) {
            console.error('❌ [Cron] Error ejecutando tareas en segundo plano:', error);
        }
    });

    // 2. Cron de seguimientos diarios (09:00, 12:00, 17:00 AR time)
    const scheduleDailyGreeting = (hour: string, timeOfDay: '09:00' | '12:00' | '17:00') => {
        cron.schedule(`0 ${hour} * * *`, async () => {
            console.log(`⏰ [Cron] Ejecutando seguimiento diario de las ${timeOfDay}`);
            try {
                const db = getDB();
                // Find all distinct users with pending tasks
                const users = await db.all(`SELECT DISTINCT user_phone FROM tasks WHERE status = 'pending'`);
                
                for (const user of users) {
                    const pendingTasks = await db.all(`SELECT * FROM tasks WHERE user_phone = $1 AND status = 'pending'`, [user.user_phone]);
                    
                    if (pendingTasks.length > 0) {
                        // Verificamos si el usuario tiene encendido este recordatorio
                        const prefs = await db.get('SELECT * FROM user_preferences WHERE user_phone = $1', [user.user_phone]);
                        
                        let shouldSend = true;
                        if (prefs) {
                            if (timeOfDay === '09:00' && !prefs.daily_09) shouldSend = false;
                            if (timeOfDay === '12:00' && !prefs.daily_12) shouldSend = false;
                            if (timeOfDay === '17:00' && !prefs.daily_17) shouldSend = false;
                        }

                        if (shouldSend) {
                            let greetingText = await generateProactiveGreeting(pendingTasks, timeOfDay);
                            
                            const token = crypto.randomUUID();
                            const pin = Math.floor(100000 + Math.random() * 900000).toString();
                            const expiresAt = new Date();
                            expiresAt.setMinutes(expiresAt.getMinutes() + 10);
                            await db.run('INSERT INTO web_sessions (token, user_phone, pin, expires_at) VALUES ($1, $2, $3, $4)', [token, user.user_phone, pin, expiresAt.toISOString()]);
                            const baseUrl = process.env.BASE_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
                            const dashboardUrl = `${baseUrl}/status.html?token=${token}`;

                            greetingText += `\n\n🔐 Acá tenés el link a tu tablero web privado:\n${dashboardUrl}\n\n🔑 Tu clave de acceso es: *${pin}*\n_(Ojo: Este link y la clave se autodestruirán en 10 minutos)_`;
                            
                            await sendWhatsAppMessage(user.user_phone, greetingText);
                        } else {
                            console.log(`⏰ [Cron] Recordatorio de ${timeOfDay} salteado para ${user.user_phone} por configuración del usuario.`);
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ [Cron] Error en seguimiento diario de las ${timeOfDay}:`, error);
            }
        }, {
            timezone: 'America/Argentina/Buenos_Aires'
        });
    };

    scheduleDailyGreeting('9', '09:00');
    scheduleDailyGreeting('12', '12:00');
    scheduleDailyGreeting('17', '17:00');

    console.log('⏳ Servicio de Cron (recordatorios y seguimientos diarios) iniciado.');
};
