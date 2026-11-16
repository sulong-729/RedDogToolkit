// Base-level data and logic assertions over recorded evidence (P4-T01..T06, K01).
// Pure functions: records in, a Result out. They know nothing about a particular game. Whatever a game must supply
// (log patterns, server key names) arrives as an argument, and a missing argument yields `skip`, never `pass`.
import type { z } from 'zod';
import { checkWalletDelta } from '../money/index.js';

export interface Rec { seq: number; t: number; [key: string]: unknown }
export interface Result { name: string; state: 'pass' | 'fail' | 'skip'; detail?: string; seq?: number[] }
export interface TraceEvent { seq: number; t: number; name: string; ctx?: string }

const pass = (name: string): Result => ({ name, state: 'pass' });
const fail = (name: string, detail: string, seq: number[] = []): Result => ({ name, state: 'fail', detail, seq });
export const skip = (name: string, reason: string): Result => ({ name, state: 'skip', detail: reason });

// ---------------------------------------------------------------- trace

/** Matches a common event-manager log line, `Trigger <event> → <Context>`. Override per game with `trace.trigger` in the profile. */
export const DEFAULT_TRIGGER = String.raw`Trigger\s+(?<name>\S+)\s+→\s+(?<ctx>\S+)`;

/** Turn console lines into named events with a regex that has `name` (and optionally `ctx`) groups. */
export function traceFrom(events: Rec[], pattern: string): TraceEvent[] {
    const re = new RegExp(pattern);
    const out: TraceEvent[] = [];
    for (const e of events) {
        if (e.type !== 'console' || typeof e.text !== 'string') continue;
        const m = re.exec(e.text);
        if (m) out.push({ seq: e.seq, t: e.t, name: m.groups?.name ?? m[1], ctx: m.groups?.ctx ?? m[2] });
    }
    return out;
}

// ---------------------------------------------------------------- sequence

export type Spec =
    | { once: string }
    | { count: string; min?: number; max?: number; between?: [string, string] }
    | { order: string[] }
    | { any: string[] }
    | { never: string }
    | { within: [string, string, number] };

const label = (s: Spec) => JSON.stringify(s);
const seqOf = (trace: TraceEvent[], name: string) => trace.filter(e => e.name === name).map(e => e.seq);

export function evaluate(spec: Spec, trace: TraceEvent[]): Result {
    const name = label(spec);
    if ('once' in spec) {
        const s = seqOf(trace, spec.once);
        return s.length === 1 ? pass(name) : fail(name, `${spec.once} seen ${s.length} times`, s);
    }
    if ('never' in spec) {
        const s = seqOf(trace, spec.never);
        return s.length === 0 ? pass(name) : fail(name, `${spec.never} seen ${s.length} times`, s);
    }
    if ('any' in spec) {
        const missing = spec.any.filter(n => seqOf(trace, n).length === 0);
        return missing.length ? fail(name, `missing: ${missing.join(', ')}`) : pass(name);
    }
    if ('order' in spec) {
        let at = 0;
        for (const n of spec.order) {
            const i = trace.findIndex((e, idx) => idx >= at && e.name === n);
            if (i < 0) return fail(name, `${n} not found after ${at ? trace[at - 1].name : 'start'}`);
            at = i + 1;
        }
        return pass(name);
    }
    if ('within' in spec) {
        const [a, b, ms] = spec.within;
        const first = trace.find(e => e.name === a);
        if (!first) return fail(name, `${a} never happened`);
        const next = trace.find(e => e.name === b && e.t >= first.t);
        if (!next) return fail(name, `${b} never followed ${a}`, [first.seq]);
        return next.t - first.t <= ms ? pass(name) : fail(name, `${b} came ${next.t - first.t}ms after ${a} (limit ${ms})`, [first.seq, next.seq]);
    }
    // count, optionally inside each window opened by between[0] and closed by between[1]
    const min = spec.min ?? 1, max = spec.max ?? min;
    if (!spec.between) {
        const s = seqOf(trace, spec.count);
        return s.length >= min && s.length <= max ? pass(name) : fail(name, `${spec.count} seen ${s.length} times, expected ${min}..${max}`, s);
    }
    const [open, close] = spec.between;
    let windows = 0;
    for (let i = 0; i < trace.length; i++) {
        if (trace[i].name !== open) continue;
        const end = trace.findIndex((e, j) => j > i && e.name === close);
        const slice = trace.slice(i + 1, end < 0 ? trace.length : end).filter(e => e.name === spec.count);
        windows++;
        if (slice.length < min || slice.length > max)
            return fail(name, `window ${windows}: ${spec.count} seen ${slice.length} times, expected ${min}..${max}`, slice.map(e => e.seq));
    }
    return windows ? pass(name) : fail(name, `no ${open} window found`);
}

