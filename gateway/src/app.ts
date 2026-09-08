import express, { type ErrorRequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { ContainerManager, ServiceError } from './Instace.js';
import { forward } from './proxy.js';
import type { Platform } from './platform/index.js';
import { platformApi } from './platform/api.js';
import type { Auth } from './auth.js';
export function createApp(manager: ContainerManager, platform?: Platform, auth?: Auth) {
    const app = express();
    app.disable('x-powered-by');
    app.get('/health', (_req, res) => res.json({ ok: true }));
    if (auth) app.use('/auth', auth.routes());
    if (platform) {
        app.post('/webhooks/github', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
            if (!Buffer.isBuffer(req.body)) throw new ServiceError('Webhook body must be JSON', 400);
            res.status(202).json(platform.webhook(req.get('x-github-delivery') || '', req.get('x-github-event') || '', req.body, req.get('x-hub-signature-256')));
        });
        app.use((req, res, next) => {
            const route = platform.routing.resolve(req.hostname, req.path);
            if (!route) { next(); return; }
            const lease = platform.routing.acquire(route.target);
            const suffix = route.stripPrefix ? req.url.slice(route.path.length) : req.url;
            const upstreamPath = !suffix || suffix.startsWith('?') ? `/${suffix}` : suffix;
            forward(req, res, lease.instance.port, upstreamPath, lease.release);
        });
    }
    app.use(async (req, res, next) => {
        const supplied = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${config.managementToken}`);
        const machine = !!config.managementToken && supplied.length === expected.length && timingSafeEqual(supplied, expected);
        if (!machine) {
            if (!auth || !await auth.user(req)) { res.status(401).json({ error: 'Unauthorized' }); return; }
            auth.assertSameOrigin(req);
        }
        next();
    });
    app.use('/services/:name', (req, res) => {
        const instance = manager.instances.get(req.params.name);
        if (!instance || instance.state !== 'running') { res.status(503).json({ error: 'Service unavailable' }); return; }
        const lease = platform?.routing.acquire(instance.name);
        forward(req, res, instance.port, req.url, lease?.release, true);
    });
    app.use(express.json({ limit: '128kb' }));
    if (platform) app.use(platformApi(platform));
    app.get(['/', '/containers'], (_req, res) => res.json({ containers: [...manager.instances.values()].map((instance) => ({ ...instance.snapshot(), kind: instance.kind || 'node', activeRequests: platform?.routing.active(instance.name) || 0, draining: platform?.routing.isDraining(instance.name) || false, routes: platform?.routing.references(instance.name).map((route) => route.path) || [] })) }));
    app.post('/containers', async (req, res) => {
        if (typeof req.body?.name !== 'string') throw new ServiceError('name is required', 400);
        res.status(201).json(await manager.start(req.body.name));
    });
    app.delete('/containers/:name', async (req, res) => {
        if (platform) await platform.retire(req.params.name); else await manager.stop(req.params.name);
        res.sendStatus(204);
    });
    app.get('/containers/:name/health', async (req, res) => {
        const instance = manager.instances.get(req.params.name);
        if (!instance) throw new ServiceError('Service not found', 404);
        const ok = await instance.check();
        res.status(ok ? 200 : 503).json({ ok });
    });
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
        const status = error instanceof ServiceError ? error.status : [400, 413].includes(error.status) ? error.status : 500;
        if (status === 500) console.error(error);
        res.status(status).json({ error: status === 500 ? 'Internal server error' : error.message });
    };
    app.use(errors);
    return app;
}
