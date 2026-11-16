// Compose modules into named scenarios with checkpoints.
// Phases 2 and 3 ship local, read-only scenarios: observe, shoot, burst. None writes to staging, so none needs an
// approved plan. The staging scenarios arrive in Phase 5. Each returns a tiny object: that is what the agent reads.
import { KitError } from '../../contracts/index.js';
import { BrowserSession, assertLocalHttp } from '../browser/index.js';
import { readToken, type Config } from '../config/index.js';
import { RunLock } from '../guard/index.js';
import { RunStore } from '../store/index.js';

export interface TargetParams {
    /** Omit for the configured preview, or give a local http URL. */
    target?: string;
    /** Append the token file's token as ?token=. Off by default: the game then contacts its backend with it. */
    withToken?: boolean;
    /** How long to wait for the engine to report a scene before giving up (default 60000). */
    sceneTimeoutMs?: number;
}

export interface ObserveParams extends TargetParams {
    seconds?: number;
    /** Reload once after this many seconds, to prove recording survives a reload. */
    reloadAfterSeconds?: number;
    /** Node-path substrings to sample (Label text, Spine animation@timeScale). */
    watch?: string[];
    every?: number;
    /** Wait for a watched value instead of a fixed time: one call, no screenshots. */
    until?: { path: string; equals: string; timeoutMs?: number };
}

export interface ObserveResult { run: string; scene: boolean; reloads: number; rec: [number, number, number]; until?: boolean }
export interface ShootParams extends TargetParams { checkpoint?: string; scale?: number; clip?: { x: number; y: number; width: number; height: number } }
export interface ShootResult { run: string; file: string; w: number; h: number; imgTok: number }
export interface BurstParams extends TargetParams { durationMs?: number; maxFrames?: number; everyNth?: number }
export interface BurstResult { run: string; frames: number; capped: boolean }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Lock, store, browser, result.json and cleanup in one place. The browser is always closed and the lock released. */
async function withSession<T>(cfg: Config, name: string, params: TargetParams & { watch?: string[]; every?: number }, fn: (s: BrowserSession, store: RunStore) => Promise<T>): Promise<T> {
    const url = assertLocalHttp(params.target ?? cfg.previewBase);
    if (params.withToken) url.searchParams.set('token', readToken(cfg));

    const release = new RunLock(cfg.stateDir).acquire('browser');
    const store = new RunStore(cfg.stateDir, name);
    let session: BrowserSession | undefined;
    try {
        store.setCheckpoint('before-start');
        session = await BrowserSession.open(cfg, store, url.toString(), { watch: params.watch, every: params.every });
        const result = await fn(session, store);
        store.writeJson('result.json', { status: 'ok', ...result });
        return result;
    } catch (e) {
        store.flow(`error: ${(e as Error).message}`);
        store.writeJson('result.json', { status: 'failed', reason: (e as Error).message });
        throw e instanceof KitError ? e : new KitError('ENV_FAILED', `${name} failed`, 'see flow.log of the run');
    } finally {
        await session?.close();
        store.close();
        release();
    }
}

export function observe(cfg: Config, params: ObserveParams): Promise<ObserveResult> {
    return withSession(cfg, 'observe', params, async (session, store) => {
        const sceneTimeout = params.sceneTimeoutMs ?? 60000;
        const scene = await session.waitForScene(sceneTimeout);
        store.setCheckpoint('observing');

        let until: boolean | undefined;
        if (params.until) until = await session.waitUntil(params.until.path, params.until.equals, params.until.timeoutMs ?? 30000);
        else {
            const total = (params.seconds ?? 2) * 1000;
            const reloadAt = params.reloadAfterSeconds === undefined ? null : params.reloadAfterSeconds * 1000;
            if (reloadAt !== null && reloadAt < total) {
                await sleep(reloadAt);
                await session.reload();
                await session.waitForScene(sceneTimeout);
                await sleep(total - reloadAt);
            } else await sleep(total);
        }
        const result: ObserveResult = { run: store.runId, scene, reloads: session.reloads, rec: [store.counts['events.jsonl'], store.counts['ui-frames.jsonl'], store.counts['server.jsonl']] };
        if (until !== undefined) result.until = until;
        return result;
    });
}

/** One screenshot at a checkpoint. The image stays on disk; the reply carries its path and its price. */
export function shoot(cfg: Config, params: ShootParams): Promise<ShootResult> {
    return withSession(cfg, 'shoot', params, async (session, store) => {
        await session.waitForScene(params.sceneTimeoutMs ?? 60000);
        const shot = await session.screenshot({ checkpoint: params.checkpoint ?? 'shot', scale: params.scale, clip: params.clip });
        return { run: store.runId, file: shot.file, w: shot.width, h: shot.height, imgTok: shot.imageTokens };
    });
}

/** Every composited frame for a short window. Frames stay on disk; the reply is two numbers and a flag. */
export function burst(cfg: Config, params: BurstParams): Promise<BurstResult> {
    return withSession(cfg, 'burst', params, async (session, store) => {
        await session.waitForScene(params.sceneTimeoutMs ?? 60000);
        store.setCheckpoint('burst');
        const r = await session.captureFrames({ durationMs: params.durationMs, maxFrames: params.maxFrames, everyNth: params.everyNth });
        return { run: store.runId, frames: r.frames, capped: r.capped };
    });
}
