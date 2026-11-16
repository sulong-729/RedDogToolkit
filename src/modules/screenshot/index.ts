// Single screenshot with metadata (P3-T01, P3-K01, P3-K03).
// The image goes to disk; the caller gets a path and a price, never the bytes.
import type { Page } from 'puppeteer-core';
import { PNG } from 'pngjs';
import { imageTokens } from '../observer/index.js';
import type { RunStore } from '../store/index.js';

export interface ShotOptions {
    checkpoint?: string;
    /** Shrink before saving (0.1..1). A smaller image is cheaper if the agent chooses to look at it. */
    scale?: number;
    /** Crop to a region in page pixels. */
    clip?: { x: number; y: number; width: number; height: number };
}

export interface ShotResult { file: string; width: number; height: number; bytes: number; imageTokens: number }

let counter = 0;

export async function takeScreenshot(page: Page, store: RunStore, options: ShotOptions = {}): Promise<ShotResult> {
    const name = (options.checkpoint ?? store.checkpoint ?? 'shot').replace(/[^\w.-]/g, '_');
    if (options.checkpoint) store.setCheckpoint(options.checkpoint);
    const clip = options.clip ? { ...options.clip, scale: options.scale ?? 1 } : undefined;
    let buffer: Buffer = Buffer.from(await page.screenshot({ type: 'png', clip: clip ? { x: clip.x, y: clip.y, width: clip.width, height: clip.height } : undefined }));
    if (options.scale && options.scale < 1) buffer = shrink(buffer, options.scale);
    const png = PNG.sync.read(buffer);
    const rel = store.writeBinary(`screenshots/${String(++counter).padStart(3, '0')}-${name}.png`, buffer);
    const result: ShotResult = { file: rel, width: png.width, height: png.height, bytes: buffer.length, imageTokens: imageTokens(png.width, png.height) };
    store.writeJson(rel.replace(/\.png$/, '.meta.json'), { ...result, checkpoint: name, t: Date.now(), uiRecords: store.counts['ui-frames.jsonl'], serverRecords: store.counts['server.jsonl'] });
    return result;
}

/** Nearest-neighbour downscale: cheap, dependency free, good enough to make an image cheaper to inspect. */
function shrink(buffer: Buffer, scale: number): Buffer {
    const src = PNG.sync.read(buffer);
    const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = ((Math.min(src.height - 1, Math.floor(y / scale))) * src.width + Math.min(src.width - 1, Math.floor(x / scale))) * 4;
        const d = (y * w + x) * 4;
        out.data[d] = src.data[s]; out.data[d + 1] = src.data[s + 1]; out.data[d + 2] = src.data[s + 2]; out.data[d + 3] = src.data[s + 3];
    }
    return PNG.sync.write(out);
}
