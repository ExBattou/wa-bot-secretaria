import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { processText, transcribeAudio } from './groqService';
import { parseAndExecute } from '../utils/parser';
import { getDB } from '../config/db';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN no configurado en variables de entorno.');
}

export const bot = new Telegraf(token || 'dummy_token');

export const sendTelegramMessage = async (chatId: string, text: string) => {
    if (!token) {
        console.warn(`⚠️ TELEGRAM_BOT_TOKEN no configurado. Simulando envío a Telegram [${chatId}]:`, text);
        return;
    }

    try {
        await bot.telegram.sendMessage(chatId, text, {
            parse_mode: 'Markdown'
        }).catch(async (markdownError: any) => {
            // Si falla por caracteres especiales en Markdown, enviamos texto plano
            console.warn('⚠️ Error enviando con parse_mode Markdown, reintentando como texto plano:', markdownError?.message || markdownError);
            await bot.telegram.sendMessage(chatId, text);
        });
    } catch (error: any) {
        console.error(`❌ Error enviando mensaje a Telegram [${chatId}]:`, error.message);
    }
};

export const processIncomingUserMessage = async (chatId: string, userText: string, baseUrl: string) => {
    try {
        console.log(`\n=========================================`);
        console.log(`📨 MENSAJE ENTRANTE TELEGRAM [${chatId}]: "${userText}"`);

        const db = getDB();
        const now = new Date();

        // --- MONETIZATION & LIMITS LOGIC ---
        let user = await db.get('SELECT * FROM users WHERE phone = $1', [chatId]);

        if (!user) {
            await db.run(
                'INSERT INTO users (phone, messages_count, cycle_start_date) VALUES ($1, $2, $3)',
                [chatId, 0, now.toISOString()]
            );
            user = await db.get('SELECT * FROM users WHERE phone = $1', [chatId]);
        }

        // 1. Reset check (30 days)
        const cycleStart = new Date(user.cycle_start_date);
        const diffDays = (now.getTime() - cycleStart.getTime()) / (1000 * 3600 * 24);
        if (diffDays >= 30) {
            await db.run(
                'UPDATE users SET messages_count = 0, cycle_start_date = $1 WHERE phone = $2',
                [now.toISOString(), chatId]
            );
            user.messages_count = 0;
            user.cycle_start_date = now.toISOString();
        }

        // 2. Promo Code Check
        const upperText = userText.trim().toUpperCase();
        if (upperText.startsWith('PROMO ') || upperText.startsWith('/PROMO ')) {
            const parts = upperText.replace('/PROMO ', 'PROMO ').split(' ');
            const code = parts[1];
            if (code) {
                const promo = await db.get('SELECT * FROM promo_codes WHERE code = $1 AND uses_left > 0', [code]);
                if (promo) {
                    let premiumUntil = new Date();
                    if (promo.type === 'forever') {
                        premiumUntil = new Date('2099-12-31T23:59:59Z');
                    } else { // monthly
                        premiumUntil.setDate(premiumUntil.getDate() + 30);
                    }

                    await db.run('UPDATE users SET is_premium_until = $1 WHERE phone = $2', [premiumUntil.toISOString(), chatId]);
                    await db.run('UPDATE promo_codes SET uses_left = uses_left - 1 WHERE code = $1', [code]);

                    await sendTelegramMessage(chatId, '🎉 *¡Código promocional aplicado con éxito!*\nYa tenés acceso Premium sin límites.');
                    return;
                } else {
                    await sendTelegramMessage(chatId, '❌ El código ingresado no existe o ya no tiene usos disponibles.');
                    return;
                }
            }
        }

        // 3. Limits Check
        const isPremium = user.is_premium_until && new Date(user.is_premium_until) > now;
        if (!isPremium && user.messages_count >= 20) {
            const mpLink = process.env.MP_PAYMENT_LINK || 'https://link.mercadopago.com.ar/tu_link_aca';
            const blockMsg = `🛑 *¡Llegaste al límite de tus 20 mensajes gratuitos de este mes!*\n\nPara seguir usando a Karl sin límites, podés adquirir tu pase Premium acá: ${mpLink}\n\n_(Si tenés un código de promoción, envialo escribiendo PROMO seguido de tu código)_`;
            await sendTelegramMessage(chatId, blockMsg);
            return;
        }

        // Incrementar uso si no es premium
        if (!isPremium) {
            await db.run('UPDATE users SET messages_count = messages_count + 1 WHERE phone = $1', [chatId]);
        }
        // -----------------------------------

        await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES ($1, $2, $3)', [chatId, 'user', userText]);

        console.log(`🔍 Buscando historial para ${chatId}...`);
        const logs = await db.all(
            'SELECT role, content FROM conversation_logs WHERE user_phone = $1 ORDER BY timestamp DESC LIMIT 10',
            [chatId]
        );
        const history = logs.reverse().map((l: any) => ({ role: l.role, content: l.content }));

        console.log(`🧠 Enviando mensaje a Groq...`);
        const aiResponse = await processText(userText, history);
        console.log(`✅ Respuesta recibida de Groq.`);

        console.log(`⚙️ Procesando acciones internas (Parser)...`);
        const finalResponseToUser = await parseAndExecute(chatId, aiResponse, baseUrl);

        await db.run('INSERT INTO conversation_logs (user_phone, role, content) VALUES ($1, $2, $3)', [chatId, 'assistant', aiResponse]);

        console.log(`📤 Enviando respuesta a Telegram...`);
        await sendTelegramMessage(chatId, finalResponseToUser);
        console.log(`=========================================\n`);
    } catch (error: any) {
        console.error('❌ Error procesando mensaje de usuario:', error);
        await sendTelegramMessage(chatId, 'Perdón, ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.');
    }
};

