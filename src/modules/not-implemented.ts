import { KitError } from '../contracts/index.js';

/** Scaffold placeholder. Calling it fails loudly; nothing here may be treated as working. */
export function notImplemented(module: string) {
    return (): never => {
        throw new KitError('UNAVAILABLE_CAPABILITY', `module ${module} is not implemented`, 'Not implemented in this release.');
    };
}
