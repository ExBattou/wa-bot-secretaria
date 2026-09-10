import Groq from 'groq-sdk';
import fs from 'fs';

export interface ActiveModelInfo {
    id: string;
    owned_by: string;
    active: boolean;
    context_window?: number;
}

const SYSTEM_PROMPT = `
Eres Karl, un secretario ejecutivo virtual proactivo de Argentina. Tu tono es cercano, eficiente y usas el "vos". No hablas con terceros.
Tus funciones son gestionar una agenda interna y registrar gastos.

REGLA ESTRICTA DE FORMATO:
Tu respuesta debe tener DOS partes:
1. Texto amigable para Telegram (puedes usar emojis y negritas estándar con *texto*).
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

export class GroqService {
    private client: Groq | null = null;
    private cachedModels: ActiveModelInfo[] = [];
    private lastCacheTime = 0;
    private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos de caché

    // Patrones que no corresponden a modelos conversacionales
    private readonly NON_CHAT_PATTERNS = [
        'guard',
        'safeguard',
        'whisper',
        'orpheus',
        'moderation',
        'tts',
        'stt',
        'embed',
        'safetensors'
    ];

    // Jerarquía de prioridad de modelos conversacionales de Groq
    private readonly CONVERSATIONAL_PRIORITY = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama-3.1-70b-versatile',
        'llama3-70b-8192',
        'llama3-8b-8192',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
        'qwen/qwen3.8-27b',
        'qwen/qwen3.6-27b'
    ];

    private getClient(): Groq {
        if (!this.client) {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) {
                throw new Error('GROQ_API_KEY no está configurada en las variables de entorno.');
            }
            this.client = new Groq({ apiKey });
        }
        return this.client;
    }

    public isChatModel(modelId: string): boolean {
        const lower = modelId.toLowerCase();
        for (const pattern of this.NON_CHAT_PATTERNS) {
            if (lower.includes(pattern)) {
                return false;
            }
        }
        return true;
    }

    public async getActiveModels(forceRefresh = false): Promise<ActiveModelInfo[]> {
        const now = Date.now();
        if (!forceRefresh && this.cachedModels.length > 0 && now - this.lastCacheTime < this.CACHE_TTL_MS) {
            return this.cachedModels;
        }

        try {
            console.log('🔍 [Groq] Consultando endpoint de modelos activos...');
            const client = this.getClient();
            const response = await client.models.list();
            const rawData = response.data || [];

            const activeList: ActiveModelInfo[] = rawData
                .filter((m: any) => m.active !== false && this.isChatModel(m.id))
                .map((m: any) => ({
                    id: m.id,
                    owned_by: m.owned_by,
                    active: m.active ?? true,
                    context_window: m.context_window
                }));

            this.cachedModels = activeList;
            this.lastCacheTime = now;
            console.log(`📋 [Groq] ${activeList.length} modelos de chat activos encontrados.`);
            return this.cachedModels;
        } catch (error: any) {
            console.error('[Groq] Error consultando modelos activos:', error?.message || error);
            if (this.cachedModels.length > 0) {
                return this.cachedModels;
            }
            return [];
        }
    }

    public async getCandidateModels(): Promise<string[]> {
        if (process.env.GROQ_MODEL && process.env.GROQ_MODEL.trim() !== '') {
            return [process.env.GROQ_MODEL.trim()];
        }

        try {
            const activeModels = await this.getActiveModels();
            const activeIds = new Set(activeModels.map(m => m.id));
            const candidates: string[] = [];

            for (const model of this.CONVERSATIONAL_PRIORITY) {
                if (activeIds.has(model)) {
                    candidates.push(model);
                }
            }

            for (const m of activeModels) {
                if (!candidates.includes(m.id)) {
                    candidates.push(m.id);
                }
            }

            if (candidates.length === 0) {
                candidates.push('llama-3.3-70b-versatile', 'llama-3.1-8b-instant');
            }

            return candidates;
        } catch {
            return ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
        }
    }

    public async chatCompletion(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        temperature = 0.5
    ): Promise<string> {
        const client = this.getClient();
        const candidateModels = await this.getCandidateModels();
        let lastError: any = null;

        for (const modelToTry of candidateModels) {
            try {
                const startTime = Date.now();
                const completion = await client.chat.completions.create({
                    messages: messages as any,
                    model: modelToTry,
                    temperature,
                    max_tokens: 800
                });

                const durationMs = Date.now() - startTime;
                const content = completion.choices[0]?.message?.content || '';
                console.log(`✅ [Groq] Respuesta generada con éxito usando "${modelToTry}" (${durationMs}ms)`);
                return content;
            } catch (err: any) {
                lastError = err;
                console.warn(`⚠️ [Groq] Modelo "${modelToTry}" falló (${err?.message || err}). Reintentando con siguiente candidato...`);
            }
        }

        console.error('❌ [Groq] Todos los modelos candidatos fallaron:', lastError);
        return 'Perdón, hubo un inconveniente al procesar tu solicitud. Por favor intenta de nuevo en unos segundos.';
    }

    public async transcribeAudio(audioFilePath: string): Promise<string> {
        const client = this.getClient();
        const translation = await client.audio.transcriptions.create({
            file: fs.createReadStream(audioFilePath),
            model: 'whisper-large-v3',
            prompt: 'Transcripción en español de Argentina.',
            language: 'es',
            response_format: 'json'
        });

        return translation.text;
    }
}

export const groqService = new GroqService();

export const processText = async (userText: string, chatHistory: any[] = []): Promise<string> => {
    const nowLocal = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false });
    const DYNAMIC_PROMPT = SYSTEM_PROMPT + `\n\nINFO DEL SISTEMA (MUY IMPORTANTE):\n- La hora y fecha ACTUAL EXACTA en Argentina es: ${nowLocal}.\n- Si el usuario te pide un recordatorio "en X minutos", "mañana a las Y", suma ese tiempo a esta hora base y ponlo en el campo execute_at usando formato ISO: YYYY-MM-DDTHH:mm:ss (sin zona horaria).`;

    const messages = [
        { role: 'system' as const, content: DYNAMIC_PROMPT },
        ...chatHistory,
        { role: 'user' as const, content: userText }
    ];

    return await groqService.chatCompletion(messages, 0.5);
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

Tu objetivo: Escribe un mensaje amigable y conversacional (usando "vos" y tono argentino) contándole cuáles son sus tareas pendientes. Motívalo a completarlas o pregúntale si ya hizo alguna para que la puedas tachar de la lista.
IMPORTANTE: RESPONDE ÚNICAMENTE CON EL TEXTO QUE SE LE ENVIARÁ AL USUARIO POR TELEGRAM. NO agregues bloques JSON ni explicaciones extra. NO actúes como si el usuario te hubiera hablado, toma la iniciativa.
`;

    const messages = [{ role: 'system' as const, content: prompt }];
    return await groqService.chatCompletion(messages, 0.7);
};

export const transcribeAudio = async (audioFilePath: string): Promise<string> => {
    return await groqService.transcribeAudio(audioFilePath);
};
