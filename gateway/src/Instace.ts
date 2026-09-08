import { fork, type ChildProcess } from 'node:child_process';
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { config, root } from './config.js';
import { healthy, portAvailable } from './system.js';
import type { ManagedInstance } from './platform/types.js';

export class ServiceError extends Error {
    constructor(message: string, public status = 500) { super(message); }
}
export class Container {
    readonly kind = 'node';
    port = 0;
    state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' = 'starting';
    private child?: ChildProcess;
    private exited?: Promise<void>;
    constructor(public readonly name: string) {}
    snapshot() { return { name: this.name, port: this.port, state: this.state, pid: this.child?.pid }; }
    async start(port: number) {
        this.port = port;
        const directory = path.join(root, 'RunningContainers', String(port));
        await mkdir(path.dirname(directory), { recursive: true });
        await mkdir(directory);
        try {
            await cp(path.join(root, 'DefaultContainer'), directory, {
                recursive: true,
                filter: (source) => !['node_modules', '.git', '.env'].includes(path.basename(source))
                    && !path.basename(source).startsWith('.env.') && !path.basename(source).endsWith('.log'),
            });
            await writeFile(path.join(directory, '.env'), `PORT=${port}\nNAME=${this.name}\nHOST=127.0.0.1\n`);
            const child = fork(path.join(directory, 'index.js'), [], {
                cwd: directory, execArgv: [],
                env: { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, PORT: String(port), NAME: this.name, HOST: '127.0.0.1' },
                stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
            });
            this.child = child;
            let failure: Error | undefined;
            child.on('error', (error) => { failure = error; });
            this.exited = new Promise<void>((resolve) => child.once('exit', () => {
                this.state = this.state === 'stopping' ? 'stopped' : 'failed';
                resolve();
            }));
            for (let attempt = 0; attempt < 30; attempt++) {
                if (failure) throw failure;
                if (child.exitCode !== null || child.signalCode !== null) throw new Error('Service exited during startup');
                if (await healthy(port)) {
                    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Service exited during startup');
                    this.state = 'running';
                    return this.snapshot();
                }
                await delay(100);
            }
            throw new Error('Service readiness timed out');
        } catch (error) {
            await this.stop();
            this.state = 'failed';
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
    }
    async stop() {
        if (this.child?.pid && this.child.exitCode === null && this.child.signalCode === null) {
            this.state = 'stopping';
            this.child.kill('SIGTERM');
            await Promise.race([this.exited, delay(3000)]);
            if (this.child.exitCode === null && this.child.signalCode === null) {
                this.child.kill('SIGKILL');
                await this.exited;
            }
        }
        this.state = 'stopped';
    }
    async check() { return this.state === 'running' && await healthy(this.port); }
}
export class ContainerManager {
    readonly instances = new Map<string, ManagedInstance>();
    stopGuard?: (name: string) => void;
    private reserved = new Set<number>();
    private closing = false;
    async start(name: string) {
        if (this.closing) throw new ServiceError('Gateway is shutting down', 503);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new ServiceError('Invalid service name', 400);
        if (this.instances.has(name)) throw new ServiceError('Service already exists', 409);
        const instance = new Container(name);
        this.instances.set(name, instance);
        let selected: number | undefined;
        try {
            for (let port = config.startingPort; port < config.startingPort + config.maxContainers; port++) {
                if (port === config.port || this.reserved.has(port)) continue;
                this.reserved.add(port);
                // Preserve directories belonging to previous runs.
                let exists = false;
                try { await access(path.join(root, 'RunningContainers', String(port))); exists = true; } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                        this.reserved.delete(port);
                        throw error;
                    }
                }
                if (!exists && await portAvailable(port)) { selected = port; break; }
                this.reserved.delete(port);
            }
            if (selected === undefined) throw new ServiceError('No available service ports', 503);
            return await instance.start(selected);
        } catch (error) {
            if (selected !== undefined) this.reserved.delete(selected);
            this.instances.delete(name);
            throw error;
        }
    }
    async stop(name: string) {
        const instance = this.instances.get(name);
        if (!instance) throw new ServiceError('Service not found', 404);
        this.stopGuard?.(name);
        if (instance.state === 'starting' || instance.state === 'stopping') throw new ServiceError('Service is busy', 409);
        await instance.stop();
        if (instance.kind !== 'docker') await rm(path.join(root, 'RunningContainers', String(instance.port)), { recursive: true, force: true });
        this.instances.delete(name);
        this.reserved.delete(instance.port);
    }
    async shutdown() {
        this.closing = true;
        while ([...this.instances.values()].some((instance) => instance.state === 'starting')) await delay(100);
        this.stopGuard = undefined;
        await Promise.all([...this.instances.values()].filter((instance) => instance.kind !== 'docker').map((instance) => this.stop(instance.name)));
    }
}
