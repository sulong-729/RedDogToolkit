// Generates the RedDog icon (SVG, PNGs, .icns). Run: node scripts/make-icon.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const out = new URL('../assets/icon/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const C = 512;
let ticks = '';
for (let i = 0; i < 120; i++) {
  const a = (i / 120) * Math.PI * 2, major = i % 10 === 0, mid = i % 5 === 0;
  const r1 = 452, r2 = major ? 412 : mid ? 424 : 436;
  const x1 = C + r1 * Math.cos(a), y1 = C + r1 * Math.sin(a), x2 = C + r2 * Math.cos(a), y2 = C + r2 * Math.sin(a);
  ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major ? '#27e0ff' : '#1b6f86'}" stroke-width="${major ? 5 : 3}"/>`;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
<defs>
  <radialGradient id="bg" cx="50%" cy="42%" r="75%"><stop offset="0" stop-color="#1a2233"/><stop offset="1" stop-color="#070a12"/></radialGradient>
  <linearGradient id="red1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4a3d"/><stop offset="1" stop-color="#b3101e"/></linearGradient>
  <linearGradient id="red2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e5283a"/><stop offset="1" stop-color="#7d0a18"/></linearGradient>
  <linearGradient id="red3" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a52"/><stop offset="1" stop-color="#c4162a"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="1024" height="1024" rx="230" fill="url(#bg)"/>
<rect x="14" y="14" width="996" height="996" rx="218" fill="none" stroke="#27e0ff" stroke-opacity=".25" stroke-width="4"/>
<!-- scientific dial -->
<circle cx="512" cy="512" r="470" fill="none" stroke="#1b6f86" stroke-width="3"/>
<circle cx="512" cy="512" r="400" fill="none" stroke="#27e0ff" stroke-opacity=".35" stroke-width="2" stroke-dasharray="3 14"/>
${ticks}
<path d="M512 62 L498 92 L526 92Z" fill="#27e0ff"/>
<!-- circuit traces -->
<g fill="none" stroke="#27e0ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".9">
  <path d="M262 520 H150 L110 560 V640"/><path d="M290 600 H190 L160 630"/><path d="M330 690 H250 L215 725 V780"/>
  <path d="M762 520 H874 L914 560 V640"/><path d="M734 600 H834 L864 630"/><path d="M694 690 H774 L809 725 V780"/>
  <path d="M512 840 V930"/>
</g>
<g fill="#070a12" stroke="#27e0ff" stroke-width="5">
  <circle cx="110" cy="650" r="11"/><circle cx="160" cy="636" r="9"/><circle cx="215" cy="790" r="11"/>
  <circle cx="914" cy="650" r="11"/><circle cx="864" cy="636" r="9"/><circle cx="809" cy="790" r="11"/><circle cx="512" cy="940" r="11"/>
</g>
<!-- low-poly dog head -->
<g stroke="#070a12" stroke-width="5" stroke-linejoin="round">
  <polygon points="290,205 436,330 330,470 252,470" fill="url(#red2)"/>
  <polygon points="734,205 588,330 694,470 772,470" fill="url(#red2)"/>
  <polygon points="290,205 330,470 252,470 262,420" fill="#8e0f1f"/>
  <polygon points="734,205 694,470 772,470 762,420" fill="#8e0f1f"/>
  <polygon points="436,330 588,330 694,470 512,520 330,470" fill="url(#red1)"/>
  <polygon points="252,470 330,470 512,520 400,690 324,640" fill="url(#red3)"/>
  <polygon points="772,470 694,470 512,520 624,690 700,640" fill="url(#red3)"/>
  <polygon points="400,690 512,520 624,690 512,810" fill="url(#red2)"/>
  <polygon points="400,690 424,722 512,810" fill="#a30f20"/>
  <polygon points="624,690 600,722 512,810" fill="#a30f20"/>
  <polygon points="450,676 574,676 512,744" fill="#0a0d16"/>
</g>
<!-- sensor eyes -->
<g filter="url(#glow)">
  <polygon points="346,452 462,440 440,486 360,490" fill="#27e0ff"/>
  <polygon points="678,452 562,440 584,486 664,490" fill="#27e0ff"/>
  <circle cx="512" cy="700" r="9" fill="#27e0ff"/>
</g>
<g stroke="#070a12" stroke-width="5"><line x1="404" y1="446" x2="404" y2="488"/><line x1="620" y1="446" x2="620" y2="488"/></g>
<!-- scan reticle -->
<g fill="none" stroke="#27e0ff" stroke-width="5" opacity=".85" stroke-linecap="round">
  <path d="M236 330 V290 H276"/><path d="M788 330 V290 H748"/>
  <path d="M236 740 V780 H276"/><path d="M788 740 V780 H748"/>
</g>
</svg>`;
writeFileSync(out + 'reddog.svg', svg);

const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const b = await puppeteer.launch({ executablePath: chrome, headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1024, height: 1024 });
await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
await p.screenshot({ path: out + 'reddog-1024.png', omitBackground: true });
await b.close();

const set = out + 'reddog.iconset';
rmSync(set, { recursive: true, force: true }); mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  execFileSync('sips', ['-z', s, s, out + 'reddog-1024.png', '--out', `${set}/icon_${s}x${s}.png`], { stdio: 'ignore' });
  execFileSync('sips', ['-z', s * 2, s * 2, out + 'reddog-1024.png', '--out', `${set}/icon_${s}x${s}@2x.png`], { stdio: 'ignore' });
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', out + 'reddog.icns']);
rmSync(set, { recursive: true });
console.log('ok');
