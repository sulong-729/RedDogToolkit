// Phase 8: the daemon, the service control and the dashboard. Real child processes are used for start/stop; Chrome renders
// the dashboard. Nothing here installs anything or touches a game repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createEngine } from '../dist/engine.js';
import { startDaemonServer } from '../dist/service/daemon.js';
import { startController } from '../dist/service/controller.js';
import { serviceStatus, startService, stopService } from '../dist/service/control.js';
import { endpointFile, logFile } from '../dist/service/paths.js';
import { makeGateway } from '../dist/service/gateway.js';
import { readEndpoint } from '../dist/service/client.js';
import { Approvals } from '../dist/modules/guard/index.js';
import { readToken } from '../dist/modules/config/index.js';
import { registerSecret } from '../dist/modules/redact/index.js';
import { BrowserSession } from '../dist/modules/browser/index.js';
import { RunStore } from '../dist/modules/store/index.js';
import { estimateTokens } from '../dist/modules/tokens/index.js';
import { cpuSeconds, mcpClient, testConfig, writeConfigFile, writeRun } from './helpers.mjs';
import { chromePath, hasChrome } from './fixture.mjs';

const uuid = () => crypto.randomUUID();
const rpc = (op, params = {}) => ({ formatVersion: 1, requestId: uuid(), operation: op, params });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Raw HTTP request, so a test can set Host and Origin exactly (fetch will not). */
function raw(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
            let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, text: data }));
        });
        req.on('error', reject); if (body) req.write(body); req.end();
    });
}
const api = (c, route, body, extra = {}) => raw(c.url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-RedDog-Key': c.key, Origin: c.url, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => ({ ...r, json: JSON.parse(r.text) }));

test('P8-T01 the daemon refuses anything but an authenticated local client; the endpoint file is private', async () => {
    const cfg = testConfig(); const d = await startDaemonServer(cfg);
    try {
        assert.equal(fs.statSync(endpointFile(cfg.stateDir)).mode & 0o777, 0o600);
        const auth = { Authorization: 'Bearer ' + d.token };
        assert.equal((await raw(d.url + '/health')).status, 403, 'no token');
        assert.equal((await raw(d.url + '/health', { headers: { Authorization: 'Bearer ' + 'a'.repeat(64) } })).status, 403, 'wrong token');
        assert.equal((await raw(d.url + '/health', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403, 'a browser Origin');
        assert.equal((await raw(d.url + '/health', { headers: { ...auth, Host: 'evil.example' } })).status, 403, 'a foreign Host');
        const ok = await raw(d.url + '/health', { headers: auth });
        assert.equal(ok.status, 200);
        assert.ok(!ok.text.includes(d.token), 'health never echoes the token');
        assert.equal((await raw(d.url + '/nope', { headers: auth })).status, 404);
        const big = await raw(d.url + '/v1/rpc', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }) });
        assert.equal(big.status, 413);
    } finally { await d.close(); }
    assert.equal(fs.existsSync(endpointFile(cfg.stateDir)), false, 'the endpoint file is removed on close');
});

test('P8-T02 CLI and MCP reach the same results through the daemon as the engine does directly', async () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg);
    writeRun(cfg.stateDir, 'r1', { events: [{ t: 1, type: 'console', text: 'hello' }], server: [] });
    const direct = createEngine(cfg);
    const d = await startDaemonServer(cfg);
    const gw = makeGateway(cfg);
    try {
        const viaDaemon = await gw.call(rpc('gameplay.evidence.check', { runId: 'r1' }));
        assert.equal(gw.lastVia, 'daemon');
        const local = await direct.call(rpc('gameplay.evidence.check', { runId: 'r1' }));
        assert.deepEqual({ ...viaDaemon, requestId: 0 }, { ...local, requestId: 0 });
        assert.deepEqual(await gw.describe(), JSON.parse(JSON.stringify((await makeGatewayLocal(cfg)).describeSync())));

        const mcp = mcpClient(file); await mcp.init();
        const result = await mcp.call('gameplay_query', { request: rpc('gameplay.evidence.check', { runId: 'r1' }) });
        mcp.close();
        assert.deepEqual({ ...result, requestId: 0 }, { ...local, requestId: 0 });
        assert.match(fs.readFileSync(logFile(cfg.stateDir, 'daemon'), 'utf8'), /rpc gameplay\.evidence\.check ok/, 'the MCP call was served by the daemon');
    } finally { await d.close(); }

    const cli = spawnSync('node', ['dist/adapters/cli.js', 'query', 'gameplay.evidence.check', '--params', '{"runId":"r1"}'], { env: { ...process.env, REDDOG_CONFIG: file, REDDOG_STANDALONE: '1' }, encoding: 'utf8' });
    assert.equal(cli.status, 0, 'the in-process fallback still works with no daemon');
});
async function makeGatewayLocal(cfg) { const { listCapabilities } = await import('../dist/engine.js'); const e = createEngine(cfg); return { describeSync: () => listCapabilities(e.registry) }; }

