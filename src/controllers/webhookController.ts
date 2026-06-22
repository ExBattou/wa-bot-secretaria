import { Request, Response } from 'express';
import { processText, transcribeAudio } from '../services/groqService';
import { parseAndExecute } from '../utils/parser';
import { getDB } from '../config/db';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const sendWhatsAppMessage = async (to: string, text: string) => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    
    if (!token || !phoneId) {
        console.warn('⚠️ Faltan credenciales WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_ID. Simulando envío a', to, ':', text);
        return;
    }

    // Fix para números de Argentina (WhatsApp suele enviar el 549 pero para responder necesita el 54)
    let parsedTo = to;
    if (parsedTo.startsWith('549') && parsedTo.length === 13) {
        parsedTo = '54' + parsedTo.substring(3);
    }

    try {
        await axios.post(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
            messaging_product: 'whatsapp',
            to: parsedTo,
            text: { body: text }
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
    } catch (error: any) {
        console.error('❌ Error enviando mensaje de WhatsApp:', error.response?.data || error.message);
    }
};

export const verifyWebhook = (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

export const handleIncomingMessage = async (req: Request, res: Response) => {
    try {
        const body = req.body;

        if (body.object) {
            if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
                const message = body.entry[0].changes[0].value.messages[0];
                const from = message.from; 
                const type = message.type;
                
                let userText = '';

                const db = getDB();

                if (type === 'text') {
                    userText = message.text.body;
                } else if (type === 'audio') {
                    console.log(`🎙️ Audio recibido con ID: ${message.audio.id}. Simulando transcripción por ahora...`);
                    // TO-DO real: 
                    // 1. Obtener URL del media llamando a la API de WhatsApp con el media.id
                    // 2. Descargar el archivo .ogg
                    // 3. userText = await transcribeAudio('/path/to/downloaded/audio.ogg');
                    
                    userText = "Por favor agenda una reunión mañana con Carlos y registra un gasto de 5000 en comida."; 
                }

                if (userText) {
                    console.log(`\n=========================================`);
                    console.log(`📨 MENSAJE ENTRANTE [${from}]: "${userText}"`);

                    await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES (?, ?, ?)', [from, 'user', userText]);
                    
                    console.log(`🔍 Buscando historial para ${from}...`);
                    const logs = await db.all('SELECT role, content FROM conversation_logs WHERE user_phone = ? ORDER BY timestamp DESC LIMIT 10', [from]);
                    const history = logs.reverse().map((l: any) => ({ role: l.role, content: l.content }));

                    console.log(`🧠 Enviando mensaje a la IA...`);
                    const aiResponse = await processText(userText, history);
                    console.log(`✅ Respuesta de la IA recibida.`);
                    
                    console.log(`⚙️ Procesando acciones internas (Parser)...`);
                    const finalResponseToUser = await parseAndExecute(from, aiResponse);

                    await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES (?, ?, ?)', [from, 'assistant', aiResponse]);

                    console.log(`📤 Enviando respuesta a WhatsApp...`);
                    await sendWhatsAppMessage(from, finalResponseToUser);
                    console.log(`=========================================\n`);
                }
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Error handling webhook:', error);
        res.sendStatus(500);
    }
};
