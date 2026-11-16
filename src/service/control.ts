// Start, stop and describe the service (P8-T04, P8-T10).
// Ownership rules, as in Forge: stop only talks to the daemon the endpoint file names and only after that daemon proves
// it is the same process (pid + instance id). There is no kill of an arbitrary PID anywhere in this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Config } from '../modules/config/index.js';
import { callDaemon, health, readEndpoint } from './client.js';
import { LAUNCH_LABEL, daemonMain, endpointFile, log, logFile, version } from './paths.js';

export interface ServiceStatus { running: boolean; pid?: number; version?: string; instanceId?: string; autostart: 'installed' | 'not-installed' }

export const launchAgentPath = () => path.join(os.homedir(), 'Library/LaunchAgents', `${LAUNCH_LABEL}.plist`);

export async function serviceStatus(cfg: Config): Promise<ServiceStatus> {
    const autostart = fs.existsSync(launchAgentPath()) ? 'installed' : 'not-installed';
    const endpoint = readEndpoint(cfg.stateDir);
    const h = endpoint ? await health(endpoint) : null;
    return h ? { running: true, pid: h.pid, version: h.version, instanceId: h.instanceId, autostart } : { running: false, autostart };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) { if (await check()) return true; await sleep(100); }
    return check();
}

/** Start the daemon detached. If one already answers for this state directory, nothing is started. */
export async function startService(cfg: Config, configFile: string | undefined = process.env.REDDOG_CONFIG): Promise<{ started: boolean; alreadyRunning: boolean; pid?: number }> {
    const before = await serviceStatus(cfg);
    if (before.running) { log(cfg, 'service', 'start skipped: already running'); return { started: false, alreadyRunning: true, pid: before.pid }; }

    fs.mkdirSync(path.dirname(logFile(cfg.stateDir, 'daemon')), { recursive: true });
    const out = fs.openSync(logFile(cfg.stateDir, 'daemon'), 'a');
    const env = { ...process.env, ...(configFile ? { REDDOG_CONFIG: configFile } : {}) };
    const child = spawn(process.execPath, [daemonMain()], { detached: true, stdio: ['ignore', out, out], env });
    child.unref();
    fs.closeSync(out);

    const up = await until(async () => (await serviceStatus(cfg)).running, 8000);
    log(cfg, 'service', up ? 'start ok' : 'start failed');
    const after = await serviceStatus(cfg);
    return { started: up, alreadyRunning: false, pid: after.pid };
}

/** Ask the daemon that owns the endpoint file to stop itself. A stale or foreign endpoint is left alone. */
export async function stopService(cfg: Config): Promise<{ stopped: boolean; reason?: 'not-running' | 'did-not-stop' }> {
    const endpoint = readEndpoint(cfg.stateDir);
    if (!endpoint || !(await health(endpoint))) {
        // Only clean up an endpoint file whose process is gone; never touch a live process we cannot prove is ours.
        if (endpoint) { let alive = true; try { process.kill(endpoint.pid, 0); } catch { alive = false; } if (!alive) fs.rmSync(endpointFile(cfg.stateDir), { force: true }); }
        log(cfg, 'service', 'stop skipped: not running');
        return { stopped: false, reason: 'not-running' };
    }
    await callDaemon(cfg.stateDir, '/v1/stop', {});
    const down = await until(async () => !(await serviceStatus(cfg)).running, 5000);
    log(cfg, 'service', down ? 'stop ok' : 'stop failed');
    return down ? { stopped: true } : { stopped: false, reason: 'did-not-stop' };
}

/** What `service install` WOULD write. Printing it changes nothing: installing is a separate, explicit decision. */
export function servicePlan(cfg: Config) {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${daemonMain()}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>${logFile(cfg.stateDir, 'daemon')}</string>
  <key>StandardErrorPath</key><string>${logFile(cfg.stateDir, 'daemon')}</string>
</dict></plist>
`;
    return {
        label: LAUNCH_LABEL, version: version(), plistPath: launchAgentPath(), plist,
        wouldWrite: [launchAgentPath()],
        note: 'This is a plan only. Nothing has been written. Installing a login item changes your user configuration; do it yourself, on purpose.',
    };
}
