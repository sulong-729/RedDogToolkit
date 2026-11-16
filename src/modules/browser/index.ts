// Headless Chrome via CDP: open, reload, click, observe, capture, close (P2 and P3).
// Recording lives in this process (the store), not in the page, so a reload or a crash loses nothing already recorded.
import fs from 'node:fs';
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer-core';
import { KitError } from '../../contracts/index.js';
import type { Config } from '../config/index.js';
import { attachCapture, type CaptureStats } from '../capture-net/index.js';
import { captureBurst, type BurstOptions, type BurstResult } from '../frames/index.js';
import { RECORDER_SCRIPT } from '../observer/index.js';
import { takeScreenshot, type ShotOptions, type ShotResult } from '../screenshot/index.js';
import type { RunStore } from '../store/index.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Only local http pages may be opened: the runner must not become a general-purpose browser. */
export function assertLocalHttp(url: string): URL {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new KitError('SCHEMA_MISMATCH', 'target is not a URL', 'use a local http URL'); }
    if (parsed.protocol !== 'http:' || !LOCAL_HOSTS.has(parsed.hostname))
        throw new KitError('SCHEMA_MISMATCH', 'target must be local http', 'use localhost or 127.0.0.1');
    return parsed;
}

export interface OpenOptions {
    headless?: boolean;
    /** Node-path substrings whose Label text and Spine state are sampled. Empty = no sampling. */
    watch?: string[];
    /** Sample every N frames (default 6). */
    every?: number;
}

export class BrowserSession {
    reloads = 0;
    sceneReady = false;
    closing = false;
    stats!: CaptureStats;
    /** Latest watched values, by node path. Updated from `ui` records. */
    readonly ui: Record<string, string | null> = {};
    private browser!: Browser;
    private page!: Page;
    private cdp!: CDPSession;
    private sceneWaiters: Array<() => void> = [];
    private uiWaiters: Array<() => void> = [];

    private constructor(private readonly cfg: Config, readonly store: RunStore) { }

    static async open(cfg: Config, store: RunStore, url: string, options: OpenOptions = {}): Promise<BrowserSession> {
        assertLocalHttp(url);
        const session = new BrowserSession(cfg, store);
        await session.launch(options);
        await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return session;
    }

    /** The browser process id, for liveness checks. */
    get pid(): number | undefined { return this.browser.process()?.pid; }
    /** Process arguments, so a test can confirm the browser really runs headless (no window, no focus). */
    get args(): string[] { return this.browser.process()?.spawnargs ?? []; }

    private async launch(options: OpenOptions): Promise<void> {
        if (!fs.existsSync(this.cfg.chromePath)) throw new KitError('ENV_FAILED', 'Chrome not found', 'set chromePath');
        this.browser = await puppeteer.launch({
            executablePath: this.cfg.chromePath, headless: options.headless ?? true,
            args: ['--autoplay-policy=no-user-gesture-required', '--no-first-run', ...this.cfg.chromeArgs],
        });
        this.browser.on('disconnected', () => {
            if (this.closing) return;
            this.store.flow('browser disconnected unexpectedly');
            this.store.writeJson('result.json', { status: 'aborted', indeterminate: true, reason: 'browser disconnected' });
            this.store.close();
        });
        this.page = (await this.browser.pages())[0] ?? (await this.browser.newPage());
        await this.page.setViewport({ width: 720, height: 1280 });
        this.cdp = await this.page.createCDPSession();
        await this.page.exposeFunction('__reddog_emit', (json: string) => this.onPageMessage(json));
        await this.page.evaluateOnNewDocument((cfg) => { (window as unknown as { __reddog_cfg: unknown }).__reddog_cfg = cfg; }, { watch: options.watch ?? [], every: options.every ?? 6 });
        await this.page.evaluateOnNewDocument(RECORDER_SCRIPT);
        this.page.on('framenavigated', (f) => { if (f === this.page.mainFrame()) this.sceneReady = false; });
        this.stats = attachCapture(this.page, this.cdp, this.store);
        this.store.flow('browser opened');
    }

    private onPageMessage(json: string): void {
        let m: { type?: string; name?: string; text?: string; frame?: number; changes?: Record<string, string | null> };
        try { m = JSON.parse(json); } catch { return; }
        if (m.type === 'scene-ready') {
            this.sceneReady = true;
            this.store.append('events.jsonl', { type: 'scene-ready', name: m.name });
            this.sceneWaiters.splice(0).forEach(resolve => resolve());
        } else if (m.type === 'rejection') {
            this.store.append('events.jsonl', { type: 'unhandledrejection', text: m.text });
        } else if (m.type === 'ui' && m.changes) {
            this.store.append('ui-frames.jsonl', { frame: m.frame, changes: m.changes });
            Object.assign(this.ui, m.changes);
            this.uiWaiters.splice(0).forEach(resolve => resolve());
        }
    }

    /** Resolves when the page reports its scene, or false on timeout. Event driven: no polling, no fixed sleep. */
    waitForScene(timeoutMs = 60000): Promise<boolean> {
        if (this.sceneReady) return Promise.resolve(true);
        return this.wait(this.sceneWaiters, () => this.sceneReady, timeoutMs);
    }

    /**
     * Resolves true when a watched value whose path contains `pathPart` equals `equals`. Condition based: one call,
     * no screenshots. Re-checks only when the sampler reports a change.
     */
    waitUntil(pathPart: string, equals: string, timeoutMs = 30000): Promise<boolean> {
        const reached = () => Object.entries(this.ui).some(([k, v]) => k.includes(pathPart) && v === equals);
        if (reached()) return Promise.resolve(true);
        return this.wait(this.uiWaiters, reached, timeoutMs);
    }

    private wait(list: Array<() => void>, check: () => boolean, timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => { remove(); resolve(check()); }, timeoutMs);
            const remove = () => { const i = list.indexOf(wake); if (i >= 0) list.splice(i, 1); };
            const wake = () => { if (check()) { clearTimeout(timer); resolve(true); } else list.push(wake); };
            list.push(wake);
        });
    }

    screenshot(options?: ShotOptions): Promise<ShotResult> { return takeScreenshot(this.page, this.store, options); }
    captureFrames(options?: BurstOptions): Promise<BurstResult> { return captureBurst(this.cdp, this.store, options); }

    /** Diagnostics and tests only: not exposed as a capability. */
    evaluate<T>(expression: string): Promise<T> { return this.page.evaluate(expression) as Promise<T>; }

    async reload(): Promise<void> {
        this.reloads++;
        this.store.flow(`reload #${this.reloads}`);
        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    async click(x: number, y: number): Promise<void> {
        this.store.flow(`click ${x},${y}`);
        await this.page.mouse.click(x, y);
    }

    /** Closes the browser and waits for the process to exit, so no Chrome is left behind. */
    async close(): Promise<void> {
        this.closing = true;
        const proc = this.browser.process();
        try { await this.browser.close(); } catch { /* already gone */ }
        if (proc && proc.exitCode === null) await new Promise<void>(resolve => { proc.once('exit', () => resolve()); setTimeout(resolve, 3000); });
        this.store.flow(`session closed; heartbeats filtered=${this.stats.heartbeatsFiltered} assets filtered=${this.stats.assetsFiltered}`);
        this.store.close();
    }
}
