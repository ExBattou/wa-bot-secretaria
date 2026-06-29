import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import webhookRoutes from './routes/webhookRoutes';
import webRoutes from './routes/webRoutes';
import { initDB } from './config/db';
import { startCronJobs } from './services/cronService';

import adminRoutes from './routes/adminRoutes';

const app = express();
app.use(express.json());

// Montar la carpeta pública para servir el HTML/CSS/JS del Dashboard
app.use(express.static(path.join(__dirname, '../public')));

app.use('/webhook', webhookRoutes);
app.use('/api/web', webRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
    try {
        await initDB();
        startCronJobs();
        app.listen(Number(PORT), '0.0.0.0', () => {
            console.log(`🚀 Servidor escuchando en http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error('❌ Error iniciando la base de datos:', error);
        process.exit(1);
    }
};

startServer();
