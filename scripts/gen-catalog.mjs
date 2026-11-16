// Builds docs/testing/test-catalog.{csv,json} from the test tables of the plan (section 12). Every case starts NOT_RUN.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planPath = path.resolve(root, 'docs/testing/cases.md');
const outDir = path.join(root, 'docs/testing');
const plan = fs.readFileSync(planPath, 'utf8');
const section = plan;

const resultsPath = path.join(outDir, 'results.json');
const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
const cases = [];
let phase = '';
for (const line of section.split('\n')) {
    const h = line.match(/^### (Phase \d)/);
    if (h) { phase = h[1]; continue; }
    const m = line.match(/^\| (P\d-[TK]\d+(?:\.\.[TK]?\d+)?) \[([^\]]+)\] \| (.+?) \| (.+?) \|$/);
    if (!m) continue;
    const [, id, level, title, expected] = m;
    const range = id.match(/^(P\d)-([TK])(\d+)\.\.[TK]?(\d+)$/);
    const ids = range
        ? Array.from({ length: Number(range[4]) - Number(range[3]) + 1 }, (_, i) => `${range[1]}-${range[2]}${String(Number(range[3]) + i).padStart(2, '0')}`)
        : [id];
    for (const caseId of ids) cases.push({
        id: caseId, phase, kind: caseId.includes('-K') ? 'token' : 'function', level,
        title: range ? `${title} (${caseId})` : title, expected, status: results[caseId]?.status ?? 'NOT_RUN', evidence: results[caseId]?.evidence ?? null,
    });
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'test-catalog.json'), JSON.stringify({ source: 'docs/testing/cases.md', total: cases.length, cases }, null, 2));
const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(outDir, 'test-catalog.csv'),
    ['id,phase,kind,level,status,title,expected,evidence', ...cases.map(c => [c.id, c.phase, c.kind, esc(c.level), c.status, esc(c.title), esc(c.expected), esc(c.evidence)].join(','))].join('\n') + '\n');
console.log(`catalog: ${cases.length} cases, ${cases.filter(c => c.status !== 'NOT_RUN').length} with a recorded result`);
