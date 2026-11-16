// One way for the CLI and the MCP adapter to reach the engine: through the running daemon when there is one, otherwise
// in this process. `REDDOG_STANDALONE=1` forces in-process. `lastVia` says which path served the last call (for tests).
import type { ResultEnvelope } from '../contracts/index.js';
import { createEngine, listCapabilities, type Engine } from '../engine.js';
import type { Config } from '../modules/config/index.js';
import { callDaemon } from './client.js';

export interface Gateway {
    call(request: unknown): Promise<ResultEnvelope>;
    describe(operation?: string): Promise<unknown>;
    readonly lastVia: 'daemon' | 'in-process' | null;
}

export function makeGateway(cfg: Config): Gateway {
    let engine: Engine | undefined;
    const local = () => (engine ??= createEngine(cfg));
    const standalone = () => process.env.REDDOG_STANDALONE === '1';
    let lastVia: Gateway['lastVia'] = null;

    return {
        get lastVia() { return lastVia; },
        async call(request) {
            if (!standalone()) {
                const r = await callDaemon(cfg.stateDir, '/v1/rpc', request);
                if (r && r.status === 200 && r.json) { lastVia = 'daemon'; return r.json as ResultEnvelope; }
            }
            lastVia = 'in-process';
            return local().call(request);
        },
        async describe(operation) {
            if (!standalone()) {
                const r = await callDaemon(cfg.stateDir, '/v1/describe', operation ? { operation } : {});
                if (r && r.status === 200 && r.json) { lastVia = 'daemon'; return r.json; }
            }
            lastVia = 'in-process';
            return operation ? local().registry.describe(operation) : listCapabilities(local().registry);
        },
    };
}
