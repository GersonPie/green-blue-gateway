import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Auth, hashPassword, verifyPassword } from '../dist/auth.js';
import { MemoryAuthStore } from './auth-fixture.mjs';
import { ContainerManager } from '../dist/Instace.js';
import { createApp } from '../dist/app.js';

test('passwords are salted and incorrect passwords fail verification', async () => {
    const first = await hashPassword('a-long-test-password');
    const second = await hashPassword('a-long-test-password');
    assert.notEqual(first, second);
    assert.equal(await verifyPassword('a-long-test-password', first), true);
    assert.equal(await verifyPassword('incorrect-password', first), false);
});

test('administrator setup, cookie sessions, CSRF protection, logout and expiry', async () => {
    const store = new MemoryAuthStore();
    const server = createApp(new ContainerManager(), undefined, new Auth(store)).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'content-type': 'application/json', 'x-gateway-request': '1' };
    const credentials = { name: 'Test Operator', email: 'operator@example.test', password: 'gateway-test-password-only' };
    try {
        assert.equal((await fetch(`${base}/containers`)).status, 401);
        assert.equal((await fetch(`${base}/auth/status`).then((response) => response.json())).setupRequired, true);
        const setup = await fetch(`${base}/auth/setup`, { method: 'POST', headers, body: JSON.stringify(credentials) });
        assert.equal(setup.status, 200);
        const setCookie = setup.headers.get('set-cookie');
        assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/);
        let cookie = setCookie.split(';')[0];
        assert.equal((await fetch(`${base}/containers`, { headers: { cookie } })).status, 200);
        assert.equal((await fetch(`${base}/auth/setup`, { method: 'POST', headers, body: JSON.stringify(credentials) })).status, 409);
        assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } })).status, 403);
        assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...headers, cookie, origin: 'https://untrusted.example' } })).status, 403);
        assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...headers, cookie } })).status, 204);
        assert.equal((await fetch(`${base}/containers`, { headers: { cookie } })).status, 401);
        assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers, body: JSON.stringify({ ...credentials, password: 'wrong' }) })).status, 401);
        const login = await fetch(`${base}/auth/login`, { method: 'POST', headers, body: JSON.stringify(credentials) });
        assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie } }).then((response) => response.json())).user.email, credentials.email);
        assert.ok([...store.sessions.keys()].every((key) => !cookie.includes(key)));
        for (const session of store.sessions.values()) session.expiresAt = new Date(0);
        assert.equal((await fetch(`${base}/containers`, { headers: { cookie } })).status, 401);
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
