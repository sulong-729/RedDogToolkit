// Phase 2: P2-T01..T08, K01..K03 against a LOCAL FIXTURE PAGE (not the real game). Needs Chrome; skipped without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createEngine } from '../dist/engine.js';
import { BrowserSession, assertLocalHttp } from '../dist/modules/browser/index.js';
import { RunStore } from '../dist/modules/store/index.js';
import { registerSecret } from '../dist/modules/redact/index.js';
import { testConfig } from './helpers.mjs';
import { startFixture, chromePath, hasChrome } from './fixture.mjs';

registerSecret('SECRETTOKEN_ABC');
const opts = { skip: hasChrome ? false : 'Chrome not installed' };
const cfg = () => testConfig({ chromePath });
const lines = (store, file) => fs.readFileSync(path.join(store.dir, file), 'utf8').split('\n').filter(Boolean).map(l => l.startsWith('{') ? JSON.parse(l) : l);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };

test('P2-T01 the scene is awaited by signal and arrives within seconds', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't1');
    const s = await BrowserSession.open(c, store, fx.url);
    const t0 = Date.now();
    assert.equal(await s.waitForScene(10000), true);
    assert.ok(Date.now() - t0 < 5000);
    assert.ok(lines(store, 'events.jsonl').some(e => e.type === 'scene-ready' && e.name === 'fixture'));
    await s.close(); fx.close();
});

test('P2-T02 reload: records from before and after are all kept, seq continuous', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't2');
    const s = await BrowserSession.open(c, store, fx.url);
    await s.waitForScene(10000);
    await waitFor(() => lines(store, 'events.jsonl').some(e => e.text === 'hello fixture'));
    const before = lines(store, 'events.jsonl').length;
    await s.reload();
    assert.equal(await s.waitForScene(10000), true);
    await waitFor(() => lines(store, 'events.jsonl').filter(e => e.text === 'hello fixture').length === 2);
    const events = lines(store, 'events.jsonl');
    await s.close(); fx.close();
    assert.equal(s.reloads, 1);
    assert.ok(events.length > before);
    assert.equal(events.filter(e => e.type === 'scene-ready').length, 2);
    assert.equal(events.filter(e => e.text === 'hello fixture').length, 2);
    const seq = events.map(e => e.seq);
    assert.ok(seq.every((n, i) => i === 0 || n > seq[i - 1]), 'seq strictly increasing');
});

test('P2-T03 console, page error, failed request and websocket frames are recorded, redacted', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't3');
    const s = await BrowserSession.open(c, store, fx.url);
    await s.waitForScene(10000);
    await waitFor(() => lines(store, 'server.jsonl').some(r => r.kind === 'ws-recv' && /echo/.test(r.data)) && lines(store, 'events.jsonl').some(e => e.type === 'pageerror'));
    await s.close(); fx.close();
    const events = lines(store, 'events.jsonl'), server = lines(store, 'server.jsonl');
    assert.ok(events.some(e => e.type === 'console' && e.level === 'warn' && e.text === 'warn line'));
    assert.ok(events.some(e => e.type === 'pageerror' && /boom from fixture/.test(e.text)));
    assert.ok(server.some(r => r.kind === 'request-failed' && /unreachable/.test(r.url)));
    assert.ok(server.some(r => r.kind === 'http' && r.status === 200 && /"ok":true/.test(r.res)));
    assert.ok(server.some(r => r.kind === 'ws-send' && /hello/.test(r.data)));
    assert.ok(server.some(r => r.kind === 'ws-recv' && /echo/.test(r.data)));
    for (const f of ['events.jsonl', 'server.jsonl', 'flow.log']) assert.ok(!fs.readFileSync(path.join(store.dir, f), 'utf8').includes('SECRETTOKEN_ABC'), f);
});

test('P2-T04 noise is filtered: static assets and websocket heartbeats never reach server.jsonl', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't4');
    const s = await BrowserSession.open(c, store, fx.url);
    await s.waitForScene(10000);
    await waitFor(() => s.stats.heartbeatsFiltered >= 2);
    await s.close(); fx.close();
    const text = fs.readFileSync(path.join(store.dir, 'server.jsonl'), 'utf8');
    assert.ok(!/pixel\.png|style\.css/.test(text));
    assert.ok(s.stats.heartbeatsFiltered >= 2, 'ping "2" and pong "3" were filtered');
    assert.ok(!lines(store, 'server.jsonl').some(r => r.data === '2' || r.data === '3'));
    assert.ok(lines(store, 'server.jsonl').length < 10, 'a fixture run stays tiny');
});

test('P2-T05 the browser dies abruptly: recorded evidence stays readable and the run is marked aborted', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't5');
    const s = await BrowserSession.open(c, store, fx.url);
    await s.waitForScene(10000);
    process.kill(s.pid, 'SIGKILL');
    assert.ok(await waitFor(() => fs.existsSync(path.join(store.dir, 'result.json'))));
    fx.close();
    const result = JSON.parse(fs.readFileSync(path.join(store.dir, 'result.json'), 'utf8'));
    assert.equal(result.status, 'aborted');
    assert.equal(result.indeterminate, true);
    assert.ok(lines(store, 'events.jsonl').some(e => e.type === 'scene-ready'), 'earlier evidence survives');
    assert.equal(store.append('events.jsonl', { type: 'late' }), false, 'a closed store refuses quietly');
});

