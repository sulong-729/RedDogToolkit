// Paged, revisioned reads of a run's evidence (P2-T08/K03). Read-only.
//   revision    changes whenever the file changes; a repeat read with the same revision answers `unchanged`.
//   cursor      byte offset bound to (runId, file); a cursor used elsewhere is CURSOR_MISMATCH.
//   run missing SNAPSHOT_EXPIRED (the run was pruned or never existed).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KitError } from '../../contracts/index.js';
import type { EvidenceFile } from '../store/index.js';

export interface EvidenceQuery { runId: string; cursor?: string; ifRevision?: string; limit?: number }
export type EvidencePage = { unchanged: true; revision: string } | { lines: string[]; nextCursor: string | null; revision: string };

const RUN_ID = /^[\w.-]{1,64}$/;
const MAX_LINE_CHARS = 500;

/** The reader already knows the runId, and a null checkpoint says nothing: dropping them cuts a large share of each line's tokens. */
function slim(line: string): string {
    try {
        const record = JSON.parse(line);
        delete record.runId;
        if (record.checkpoint === null) delete record.checkpoint;
        return JSON.stringify(record);
    } catch { return line; }
}

const sign =(runId: string, file: string, offset: number) => crypto.createHash('sha1').update(`${runId}|${file}|${offset}`).digest('hex').slice(0, 8);

export function encodeCursor(runId: string, file: string, offset: number): string {
    return `${offset}.${sign(runId, file, offset)}`;
}

function decodeCursor(runId: string, file: string, cursor: string): number {
    const m = cursor.match(/^(\d+)\.([0-9a-f]{8})$/);
    if (!m || sign(runId, file, Number(m[1])) !== m[2]) throw new KitError('CURSOR_MISMATCH', 'cursor does not belong to this query', 'start again without a cursor');
    return Number(m[1]);
}

export function readEvidence(stateDir: string, file: EvidenceFile, query: EvidenceQuery): EvidencePage {
    if (!RUN_ID.test(query.runId)) throw new KitError('SCHEMA_MISMATCH', 'bad runId', 'use an id from a run result');
    const full = path.join(stateDir, 'artifacts', query.runId, file);
    let stat: fs.Stats;
    try { stat = fs.statSync(full); } catch { throw new KitError('SNAPSHOT_EXPIRED', 'run or file not found', 'run it again'); }

    const revision = crypto.createHash('sha1').update(`${stat.size}:${Math.floor(stat.mtimeMs)}`).digest('hex').slice(0, 10);
    if (!query.cursor && query.ifRevision === revision) return { unchanged: true, revision };

    const start = query.cursor ? decodeCursor(query.runId, file, query.cursor) : 0;
    if (start > stat.size) throw new KitError('CURSOR_MISMATCH', 'cursor is past the end', 'start again without a cursor');

    const fd = fs.openSync(full, 'r');
    try {
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
        const buffer = Buffer.alloc(Math.min(stat.size - start, 256 * 1024));
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const lines: string[] = [];
        let pos = 0;
        while (pos < buffer.length && lines.length < limit) {
            const newline = buffer.indexOf(10, pos);
            if (newline === -1) {
                // No terminator: a line still being written, unless one line fills the whole window (then take it, to make progress).
                if (pos === 0 && buffer.length >= 256 * 1024) pos = buffer.length;
                break;
            }
            const raw = slim(buffer.toString('utf8', pos, newline));
            if (raw) lines.push(raw.length > MAX_LINE_CHARS ? raw.slice(0, MAX_LINE_CHARS) + '…' : raw);
            pos = newline + 1;
        }
        const next = start + pos;
        return { lines, nextCursor: next < stat.size ? encodeCursor(query.runId, file, next) : null, revision };
    } finally { fs.closeSync(fd); }
}

/** Whole evidence file as records (for analysis, not for replies). Same run-id and expiry rules as the paged reader. */
export function loadAll(stateDir: string, runId: string, file: EvidenceFile): Array<{ seq: number; t: number; [key: string]: unknown }> {
    if (!RUN_ID.test(runId)) throw new KitError('SCHEMA_MISMATCH', 'bad runId', 'use an id from a run result');
    const full = path.join(stateDir, 'artifacts', runId, file);
    if (!fs.existsSync(full)) throw new KitError('SNAPSHOT_EXPIRED', 'run or file not found', 'run it again');
    return fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
