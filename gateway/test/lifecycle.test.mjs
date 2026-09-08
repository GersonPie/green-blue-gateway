import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config, root } from '../dist/config.js';
import { Container, ContainerManager } from '../dist/Instace.js';
import { createServer } from 'node:net';
import { createApp } from '../dist/app.js';
import { portAvailable } from '../dist/system.js';

test('authenticated lifecycle, concurrent allocation, forwarding and cleanup', async () => {
    config.managementToken = 'integration-test-token';
    config.maxContainers = 2;
    for (let port = 23000; port < 24000; port += 2) {
        if (await portAvailable(port) && await portAvailable(port + 1)) {
            try { await access(path.join(root, 'RunningContainers', String(port))); continue; } catch {}
            try { await access(path.join(root, 'RunningContainers', String(port + 1))); continue; } catch {}
            config.startingPort = port; break;
        }
    }
    const template = await readFile(path.join(root, 'DefaultContainer', 'index.js'), 'utf8');
    const manager = new ContainerManager();
    const server = createApp(manager).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { authorization: 'Bearer integration-test-token', 'content-type': 'application/json' };
    try {
        assert.equal((await fetch(`${base}/containers`)).status, 401);
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.equal((await fetch(`${base}/containers`, { method: 'POST', headers, body: JSON.stringify({ name: '../bad;command' }) })).status, 400);
        const responses = await Promise.all(['alpha', 'beta'].map((name) => fetch(`${base}/containers`, { method: 'POST', headers, body: JSON.stringify({ name }) })));
        assert.deepEqual(responses.map((response) => response.status), [201, 201]);
        const instances = await Promise.all(responses.map((response) => response.json()));
        assert.notEqual(instances[0].port, instances[1].port);
        await assert.rejects(manager.start('alpha'), { status: 409 });
        await assert.rejects(manager.start('gamma'), { status: 503 });
        const forwarded = await fetch(`${base}/services/alpha/name?check=1`, { headers });
        assert.equal(forwarded.status, 200);
        assert.deepEqual(await forwarded.json(), { name: 'alpha' });
        assert.equal((await fetch(`${base}/containers/alpha/health`, { headers })).status, 200);
        for (const instance of instances) {
            await assert.rejects(access(path.join(root, 'RunningContainers', String(instance.port), 'node_modules')));
            assert.match(await readFile(path.join(root, 'RunningContainers', String(instance.port), '.env'), 'utf8'), new RegExp(`NAME=${instance.name}`));
        }
        assert.equal(await readFile(path.join(root, 'DefaultContainer', 'index.js'), 'utf8'), template);
        assert.equal((await fetch(`${base}/containers/alpha`, { method: 'DELETE', headers })).status, 204);
        assert.equal((await fetch(`${base}/services/alpha/name`, { headers })).status, 503);
        assert.equal(await portAvailable(instances[0].port), true);
        await manager.shutdown();
        for (const instance of instances) await assert.rejects(access(path.join(root, 'RunningContainers', String(instance.port))));
    } finally {
        await manager.shutdown();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});

test('failed startup propagates and removes its generated directory', async () => {
    const blocker = createServer((socket) => socket.destroy()).listen(0, '127.0.0.1');
    await once(blocker, 'listening');
    const port = blocker.address().port;
    const instance = new Container('failed-start-test');
    try {
        await assert.rejects(instance.start(port));
        assert.equal(instance.state, 'failed');
        await assert.rejects(access(path.join(root, 'RunningContainers', String(port))));
    } finally {
        await instance.stop();
        await new Promise((resolve) => blocker.close(resolve));
    }
});
