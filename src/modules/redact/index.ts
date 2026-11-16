// Mask tokens and secrets in any string or object (P1-T01/T02/T08).
// Ported from prototype/src/redact.js.
const QUERY_SECRET = /([?&](?:token|access_token|auth|key|password)=)[^&\s"']+/gi;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

const secrets: string[] = [];

/** Register an exact secret value (for example the game token) so it is masked wherever it appears. */
export function registerSecret(value: string | null | undefined): void {
    if (value && value.length >= 6 && !secrets.includes(value)) secrets.push(value);
}

export function redactText(input: string): string {
    let out = input.replace(QUERY_SECRET, '$1[REDACTED]').replace(BEARER, '$1[REDACTED]');
    for (const secret of secrets) out = out.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
    return out;
}

/** Redact any JSON-serializable value. Returns the same shape. */
export function redactValue<T>(value: T): T {
    if (typeof value === 'string') return redactText(value) as unknown as T;
    if (value === null || value === undefined) return value;
    return JSON.parse(redactText(JSON.stringify(value))) as T;
}
