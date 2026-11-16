// Phase 4 [U]: P4-T01..T06 on synthetic evidence. No browser, no network, no game.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
    DEFAULT_TRIGGER, checkWalletChain, detectHangs, detectRepeats, evaluate, exclusiveModes, noRejections, nonNegative, spinsFrom, summarize, traceFrom, validateSchema,
} from '../dist/modules/assertions/index.js';
import { countListeners, staticRegistrationScan } from '../dist/modules/listeners/index.js';
import { add, checkWalletDelta, dec, fmt } from '../dist/modules/money/index.js';
import { tmpDir } from './helpers.mjs';

const consoleLine = (seq, t, text) => ({ seq, t, type: 'console', text });
const ev = (name, t, seq = t) => ({ seq, t, name });

test('P4-T01 listeners are grouped per emit; a context twice inside one emit is a duplicate', () => {
    const lines = [
        consoleLine(1, 1000, '[EventManager] Trigger EV_A → CtxA'), consoleLine(2, 1001, '[EventManager] Trigger EV_A → CtxA'), consoleLine(3, 1002, '[EventManager] Trigger EV_A → CtxB'),
        consoleLine(4, 5000, '[EventManager] Trigger EV_A → CtxA'),
        consoleLine(5, 6000, '[EventManager] Trigger EV_B → CtxC'),
        consoleLine(6, 6001, 'unrelated log'),
    ];
    const stats = countListeners(traceFrom(lines, DEFAULT_TRIGGER));
    const a = stats.find(s => s.event === 'EV_A');
    assert.deepEqual([a.emits, a.maxListeners, a.duplicateContexts], [2, 3, ['CtxA']]);
    assert.deepEqual(stats.find(s => s.event === 'EV_B').duplicateContexts, []);
});

test('P4-T01 static scan finds an event registered twice across files, and ignores single registrations', () => {
    const game = tmpDir('game-');
    fs.mkdirSync(path.join(game, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(game, 'scripts/A.ts'), "this.eventManager.on('SPIN', this.a, this);\nthis.eventManager.on('ONCE', this.b, this);");
    fs.writeFileSync(path.join(game, 'scripts/B.ts'), "this.eventManager.on('SPIN', this.c, this);");
    const found = staticRegistrationScan(game);
    assert.deepEqual(found.map(f => [f.event, f.total]), [["'SPIN'", 2]]);
});

test('P4-T02 sequence specs: once, order, any, never, within, count inside a window', () => {
    const trace = [ev('PreResume', 100), ev('Resume', 150), ev('TurnStart', 200), ev('mg', 210), ev('TurnEnd', 400), ev('TurnStart', 500), ev('mg', 510), ev('mg', 520), ev('TurnEnd', 600)];
    assert.equal(evaluate({ once: 'PreResume' }, trace).state, 'pass');
    assert.equal(evaluate({ once: 'mg' }, trace).state, 'fail');
    assert.equal(evaluate({ order: ['PreResume', 'Resume', 'TurnEnd'] }, trace).state, 'pass');
    assert.equal(evaluate({ order: ['Resume', 'PreResume'] }, trace).state, 'fail');
    assert.equal(evaluate({ any: ['TurnEnd', 'Resume'] }, trace).state, 'pass');
    assert.match(evaluate({ any: ['Nope'] }, trace).detail, /missing: Nope/);
    assert.equal(evaluate({ never: 'Crash' }, trace).state, 'pass');
    assert.equal(evaluate({ never: 'Resume' }, trace).state, 'fail');
    assert.equal(evaluate({ within: ['PreResume', 'Resume', 100] }, trace).state, 'pass');
    assert.match(evaluate({ within: ['PreResume', 'Resume', 10] }, trace).detail, /50ms after/);
    const perTurn = evaluate({ count: 'mg', between: ['TurnStart', 'TurnEnd'] }, trace);
    assert.equal(perTurn.state, 'fail', 'second turn has two mg');
    assert.match(perTurn.detail, /window 2/);
    assert.deepEqual(perTurn.seq, [510, 520]);
});

test('P4-T03 the same call twice within the window is reported with where; reads and spaced calls are not', () => {
    const post = (seq, t) => ({ seq, t, kind: 'http', method: 'POST', url: 'https://x/api/mg?token=a', req: '{"bet":1}', status: 200 });
    const r = detectRepeats([post(1, 1000), post(2, 1040)], 150);
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.seq, [1, 2]);
    assert.match(r.detail, /POST https:\/\/x\/api\/mg/);
    assert.equal(detectRepeats([post(1, 1000), post(2, 2000)], 150).state, 'pass', 'spaced out');
    assert.equal(detectRepeats([{ ...post(1, 1000), method: 'GET' }, { ...post(2, 1005), method: 'GET' }]).state, 'pass', 'reads are not calls');
    assert.equal(detectRepeats([{ seq: 1, t: 5, kind: 'ws-send', data: 'x' }, { seq: 2, t: 9, kind: 'ws-send', data: 'x' }]).state, 'fail');
    assert.equal(detectRepeats([post(1, 1000), { ...post(2, 1010), req: '{"bet":2}' }]).state, 'pass', 'different body');
});

