// The HTTP cheat adapter, against a FAKE cheat server on loopback. No real host, no real token, no real game.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createEngine } from '../dist/engine.js';
import { cheatUrl } from '../dist/modules/cheat/index.js';
import { parseProfile } from '../dist/modules/profile/index.js';
import { testConfig } from './helpers.mjs';

const TOKEN = 'FAKE_CHEAT_TOKEN_QQ77';
const uuid = () => crypto.randomUUID();

/** A fake cheat API. `mode` decides how it answers; every request is recorded. */
async function fakeServer() {
    const seen = []; const state = { mode: 'ok' };
    const server = http.createServer((req, res) => {
        let body = ''; req.on('data', c => { body += c; });
        req.on('end', () => {
            seen.push({ method: req.method, url: req.url, headers: req.headers, body });
            if (state.mode === 'reset') return req.socket.destroy();
            if (state.mode === 'redirect') { res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/elsewhere` }); return res.end(); }
            if (state.mode === '500') { res.writeHead(500); return res.end('boom'); }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`ok for ${new URL(req.url, 'http://x').searchParams.get('userId') ?? new URLSearchParams(body).get('userId')}`);   // echoes the user id on purpose
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { seen, state, port: server.address().port, close: () => server.closeAllConnections() || server.close() };
}

const cheatBlock = (port, extra = {}) => ({
    baseUrl: `http://127.0.0.1:${port}/{env}`, serviceId: 'svc', sendPath: 'endpointx',
    presets: { freegame: { matrixData: 'AAA,BBB', tableFormat: 'fmt1' }, 'big win': { matrixData: 'CCC' } }, ...extra,
});

async function setup({ withToken = true, block } = {}) {
    const srv = await fakeServer(); const cfg = testConfig();
    fs.mkdirSync(cfg.profilesDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.profilesDir, 'demo.json'), JSON.stringify({ id: 'demo', gameDir: 'x', cheat: block ?? cheatBlock(srv.port) }));
    fs.writeFileSync(path.join(cfg.profilesDir, 'nocheat.json'), JSON.stringify({ id: 'nocheat', gameDir: 'x' }));
    if (withToken) { fs.mkdirSync(path.dirname(cfg.tokenFile), { recursive: true }); fs.writeFileSync(cfg.tokenFile, TOKEN + '\n'); }
    const engine = createEngine(cfg);
    const call = (op, params) => engine.call({ formatVersion: 1, requestId: uuid(), operation: op, params });
    const plan = (params) => call('gameplay.cheat.plan', { game: 'demo', preset: 'freegame', ...params });
    const apply = (hash) => call('gameplay.cheat', { planHash: hash });
    const approved = async (params) => { const p = await plan(params); engine.approvals.approve(p.data.hash); return p.data.hash; };
    return { srv, cfg, engine, call, plan, apply, approved };
}
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];

test('P5-T11 planning validates everything and writes nothing to any backend; the plan carries no token', async () => {
    const t = await setup();
    try {
        const ok = await t.plan();
        assert.equal(ok.status, 'ok');
        assert.match(ok.data.hash, /^[0-9a-f]{64}$/);
        assert.match(ok.data.mutations.join(' '), /preset "freegame"/);
        assert.match(ok.data.mutations.join(' '), /no Clear Session/);
        assert.equal((await t.plan({ preset: 'nope' })).error.code, 'NOT_FOUND');
        assert.equal((await t.plan({ preset: undefined })).error.code, 'SCHEMA_MISMATCH');
        assert.equal((await t.plan({ environment: 'dev' })).error.code, 'WRITE_GUARD', 'dev is not an allowed environment for this profile');
        assert.equal((await t.plan({ game: 'nocheat' })).error.code, 'UNAVAILABLE_CAPABILITY');
        assert.equal((await t.plan({ game: 'ghost' })).error.code, 'NOT_FOUND');
        assert.equal(t.srv.seen.length, 0, 'planning sent nothing');
        for (const f of walk(path.join(t.cfg.stateDir, 'plans'))) assert.ok(!fs.readFileSync(f, 'utf8').includes(TOKEN), f);
    } finally { t.srv.close(); }
});

test('P5-T11 a missing token file is refused at PLAN time, before any approval can be spent', async () => {
    const t = await setup({ withToken: false });
    try {
        const r = await t.plan();
        assert.equal(r.error.code, 'ENV_FAILED');
        assert.equal(fs.existsSync(path.join(t.cfg.stateDir, 'plans')), false, 'no plan was stored');
    } finally { t.srv.close(); }
});

test('P5-T12 without a human approval nothing is sent: no approval, a wrong hash, and a flag all fail', async () => {
    const t = await setup();
    try {
        const p = await t.plan();
        assert.equal((await t.apply(p.data.hash)).error.code, 'WRITE_GUARD', 'planned but not approved');
        assert.equal((await t.apply('f'.repeat(64))).error.code, 'WRITE_GUARD');
        assert.equal((await t.call('gameplay.cheat', { planHash: p.data.hash, approved: true })).error.code, 'SCHEMA_MISMATCH');
        assert.equal(t.srv.seen.length, 0);
    } finally { t.srv.close(); }
});

test('P5-T13 an approved send is exactly one POST with the documented shape and no credentials', async () => {
    const t = await setup();
    try {
        const hash = await t.approved();
        const r = await t.apply(hash);
        assert.equal(r.status, 'ok');
        assert.equal(r.data.outcome, 'sent');
        assert.equal(t.srv.seen.length, 1);
        const [req] = t.srv.seen;
        assert.equal(req.method, 'POST');
        assert.equal(req.url, '/staging/svc/endpointx');
        assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded;charset=UTF-8');
        assert.ok(!req.headers.authorization && !req.headers.cookie && !req.headers.origin, 'no credentials, no Origin');
        const body = new URLSearchParams(req.body);
        assert.deepEqual([...body.keys()].sort(), ['matrixData', 'serviceId', 'tableFormat', 'userId']);
        assert.deepEqual([body.get('serviceId'), body.get('matrixData'), body.get('tableFormat')], ['svc', 'AAA,BBB', 'fmt1']);
        assert.equal(body.get('userId'), TOKEN, 'the server did receive the user id from the token file');
    } finally { t.srv.close(); }
});

test('P5-T14 an approval is single use: a second apply with the same hash sends nothing', async () => {
    const t = await setup();
    try {
        const hash = await t.approved();
        assert.equal((await t.apply(hash)).status, 'ok');
        assert.equal((await t.apply(hash)).error.code, 'WRITE_GUARD');
        assert.equal(t.srv.seen.length, 1);
    } finally { t.srv.close(); }
});

test('P5-T15 Clear Session is its own plan and its own POST, with the user in the query', async () => {
    const t = await setup();
    try {
        const p = await t.plan({ action: 'clear-session', preset: undefined });
        assert.match(p.data.mutations.join(' '), /session is LOST/);
        assert.equal(p.status, 'ok', JSON.stringify(p));
        t.engine.approvals.approve(p.data.hash);
        const applied = await t.apply(p.data.hash);
        assert.equal(applied.status, 'ok', JSON.stringify(applied));
        const [req] = t.srv.seen;
        assert.equal(req.method, 'POST');
        assert.equal(req.url, `/staging/svc/clearsession?userId=${TOKEN}&currency=usd`);
        assert.equal(req.body, '');
    } finally { t.srv.close(); }
});

test('P5-T16 the token appears in no reply, no ledger line, no plan and no approval file, even when the server echoes it', async () => {
    const t = await setup();
    try {
        const hash = await t.approved();
        const r = await t.apply(hash);
        assert.match(r.data.bodyHead, /^ok for \[REDACTED\]/, 'the server echoed the id; the reply masks it');
        const all = [JSON.stringify(r), ...walk(t.cfg.stateDir).map(f => fs.readFileSync(f, 'utf8'))];
        for (const text of all) assert.ok(!text.includes(TOKEN), 'token leaked');
    } finally { t.srv.close(); }
});

test('P5-T17 an unknown outcome is `indeterminate`, is never retried, and a redirect is not followed', async () => {
    const t = await setup();
    try {
        t.srv.state.mode = 'reset';
        const r = await t.apply(await t.approved());
        assert.equal(r.status, 'indeterminate');
        assert.equal(r.data.outcome, 'unknown');
        assert.equal(t.srv.seen.length, 1, 'one attempt, no automatic retry');

        t.srv.state.mode = 'redirect';
        const redirected = await t.apply(await t.approved());
        assert.equal(redirected.status, 'indeterminate');
        assert.ok(!t.srv.seen.some(s => s.url === '/elsewhere'), 'the redirect target was never contacted');
    } finally { t.srv.close(); }
});

test('P5-T17 a server error is an error, not "unknown": the server answered', async () => {
    const t = await setup();
    try {
        t.srv.state.mode = '500';
        const r = await t.apply(await t.approved());
        assert.equal(r.status, 'error');
        assert.equal(r.error.code, 'ENV_FAILED');
        assert.match(r.error.message, /answered 500/);
    } finally { t.srv.close(); }
});

test('P5-T18 profile and URL rules: https or loopback only, no credentials, safe path segments, staging by default', () => {
    const base = { id: 'demo', gameDir: 'x' };
    const ok = parseProfile({ ...base, cheat: { baseUrl: 'https://cheat.{env}.example.test', serviceId: 'svc', sendPath: 'send', presets: { a: { matrixData: 'X' } } } });
    assert.deepEqual(ok.cheat.allowedEnvironments, ['staging']);
    assert.equal(cheatUrl(ok.cheat, 'staging', 'send').toString(), 'https://cheat.staging.example.test/svc/send');
    assert.equal(cheatUrl(ok.cheat, 'dev', 'clear-session').toString(), 'https://cheat.dev.example.test/svc/clearsession');
    const bad = (cheat, field) => assert.throws(() => parseProfile({ ...base, cheat }), (e) => e.code === 'SCHEMA_MISMATCH' && e.message.includes(field), JSON.stringify(cheat).slice(0, 60));
    const good = { baseUrl: 'https://c.example.test', serviceId: 'svc', sendPath: 'send', presets: {} };
    bad({ ...good, baseUrl: 'http://cheat.example.test' }, 'baseUrl');
    bad({ ...good, baseUrl: 'https://user:pw@cheat.example.test' }, 'baseUrl');
    bad({ ...good, baseUrl: 'https://cheat.example.test/?x=1' }, 'baseUrl');
    bad({ ...good, sendPath: '../admin' }, 'sendPath');
    bad({ ...good, serviceId: 'a/b' }, 'serviceId');
});

test('P5-K05 the plan reply stays within its budget with a UUID request id (estimator uncalibrated, P0-K02)', async () => {
    const t = await setup();
    try {
        const r = await t.plan();
        assert.equal(r.status, 'ok');
        assert.ok(t.engine.ledger[0].responseTokens <= 320, String(t.engine.ledger[0].responseTokens));
    } finally { t.srv.close(); }
});

test('P5-K06 the apply reply is tiny, and a whole cheat is two calls (plan, apply)', async () => {
    const t = await setup();
    try {
        const p = await t.plan(); t.engine.approvals.approve(p.data.hash);
        const r = await t.apply(p.data.hash);
        assert.equal(r.status, 'ok');
        assert.equal(t.engine.ledger.length, 2, 'two agent calls for a whole cheat');
        assert.ok(t.engine.ledger[1].responseTokens <= 140, String(t.engine.ledger[1].responseTokens));
        console.log(`# P5-K06 measured: plan ${t.engine.ledger[0].responseTokens} + apply ${t.engine.ledger[1].responseTokens} tokens (est), 2 calls`);
    } finally { t.srv.close(); }
});
