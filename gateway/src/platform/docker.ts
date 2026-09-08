import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command, commandEnvironment, type Command } from './command.js';
import type { Deployment, ManagedInstance, Project } from './types.js';
import type { GitHub } from './github.js';

type Inspection = { Id: string; Image: string; State: { Running: boolean }; Config: { Labels?: Record<string, string> }; NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> } };
export class DockerRuntime {
    constructor(private directory: string, private workspaceId: string, private github: GitHub, private execute: Command = command) {}
    async status() {
        try { await this.execute('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 5000 }); return { available: true, message: 'Docker is ready' }; }
        catch { return { available: false, message: 'Docker is unavailable. Start Docker with Linux containers to deploy repositories.' }; }
    }
    private name(deployment: Deployment) { return `gateway-${deployment.id}`; }
    async build(project: Project, deployment: Deployment, log: (text: string) => void, signal: AbortSignal) {
        const work = path.join(this.directory, 'builds', deployment.id);
        const source = path.join(work, 'source');
        const context = path.join(work, 'context');
        await mkdir(source, { recursive: true });
        const gitEnv = { ...commandEnvironment(), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
        const token = await this.github.token();
        const environment: NodeJS.ProcessEnv = token ? { ...gitEnv, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` } : gitEnv;
        const git = (args: string[]) => this.execute('git', args, { cwd: source, env: environment, timeout: 120000, signal, log });
        try {
            log(`Checking out ${project.repository}@${deployment.commit}`);
            await git(['init', '--quiet']);
            await git(['remote', 'add', 'origin', `https://github.com/${project.repository}.git`]);
            await git(['-c', 'protocol.file.allow=never', 'fetch', '--depth=1', 'origin', deployment.commit]);
            await git(['checkout', '--detach', 'FETCH_HEAD']);
            const actual = await git(['rev-parse', 'HEAD']);
            if (actual !== deployment.commit) throw new Error('Checked-out commit does not match the requested revision');
            const selected = await realpath(path.join(source, project.context));
            const sourceRoot = await realpath(source);
            if (selected !== sourceRoot && !selected.startsWith(sourceRoot + path.sep)) throw new Error('Build context escapes the repository');
            await cp(selected, context, { recursive: true, filter: (entry) => {
                const name = path.basename(entry);
                return !['.git', 'node_modules', '.env'].includes(name) && !name.startsWith('.env.') && !name.endsWith('.log');
            } });
            const dockerfile = await realpath(path.join(context, project.dockerfile));
            const contextRoot = await realpath(context);
            if (!dockerfile.startsWith(contextRoot + path.sep)) throw new Error('Dockerfile must be inside the build context');
            const iid = path.join(work, 'image-id');
            await this.execute('docker', ['build', '--file', dockerfile, '--tag', `gateway-deployment:${deployment.id}`, '--iidfile', iid, context], { timeout: 900000, signal, log });
            const imageId = (await readFile(iid, 'utf8')).trim();
            if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Docker did not produce an immutable image ID');
            return imageId;
        } finally { await rm(work, { recursive: true, force: true }); }
    }
    async start(project: Project, deployment: Deployment, environment: Record<string, string>, log: (text: string) => void, signal: AbortSignal) {
        if (!deployment.imageId || !/^sha256:[a-f0-9]{64}$/.test(deployment.imageId)) throw new Error('Missing deployment image');
        const envFile = path.join(this.directory, `${deployment.id}.env`);
        await writeFile(envFile, Object.entries({ ...environment, PORT: String(project.containerPort), HOST: '0.0.0.0' }).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
        try {
            await this.execute('docker', ['run', '--detach', '--name', this.name(deployment), '--label', `gateway.workspace=${this.workspaceId}`, '--label', `gateway.deployment=${deployment.id}`, '--publish', `127.0.0.1::${project.containerPort}`, '--env-file', envFile, '--user', '1000:1000', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=512m', '--cpus=1', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--restart=unless-stopped', deployment.imageId], { signal });
            const instance = await this.restore(project, deployment);
            if (!instance) throw new Error('Container did not start');
            for (let attempt = 0; attempt < 60; attempt++) {
                signal.throwIfAborted();
                if (await instance.check()) { log('Readiness check passed'); return instance; }
                await delay(500, undefined, { signal });
            }
            throw new Error('Container readiness timed out');
        } catch (error) {
            try { log(await this.logs(deployment)); } catch {}
            await this.remove(deployment);
            throw error;
        } finally { await rm(envFile, { force: true }); }
    }
    async restore(project: Project, deployment: Deployment): Promise<ManagedInstance | undefined> {
        let inspection: Inspection;
        try { inspection = JSON.parse(await this.execute('docker', ['inspect', this.name(deployment), '--format', '{{json .}}'], { timeout: 5000 })); }
        catch { return undefined; }
        if (inspection.Config.Labels?.['gateway.workspace'] !== this.workspaceId || inspection.Config.Labels?.['gateway.deployment'] !== deployment.id || inspection.Image !== deployment.imageId) throw new Error('Container ownership or image mismatch');
        const binding = inspection.NetworkSettings.Ports[`${project.containerPort}/tcp`]?.find((item) => item.HostIp === '127.0.0.1');
        if (!inspection.State.Running || !binding) return undefined;
        const port = Number(binding.HostPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid container port');
        const runtime = this;
        const instance: ManagedInstance = {
            name: deployment.instanceName, port, state: 'running', kind: 'docker',
            snapshot() { return { name: this.name, port: this.port, state: this.state, kind: 'docker', deploymentId: deployment.id }; },
            async check() {
                try {
                    const response = await fetch(`http://127.0.0.1:${port}${project.healthPath}`, { signal: AbortSignal.timeout(1000) });
                    await response.body?.cancel();
                    return response.ok;
                } catch { return false; }
            },
            async stop() { this.state = 'stopping'; try { await runtime.remove(deployment); this.state = 'stopped'; } catch (error) { this.state = 'running'; throw error; } },
        };
        return instance;
    }
    async remove(deployment: Deployment) {
        let inspection: Inspection;
        try { inspection = JSON.parse(await this.execute('docker', ['inspect', this.name(deployment), '--format', '{{json .}}'], { timeout: 5000 })); }
        catch (error) {
            if (/No such (object|container)/i.test((error as Error).message)) return;
            throw error;
        }
        if (inspection.Config.Labels?.['gateway.workspace'] !== this.workspaceId || inspection.Config.Labels?.['gateway.deployment'] !== deployment.id) throw new Error('Refusing to remove a container owned by another workspace');
        await this.execute('docker', ['stop', '--time', '30', this.name(deployment)], { timeout: 35000 });
        await this.execute('docker', ['rm', this.name(deployment)]);
    }
    async logs(deployment: Deployment) { return this.execute('docker', ['logs', '--tail', '100', this.name(deployment)], { mergeOutput: true }); }
}