test('P8-T03 and T04 start, status, stop a real daemon process; a second start does not start another', async () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg);
    try {
        const first = await startService(cfg, file);
        assert.equal(first.started, true);
        assert.notEqual(first.pid, process.pid);
        const status = await serviceStatus(cfg);
        assert.equal(status.running, true);
        assert.equal(status.pid, first.pid);
        const again = await startService(cfg, file);
        assert.deepEqual([again.started, again.alreadyRunning, again.pid], [false, true, first.pid]);
        assert.equal(readEndpoint(cfg.stateDir).pid, first.pid, 'still the one daemon');
        const stopped = await stopService(cfg);
        assert.equal(stopped.stopped, true);
        assert.equal(alive(first.pid), false);
        assert.equal(fs.existsSync(endpointFile(cfg.stateDir)), false);
        assert.equal((await serviceStatus(cfg)).running, false);
        assert.deepEqual(await stopService(cfg), { stopped: false, reason: 'not-running' });
    } finally { await stopService(cfg); }
});

test('P8-T04 stop never touches a process it cannot prove is its own', async () => {
    const cfg = testConfig();
    const stranger = spawn('sleep', ['30']);
    try {
        fs.mkdirSync(cfg.stateDir, { recursive: true });
        fs.writeFileSync(endpointFile(cfg.stateDir), JSON.stringify({ url: 'http://127.0.0.1:1', token: 'x', pid: stranger.pid, instanceId: 'z' }));
        assert.deepEqual(await stopService(cfg), { stopped: false, reason: 'not-running' });
        assert.equal(alive(stranger.pid), true, 'the stranger is untouched');
        assert.equal(fs.existsSync(endpointFile(cfg.stateDir)), true, 'a live pid keeps its endpoint file');
        stranger.kill(); await sleep(150);
        await stopService(cfg);
        assert.equal(fs.existsSync(endpointFile(cfg.stateDir)), false, 'a dead pid`s stale file is cleaned');
    } finally { stranger.kill(); }
});

test('P8-T05 the dashboard opens while the daemon is stopped, and its Bật service button starts it', async () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg);
    const c = await startController(cfg, { configFile: file });
    try {
        const page = await raw(c.url + '/');
        assert.equal(page.status, 200);
        for (const label of ['RedDogToolkit', 'Bảng điều khiển service', 'Bật service', 'Tắt service', 'Làm mới', 'Môi trường', 'Run gần đây', 'Token', 'Kế hoạch chờ duyệt', 'Nhật ký'])
            assert.ok(page.text.includes(label), label);
        assert.equal((await raw(c.url + '/api/status')).status, 403, 'the API needs the key');
        assert.equal((await api(c, '/api/status')).json.running, false);
        const started = await api(c, '/api/service/start', {});
        assert.equal(started.json.started, true);
        assert.equal((await api(c, '/api/status')).json.running, true);
        assert.equal((await api(c, '/api/service/stop', {})).json.stopped, true);
        assert.equal((await api(c, '/api/status')).json.running, false);
    } finally { await stopService(cfg); await c.close(); }
});

