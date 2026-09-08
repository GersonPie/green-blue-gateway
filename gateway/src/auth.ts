import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import express, { type Request } from 'express';
import { parse } from 'cookie';
import { ServiceError } from './Instace.js';

export interface AuthUser { id: string; email: string; name: string; passwordHash: string }
export interface AuthStore {
    setupRequired(): Promise<boolean>;
    createAdministrator(input: { email: string; name: string; passwordHash: string }): Promise<AuthUser>;
    findUser(email: string): Promise<AuthUser | null>;
    createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
    session(tokenHash: string): Promise<{ user: AuthUser; expiresAt: Date } | null>;
    deleteSession(tokenHash: string): Promise<void>;
    close(): Promise<void>;
}
const SESSION_COOKIE = 'gateway_session';
const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64) as Buffer;
    return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
    const [algorithm, salt, value] = encoded.split(':');
    if (algorithm !== 'scrypt' || !salt || !value || !/^[a-f0-9]{128}$/.test(value)) return false;
    const derived = await derive(password, salt, 64) as Buffer;
    return timingSafeEqual(derived, Buffer.from(value, 'hex'));
}
export class Auth {
    private attempts = new Map<string, { count: number; expires: number }>();
    constructor(private store?: AuthStore) {}
    private database() { if (!this.store) throw new ServiceError('Authentication database is not configured', 503); return this.store; }
    private token(req: Request) { return parse(req.headers.cookie || '')[SESSION_COOKIE]; }
    async user(req: Request) {
        const token = this.token(req);
        if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
        const session = await this.database().session(hashToken(token));
        if (!session || session.expiresAt.getTime() <= Date.now()) return null;
        const { id, email, name } = session.user;
        return { id, email, name };
    }
    assertSameOrigin(req: Request) {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
        if (req.get('x-gateway-request') !== '1') throw new ServiceError('Missing request protection header', 403);
        const origin = req.get('origin');
        if (origin) {
            try { if (new URL(origin).host !== req.get('host')) throw new Error(); }
            catch { throw new ServiceError('Cross-origin request rejected', 403); }
        }
    }
    private limit(req: Request) {
        const now = Date.now();
        for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
        const key = req.ip || 'unknown';
        const attempt = this.attempts.get(key) || { count: 0, expires: now + 15 * 60000 };
        if (attempt.count >= 10 || this.attempts.size >= 10000) throw new ServiceError('Too many attempts. Try again later.', 429);
        attempt.count++; this.attempts.set(key, attempt);
    }
    routes() {
        const router = express.Router();
        router.use(express.json({ limit: '8kb' }));
        router.get('/status', async (_req, res) => {
            if (!this.store) { res.json({ configured: false, available: false, setupRequired: false }); return; }
            try { res.json({ configured: true, available: true, setupRequired: await this.store.setupRequired() }); }
            catch { res.json({ configured: true, available: false, setupRequired: false }); }
        });
        router.get('/me', async (req, res) => res.json({ user: await this.user(req) }));
        router.post(['/login', '/setup'], async (req, res) => {
            this.assertSameOrigin(req); this.limit(req);
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const password = req.body?.password;
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 191 || typeof password !== 'string' || password.length > 128) throw new ServiceError('Enter a valid email and password', 400);
            const database = this.database();
            let user: AuthUser | null;
            if (req.path === '/setup') {
                const address = req.socket.remoteAddress;
                if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '')) throw new ServiceError('Initial account setup is available locally only', 403);
                if (!await database.setupRequired()) throw new ServiceError('Administrator is already configured', 409);
                const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
                if (!name || name.length > 100 || password.length < 12) throw new ServiceError('Enter your name and a password of at least 12 characters', 400);
                user = await database.createAdministrator({ name, email, passwordHash: await hashPassword(password) });
            } else {
                user = await database.findUser(email);
                const dummy = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
                const valid = await verifyPassword(password, user?.passwordHash || dummy);
                if (!user || !valid) throw new ServiceError('Email or password is incorrect', 401);
            }
            const token = randomBytes(32).toString('hex');
            const lifetime = 8 * 60 * 60 * 1000;
            await database.createSession(hashToken(token), user.id, new Date(Date.now() + lifetime));
            res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.AUTH_COOKIE_SECURE === 'true', sameSite: 'strict', path: '/', maxAge: lifetime });
            this.attempts.delete(req.ip || 'unknown');
            res.json({ user: { id: user.id, email: user.email, name: user.name } });
        });
        router.post('/logout', async (req, res) => {
            this.assertSameOrigin(req);
            const token = this.token(req);
            if (token) await this.database().deleteSession(hashToken(token));
            res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: process.env.AUTH_COOKIE_SECURE === 'true', path: '/' });
            res.sendStatus(204);
        });
        return router;
    }
    async close() { await this.store?.close(); }
}
