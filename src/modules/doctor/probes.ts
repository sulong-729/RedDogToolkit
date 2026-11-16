// Read-only environment probes. Tests replace these with fixtures; nothing here writes anything.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface HttpResult { ok: boolean; status?: number; text?: string; error?: string }

export interface Probes {
    exists(p: string): boolean;
    fileSize(p: string): number | null;
    mtimeMs(p: string): number | null;
    readJson(p: string): any | null;
    newestMtimeMs(dir: string, exts: string[]): number;
    http(url: string, timeoutMs: number): Promise<HttpResult>;
    cocosRunning(): boolean;
}

export function realProbes(): Probes {
    return {
        exists: (p) => fs.existsSync(p),
        fileSize: (p) => { try { return fs.statSync(p).size; } catch { return null; } },
        mtimeMs: (p) => { try { return fs.statSync(p).mtimeMs; } catch { return null; } },
        readJson: (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } },
        newestMtimeMs(dir, exts) {
            let newest = 0;
            const skip = new Set(['node_modules', '.git']);
            (function walk(d: string) {
                let entries: fs.Dirent[];
                try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
                for (const e of entries) {
                    if (skip.has(e.name)) continue;
                    const p = path.join(d, e.name);
                    if (e.isDirectory()) walk(p);
                    else if (exts.some(x => e.name.endsWith(x))) newest = Math.max(newest, fs.statSync(p).mtimeMs);
                }
            })(dir);
            return newest;
        },
        async http(url, timeoutMs) {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), timeoutMs);
            try {
                const res = await fetch(url, { signal: ctl.signal });
                const text = res.headers.get('content-type')?.includes('text') ? await res.text() : '';
                return { ok: true, status: res.status, text };
            } catch (e) {
                return { ok: false, error: (e as { cause?: { code?: string }; name?: string }).cause?.code ?? (e as Error).name };
            } finally { clearTimeout(timer); }
        },
        cocosRunning() {
            try { return execFileSync('pgrep', ['-f', 'CocosCreator.app/Contents/MacOS/CocosCreator']).toString().trim().length > 0; }
            catch { return false; }
        },
    };
}
