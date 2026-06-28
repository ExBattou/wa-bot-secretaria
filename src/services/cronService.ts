import cron from 'node-cron';
import { getDB } from '../config/db';
import { sendWhatsAppMessage } from '../controllers/webhookController';
import { generateProactiveGreeting } from './groqService';

export const startCronJobs = () => {
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
                'SELECT * FROM reminders WHERE status = "pending" AND execute_at <= ?',
                [isoString]
            );

            for (const reminder of pendingReminders) {
                console.log(`⏰ [Cron] Ejecutando recordatorio para ${reminder.user_phone}: "${reminder.message}"`);
                
                const textToSend = `⏰ *Recordatorio programado:*\n${reminder.message}`;
                await sendWhatsAppMessage(reminder.user_phone, textToSend);

                // Lo borramos de la base de datos (como pidió el usuario)
                await db.run('DELETE FROM reminders WHERE id = ?', [reminder.id]);
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
                const users = await db.all('SELECT DISTINCT user_phone FROM tasks WHERE status = "pending"');
                
                for (const user of users) {
                    const pendingTasks = await db.all('SELECT * FROM tasks WHERE user_phone = ? AND status = "pending"', [user.user_phone]);
                    
                    if (pendingTasks.length > 0) {
                        // Verificamos si el usuario tiene encendido este recordatorio
                        const prefs = await db.get('SELECT * FROM user_preferences WHERE user_phone = ?', [user.user_phone]);
                        
                        let shouldSend = true;
                        if (prefs) {
                            if (timeOfDay === '09:00' && !prefs.daily_09) shouldSend = false;
                            if (timeOfDay === '12:00' && !prefs.daily_12) shouldSend = false;
                            if (timeOfDay === '17:00' && !prefs.daily_17) shouldSend = false;
                        }

                        if (shouldSend) {
                            const greetingText = await generateProactiveGreeting(pendingTasks, timeOfDay);
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
