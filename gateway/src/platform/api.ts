import express from 'express';
import type { Platform } from './index.js';
import { ServiceError } from '../Instace.js';
export function platformApi(platform: Platform) {
    const api = express.Router();
    api.get('/platform/status', async (_req, res) => res.json(await platform.status()));
    api.get('/github/repositories', async (_req, res) => res.json({ repositories: await platform.github.repositories() }));
    api.get('/projects', (_req, res) => res.json({ projects: platform.projects() }));
    api.post('/projects', (req, res) => res.status(201).json(platform.saveProject(req.body || {})));
    api.patch('/projects/:id', (req, res) => res.json(platform.saveProject(req.body || {}, req.params.id)));
    api.get('/deployments', (_req, res) => res.json({ deployments: platform.store.deployments() }));
    api.post('/projects/:id/deployments', async (req, res) => res.status(202).json(await platform.deploy(req.params.id, req.body?.ref)));
    api.get('/deployments/:id/logs', async (req, res) => res.json({ logs: await platform.logs(req.params.id, req.query.runtime === 'true') }));
    api.get('/routes', (_req, res) => res.json({ routes: platform.routing.list() }));
    api.post('/routes', async (req, res) => res.status(201).json(await platform.routing.create(req.body || {})));
    api.post('/routes/:id/promote', async (req, res) => {
        if (typeof req.body?.target !== 'string') throw new ServiceError('Target instance is required', 400);
        res.json(await platform.routing.promote(req.params.id, req.body.target, req.body.expectedVersion));
    });
    api.post('/routes/:id/rollback', async (req, res) => res.json(await platform.routing.rollback(req.params.id, req.body?.expectedVersion)));
    api.get('/routes/:id/history', (req, res) => res.json({ history: platform.store.history(req.params.id) }));
    api.delete('/routes/:id', (req, res) => { platform.routing.remove(req.params.id, req.body?.expectedVersion); res.sendStatus(204); });
    return api;
}
