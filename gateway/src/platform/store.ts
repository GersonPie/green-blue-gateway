import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Deployment, Project, Route } from './types.js';

export class Store {
    private db: DatabaseSync;
    private key: Buffer;
    private lock: string;
    readonly workspaceId: string;
    constructor(readonly directory: string) {
        mkdirSync(directory, { recursive: true });
        this.lock = path.join(directory, 'owner.lock');
        try { closeSync(openSync(this.lock, 'wx')); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const pid = Number(readFileSync(this.lock, 'utf8'));
            let alive = true;
            try { process.kill(pid, 0); } catch (check) {
                if ((check as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
            }
            if (!pid || alive) throw new Error('This data directory is already in use');
            unlinkSync(this.lock);
            closeSync(openSync(this.lock, 'wx'));
        }
        writeFileSync(this.lock, String(process.pid));
        try {
            const keyPath = path.join(directory, 'secrets.key');
            try { this.key = readFileSync(keyPath); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                this.key = randomBytes(32);
                writeFileSync(keyPath, this.key, { mode: 0o600, flag: 'wx' });
            }
            if (this.key.length !== 32) throw new Error('Invalid secrets key');
            this.db = new DatabaseSync(path.join(directory, 'gateway.sqlite'));
            this.db.exec(`PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL, secrets TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deployment_secrets (id TEXT PRIMARY KEY, secrets TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, hostname TEXT NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(hostname, path));
                CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY, route_id TEXT NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, deployment_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, received_at TEXT NOT NULL);`);
            const workspace = this.db.prepare('SELECT value FROM settings WHERE id = ?').get('workspace');
            this.workspaceId = workspace ? String(workspace.value) : randomUUID();
            this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('workspace', this.workspaceId);
        } catch (error) { unlinkSync(this.lock); throw error; }
    }
    transaction<T>(operation: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try { const value = operation(); this.db.exec('COMMIT'); return value; }
        catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    projects(): Project[] { return this.db.prepare('SELECT data FROM projects ORDER BY rowid').all().map((row) => JSON.parse(String(row.data))); }
    saveProject(project: Project, environment?: Record<string, string>) {
        const secrets = environment === undefined ? undefined : this.encrypt(environment);
        if (secrets === undefined) this.db.prepare('UPDATE projects SET data = ? WHERE id = ?').run(JSON.stringify(project), project.id);
        else this.db.prepare('INSERT INTO projects VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, secrets = excluded.secrets').run(project.id, JSON.stringify(project), secrets);
    }
    environment(id: string): Record<string, string> {
        const row = this.db.prepare('SELECT secrets FROM projects WHERE id = ?').get(id);
        if (!row) return {};
        return this.decrypt(String(row.secrets));
    }
    freezeEnvironment(id: string, environment: Record<string, string>) { this.db.prepare('INSERT INTO deployment_secrets VALUES (?, ?)').run(id, this.encrypt(environment)); }
    deploymentEnvironment(id: string) {
        const row = this.db.prepare('SELECT secrets FROM deployment_secrets WHERE id = ?').get(id);
        return row ? this.decrypt(String(row.secrets)) : {};
    }
    private decrypt(value: string): Record<string, string> {
        const [iv, tag, body] = value.split('.').map((part) => Buffer.from(part, 'base64'));
        const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
        decipher.setAuthTag(tag!);
        return JSON.parse(Buffer.concat([decipher.update(body!), decipher.final()]).toString());
    }
    private encrypt(environment: Record<string, string>) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const body = Buffer.concat([cipher.update(JSON.stringify(environment)), cipher.final()]);
        return [iv, cipher.getAuthTag(), body].map((value) => value.toString('base64')).join('.');
    }
    deployments(): Deployment[] { return this.db.prepare('SELECT data FROM deployments ORDER BY rowid DESC').all().map((row) => JSON.parse(String(row.data))); }
    saveDeployment(deployment: Deployment) { this.db.prepare('INSERT INTO deployments VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(deployment.id, JSON.stringify(deployment)); }
    routes(): Route[] { return this.db.prepare('SELECT data FROM routes ORDER BY rowid').all().map((row) => JSON.parse(String(row.data))); }
    saveRoute(route: Route) { this.db.prepare('INSERT INTO routes VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(route.id, route.hostname, route.path, JSON.stringify(route)); }
    deleteRoute(id: string) { this.db.prepare('DELETE FROM routes WHERE id = ?').run(id); }
    history(id: string) { return this.db.prepare('SELECT data FROM history WHERE route_id = ? ORDER BY id DESC LIMIT 100').all(id).map((row) => JSON.parse(String(row.data))); }
    recordRoute(route: Route, from: string | null, action: string) {
        this.db.prepare('INSERT INTO history(route_id, data) VALUES (?, ?)').run(route.id, JSON.stringify({ action, from, target: route.target, version: route.version, createdAt: route.updatedAt }));
    }
    log(id: string, text: string) {
        this.db.prepare('INSERT INTO logs(deployment_id, text, created_at) VALUES (?, ?, ?)').run(id, text.slice(0, 4000), new Date().toISOString());
        this.db.prepare('DELETE FROM logs WHERE deployment_id = ? AND id NOT IN (SELECT id FROM logs WHERE deployment_id = ? ORDER BY id DESC LIMIT 500)').run(id, id);
    }
    logs(id: string) { return this.db.prepare('SELECT id, text, created_at AS createdAt FROM logs WHERE deployment_id = ? ORDER BY id').all(id); }
    acceptDelivery(id: string) { return this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES (?, ?)').run(id, new Date().toISOString()).changes === 1; }
    close() { this.db.close(); unlinkSync(this.lock); }
}
