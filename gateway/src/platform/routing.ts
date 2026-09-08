import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ServiceError, type ContainerManager } from '../Instace.js';
import type { Store } from './store.js';
import type { Route, ManagedInstance } from './types.js';

const reserved = new Set(['auth', 'health', 'containers', 'services', 'projects', 'deployments', 'routes', 'github', 'webhooks', 'platform']);
export class Routing {
    private routes = new Map<string, Route>();
    private requests = new Map<string, number>();
    private draining = new Set<string>();
    constructor(private store: Store, private manager: ContainerManager) {
        for (const route of store.routes()) this.routes.set(route.id, route);
        manager.stopGuard = (name) => {
            if (this.references(name).length || this.active(name)) throw new ServiceError('Instance has routes or active requests; drain it first', 409);
        };
    }
    list() { return [...this.routes.values()]; }
    active(name: string) { return this.requests.get(name) || 0; }
    isDraining(name: string) { return this.draining.has(name); }
    references(name: string) { return this.list().filter((route) => route.target === name); }
    resolve(host: string, pathname: string) {
        return this.list().filter((route) => (route.hostname === '*' || route.hostname === host.toLowerCase()) && (pathname === route.path || pathname.startsWith(`${route.path}/`)))
            .sort((a, b) => Number(b.hostname !== '*') - Number(a.hostname !== '*') || b.path.length - a.path.length)[0];
    }
    async create(input: { hostname?: unknown; path?: unknown; target?: unknown; stripPrefix?: unknown }) {
        const hostname = typeof input.hostname === 'string' ? input.hostname.trim().toLowerCase() : '*';
        if (hostname !== '*' && (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(hostname) || hostname.includes('..'))) throw new ServiceError('Invalid hostname', 400);
        if (typeof input.path !== 'string' || !/^\/[a-zA-Z0-9/_-]+$/.test(input.path) || input.path.includes('//')) throw new ServiceError('Use a non-root URL path containing letters, digits, slashes, underscores or hyphens', 400);
        const routePath = input.path.replace(/\/$/, '');
        if (reserved.has(routePath.split('/')[1]!)) throw new ServiceError('This prefix is reserved for gateway management', 400);
        if (typeof input.target !== 'string') throw new ServiceError('A target instance is required', 400);
        if (input.stripPrefix !== undefined && typeof input.stripPrefix !== 'boolean') throw new ServiceError('stripPrefix must be boolean', 400);
        await this.ready(input.target);
        if (this.list().some((route) => route.hostname === hostname && route.path === routePath)) throw new ServiceError('Route already exists', 409);
        this.available(input.target);
        const route: Route = { id: randomUUID(), hostname, path: routePath, target: input.target, previousTarget: null, stripPrefix: input.stripPrefix !== false, version: 1, updatedAt: new Date().toISOString() };
        this.store.transaction(() => { this.store.saveRoute(route); this.store.recordRoute(route, null, 'created'); });
        this.routes.set(route.id, route);
        return route;
    }
    async promote(id: string, target: string, expectedVersion: number, action = 'promoted') {
        return (await this.promoteMany([{ id, target, expectedVersion }], action))[0]!;
    }
    async promoteMany(updates: { id: string; target: string; expectedVersion: number }[], action = 'promoted') {
        if (new Set(updates.map((update) => update.id)).size !== updates.length) throw new ServiceError('Duplicate route in promotion', 400);
        for (const update of updates) this.version(update.id, update.expectedVersion);
        await Promise.all([...new Set(updates.map((update) => update.target))].map((target) => this.ready(target)));
        // Health checks yield. Validate every version again, then persist and publish as one change.
        const next = updates.map(({ id, target, expectedVersion }) => {
            const current = this.version(id, expectedVersion);
            this.available(target);
            if (target === current.target) throw new ServiceError('This instance is already active', 409);
            return { ...current, previousTarget: current.target, target, version: current.version + 1, updatedAt: new Date().toISOString() };
        });
        this.store.transaction(() => { for (const route of next) { this.store.saveRoute(route); this.store.recordRoute(route, route.previousTarget, action); } });
        for (const route of next) this.routes.set(route.id, route);
        return next;
    }
    async rollback(id: string, expectedVersion: number) {
        const current = this.version(id, expectedVersion);
        if (!current.previousTarget) throw new ServiceError('No previous target is available', 409);
        return this.promote(id, current.previousTarget, expectedVersion, 'rolled back');
    }
    remove(id: string, expectedVersion: number) {
        const current = this.version(id, expectedVersion);
        this.store.transaction(() => { this.store.deleteRoute(id); this.store.recordRoute(current, current.target, 'deleted'); });
        this.routes.delete(id);
    }
    private version(id: string, version: number) {
        const route = this.routes.get(id);
        if (!route) throw new ServiceError('Route not found', 404);
        if (!Number.isInteger(version) || route.version !== version) throw new ServiceError('Route changed; refresh before trying again', 409);
        return route;
    }
    private available(name: string): ManagedInstance {
        const instance = this.manager.instances.get(name);
        if (!instance || instance.state !== 'running' || this.draining.has(name)) throw new ServiceError('Target instance is not available', 503);
        return instance;
    }
    private async ready(name: string) {
        if (!await this.available(name).check()) throw new ServiceError('Target failed its readiness check', 503);
    }
    acquire(name: string) {
        const instance = this.available(name);
        this.requests.set(name, this.active(name) + 1);
        let released = false;
        return { instance, release: () => {
            if (released) return;
            released = true;
            const count = this.active(name) - 1;
            if (count) this.requests.set(name, count); else this.requests.delete(name);
        } };
    }
    async retire(name: string, timeout = 30000) {
        if (this.references(name).length) throw new ServiceError('Switch or delete routes before stopping this instance', 409);
        if (!this.manager.instances.has(name)) throw new ServiceError('Instance not found', 404);
        this.draining.add(name);
        const deadline = Date.now() + timeout;
        while (this.active(name)) {
            if (Date.now() >= deadline) throw new ServiceError('Drain timed out; existing requests were preserved. Retry once they finish.', 409);
            await delay(20);
        }
        try { await this.manager.stop(name); } finally { this.draining.delete(name); }
    }
}
