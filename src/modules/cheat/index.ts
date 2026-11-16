// HTTP cheat adapter: force a server-side state (a free-game trigger, a big win) through a team's cheat endpoint.
//
// Every call is a WRITE to a backend, so it only ever runs from an approved plan (propose -> a human approves the
// hash -> apply). The user id (the test account's login token) is read by this process from the token file; it is not
// an argument, it is not in the plan, and it never appears in a reply, a log or a plan file (the redactor masks it).
// Where to call, and the preset data, come from the profile's `cheat` block, which belongs in a private profile.
import { z } from 'zod';
import { KitError } from '../../contracts/index.js';
import { readToken, type Config } from '../config/index.js';
import { Approvals } from '../guard/index.js';
import { loadProfile, type CheatConfig } from '../profile/index.js';

export type CheatEnvironment = 'dev' | 'staging';
export type CheatAction = 'send' | 'clear-session';

export const CheatTargetSchema = z.object({
    game: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    action: z.enum(['send', 'clear-session']).default('send'),
    environment: z.enum(['dev', 'staging']).default('staging'),
    preset: z.string().min(1).max(60).optional(),
    currency: z.string().regex(/^[A-Za-z]{2,5}$/).optional(),
}).strict();
export type CheatTarget = z.infer<typeof CheatTargetSchema>;

/** https://<base with {env} filled>/<serviceId>/<path>. Built with URL so a bad segment cannot escape the path. */
export function cheatUrl(c: CheatConfig, environment: CheatEnvironment, action: CheatAction): URL {
    const url = new URL(c.baseUrl.replaceAll('{env}', environment));
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${c.serviceId}/${action === 'send' ? c.sendPath : c.clearSessionPath}`;
    return url;
}

function cheatConfigOf(cfg: Config, game: string): CheatConfig {
    const profile = loadProfile(cfg.profilesDir, game);
    if (!profile) throw new KitError('NOT_FOUND', `no profile for ${game}`, 'create the profile');
    if (!profile.cheat) throw new KitError('UNAVAILABLE_CAPABILITY', `profile ${game} has no cheat block`, 'add one to the private profile');
    return profile.cheat;
}

/** What a human is asked to approve. Plain words, no token, no matrix content. */
export function describeCheat(c: CheatConfig, t: CheatTarget): string[] {
    const u = cheatUrl(c, t.environment, t.action);
    const host = u.host + u.pathname;
    if (t.action === 'clear-session')
        return [`POST ${t.environment} ${host}: clear the token-file user's session`, 'an open Free/Bonus session is LOST'];
    return [`POST ${t.environment} ${host}: preset "${t.preset}" for the token-file user`, 'arms the next result only; a spin is still needed', 'no Clear Session'];
}

/** Validate a request and store a plan. Writes nothing to any backend. */
export function planCheat(cfg: Config, approvals: Approvals, input: unknown) {
    const t = CheatTargetSchema.parse(input);
    const c = cheatConfigOf(cfg, t.game);
    if (!c.allowedEnvironments.includes(t.environment))
        throw new KitError('WRITE_GUARD', `${t.environment} is not allowed for ${t.game}`, `allowed: ${c.allowedEnvironments.join(', ')}`);
    if (t.action === 'send') {
        if (!t.preset) throw new KitError('SCHEMA_MISMATCH', 'preset is required', 'name a preset from the profile');
        if (!c.presets[t.preset]) throw new KitError('NOT_FOUND', `unknown preset "${t.preset}"`, `known: ${Object.keys(c.presets).join(', ')}`);
    }
    // Fail now, not after the approval is spent: the token file must be readable.
    readToken(cfg);
    const mutations = describeCheat(c, t);
    const { hash, expiresInMs } = approvals.propose({ operation: 'gameplay.cheat', params: t, mutations });
    // Kept small on purpose: the reply must fit its token budget, and the hash is the only thing repeated elsewhere.
    return { hash, mutations, expiresInMs };
}

export type CheatOutcome = { outcome: 'sent'; httpStatus: number; bodyHead: string } | { outcome: 'unknown'; reason: string };

/**
 * Perform the approved call once. No retries and no redirects. If the answer is not known (timeout, reset, redirect
 * refused) the outcome is `unknown`: the server may or may not have acted, so it must not be replayed blindly.
 */
export async function sendCheat(cfg: Config, planParams: unknown, fetchImpl: typeof fetch = fetch): Promise<CheatOutcome> {
    const t = CheatTargetSchema.parse(planParams);
    const c = cheatConfigOf(cfg, t.game);
    if (!c.allowedEnvironments.includes(t.environment)) throw new KitError('WRITE_GUARD', `${t.environment} is not allowed for ${t.game}`);
    const userId = readToken(cfg);
    const url = cheatUrl(c, t.environment, t.action);
    const init: RequestInit = { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000) };

    if (t.action === 'clear-session') {
        url.searchParams.set('userId', userId);
        url.searchParams.set('currency', t.currency ?? c.defaultCurrency);
    } else {
        const preset = c.presets[t.preset as string];
        if (!preset) throw new KitError('NOT_FOUND', 'unknown preset', 'regenerate the plan');
        const body = new URLSearchParams({ serviceId: c.serviceId, userId, matrixData: preset.matrixData });
        if (preset.tableFormat !== undefined) body.set(c.tableFormatField, preset.tableFormat);
        for (const [k, v] of Object.entries(preset.extra ?? {})) if (!body.has(k)) body.set(k, v);
        init.headers = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
        init.body = body.toString();
    }
    try {
        const res = await fetchImpl(url, init);
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new KitError('ENV_FAILED', `cheat API answered ${res.status}`, 'check the plan, the user and the environment; it was not retried');
        return { outcome: 'sent', httpStatus: res.status, bodyHead: text.slice(0, 200) };
    } catch (e) {
        if (e instanceof KitError) throw e;
        return { outcome: 'unknown', reason: (e as Error).name || 'network error' };
    }
}
