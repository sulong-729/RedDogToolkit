// Phase 4 at engine level: P4-T07, T08, K01..K03 on synthetic runs; plus one Chrome test for unhandled rejections (P4-T04 [I]).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createEngine } from '../dist/engine.js';
import { estimateTokens } from '../dist/modules/tokens/index.js';
import { BrowserSession } from '../dist/modules/browser/index.js';
import { RunStore } from '../dist/modules/store/index.js';
import { noRejections } from '../dist/modules/assertions/index.js';
import { parseProfile } from '../dist/modules/profile/index.js';
import { testConfig, writeRun } from './helpers.mjs';
import { startFixture, chromePath, hasChrome } from './fixture.mjs';

const id = () => crypto.randomUUID();
const call = (engine, op, params) => engine.call({ formatVersion: 1, requestId: id(), operation: op, params });
const trig = (seq, t, name, ctx) => ({ seq, t, type: 'console', text: `[EventManager] Trigger ${name} → ${ctx}` });

/** A clean run: some console, some triggers with distinct contexts, one POST. */
function cleanRun(cfg, runId, extra = {}) {
    const events = [{ t: 1000, type: 'navigated' }, { t: 1010, type: 'scene-ready', name: 's' }, { t: 1020, type: 'console', level: 'log', text: 'hello 1' },
        { t: 1100, type: 'console', text: '[EventManager] Trigger SPIN → CtxA' }, { t: 1101, type: 'console', text: '[EventManager] Trigger SPIN → CtxB' }, ...(extra.events ?? [])];
    const server = [{ t: 1050, kind: 'http', method: 'POST', url: 'https://x/api/spin?token=a', req: '{"b":1}', status: 200, res: '{"ok":true}' }, ...(extra.server ?? [])];
    writeRun(cfg.stateDir, runId, { events, server });
}

test('P4-T07 a game with no profile: base checks run, profile-dependent ones are `skip`, and skip is never counted as pass', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    cleanRun(cfg, 'clean');
    const r = await call(engine, 'gameplay.evidence.check', { runId: 'clean' });
    assert.equal(r.status, 'ok');
    assert.deepEqual([r.data.pass, r.data.fail, r.data.skip], [3, 0, 3], JSON.stringify(r.data));
    assert.match(r.data.lines.join('\n'), /skip: no-hang,wallet-delta,non-negative \(no profile\)/);
});

test('P4-T07 an unknown game id is treated as "no profile", a profile with unverified keys keeps those checks skipped', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    cleanRun(cfg, 'clean');
    fs.mkdirSync(cfg.profilesDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.profilesDir, 'demo.json'), JSON.stringify({ id: 'demo', gameDir: 'x', wallet: { balance: null, bet: null, win: null }, unverified: ['no keys known'] }));
    const withProfile = await call(engine, 'gameplay.evidence.check', { runId: 'clean', game: 'demo' });
    assert.equal(withProfile.data.skip, 3);
    assert.match(withProfile.data.lines.join('\n'), /not configured in profile|no trace start\/end/);
    const unknown = await call(engine, 'gameplay.evidence.check', { runId: 'clean', game: 'ghost' });
    assert.equal(unknown.data.skip, 3, 'a missing profile file means no profile');
});

test('P4-T07 a profile with a bad field is refused and names the field', () => {
    assert.throws(() => parseProfile({ id: 'bad id!', gameDir: 'g' }), (e) => e.code === 'SCHEMA_MISMATCH' && e.message.includes('id'));
    assert.throws(() => parseProfile({ id: '1', gameDir: 'g', trace: { start: '(' } }), (e) => e.message.includes('trace'));
});

