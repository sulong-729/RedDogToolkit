// A local stand-in for the game page: console output, an uncaught error, fetch (ok + failing), static assets,
// a websocket with heartbeat frames, and a scene that appears after a short delay. NOT the real game.
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const page = (noise) => `<!doctype html><title>fixture</title><script>
console.log('hello fixture'); console.warn('warn line');
for (let i = 0; i < ${noise}; i++) console.log('noise ' + i);
setTimeout(() => { throw new Error('boom from fixture'); }, 50);
fetch('/api/x?token=SECRETTOKEN_ABC').then(r => r.text()).then(t => console.log('api ' + t));
fetch('http://127.0.0.1:1/unreachable').catch(() => {});
new Image().src = '/pixel.png?x=1';
const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/style.css'; document.head.appendChild(l);
const ws = new WebSocket('ws://' + location.host + '/socket?token=SECRETTOKEN_ABC');
ws.onopen = () => { ws.send('2'); ws.send(JSON.stringify({ hello: 'server' })); };
setTimeout(() => { window.cc = { director: { getScene: () => ({ name: 'fixture' }) } }; }, 300);
</script>`;

/**
 * A fake Cocos-like game: a node tree with Label and Spine components (cc.Label / cc.sp.Skeleton), a coloured box that
 * flashes red for ~120ms exactly once, and optional endless animation (?anim=1). NOT the real engine.
 */
const gamePage = (anim) => `<!doctype html><title>game</title>
<style>body{margin:0;background:#fff} #box{position:absolute;left:100px;top:200px;width:300px;height:300px;background:#2255cc}</style>
<div id="box"></div><script>
class Label { constructor(s) { this.string = s; } }
class Skeleton { constructor() { this.timeScale = 1; this.anim = 'idle'; } getCurrent() { return { animation: { name: this.anim } }; } }
const mk = (name, comp, kids = [], active = true) => ({ name, activeInHierarchy: active, children: kids, comps: comp ? [comp] : [], getComponent(c) { return this.comps.find(x => x instanceof c) || null; } });
const wallet = new Label('100.00'), tooltip = new Label(''), secret = new Label('hidden'), boss = new Skeleton();
const scene = mk('demoScene', null, [mk('Canvas', null, [mk('Hud', null, [mk('wallet', wallet), mk('tooltip', tooltip), mk('secret', secret), mk('ghost', new Label('inactive'), [], false)]), mk('boss', boss)])]);
window.__frames = 0; (function f() { window.__frames++; requestAnimationFrame(f); })();
setTimeout(() => { window.cc = { Label, sp: { Skeleton }, director: { getScene: () => scene } }; }, 100);
setTimeout(() => { wallet.string = '105.50'; }, 400);
setTimeout(() => { tooltip.string = 'WIN 5.50'; }, 500);
setTimeout(() => { boss.anim = 'hit'; boss.timeScale = 0; }, 600);
setTimeout(() => { document.getElementById('box').style.background = '#cc2222'; }, 900);
setTimeout(() => { document.getElementById('box').style.background = '#2255cc'; }, 1020);
if (${anim}) { let on = false; (function g() { on = !on; document.getElementById('box').style.background = on ? '#2255cc' : '#22cc55'; requestAnimationFrame(g); })(); }
</script>`;

export function startFixture() {
    const hits = { page: 0 };
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/x') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }
        else if (url.pathname === '/pixel.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG); }
        else if (url.pathname === '/game') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(gamePage(url.searchParams.get('anim') === '1' ? 'true' : 'false')); }
        else if (url.pathname === '/reject') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>reject</title><script>setTimeout(() => { Promise.reject(new Error("rej boom")); }, 100); setTimeout(() => { window.cc = { director: { getScene: () => ({ name: "s" }) } }; }, 150);</script>'); }
        else if (url.pathname === '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('body{}'); }
        else { hits.page++; res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page(Number(url.searchParams.get('noise') ?? 0))); }
    });
    const wss = new WebSocketServer({ server, path: '/socket' });
    wss.on('connection', (ws) => ws.on('message', (m) => { const s = String(m); ws.send(s === '2' ? '3' : JSON.stringify({ echo: s })); }));
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
        url: `http://127.0.0.1:${server.address().port}/`, hits,
        close: () => { wss.close(); server.close(); },
    })));
}

export const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const hasChrome = fs.existsSync(chromePath);
