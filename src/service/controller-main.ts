#!/usr/bin/env node
// Entry point for the dashboard. Prints only its URL (no key, no token).
import { loadConfig } from '../modules/config/index.js';
import { startController } from './controller.js';

const cfg = loadConfig();
const controller = await startController(cfg, { configFile: process.env.REDDOG_CONFIG });
console.log(controller.url);
const stop = () => { void controller.close().then(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
