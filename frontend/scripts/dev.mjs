import { createServer, loadEnv } from 'vite';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
const gatewayRoot = fileURLToPath(new URL('../../gateway', import.meta.url));
const env = loadEnv('development', gatewayRoot, '');
let target = process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.PORT || env.PORT || 8000}`;
let gateway;
let reachable = false;
try { reachable = (await fetch(`${target}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
process.env.MANAGEMENT_TOKEN ||= env.MANAGEMENT_TOKEN || randomBytes(32).toString('hex');
if (reachable) {
    const access = await fetch(`${target}/containers`, { headers: { authorization: `Bearer ${process.env.MANAGEMENT_TOKEN}` }, signal: AbortSignal.timeout(3000) });
    await access.body?.cancel();
    if (!access.ok) {
        if (process.env.GATEWAY_URL) throw new Error('Configured gateway rejected MANAGEMENT_TOKEN');
        const port = await new Promise((resolve, reject) => {
            const probe = createNetServer();
            probe.once('error', reject);
            probe.listen(0, '127.0.0.1', () => {
                const address = probe.address();
                probe.close(() => resolve(address.port));
            });
        });
        process.env.PORT = String(port);
        process.env.GATEWAY_DATA_DIR ||= `${gatewayRoot}/data/console`;
        target = `http://127.0.0.1:${port}`;
        reachable = false;
        console.log(`Existing gateway credentials unavailable. Starting a separate gateway on port ${port}.`);
    }
}
if (!reachable) {
    if (process.env.GATEWAY_URL) throw new Error('Configured GATEWAY_URL is unavailable');
    gateway = fork(`${gatewayRoot}/dist/index.js`, [], { cwd: gatewayRoot, env: process.env, stdio: 'inherit' });
    for (let attempt = 0; attempt < 50; attempt++) {
        if (gateway.exitCode !== null) throw new Error('Gateway failed to start');
        try { if ((await fetch(`${target}/health`, { signal: AbortSignal.timeout(1000) })).ok) { reachable = true; break; } } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!reachable) { gateway.kill(); throw new Error('Gateway startup timed out'); }
}
let server;
try {
    server = await createServer();
    await server.listen();
} catch (error) {
    if (gateway?.connected) gateway.send('shutdown');
    throw error;
}
server.printUrls();
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await server.close();
    if (gateway?.connected) gateway.send('shutdown');
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
