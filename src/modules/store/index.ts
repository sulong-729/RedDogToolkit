// Append-only run evidence with a shared clock, runId and seq.
// Every record is redacted and written synchronously, so a crash or reload loses nothing already recorded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { redactText } from '../redact/index.js';

export type EvidenceFile = 'events.jsonl' | 'ui-frames.jsonl' | 'server.jsonl' | 'frames.jsonl';
const EVIDENCE_FILES: EvidenceFile[] = ['events.jsonl', 'ui-frames.jsonl', 'server.jsonl', 'frames.jsonl'];

export interface StoreOptions { maxBytesPerFile?: number }

export class RunStore {
    readonly runId: string;
    readonly dir: string;
    checkpoint: string | null = null;
    readonly counts: Record<EvidenceFile, number> = { 'events.jsonl': 0, 'ui-frames.jsonl': 0, 'server.jsonl': 0, 'frames.jsonl': 0 };
    readonly dropped: Record<EvidenceFile, number> = { 'events.jsonl': 0, 'ui-frames.jsonl': 0, 'server.jsonl': 0, 'frames.jsonl': 0 };
    private seq = 0;
    private readonly bytes: Record<string, number> = {};
    private readonly fds: Record<string, number> = {};
    private readonly max: number;

    constructor(stateDir: string, readonly scenario: string, options: StoreOptions = {}) {
        // Short on purpose (22 chars): the run id appears in responses and every character costs tokens.
        this.runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '')}-${crypto.randomBytes(3).toString('hex')}`;
        this.dir = path.join(stateDir, 'artifacts', this.runId);
        fs.mkdirSync(this.dir, { recursive: true });
        this.max = options.maxBytesPerFile ?? 5 * 1024 * 1024;
        for (const f of ['flow.log', ...EVIDENCE_FILES]) {
            this.fds[f] = fs.openSync(path.join(this.dir, f), 'a');
            this.bytes[f] = 0;
        }
        this.flow(`run ${this.runId} scenario=${scenario}`);
    }

    private closed = false;

    flow(message: string): void {
        if (this.closed) return;
        fs.writeSync(this.fds['flow.log'], redactText(`${new Date().toISOString()} ${message}`) + '\n');
    }

    setCheckpoint(name: string): void {
        this.checkpoint = name;
        this.flow(`checkpoint ${name}`);
    }

    /** Returns false (and counts the drop) once a file hit its size cap; the drop is logged once, never silent. */
    append(file: EvidenceFile, record: Record<string, unknown>): boolean {
        if (this.closed) return false;
        const line = redactText(JSON.stringify({ runId: this.runId, seq: ++this.seq, t: Date.now(), checkpoint: this.checkpoint, ...record })) + '\n';
        if (this.bytes[file] + line.length > this.max) {
            if (this.dropped[file]++ === 0) this.flow(`cap reached for ${file}; later records dropped`);
            return false;
        }
        fs.writeSync(this.fds[file], line);
        this.bytes[file] += line.length;
        this.counts[file]++;
        return true;
    }

    /** Binary artifact (screenshot, frame) under the run directory. Returns the path relative to the run. */
    writeBinary(rel: string, data: Buffer): string {
        const full = path.join(this.dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
        return rel;
    }

    writeJson(name: string, value: unknown): void {
        fs.writeFileSync(path.join(this.dir, name), redactText(JSON.stringify(value, null, 2)));
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const fd of Object.values(this.fds)) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    }
}

/** Last N lines of an artifact, capped at 200. Path must stay inside the artifacts directory. */
export function readTail(stateDir: string, relPath: string, maxLines = 40): string[] {
    const root = path.resolve(stateDir, 'artifacts');
    const p = path.resolve(root, relPath);
    if (!p.startsWith(root + path.sep)) throw new Error('path outside artifact root');
    return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-Math.min(maxLines, 200));
}
