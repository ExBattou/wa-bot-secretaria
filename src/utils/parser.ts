import { getDB } from '../config/db';
import { saveExpense } from '../services/excelService';
import crypto from 'crypto';

export const parseAndExecute = async (user_phone: string, aiResponse: string, baseUrl: string = ''): Promise<string> => {
    // 1. Intentamos buscar un bloque de código markdown (con o sin la palabra json)
    const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    let match = aiResponse.match(jsonRegex);
    
    let jsonText = '';
    let textResponse = aiResponse;

    if (match && match[1]) {
        jsonText = match[1].trim();
        textResponse = aiResponse.replace(jsonRegex, '').trim();
    } else {
        // 2. Fallback blindado: Buscamos si la respuesta incluye un Array [...] o Objeto {...} en el texto
        const fallbackRegex = /(\[[\s\S]*\]|\{[\s\S]*\})/;
        const fallbackMatch = aiResponse.match(fallbackRegex);
        if (fallbackMatch && fallbackMatch[1]) {
            jsonText = fallbackMatch[1].trim();
            // Borramos el JSON extraído del texto original
            textResponse = aiResponse.replace(fallbackMatch[0], '').trim();
            
            // Limpieza de emergencia por si quedaron etiquetas markdown rotas (ej: ```json)
            textResponse = textResponse.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
        }
    }

    if (jsonText) {
        try {
            console.log(`📦 [Parser] Bloque JSON detectado en la respuesta.`);
            
            // Fix para cuando la IA manda objetos sueltos separados por saltos de línea en lugar de un array
            if (jsonText.startsWith('{') && jsonText.endsWith('}') && /}\s*\{/.test(jsonText)) {
                console.log(`⚠️ [Parser] JSON malformado detectado (objetos sueltos). Auto-corrigiendo a un Array...`);
                jsonText = '[' + jsonText.replace(/}\s*\{/g, '},{') + ']';
            }

            const parsedData = JSON.parse(jsonText);
            textResponse = aiResponse.replace(jsonRegex, '').trim();

            const db = getDB();
            
            // Permitir que el LLM mande un array de acciones o un solo objeto
            const actions = Array.isArray(parsedData) ? parsedData : [parsedData];

            for (const actionData of actions) {
                console.log(`🚀 [Parser] Ejecutando acción: ${actionData.action}`);
                if (actionData.action === 'save_expense') {
                    console.log(`   👉 Guardando gasto: ${JSON.stringify(actionData.data)}`);
                    saveExpense(user_phone, actionData.data);
                } else if (actionData.action === 'add_task') {
                    console.log(`   👉 Guardando tarea en SQLite: "${actionData.data.title}"`);
                    await db.run(
                        'INSERT INTO tasks (user_phone, title, due_date) VALUES (?, ?, ?)',
                        [user_phone, actionData.data.title, actionData.data.due_date || null]
                    );
                } else if (actionData.action === 'list_tasks') {
                    console.log(`   👉 Buscando tareas pendientes...`);
                    const tasks = await db.all('SELECT * FROM tasks WHERE status = "pending" AND user_phone = ?', [user_phone]);
                    const taskList = tasks.map((t: any) => `- ${t.title}`).join('\n');
                    textResponse += `\n\n📝 *Tareas pendientes:*\n${taskList || 'No hay tareas pendientes.'}`;
                } else if (actionData.action === 'delete_task') {
                    console.log(`   👉 Eliminando tarea: "${actionData.data.title}"`);
                    await db.run('DELETE FROM tasks WHERE user_phone = ? AND title = ?', [user_phone, actionData.data.title]);
                    textResponse += `\n\n✅ Tarea eliminada: ${actionData.data.title}`;
                } else if (actionData.action === 'clear_tasks') {
                    console.log(`   👉 Eliminando TODAS las tareas pendientes`);
                    await db.run('DELETE FROM tasks WHERE user_phone = ?', [user_phone]);
                    textResponse += `\n\n🗑️ Todas las tareas han sido borradas.`;
                } else if (actionData.action === 'add_reminder') {
                    console.log(`   👉 Programando recordatorio para: ${actionData.data.execute_at}`);
                    await db.run(
                        'INSERT INTO reminders (user_phone, message, execute_at) VALUES (?, ?, ?)',
                        [user_phone, actionData.data.message, actionData.data.execute_at]
                    );
                } else if (actionData.action === 'generate_dashboard_link') {
                    console.log(`   👉 Generando link seguro para Dashboard Web`);
                    const token = crypto.randomUUID();
                    const pin = Math.floor(100000 + Math.random() * 900000).toString(); // Pin de 6 dígitos
                    
                    // Expira en 10 minutos exactos
                    const expiresAt = new Date();
                    expiresAt.setMinutes(expiresAt.getMinutes() + 10);
                    
                    await db.run(
                        'INSERT INTO web_sessions (token, user_phone, pin, expires_at) VALUES (?, ?, ?, ?)',
                        [token, user_phone, pin, expiresAt.toISOString()]
                    );

                    const dashboardUrl = `${baseUrl}/status.html?token=${token}`;
                    textResponse += `\n\n🔐 Acá tenés el link a tu tablero web privado:\n${dashboardUrl}\n\n🔑 Tu clave de acceso es: *${pin}*\n_(Ojo: Este link y la clave se autodestruirán en 10 minutos)_`;
                }
            }

        } catch (error) {
            console.error('❌ [Parser] Error parseando o ejecutando la acción JSON:', error);
        }
    } else {
        console.log(`📝 [Parser] No se detectaron acciones JSON. Solo texto.`);
    }

    return textResponse; // El texto limpio para enviar por WhatsApp
};
