import { Request, Response } from 'express';
import { processText, transcribeAudio } from '../services/groqService';
import { parseAndExecute } from '../utils/parser';
import { getDB } from '../config/db';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

export const sendWhatsAppMessage = async (to: string, text: string) => {
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
            // Respondemos 200 OK INMEDIATAMENTE a WhatsApp para evitar que haga reintentos
            // si la API de Groq tarda demasiado en responder.
            res.sendStatus(200);

            if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages && body.entry[0].changes[0].value.messages[0]) {
                const message = body.entry[0].changes[0].value.messages[0];
                const from = message.from; 
                const type = message.type;
                
                let userText = '';

                const db = getDB();

                if (type === 'text') {
                    userText = message.text.body;
                } else if (type === 'audio') {
                    console.log(`🎙️ Audio recibido con ID: ${message.audio.id}. Descargando y transcribiendo...`);
                    const token = process.env.WHATSAPP_ACCESS_TOKEN;
                    
                    if (!token) {
                        console.error('⚠️ WHATSAPP_ACCESS_TOKEN no configurado. No se puede descargar el audio.');
                        userText = "(El usuario envió un audio, pero el sistema no tiene el Token para procesarlo).";
                    } else {
                        try {
                            // 1. Obtener la URL del archivo de WhatsApp
                            const mediaRes = await axios.get(`https://graph.facebook.com/v17.0/${message.audio.id}`, {
                                headers: { Authorization: `Bearer ${token}` }
                            });
                            
                            // 2. Descargar el archivo de audio
                            const audioDownload = await axios.get(mediaRes.data.url, {
                                headers: { Authorization: `Bearer ${token}` },
                                responseType: 'stream'
                            });

                            // Guardar temporalmente en la carpeta data
                            const tempFilePath = path.join(process.env.DATA_PATH || path.join(__dirname, '../../data'), `audio_${Date.now()}.ogg`);
                            const writer = fs.createWriteStream(tempFilePath);
                            audioDownload.data.pipe(writer);

                            await new Promise((resolve, reject) => {
                                writer.on('finish', resolve);
                                writer.on('error', reject);
                            });

                            // 3. Transcribir el audio usando Groq (Whisper)
                            console.log(`🎧 Audio descargado. Enviando a transcribir a Groq...`);
                            userText = await transcribeAudio(tempFilePath);
                            console.log(`📝 Transcripción obtenida: "${userText}"`);

                            // 4. Borrar el archivo temporal para no ocupar espacio
                            if (fs.existsSync(tempFilePath)) {
                                fs.unlinkSync(tempFilePath);
                            }
                        } catch (error: any) {
                            console.error('❌ Error procesando el audio de WhatsApp:', error.response?.data || error.message);
                            userText = "(El usuario envió un audio, pero ocurrió un error al descargarlo o transcribirlo).";
                        }
                    }
                }

                if (userText) {
                    console.log(`\n=========================================`);
                    console.log(`📨 MENSAJE ENTRANTE [${from}]: "${userText}"`);

                    // --- MONETIZATION & LIMITS LOGIC ---
                    const now = new Date();
                    let user = await db.get('SELECT * FROM users WHERE phone = ?', [from]);
                    
                    if (!user) {
                        await db.run('INSERT INTO users (phone, messages_count, cycle_start_date) VALUES (?, ?, ?)', [from, 0, now.toISOString()]);
                        user = await db.get('SELECT * FROM users WHERE phone = ?', [from]);
                    }

                    // 1. Reset check (30 days)
                    const cycleStart = new Date(user.cycle_start_date);
                    const diffDays = (now.getTime() - cycleStart.getTime()) / (1000 * 3600 * 24);
                    if (diffDays >= 30) {
                        await db.run('UPDATE users SET messages_count = 0, cycle_start_date = ? WHERE phone = ?', [now.toISOString(), from]);
                        user.messages_count = 0;
                        user.cycle_start_date = now.toISOString();
                    }

                    // 2. Promo Code Check
                    const upperText = userText.trim().toUpperCase();
                    if (upperText.startsWith('PROMO ')) {
                        const code = upperText.split(' ')[1];
                        if (code) {
                            const promo = await db.get('SELECT * FROM promo_codes WHERE code = ? AND uses_left > 0', [code]);
                            if (promo) {
                                let premiumUntil = new Date();
                                if (promo.type === 'forever') {
                                    premiumUntil = new Date('2099-12-31T23:59:59Z');
                                } else { // monthly
                                    premiumUntil.setDate(premiumUntil.getDate() + 30);
                                }
                                
                                await db.run('UPDATE users SET is_premium_until = ? WHERE phone = ?', [premiumUntil.toISOString(), from]);
                                await db.run('UPDATE promo_codes SET uses_left = uses_left - 1 WHERE code = ?', [code]);
                                
                                await sendWhatsAppMessage(from, '🎉 ¡Código promocional aplicado con éxito! Ya tenés acceso Premium sin límites.');
                                return; // Evitar que siga a la IA
                            } else {
                                await sendWhatsAppMessage(from, '❌ El código ingresado no existe o ya no tiene usos disponibles.');
                                return;
                            }
                        }
                    }

                    // 3. Limits Check
                    const isPremium = user.is_premium_until && new Date(user.is_premium_until) > now;
                    if (!isPremium && user.messages_count >= 20) {
                        const mpLink = process.env.MP_PAYMENT_LINK || 'https://link.mercadopago.com.ar/tu_link_aca';
                        const blockMsg = `🛑 ¡Llegaste al límite de tus 20 mensajes gratuitos de este mes!\n\nPara seguir usando a Karl sin límites, podés adquirir tu pase Premium acá: ${mpLink}\n\n_(Si tenés un código de promoción, envialo escribiendo PROMO seguido de tu código)_`;
                        await sendWhatsAppMessage(from, blockMsg);
                        return; // Bloqueado, no sigue a la IA
                    }

                    // Incrementar uso si no es premium
                    if (!isPremium) {
                        await db.run('UPDATE users SET messages_count = messages_count + 1 WHERE phone = ?', [from]);
                    }
                    // -----------------------------------

                    await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES (?, ?, ?)', [from, 'user', userText]);
                    
                    console.log(`🔍 Buscando historial para ${from}...`);
                    const logs = await db.all('SELECT role, content FROM conversation_logs WHERE user_phone = ? ORDER BY timestamp DESC LIMIT 10', [from]);
                    const history = logs.reverse().map((l: any) => ({ role: l.role, content: l.content }));

                    console.log(`🧠 Enviando mensaje a la IA...`);
                    const aiResponse = await processText(userText, history);
                    console.log(`✅ Respuesta de la IA recibida.`);
                    
                    // Extraemos la URL base del servidor dinámicamente
                    const host = req.headers.host || 'localhost:3000';
                    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
                    const baseUrl = `${protocol}://${host}`;

                    console.log(`⚙️ Procesando acciones internas (Parser)...`);
                    const finalResponseToUser = await parseAndExecute(from, aiResponse, baseUrl);

                    await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES (?, ?, ?)', [from, 'assistant', aiResponse]);

                    console.log(`📤 Enviando respuesta a WhatsApp...`);
                    await sendWhatsAppMessage(from, finalResponseToUser);
                    console.log(`=========================================\n`);
                }
            }
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('Error handling webhook:', error);
        if (!res.headersSent) {
            res.sendStatus(500);
        }
    }
};
