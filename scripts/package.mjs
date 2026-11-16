// Builds the installer bundle: output/RedDogToolkit-<version>/ and output/RedDogToolkit-<version>-macos.zip.
// The bundle holds the compiled program and its production dependencies only. It must never contain state, tests,
// the prototype, a local config or a token; the checks at the end refuse to produce a zip if it does.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const name = `RedDogToolkit-${version}`;
const out = path.join(root, 'output');
const bundle = path.join(out, name);
const app = path.join(bundle, 'app');

if (!fs.existsSync(path.join(root, 'dist/adapters/cli.js'))) throw new Error('dist/ is missing: run `npm run build` first');
fs.rmSync(bundle, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });

const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(app, to), { recursive: true, filter: (src) => !/\.local\.json$|\.token$|\.DS_Store$/.test(src) });
copy('dist');
copy('profiles');
copy('docs/DESIGN.md'); copy('docs/spikes'); copy('docs/testing'); copy('docs/evidence');
for (const f of ['package.json', 'package-lock.json', 'README.md', 'reddog.config.example.json']) copy(f);

console.log('installing production dependencies (npm ci --omit=dev)…');
execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: app, stdio: 'inherit' });

fs.writeFileSync(path.join(bundle, 'VERSION'), version + '\n');
for (const f of ['install.sh', 'uninstall.sh', 'Install RedDogToolkit.command', 'INSTALL.txt']) {
    fs.copyFileSync(path.join(root, 'installer', f), path.join(bundle, f));
    fs.chmodSync(path.join(bundle, f), f.endsWith('.txt') ? 0o644 : 0o755);
}
fs.copyFileSync(path.join(root, 'README.md'), path.join(bundle, 'README.md'));

// ---- refuse to ship anything that should not be there
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(bundle);
const rel = files.map(f => path.relative(bundle, f));
// Our own folders may not ship (dependencies legitimately have their own src/ and test/, so they are exempt here).
const ours = rel.filter(f => !f.startsWith('app/node_modules/'));
const forbidden = [
    ...ours.filter(f => /(^|\/)(state|prototype|test|artifacts|src)\//.test(f)),
    // Secrets and run data are refused everywhere, dependencies included.
    ...rel.filter(f => /\.local\.json$|\.token$|(^|\/)ledger\.jsonl$|(^|\/)endpoint\.json$/.test(f)),
];
if (forbidden.length) throw new Error('bundle contains forbidden files: ' + forbidden.slice(0, 5).join(', '));
// The bundle must stay pure JavaScript so one zip runs on Intel and Apple Silicon. A native binary would break that.
const native = rel.filter(f => /\.(node|dylib|so)$/.test(f));
if (native.length) throw new Error('bundle contains native binaries (not portable across chips): ' + native.slice(0, 3).join(', '));
const must = ['INSTALL.txt', 'app/dist/adapters/cli.js', 'app/dist/adapters/mcp.js', 'app/dist/service/daemon-main.js', 'app/dist/service/controller-main.js', 'app/profiles/example.json', 'install.sh', 'VERSION'];
for (const m of must) if (!rel.includes(m)) throw new Error('bundle is missing ' + m);

fs.mkdirSync(out, { recursive: true });
const zip = path.join(out, `${name}-macos.zip`);
fs.rmSync(zip, { force: true });
// No extended attributes, resource forks or quarantine flags in the archive (they show up as ._* clutter on other machines).
try { execFileSync('xattr', ['-cr', bundle]); } catch { /* nothing to clear */ }
execFileSync('ditto', ['-c', '-k', '--keepParent', '--norsrc', '--noextattr', '--noqtn', bundle, zip]);
const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
fs.writeFileSync(zip + '.sha256', `${sha}  ${path.basename(zip)}\n`);
console.log(`bundle : ${bundle}  (${rel.length} files)`);
console.log(`zip    : ${zip}  (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
console.log(`sha256 : ${sha}`);
