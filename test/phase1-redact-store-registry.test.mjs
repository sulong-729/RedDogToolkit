// Phase 1: P1-T01, T02, T05, T08, T09, K03, K04. All offline [U]; the CLI case spawns the built CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { redactText, redactValue, registerSecret } from '../dist/modules/redact/index.js';
import { RunStore } from '../dist/modules/store/index.js';
import { validateCapability } from '../dist/registry/validate.js';
import { createEngine } from '../dist/engine.js';
import { KitError } from '../dist/contracts/index.js';
import { fitBudget, estimateTokens } from '../dist/modules/tokens/index.js';
import { testConfig } from './helpers.mjs';

test('P1-T01 masks ?token=, Bearer and registered secrets', () => {
    registerSecret('SUPERSECRET123');
    const out = redactText('GET /x?token=abc123&c=usd body SUPERSECRET123 Bearer zzz.yyy');
    for (const leaked of ['abc123', 'SUPERSECRET123', 'zzz.yyy']) assert.ok(!out.includes(leaked), leaked);
    assert.ok(out.includes('c=usd'));
});

test('P1-T02 an error carrying a token URL is masked in the engine response', async () => {
    const engine = createEngine(testConfig());
    engine.registry.register(validateCapability({
        name: 'gameplay.leaky', area: 'gameplay', process: 'runner', readOnly: true, availability: 'available', facade: 'query',
        resultBudgetTokens: 400, verification: 'P1-T02', inputSchema: z.object({}).strict(),
        handler: () => { throw new KitError('ENV_FAILED', 'GET http://h/?token=tok_LEAK_999 failed', 'retry'); },
    }));
    const result = await engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.leaky', params: {} });
    assert.equal(result.status, 'error');
    assert.ok(!JSON.stringify(result).includes('tok_LEAK_999'));
});

test('P1-T05 unimplemented capability: exit 2 with valid params, exit 1 with invalid params', () => {
    const cfg = testConfig();
    const file = path.join(path.dirname(cfg.stateDir), 'config.json');
    fs.writeFileSync(file, JSON.stringify({ stateDir: cfg.stateDir, tokenFile: cfg.tokenFile }));
    const run = (extra) => spawnSync('node', ['dist/adapters/cli.js', 'run', 'gameplay.run', ...extra], { env: { ...process.env, REDDOG_CONFIG: file }, encoding: 'utf8' });
    const good = run(['--params', '{"game":"demo","scenario":"free-flow"}']);
    assert.equal(good.status, 2, good.stdout);
    assert.match(good.stdout, /UNAVAILABLE_CAPABILITY/);
    assert.equal(run([]).status, 1);
});

test('P1-T08 no secret lands in any artifact file', () => {
    const cfg = testConfig();
    registerSecret('GAMETOKEN_ABCDEF');
    const store = new RunStore(cfg.stateDir, 'observe');
    store.flow('open http://h/?token=GAMETOKEN_ABCDEF');
    store.append('events.jsonl', { type: 'console', text: 'Bearer GAMETOKEN_ABCDEF and GAMETOKEN_ABCDEF' });
    store.append('server.jsonl', { url: 'http://h/api?token=GAMETOKEN_ABCDEF', n: 1 });
    store.writeJson('result.json', { note: 'GAMETOKEN_ABCDEF' });
    store.close();
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const files = walk(store.dir);
    assert.ok(files.length >= 5);
    for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('GAMETOKEN_ABCDEF'), f);
});

test('store cap: records past the cap are dropped and counted, never silently', () => {
    const cfg = testConfig();
    const store = new RunStore(cfg.stateDir, 'cap', { maxBytesPerFile: 300 });
    for (let i = 0; i < 20; i++) store.append('server.jsonl', { i, pad: 'x'.repeat(40) });
    store.close();
    assert.ok(store.dropped['server.jsonl'] > 0);
    assert.match(fs.readFileSync(path.join(store.dir, 'flow.log'), 'utf8'), /cap reached/);
});

test('P1-T09 a capability missing a required field is refused and the field is named', () => {
    const base = { name: 'gameplay.x', area: 'gameplay', process: 'runner', readOnly: true, availability: 'unavailable', facade: 'query', resultBudgetTokens: 100, verification: 'P1', inputSchema: z.object({}) };
    validateCapability(base);
    for (const field of ['verification', 'resultBudgetTokens', 'facade', 'readOnly']) {
        const broken = { ...base }; delete broken[field];
        assert.throws(() => validateCapability(broken), (e) => e.code === 'SCHEMA_MISMATCH' && e.message.includes(field), field);
    }
    assert.throws(() => validateCapability({ ...base, availability: 'available' }), /available without a handler/);
    assert.throws(() => validateCapability({ ...base, name: 'run.x' }), (e) => e.message.includes('name'));
});

test('P1-K04 over-budget response is cut, flagged and spilled to disk (estimator uncalibrated, P0-K02)', () => {
    const cfg = testConfig();
    const big = { formatVersion: 1, requestId: 'big', status: 'ok', warnings: [], data: { rows: Array.from({ length: 300 }, (_, i) => ({ i, text: 'row' + i })) } };
    const out = fitBudget(big, 250, path.join(cfg.stateDir, 'overflow'));
    assert.equal(out.status, 'partial');
    assert.equal(out.data.truncated, true);
    assert.equal(out.cost.budgetExceeded, true);
    assert.ok(out.cost.responseTokens < estimateTokens(big));
    const spilled = JSON.parse(fs.readFileSync(path.join(cfg.stateDir, out.data.resultRef), 'utf8'));
    assert.equal(spilled.data.rows.length, 300);
    const small = fitBudget({ formatVersion: 1, requestId: 's', status: 'ok', warnings: [], data: { ok: true } }, 250, path.join(cfg.stateDir, 'overflow'));
    assert.equal(small.cost, undefined, 'within budget: no cost field (it would add tokens to every call)');
});

test('an over-budget ERROR stays an error (never hidden as a partial result)', () => {
    const cfg = testConfig();
    const err = { formatVersion: 1, requestId: 'e', status: 'error', warnings: [], error: { code: 'ENV_FAILED', message: 'x'.repeat(400), recovery: 'y' } };
    const out = fitBudget(err, 50, path.join(cfg.stateDir, 'overflow'));
    assert.equal(out.status, 'error');
    assert.equal(out.error.code, 'ENV_FAILED');
    assert.equal(out.cost.budgetExceeded, true);
    assert.ok(!fs.existsSync(path.join(cfg.stateDir, 'overflow')));
});

test('P1-K03 every guard error stays within 60 tokens (message + recovery)', async () => {
    const { Approvals } = await import('../dist/modules/guard/index.js');
    const cfg = testConfig();
    const a = new Approvals(cfg.stateDir);
    const errors = [];
    for (const attempt of [() => a.consume('nope', 'gameplay.cheat'), () => a.consume('a'.repeat(64), 'gameplay.cheat'), () => a.approve('b'.repeat(64))]) {
        try { attempt(); } catch (e) { errors.push(e); }
    }
    assert.equal(errors.length, 3);
    for (const e of errors) assert.ok(estimateTokens(e.message + ' ' + e.recovery) <= 60, e.message);
});
