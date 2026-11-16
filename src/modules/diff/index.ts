// Compare two runs and return ONLY the difference (P4-T08, P4-K02).
// Records are reduced to a normalised key (numbers, ids and hashes collapsed) and compared by count, so the reply is
// as large as the difference, not as large as either run.
import { loadAll } from '../evidence/index.js';
import type { EvidenceFile } from '../store/index.js';

type R = { seq: number; t: number; [key: string]: unknown };

/** Collapse digits and long hex/uuid runs so two runs of the same flow produce the same key. */
export function normalise(text: string): string {
    return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '~').replace(/[0-9a-f]{12,}/gi, '~').replace(/\d+/g, '#').slice(0, 60);
}

export function keyOf(file: EvidenceFile, r: R): string[] {
    if (file === 'events.jsonl') return [`${r.type}|${r.level ?? ''}|${normalise(String(r.text ?? r.name ?? ''))}`];
    if (file === 'server.jsonl') return [`${r.kind}|${r.method ?? ''}|${normalise(String(r.url ?? r.data ?? '').split('?')[0])}|${r.status ?? ''}`];
    if (file === 'ui-frames.jsonl') return Object.entries((r.changes ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}=${normalise(String(v))}`);
    return [`frame`];
}

export interface DiffResult {
    same: boolean;
    onlyA: Array<{ key: string; n: number }>;
    onlyB: Array<{ key: string; n: number }>;
    changed: Array<{ key: string; a: number; b: number }>;
    more: number;
}

function counts(file: EvidenceFile, records: R[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of records) for (const k of keyOf(file, r)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
}

/** Default 4 per list keeps the reply inside its budget; ask for more with `limit` and accept that a big reply is cut. */
export function diffRuns(stateDir: string, a: string, b: string, file: EvidenceFile = 'events.jsonl', limit = 4): DiffResult {
    const ca = counts(file, loadAll(stateDir, a, file)), cb = counts(file, loadAll(stateDir, b, file));
    const onlyA: DiffResult['onlyA'] = [], onlyB: DiffResult['onlyB'] = [], changed: DiffResult['changed'] = [];
    for (const [key, n] of ca) { const m = cb.get(key); if (m === undefined) onlyA.push({ key, n }); else if (m !== n) changed.push({ key, a: n, b: m }); }
    for (const [key, n] of cb) if (!ca.has(key)) onlyB.push({ key, n });
    const total = onlyA.length + onlyB.length + changed.length;
    const by = <T extends { n?: number; a?: number; b?: number }>(x: T) => Math.abs((x.n ?? 0) || ((x.a ?? 0) - (x.b ?? 0)));
    onlyA.sort((x, y) => by(y) - by(x)); onlyB.sort((x, y) => by(y) - by(x)); changed.sort((x, y) => by(y) - by(x));
    const shown = { onlyA: onlyA.slice(0, limit), onlyB: onlyB.slice(0, limit), changed: changed.slice(0, limit) };
    return { same: total === 0, ...shown, more: total - shown.onlyA.length - shown.onlyB.length - shown.changed.length };
}
