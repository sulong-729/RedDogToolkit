#!/usr/bin/env node
// Entry point the service launches. Refuses to start a second daemon for the same state directory.
import { loadConfig } from '../modules/config/index.js';
import { health, readEndpoint } from './client.js';
import { startDaemonServer } from './daemon.js';

const cfg = loadConfig();
const existing = readEndpoint(cfg.stateDir);
if (existing && await health(existing)) {
    console.error('already running');
    process.exit(0);
}
const daemon = await startDaemonServer(cfg);
const stop = () => { void daemon.close().then(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
