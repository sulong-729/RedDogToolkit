// Phase 1: P1-T03, T04, T07. The approval step is called directly; in real use only a person runs `reddog approve`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createEngine } from '../dist/engine.js';
import { Approvals, RunLock } from '../dist/modules/guard/index.js';
import { validateCapability } from '../dist/registry/validate.js';
import { testConfig } from './helpers.mjs';

function engineWithWrite(clock) {
    const cfg = testConfig();
    const approvals = new Approvals(cfg.stateDir, clock);
    const engine = createEngine(cfg, undefined, approvals);
    let writes = 0;
    engine.registry.register(validateCapability({
        name: 'gameplay.testwrite', area: 'gameplay', process: 'runner', readOnly: false, availability: 'available', facade: 'apply',
        resultBudgetTokens: 100, verification: 'P1-T03', inputSchema: z.object({ planHash: z.string() }).strict(),
        handler: () => { writes++; return { wrote: true }; },
    }));
    const call = (params) => engine.call({ formatVersion: 1, requestId: 'r', operation: 'gameplay.testwrite', params });
    return { engine, approvals, call, writes: () => writes, cfg };
}
const plan = (op = 'gameplay.testwrite') => ({ operation: op, params: { game: 'demo' }, mutations: ['cheat freegame'] });
const code = (r) => r.error?.code;

test('P1-T03 a write with no plan, a bad hash, or an "approved" flag is refused and nothing is written', async () => {
    const { call, writes } = engineWithWrite();
    assert.equal(code(await call({ planHash: 'x' })), 'WRITE_GUARD');
    assert.equal(code(await call({ planHash: 'a'.repeat(64) })), 'WRITE_GUARD');
    assert.equal(code(await call({ planHash: 'a'.repeat(64), approved: true })), 'SCHEMA_MISMATCH');
    assert.equal(writes(), 0);
});

test('P1-T04 an approved plan runs once; replay, tampering, wrong operation and expiry are all refused', async () => {
    const { approvals, call, writes, cfg } = engineWithWrite();

    const { hash } = approvals.propose(plan());
    assert.equal(code(await call({ planHash: hash })), 'WRITE_GUARD', 'proposed but not approved');
    approvals.approve(hash);
    assert.equal((await call({ planHash: hash })).status, 'ok');
    assert.equal(code(await call({ planHash: hash })), 'WRITE_GUARD', 'approval is single use');

    const tampered = approvals.propose({ ...plan(), mutations: ['harmless'] });
    approvals.approve(tampered.hash);
    const file = path.join(cfg.stateDir, 'plans', tampered.hash + '.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.plan.mutations = ['something else'];
    fs.writeFileSync(file, JSON.stringify(stored));
    assert.equal(code(await call({ planHash: tampered.hash })), 'WRITE_GUARD', 'plan content changed after approval');

    const other = approvals.propose(plan('gameplay.cheat'));
    approvals.approve(other.hash);
    assert.equal(code(await call({ planHash: other.hash })), 'WRITE_GUARD', 'plan is for another operation');

    assert.equal(writes(), 1);
});

test('P1-T04 an approval expires', async () => {
    let now = 1_000_000;
    const { approvals, call, writes } = engineWithWrite(() => now);
    const { hash } = approvals.propose(plan());
    approvals.approve(hash);
    now += 11 * 60 * 1000;
    assert.equal(code(await call({ planHash: hash })), 'WRITE_GUARD');
    assert.equal(writes(), 0);
});

test('approval is not reachable through the registry or the facade tools', () => {
    const { engine } = engineWithWrite();
    const names = engine.registry.describe().map(c => c.name);
    assert.ok(!names.some(n => /approv/i.test(n)));
});

test('P1-T07 a second run for the same user is refused with BUSY; a dead holder is reclaimed', () => {
    const cfg = testConfig();
    const lock = new RunLock(cfg.stateDir);
    const release = lock.acquire('user_a');
    assert.throws(() => lock.acquire('user_a'), (e) => e.code === 'BUSY');
    lock.acquire('user_b')();
    release();
    lock.acquire('user_a')();

    const file = path.join(cfg.stateDir, 'locks', 'user_c.lock');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '99999999');
    lock.acquire('user_c')();
});

test('a plan with an undefined field hashes the same before and after it is stored, so a valid approval is not refused', async () => {
    const { approvals, call } = engineWithWrite();
    const withUndefined = { operation: 'gameplay.testwrite', params: { game: 'demo', preset: undefined }, mutations: ['x'] };
    const { hash } = approvals.propose(withUndefined);
    assert.equal(hash, approvals.propose({ operation: 'gameplay.testwrite', params: { game: 'demo' }, mutations: ['x'] }).hash, 'undefined and absent are the same plan');
    approvals.approve(hash);
    assert.equal((await call({ planHash: hash })).status, 'ok');
});
