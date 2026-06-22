import cron from 'node-cron';
import { getDB } from '../config/db';
import { sendWhatsAppMessage } from '../controllers/webhookController';

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

                // Lo marcamos como enviado
                await db.run('UPDATE reminders SET status = "sent" WHERE id = ?', [reminder.id]);
            }
        } catch (error) {
            console.error('❌ [Cron] Error ejecutando tareas en segundo plano:', error);
        }
    });

    console.log('⏳ Servicio de Cron (recordatorios en 2do plano) iniciado.');
};
