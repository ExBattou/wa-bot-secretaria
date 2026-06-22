import { getDB } from '../config/db';
import { saveExpense } from '../services/excelService';

export const parseAndExecute = async (user_phone: string, aiResponse: string): Promise<string> => {
    // 1. Intentamos buscar un bloque de código markdown (con o sin la palabra json)
    const jsonRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    let match = aiResponse.match(jsonRegex);
    
    let jsonText = '';
    let textResponse = aiResponse;

    if (match && match[1]) {
        jsonText = match[1].trim();
        textResponse = aiResponse.replace(jsonRegex, '').trim();
    } else {
        // 2. Fallback: Si la IA no usó las comillas invertidas (```), buscamos si la respuesta termina con un Array [...] o Objeto {...}
        const fallbackRegex = /(\[[\s\S]*\]|\{[\s\S]*\})$/;
        const fallbackMatch = aiResponse.match(fallbackRegex);
        if (fallbackMatch && fallbackMatch[1]) {
            jsonText = fallbackMatch[1].trim();
            textResponse = aiResponse.replace(fallbackRegex, '').trim();
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
                } else if (actionData.action === 'add_reminder') {
                    console.log(`   👉 Programando recordatorio para: ${actionData.data.execute_at}`);
                    await db.run(
                        'INSERT INTO reminders (user_phone, message, execute_at) VALUES (?, ?, ?)',
                        [user_phone, actionData.data.message, actionData.data.execute_at]
                    );
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
