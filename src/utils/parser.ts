import { getDB } from '../config/db';
import { saveExpense } from '../services/excelService';

export const parseAndExecute = async (user_phone: string, aiResponse: string): Promise<string> => {
    const jsonRegex = /```json\n([\s\S]*?)\n```/;
    const match = aiResponse.match(jsonRegex);
    
    let textResponse = aiResponse;

    if (match && match[1]) {
        try {
            const parsedData = JSON.parse(match[1]);
            textResponse = aiResponse.replace(jsonRegex, '').trim();

            const db = getDB();
            
            // Permitir que el LLM mande un array de acciones o un solo objeto
            const actions = Array.isArray(parsedData) ? parsedData : [parsedData];

            for (const actionData of actions) {
                if (actionData.action === 'save_expense') {
                    saveExpense(user_phone, actionData.data);
                } else if (actionData.action === 'add_task') {
                    await db.run(
                        'INSERT INTO tasks (user_phone, title, due_date) VALUES (?, ?, ?)',
                        [user_phone, actionData.data.title, actionData.data.due_date || null]
                    );
                } else if (actionData.action === 'list_tasks') {
                    const tasks = await db.all('SELECT * FROM tasks WHERE status = "pending" AND user_phone = ?', [user_phone]);
                    const taskList = tasks.map((t: any) => `- ${t.title}`).join('\n');
                    textResponse += `\n\n📝 *Tareas pendientes:*\n${taskList || 'No hay tareas pendientes.'}`;
                }
            }

        } catch (error) {
            console.error('Error parsing or executing JSON action:', error);
        }
    }

    return textResponse; // El texto limpio para enviar por WhatsApp
};