test('P2-T06 the browser runs headless (no window, no focus); only local http targets are allowed', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't6');
    const s = await BrowserSession.open(c, store, fx.url);
    assert.ok(s.args.some(a => a.startsWith('--headless')), s.args.join(' '));
    await s.close(); fx.close();
    for (const bad of ['https://example.com/', 'http://192.168.1.2/', 'file:///etc/hosts', 'ftp://127.0.0.1/', 'nonsense'])
        assert.throws(() => assertLocalHttp(bad), (e) => e.code === 'SCHEMA_MISMATCH', bad);
    assert.doesNotThrow(() => assertLocalHttp('http://localhost:7456/?a=1'));
});

test('P2-T07 open and close twice: no browser process is left behind', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const pids = [];
    for (let i = 0; i < 2; i++) {
        const store = new RunStore(c.stateDir, 't7');
        const s = await BrowserSession.open(c, store, fx.url);
        pids.push(s.pid);
        await s.close();
    }
    fx.close();
    assert.equal(new Set(pids).size, 2);
    for (const pid of pids) assert.equal(alive(pid), false, 'pid ' + pid);
});

test('P2-T08 cursor, ifRevision and expiry', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const run = await engine.call({ formatVersion: 1, requestId: 'o', operation: 'gameplay.observe', params: { target: fx.url, seconds: 1 } });
    fx.close();
    const runId = run.data.run;
    const read = (params) => engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.evidence.events', params: { runId, ...params } });

    const first = await read({ limit: 2 });
    assert.equal(first.data.lines.length, 2);
    assert.ok(first.data.nextCursor);
    const second = await read({ limit: 2, cursor: first.data.nextCursor });
    assert.notDeepEqual(second.data.lines, first.data.lines);

    const again = await read({ limit: 2, ifRevision: first.data.revision });
    assert.equal(again.status, 'unchanged');
    assert.equal(again.data, undefined);

    const other = await engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.evidence.server', params: { runId, cursor: first.data.nextCursor } });
    assert.equal(other.error.code, 'CURSOR_MISMATCH', 'cursor from another file');
    assert.equal((await read({ cursor: '5.deadbeef' })).error.code, 'CURSOR_MISMATCH');
    assert.equal((await engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.evidence.events', params: { runId: 'gone' } })).error.code, 'SNAPSHOT_EXPIRED');
    assert.equal((await engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.evidence.events', params: { runId: '../etc' } })).error.code, 'SCHEMA_MISMATCH');
});

test('P2-K01 open the page and wait for the scene: ONE call, <= 160 tokens with a UUID request id (estimator uncalibrated, P0-K02)', opts, async () => {
    const fx = await startFixture(); const engine = createEngine(cfg());
    const result = await engine.call({ formatVersion: 1, requestId: crypto.randomUUID(), operation: 'gameplay.observe', params: { target: fx.url, seconds: 1 } });
    fx.close();
    assert.equal(result.status, 'ok');
    assert.equal(result.data.scene, true);
    assert.equal(engine.ledger.length, 1, 'one call');
    assert.ok(engine.ledger[0].responseTokens <= 160, String(engine.ledger[0].responseTokens));
});

test('P2-K02 reload and keep recording: response tokens do not grow with the number of records', opts, async () => {
    const fx = await startFixture(); const engine = createEngine(cfg());
    const run = (noise) => engine.call({ formatVersion: 1, requestId: crypto.randomUUID(), operation: 'gameplay.observe', params: { target: fx.url + '?noise=' + noise, seconds: 2, reloadAfterSeconds: 1 } });
    const small = await run(2), big = await run(400);
    fx.close();
    assert.equal(small.data.reloads, 1);
    assert.ok(big.data.rec[0] > small.data.rec[0] * 10, `records ${small.data.rec[0]} vs ${big.data.rec[0]}`);
    const [a, b] = engine.ledger.map(e => e.responseTokens);
    assert.ok(Math.abs(a - b) <= 6, `${a} vs ${b} tokens`);
    assert.ok(b <= 160);
});

test('P2-K03 reading evidence again with the same revision answers `unchanged`, tiny (fixed envelope only)', opts, async () => {
    const fx = await startFixture(); const engine = createEngine(cfg());
    const run = await engine.call({ formatVersion: 1, requestId: 'o', operation: 'gameplay.observe', params: { target: fx.url, seconds: 1 } });
    fx.close();
    const first = await engine.call({ formatVersion: 1, requestId: crypto.randomUUID(), operation: 'gameplay.evidence.events', params: { runId: run.data.run } });
    const again = await engine.call({ formatVersion: 1, requestId: crypto.randomUUID(), operation: 'gameplay.evidence.events', params: { runId: run.data.run, ifRevision: first.data.revision } });
    assert.equal(again.status, 'unchanged');
    const [, firstTokens, againTokens] = engine.ledger.map(e => e.responseTokens);
    assert.ok(againTokens <= 110, String(againTokens)); // measured 97 with a UUID request id: the fixed envelope dominates
    assert.ok(againTokens < firstTokens / 3, `${againTokens} vs ${firstTokens}`);
});
