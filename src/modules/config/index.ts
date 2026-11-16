// Load and validate configuration; read the token file (section 7).
// The token is read only here, only on demand, and registered with the redactor. It is never returned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { KitError } from '../../contracts/index.js';
import { registerSecret } from '../redact/index.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ConfigSchema = z.object({
    previewBase: z.string().default('http://localhost:7456/'),
    tokenFile: z.string().default('~/.reddog/token.txt'),
    /** Optional. When null the VPN/staging reachability check is skipped. */
    stagingProbeUrl: z.string().nullable().default(null),
    /** Optional path of the Cocos project to inspect read-only. When null compile-cache and freshness checks are skipped. */
    cocosProject: z.string().nullable().default(null),
    chromePath: z.string().default('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    /** Extra Chrome flags. Default none: forcing software GL cut rAF from 60 to ~17 fps on a machine with a real GPU (S4 note). Add --enable-unsafe-swiftshader on machines without one. */
    chromeArgs: z.array(z.string()).default([]),
    /** Dashboard port. 0 = pick a free one (tests). */
    controllerPort: z.number().int().min(0).max(65535).default(7481),
    /** Per-game profile files (<id>.json). */
    profilesDir: z.string().default('./profiles'),
    /** Evidence, locks, plans and approvals live here. Defaults inside this project, never inside a game repository. */
    stateDir: z.string().default('./state'),
    /** Worst case measured in P0-K02 (about 1.5 chars/token). Uncalibrated: see docs/spikes/P0-K01-K02-token-baseline.md. */
    charsPerToken: z.number().min(1).max(8).default(1.5),
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

const expand = (p: string) => (p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

export function loadConfig(file: string = process.env.REDDOG_CONFIG ?? path.join(ROOT, 'reddog.config.local.json')): Config {
    let raw: unknown = {};
    if (fs.existsSync(file)) {
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch { throw new KitError('SCHEMA_MISMATCH', 'config file is not valid JSON', 'fix ' + path.basename(file)); }
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success)
        throw new KitError('SCHEMA_MISMATCH', 'bad config: ' + parsed.error.issues.map(i => i.path.join('.')).join(','), 'see reddog.config.example.json');
    const cfg = parsed.data;
    return {
        ...cfg,
        tokenFile: path.resolve(expand(cfg.tokenFile)),
        stateDir: path.resolve(ROOT, expand(cfg.stateDir)),
        profilesDir: path.resolve(ROOT, expand(cfg.profilesDir)),
        cocosProject: cfg.cocosProject ? path.resolve(expand(cfg.cocosProject)) : null,
    };
}

/** Reads the token (bare or pasted URL containing ?token=). Registers it for redaction. Never log or return it. */
export function readToken(cfg: Config): string {
    let raw: string;
    try { raw = fs.readFileSync(cfg.tokenFile, 'utf8').trim(); }
    catch { throw new KitError('ENV_FAILED', 'token file not readable', 'create the token file yourself'); }
    const m = raw.match(/[?&]token=([^&\s]+)/);
    const token = m ? decodeURIComponent(m[1]) : raw;
    registerSecret(token);
    return token;
}
