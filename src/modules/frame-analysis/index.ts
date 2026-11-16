// Frame diff, one-frame flash detection, baseline compare (P3-T06/T07).
// Pure functions over PNG bytes: no browser, no I/O except reading the frame files.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { KitError } from '../../contracts/index.js';

export type Rect = { x: number; y: number; width: number; height: number };

export interface Diff { changed: number; total: number; ratio: number; bbox: Rect | null }

const inRect = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

/** Per-pixel comparison. A pixel changed when the summed channel difference exceeds `tolerance`. Ignore rects are skipped. */
export function diffImages(a: PNG, b: PNG, options: { tolerance?: number; ignore?: Rect[]; region?: Rect } = {}): Diff {
    if (a.width !== b.width || a.height !== b.height) throw new Error('frames differ in size');
    const tol = options.tolerance ?? 48;
    let changed = 0, total = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        if (options.region && !inRect(x, y, options.region)) continue;
        if (options.ignore?.some(r => inRect(x, y, r))) continue;
        total++;
        const i = (y * a.width + x) * 4;
        const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
        if (d > tol) { changed++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    return { changed, total, ratio: total ? changed / total : 0, bbox: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null };
}

export interface Flash { from: number; to: number; bbox: Rect | null }

/**
 * A flash is state A, then something different for at most `maxGap` frames, then A again.
 * `frames` are decoded images in capture order; indexes in the result are positions in that array.
 */
export function detectFlashes(frames: PNG[], options: { threshold?: number; maxGap?: number; region?: Rect; ignore?: Rect[] } = {}): Flash[] {
    const threshold = options.threshold ?? 0.002;
    const maxGap = options.maxGap ?? 3;
    const d = (i: number, j: number) => diffImages(frames[i], frames[j], { region: options.region, ignore: options.ignore });
    const flashes: Flash[] = [];
    for (let i = 1; i < frames.length - 1; i++) {
        const away = d(i - 1, i);
        if (away.ratio <= threshold) continue;
        for (let j = i + 1; j < frames.length && j <= i + maxGap; j++) {
            if (d(i - 1, j).ratio <= threshold) { flashes.push({ from: i, to: j - 1, bbox: away.bbox }); i = j; break; }
        }
    }
    return flashes;
}

export interface BaselineResult { pass: boolean; ratio: number; bbox: Rect | null }

/** Compare against an approved image. Pass when the changed share is within `maxRatio`, outside `ignore` regions. */
export function compareBaseline(actual: PNG, baseline: PNG, options: { maxRatio?: number; tolerance?: number; ignore?: Rect[] } = {}): BaselineResult {
    const diff = diffImages(actual, baseline, { tolerance: options.tolerance, ignore: options.ignore });
    return { pass: diff.ratio <= (options.maxRatio ?? 0.001), ratio: diff.ratio, bbox: diff.bbox };
}

export interface AnalyzeParams { runId: string; region?: Rect; threshold?: number; maxGap?: number }
export interface AnalyzeResult { frames: number; flashes: Flash[] }

/** Flash scan over a run's saved frames. The answer is text-sized: the agent never needs to open an image to get it. */
export function analyzeRun(stateDir: string, params: AnalyzeParams): AnalyzeResult {
    if (!/^[\w.-]{1,64}$/.test(params.runId)) throw new KitError('SCHEMA_MISMATCH', 'bad runId', 'use an id from a run result');
    const runDir = path.join(stateDir, 'artifacts', params.runId);
    if (!fs.existsSync(runDir)) throw new KitError('SNAPSHOT_EXPIRED', 'run not found', 'run it again');
    const frames = readFrames(runDir);
    return { frames: frames.length, flashes: detectFlashes(frames, { threshold: params.threshold, maxGap: params.maxGap, region: params.region }).slice(0, 10) };
}

export function readFrames(runDir: string): PNG[] {
    const dir = path.join(runDir, 'frames');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => PNG.sync.read(fs.readFileSync(path.join(dir, f))));
}