test('base suite finds a duplicate listener, a repeated request and a rejection, and a known duplicate is not a failure', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    writeRun(cfg.stateDir, 'bad', {
        events: [trig(0, 1000, 'SPIN', 'CtxA'), trig(0, 1001, 'SPIN', 'CtxA'), { t: 1500, type: 'unhandledrejection', text: 'Error: swallowed' }],
        server: [{ t: 1010, kind: 'http', method: 'POST', url: 'https://x/mg', req: '{}', status: 200 }, { t: 1030, kind: 'http', method: 'POST', url: 'https://x/mg', req: '{}', status: 200 }],
    });
    const r = await call(engine, 'gameplay.evidence.check', { runId: 'bad' });
    assert.equal(r.status, 'ok', 'a reply that fits its budget is never cut');
    assert.equal(r.data.fail, 3, JSON.stringify(r.data));
    assert.equal(r.data.lines.filter(l => l.startsWith('FAIL')).length, 2, 'only two failures are shown');
    assert.match(r.data.lines.join('\n'), /\+1 more failures/);
    assert.match(r.data.lines.join('\n'), /@\d+/, 'failures carry their seq');
    const full = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'artifacts/bad', r.data.ref), 'utf8')).results.filter(x => x.state === 'fail').map(x => x.name).sort();
    assert.deepEqual(full, ['listener-dup', 'no-unhandled-rejections', 'repeat-requests'], 'nothing is lost: the file has all three');

    fs.mkdirSync(cfg.profilesDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.profilesDir, 'demo2.json'), JSON.stringify({ id: 'demo2', gameDir: 'g', knownDuplicateRegistrations: [{ module: 'CtxA', count: 2 }] }));
    const known = await call(engine, 'gameplay.evidence.check', { runId: 'bad', game: 'demo2' });
    assert.equal(known.data.fail, 2, 'the known duplicate no longer fails');
    assert.ok(!known.data.lines.some(l => l.includes('listener-dup')));
});

test('P4-T08 diff: the same flow with different numbers is the same; extra records show up and nothing else does', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    const flow = (n, extra = []) => ({ events: [{ t: 1, type: 'console', text: `spin ${n} balance 99.${n}` }, { t: 2, type: 'scene-ready', name: 's' }, ...extra], server: [{ t: 3, kind: 'http', method: 'POST', url: `https://x/spin?token=t${n}`, status: 200 }] });
    writeRun(cfg.stateDir, 'runA', flow(1)); writeRun(cfg.stateDir, 'runB', flow(2));
    assert.equal((await call(engine, 'gameplay.evidence.diff', { a: 'runA', b: 'runB' })).data.same, true);

    writeRun(cfg.stateDir, 'runC', flow(3, [{ t: 4, type: 'pageerror', text: 'boom 7' }, { t: 5, type: 'console', text: 'extra line' }]));
    const d = (await call(engine, 'gameplay.evidence.diff', { a: 'runA', b: 'runC' })).data;
    assert.equal(d.same, false);
    assert.deepEqual(d.onlyA, []);
    assert.deepEqual(d.onlyB.map(x => x.key).sort(), ['console||extra line', 'pageerror||boom #']);
    assert.deepEqual(d.changed, []);

    const server = (await call(engine, 'gameplay.evidence.diff', { a: 'runA', b: 'runC', file: 'server.jsonl' })).data;
    assert.equal(server.same, true);
    assert.equal((await call(engine, 'gameplay.evidence.diff', { a: 'runA', b: 'missing' })).error.code, 'SNAPSHOT_EXPIRED');
});

test('P4-K01 a clean check is one short line; a failing check costs <= 150 tokens per failure (estimator uncalibrated, P0-K02)', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    cleanRun(cfg, 'clean');
    await call(engine, 'gameplay.evidence.check', { runId: 'clean' });
    writeRun(cfg.stateDir, 'bad', {
        events: [trig(0, 1000, 'SPIN', 'CtxA'), trig(0, 1001, 'SPIN', 'CtxA'), { t: 1500, type: 'unhandledrejection', text: 'Error: '.padEnd(400, 'x') }],
        server: [{ t: 1010, kind: 'http', method: 'POST', url: 'https://x/' + 'long/'.repeat(30), req: '{}' }, { t: 1030, kind: 'http', method: 'POST', url: 'https://x/' + 'long/'.repeat(30), req: '{}' }],
    });
    const bad = await call(engine, 'gameplay.evidence.check', { runId: 'bad' });
    assert.equal(bad.status, 'ok');
    const failLines = bad.data.lines.filter(l => l.startsWith('FAIL'));
    assert.equal(failLines.length, 2);
    for (const line of failLines) assert.ok(estimateTokens(line) <= 150, `${estimateTokens(line)} tokens: ${line}`);
});