test('P8-T06 the environment card shows the same failures as gameplay.doctor', async () => {
    const cfg = testConfig(); const probes = { exists: () => true, fileSize: () => null, mtimeMs: () => null, readJson: () => null, newestMtimeMs: () => 0, http: async () => ({ ok: false, error: 'ECONNREFUSED' }), cocosRunning: () => false };
    const c = await startController(cfg, { probes });
    try {
        const card = (await api(c, '/api/doctor')).json.lines.filter(l => l.startsWith('FAIL'));
        const doctor = await createEngine(cfg, probes).call(rpc('gameplay.doctor'));
        assert.ok(card.length >= 2);
        assert.deepEqual(card, doctor.data.lines);
    } finally { await c.close(); }
});

test('P8-T07 the runs card and the token card match the files on disk', async () => {
    const cfg = testConfig(); const c = await startController(cfg);
    try {
        const mk = (id, scenario, status, events, server) => {
            writeRun(cfg.stateDir, id, { events, server });
            fs.writeFileSync(path.join(cfg.stateDir, 'artifacts', id, 'flow.log'), `2026-11-16T00:00:00Z run ${id} scenario=${scenario}\n`);
            fs.writeFileSync(path.join(cfg.stateDir, 'artifacts', id, 'result.json'), JSON.stringify({ status }));
        };
        mk('20261116T000001-aaaaaa', 'observe', 'ok', [{ t: 1 }, { t: 2 }], [{ t: 3 }]);
        mk('20261116T000002-bbbbbb', 'shoot', 'failed', [{ t: 1 }], []);
        const runs = (await api(c, '/api/runs')).json.runs;
        assert.deepEqual(runs.map(r => [r.id, r.scenario, r.status, r.records]), [['20261116T000002-bbbbbb', 'shoot', 'failed', 1], ['20261116T000001-aaaaaa', 'observe', 'ok', 3]]);

        fs.writeFileSync(path.join(cfg.stateDir, 'ledger.jsonl'), [
            { operation: 'gameplay.observe', responseTokens: 100, budget: 160 }, { operation: 'gameplay.observe', responseTokens: 200, budget: 160 }, { operation: 'gameplay.doctor', responseTokens: 50, budget: 250 },
        ].map(e => JSON.stringify(e)).join('\n') + '\n');
        const t = (await api(c, '/api/tokens')).json;
        assert.deepEqual([t.calls, t.tokens, t.overBudget], [3, 350, 1]);
        assert.deepEqual(t.top[0], { operation: 'gameplay.observe', calls: 2, tokens: 300 });
    } finally { await c.close(); }
});

test('P8-T08 the Duyệt button approves exactly the shown plan, once, and the plan then leaves the list', async () => {
    const cfg = testConfig(); const c = await startController(cfg); const approvals = new Approvals(cfg.stateDir);
    try {
        const { hash } = approvals.propose({ operation: 'gameplay.cheat', params: { preset: 'freegame' }, mutations: ['cheat freegame on staging'] });
        const listed = (await api(c, '/api/plans')).json.plans;
        assert.deepEqual(listed, [{ hash, operation: 'gameplay.cheat', mutations: ['cheat freegame on staging'] }]);
        assert.equal((await api(c, '/api/plans/approve', { hash })).json.ok, true);
        assert.deepEqual((await api(c, '/api/plans')).json.plans, []);
        assert.equal(approvals.consume(hash, 'gameplay.cheat').operation, 'gameplay.cheat');
        assert.throws(() => approvals.consume(hash, 'gameplay.cheat'), (e) => e.code === 'WRITE_GUARD', 'single use');
        assert.equal((await api(c, '/api/plans/approve', { hash: 'f'.repeat(64) })).json.ok, false, 'no such plan');
    } finally { await c.close(); }
});

