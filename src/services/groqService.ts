import Groq from 'groq-sdk';
import fs from 'fs';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `
Eres Karl, un secretario ejecutivo virtual proactivo de Argentina. Tu tono es cercano, eficiente y usas el "vos". No hablas con terceros.
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
- {"action": "list_reminders", "data": {}}
- {"action": "delete_task", "data": {"title": "Título exacto de la tarea a borrar"}}
- {"action": "clear_tasks", "data": {}}
- {"action": "add_reminder", "data": {"message": "Lo que debo recordarle", "execute_at": "YYYY-MM-DDTHH:mm:ss"}}
- {"action": "generate_dashboard_link", "data": {}}

REGLAS DE DECISIÓN Y PROHIBICIONES ESTRICTAS:
1. PROHIBIDO USAR PLACEHOLDERS: NUNCA inventes URLs (como example.com), NUNCA inventes contraseñas/PINs, y NUNCA inventes listas de tareas. NO TIENES ACCESO DE LECTURA A LA BASE DE DATOS. Tu única forma de interactuar es emitiendo bloques JSON. Si no emites el bloque JSON exacto, el sistema fallará.
2. DASHBOARD WEB / ENLACE: Si el usuario te pide "pasar la web", "ver el dashboard", o "panel de control", DEBES RESPONDER con un mensaje breve (ej: "Generando tu enlace seguro...") y OBLIGATORIAMENTE emitir el bloque JSON con la acción "generate_dashboard_link". EL SISTEMA (no tú) se encargará de adjuntar la URL real y el PIN correcto.
3. CONSULTAR AGENDA / RECORDATORIOS: Si te preguntan "qué tareas tengo", "qué alarmas hay", o "qué reuniones tengo", DEBES RESPONDER con un mensaje breve (ej: "Buscando en tu agenda...") y OBLIGATORIAMENTE emitir el bloque JSON con "list_tasks" y/o "list_reminders". EL SISTEMA pegará la lista real debajo de tu mensaje. NUNCA trates de enumerar las tareas en tu texto.
4. TAREA Y RECORDATORIO: Cuando te pidan guardar una tarea/reunión, SIEMPRE debes emitir la acción "add_task". LUEGO, en tu respuesta de texto, pregúntale a qué hora quiere que le recuerdes esa tarea. Si el usuario ya te dijo una hora en su mensaje, emite TAMBIÉN "add_reminder" junto con "add_task". ¡ATENCIÓN! Si el usuario te dice explícitamente "No quiero recordatorio", "Sin alarma", o rechaza la pregunta, NO EMITAS LA ACCIÓN "add_reminder". NUNCA inventes una hora aleatoria.
5. BORRAR TAREAS: Usa la acción "delete_task" con el título exacto SÓLO si el usuario te pide borrar una tarea específica. Usa "clear_tasks" SÓLO si el usuario te ordena explícitamente "borra TODAS mis tareas" o "vacía mi agenda". ¡PELIGRO!: Si el usuario dice "no, gracias", "no quiero nada más", "ya terminé" o "eso es todo", NO ESTÁ PIDIENDO BORRAR NADA, solo está terminando la conversación. NUNCA uses "clear_tasks" como una forma de despedida.
6. PRESENTACIÓN: Si un usuario te pregunta qué puedes hacer, preséntate como Karl. Aclara que tu agenda y registros son 100% INTERNOS, privados y no se conectan a ningún servicio externo como Google Calendar.
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

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: messages as any,
            model: 'llama-3.1-8b-instant',
            temperature: 0.5,
        });

        return chatCompletion.choices[0]?.message?.content || '';
    } catch (error) {
        console.error('Error con Groq API:', error);
        return 'Perdón, hubo un error procesando tu mensaje. Intenta de nuevo.';
    }
};

export const generateProactiveGreeting = async (tasks: any[], timeOfDay: '09:00' | '12:00' | '17:00'): Promise<string> => {
    let context = '';
    if (timeOfDay === '09:00') context = 'Son las 9 de la mañana. Dale los buenos días al usuario con energía y buena onda.';
    else if (timeOfDay === '12:00') context = 'Es el mediodía. Saluda al usuario y pregúntale cómo va su mañana.';
    else if (timeOfDay === '17:00') context = 'Son las 5 de la tarde. Saluda al usuario y pregúntale si pudo avanzar con algo de su lista hoy.';

    const taskListText = tasks.map(t => `- ${t.title}`).join('\n');
    
    const prompt = `
Eres Karl, el secretario ejecutivo virtual.
El sistema te está invocando automáticamente porque llegó el horario de seguimiento.
${context}
El usuario tiene estas tareas pendientes en su agenda interna:
${taskListText || '(No hay tareas pendientes)'}

Tu objetivo: Escribe un mensaje de texto amigable y conversacional (usando "vos" y tono argentino) contándole cuáles son sus tareas pendientes. Motívalo a completarlas o pregúntale si ya hizo alguna para que la puedas tachar de la lista.
IMPORTANTE: RESPONDE ÚNICAMENTE CON EL TEXTO QUE SE LE ENVIARÁ AL USUARIO POR WHATSAPP. NO agregues bloques JSON ni explicaciones extra. NO actúes como si el usuario te hubiera hablado, toma la iniciativa.
`;
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: prompt }],
            model: 'llama-3.1-8b-instant',
            temperature: 0.7,
        });
        return chatCompletion.choices[0]?.message?.content || '¡Hola! Quería recordarte que tienes tareas pendientes. Avisame si querés que tachemos alguna.';
    } catch (error) {
        console.error('Error generando saludo proactivo:', error);
        return '¡Hola! Este es un mensaje automático para recordarte tus tareas pendientes.';
    }
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
