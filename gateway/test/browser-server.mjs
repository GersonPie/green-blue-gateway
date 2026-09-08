import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../dist/config.js';
import { createApp } from '../dist/app.js';
import { Auth, hashPassword } from '../dist/auth.js';
import { MemoryAuthStore } from './auth-fixture.mjs';
import { Platform } from '../dist/platform/index.js';
import { ContainerManager } from '../dist/Instace.js';
config.port = 18765; config.startingPort = 24001; config.maxContainers = 20;
config.managementToken = 'browser-fixture-machine-token';
const store = new MemoryAuthStore();
await store.createAdministrator({ name: 'Test Operator', email: 'operator@example.test', passwordHash: await hashPassword('gateway-test-password-only') });
const directory = await mkdtemp(path.join(tmpdir(), 'gateway-browser-'));
const manager = new ContainerManager();
const platform = new Platform(manager, { directory });
const server = createApp(manager, platform, new Auth(store)).listen(config.port, '127.0.0.1');
let closing = false;
async function close() {
    if (closing) return; closing = true;
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await platform.shutdown(); await manager.shutdown(); await rm(directory, { recursive: true, force: true });
}
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
