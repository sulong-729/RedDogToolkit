// Runtime listener counts per emit, plus a static scan of handler registrations (P4-T01).
// Runtime: a typical event manager logs one `Trigger <event> → <Context>` line per listener per emit. Lines for the
// same event close together in time belong to one emit; a context appearing twice inside one emit is a duplicate.
import fs from 'node:fs';
import path from 'node:path';
import type { TraceEvent } from '../assertions/index.js';

export interface ListenerStat { event: string; emits: number; maxListeners: number; duplicateContexts: string[] }

export function countListeners(trace: TraceEvent[], windowMs = 30): ListenerStat[] {
    const groups: Array<{ event: string; ctx: string[]; last: number }> = [];
    for (const e of trace) {
        const g = groups[groups.length - 1];
        if (g && g.event === e.name && e.t - g.last <= windowMs) { g.ctx.push(e.ctx ?? '?'); g.last = e.t; }
        else groups.push({ event: e.name, ctx: [e.ctx ?? '?'], last: e.t });
    }
    const stats = new Map<string, ListenerStat & { dup: Set<string> }>();
    for (const g of groups) {
        const s = stats.get(g.event) ?? { event: g.event, emits: 0, maxListeners: 0, duplicateContexts: [], dup: new Set<string>() };
        s.emits++;
        s.maxListeners = Math.max(s.maxListeners, g.ctx.length);
        const seen = new Set<string>();
        for (const c of g.ctx) { if (seen.has(c)) s.dup.add(c); seen.add(c); }
        stats.set(g.event, s);
    }
    return [...stats.values()].map(({ dup, ...s }) => ({ ...s, duplicateContexts: [...dup] }));
}

export interface StaticRegistration { event: string; total: number; files: Array<{ file: string; count: number }> }

/** Events registered with `.on(<event>, ...)` more than once across the scripts of one game folder. Read-only. */
export function staticRegistrationScan(gameDir: string): StaticRegistration[] {
    const root = path.join(gameDir, 'scripts');
    const per = new Map<string, Array<{ file: string; count: number }>>();
    (function walk(d: string) {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.ts')) continue;
            const counts: Record<string, number> = {};
            for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:eventManager|EventManager|gameEvent)\w*\.on\(\s*([^,)]+?)\s*,/g)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
            for (const [event, count] of Object.entries(counts)) per.set(event, [...(per.get(event) ?? []), { file: path.relative(gameDir, p), count }]);
        }
    })(root);
    return [...per].map(([event, files]) => ({ event, total: files.reduce((a, f) => a + f.count, 0), files: files.slice(0, 6) }))
        .filter(r => r.total > 1).sort((a, b) => b.total - a.total);
}
