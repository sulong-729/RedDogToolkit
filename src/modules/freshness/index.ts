// Compiled bundle newer or older than the sources; never builds (P1-T06).
// Reads the Cocos project's temp/ only; never writes there.
import path from 'node:path';
import type { Config } from '../config/index.js';
import { realProbes, type Probes } from '../doctor/probes.js';

export interface Freshness { fresh: boolean | null; reason: string }

const IMPORT_MAP = 'temp/programming/packer-driver/targets/preview/import-map.json';

export function bundleFreshness(cfg: Pick<Config, 'cocosProject'>, probes: Probes = realProbes()): Freshness {
    if (!cfg.cocosProject) return { fresh: null, reason: 'cocosProject not configured' };
    const mapFile = path.join(cfg.cocosProject, IMPORT_MAP);
    const compiled = probes.mtimeMs(mapFile);
    if (compiled === null) return { fresh: false, reason: 'no compiled preview output; open the editor' };
    const newestSource = probes.newestMtimeMs(path.join(cfg.cocosProject, 'assets'), ['.ts']);
    if (compiled >= newestSource) return { fresh: true, reason: 'compiled output is newer than every .ts' };
    return { fresh: false, reason: `sources are newer by ${Math.round((newestSource - compiled) / 1000)}s; focus the editor so it recompiles` };
}

/** Every chunk named by import-map.json must exist. A mismatch is the stale-cache failure seen with the *.mjs_cjs errors. */
export function compileCacheConsistency(cfg: Pick<Config, 'cocosProject'>, probes: Probes = realProbes()): { ok: boolean | null; detail: string } {
    if (!cfg.cocosProject) return { ok: null, detail: 'cocosProject not configured' };
    const base = path.join(cfg.cocosProject, 'temp/programming/packer-driver/targets/preview');
    const map = probes.readJson(path.join(base, 'import-map.json'));
    if (!map) return { ok: false, detail: 'import-map.json missing or unreadable' };
    const targets = new Set<string>(Object.values(map.imports ?? {}) as string[]);
    for (const scope of Object.values(map.scopes ?? {}) as Record<string, string>[]) Object.values(scope).forEach(v => targets.add(v));
    const missing = [...targets].filter(t => t.startsWith('./') && !probes.exists(path.join(base, t)));
    return missing.length ? { ok: false, detail: `${missing.length} chunk(s) in import-map are missing` } : { ok: true, detail: `${targets.size} targets present` };
}
