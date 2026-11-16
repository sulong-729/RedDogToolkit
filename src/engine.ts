import fs from 'node:fs';
import path from 'node:path';
import { Registry, type ResultEnvelope } from './contracts/index.js';
import type { Config } from './modules/config/index.js';
import type { Probes } from './modules/doctor/probes.js';
import { Approvals, makeAuthorize } from './modules/guard/index.js';
import { redactValue } from './modules/redact/index.js';
import { estimateTokens, fitBudget } from './modules/tokens/index.js';
import { gameplayCapabilities } from './registry/gameplay-capabilities.js';
import { validateCapability } from './registry/validate.js';

export interface LedgerEntry { t: number; operation: string; status: string; responseTokens: number; budget: number | null }

export interface Engine {
    registry: Registry;
    approvals: Approvals;
    /** In-memory copy of <state>/ledger.jsonl for this engine. The agent never sees it unless it asks. */
    ledger: LedgerEntry[];
    /** Dispatch, redact, enforce the capability's budget, record the call in the ledger. Always returns an envelope. */
    call(request: unknown): Promise<ResultEnvelope>;
}

export function createEngine(cfg: Config, probes?: Probes, approvals = new Approvals(cfg.stateDir)): Engine {
    const registry = new Registry(makeAuthorize(approvals));
    for (const capability of gameplayCapabilities(cfg, probes)) registry.register(validateCapability(capability));
    const budgets = new Map(registry.describe().map(c => [c.name, c.resultBudgetTokens as number | null]));
    const ledger: LedgerEntry[] = [];

    return {
        registry, approvals, ledger,
        async call(request) {
            let result = redactValue(await registry.dispatch(request));
            // A reader that finds nothing new answers `unchanged` with no data.
            if (result.status === 'ok' && (result.data as { unchanged?: boolean } | undefined)?.unchanged === true)
                result = { ...result, status: 'unchanged', data: undefined, revision: (result.data as { revision?: string }).revision };
            const op = typeof (request as { operation?: unknown })?.operation === 'string' ? (request as { operation: string }).operation : '';
            const budget = budgets.get(op) ?? null;
            const out = fitBudget(result, budget, path.join(cfg.stateDir, 'overflow'), cfg.charsPerToken);
            const entry: LedgerEntry = { t: Date.now(), operation: op, status: out.status, responseTokens: estimateTokens(out, cfg.charsPerToken), budget };
            ledger.push(entry);
            try {
                fs.mkdirSync(cfg.stateDir, { recursive: true });
                fs.appendFileSync(path.join(cfg.stateDir, 'ledger.jsonl'), JSON.stringify(entry) + '\n');
            } catch { /* the ledger must never break a call */ }
            return out;
        },
    };
}

/** Compact listing: name, facade, availability and budget only, to keep `describe` cheap. */
export function listCapabilities(registry: Registry) {
    return registry.describe().map(c => ({ name: c.name, facade: c.facade, availability: c.availability, budgetTokens: c.resultBudgetTokens }));
}
