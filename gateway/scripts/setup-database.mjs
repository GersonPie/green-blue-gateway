import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: new URL('../.env', import.meta.url) });
const connectionString = process.env.DATABASE_URL || (process.env.DB_PASWORD
    ? (() => {
        const legacyUrl = new URL('mysql://root@127.0.0.1:3306/gateway_auth');
        legacyUrl.password = process.env.DB_PASWORD;
        console.warn('DB_PASWORD is deprecated; replace it with DATABASE_URL in gateway/.env');
        return legacyUrl.toString();
    })()
    : undefined);
if (!connectionString) throw new Error('Set DATABASE_URL in gateway/.env');
const url = new URL(connectionString);
if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql://');
const database = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Invalid database name');
const connection = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), multipleStatements: true, connectTimeout: 5000 });
try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally { await connection.end(); }
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DATABASE_URL: connectionString }, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Authentication database is ready.');
