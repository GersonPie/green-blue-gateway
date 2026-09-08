import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ServiceError, type ContainerManager } from '../Instace.js';
import { root } from '../config.js';
import { Store } from './store.js';
import { Routing } from './routing.js';
import { GitHub } from './github.js';
import { DockerRuntime } from './docker.js';
import type { Deployment, ManagedInstance, Project } from './types.js';

export interface DeploymentRuntime {
    status(): Promise<{ available: boolean; message: string }>;
    build(project: Project, deployment: Deployment, log: (text: string) => void, signal: AbortSignal): Promise<string>;
    start(project: Project, deployment: Deployment, environment: Record<string, string>, log: (text: string) => void, signal: AbortSignal): Promise<ManagedInstance>;
    restore(project: Project, deployment: Deployment): Promise<ManagedInstance | undefined>;
    remove(deployment: Deployment): Promise<void>;
    logs(deployment: Deployment): Promise<string>;
}

export class Platform {
    readonly store: Store;
    readonly routing: Routing;
    readonly github: GitHub;
    private runtime: DeploymentRuntime;
    private working?: Promise<void>;
    private closing = false;
    private abort = new AbortController();
    constructor(readonly manager: ContainerManager, options: { directory?: string; github?: GitHub; runtime?: DeploymentRuntime } = {}) {
        this.store = new Store(options.directory || process.env.GATEWAY_DATA_DIR || path.join(root, 'data'));
        this.github = options.github || new GitHub();
        this.runtime = options.runtime || new DockerRuntime(this.store.directory, this.store.workspaceId, this.github);
        this.routing = new Routing(this.store, manager);
    }
    async initialize() {
        for (const deployment of this.store.deployments()) {
            if (['ready', 'starting', 'unavailable'].includes(deployment.state)) {
                try {
                    const instance = await this.runtime.restore(deployment.configuration, deployment);
                    if (instance && await instance.check()) {
                        this.manager.instances.set(instance.name, instance);
                        this.state(deployment, 'ready');
                    } else this.state(deployment, 'unavailable', 'Runtime unavailable; restore Docker and restart the gateway to reconcile');
                } catch { this.state(deployment, 'unavailable', 'Could not reconcile the deployment runtime'); }
            } else if (deployment.state === 'building') this.state(deployment, 'failed', 'Build was interrupted by a gateway restart');
        }
        this.kick();
    }
    projects() { return this.store.projects().map((project) => ({ ...project, environmentKeys: Object.keys(this.store.environment(project.id)) })); }
    project(id: string) {
        const project = this.store.projects().find((item) => item.id === id);
        if (!project) throw new ServiceError('Project not found', 404);
        return project;
    }
    saveProject(input: Record<string, unknown>, id?: string) {
        const current = id ? this.project(id) : undefined;
        const values: Record<string, unknown> = { ...current, ...input };
        const name = String(values.name || '').trim();
        let repository = String(values.repository || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new ServiceError('Invalid project name', 400);
        if (this.store.projects().some((project) => project.name === name && project.id !== id)) throw new ServiceError('Project name already exists', 409);
        if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || repository.split('/').some((part) => part === '.' || part === '..')) throw new ServiceError('Use a GitHub owner/repository name', 400);
        repository = repository.toLowerCase();
        const branch = String(values.branch || 'main');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,199}$/.test(branch) || branch.includes('..')) throw new ServiceError('Invalid branch', 400);
        const relativePath = (value: unknown, fallback: string) => {
            const result = String(value || fallback);
            if (result !== '.' && (!/^[a-zA-Z0-9_./-]+$/.test(result) || result.startsWith('/') || result.split('/').some((part) => part === '..'))) throw new ServiceError('Build paths must stay inside the repository', 400);
            return result;
        };
        const containerPort = Number(values.containerPort || 3000);
        if (!Number.isInteger(containerPort) || containerPort < 1024 || containerPort > 65535) throw new ServiceError('Container port must be between 1024 and 65535', 400);
        const healthPath = String(values.healthPath || '/health');
        if (!/^\/[a-zA-Z0-9/_-]*$/.test(healthPath) || healthPath.startsWith('//')) throw new ServiceError('Invalid health-check path', 400);
        for (const key of ['autoDeploy', 'autoPromote']) if (values[key] !== undefined && typeof values[key] !== 'boolean') throw new ServiceError(`${key} must be boolean`, 400);
        let environment: Record<string, string> | undefined;
        if (input.environment !== undefined) {
            if (!input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) throw new ServiceError('Environment must be a JSON object', 400);
            environment = {};
            for (const [key, value] of Object.entries(input.environment)) {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 8192) throw new ServiceError('Environment values must be single-line strings with valid variable names', 400);
                if (['PORT', 'HOST', 'MANAGEMENT_TOKEN', 'GITHUB_WEBHOOK_SECRET'].includes(key)) throw new ServiceError(`${key} is managed by the gateway`, 400);
                environment[key] = value;
            }
            if (Object.keys(environment).length > 100) throw new ServiceError('Too many environment variables', 400);
        }
        const project: Project = { id: current?.id || randomUUID(), name, repository, branch, context: relativePath(values.context, '.'), dockerfile: relativePath(values.dockerfile, 'Dockerfile'), containerPort, healthPath, autoDeploy: values.autoDeploy === true, autoPromote: values.autoPromote === true, createdAt: current?.createdAt || new Date().toISOString() };
        this.store.saveProject(project, environment ?? (current ? undefined : {}));
        return { ...project, environmentKeys: Object.keys(this.store.environment(project.id)) };
    }
    deployment(id: string) {
        const deployment = this.store.deployments().find((item) => item.id === id);
        if (!deployment) throw new ServiceError('Deployment not found', 404);
        return deployment;
    }
    async deploy(id: string, ref?: unknown) {
        if (this.closing) throw new ServiceError('Gateway is shutting down', 503);
        const project = this.project(id);
        if (ref !== undefined && (typeof ref !== 'string' || ref.length > 200 || !ref.length)) throw new ServiceError('Invalid Git revision', 400);
        const status = await this.runtime.status();
        if (!status.available) throw new ServiceError(status.message, 503);
        const commit = await this.github.resolve(project.repository, typeof ref === 'string' ? ref : project.branch);
        const deployment = this.store.transaction(() => this.enqueue(project, commit));
        this.kick();
        return deployment;
    }
    private enqueue(project: Project, commit: string) {
        if (this.store.deployments().filter((deployment) => ['queued', 'building', 'starting'].includes(deployment.state)).length >= 50) throw new ServiceError('Deployment queue is full', 429);
        const id = randomUUID();
        const now = new Date().toISOString();
        const deployment: Deployment = { id, projectId: project.id, configuration: project, commit, instanceName: `${project.name.slice(0, 40)}-${id.slice(0, 8)}`, state: 'queued', createdAt: now, updatedAt: now };
        this.store.saveDeployment(deployment);
        this.store.freezeEnvironment(id, this.store.environment(project.id));
        this.store.log(id, 'Deployment queued');
        return deployment;
    }
    webhook(delivery: string, event: string, body: Buffer, signature: string | undefined) {
        if (!this.github.verify(body, signature)) throw new ServiceError('Invalid webhook signature', 401);
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(delivery)) throw new ServiceError('Missing or invalid delivery ID', 400);
        let payload: { repository?: { full_name?: string }; ref?: string; after?: string; deleted?: boolean };
        try { payload = JSON.parse(body.toString('utf8')); } catch { throw new ServiceError('Invalid webhook payload', 400); }
        const result = this.store.transaction(() => {
            if (!this.store.acceptDelivery(delivery)) return { duplicate: true, queued: 0 };
            if (event !== 'push' || payload.deleted) return { duplicate: false, queued: 0 };
            if (!payload.after || !/^[a-f0-9]{40}$/.test(payload.after)) throw new ServiceError('Invalid webhook commit', 400);
            const projects = this.store.projects().filter((project) => project.autoDeploy && project.repository === payload.repository?.full_name?.toLowerCase() && payload.ref === `refs/heads/${project.branch}`);
            for (const project of projects) this.enqueue(project, payload.after);
            return { duplicate: false, queued: projects.length };
        });
        this.kick();
        return result;
    }
    private kick() {
        if (this.working || this.closing) return;
        this.working = this.work().catch((error) => console.error('Deployment worker failed', error)).finally(() => { this.working = undefined; });
    }
    private state(deployment: Deployment, state: Deployment['state'], error?: string) {
        deployment.state = state; deployment.error = error; deployment.updatedAt = new Date().toISOString(); this.store.saveDeployment(deployment);
    }
    private async work() {
        while (!this.closing) {
            const deployment = this.store.deployments().reverse().find((item) => item.state === 'queued');
            if (!deployment) return;
            const project = deployment.configuration;
            const environment = this.store.deploymentEnvironment(deployment.id);
            const redact = (text: string) => {
                for (const secret of Object.values(environment)) if (secret) text = text.replaceAll(secret, '[REDACTED]');
                return text;
            };
            const log = (text: string) => this.store.log(deployment.id, redact(text));
            try {
                const status = await this.runtime.status();
                if (!status.available) throw new Error(status.message);
                this.state(deployment, 'building');
                deployment.imageId = await this.runtime.build(project, deployment, log, this.abort.signal);
                this.state(deployment, 'starting');
                if (this.manager.instances.size >= 100) throw new Error('Instance limit reached');
                const instance = await this.runtime.start(project, deployment, environment, log, this.abort.signal);
                this.manager.instances.set(instance.name, instance);
                this.state(deployment, 'ready');
                log('Ready for promotion');
            } catch (error) {
                const message = redact((error as Error).message);
                this.state(deployment, 'failed', message); log(message); continue;
            }
            if (this.project(project.id).autoPromote) {
                try {
                    const latest = this.store.deployments().find((item) => item.projectId === project.id);
                    if (latest?.id !== deployment.id || await this.github.resolve(project.repository, project.branch) !== deployment.commit) { log('Automatic promotion skipped: a newer revision exists'); continue; }
                    const names = new Set(this.store.deployments().filter((item) => item.projectId === project.id).map((item) => item.instanceName));
                    const routes = this.routing.list().filter((item) => names.has(item.target));
                    await this.routing.promoteMany(routes.map((route) => ({ id: route.id, target: deployment.instanceName, expectedVersion: route.version })));
                    for (const route of routes) log(`Promoted route ${route.path}`);
                } catch (error) { log(`Automatic promotion did not complete: ${(error as Error).message}`); }
            }
        }
    }
    async retire(name: string) {
        await this.routing.retire(name);
        const deployment = this.store.deployments().find((item) => item.instanceName === name);
        if (deployment) this.state(deployment, 'stopped');
    }
    async status() { return { github: { configured: this.github.configured, webhooks: this.github.webhookConfigured }, docker: await this.runtime.status(), routing: 'single-process', workspaceId: this.store.workspaceId }; }
    async logs(id: string, runtime = false) {
        const deployment = this.deployment(id);
        if (runtime) {
            let text = await this.runtime.logs(deployment);
            for (const value of Object.values(this.store.deploymentEnvironment(id))) if (value) text = text.replaceAll(value, '[REDACTED]');
            return [{ id: 0, text, createdAt: new Date().toISOString() }];
        }
        return this.store.logs(id);
    }
    async shutdown() {
        this.closing = true;
        this.abort.abort();
        await this.working;
        this.store.close();
    }
}
