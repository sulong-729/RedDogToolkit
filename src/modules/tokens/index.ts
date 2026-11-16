// Token estimate and response budget (P1-K01..K04).
//
// The estimate is deliberately pessimistic: 1.5 chars/token, the worst case measured in P0-K02. That measurement is
// itself uncalibrated (it includes hidden context), so every result that depends on it is PASS_SCOPED.
import fs from 'node:fs';
import path from 'node:path';
import type { ResultEnvelope } from '../../contracts/index.js';

export const WORST_CASE_CHARS_PER_TOKEN = 1.5;

export function estimateTokens(value: unknown, charsPerToken = WORST_CASE_CHARS_PER_TOKEN): number {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
    return Math.ceil(text.length / charsPerToken);
}

/**
 * Attach `cost` and enforce the capability's budget. Over budget: the full result goes to <spillDir>, and the response
 * becomes a short `partial` envelope with `truncated: true` and a `resultRef`. Nothing is dropped silently.
 */
export function fitBudget(result: ResultEnvelope, budgetTokens: number | null, spillDir: string, charsPerToken = WORST_CASE_CHARS_PER_TOKEN): ResultEnvelope {
    const tokens = estimateTokens(result, charsPerToken);
    // Within budget: no `cost` field. Attaching it to every response would add ~60 tokens (worst case) to each call,
    // which defeats the purpose. The per-call ledger is written to <state>/ledger.jsonl by the engine instead.
    if (budgetTokens === null || tokens <= budgetTokens) return result;
    // An error must stay an error. It is short by design, so it is never truncated or turned into `partial`;
    // the overrun is reported honestly in `cost`.
    if (result.status === 'error')
        return { ...result, cost: { responseTokens: tokens, runTotalTokens: tokens, budget: budgetTokens, budgetExceeded: true } };

    fs.mkdirSync(spillDir, { recursive: true });
    const name = `${result.requestId.replace(/[^\w.-]/g, '_')}-${Date.now()}.json`;
    fs.writeFileSync(path.join(spillDir, name), JSON.stringify(result));
    const short: ResultEnvelope = {
        formatVersion: 1, requestId: result.requestId, status: 'partial',
        data: { truncated: true, resultRef: path.join('overflow', name), fullTokens: tokens },
        warnings: ['over budget; full result on disk'],
    };
    const shortTokens = estimateTokens(short, charsPerToken);
    return { ...short, cost: { responseTokens: shortTokens, runTotalTokens: shortTokens, budget: budgetTokens, budgetExceeded: true } };
}
