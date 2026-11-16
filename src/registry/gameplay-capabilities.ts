// The gameplay.* capabilities (plus `observe` added in Phase 2).
// Budgets leave room for a UUID requestId (36 chars, about 24 tokens at the worst-case estimate): the first Phase 2
// numbers were measured with a 2-character id and were too optimistic.
// Phase 1 made `doctor` and `freshness` available; Phase 2 adds `observe` and the three evidence readers.
// Every other capability stays `unavailable` until its module and its verification test exist.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Capability, Facade } from '../contracts/index.js';
import type { Config } from '../modules/config/index.js';
import { runDoctor, doctorLines } from '../modules/doctor/index.js';
import { bundleFreshness } from '../modules/freshness/index.js';
import { readEvidence } from '../modules/evidence/index.js';
import { observe, shoot, burst } from '../modules/scenarios/index.js';
import { analyzeRun } from '../modules/frame-analysis/index.js';
import { loadAll } from '../modules/evidence/index.js';
import { countListeners } from '../modules/listeners/index.js';
import { diffRuns } from '../modules/diff/index.js';
import { loadProfile } from '../modules/profile/index.js';
import { DEFAULT_TRIGGER, summarize, traceFrom } from '../modules/assertions/index.js';
import { runBaseSuite } from '../modules/assertions/suite.js';
import type { Probes } from '../modules/doctor/probes.js';
import type { EvidenceFile } from '../modules/store/index.js';
import { CheatTargetSchema, planCheat, sendCheat } from '../modules/cheat/index.js';
import { Approvals, consumedPlan } from '../modules/guard/index.js';
import { KitError } from '../contracts/index.js';

