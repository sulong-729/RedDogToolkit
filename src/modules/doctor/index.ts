// Environment checks, one line per failure with its fix (P1-T06, P1-K01, P1-K02).
// Read-only. A check that cannot run (not configured) is skipped, never reported as passed.
import fs from 'node:fs';
import type { Config } from '../config/index.js';
import { bundleFreshness, compileCacheConsistency } from '../freshness/index.js';
import { realProbes, type Probes } from './probes.js';

export interface Check { name: string; state: 'ok' | 'fail' | 'skip'; detail: string; fix?: string }
export interface DoctorResult { status: 'ok' | 'failed'; exitCode: 0 | 1; checks: Check[] }

export async function runDoctor(cfg: Config, probes: Probes = realProbes()): Promise<DoctorResult> {
    const checks: Check[] = [];
    const add = (name: string, state: Check['state'], detail: string, fix?: string) => checks.push({ name, state, detail, ...(fix ? { fix } : {}) });

    add('chrome', fs.existsSync(cfg.chromePath) ? 'ok' : 'fail', 'browser binary', 'set chromePath');

    const tokenSize = probes.fileSize(cfg.tokenFile);
    add('token', tokenSize && tokenSize > 0 ? 'ok' : 'fail', 'token file missing or empty', 'create the token file yourself');

    if (cfg.cocosProject) add('editor', probes.cocosRunning() ? 'ok' : 'fail', 'Cocos editor', 'open the project in Cocos');
    else add('editor', 'skip', 'cocosProject not set');

    const preview = await probes.http(cfg.previewBase, 5000);
    const isCocos = preview.ok && preview.status === 200 && /Cocos Creator/i.test(preview.text ?? '');
    add('preview', isCocos ? 'ok' : 'fail', preview.ok ? `HTTP ${preview.status}, not a Cocos preview` : `unreachable ${preview.error}`, 'start the preview; free the port');

    const cache = compileCacheConsistency(cfg, probes);
    add('cache', cache.ok === null ? 'skip' : cache.ok ? 'ok' : 'fail', cache.detail, 'quit Cocos, delete its temp/, reopen');

    const fresh = bundleFreshness(cfg, probes);
    add('bundle', fresh.fresh === null ? 'skip' : fresh.fresh ? 'ok' : 'fail', fresh.reason, 'focus the Cocos editor');

    if (cfg.stagingProbeUrl) {
        const staging = await probes.http(cfg.stagingProbeUrl, 6000);
        add('vpn', staging.ok ? 'ok' : 'fail', staging.ok ? `HTTP ${staging.status}` : `unreachable ${staging.error}`, 'connect the VPN');
    } else add('vpn', 'skip', 'stagingProbeUrl not set');

    const failed = checks.some(c => c.state === 'fail');
    return { status: failed ? 'failed' : 'ok', exitCode: failed ? 1 : 0, checks };
}

/** Compact output for the agent: failures only, one line each; a single line when nothing failed. */
export function doctorLines(result: DoctorResult): string[] {
    const failures = result.checks.filter(c => c.state === 'fail');
    if (!failures.length) {
        const skipped = result.checks.filter(c => c.state === 'skip').length;
        return [`ok ${result.checks.length - skipped}/${result.checks.length}` + (skipped ? ` (${skipped} skipped)` : '')];
    }
    return failures.map(c => `FAIL ${c.name}: ${c.detail} -> ${c.fix}`);
}