// ---------------------------------------------------------------- repeats, hangs, rejections

/** Default key: a state-changing request or a websocket send. Reads (GET) and receives are not "calls". */
export function requestKey(r: Rec): string | null {
    if (r.kind === 'http' && r.method && r.method !== 'GET') return `${r.method} ${String(r.url).split('?')[0]} ${r.req ?? ''}`;
    if (r.kind === 'ws-send') return `ws ${r.data}`;
    return null;
}

/** The same call made again within `windowMs`. Reports the first group, with the seq of each copy. */
export function detectRepeats(recs: Rec[], windowMs = 150, keyOf: (r: Rec) => string | null = requestKey): Result {
    const name = 'repeat-requests';
    const last = new Map<string, Rec[]>();
    for (const r of recs) {
        const key = keyOf(r);
        if (!key) continue;
        const group = last.get(key);
        if (group && r.t - group[group.length - 1].t <= windowMs) { group.push(r); continue; }
        if (group && group.length > 1) return fail(name, `${key.slice(0, 60)} sent ${group.length}x within ${group[group.length - 1].t - group[0].t}ms`, group.map(g => g.seq));
        last.set(key, [r]);
    }
    for (const [key, group] of last) if (group.length > 1) return fail(name, `${key.slice(0, 60)} sent ${group.length}x within ${group[group.length - 1].t - group[0].t}ms`, group.map(g => g.seq));
    return pass(name);
}

/** A start with no matching end (same name and context) older than `thresholdMs` at the end of the run. */
export function detectHangs(starts: TraceEvent[], ends: TraceEvent[], thresholdMs: number, runEndT: number): Result {
    const name = 'no-hang';
    const open = new Map<string, TraceEvent[]>();
    for (const s of starts) { const k = s.name + '|' + (s.ctx ?? ''); open.set(k, [...(open.get(k) ?? []), s]); }
    for (const e of ends) { const k = e.name + '|' + (e.ctx ?? ''); const list = open.get(k); if (list?.length) list.shift(); }
    const stuck = [...open.values()].flat().filter(s => runEndT - s.t > thresholdMs);
    return stuck.length ? fail(name, `${stuck[0].name} started and never finished (${runEndT - stuck[0].t}ms)`, stuck.map(s => s.seq)) : pass(name);
}

export function noRejections(events: Rec[]): Result {
    const name = 'no-unhandled-rejections';
    const found = events.filter(e => e.type === 'unhandledrejection');
    return found.length ? fail(name, `${found.length} unhandled: ${String(found[0].text).slice(0, 80)}`, found.map(e => e.seq)) : pass(name);
}

// ---------------------------------------------------------------- data and invariants

/** First numeric (or numeric string) value of `key` anywhere inside a JSON value. */
export function findKey(value: unknown, key: string): number | string | null {
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (key in obj && (typeof obj[key] === 'number' || typeof obj[key] === 'string')) return obj[key] as number | string;
        for (const v of Object.values(obj)) { const found = findKey(v, key); if (found !== null) return found; }
    }
    return null;
}

export interface Spin { seq: number; balance: number | string; bet: number | string; win: number | string }

