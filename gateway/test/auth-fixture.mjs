import { randomUUID } from 'node:crypto';
import { ServiceError } from '../dist/Instace.js';
export class MemoryAuthStore {
    users = new Map();
    sessions = new Map();
    async setupRequired() { return this.users.size === 0; }
    async createAdministrator(input) {
        if (this.users.size) throw new ServiceError('Administrator is already configured', 409);
        const user = { ...input, id: randomUUID() }; this.users.set(user.email, user); return user;
    }
    async findUser(email) { return this.users.get(email) || null; }
    async createSession(tokenHash, userId, expiresAt) { this.sessions.set(tokenHash, { user: [...this.users.values()].find((user) => user.id === userId), expiresAt }); }
    async session(tokenHash) { return this.sessions.get(tokenHash) || null; }
    async deleteSession(tokenHash) { this.sessions.delete(tokenHash); }
    async close() {}
}
