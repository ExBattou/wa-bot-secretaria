import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';

const dataPath = process.env.DATA_PATH || path.join(__dirname, '../../data');

if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

export const dbPath = path.join(dataPath, 'database.sqlite');

let dbInstance: Database | null = null;

export const initDB = async () => {
    if (dbInstance) return dbInstance;

    dbInstance = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await dbInstance.exec(`
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS conversation_logs;

        CREATE TABLE tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_phone TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            due_date TEXT,
            parent_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE conversation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_phone TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_phone TEXT NOT NULL,
            message TEXT NOT NULL,
            execute_at DATETIME NOT NULL,
            status TEXT DEFAULT 'pending'
        );

        CREATE TABLE IF NOT EXISTS web_sessions (
            token TEXT PRIMARY KEY,
            user_phone TEXT NOT NULL,
            pin TEXT NOT NULL,
            expires_at DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
            user_phone TEXT PRIMARY KEY,
            daily_09 BOOLEAN DEFAULT 1,
            daily_12 BOOLEAN DEFAULT 1,
            daily_17 BOOLEAN DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS users (
            phone TEXT PRIMARY KEY,
            is_premium_until DATETIME,
            messages_count INTEGER DEFAULT 0,
            cycle_start_date DATETIME
        );

        CREATE TABLE IF NOT EXISTS promo_codes (
            code TEXT PRIMARY KEY,
            uses_left INTEGER DEFAULT 10,
            type TEXT NOT NULL
        );
    `);

    // Insertar algunos códigos promocionales por defecto si no existen
    await dbInstance.exec(`
        INSERT OR IGNORE INTO promo_codes (code, uses_left, type) VALUES ('KARL30', 10, 'monthly');
        INSERT OR IGNORE INTO promo_codes (code, uses_left, type) VALUES ('KARLADMIN', 10, 'forever');
    `);

    console.log('✅ Base de datos SQLite inicializada correctamente.');
    return dbInstance;
};

export const getDB = () => {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initDB first.');
    }
    return dbInstance;
};
