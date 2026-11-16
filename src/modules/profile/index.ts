// Load and validate per-game profiles (P4-T07).
// A profile is optional. Checks that need one report `skipped`, never `pass`.
// Mappings only name keys someone has VERIFIED against the real game; null means "not known".
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { KitError } from '../../contracts/index.js';

const regexSource = z.string().min(1).refine((s) => { try { new RegExp(s); return true; } catch { return false; } }, 'not a valid regular expression');

const ENV = z.enum(['dev', 'staging']);
const SEGMENT = /^[A-Za-z0-9_-]{1,60}$/;

/** `{env}` is replaced by dev or staging. https only, except loopback (used by tests). No credentials, query or fragment in the URL. */
function validCheatBase(template: string): boolean {
    try {
        const u = new URL(template.replaceAll('{env}', 'staging'));
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
        return (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) && !u.username && !u.password && !u.search && !u.hash;
    } catch { return false; }
}

/** Where and how to call a team's HTTP cheat endpoint. Real values live in a PRIVATE profile, never in this repository. */
export const CheatSchema = z.object({
    baseUrl: z.string().refine(validCheatBase, 'must be https (or loopback http) with no credentials, query or fragment'),
    serviceId: z.string().regex(SEGMENT),
    sendPath: z.string().regex(SEGMENT),
    clearSessionPath: z.string().regex(SEGMENT).default('clearsession'),
    tableFormatField: z.string().regex(/^[A-Za-z0-9_]{1,40}$/).default('tableFormat'),
    /** Environments this profile may write to. Default staging only. */
    allowedEnvironments: z.array(ENV).min(1).default(['staging']),
    defaultCurrency: z.string().regex(/^[A-Za-z]{2,5}$/).default('usd'),
    presets: z.record(z.string().regex(/^[\w .-]{1,60}$/), z.object({
        matrixData: z.string().min(1).max(20000),
        tableFormat: z.string().max(2000).optional(),
        extra: z.record(z.string(), z.string().max(500)).optional(),
    }).strict()),
}).strict();
export type CheatConfig = z.infer<typeof CheatSchema>;

export const ProfileSchema = z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    gameDir: z.string(),
    cheatProject: z.string().nullable().optional(),
    environment: z.enum(['staging']).nullable().optional(),
    testUser: z.string().nullable().optional(),
    presets: z.array(z.object({ name: z.string(), mutates: z.boolean(), expects: z.string().optional() }).strict()).default([]),
    watchlist: z.array(z.object({ name: z.string(), pathContains: z.string(), spine: z.boolean().optional() }).strict()).default([]),
    /** Server field names for the wallet check. null = unknown, so the wallet check is skipped. */
    wallet: z.object({ balance: z.string().nullable(), bet: z.string().nullable(), win: z.string().nullable() }).strict().optional(),
    nonNegative: z.array(z.string()).default([]),
    /** Regexes with named groups applied to console lines. Without them trace-based checks are skipped. */
    trace: z.object({ trigger: regexSource.optional(), start: regexSource.optional(), end: regexSource.optional() }).strict().optional(),
    hangMs: z.number().int().positive().optional(),
    knownDuplicateRegistrations: z.array(z.object({ module: z.string(), count: z.number().int().min(2) }).strict()).default([]),
    entry: z.object({ startButton: z.string().nullable() }).strict().optional(),
    cheat: CheatSchema.optional(),
    viewports: z.array(z.object({ width: z.number().int(), height: z.number().int() }).strict()).default([]),
    /** Free text: what is NOT verified about this profile. */
    unverified: z.array(z.string()).default([]),
}).strict();

export type Profile = z.infer<typeof ProfileSchema>;

export function parseProfile(raw: unknown, source = 'profile'): Profile {
    const parsed = ProfileSchema.safeParse(raw);
    if (!parsed.success) {
        const i = parsed.error.issues[0];
        throw new KitError('SCHEMA_MISMATCH', `${source}: bad field ${i.path.join('.') || '?'}`, 'fix the profile');
    }
    return parsed.data;
}

export function loadProfile(profilesDir: string, id: string): Profile | null {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new KitError('SCHEMA_MISMATCH', 'bad game id', 'use letters, digits, - or _');
    const file = path.join(profilesDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new KitError('SCHEMA_MISMATCH', `${id}.json is not JSON`, 'fix the file'); }
    return parseProfile(raw, `${id}.json`);
}
