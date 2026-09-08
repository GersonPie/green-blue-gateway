import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
dotenv.config({ path: new URL('../.env', import.meta.url) });
function integer(name: string, fallback: number, max = 65535) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`);
    return value;
}
export const config = {
    port: integer('PORT', 8000), host: process.env.HOST || '127.0.0.1',
    startingPort: integer('STARTING_PORT', 8001), maxContainers: integer('MAX_CONTAINERS', 10, 100),
    managementToken: process.env.MANAGEMENT_TOKEN || '',
};
if (config.startingPort + config.maxContainers - 1 > 65535) throw new Error('Invalid service port range');