const empty = z.object({}).strict();
const runParams = z.object({ game: z.string().min(1), scenario: z.string().min(1) }).strict();
const evidenceParams = z.object({ runId: z.string().min(1), cursor: z.string().optional(), ifRevision: z.string().optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const target = {
    target: z.string().optional(),
    withToken: z.boolean().optional(),
    sceneTimeoutMs: z.number().int().min(1000).max(120000).optional(),
};
const observeParams = z.object({
    ...target,
    seconds: z.number().min(0).max(60).optional(),
    reloadAfterSeconds: z.number().min(0).max(60).optional(),
    watch: z.array(z.string().min(1)).max(20).optional(),
    every: z.number().int().min(1).max(120).optional(),
    until: z.object({ path: z.string().min(1), equals: z.string(), timeoutMs: z.number().int().min(100).max(120000).optional() }).strict().optional(),
}).strict();
const rect = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).strict();
const shootParams = z.object({ ...target, checkpoint: z.string().min(1).max(60).optional(), scale: z.number().min(0.1).max(1).optional(), clip: rect.optional() }).strict();
const burstParams = z.object({ ...target, durationMs: z.number().int().min(100).max(10000).optional(), maxFrames: z.number().int().min(1).max(300).optional(), everyNth: z.number().int().min(1).max(10).optional() }).strict();
const listenerParams = z.object({ runId: z.string().min(1), trigger: z.string().min(1).max(300).optional() }).strict();
const diffParams = z.object({ a: z.string().min(1), b: z.string().min(1), file: z.enum(['events.jsonl', 'ui-frames.jsonl', 'server.jsonl']).optional(), limit: z.number().int().min(1).max(50).optional() }).strict();
const checkParams = z.object({ runId: z.string().min(1), game: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional() }).strict();
const analyzeParams = z.object({ runId: z.string().min(1), region: rect.optional(), threshold: z.number().min(0).max(1).optional(), maxGap: z.number().int().min(1).max(10).optional() }).strict();

function cap(name: string, facade: Facade, readOnly: boolean, budget: number | null, verification: string, inputSchema: z.ZodType = empty): Capability {
    return { name, area: 'gameplay', process: 'runner', readOnly, availability: 'unavailable', facade, resultBudgetTokens: budget, verification, inputSchema };
}

function available(c: Capability, handler: NonNullable<Capability['handler']>): Capability {
    return { ...c, availability: 'available', handler };
}

export function gameplayCapabilities(cfg: Config, probes?: Probes, approvals: Approvals = new Approvals(cfg.stateDir)): Capability[] {
    const evidence = (name: string, file: EvidenceFile, verification: string) =>
        available(cap(name, 'query', true, null, verification, evidenceParams), (p) => readEvidence(cfg.stateDir, file, p));

    return [
        available(cap('gameplay.doctor', 'query', true, 250, 'P1-T06, P1-K01, P1-K02'), async () => {
            const r = await runDoctor(cfg, probes);
            return { status: r.status, lines: doctorLines(r) };
        }),
        available(cap('gameplay.freshness', 'query', true, 130, 'P1-T06'), () => bundleFreshness(cfg)),
        // Local-only: opens a local page and records it. No staging writes, so it needs no approved plan.
        available(cap('gameplay.observe', 'job', true, 160, 'P2-T01..T07, P2-K01, P2-K02', observeParams), (p) => observe(cfg, p)),
        cap('gameplay.run', 'job', false, 600, 'P5-T01..T10, P5-K01', runParams),
        cap('gameplay.runall', 'job', false, 800, 'P6-T03, P6-K02'),
        evidence('gameplay.evidence.events', 'events.jsonl', 'P2-T08, P2-K03'),
        evidence('gameplay.evidence.ui', 'ui-frames.jsonl', 'P3-T02, P3-T03'),
        evidence('gameplay.evidence.server', 'server.jsonl', 'P2-T04'),
        available(cap('gameplay.evidence.listeners', 'query', true, 400, 'P4-T01, P5-T06', listenerParams), (p) => {
            const trace = traceFrom(loadAll(cfg.stateDir, p.runId, 'events.jsonl'), p.trigger ?? DEFAULT_TRIGGER);
            const stats = countListeners(trace).sort((a, b) => b.maxListeners - a.maxListeners).slice(0, 8);
            return { triggerLines: trace.length, lines: stats.map(s => `${s.event} emits=${s.emits} max=${s.maxListeners}${s.duplicateContexts.length ? ' dup=' + s.duplicateContexts.join(',') : ''}`) };
        }),
        available(cap('gameplay.evidence.diff', 'query', true, 400, 'P4-T08, P4-K02', diffParams), (p) => diffRuns(cfg.stateDir, p.a, p.b, p.file, p.limit)),
        available(cap('gameplay.evidence.check', 'query', true, 350, 'P4-T07, P4-K01, P4-K03', checkParams), (p) => {
            const profile = p.game ? loadProfile(cfg.profilesDir, p.game) : null;
            const { results } = runBaseSuite(cfg.stateDir, p.runId, profile);
            // Show at most 2 failures so the reply fits its budget; the full list is saved, and the reply says so.
            const summary = summarize(results, { maxFailLines: 2, detailChars: 80 });
            if (!summary.fail) return summary;
            fs.writeFileSync(path.join(cfg.stateDir, 'artifacts', p.runId, 'check.json'), JSON.stringify({ results }, null, 2));
            return { ...summary, ref: 'check.json' };
        }),
        available(cap('gameplay.frames', 'job', true, 160, 'P3-T04, P3-T05, P3-K01', burstParams), (p) => burst(cfg, p)),
        available(cap('gameplay.screenshot', 'job', true, 170, 'P3-T01, P3-K01, P3-K03', shootParams), (p) => shoot(cfg, p)),
        available(cap('gameplay.frames.analyze', 'query', true, 200, 'P3-T06, P3-T07', analyzeParams), (p) => analyzeRun(cfg.stateDir, p)),
        // Propose: validates and stores a plan. Reads the profile and the token file, writes nothing to any backend.
        available(cap('gameplay.cheat.plan', 'propose', true, 320, 'P5-T11, P5-T12, P5-K05', CheatTargetSchema), (p) => planCheat(cfg, approvals, p)),
        // Apply: one POST, only from a plan a human approved. The user id is read from the token file, never passed in.
        {
            ...cap('gameplay.cheat', 'apply', false, 140, 'P5-T13..T18, P5-K06', z.object({ planHash: z.string() }).strict()),
            availability: 'available',
            handler: async (_p, request) => {
                const plan = consumedPlan(request);
                if (!plan) throw new KitError('WRITE_GUARD', 'no approved plan for this call', 'propose, then a person approves');
                return sendCheat(cfg, plan.params);
            },
            resultStatus: (data) => (data?.outcome === 'unknown' ? 'indeterminate' : 'ok'),
        },
        cap('gameplay.tokens', 'query', true, 300, 'P0-K05, P7-K02'),
    ];
}
