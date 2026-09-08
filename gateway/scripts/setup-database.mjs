import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: new URL('../.env', import.meta.url) });
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in gateway/.env');
const url = new URL(process.env.DATABASE_URL);
if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql://');
const database = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-zA-Z0-9_]+$/.test(database)) throw new Error('Invalid database name');
const connection = await mysql.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), multipleStatements: true, connectTimeout: 5000 });
try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally { await connection.end(); }
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Authentication database is ready.');