test('P8-T09 approving is refused without the key, with a foreign Origin, or with a foreign Host, and creates nothing', async () => {
    const cfg = testConfig(); const c = await startController(cfg); const approvals = new Approvals(cfg.stateDir);
    try {
        const { hash } = approvals.propose({ operation: 'gameplay.cheat', params: {}, mutations: ['x'] });
        const body = JSON.stringify({ hash });
        const post = (headers) => raw(c.url + '/api/plans/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
        assert.equal((await post({ Origin: c.url })).status, 403, 'no key');
        assert.equal((await post({ 'X-RedDog-Key': 'wrong'.padEnd(48, 'x'), Origin: c.url })).status, 403, 'wrong key');
        assert.equal((await post({ 'X-RedDog-Key': c.key, Origin: 'https://evil.example' })).status, 403, 'foreign origin');
        assert.equal((await post({ 'X-RedDog-Key': c.key })).status, 403, 'no origin');
        assert.equal((await post({ 'X-RedDog-Key': c.key, Origin: c.url, Host: 'evil.example' })).status, 403, 'foreign host');
        assert.equal(fs.existsSync(path.join(cfg.stateDir, 'approvals')), false, 'nothing was approved');
        assert.throws(() => approvals.consume(hash, 'gameplay.cheat'), (e) => e.code === 'WRITE_GUARD');
    } finally { await c.close(); }
});

test('P8-T10 `service plan` prints what would be installed and writes nothing', () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg); const home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-'));
    const r = spawnSync('node', ['dist/adapters/cli.js', 'service', 'plan'], { env: { ...process.env, HOME: home, REDDOG_CONFIG: file }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const plan = JSON.parse(r.stdout);
    assert.equal(plan.label, 'com.reddog.toolkit');
    assert.match(plan.plist, new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(plan.plist, /daemon-main\.js/);
    assert.match(plan.note, /plan only/);
    assert.deepEqual(fs.readdirSync(home), [], 'nothing was written under HOME');
    assert.equal(fs.existsSync(path.join(os.homedir(), 'Library/LaunchAgents/com.reddog.toolkit.plist')), false, 'and nothing was installed');
});

test('P8-T11 the token appears in no page, no API reply and no log of the service', async () => {
    const cfg = testConfig(); const TOKEN = 'FAKE_TOKEN_ZZZ999_notreal';
    fs.mkdirSync(path.dirname(cfg.tokenFile), { recursive: true }); fs.writeFileSync(cfg.tokenFile, TOKEN + '\n');
    registerSecret(readToken(cfg));
    const d = await startDaemonServer(cfg); const c = await startController(cfg);
    try {
        const { log } = await import('../dist/service/paths.js');
        log(cfg, 'service', `probe https://x/?token=${TOKEN} and ${TOKEN}`);
        await fetch(d.url + '/v1/rpc', { method: 'POST', headers: { Authorization: 'Bearer ' + d.token, 'Content-Type': 'application/json' }, body: JSON.stringify(rpc('gameplay.doctor')) });
        const seen = [(await raw(c.url + '/')).text];
        for (const r of ['/api/status', '/api/doctor', '/api/runs', '/api/tokens', '/api/plans', '/api/logs?source=service', '/api/logs?source=daemon']) seen.push((await api(c, r)).text);
        for (const f of ['daemon', 'service', 'controller']) { try { seen.push(fs.readFileSync(logFile(cfg.stateDir, f), 'utf8')); } catch { /* none */ } }
        for (const s of seen) { assert.ok(!s.includes(TOKEN), 'token leaked'); assert.ok(!s.includes(d.token), 'daemon token leaked'); }
        assert.ok(seen.some(s => s.includes('[REDACTED]')), 'the probe line was masked, not dropped');
    } finally { await c.close(); await d.close(); }
});

test('P8-T12 the dashboard renders in Chrome at 720 px: every card present, no horizontal overflow, log text is not interpreted as HTML', { skip: hasChrome ? false : 'Chrome not installed' }, async () => {
    const cfg = testConfig({ chromePath }); const c = await startController(cfg);
    const { log } = await import('../dist/service/paths.js');
    log(cfg, 'service', '<img src=x onerror="document.title=\'pwned\'"> <b>bold</b>');
    const store = new RunStore(cfg.stateDir, 'dash');
    const s = await BrowserSession.open(cfg, store, c.url + '/');
    try {
        await s.waitForScene(1000);
        await s.evaluate(`new Promise(r => { const t = setInterval(() => { if (document.getElementById('logText').textContent.includes('pwned')) { clearInterval(t); r(); } }, 50); setTimeout(r, 4000); })`);
        const probe = await s.evaluate(`({ w: document.documentElement.scrollWidth <= window.innerWidth, iw: window.innerWidth, cards: document.querySelectorAll('.card').length,
            img: document.querySelectorAll('#logText img, #logText b').length, title: document.title, state: document.getElementById('state').textContent, log: document.getElementById('logText').textContent })`);
        assert.equal(probe.iw, 720);
        assert.equal(probe.w, true, 'no horizontal scroll');
        assert.equal(probe.cards, 6, 'service, environment, runs, tokens, plans, logs');
        assert.equal(probe.img, 0, 'log text was not parsed as HTML');
        assert.equal(probe.title, 'RedDogToolkit', 'the onerror payload did not run');
        assert.match(probe.log, /<img src=x/);
        assert.equal(probe.state, 'Service đã tắt');
        const shot = await s.screenshot({ checkpoint: 'dashboard' });
        assert.equal(shot.width, 720);
        fs.copyFileSync(path.join(store.dir, shot.file), path.join(os.tmpdir(), 'reddog-dashboard.png'));
    } finally { await s.close(); await c.close(); }
});

test('P8-K01 repeated calls through the daemon beat starting a process each time; tokens are identical (latency measured)', async () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg);
    writeRun(cfg.stateDir, 'r1', { events: [{ t: 1, type: 'console', text: 'x' }], server: [] });
    try {
        await startService(cfg, file);
        const gw = makeGateway(cfg);
        const N = 10;
        let t0 = performance.now();
        const viaDaemon = [];
        for (let i = 0; i < N; i++) viaDaemon.push(await gw.call(rpc('gameplay.evidence.check', { runId: 'r1' })));
        const daemonMs = (performance.now() - t0) / N;
        assert.equal(gw.lastVia, 'daemon');

        const cold = 5; t0 = performance.now();
        for (let i = 0; i < cold; i++) spawnSync('node', ['dist/adapters/cli.js', 'query', 'gameplay.evidence.check', '--params', '{"runId":"r1"}'], { env: { ...process.env, REDDOG_CONFIG: file, REDDOG_STANDALONE: '1' } });
        const coldMs = (performance.now() - t0) / cold;
        console.log(`# P8-K01 measured: ${daemonMs.toFixed(1)} ms per call via the daemon vs ${coldMs.toFixed(1)} ms per cold CLI process`);
        assert.ok(daemonMs < coldMs, `${daemonMs} vs ${coldMs}`);
        assert.equal(new Set(viaDaemon.map(r => estimateTokens({ ...r, requestId: 0 }))).size, 1, 'same reply every time');
    } finally { await stopService(cfg); }
});