test('P4-K02 the cost of a diff follows the size of the difference, not the size of the runs', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    const big = (n) => Array.from({ length: n }, (_, i) => ({ t: i, type: 'console', text: `tick ${i} value ${i * 7}` }));
    writeRun(cfg.stateDir, 'a', { events: big(2000) });
    writeRun(cfg.stateDir, 'b', { events: [...big(2000), { t: 9, type: 'pageerror', text: 'only here' }] });
    writeRun(cfg.stateDir, 'c', { events: [...big(2000), ...Array.from({ length: 6 }, (_, i) => ({ t: 9, type: 'pageerror', text: `distinct problem ${'x'.repeat(i + 1)} ${'abc'.repeat(i)}` }))] });
    const small = await call(engine, 'gameplay.evidence.diff', { a: 'a', b: 'b' });
    const larger = await call(engine, 'gameplay.evidence.diff', { a: 'a', b: 'c' });
    assert.deepEqual(small.data.onlyB.map(x => x.key), ['pageerror||only here']);
    const runCost = estimateTokens(fs.readFileSync(path.join(cfg.stateDir, 'artifacts/a/events.jsonl'), 'utf8'));
    const [t1, t2] = engine.ledger.map(e => e.responseTokens);
    assert.ok(t2 > t1, `bigger difference costs more: ${t1} vs ${t2}`);
    assert.ok(t2 * 20 < runCost, `diff ${t2} tokens vs one run ${runCost}`);
    assert.ok(larger.status === 'ok' && small.status === 'ok');
});

test('P4-K03 the whole base suite on a 300-line run: ONE call, within budget with a UUID request id', async () => {
    const cfg = testConfig(); const engine = createEngine(cfg);
    cleanRun(cfg, 'clean', { events: Array.from({ length: 300 }, (_, i) => ({ t: 2000 + i, type: 'console', text: `line ${i}` })) });
    const r = await call(engine, 'gameplay.evidence.check', { runId: 'clean' });
    assert.equal(r.status, 'ok');
    assert.equal(engine.ledger.length, 1, 'one call');
    assert.ok(engine.ledger[0].responseTokens <= 250, String(engine.ledger[0].responseTokens));
    console.log(`# P4-K03 measured: ${engine.ledger[0].responseTokens} tokens (est), 6 checks, 1 call`);
});

test('P4-T04 [I] an unhandled promise rejection in a real page is recorded and then flagged', { skip: hasChrome ? false : 'Chrome not installed' }, async () => {
    const fx = await startFixture(); const cfg = testConfig({ chromePath }); const store = new RunStore(cfg.stateDir, 'rej');
    const s = await BrowserSession.open(cfg, store, fx.url + 'reject');
    await s.waitForScene(10000);
    await new Promise(resolve => { const end = Date.now() + 4000; const poll = () => (fs.readFileSync(path.join(store.dir, 'events.jsonl'), 'utf8').includes('unhandledrejection') || Date.now() > end ? resolve() : setTimeout(poll, 50)); poll(); });
    await s.close(); fx.close();
    const events = fs.readFileSync(path.join(store.dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const rejection = events.find(e => e.type === 'unhandledrejection');
    assert.ok(rejection, 'recorded');
    assert.match(rejection.text, /rej boom/);
    assert.equal(noRejections(events).state, 'fail');
});
