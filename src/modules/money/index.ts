// Decimal money compare and wallet delta (P4-T05).
// Amounts are integers scaled by 1e8 (BigInt), so 0.1 + 0.2 equals 0.3 exactly. Floats are never added.
import { KitError } from '../../contracts/index.js';

const SCALE = 8;
const FACTOR = 10n ** BigInt(SCALE);

export type Amount = bigint;

/** Parse a number or numeric string. Numbers are read through their shortest decimal text (JSON already did that). */
export function dec(value: number | string): Amount {
    const text = typeof value === 'number' ? String(value) : value.trim();
    const m = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
    if (!m) throw new KitError('SCHEMA_MISMATCH', `not a money amount: ${text.slice(0, 20)}`, 'send a plain decimal');
    const fraction = (m[3] ?? '').padEnd(SCALE, '0');
    if (fraction.length > SCALE && /[1-9]/.test(fraction.slice(SCALE))) throw new KitError('SCHEMA_MISMATCH', `too many decimals: ${text.slice(0, 20)}`, 'at most 8');
    const n = BigInt(m[2]) * FACTOR + BigInt(fraction.slice(0, SCALE));
    return m[1] ? -n : n;
}

export function fmt(a: Amount): string {
    const neg = a < 0n, abs = neg ? -a : a;
    const whole = abs / FACTOR, frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
    return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

export const add = (a: Amount, b: Amount) => a + b;
export const sub = (a: Amount, b: Amount) => a - b;
const abs = (a: Amount) => (a < 0n ? -a : a);

export interface WalletStep { before: number | string; bet: number | string; win: number | string; after: number | string }
export interface WalletCheck { pass: boolean; expected: string; actual: string; diff: string }

/** after must equal before - bet + win, within `tolerance` (default exactly zero). */
export function checkWalletDelta(step: WalletStep, tolerance: number | string = 0): WalletCheck {
    const expected = add(sub(dec(step.before), dec(step.bet)), dec(step.win));
    const actual = dec(step.after);
    const diff = actual - expected;
    return { pass: abs(diff) <= dec(tolerance), expected: fmt(expected), actual: fmt(actual), diff: fmt(diff) };
}
