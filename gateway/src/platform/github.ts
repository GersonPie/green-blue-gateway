import { createHmac, createPrivateKey, sign, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ServiceError } from '../Instace.js';

export class GitHub {
    private cached?: { value: string; expires: number };
    private pending?: Promise<string>;
    get configured() { return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_INSTALLATION_ID && process.env.GITHUB_PRIVATE_KEY_PATH); }
    get webhookConfigured() { return !!process.env.GITHUB_WEBHOOK_SECRET; }
    async token(): Promise<string | undefined> {
        if (!this.configured) return undefined;
        if (this.cached && this.cached.expires > Date.now() + 60000) return this.cached.value;
        if (this.pending) return this.pending;
        this.pending = this.installationToken();
        try { return await this.pending; } finally { this.pending = undefined; }
    }
    private async installationToken() {
        const issued = Math.floor(Date.now() / 1000) - 60;
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ iat: issued, exp: issued + 600, iss: process.env.GITHUB_APP_ID })).toString('base64url');
        const message = `${header}.${payload}`;
        const key = createPrivateKey(await readFile(process.env.GITHUB_PRIVATE_KEY_PATH!, 'utf8'));
        const jwt = `${message}.${sign('RSA-SHA256', Buffer.from(message), key).toString('base64url')}`;
        const id = process.env.GITHUB_INSTALLATION_ID!;
        if (!/^\d+$/.test(id)) throw new ServiceError('Invalid GitHub installation ID', 503);
        const result = await this.request(`/app/installations/${id}/access_tokens`, jwt, { method: 'POST', body: JSON.stringify({ permissions: { contents: 'read' } }) }) as { token: string; expires_at: string };
        this.cached = { value: result.token, expires: Date.parse(result.expires_at) };
        return result.token;
    }
    private async request(route: string, token?: string, init?: RequestInit): Promise<unknown> {
        const response = await fetch(`https://api.github.com${route}`, {
            ...init,
            signal: AbortSignal.timeout(15000),
            headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'gateway-deployments', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new ServiceError(response.status === 404 ? 'Repository or revision not found; check the GitHub App repository access' : `GitHub request failed (${response.status})`, 502);
        }
        return response.json();
    }
    async repositories() {
        const token = await this.token();
        if (!token) return [];
        const repositories: { full_name: string; private: boolean; default_branch: string }[] = [];
        for (let page = 1; page <= 20; page++) {
            const result = await this.request(`/installation/repositories?per_page=100&page=${page}`, token) as { repositories: typeof repositories };
            repositories.push(...result.repositories.map(({ full_name, private: isPrivate, default_branch }) => ({ full_name, private: isPrivate, default_branch })));
            if (result.repositories.length < 100) break;
        }
        return repositories;
    }
    async resolve(repository: string, ref: string) {
        const result = await this.request(`/repos/${repository}/commits/${encodeURIComponent(ref)}`, await this.token()) as { sha: string };
        if (!/^[a-f0-9]{40}$/.test(result.sha)) throw new ServiceError('GitHub returned an invalid commit', 502);
        return result.sha;
    }
    verify(body: Buffer, signature: string | undefined) {
        const secret = process.env.GITHUB_WEBHOOK_SECRET;
        if (!secret) throw new ServiceError('GitHub webhooks are not configured', 503);
        if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
        const expected = createHmac('sha256', secret).update(body).digest();
        return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
    }
}
