// The daemon: one engine behind a loopback HTTP server (P8-T01, P8-T03).
// Local authenticated clients only: bearer token, exact Host, no browser Origin, bounded body.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Config } from '../modules/config/index.js';
import type { Probes } from '../modules/doctor/probes.js';
import { createEngine, listCapabilities } from '../engine.js';
import { endpointFile, log, version, SERVICE_NAME } from './paths.js';

export interface DaemonHandle { url: string; token: string; instanceId: string; pid: number; close(): Promise<void> }

const MAX_BODY = 1024 * 1024;

export async function startDaemonServer(cfg: Config, probes?: Probes, options: { writeEndpoint?: boolean } = {}): Promise<DaemonHandle> {
    const engine = createEngine(cfg, probes);
    const token = crypto.randomBytes(32).toString('hex');
    const instanceId = crypto.randomUUID();
    const expected = Buffer.from('Bearer ' + token);
    let closing: Promise<void> | undefined;

    const server = http.createServer(async (req, res) => {
        const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
        const port = (server.address() as { port: number }).port;
        // Not for browsers: a request carrying an Origin, or any Host other than this exact loopback address, is refused.
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '') || req.headers.origin !== undefined) return send(403, { error: 'local clients only' });
        const actual = Buffer.from(req.headers.authorization ?? '');
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return send(403, { error: 'invalid credentials' });

        if (req.method === 'GET' && req.url === '/health') return send(200, { service: SERVICE_NAME, instanceId, pid: process.pid, version: version() });
        if (req.method !== 'POST' || !['/v1/rpc', '/v1/describe', '/v1/stop'].includes(req.url ?? '')) return send(404, { error: 'not found' });

        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(413, { error: 'request too large' }); chunks.push(chunk); }
        let body: any;
        try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400, { error: 'malformed json' }); }

        try {
            if (req.url === '/v1/describe') {
                return send(200, body?.operation ? engine.registry.describe(String(body.operation)) : listCapabilities(engine.registry));
            }
            if (req.url === '/v1/stop') { send(200, { stopping: true, pid: process.pid }); setTimeout(() => { void handle.close(); }, 50); return; }
            const result = await engine.call(body);
            log(cfg, 'daemon', `rpc ${typeof body?.operation === 'string' ? body.operation : '?'} ${result.status}`);
            return send(200, result);
        } catch (e) {
            log(cfg, 'daemon', `error ${(e as Error).message}`);
            return send(200, { formatVersion: 1, requestId: 'daemon', status: 'error', warnings: [], error: { code: 'INTERNAL_ERROR', message: 'daemon failed', recovery: 'see the daemon log' } });
        }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const file = endpointFile(cfg.stateDir);

    const handle: DaemonHandle = {
        url, token, instanceId, pid: process.pid,
        close() {
            closing ??= new Promise<void>((resolve) => {
                try { if (JSON.parse(fs.readFileSync(file, 'utf8')).instanceId === instanceId) fs.rmSync(file, { force: true }); } catch { /* not ours or gone */ }
                log(cfg, 'daemon', 'stopped');
                server.close(() => resolve());
                server.closeAllConnections();
            });
            return closing;
        },
    };

    if (options.writeEndpoint !== false) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ url, token, pid: process.pid, instanceId }), { mode: 0o600 });
    }
    log(cfg, 'daemon', `started ${url} pid=${process.pid}`);
    return handle;
}
