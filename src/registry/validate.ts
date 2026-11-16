// Descriptor check run BEFORE Registry.register (P1-T09). Kept outside the Forge-mirrored contracts on purpose,
// so a later merge with Forge stays a plain diff.
import { z } from 'zod';
import { KitError, type Capability } from '../contracts/index.js';

const Descriptor = z.object({
    name: z.string().regex(/^gameplay\.[a-z0-9.]+$/, 'must look like gameplay.<name>'),
    area: z.string().min(1),
    process: z.string().min(1),
    readOnly: z.boolean(),
    availability: z.enum(['available', 'requires-editor', 'requires-play-mode', 'requires-device', 'unavailable', 'experimental']),
    facade: z.enum(['describe', 'query', 'propose', 'apply', 'job', 'artifact']),
    resultBudgetTokens: z.number().int().positive().nullable(),
    verification: z.string().min(1),
});

export function validateCapability(cap: Partial<Capability>): Capability {
    const parsed = Descriptor.safeParse(cap);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new KitError('SCHEMA_MISMATCH', `capability ${cap.name ?? '?'}: invalid field ${issue.path.join('.') || '?'}`, 'fix the descriptor');
    }
    if (!(cap.inputSchema instanceof z.ZodType))
        throw new KitError('SCHEMA_MISMATCH', `capability ${cap.name}: invalid field inputSchema`, 'fix the descriptor');
    if (cap.availability === 'available' && typeof cap.handler !== 'function')
        throw new KitError('SCHEMA_MISMATCH', `capability ${cap.name}: available without a handler`, 'add a handler or mark unavailable');
    return cap as Capability;
}
