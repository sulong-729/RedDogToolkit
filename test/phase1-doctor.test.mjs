// Phase 1: P1-T06, K01, K02. Failures are SIMULATED from fixtures (temp dirs, throwaway local servers, an unreachable port).
// They prove the checks detect each failure; they are not integration runs against a real editor or VPN.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runDoctor, doctorLines } from '../dist/modules/doctor/index.js';
import { realProbes } from '../dist/modules/doctor/probes.js';
import { estimateTokens } from '../dist/modules/tokens/index.js';
import { createEngine } from '../dist/engine.js';
import { testConfig, serve, cocosFixture } from './helpers.mjs';

const withEditor = { ...realProbes(), cocosRunning: () => true };

async function env({ token = true, preview = 'Cocos Creator', chunks = {}, vpn = true } = {}) {
    const server = preview === null ? null : await serve(`<title>${preview}</title>`);
    const staging = vpn ? await serve('ok') : null;
    const cfg = testConfig({
        previewBase: server ? server.url : 'http://127.0.0.1:1/',
        stagingProbeUrl: vpn ? staging.url : 'http://127.0.0.1:1/',
        cocosProject: cocosFixture(chunks),
    });
    if (token) fs.writeFileSync(cfg.tokenFile, 'fake-token-value');
    const close = () => { server?.close(); staging?.close(); };
    return { cfg, close };
}

test('P1-T06 all good: one line', async () => {
    const { cfg, close } = await env();
    const r = await runDoctor(cfg, withEditor);
    close();
    assert.equal(r.status, 'ok');
    assert.deepEqual(doctorLines(r), ['ok 7/7']);
});

test('P1-T06 token file missing -> one FAIL line with its fix', async () => {
    const { cfg, close } = await env({ token: false });
    const lines = doctorLines(await runDoctor(cfg, withEditor));
    close();
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^FAIL token: .* -> /);
});

test('P1-T06 port taken by another server -> FAIL preview', async () => {
    const { cfg, close } = await env({ preview: 'Some Other App' });
    const lines = doctorLines(await runDoctor(cfg, withEditor));
    close();
    assert.ok(lines.some(l => l.startsWith('FAIL preview')), lines.join('|'));
});

test('P1-T06 stale cache (a chunk named by import-map is missing) -> FAIL cache', async () => {
    const { cfg, close } = await env({ chunks: { chunks: ['./chunks/aa/a.js', './chunks/bb/b.js'], missing: ['./chunks/bb/b.js'] } });
    const lines = doctorLines(await runDoctor(cfg, withEditor));
    close();
    assert.ok(lines.some(l => l.startsWith('FAIL cache')), lines.join('|'));
});

test('P1-T06 staging unreachable (stands in for VPN off) -> FAIL vpn', async () => {
    const { cfg, close } = await env({ vpn: false });
    const lines = doctorLines(await runDoctor(cfg, withEditor));
    close();
    assert.ok(lines.some(l => l.startsWith('FAIL vpn')), lines.join('|'));
});

test('P1-T06 sources newer than the compiled output -> FAIL bundle', async () => {
    const { cfg, close } = await env();
    const future = new Date(Date.now() + 120000);
    fs.utimesSync(`${cfg.cocosProject}/assets/a.ts`, future, future);
    const lines = doctorLines(await runDoctor(cfg, withEditor));
    close();
    assert.ok(lines.some(l => l.startsWith('FAIL bundle')), lines.join('|'));
});

test('unconfigured checks are skipped, never reported as passed', async () => {
    const cfg = testConfig({ previewBase: 'http://127.0.0.1:1/' });
    const r = await runDoctor(cfg, withEditor);
    for (const name of ['editor', 'cache', 'bundle', 'vpn']) assert.equal(r.checks.find(c => c.name === name).state, 'skip', name);
});

test('P1-K01 doctor, all good: <= 250 tokens in one call (estimator uncalibrated, P0-K02)', async () => {
    const { cfg, close } = await env();
    const engine = createEngine(cfg, withEditor);
    const result = await engine.call({ formatVersion: 1, requestId: 'k1', operation: 'gameplay.doctor', params: {} });
    close();
    assert.equal(result.status, 'ok');
    assert.equal(engine.ledger.length, 1, 'one call');
    assert.ok(engine.ledger[0].responseTokens <= 250, String(engine.ledger[0].responseTokens));
});

test('P1-K02 doctor, three failures at once: all reported in ONE call within the budget', async () => {
    const { cfg, close } = await env({ token: false, vpn: false, chunks: { chunks: ['./chunks/aa/a.js'], missing: ['./chunks/aa/a.js'] } });
    const engine = createEngine(cfg, withEditor);
    const result = await engine.call({ formatVersion: 1, requestId: 'k2', operation: 'gameplay.doctor', params: {} });
    close();
    const lines = result.data.lines;
    assert.equal(lines.length, 3, lines.join('|'));
    assert.equal(engine.ledger.length, 1, 'one call');
    assert.ok(engine.ledger[0].responseTokens <= 250, String(engine.ledger[0].responseTokens));
    assert.ok(estimateTokens(lines) < 250);
});
