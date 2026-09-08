import { request } from 'node:http';
import type { Request, Response } from 'express';
import { parse, serialize } from 'cookie';
import { config } from './config.js';

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
export function forward(req: Request, res: Response, port: number, requestPath: string, release: () => void = () => {}, stripAuthorization = false) {
    const headers = { ...req.headers };
    for (const name of [...hopHeaders, ...(req.headers.connection || '').split(',').map((value) => value.trim().toLowerCase())]) delete headers[name];
    if (stripAuthorization || headers.authorization === `Bearer ${config.managementToken}`) delete headers.authorization;
    if (headers.cookie) {
        const cookies = parse(headers.cookie);
        delete cookies.gateway_session;
        headers.cookie = Object.entries(cookies).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([name, value]) => serialize(name, value)).join('; ');
        if (!headers.cookie) delete headers.cookie;
    }
    headers.host = `127.0.0.1:${port}`;
    const upstream = request({ hostname: '127.0.0.1', port, path: requestPath, method: req.method, headers }, (response) => {
        const responseHeaders = { ...response.headers };
        for (const name of [...hopHeaders, ...(response.headers.connection || '').split(',').map((value) => value.trim().toLowerCase())]) delete responseHeaders[name];
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.on('error', () => res.destroy());
        response.pipe(res);
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('Upstream timeout')));
    upstream.on('error', () => {
        if (!res.headersSent) res.status(502).json({ error: 'Upstream request failed' }); else res.destroy();
    });
    let done = false;
    const finish = () => { if (!done) { done = true; upstream.destroy(); release(); } };
    req.once('aborted', finish);
    res.once('close', finish);
    res.once('finish', finish);
    req.pipe(upstream);
}