test('P8-K02 an open dashboard costs the agent 0 tokens and little CPU while it polls', { skip: hasChrome ? false : 'Chrome not installed' }, async () => {
    const cfg = testConfig({ chromePath }); const file = writeConfigFile(cfg);
    const c = await startController(cfg, { configFile: file });
    try {
        const svc = await startService(cfg, file);
        const ledger = path.join(cfg.stateDir, 'ledger.jsonl');
        const before = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '';
        const store = new RunStore(cfg.stateDir, 'poll');
        const s = await BrowserSession.open(cfg, store, c.url + '/');
        const cpu0 = await cpuSeconds(svc.pid), t0 = Date.now();
        await sleep(11000);
        const cpu = (await cpuSeconds(svc.pid)) - cpu0, wall = (Date.now() - t0) / 1000;
        await s.close();
        const after = fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8') : '';
        console.log(`# P8-K02 measured: daemon used ${cpu.toFixed(2)} CPU-seconds in ${wall.toFixed(1)} s with the dashboard polling every 5 s`);
        assert.equal(after, before, 'polling added nothing to the token ledger');
        assert.ok(cpu < wall * 0.25, `${cpu}s of ${wall}s`);
    } finally { await stopService(cfg); await c.close(); }
});

test('P8-K03 the MCP client is thin: the same six tools and the same schema through the daemon and in-process', async () => {
    const cfg = testConfig(); const file = writeConfigFile(cfg);
    const d = await startDaemonServer(cfg);
    try {
        const viaDaemon = mcpClient(file); await viaDaemon.init(); const a = await viaDaemon.tools(); viaDaemon.close();
        const standalone = mcpClient(file, { REDDOG_STANDALONE: '1' }); await standalone.init(); const b = await standalone.tools(); standalone.close();
        assert.equal(a.length, 6);
        assert.deepEqual(a, b);
        console.log(`# P8-K03 measured: tool list = ${estimateTokens(a)} tokens (est), identical in both modes`);
    } finally { await d.close(); }
});
