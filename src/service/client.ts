// Client side of the daemon RPC: read the endpoint file, check it, call it. Used by the CLI, the MCP adapter and the controller.
import fs from 'node:fs';
import { endpointFile } from './paths.js';

export interface Endpoint { url: string; token: string; pid: number; instanceId: string }

/** The endpoint file is trusted only if it names a plain-http loopback address. Anything else is ignored. */
export function readEndpoint(stateDir: string): Endpoint | null {
    try {
        const value = JSON.parse(fs.readFileSync(endpointFile(stateDir), 'utf8')) as Endpoint;
        const url = new URL(value.url);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || typeof value.token !== 'string' || typeof value.pid !== 'number') return null;
        return value;
    } catch { return null; }
}

export interface Health { service: string; instanceId: string; pid: number; version: string }

async function request(endpoint: Endpoint, method: 'GET' | 'POST', route: string, body?: unknown, timeoutMs = 3000): Promise<{ status: number; json: any }> {
    const res = await fetch(endpoint.url + route, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: 'Bearer ' + endpoint.token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
}

/** Health only counts when the answering process is the one the endpoint file names (same pid and instance id). */
export async function health(endpoint: Endpoint): Promise<Health | null> {
    try {
        const { status, json } = await request(endpoint, 'GET', '/health', undefined, 1500);
        return status === 200 && json?.instanceId === endpoint.instanceId && json?.pid === endpoint.pid ? json : null;
    } catch { return null; }
}

/** Call the running daemon. Returns null when there is no daemon, so the caller can decide what to do. */
export async function callDaemon(stateDir: string, route: '/v1/rpc' | '/v1/describe' | '/v1/stop', body: unknown): Promise<{ status: number; json: any } | null> {
    const endpoint = readEndpoint(stateDir);
    if (!endpoint || !(await health(endpoint))) return null;
    try { return await request(endpoint, 'POST', route, body, 60000); } catch { return null; }
}
