import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, listCapabilities } from '../dist/engine.js';
import { facadeTools } from '../dist/contracts/index.js';
import { testConfig } from './helpers.mjs';

const engine = () => createEngine(testConfig());

test('registry lists the 16 gameplay capabilities; only the implemented ones are available', () => {
    const list = listCapabilities(engine().registry);
    assert.equal(list.length, 16);
    assert.ok(list.every(c => c.name.startsWith('gameplay.')));
    assert.deepEqual(list.filter(c => c.availability === 'available').map(c => c.name).sort(),
        ['gameplay.doctor', 'gameplay.evidence.check', 'gameplay.evidence.diff', 'gameplay.evidence.events', 'gameplay.evidence.listeners', 'gameplay.evidence.server',
            'gameplay.evidence.ui', 'gameplay.frames', 'gameplay.frames.analyze', 'gameplay.freshness', 'gameplay.observe', 'gameplay.screenshot']);
});

test('exactly six facade tools', () => {
    assert.equal(facadeTools.length, 6);
});

test('dispatch of an unimplemented capability is refused, never faked', async () => {
    const result = await engine().call({ formatVersion: 1, requestId: 'smoke', operation: 'gameplay.tokens', params: {} });
    assert.equal(result.status, 'error');
    assert.equal(result.error?.code, 'UNAVAILABLE_CAPABILITY');
});

test('unknown operation is refused', async () => {
    const result = await engine().call({ formatVersion: 1, requestId: 'smoke', operation: 'gameplay.nope', params: {} });
    assert.equal(result.error?.code, 'UNKNOWN_OPERATION');
});

test('describe of one operation includes a JSON schema', () => {
    const [one] = engine().registry.describe('gameplay.run');
    assert.ok(one.inputSchema);
});
