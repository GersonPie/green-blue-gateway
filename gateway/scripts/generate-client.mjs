import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'generate'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'mysql://unused@localhost:3306/gateway_auth' } });
process.exit(result.status ?? 1);
