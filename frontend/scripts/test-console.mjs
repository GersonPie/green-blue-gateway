import { createServer } from 'vite';
process.env.GATEWAY_URL = 'http://127.0.0.1:18765';
const server = await createServer({ server: { port: 18766, strictPort: true } });
await server.listen();
process.on('SIGTERM', () => void server.close());
process.on('SIGINT', () => void server.close());
