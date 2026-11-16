// Per-frame capture by mode and budget (P3-T04/T05/K01).
// The browser pushes every frame it composites (CDP screencast), so nothing polls and nothing is sampled by timer.
// Only `burst` is implemented; every-n / on-change / full are later modes. The budget is never silent: hitting it
// stops the capture, sets `capped`, and writes the reason to flow.log.
import type { CDPSession } from 'puppeteer-core';
import type { RunStore } from '../store/index.js';

export interface BurstOptions {
    durationMs?: number;
    maxFrames?: number;
    maxBytes?: number;
    /** Keep every Nth composited frame. */
    everyNth?: number;
}

export interface BurstResult { frames: number; bytes: number; capped: boolean; reason: 'duration' | 'maxFrames' | 'maxBytes' }

export async function captureBurst(cdp: CDPSession, store: RunStore, options: BurstOptions = {}): Promise<BurstResult> {
    const durationMs = options.durationMs ?? 2000;
    const maxFrames = options.maxFrames ?? 120;
    const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    let frames = 0, bytes = 0, reason: BurstResult['reason'] = 'duration';
    let stop!: () => void;
    const done = new Promise<void>((resolve) => { stop = resolve; });

    const onFrame = async (e: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        try { await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }); } catch { /* page gone */ }
        if (reason !== 'duration' || frames >= maxFrames || bytes >= maxBytes) return;
        const data = Buffer.from(e.data, 'base64');
        const index = ++frames;
        bytes += data.length;
        const file = store.writeBinary(`frames/${String(index).padStart(6, '0')}.png`, data);
        store.append('frames.jsonl', { frame: index, file, bytes: data.length, browserTs: e.metadata.timestamp ?? null });
        if (frames >= maxFrames) { reason = 'maxFrames'; stop(); }
        else if (bytes >= maxBytes) { reason = 'maxBytes'; stop(); }
    };

    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: options.everyNth ?? 1 });
    const timer = setTimeout(stop, durationMs);
    await done;
    clearTimeout(timer);
    try { await cdp.send('Page.stopScreencast'); } catch { /* page gone */ }
    cdp.off('Page.screencastFrame', onFrame);

    const capped = reason !== 'duration';
    store.flow(`frames captured=${frames} bytes=${bytes} capped=${capped}${capped ? ' reason=' + reason : ''}`);
    return { frames, bytes, capped, reason };
}
