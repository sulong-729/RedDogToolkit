// The installer, tested on the real zip in a throwaway HOME. Nothing here touches the real home directory.
// Simulated: files from a download (quarantine flag, lost executable bits), a missing/old Node, a foreign launcher, an
// unwritable folder, upgrade, uninstall. NOT testable here: a different Mac, Intel hardware, Gatekeeper's real prompt, root.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { mcpClient } from './helpers.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const zip = path.join(root, 'output', `RedDogToolkit-${version}-macos.zip`);
const skip = fs.existsSync(zip) ? false : 'run `npm run package` first';
const realHome = os.homedir();

/** A fresh fake machine: its own HOME, with the zip unpacked the way a user would. */
function machine() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'machine-'));
    const home = path.join(dir, 'home'); fs.mkdirSync(home);
    execFileSync('ditto', ['-x', '-k', zip, dir]);
    const bundle = path.join(dir, `RedDogToolkit-${version}`);
    const appRoot = path.join(home, 'Library/Application Support/RedDogToolkit');
    const env = { ...process.env, HOME: home, PATH: `${path.join(home, '.local/bin')}:${process.env.PATH}` };
    const run = (script, args = [], extraEnv = {}) => spawnSync('bash', [path.join(bundle, script), ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8' });
    return { dir, home, bundle, appRoot, env, run, bin: path.join(home, '.local/bin'), app: path.join(home, 'Applications/RedDogToolkit.app') };
}
const reddog = (m, args, extraEnv = {}) => spawnSync(path.join(m.bin, 'reddog'), args, { env: { ...m.env, ...extraEnv }, encoding: 'utf8' });

test('the bundle in the zip is clean: no state, tests, prototype, secrets, native binaries or ._ clutter', { skip }, () => {
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter(Boolean);
    const ours = names.filter(n => !n.includes('/app/node_modules/') && !n.includes('/node_modules/'));
    assert.deepEqual(ours.filter(n => /\/(state|prototype|test|artifacts|src)\//.test(n)), []);
    assert.deepEqual(names.filter(n => /\.local\.json$|\.token$|ledger\.jsonl$|endpoint\.json$|\/\._/.test(n)), []);
    assert.deepEqual(names.filter(n => /\.(node|dylib|so)$/.test(n)), [], 'pure JavaScript: one zip for Intel and Apple Silicon');
    assert.ok(names.some(n => n.endsWith('/INSTALL.txt')));
});

test('a clean install works end to end: command, daemon, dashboard launcher and MCP server all run', { skip }, async () => {
    const m = machine();
    const r = m.run('install.sh');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verified that it runs/);

    for (const f of [path.join(m.bin, 'reddog'), path.join(m.bin, 'reddog-mcp'), path.join(m.app, 'Contents/MacOS/RedDogToolkit')]) assert.ok(fs.statSync(f).mode & 0o100, f + ' is executable');
    assert.ok(fs.existsSync(path.join(m.app, 'Contents/Info.plist')));
    assert.equal(fs.readlinkSync(path.join(m.appRoot, 'current')), `versions/${version}`);
    const config = JSON.parse(fs.readFileSync(path.join(m.appRoot, 'config.json'), 'utf8'));
    assert.equal(config.stateDir, path.join(m.appRoot, 'state'), 'state lives outside the version folder, so upgrades keep it');
    assert.equal(config.profilesDir, path.join(m.appRoot, 'current/profiles'));

    assert.equal(reddog(m, ['describe']).status, 0);
    const start = reddog(m, ['service', 'start']); assert.equal(start.status, 0, start.stdout + start.stderr);
    const status = JSON.parse(reddog(m, ['service', 'status']).stdout);
    assert.equal(status.running, true);
    assert.equal(status.version, version);
    assert.equal(reddog(m, ['service', 'stop']).status, 0);
    assert.equal(JSON.parse(reddog(m, ['service', 'status']).stdout).running, false);

    const mcp = mcpClient(path.join(m.appRoot, 'config.json'));
    await mcp.init();
    assert.equal((await mcp.tools()).length, 6);
    mcp.close();

    assert.deepEqual(fs.readdirSync(path.join(m.home, 'Library')).sort(), ['Application Support'], 'no LaunchAgent, nothing else under Library');
    assert.equal(fs.existsSync(path.join(m.home, '.zshrc')), false, 'the shell profile is not created or edited');
});

test('a downloaded copy works: quarantine flag on every file and the executable bits stripped, installed with `bash install.sh`', { skip }, () => {
    const m = machine();
    execFileSync('chmod', ['-R', 'a-x', m.bundle]);
    execFileSync('chmod', ['-R', 'u+X', m.bundle]); // directories stay traversable; files lose x
    for (const f of ['install.sh', 'uninstall.sh']) fs.chmodSync(path.join(m.bundle, f), 0o644);
    spawnSync('xattr', ['-w', 'com.apple.quarantine', '0081;5f000000;Safari;', path.join(m.bundle, 'install.sh')]);
    spawnSync('xattr', ['-w', '-r', 'com.apple.quarantine', '0081;5f000000;Safari;', path.join(m.bundle, 'app/dist')]);
    assert.match(spawnSync('xattr', ['-l', path.join(m.bundle, 'install.sh')], { encoding: 'utf8' }).stdout, /quarantine/, 'precondition: the file is quarantined');

    const r = m.run('install.sh');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const flagged = spawnSync('xattr', ['-lr', path.join(m.appRoot, 'versions')], { encoding: 'utf8' }).stdout;
    assert.ok(!/quarantine/.test(flagged), 'the installed files carry no quarantine flag');
    assert.equal(reddog(m, ['describe']).status, 0);
});

test('Node problems are explained, not hidden: an explicit unusable Node is refused and nothing is installed', { skip }, () => {
    const m = machine();
    const old = path.join(m.dir, 'old-node'); fs.writeFileSync(old, '#!/bin/sh\nexit 1\n'); fs.chmodSync(old, 0o755);
    for (const bad of [old, path.join(m.dir, 'missing-node')]) {
        const r = m.run('install.sh', [], { REDDOG_NODE: bad });
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /not a usable Node 22\.16/);
    }
    assert.equal(fs.existsSync(path.join(m.appRoot, 'versions')), false, 'nothing was installed');
    assert.equal(fs.existsSync(path.join(m.bin, 'reddog')), false);
});

test('a launcher or app that is not ours is never overwritten', { skip }, () => {
    const m = machine();
    fs.mkdirSync(m.bin, { recursive: true });
    fs.writeFileSync(path.join(m.bin, 'reddog'), '#!/bin/sh\necho mine\n');
    const r = m.run('install.sh');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /was not created by RedDogToolkit/);
    assert.equal(fs.readFileSync(path.join(m.bin, 'reddog'), 'utf8'), '#!/bin/sh\necho mine\n');

    const m2 = machine();
    fs.mkdirSync(m2.app, { recursive: true });
    assert.notEqual(m2.run('install.sh').status, 0);
});

