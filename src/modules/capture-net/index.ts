// Console, page errors, http and websocket capture, noise filtered (P2-T03/T04).
// Everything is written through the store, which redacts and caps it. Nothing depends on console.log being hooked
// inside the page: records come from CDP events, so they survive reloads.
import type { CDPSession, Page } from 'puppeteer-core';
import type { RunStore } from '../store/index.js';

/** Static assets and media: never evidence, always noise. */
export const NOISY_URL = /\.(png|jpe?g|webp|gif|svg|ico|mp3|ogg|wav|m4a|mp4|woff2?|ttf|otf|css|atlas|skel|plist|bin|cconb|map)(\?|$)/i;
/** socket.io / engine.io heartbeat packets ("2" ping, "3" pong): constant, carry no information. */
export const HEARTBEAT = /^(2|3)(probe)?$/;

const clip = (text: string, n: number) => (text.length > n ? text.slice(0, n) + `…[+${text.length - n}]` : text);

export interface CaptureStats { heartbeatsFiltered: number; assetsFiltered: number }

export function attachCapture(page: Page, cdp: CDPSession, store: RunStore): CaptureStats {
    const stats: CaptureStats = { heartbeatsFiltered: 0, assetsFiltered: 0 };

    page.on('console', (msg) => store.append('events.jsonl', { type: 'console', level: msg.type(), text: clip(msg.text(), 2000) }));
    page.on('pageerror', (err) => store.append('events.jsonl', { type: 'pageerror', text: clip(String((err as Error).message ?? err), 2000) }));
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) store.append('events.jsonl', { type: 'navigated' }); });

    page.on('requestfailed', (req) => {
        if (NOISY_URL.test(req.url())) { stats.assetsFiltered++; return; }
        store.append('server.jsonl', { kind: 'request-failed', url: clip(req.url(), 300), error: req.failure()?.errorText });
    });

    page.on('response', async (res) => {
        const req = res.request();
        if (!['fetch', 'xhr'].includes(req.resourceType())) return;
        if (NOISY_URL.test(res.url())) { stats.assetsFiltered++; return; }
        let body = '';
        try { body = clip(await res.text(), 4000); } catch { /* body unavailable (redirect, aborted) */ }
        store.append('server.jsonl', { kind: 'http', method: req.method(), url: clip(res.url(), 300), status: res.status(), req: clip(req.postData() ?? '', 2000), res: body });
    });

    const frame = (kind: 'ws-send' | 'ws-recv') => (e: { response: { payloadData: string } }) => {
        const data = String(e.response.payloadData);
        if (HEARTBEAT.test(data)) { stats.heartbeatsFiltered++; return; }
        store.append('server.jsonl', { kind, data: clip(data, kind === 'ws-recv' ? 4000 : 2000) });
    };
    void cdp.send('Network.enable');
    cdp.on('Network.webSocketFrameSent', frame('ws-send'));
    cdp.on('Network.webSocketFrameReceived', frame('ws-recv'));
    return stats;
}
