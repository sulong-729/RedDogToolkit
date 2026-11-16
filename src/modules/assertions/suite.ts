// The base-level suite: checks that run on any Cocos slot game with no code change (P4-T07, P4-K03).
// A check that needs something the game has not supplied reports `skip` with the reason, and is never counted as a pass.
import { loadAll } from '../evidence/index.js';
import { countListeners } from '../listeners/index.js';
import type { Profile } from '../profile/index.js';
import {
    DEFAULT_TRIGGER, checkWalletChain, detectHangs, detectRepeats, evaluate, noRejections, nonNegative, skip, spinsFrom, summarize, traceFrom,
    type Result, type Summary,
} from './index.js';

export interface SuiteResult { results: Result[]; summary: Summary }

export function runBaseSuite(stateDir: string, runId: string, profile: Profile | null): SuiteResult {
    const events = loadAll(stateDir, runId, 'events.jsonl');
    const server = loadAll(stateDir, runId, 'server.jsonl');
    const results: Result[] = [];
    const missing = profile ? 'not configured in profile' : 'no profile';

    results.push(noRejections(events));
    results.push(detectRepeats(server));

    const trigger = traceFrom(events, profile?.trace?.trigger ?? DEFAULT_TRIGGER);
    if (!trigger.length) results.push(skip('listener-dup', 'no Trigger log lines'));
    else {
        const known = profile?.knownDuplicateRegistrations.map(k => k.module) ?? [];
        const dup = countListeners(trigger).flatMap(s => s.duplicateContexts.filter(c => !known.some(k => c.includes(k))).map(c => `${c} twice on ${s.event}`));
        results.push(dup.length ? { name: 'listener-dup', state: 'fail', detail: dup[0] + (dup.length > 1 ? ` (+${dup.length - 1})` : '') } : { name: 'listener-dup', state: 'pass' });
    }

    if (profile?.trace?.start && profile.trace.end) {
        const lastT = events.length ? events[events.length - 1].t : 0;
        results.push(detectHangs(traceFrom(events, profile.trace.start), traceFrom(events, profile.trace.end), profile.hangMs ?? 5000, lastT));
    } else results.push(skip('no-hang', profile ? 'no trace start/end' : 'no profile'));

    const w = profile?.wallet;
    if (w?.balance && w.bet && w.win) results.push(checkWalletChain(spinsFrom(server, { balance: w.balance, bet: w.bet, win: w.win })));
    else results.push(skip('wallet-delta', missing));

    if (profile?.nonNegative.length) results.push(nonNegative(server, profile.nonNegative));
    else results.push(skip('non-negative', missing));

    return { results, summary: summarize(results) };
}

export { evaluate };
