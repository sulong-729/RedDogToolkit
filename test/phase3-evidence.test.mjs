// Phase 3 [I]: P3-T01..T05, T08, K01..K03 against the FAKE GAME in test/fixture.mjs (not the real engine). Needs Chrome.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createEngine } from '../dist/engine.js';
import { BrowserSession } from '../dist/modules/browser/index.js';
import { RunStore } from '../dist/modules/store/index.js';
import { testConfig } from './helpers.mjs';
import { startFixture, chromePath, hasChrome } from './fixture.mjs';

const opts = { skip: hasChrome ? false : 'Chrome not installed' };
const cfg = () => testConfig({ chromePath });
const call = (engine, op, params, id = crypto.randomUUID()) => engine.call({ formatVersion: 1, requestId: id, operation: op, params });
const runDir = (c, run) => path.join(c.stateDir, 'artifacts', run);
const jsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('P3-T01 screenshot: a PNG plus metadata on disk, the reply is a path and a price, no image bytes', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const r = await call(engine, 'gameplay.screenshot', { target: fx.url + 'game', checkpoint: 'start' });
    fx.close();
    assert.equal(r.status, 'ok');
    const dir = runDir(c, r.data.run);
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, r.data.file)));
    assert.deepEqual([png.width, png.height], [720, 1280]);
    const metaFile = path.join(dir, r.data.file.replace(/\.png$/, '.meta.json'));
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.equal(meta.checkpoint, 'start');
    assert.equal(r.data.imgTok, 1229);
    assert.ok(!JSON.stringify(r).match(/iVBOR|base64/), 'no image data in the reply');
});

test('P3-T02 the sampler records only watched nodes, only changes, and `until` waits on a condition', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const r = await call(engine, 'gameplay.observe', { target: fx.url + 'game', watch: ['wallet'], every: 2, until: { path: 'wallet', equals: '105.50', timeoutMs: 8000 } });
    fx.close();
    assert.equal(r.data.until, true);
    const records = jsonl(path.join(runDir(c, r.data.run), 'ui-frames.jsonl'));
    const changes = records.flatMap(x => Object.entries(x.changes));
    assert.deepEqual(changes.map(([k, v]) => `${k}=${v}`), ['demoScene/Canvas/Hud/wallet=100.00', 'demoScene/Canvas/Hud/wallet=105.50'], 'initial value then the one change, nothing else');
    const text = JSON.stringify(records);
    for (const unwatched of ['tooltip', 'secret', 'ghost']) assert.ok(!text.includes(unwatched), unwatched + ' was not watched');
    const read = await call(engine, 'gameplay.evidence.ui', { runId: r.data.run });
    assert.equal(read.data.lines.length, 2);
});

test('P3-T03 Spine animation@timeScale from the sampler equals a direct read of the page', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't3');
    const s = await BrowserSession.open(c, store, fx.url + 'game', { watch: ['boss'], every: 2 });
    assert.equal(await s.waitUntil('boss#spine', 'hit@0', 8000), true);
    const direct = await s.evaluate(`(() => { const b = window.cc.director.getScene().children[0].children[1]; const sk = b.comps[0]; return sk.getCurrent().animation.name + '@' + sk.timeScale; })()`);
    const seen = Object.entries(s.ui).find(([k]) => k.includes('boss#spine'))[1];
    await s.close(); fx.close();
    assert.equal(seen, direct);
    assert.equal(seen, 'hit@0');
    const values = jsonl(path.join(store.dir, 'ui-frames.jsonl')).flatMap(x => Object.values(x.changes));
    assert.deepEqual(values, ['idle@1', 'hit@0'], 'both states were observed, in order');
});

test('P3-T04 a burst around the flash: contiguous frame index, files exist, and the flash is found', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const r = await call(engine, 'gameplay.frames', { target: fx.url + 'game', durationMs: 2200 });
    assert.equal(r.status, 'ok');
    assert.ok(r.data.frames >= 3, `frames=${r.data.frames}`);
    const dir = runDir(c, r.data.run);
    const index = jsonl(path.join(dir, 'frames.jsonl'));
    assert.deepEqual(index.map(x => x.frame), index.map((_, i) => i + 1), 'contiguous');
    for (const x of index) assert.ok(fs.existsSync(path.join(dir, x.file)), x.file);
    const analysis = await call(engine, 'gameplay.frames.analyze', { runId: r.data.run });
    fx.close();
    assert.equal(analysis.data.frames, r.data.frames);
    assert.ok(analysis.data.flashes.length >= 1, JSON.stringify(analysis.data));
    assert.ok(analysis.data.flashes[0].bbox.width >= 200, 'the flash is the 300px box');
});

