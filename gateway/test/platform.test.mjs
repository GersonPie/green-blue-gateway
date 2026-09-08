import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Platform } from '../dist/platform/index.js';
import { DockerRuntime } from '../dist/platform/docker.js';
import { GitHub } from '../dist/platform/github.js';
import { ContainerManager } from '../dist/Instace.js';
import { createApp } from '../dist/app.js';
import { config } from '../dist/config.js';

async function upstream(name) {
    let complete;
    let signal;
    const started = new Promise((resolve) => { signal = resolve; });
    const server = createServer(async (req, res) => {
        if (req.url.startsWith('/slow')) { signal(); await new Promise((resolve) => { complete = resolve; }); }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ name, path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie }));
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const instance = { name, kind: 'docker', port: server.address().port, state: 'running', snapshot() { return { name, port: this.port, state: this.state }; }, async check() { return this.state === 'running'; }, async stop() { this.state = 'stopped'; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
    return { instance, started, complete: () => complete?.(), close: () => instance.stop() };
}

test('route promotion preserves in-flight requests, drains, and rejects stale versions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gateway-routes-'));
    const manager = new ContainerManager();
    const platform = new Platform(manager, { directory });
    const a = await upstream('blue'); const b = await upstream('green');
    manager.instances.set('blue', a.instance); manager.instances.set('green', b.instance);
    const server = createApp(manager, platform).listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    let slow;
    try {
        const route = await platform.routing.create({ path: '/payments', target: 'blue' });
        await assert.rejects(platform.retire('blue'), { status: 409 });
        slow = fetch(`${base}/payments/slow?keep=1`).then((response) => response.json());
        await a.started;
        assert.equal(platform.routing.active('blue'), 1);
        const traffic = Promise.all(Array.from({ length: 40 }, async (_, index) => { await delay(index * 2); const response = await fetch(`${base}/payments/name`); assert.equal(response.status, 200); return (await response.json()).name; }));
        const switched = await platform.routing.promote(route.id, 'green', 1);
        assert.equal(switched.version, 2);
        await assert.rejects(platform.routing.promote(route.id, 'blue', 1), { status: 409 });
        const response = await fetch(`${base}/payments/name?hello=world`, { headers: { authorization: 'Bearer application-token', cookie: 'gateway_session=private; app_session=public' } });
        const body = await response.json();
        assert.deepEqual(body, { name: 'green', path: '/name?hello=world', authorization: 'Bearer application-token', cookie: 'app_session=public' });
        let retired = false;
        const draining = platform.retire('blue').then(() => { retired = true; });
        await delay(50); assert.equal(retired, false);
        a.complete(); assert.equal((await slow).name, 'blue');
        await draining; assert.equal(retired, true);
        assert.ok((await traffic).every((name) => ['blue', 'green'].includes(name)));
        await assert.rejects(platform.routing.rollback(route.id, 2), { status: 503 });
        assert.equal(platform.routing.list()[0].target, 'green');
        assert.equal(platform.store.history(route.id).length, 2);
        await assert.rejects(platform.routing.create({ path: '/auth', target: 'green' }), { status: 400 });
        assert.equal(platform.routing.resolve('localhost', '/payments-other'), undefined);
        platform.routing.remove(route.id, 2);
    } finally {
        a.complete(); await slow?.catch(() => {}); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
        await a.close(); await b.close(); await platform.shutdown(); await rm(directory, { recursive: true, force: true });
    }
});

test('route history survives restart and multi-route promotion is all-or-nothing', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gateway-persistence-'));
    const manager = new ContainerManager();
    const a = await upstream('old'); const b = await upstream('new');
    manager.instances.set('old', a.instance); manager.instances.set('new', b.instance);
    let platform = new Platform(manager, { directory });
    try {
        const one = await platform.routing.create({ path: '/one', target: 'old' });
        const two = await platform.routing.create({ path: '/two', target: 'old' });
        await assert.rejects(platform.routing.promoteMany([{ id: one.id, target: 'new', expectedVersion: 1 }, { id: two.id, target: 'missing', expectedVersion: 1 }]), { status: 503 });
        assert.ok(platform.routing.list().every((route) => route.target === 'old'));
        await platform.routing.promoteMany([one, two].map((route) => ({ id: route.id, target: 'new', expectedVersion: 1 })));
        await platform.routing.rollback(one.id, 2);
        await platform.shutdown(); platform = new Platform(manager, { directory });
        assert.equal(platform.routing.list().find((route) => route.id === one.id).target, 'old');
        assert.equal(platform.store.history(one.id).length, 3);
    } finally { await a.close(); await b.close(); await platform.shutdown(); await rm(directory, { recursive: true, force: true }); }
});

