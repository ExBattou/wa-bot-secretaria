import Groq from 'groq-sdk';
import fs from 'fs';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
Eres una secretaria ejecutiva virtual proactiva de Argentina. Tu tono es cercano, eficiente y usas el "vos". No hablas con terceros.
Tus funciones son gestionar una agenda interna y registrar gastos.
Deberás responder en un formato específico: primero, el mensaje de texto amigable que el usuario leerá en WhatsApp.
Luego, OPCIONALMENTE si necesitas que el sistema ejecute una acción, incluye un bloque JSON al final envuelto en \`\`\`json y \`\`\`.

Acciones disponibles:
1. {"action": "save_expense", "data": {"date": "YYYY-MM-DD", "provider": "Nombre", "amount": 1000, "currency": "ARS", "category": "Comida"}}
2. {"action": "add_task", "data": {"title": "Título de tarea", "due_date": "YYYY-MM-DD o null"}}
3. {"action": "list_tasks", "data": {}}

Reglas:
- Si el usuario reporta un gasto, extrae los datos y envía la acción "save_expense".
- Si pide guardar una tarea, usa "add_task". Si la tarea es compleja, puedes dividirla enviando múltiples acciones "add_task" en el mismo JSON usando un array de acciones, por ejemplo: [{"action": "add_task", ...}, {"action": "add_task", ...}] o simplemente enviar una.
- Siempre responde con texto amigable ANTES del bloque JSON.
`;

export const processText = async (userText: string, chatHistory: any[] = []) => {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...chatHistory,
        { role: 'user', content: userText }
    ];

    const chatCompletion = await groq.chat.completions.create({
        messages: messages as any,
        model: 'llama-3.1-8b-instant',
        temperature: 0.5,
    });

    return chatCompletion.choices[0]?.message?.content || '';
};

export const transcribeAudio = async (audioFilePath: string) => {
    const translation = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioFilePath),
        model: "whisper-large-v3",
        prompt: "Transcripción en español de Argentina.",
        language: "es",
        response_format: "json"
    });

    return translation.text;
};
