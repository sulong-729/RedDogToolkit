// The controller: serves the dashboard and its JSON API on loopback, as a process SEPARATE from the daemon, so the page
// still opens when the daemon is stopped (same split as Forge). It reads the state directory; it never holds the
// daemon's token, and it never prints a token.
//
// Protection: exact Host, a per-start key sent in a header, and for POST an Origin equal to this server's own origin.
// That blocks other web pages and DNS rebinding. It does NOT stop another process of the same OS user, which can call
// this API too; the approval button shares that limit with the CLI (see README "Approving a write").
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Config } from '../modules/config/index.js';
import { runDoctor } from '../modules/doctor/index.js';
import type { Probes } from '../modules/doctor/probes.js';
import { Approvals } from '../modules/guard/index.js';
import { redactText, redactValue } from '../modules/redact/index.js';
import { dashboardHtml } from './dashboard.js';
import { serviceStatus, startService, stopService } from './control.js';
import { log, logFile } from './paths.js';

export interface ControllerHandle { url: string; key: string; close(): Promise<void> }

const tail = (file: string, n = 200): string[] => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; } };
const countLines = (file: string) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

function recentRuns(cfg: Config, limit = 8) {
    const dir = path.join(cfg.stateDir, 'artifacts');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'flow.log'))).sort().reverse().slice(0, limit).map((id) => {
        const run = path.join(dir, id);
        let status = 'unknown';
        try { status = JSON.parse(fs.readFileSync(path.join(run, 'result.json'), 'utf8')).status ?? 'unknown'; } catch { /* still running or none */ }
        const first = tail(path.join(run, 'flow.log'), 1000)[0] ?? '';
        const scenario = first.match(/scenario=(\S+)/)?.[1] ?? '?';
        const records = ['events.jsonl', 'ui-frames.jsonl', 'server.jsonl'].reduce((n, f) => n + countLines(path.join(run, f)), 0);
        return { id, scenario, status, records };
    });
}

function tokenTotals(cfg: Config) {
    const entries = tail(path.join(cfg.stateDir, 'ledger.jsonl'), 5000).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Array<{ operation: string; responseTokens: number; budget: number | null }>;
    const by = new Map<string, { calls: number; tokens: number }>();
    for (const e of entries) { const s = by.get(e.operation) ?? { calls: 0, tokens: 0 }; s.calls++; s.tokens += e.responseTokens; by.set(e.operation, s); }
    return {
        calls: entries.length,
        tokens: entries.reduce((n, e) => n + e.responseTokens, 0),
        overBudget: entries.filter(e => e.budget !== null && e.responseTokens > e.budget).length,
        top: [...by].map(([operation, s]) => ({ operation, ...s })).sort((a, b) => b.tokens - a.tokens).slice(0, 6),
    };
}

function pendingPlans(cfg: Config) {
    const plans = path.join(cfg.stateDir, 'plans'), approvals = path.join(cfg.stateDir, 'approvals');
    if (!fs.existsSync(plans)) return [];
    return fs.readdirSync(plans).filter(f => f.endsWith('.json')).flatMap((f) => {
        const hash = f.slice(0, -5);
        if (fs.existsSync(path.join(approvals, f))) return [];
        try { const { plan } = JSON.parse(fs.readFileSync(path.join(plans, f), 'utf8')); return [{ hash, operation: plan.operation, mutations: plan.mutations ?? [] }]; } catch { return []; }
    });
}

export async function startController(cfg: Config, options: { probes?: Probes; configFile?: string } = {}): Promise<ControllerHandle> {
    const key = crypto.randomBytes(24).toString('hex');
    const approvals = new Approvals(cfg.stateDir);
    const keyBuf = Buffer.from(key);
    let doctorCache: { at: number; value: unknown } | null = null;

    const server = http.createServer(async (req, res) => {
        const port = (server.address() as { port: number }).port;
        const origin = `http://127.0.0.1:${port}`;
        const send = (status: number, body: unknown, type = 'application/json') => {
            res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:" });
            res.end(type === 'application/json' ? JSON.stringify(redactValue(body)) : String(body));
        };
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) return send(403, { error: 'bad host' });
        const url = new URL(req.url ?? '/', origin);

        if (req.method === 'GET' && url.pathname === '/') return send(200, dashboardHtml(key), 'text/html; charset=utf-8');
        if (!url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });

        const given = Buffer.from(String(req.headers['x-reddog-key'] ?? ''));
        if (given.length !== keyBuf.length || !crypto.timingSafeEqual(given, keyBuf)) return send(403, { error: 'bad key' });
        if (req.method === 'POST' && ![origin, `http://localhost:${port}`].includes(String(req.headers.origin ?? ''))) return send(403, { error: 'bad origin' });

        let body: any = {};
        if (req.method === 'POST') {
            const chunks: Buffer[] = []; let size = 0;
            for await (const c of req) { size += c.length; if (size > 64 * 1024) return send(413, { error: 'too large' }); chunks.push(c); }
            try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { return send(400, { error: 'malformed json' }); }
        }

        try {
            if (url.pathname === '/api/status') return send(200, await serviceStatus(cfg));
            if (url.pathname === '/api/doctor') {
                if (!doctorCache || Date.now() - doctorCache.at > 10000) {
                    const r = await runDoctor(cfg, options.probes);
                    doctorCache = { at: Date.now(), value: { status: r.status, lines: r.checks.filter(c => c.state !== 'skip').map(c => c.state === 'fail' ? `FAIL ${c.name}: ${c.detail} -> ${c.fix}` : c.name) } };
                }
                return send(200, doctorCache.value);
            }
            if (url.pathname === '/api/runs') return send(200, { runs: recentRuns(cfg) });
            if (url.pathname === '/api/tokens') return send(200, tokenTotals(cfg));
            if (url.pathname === '/api/plans') return send(200, { plans: pendingPlans(cfg) });
            if (url.pathname === '/api/logs') {
                const source = url.searchParams.get('source') ?? 'service';
                const file = ['service', 'daemon', 'controller'].includes(source) ? logFile(cfg.stateDir, source as 'service')
                    : /^run:[\w.-]{1,64}$/.test(source) ? path.join(cfg.stateDir, 'artifacts', source.slice(4), 'flow.log') : null;
                return send(200, { lines: file ? tail(file, 120).map(redactText) : [] });
            }
            if (req.method === 'POST' && url.pathname === '/api/service/start') { log(cfg, 'controller', 'start requested'); return send(200, await startService(cfg, options.configFile)); }
            if (req.method === 'POST' && url.pathname === '/api/service/stop') { log(cfg, 'controller', 'stop requested'); doctorCache = null; return send(200, await stopService(cfg)); }
            if (req.method === 'POST' && url.pathname === '/api/plans/approve') {
                try { approvals.approve(String(body.hash ?? '')); log(cfg, 'controller', `approved ${String(body.hash).slice(0, 12)}`); return send(200, { ok: true }); }
                catch (e) { return send(200, { ok: false, error: (e as Error).message }); }
            }
            return send(404, { error: 'not found' });
        } catch (e) {
            log(cfg, 'controller', `error ${(e as Error).message}`);
            return send(500, { error: 'failed' });
        }
    });

    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(cfg.controllerPort, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    log(cfg, 'controller', `started ${url}`);
    return {
        url, key,
        close: () => new Promise<void>((resolve) => { log(cfg, 'controller', 'stopped'); server.close(() => resolve()); server.closeAllConnections(); }),
    };
}
