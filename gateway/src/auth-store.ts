import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { AuthStore } from './auth.js';
import { ServiceError } from './Instace.js';

export class PrismaAuthStore implements AuthStore {
    private prisma: PrismaClient;
    constructor(connectionString: string) {
        const url = new URL(connectionString);
        if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql://');
        const adapter = new PrismaMariaDb({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), connectionLimit: 5, connectTimeout: 5000 });
        this.prisma = new PrismaClient({ adapter });
    }
    async setupRequired() { return await this.prisma.authBootstrap.count() === 0 && await this.prisma.user.count() === 0; }
    async createAdministrator(input: { email: string; name: string; passwordHash: string }) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                await tx.authBootstrap.create({ data: { id: 1 } });
                return tx.user.create({ data: input });
            });
        } catch (error) {
            if ((error as { code?: string }).code === 'P2002') throw new ServiceError('Administrator is already configured', 409);
            throw error;
        }
    }
    async findUser(email: string) { return this.prisma.user.findUnique({ where: { email } }); }
    async createSession(tokenHash: string, userId: string, expiresAt: Date) {
        await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        await this.prisma.session.create({ data: { tokenHash, userId, expiresAt } });
    }
    async session(tokenHash: string) { return this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } }); }
    async deleteSession(tokenHash: string) { await this.prisma.session.deleteMany({ where: { tokenHash } }); }
    async close() { await this.prisma.$disconnect(); }
}
