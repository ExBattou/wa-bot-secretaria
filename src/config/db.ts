import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

let pool: Pool;

export const initDB = async () => {
    if (!process.env.DATABASE_URL) {
        console.warn("⚠️ No DATABASE_URL found in environment variables. Database connection might fail.");
    }

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Crear tablas con sintaxis de PostgreSQL
    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_phone TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            due_date TEXT,
            parent_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS conversation_logs (
            id SERIAL PRIMARY KEY,
            user_phone TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id SERIAL PRIMARY KEY,
            user_phone TEXT NOT NULL,
            message TEXT NOT NULL,
            execute_at TIMESTAMP NOT NULL,
            status TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS web_sessions (
            token TEXT PRIMARY KEY,
            user_phone TEXT NOT NULL,
            pin TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            user_phone TEXT PRIMARY KEY,
            daily_09 BOOLEAN DEFAULT true,
            daily_12 BOOLEAN DEFAULT true,
            daily_17 BOOLEAN DEFAULT true
        );

        CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            is_premium_until TIMESTAMP,
            messages_count INTEGER DEFAULT 0,
            cycle_start_date TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS promo_codes (
            code TEXT PRIMARY KEY,
            uses_left INTEGER DEFAULT 10,
            type TEXT NOT NULL
        );
    `);

    // Insertar algunos códigos promocionales por defecto si no existen
    await pool.query(`
        INSERT INTO promo_codes (code, uses_left, type) VALUES ('KARL30', 10, 'monthly') ON CONFLICT DO NOTHING;
        INSERT INTO promo_codes (code, uses_left, type) VALUES ('KARLADMIN', 10, 'forever') ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Base de datos PostgreSQL conectada e inicializada correctamente.');
    
    // Retornamos el objeto pool como legacy base si es necesario
    return pool;
};

// Wrapper para mantener la compatibilidad con los métodos .get, .all y .run
// pero asumiendo que las queries SQL ya están escritas para Postgres ($1, $2, etc.)
export const getDB = () => {
    if (!pool) {
        throw new Error('Database not initialized. Call initDB first.');
    }
    return {
        // Devuelve una sola fila (como db.get de sqlite)
        get: async (sql: string, params: any[] = []) => {
            const res = await pool.query(sql, params);
            return res.rows[0] || null;
        },
        // Devuelve todas las filas (como db.all de sqlite)
        all: async (sql: string, params: any[] = []) => {
            const res = await pool.query(sql, params);
            return res.rows;
        },
        // Ejecuta sin devolver filas, ideal para INSERT/UPDATE/DELETE
        run: async (sql: string, params: any[] = []) => {
            await pool.query(sql, params);
        },
        // Exponemos el pool por si se necesita acceso directo
        pool
    };
};
