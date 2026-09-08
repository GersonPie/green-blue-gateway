import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const gatewayEnv = loadEnv('development', fileURLToPath(new URL('../gateway', import.meta.url)), '');
const target = process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.PORT || gatewayEnv.PORT || 8000}`;
const proxy: Record<string, ProxyOptions> = {
    '/traffic': { target, rewrite: (path) => path.replace(/^\/traffic/, '') || '/' },
    '/api': {
        target,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
        configure: (server) => {
            server.on('proxyReq', (request) => {
                request.removeHeader('authorization');
            });
        },
    },
};
export default defineConfig({ plugins: [react()], server: { host: '127.0.0.1', proxy }, preview: { proxy } });