test('P3-T05 over the frame budget: capped is reported, the reason is logged, nothing is silent', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const r = await call(engine, 'gameplay.frames', { target: fx.url + 'game?anim=1', durationMs: 4000, maxFrames: 3 });
    fx.close();
    assert.equal(r.data.capped, true);
    assert.equal(r.data.frames, 3);
    assert.match(fs.readFileSync(path.join(runDir(c, r.data.run), 'flow.log'), 'utf8'), /capped=true reason=maxFrames/);
});

test('P3-T08 capturing frames slows the page by a bounded amount (measured, not assumed)', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const store = new RunStore(c.stateDir, 't8');
    const s = await BrowserSession.open(c, store, fx.url + 'game?anim=1');
    await s.waitForScene(10000);
    const fps = async (ms) => { const a = await s.evaluate('window.__frames'); await new Promise(r => setTimeout(r, ms)); return ((await s.evaluate('window.__frames')) - a) / (ms / 1000); };
    const base = await fps(1000);
    const during = new Promise(async (resolve) => { const p = fps(1000); resolve(p); });
    const burst = s.captureFrames({ durationMs: 1000, maxFrames: 1000 });
    const withCapture = await during; await burst;
    await s.close(); fx.close();
    const ratio = withCapture / base;
    console.log(`# P3-T08 measured: ${base.toFixed(1)} fps without capture, ${withCapture.toFixed(1)} with, ratio ${ratio.toFixed(2)}`);
    assert.ok(base > 10, 'baseline fps ' + base);
    assert.ok(ratio >= 0.3, `fps ratio ${ratio.toFixed(2)}`);
});

test('P3-K01 screenshot and burst replies carry no image and their size does not depend on the number of frames', opts, async () => {
    const fx = await startFixture(); const engine = createEngine(cfg());
    await call(engine, 'gameplay.screenshot', { target: fx.url + 'game' });
    const few = await call(engine, 'gameplay.frames', { target: fx.url + 'game?anim=1', durationMs: 3000, maxFrames: 5 });
    const many = await call(engine, 'gameplay.frames', { target: fx.url + 'game?anim=1', durationMs: 3000, maxFrames: 40 });
    fx.close();
    assert.ok(many.data.frames > few.data.frames * 3, `${few.data.frames} vs ${many.data.frames}`);
    const [shot, a, b] = engine.ledger.map(e => e.responseTokens);
    for (const t of [shot, a, b]) assert.ok(t <= 170, String(t));
    assert.ok(Math.abs(a - b) <= 6, `${a} vs ${b}`);
});

test('P3-K02 waiting for a state by condition: one call, zero images, far cheaper than polling with screenshots', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const t0 = Date.now();
    const r = await call(engine, 'gameplay.observe', { target: fx.url + 'game', watch: ['wallet'], every: 2, until: { path: 'wallet', equals: '105.50', timeoutMs: 8000 } });
    const elapsed = Date.now() - t0;
    fx.close();
    assert.equal(r.data.until, true);
    assert.equal(engine.ledger.length, 1, 'one call');
    assert.ok(!fs.existsSync(path.join(runDir(c, r.data.run), 'screenshots')), 'no screenshot taken');
    const ours = engine.ledger[0].responseTokens;
    const pollingEstimate = Math.max(1, Math.ceil(elapsed / 2000)) * 1229; // illustrative: one full screenshot per 2 s poll
    console.log(`# P3-K02: ${ours} tokens in 1 call vs ~${pollingEstimate} tokens for screenshot polling (formula, not measured)`);
    assert.ok(ours * 5 < pollingEstimate);
});

test('P3-K03 the agent can choose a cheaper image: scale and clip are priced by the same formula', opts, async () => {
    const fx = await startFixture(); const c = cfg(); const engine = createEngine(c);
    const full = await call(engine, 'gameplay.screenshot', { target: fx.url + 'game' });
    const small = await call(engine, 'gameplay.screenshot', { target: fx.url + 'game', scale: 0.25 });
    const crop = await call(engine, 'gameplay.screenshot', { target: fx.url + 'game', clip: { x: 100, y: 200, width: 300, height: 300 } });
    fx.close();
    assert.equal(full.data.imgTok, 1229);
    assert.deepEqual([small.data.w, small.data.h], [180, 320]);
    assert.ok(full.data.imgTok / small.data.imgTok >= 12, `${full.data.imgTok} vs ${small.data.imgTok}`);
    assert.deepEqual([crop.data.w, crop.data.h], [300, 300]);
    assert.equal(crop.data.imgTok, 120);
});
