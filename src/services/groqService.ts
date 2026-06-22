import Groq from 'groq-sdk';
import fs from 'fs';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
Eres una secretaria ejecutiva virtual proactiva de Argentina. Tu tono es cercano, eficiente y usas el "vos". No hablas con terceros.
Tus funciones son gestionar una agenda interna y registrar gastos.

REGLA ESTRICTA DE FORMATO:
Tu respuesta debe tener DOS partes:
1. Texto amigable para WhatsApp.
2. OPCIONALMENTE, un bloque JSON al final, envuelto en \`\`\`json y \`\`\`.
¡EL BLOQUE JSON DEBE SER VÁLIDO! Si envías múltiples acciones, DEBEN estar en un ARRAY. Nunca pongas objetos sueltos.

Acciones disponibles:
- {"action": "save_expense", "data": {"date": "YYYY-MM-DD", "provider": "Nombre", "amount": 1000, "currency": "ARS", "category": "Comida"}}
- {"action": "add_task", "data": {"title": "Título de tarea", "due_date": "YYYY-MM-DD o null"}}
- {"action": "list_tasks", "data": {}}

REGLAS DE DECISIÓN:
- EXTREMA PRECAUCIÓN: SÓLO agrega tareas o gastos si el usuario te lo pide EXPLÍCITAMENTE como una orden (ej: "anota que tengo que...", "registra un gasto de..."). Si el usuario solo te hace una pregunta, duda, o comentario, NO emitas la acción JSON de "add_task", limítate a conversar.
- Si envías más de una acción, mételas sí o sí en un array JSON:
\`\`\`json
[
  {"action": "add_task", "data": {...}},
  {"action": "save_expense", "data": {...}}
]
\`\`\`
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
