#!/usr/bin/env node
// CLI adapter. Exit codes: 0 ok, 1 failure, 2 unavailable/unsupported/unstable.
// Calls go through the daemon when it runs, otherwise in this process.
//
// `approve` exists ONLY here and in the dashboard. It is the human approval step for staging writes; it is not an MCP
// tool and not a capability. An agent must never run it (README "Approving a write").
import { loadConfig } from '../modules/config/index.js';
import { Approvals } from '../modules/guard/index.js';
import { controllerMain } from '../service/paths.js';
import { serviceStatus, servicePlan, startService, stopService } from '../service/control.js';
import { makeGateway } from '../service/gateway.js';

const args = process.argv.slice(2);
const [command, operation] = args;
const flag = (name: string): string | undefined => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };

function exitCodeOf(result: { status: string; error?: { code: string } }): number {
    if (result.status === 'ok') return 0;
    return result.error && ['UNAVAILABLE_CAPABILITY', 'UNSUPPORTED_OPERATION', 'UNSTABLE'].includes(result.error.code) ? 2 : 1;
}

const cfg = loadConfig();
const gateway = makeGateway(cfg);
const call = (op: string, params: Record<string, unknown> = {}) => gateway.call({ formatVersion: 1, requestId: 'cli', operation: op, params });

if (command === 'describe') {
    console.log(JSON.stringify(await gateway.describe(operation && !operation.startsWith('--') ? operation : undefined)));
} else if (command === 'doctor') {
    const result = await call('gameplay.doctor');
    const data = result.data as { lines?: string[]; status?: string } | undefined;
    console.log((data?.lines ?? [JSON.stringify(result.error)]).join('\n'));
    process.exit(result.status === 'ok' && data?.status === 'ok' ? 0 : 1);
} else if (command === 'query' || command === 'run') {
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(flag('params') ?? '{}'); } catch { console.log('{"error":"--params is not valid JSON"}'); process.exit(1); }
    const result = await call(operation ?? '', params);
    console.log(JSON.stringify(result));
    process.exit(exitCodeOf(result));
} else if (command === 'propose') {
    const params = JSON.parse(flag('params') ?? '{}');
    const mutations = (flag('mutations') ?? '').split(';').filter(Boolean);
    const { hash, expiresInMs } = new Approvals(cfg.stateDir).propose({ operation: operation ?? '', params, mutations });
    console.log(JSON.stringify({ hash, mutations, approveWith: `reddog approve ${hash}`, expiresInMs }));
} else if (command === 'approve') {
    // USER-ONLY step.
    new Approvals(cfg.stateDir).approve(operation ?? '');
    console.log('approved (single use, expires in 10 minutes)');
} else if (command === 'service') {
    if (operation === 'status') console.log(JSON.stringify(await serviceStatus(cfg)));
    else if (operation === 'start') { const r = await startService(cfg); console.log(JSON.stringify(r)); process.exit(r.started || r.alreadyRunning ? 0 : 1); }
    else if (operation === 'stop') { const r = await stopService(cfg); console.log(JSON.stringify(r)); process.exit(r.stopped || r.reason === 'not-running' ? 0 : 1); }
    else if (operation === 'plan') console.log(JSON.stringify(servicePlan(cfg), null, 2));
    else { console.log('usage: reddog service status | start | stop | plan'); process.exit(1); }
} else if (command === 'dashboard') {
    // Runs the dashboard in the foreground; Ctrl+C stops it. It prints only its URL.
    await import(controllerMain());
} else {
    console.log('usage: reddog describe [op] | doctor | query <op> [--params json] | run <op> [--params json] | propose <op> --params json --mutations "a;b" | approve <hash> | service status|start|stop|plan | dashboard');
    process.exit(command ? 1 : 0);
}
