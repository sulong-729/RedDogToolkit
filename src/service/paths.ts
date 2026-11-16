// Where the service keeps its files. Everything lives under the configured state directory.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, type Config } from '../modules/config/index.js';
import { redactText } from '../modules/redact/index.js';

export const SERVICE_NAME = 'reddog-toolkit';
export const LAUNCH_LABEL = 'com.reddog.toolkit';

export const endpointFile = (stateDir: string) => path.join(stateDir, 'endpoint.json');
export const logFile = (stateDir: string, name: 'daemon' | 'service' | 'controller') => path.join(stateDir, 'logs', `${name}.log`);

export function version(): string {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
}

/** Append one redacted line to a service log. Logging must never break the caller. */
export function log(cfg: Pick<Config, 'stateDir'>, name: 'daemon' | 'service' | 'controller', message: string): void {
    try {
        const file = logFile(cfg.stateDir, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, redactText(`${new Date().toISOString()} ${message}`) + '\n');
    } catch { /* ignore */ }
}

/** The compiled entry points the service launches. */
export const daemonMain = () => path.join(ROOT, 'dist/service/daemon-main.js');
export const controllerMain = () => path.join(ROOT, 'dist/service/controller-main.js');
