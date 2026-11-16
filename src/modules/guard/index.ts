// Block staging writes without an approved plan; one user, one run (P1-T03/T04/T07).
//
// Flow: propose(plan) -> hash. A person runs `reddog approve <hash>` in a terminal (CLI only, never an MCP tool).
// apply then needs that exact hash. An approval is single use, expires, and is bound to the stored plan content.
// A client-supplied "approved" flag has no effect: only the files under <state>/approvals count.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KitError, type Capability, type RequestEnvelope } from '../../contracts/index.js';

export interface Plan {
    operation: string;
    params: Record<string, unknown>;
    /** Human readable list of the staging writes this plan will perform. */
    mutations: string[];
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object')
        return '{' + Object.keys(value as object).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}';
    return JSON.stringify(value);
}

export function planHash(plan: Plan): string {
    return crypto.createHash('sha256').update(stable(plan)).digest('hex');
}

const denied = (msg: string) => new KitError('WRITE_GUARD', msg, 'propose, then a person approves');
const safeHash = (h: unknown): string => {
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) throw denied('write needs an approved plan hash');
    return h;
};

export class Approvals {
    constructor(private readonly stateDir: string, private readonly clock: () => number = Date.now, private readonly ttlMs = 10 * 60 * 1000) { }

    private file(kind: 'plans' | 'approvals', hash: string) {
        return path.join(this.stateDir, kind, hash + '.json');
    }

    /** Stores the plan and returns its hash. Writes nothing to staging. */
    propose(plan: Plan): { hash: string; expiresInMs: number } {
        const hash = planHash(plan);
        fs.mkdirSync(path.join(this.stateDir, 'plans'), { recursive: true });
        fs.writeFileSync(this.file('plans', hash), JSON.stringify({ plan, proposedAt: this.clock() }));
        return { hash, expiresInMs: this.ttlMs };
    }

    /** USER-ONLY. Reachable from the CLI `approve` command; deliberately not registered as an MCP tool or capability. */
    approve(hash: string): void {
        safeHash(hash);
        if (!fs.existsSync(this.file('plans', hash))) throw denied('no such plan');
        fs.mkdirSync(path.join(this.stateDir, 'approvals'), { recursive: true });
        fs.writeFileSync(this.file('approvals', hash), JSON.stringify({ approvedAt: this.clock() }));
    }

    /** Verifies and consumes an approval for `operation`. Throws WRITE_GUARD on any mismatch. Single use. */
    consume(hashInput: unknown, operation: string): Plan {
        const hash = safeHash(hashInput);
        let stored: { plan: Plan };
        let approval: { approvedAt: number };
        try {
            stored = JSON.parse(fs.readFileSync(this.file('plans', hash), 'utf8'));
            approval = JSON.parse(fs.readFileSync(this.file('approvals', hash), 'utf8'));
        } catch { throw denied('plan not approved'); }
        if (planHash(stored.plan) !== hash) throw denied('plan content changed');
        if (stored.plan.operation !== operation) throw denied('plan is for another operation');
        if (this.clock() - approval.approvedAt > this.ttlMs) { fs.rmSync(this.file('approvals', hash), { force: true }); throw denied('approval expired'); }
        fs.rmSync(this.file('approvals', hash), { force: true });
        return stored.plan;
    }
}

/** Authorization callback for the Registry: reads pass; writes need a consumed, approved plan hash in params.planHash. */
export function makeAuthorize(approvals: Approvals) {
    return (cap: Capability, request: RequestEnvelope): boolean => {
        if (cap.readOnly) return true;
        approvals.consume(request.params.planHash, cap.name);
        return true;
    };
}

/** One run per user at a time. A lock whose process is gone is reclaimed. */
export class RunLock {
    constructor(private readonly stateDir: string) { }

    private file(user: string) {
        return path.join(this.stateDir, 'locks', user.replace(/[^\w.-]/g, '_') + '.lock');
    }

    acquire(user: string): () => void {
        const file = this.file(user);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
                return () => fs.rmSync(file, { force: true });
            } catch {
                const pid = Number(fs.readFileSync(file, 'utf8'));
                let alive = true;
                try { process.kill(pid, 0); } catch { alive = false; }
                if (alive) throw new KitError('BUSY', 'another run holds this user', 'wait or stop that run');
                fs.rmSync(file, { force: true });
            }
        }
        throw new KitError('BUSY', 'could not take the run lock', 'retry');
    }
}