test('P4-T04 a command that never finishes is reported by name; finished ones are not', () => {
    const starts = [ev('playBoss', 100, 1), ev('playGuard', 120, 2)], ends = [ev('playBoss', 400, 3)];
    const r = detectHangs(starts, ends, 1000, 5000);
    assert.equal(r.state, 'fail');
    assert.match(r.detail, /playGuard started and never finished/);
    assert.equal(detectHangs(starts, [...ends, ev('playGuard', 900, 4)], 1000, 5000).state, 'pass');
    assert.equal(detectHangs(starts, ends, 10000, 5000).state, 'pass', 'not yet over the threshold');
});

test('P4-T04 unhandled rejections in the evidence are reported', () => {
    assert.equal(noRejections([{ seq: 1, t: 1, type: 'console', text: 'x' }]).state, 'pass');
    const r = noRejections([{ seq: 7, t: 1, type: 'unhandledrejection', text: 'Error: Handle Back To Real Mode' }]);
    assert.equal(r.state, 'fail');
    assert.deepEqual(r.seq, [7]);
});

test('P4-T05 money is exact: 0.1 + 0.2 equals 0.3 and no float error creeps in', () => {
    assert.equal(add(dec(0.1), dec(0.2)), dec(0.3));
    assert.equal(fmt(add(dec('0.1'), dec('0.2'))), '0.3');
    assert.equal(fmt(dec('-12.5')), '-12.5');
    assert.throws(() => dec('1.123456789'), /too many decimals/);
    assert.throws(() => dec('abc'), /not a money amount/);
    assert.equal(checkWalletDelta({ before: 100, bet: 1, win: 0.1, after: 99.1 }).pass, true);
    const bad = checkWalletDelta({ before: 100, bet: 1, win: 0, after: 98.9 });
    assert.deepEqual([bad.pass, bad.expected, bad.actual, bad.diff], [false, '99', '98.9', '-0.1']);
    assert.equal(checkWalletDelta({ before: 100, bet: 1, win: 0, after: 98.9 }, 0.2).pass, true, 'explicit tolerance');
});

test('P4-T05 the wallet chain is checked on server records, from the second spin on', () => {
    const rec = (seq, balance, bet, win) => ({ seq, t: seq, kind: 'http', res: JSON.stringify({ result: { bal: balance, bet, win } }) });
    const keys = { balance: 'bal', bet: 'bet', win: 'win' };
    const good = spinsFrom([rec(1, 100, 1, 0), rec(2, 99, 1, 0), rec(3, 99.5, 1, 1.5)], keys);
    assert.equal(good.length, 3);
    assert.equal(checkWalletChain(good).state, 'pass');
    const bad = checkWalletChain(spinsFrom([rec(1, 100, 1, 0), rec(2, 99, 1, 0), rec(3, 98.9, 1, 0)], keys));
    assert.equal(bad.state, 'fail');
    assert.match(bad.detail, /spin 3: expected 98, got 98.9/);
    assert.deepEqual(bad.seq, [2, 3]);
    assert.equal(checkWalletChain(good.slice(0, 1)).state, 'skip', 'one spin is not enough');
});

test('P4-T06 schema errors name the path; invariants catch negatives and conflicting modes', () => {
    const schema = z.object({ spin: z.object({ win: z.number(), lines: z.array(z.string()) }) });
    assert.equal(validateSchema('s', { spin: { win: 1, lines: [] } }, schema).state, 'pass');
    const r = validateSchema('s', { spin: { win: 'x' } }, schema);
    assert.equal(r.state, 'fail');
    assert.match(r.detail, /spin\.win/);
    assert.match(r.detail, /spin\.lines/);

    const rec = (seq, body) => ({ seq, t: seq, kind: 'http', res: JSON.stringify(body) });
    assert.equal(nonNegative([rec(1, { left: 3 })], ['left']).state, 'pass');
    const neg = nonNegative([rec(1, { left: 3 }), rec(2, { data: { left: -1 } })], ['left']);
    assert.equal(neg.state, 'fail');
    assert.deepEqual(neg.seq, [2]);

    const modes = { a: { name: 'FREE', enter: 'EnterFree', exit: 'ExitFree' }, b: { name: 'BONUS', enter: 'EnterBonus', exit: 'ExitBonus' } };
    assert.equal(exclusiveModes([ev('EnterFree', 1), ev('ExitFree', 2), ev('EnterBonus', 3)], modes).state, 'pass');
    assert.equal(exclusiveModes([ev('EnterFree', 1), ev('EnterBonus', 2)], modes).state, 'fail');
});

test('summarize: a clean run is one line, failures are short lines with their seq, skips are grouped', () => {
    const clean = summarize([{ name: 'a', state: 'pass' }, { name: 'b', state: 'pass' }]);
    assert.deepEqual(clean.lines, ['ok 2']);
    const mixed = summarize([{ name: 'a', state: 'pass' }, { name: 'repeat', state: 'fail', detail: 'POST /x sent 2x within 40ms', seq: [4, 5] }, { name: 'w', state: 'skip', detail: 'no profile' }, { name: 'n', state: 'skip', detail: 'no profile' }]);
    assert.deepEqual([mixed.pass, mixed.fail, mixed.skip], [1, 1, 2]);
    assert.equal(mixed.lines[0], 'FAIL repeat: POST /x sent 2x within 40ms @4,5');
    assert.equal(mixed.lines[1], 'skip: w,n (no profile)');
});