test('an unwritable target folder gives a plain message and installs nothing', { skip }, () => {
    const m = machine();
    fs.mkdirSync(path.join(m.home, '.local'), { recursive: true });
    fs.chmodSync(path.join(m.home, '.local'), 0o555);
    const r = m.run('install.sh');
    fs.chmodSync(path.join(m.home, '.local'), 0o755);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Cannot write to/);
    assert.equal(fs.existsSync(path.join(m.appRoot, 'versions')), false);
});

test('upgrade keeps your config and state and leaves older versions for rollback; install twice is safe', { skip }, () => {
    const m = machine();
    assert.equal(m.run('install.sh').status, 0);
    const configFile = path.join(m.appRoot, 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.controllerPort = 7999;
    fs.writeFileSync(configFile, JSON.stringify(config));
    fs.mkdirSync(path.join(m.appRoot, 'state/artifacts/keepme'), { recursive: true });
    fs.mkdirSync(path.join(m.appRoot, 'versions/0.9.0'), { recursive: true });
    const again = m.run('install.sh');
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /kept your config\.json/);
    assert.equal(JSON.parse(fs.readFileSync(configFile, 'utf8')).controllerPort, 7999);
    assert.ok(fs.existsSync(path.join(m.appRoot, 'state/artifacts/keepme')));
    assert.ok(fs.existsSync(path.join(m.appRoot, 'versions/0.9.0')), 'the older version is still there for rollback');
});

test('the PATH note is accurate in both cases, and the installer says what it did not do', { skip }, () => {
    const m = machine();
    const without = m.run('install.sh', [], { PATH: '/usr/bin:/bin:/usr/local/bin' });
    assert.equal(without.status, 0, without.stderr);
    assert.match(without.stdout, /is not on your PATH/);
    assert.match(without.stdout, /Not done by this installer: a login item/);
    const m2 = machine();
    assert.match(m2.run('install.sh').stdout, /'reddog' is on your PATH/);
});

test('uninstall removes what was installed, keeps state unless --purge, and never touches what is not ours', { skip }, () => {
    const m = machine();
    assert.equal(m.run('install.sh').status, 0);
    fs.writeFileSync(path.join(m.bin, 'other-tool'), 'x');
    const kept = m.run('uninstall.sh');
    assert.equal(kept.status, 0, kept.stderr);
    for (const gone of [path.join(m.bin, 'reddog'), path.join(m.bin, 'reddog-mcp'), m.app, path.join(m.appRoot, 'versions'), path.join(m.appRoot, 'current')]) assert.equal(fs.existsSync(gone), false, gone);
    assert.ok(fs.existsSync(path.join(m.appRoot, 'config.json')) && fs.existsSync(path.join(m.appRoot, 'state')), 'state and config kept');
    assert.ok(fs.existsSync(path.join(m.bin, 'other-tool')), 'an unrelated file is untouched');
    assert.equal(m.run('uninstall.sh', ['--purge']).status, 0);
    assert.equal(fs.existsSync(m.appRoot), false, '--purge removes everything');
});

test('the test machines never touched the real home: no reddog launcher, app or LaunchAgent appeared there', { skip }, () => {
    assert.equal(fs.existsSync(path.join(realHome, '.local/bin/reddog-mcp')) && fs.readFileSync(path.join(realHome, '.local/bin/reddog-mcp'), 'utf8').includes(os.tmpdir()), false);
    assert.equal(fs.existsSync(path.join(realHome, 'Library/LaunchAgents/com.reddog.toolkit.plist')), false);
});
