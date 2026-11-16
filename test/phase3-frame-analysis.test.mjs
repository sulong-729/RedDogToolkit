// Phase 3 [U]: P3-T06, P3-T07 and the image price formula, on synthetic in-memory images. No browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { diffImages, detectFlashes, compareBaseline } from '../dist/modules/frame-analysis/index.js';
import { imageTokens } from '../dist/modules/observer/index.js';

/** A w*h image of one colour, with optional filled rectangles of another colour. */
function image(w, h, base, patches = []) {
    const png = new PNG({ width: w, height: h });
    const put = (x, y, [r, g, b]) => { const i = (y * w + x) * 4; png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, base);
    for (const { rect, color } of patches) for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) put(x, y, color);
    return png;
}
const BLUE = [30, 80, 200], RED = [200, 30, 30];
const A = () => image(40, 40, BLUE);
const B = () => image(40, 40, BLUE, [{ rect: { x: 10, y: 10, width: 10, height: 10 }, color: RED }]);

test('P3-T06 a one-frame flash (A, B, A) is found at the right frame and region', () => {
    const flashes = detectFlashes([A(), A(), B(), A(), A()]);
    assert.equal(flashes.length, 1);
    assert.deepEqual([flashes[0].from, flashes[0].to], [2, 2]);
    assert.deepEqual(flashes[0].bbox, { x: 10, y: 10, width: 10, height: 10 });
});

test('P3-T06 a two-frame flash is found; a change that does not return is not a flash', () => {
    const two = detectFlashes([A(), B(), B(), A(), A()]);
    assert.deepEqual(two.map(f => [f.from, f.to]), [[1, 2]]);
    assert.equal(detectFlashes([A(), A(), B(), B(), B()]).length, 0, 'a lasting change is not a flash');
    assert.equal(detectFlashes([A(), B(), B(), B(), B(), A()], { maxGap: 3 }).length, 0, 'longer than maxGap');
    assert.equal(detectFlashes([A(), A(), A(), A()]).length, 0, 'nothing changed');
});

test('P3-T06 a region limits detection to the node being watched', () => {
    const frames = [A(), B(), A()];
    assert.equal(detectFlashes(frames, { region: { x: 0, y: 0, width: 8, height: 8 } }).length, 0, 'change is outside the region');
    assert.equal(detectFlashes(frames, { region: { x: 5, y: 5, width: 20, height: 20 } }).length, 1);
});

test('P3-T07 baseline: identical passes, a difference inside an ignore region passes, outside fails with its box', () => {
    assert.equal(compareBaseline(A(), A()).pass, true);
    const ignore = [{ x: 10, y: 10, width: 10, height: 10 }];
    assert.equal(compareBaseline(B(), A(), { ignore }).pass, true, 'dynamic area ignored');
    const failed = compareBaseline(B(), A());
    assert.equal(failed.pass, false);
    assert.deepEqual(failed.bbox, { x: 10, y: 10, width: 10, height: 10 });
    assert.ok(failed.ratio > 0.05);
    assert.equal(compareBaseline(B(), A(), { maxRatio: 0.5 }).pass, true, 'threshold is configurable');
});

test('diffImages refuses frames of different size instead of guessing', () => {
    assert.throws(() => diffImages(image(10, 10, BLUE), image(20, 10, BLUE)), /differ in size/);
});

test('image price follows width x height / 750', () => {
    assert.equal(imageTokens(720, 1280), 1229);
    assert.equal(imageTokens(180, 320), 77);
});