export const setupTelegramBot = (getBaseUrl: () => string) => {
    if (!token) {
        console.warn('⚠️ No se puede inicializar Telegram Bot: TELEGRAM_BOT_TOKEN faltante.');
        return;
    }

    bot.start(async (ctx: Context) => {
        const name = ctx.from?.first_name || 'che';
        const welcomeText = `👋 ¡Hola ${name}! Soy *Karl*, tu secretario ejecutivo virtual.\n\nPuedo ayudarte a:\n- 📝 Guardar y consultar tus tareas y recordatorios.\n- ⏰ Configurar alarmas y avisos.\n- 💰 Registrar tus gastos y llevar el control.\n- 📊 Darte acceso a tu tablero web privado.\n\nTambién podés enviarme notas de voz 🎙️ y las transcribo al instante.\n\n¿En qué te puedo dar una mano hoy?`;
        await ctx.replyWithMarkdown(welcomeText);
    });

    bot.help(async (ctx: Context) => {
        const helpText = `🛠️ *Comandos y Funciones de Karl:*\n\n` +
            `- *Agendar tareas:* _"Anotame reunión con Lucas mañana a las 10hs"_\n` +
            `- *Recordatorios:* _"Haceme acordar en 30 minutos de pagar la luz"_\n` +
            `- *Consultar agenda:* _"¿Qué tareas tengo?"_ o _"Ver mis alarmas"_\n` +
            `- *Registrar gastos:* _"Gasté 4500 en almuerzo"_\n` +
            `- *Tablero web:* _"Pasame el link del dashboard"_\n` +
            `- *Audios:* Enviame una nota de voz con cualquier orden.\n` +
            `- *Promo:* Escribí \`PROMO <codigo>\` para activar tu cupón.`;
        await ctx.replyWithMarkdown(helpText);
    });

    // Manejo de mensajes de texto
    bot.on(message('text'), async (ctx: Context) => {
        if (!ctx.chat || !ctx.message || !('text' in ctx.message)) return;
        const chatId = ctx.chat.id.toString();
        const userText = ctx.message.text;
        const baseUrl = getBaseUrl();
        await processIncomingUserMessage(chatId, userText, baseUrl);
    });

    // Manejo de notas de voz y audios
    bot.on([message('voice'), message('audio')], async (ctx: Context) => {
        if (!ctx.chat || !ctx.message) return;
        const chatId = ctx.chat.id.toString();
        const msg = ctx.message as any;
        const fileId = msg.voice ? msg.voice.file_id : msg.audio?.file_id;

        if (!fileId) return;

        console.log(`🎙️ Nota de voz recibida de Telegram [${chatId}]. Descargando...`);
        await ctx.sendChatAction('typing');

        try {
            const fileLink = await ctx.telegram.getFileLink(fileId);
            const dataDir = process.env.DATA_PATH || path.join(__dirname, '../../data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            const tempFilePath = path.join(dataDir, `tg_audio_${Date.now()}.ogg`);
            const response = await axios.get(fileLink.href, { responseType: 'stream' });
            const writer = fs.createWriteStream(tempFilePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(`🎧 Audio descargado. Enviando a Groq Whisper...`);
            const transcribedText = await transcribeAudio(tempFilePath);
            console.log(`📝 Transcripción obtenida: "${transcribedText}"`);

            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }

            if (!transcribedText || transcribedText.trim() === '') {
                await sendTelegramMessage(chatId, 'No pude entender con claridad el audio. ¿Podrías repetirlo o escribirlo?');
                return;
            }

            const baseUrl = getBaseUrl();
            await processIncomingUserMessage(chatId, transcribedText, baseUrl);
        } catch (error: any) {
            console.error('❌ Error procesando nota de voz de Telegram:', error);
            await sendTelegramMessage(chatId, 'Ocurrió un error procesando tu audio. Por favor intenta enviarlo de nuevo o escribirlo.');
        }
    });

    bot.catch((err: any, ctx: Context) => {
        console.error(`❌ Error en Telegraf bot para update ${ctx.update?.update_id}:`, err);
    });
};
