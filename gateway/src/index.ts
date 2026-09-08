import { config } from './config.js';
import { createApp } from './app.js';
import { ContainerManager } from './Instace.js';
import { Platform } from './platform/index.js';
import { Auth } from './auth.js';
import { PrismaAuthStore } from './auth-store.js';
if (!config.managementToken) throw new Error('Set MANAGEMENT_TOKEN in gateway/.env before starting');
const manager = new ContainerManager();
const platform = new Platform(manager);
await platform.initialize();
const databaseUrl = process.env.DATABASE_URL || (process.env.DB_PASWORD
    ? (() => {
        const url = new URL('mysql://root@127.0.0.1:3306/gateway_auth');
        url.password = process.env.DB_PASWORD;
        console.warn('DB_PASWORD is deprecated; replace it with DATABASE_URL in gateway/.env');
        return url.toString();
    })()
    : undefined);
const auth = new Auth(databaseUrl ? new PrismaAuthStore(databaseUrl) : undefined);
const server = createApp(manager, platform, auth).listen(config.port, config.host, () => console.log(`Gateway listening at http://${config.host}:${config.port}`));
server.on('error', (error) => { console.error(error); process.exitCode = 1; });
let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await platform.shutdown();
    await auth.close();
    await manager.shutdown();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('message', (message) => {
    if (message === 'shutdown') void shutdown().then(() => {
        if (process.connected) process.disconnect?.();
    });
});
process.on('disconnect', () => void shutdown());
