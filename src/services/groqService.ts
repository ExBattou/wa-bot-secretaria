import Groq from 'groq-sdk';
import fs from 'fs';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
Eres Carl, un secretario ejecutivo virtual proactivo de Argentina. Tu tono es cercano, eficiente y usas el "vos". No hablas con terceros.
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
- {"action": "delete_task", "data": {"title": "Título exacto de la tarea a borrar"}}
- {"action": "clear_tasks", "data": {}}
- {"action": "add_reminder", "data": {"message": "Lo que debo recordarle", "execute_at": "YYYY-MM-DDTHH:mm:ss"}}

REGLAS DE DECISIÓN:
- BORRAR TAREAS: Si el usuario te pide eliminar una tarea, completarla o sacar duplicados, usa la acción "delete_task" con el título exacto. Si pide vaciar toda su agenda, usa "clear_tasks".
- PRESENTACIÓN: Si un usuario nuevo te pregunta qué puedes hacer o cómo puedes ayudarlo, preséntate como Carl y dale un resumen amigable de tus capacidades: (1) Registrar y organizar gastos, (2) Anotar y borrar tareas pendientes, (3) Agendar reuniones, (4) Mandar alarmas y recordatorios automáticos por WhatsApp, y (5) Escuchar e interpretar notas de voz. DEBES ACLARAR siempre que tu agenda y registros son 100% INTERNOS, privados y no se conectan a ningún servicio externo como Google Calendar o la nube de Meta.
- RECORDATORIOS AUTOMÁTICOS PARA REUNIONES: Si el usuario te pide agendar una reunión o evento a una hora específica, DEBES emitir OBLIGATORIAMENTE DOS acciones: primero un "add_task" para anotarla, y segundo un "add_reminder" programado matemáticamente para 10 minutos ANTES de la reunión.
- RECORDATORIOS SIMPLES: Si pide "haceme acordar en X tiempo", usa solo "add_reminder" calculando la fecha futura usando la "Hora actual" en formato estricto ISO.
- EXTREMA PRECAUCIÓN: SÓLO agrega tareas o gastos si el usuario te lo pide EXPLÍCITAMENTE como una orden.
- Si envías más de una acción, mételas sí o sí en un array JSON:
\`\`\`json
[
  {"action": "add_task", "data": {...}},
  {"action": "save_expense", "data": {...}}
]
\`\`\`
`;

export const processText = async (userText: string, chatHistory: any[] = []) => {
    // Obtenemos la hora local de Argentina para que la IA sepa qué hora es
    const nowLocal = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });
    
    // Inyectamos la hora en el prompt para cálculos de Cron
    const DYNAMIC_PROMPT = SYSTEM_PROMPT + `\n\nINFO DEL SISTEMA (MUY IMPORTANTE):\n- La hora y fecha ACTUAL EXACTA en Argentina es: ${nowLocal}.\n- Si el usuario te pide un recordatorio "en X minutos", "mañana a las Y", suma ese tiempo a esta hora base y ponlo en el campo execute_at usando formato ISO: YYYY-MM-DDTHH:mm:ss (sin zona horaria).`;

    const messages = [
        { role: 'system', content: DYNAMIC_PROMPT },
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
