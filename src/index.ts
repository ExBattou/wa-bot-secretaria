import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import webhookRoutes from './routes/webhookRoutes';
import { initDB } from './config/db';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.use('/webhook', webhookRoutes);

const startServer = async () => {
    try {
        await initDB();
        app.listen(PORT, () => {
            console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Error iniciando la base de datos:', error);
        process.exit(1);
    }
};

startServer();
