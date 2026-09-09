import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import webhookRoutes from './routes/webhookRoutes';
import webRoutes from './routes/webRoutes';
import adminRoutes from './routes/adminRoutes';
import { initDB } from './config/db';
import { startCronJobs } from './services/cronService';
import { bot, setupTelegramBot } from './services/telegramService';

const app = express();
app.use(express.json());

// Montar la carpeta pública para servir el HTML/CSS/JS del Dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Webhook y APIs
app.use('/webhook', webhookRoutes);
app.use('/api/web', webRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3000;

const getBaseUrl = (): string => {
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_URL;
    if (domain) {
        return domain.startsWith('http') ? domain : `https://${domain}`;
    }
    return process.env.BASE_URL || `http://localhost:${PORT}`;
};

const startServer = async () => {
    try {
        await initDB();
        
        // Configuración de listeners del bot de Telegram
        setupTelegramBot(getBaseUrl);

        startCronJobs();

        app.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`🚀 Servidor web escuchando en http://0.0.0.0:${PORT}`);
        });

        const usePolling = process.env.USE_POLLING !== 'false';
        if (usePolling && process.env.TELEGRAM_BOT_TOKEN) {
            console.log('🤖 Iniciando Telegram Bot en modo Long Polling...');
            bot.launch(() => {
                console.log('✅ Telegram Bot conectado exitosamente vía Long Polling.');
            }).catch((err) => {
                console.error('❌ Error al iniciar Telegram Bot en modo polling:', err.message);
            });
        } else if (!usePolling && process.env.TELEGRAM_WEBHOOK_URL) {
            console.log(`🤖 Configurando Webhook de Telegram hacia ${process.env.TELEGRAM_WEBHOOK_URL}...`);
            await bot.telegram.setWebhook(`${process.env.TELEGRAM_WEBHOOK_URL}/webhook/telegram`);
            console.log('✅ Webhook de Telegram configurado con éxito.');
        }

        // Graceful stop
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));

    } catch (error) {
        console.error('❌ Error fatal iniciando el servidor:', error);
        process.exit(1);
    }
};

startServer();