/** Spins visible in server records: those whose body carries all three wallet fields. */
export function spinsFrom(recs: Rec[], keys: { balance: string; bet: string; win: string }): Spin[] {
    const out: Spin[] = [];
    for (const r of recs) {
        const body = r.kind === 'http' ? r.res : r.kind === 'ws-recv' ? r.data : null;
        if (typeof body !== 'string') continue;
        let json: unknown;
        try { json = JSON.parse(body); } catch { continue; }
        const balance = findKey(json, keys.balance), bet = findKey(json, keys.bet), win = findKey(json, keys.win);
        if (balance !== null && bet !== null && win !== null) out.push({ seq: r.seq, balance, bet, win });
    }
    return out;
}

/** balance(n) = balance(n-1) - bet(n) + win(n), exact decimals. Needs two spins; the first has no known "before". */
export function checkWalletChain(spins: Spin[]): Result {
    const name = 'wallet-delta';
    if (spins.length < 2) return skip(name, `need 2 spins, saw ${spins.length}`);
    for (let i = 1; i < spins.length; i++) {
        const c = checkWalletDelta({ before: spins[i - 1].balance, bet: spins[i].bet, win: spins[i].win, after: spins[i].balance });
        if (!c.pass) return fail(name, `spin ${i + 1}: expected ${c.expected}, got ${c.actual} (off by ${c.diff})`, [spins[i - 1].seq, spins[i].seq]);
    }
    return pass(name);
}

export function nonNegative(recs: Rec[], keys: string[]): Result {
    const name = 'non-negative';
    for (const r of recs) {
        const body = r.kind === 'http' ? r.res : r.kind === 'ws-recv' ? r.data : null;
        if (typeof body !== 'string') continue;
        let json: unknown;
        try { json = JSON.parse(body); } catch { continue; }
        for (const k of keys) {
            const v = findKey(json, k);
            if (v !== null && Number(v) < 0) return fail(name, `${k} = ${v}`, [r.seq]);
        }
    }
    return pass(name);
}

export interface Modes { a: { name: string; enter: string; exit: string }; b: { name: string; enter: string; exit: string } }

/** Two modes that must never be active together (for example a main mode and a conflicting one). */
export function exclusiveModes(trace: TraceEvent[], modes: Modes): Result {
    const name = `exclusive:${modes.a.name}/${modes.b.name}`;
    let a = false, b = false;
    for (const e of trace) {
        if (e.name === modes.a.enter) a = true; else if (e.name === modes.a.exit) a = false;
        if (e.name === modes.b.enter) b = true; else if (e.name === modes.b.exit) b = false;
        if (a && b) return fail(name, `${modes.a.name} and ${modes.b.name} active together`, [e.seq]);
    }
    return pass(name);
}

export function validateSchema(name: string, value: unknown, schema: z.ZodType): Result {
    const parsed = schema.safeParse(value);
    if (parsed.success) return pass(name);
    return fail(name, parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
}

// ---------------------------------------------------------------- reporting

export interface Summary { pass: number; fail: number; skip: number; lines: string[] }

/** Compact report: one line when everything passed; otherwise one short line per failure plus one line for skips. */
export interface SummaryOptions { maxFailLines?: number; detailChars?: number }

export function summarize(results: Result[], options: SummaryOptions = {}): Summary {
    const maxFail = options.maxFailLines ?? Infinity, detailChars = options.detailChars ?? 110;
    const failed = results.filter(r => r.state === 'fail');
    const skipped = results.filter(r => r.state === 'skip');
    const passed = results.length - failed.length - skipped.length;
    const lines: string[] = [];
    for (const f of failed.slice(0, maxFail)) lines.push(`FAIL ${f.name.slice(0, 30)}: ${(f.detail ?? '').slice(0, detailChars)}${f.seq?.length ? ' @' + f.seq.slice(0, 3).join(',') : ''}`);
    if (failed.length > maxFail) lines.push(`+${failed.length - maxFail} more failures (see ref)`);
    if (skipped.length) {
        const byReason = new Map<string, string[]>();
        for (const s of skipped) byReason.set(s.detail ?? '', [...(byReason.get(s.detail ?? '') ?? []), s.name]);
        lines.push('skip: ' + [...byReason].map(([reason, names]) => `${names.join(',')} (${reason})`).join('; '));
    }
    if (!failed.length && !skipped.length) lines.push(`ok ${passed}`);
    return { pass: passed, fail: failed.length, skip: skipped.length, lines };
}
