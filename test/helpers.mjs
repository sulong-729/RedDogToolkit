import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

export function tmpDir(prefix = 'reddog-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A complete Config pointing at throwaway paths. Never touches the real project or any game repository. */
export function testConfig(overrides = {}) {
    const dir = tmpDir();
    return {
        previewBase: 'http://127.0.0.1:1/',
        tokenFile: path.join(dir, 'token.txt'),
        stagingProbeUrl: null,
        cocosProject: null,
        chromePath: process.execPath,
        chromeArgs: [],
        controllerPort: 0,
        profilesDir: path.join(dir, 'profiles'),
        stateDir: path.join(dir, 'state'),
        charsPerToken: 1.5,
        ...overrides,
    };
}

/** Write evidence files for a run with exact timestamps, so timing based checks are deterministic. */
export function writeRun(stateDir, runId, { events = [], server = [], ui = [] }) {
    const dir = path.join(stateDir, 'artifacts', runId);
    fs.mkdirSync(dir, { recursive: true });
    let seq = 0;
    const lines = (list) => list.map(r => JSON.stringify({ runId, seq: ++seq, checkpoint: null, ...r })).join('\n') + (list.length ? '\n' : '');
    fs.writeFileSync(path.join(dir, 'events.jsonl'), lines(events));
    fs.writeFileSync(path.join(dir, 'server.jsonl'), lines(server));
    fs.writeFileSync(path.join(dir, 'ui-frames.jsonl'), lines(ui));
    return dir;
}

export function serve(body, status = 200) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => { res.writeHead(status, { 'Content-Type': 'text/html' }); res.end(body); });
        server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() }));
    });
}

/** Fixture Cocos project: assets/*.ts older than a temp import-map that lists the given chunks. */
export function cocosFixture({ chunks = ['./chunks/aa/a.js'], missing = [] } = {}) {
    const root = tmpDir('cocos-');
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/a.ts'), '// source');
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(root, 'assets/a.ts'), past, past);
    const base = path.join(root, 'temp/programming/packer-driver/targets/preview');
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'import-map.json'), JSON.stringify({ imports: Object.fromEntries(chunks.map((c, i) => ['file:///x' + i, c])), scopes: {} }));
    for (const c of chunks) {
        if (missing.includes(c)) continue;
        fs.mkdirSync(path.dirname(path.join(base, c)), { recursive: true });
        fs.writeFileSync(path.join(base, c), '//');
    }
    return root;
}

import { spawn } from 'node:child_process';
import { chromePath as realChrome } from './fixture.mjs';

/** Write a config file for child processes (daemon, MCP, CLI) that mirrors a test Config. */
export function writeConfigFile(cfg) {
    const file = path.join(path.dirname(cfg.stateDir), 'config.json');
    fs.writeFileSync(file, JSON.stringify({ stateDir: cfg.stateDir, tokenFile: cfg.tokenFile, profilesDir: cfg.profilesDir, controllerPort: 0, chromePath: cfg.chromePath }));
    return file;
}

/** Minimal MCP stdio client for tests: initialize, tools/list, tools/call. */
export function mcpClient(configFile, extraEnv = {}) {
    const child = spawn('node', ['dist/adapters/mcp.js'], { env: { ...process.env, REDDOG_CONFIG: configFile, ...extraEnv }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = ''; const waiting = new Map(); let id = 0;
    child.stdout.on('data', (d) => {
        buffer += d;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
            const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
            if (!line.trim()) continue;
            const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
        }
    });
    const rpc = (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
    return {
        async init() { await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); },
        tools: async () => (await rpc('tools/list', {})).result.tools,
        call: async (name, args) => JSON.parse((await rpc('tools/call', { name, arguments: args })).result.content[0].text),
        close: () => { child.kill(); },
    };
}

/** CPU seconds a process has used so far, from `ps`. */
export function cpuSeconds(pid) {
    return new Promise((resolve) => {
        const p = spawn('ps', ['-o', 'time=', '-p', String(pid)]); let out = '';
        p.stdout.on('data', d => { out += d; });
        p.on('close', () => { const m = out.trim().match(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/); resolve(m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN); });
    });
}

export const realChromePath = realChrome;