test('signed webhooks deduplicate and deployments snapshot encrypted environment', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gateway-deployments-'));
    const previous = process.env.GITHUB_WEBHOOK_SECRET; process.env.GITHUB_WEBHOOK_SECRET = 'webhook-test-secret';
    const manager = new ContainerManager();
    let captured;
    const runtime = { async status() { return { available: true, message: 'test' }; }, async build(_project, _deployment, log) { log('Build complete'); return `sha256:${'a'.repeat(64)}`; }, async start(project, deployment, environment) { captured = environment; return { name: deployment.instanceName, kind: 'docker', port: 12345, state: 'running', async check() { return true; }, async stop() {}, snapshot() { return { name: this.name, port: this.port, state: this.state }; } }; }, async restore() {}, async remove() {}, async logs() { return 'test'; } };
    const platform = new Platform(manager, { directory, runtime });
    try {
        const project = platform.saveProject({ name: 'private-api', repository: 'owner/private', autoDeploy: true, environment: { API_KEY: 'never-store-plaintext' } });
        assert.deepEqual(project.environmentKeys, ['API_KEY']);
        const payload = Buffer.from(JSON.stringify({ repository: { full_name: 'owner/private' }, ref: 'refs/heads/main', after: 'b'.repeat(40) }));
        const signature = `sha256=${createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET).update(payload).digest('hex')}`;
        assert.throws(() => platform.webhook('invalid', 'push', payload, 'sha256=' + '0'.repeat(64)), { status: 401 });
        assert.equal(platform.webhook('delivery-1', 'push', payload, signature).queued, 1);
        assert.equal(platform.webhook('delivery-1', 'push', payload, signature).duplicate, true);
        platform.saveProject({ environment: { API_KEY: 'new-value' } }, project.id);
        for (let attempt = 0; attempt < 50 && platform.store.deployments()[0]?.state !== 'ready'; attempt++) await delay(10);
        assert.equal(platform.store.deployments()[0].state, 'ready');
        assert.equal(captured.API_KEY, 'never-store-plaintext');
        assert.equal(JSON.stringify(platform.store.deployments()).includes('never-store-plaintext'), false);
        const disk = await readFile(path.join(directory, 'gateway.sqlite-wal'));
        assert.equal(disk.includes(Buffer.from('never-store-plaintext')), false);
    } finally { await platform.shutdown(); await rm(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.GITHUB_WEBHOOK_SECRET; else process.env.GITHUB_WEBHOOK_SECRET = previous; }
});

test('GitHub App obtains scoped installation credentials for private repositories', async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gateway-github-'));
    const previous = { ...process.env };
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPath = path.join(directory, 'app.pem');
    await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    process.env.GITHUB_APP_ID = '123'; process.env.GITHUB_INSTALLATION_ID = '456'; process.env.GITHUB_PRIVATE_KEY_PATH = keyPath;
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        requests++;
        if (url.endsWith('/access_tokens')) {
            const jwt = init.headers.Authorization.slice(7).split('.');
            assert.equal(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), publicKey, Buffer.from(jwt[2], 'base64url')), true);
            assert.deepEqual(JSON.parse(init.body), { permissions: { contents: 'read' } });
            return Response.json({ token: 'installation-test-token', expires_at: new Date(Date.now() + 3600000).toISOString() });
        }
        assert.equal(init.headers.Authorization, 'Bearer installation-test-token');
        if (url.includes('/installation/repositories')) return Response.json({ repositories: [{ full_name: 'owner/private', private: true, default_branch: 'main' }] });
        return Response.json({ sha: 'a'.repeat(40) });
    });
    try {
        const github = new GitHub();
        assert.equal((await github.repositories())[0].private, true);
        assert.equal(await github.resolve('owner/private', 'main'), 'a'.repeat(40));
        assert.equal(requests, 3);
    } finally { for (const key of ['GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID', 'GITHUB_PRIVATE_KEY_PATH']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await rm(directory, { recursive: true, force: true }); }
});

test('Docker builds pin commits and keep private credentials outside arguments and build context', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gateway-docker-'));
    const sha = 'a'.repeat(40);
    const calls = [];
    const execute = async (file, args, options = {}) => {
        calls.push({ file, args, options });
        if (file === 'git' && args[0] === 'init') {
            await writeFile(path.join(options.cwd, 'Dockerfile'), 'FROM scratch\n');
            await writeFile(path.join(options.cwd, '.env'), 'SECRET=hidden');
            await mkdir(path.join(options.cwd, 'node_modules'));
        }
        if (args[0] === 'rev-parse') return sha;
        if (file === 'docker' && args[0] === 'build') {
            const context = args.at(-1);
            await assert.rejects(access(path.join(context, '.env')));
            await assert.rejects(access(path.join(context, 'node_modules')));
            await writeFile(args[args.indexOf('--iidfile') + 1], `sha256:${'b'.repeat(64)}`);
        }
        return '';
    };
    try {
        const runtime = new DockerRuntime(directory, 'test-workspace', { async token() { return 'private-test-token'; } }, execute);
        const image = await runtime.build({ repository: 'owner/private', context: '.', dockerfile: 'Dockerfile' }, { id: 'test-deployment', commit: sha }, () => {}, new AbortController().signal);
        assert.equal(image, `sha256:${'b'.repeat(64)}`);
        assert.equal(JSON.stringify(calls.map((call) => call.args)).includes('private-test-token'), false);
        assert.ok(calls.find((call) => call.file === 'git').options.env.GIT_CONFIG_VALUE_0.startsWith('AUTHORIZATION: basic '));
        assert.ok(calls.some((call) => call.args.includes(sha)));
    } finally { await rm(directory, { recursive: true, force: true }); }
});
