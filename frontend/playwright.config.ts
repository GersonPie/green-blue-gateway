import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests',
    workers: 1,
    timeout: 60000,
    use: { baseURL: process.env.CONSOLE_URL || 'http://127.0.0.1:18766', browserName: 'chromium', channel: 'msedge', headless: true, extraHTTPHeaders: { 'X-Gateway-Request': '1' } },
    webServer: process.env.CONSOLE_URL ? undefined : [
        { command: 'node ../gateway/test/browser-server.mjs', url: 'http://127.0.0.1:18765/health', timeout: 60000 },
        { command: 'node scripts/test-console.mjs', url: 'http://127.0.0.1:18766', timeout: 60000 },
    ],
});
