import json, sys, collections, re

path = sys.argv[1]
CPT = 3.5            # chars per token, uncalibrated estimate
IMG_TOK = 1500       # rough per-screenshot token cost until calibrated (width*height/750 for ~1100x700)

def category(name, inp):
    if name.startswith('mcp__Claude_Browser__') or name.startswith('mcp__claude-in-chrome__'):
        return 'browser'
    if name.startswith('mcp__computer-use__'):
        return 'computer-use'
    if name.startswith('mcp__ccd_'):
        return 'app-meta'
    if name == 'Bash':
        c = (inp or {}).get('command', '')
        if 'mimi' in c or 'http.server' in c: return 'bash:build/serve'
        if re.search(r'curl|lsof|pgrep|ps aux|osascript|open -', c): return 'bash:env'
        if 'git ' in c: return 'bash:git'
        return 'bash:other'
    if name in ('Read', 'Edit', 'Write'): return 'file:' + name.lower()
    return 'other:' + name

calls = {}                # tool_use id -> (name, category)
cat = collections.defaultdict(lambda: dict(calls=0, result_chars=0, images=0, image_bytes=0))
assist = dict(turns=0, input=0, output=0, cache_read=0, cache_create=0)
seen_msg = set()
last_usage = {}
toolcount = collections.Counter()

def result_size(content):
    chars = imgs = img_b = 0
    if isinstance(content, str):
        return len(content), 0, 0
    for part in content or []:
        if part.get('type') == 'text':
            chars += len(part.get('text', ''))
        elif part.get('type') == 'image':
            imgs += 1
            img_b += len(part.get('source', {}).get('data', ''))
    return chars, imgs, img_b

with open(path) as f:
    for line in f:
        try: rec = json.loads(line)
        except Exception: continue
        t = rec.get('type')
        msg = rec.get('message') or {}
        if t == 'assistant':
            mid = msg.get('id')
            u = msg.get('usage') or {}
            if mid and u:
                last_usage[mid] = u
            for part in msg.get('content') or []:
                if isinstance(part, dict) and part.get('type') == 'tool_use':
                    c = category(part.get('name', ''), part.get('input'))
                    calls[part['id']] = (part.get('name'), c)
                    toolcount[part.get('name')] += 1
                    cat[c]['calls'] += 1
        elif t == 'user':
            content = msg.get('content')
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get('type') == 'tool_result':
                        name_cat = calls.get(part.get('tool_use_id'))
                        if not name_cat: continue
                        ch, im, ib = result_size(part.get('content'))
                        c = name_cat[1]
                        cat[c]['result_chars'] += ch
                        cat[c]['images'] += im
                        cat[c]['image_bytes'] += ib

for u in last_usage.values():
    assist['turns'] += 1
    assist['input'] += u.get('input_tokens', 0)
    assist['output'] += u.get('output_tokens', 0)
    assist['cache_read'] += u.get('cache_read_input_tokens', 0)
    assist['cache_create'] += u.get('cache_creation_input_tokens', 0)
rows = []
for c, d in cat.items():
    tok = d['result_chars'] / CPT + d['images'] * IMG_TOK
    rows.append((c, d['calls'], d['result_chars'], d['images'], int(tok)))
rows.sort(key=lambda r: -r[4])
total_calls = sum(r[1] for r in rows)
total_tok = sum(r[4] for r in rows)
print(json.dumps(dict(assistantTurns=assist, totalToolCalls=total_calls, estResultTokens=total_tok), indent=1))
print(f"{'category':22} {'calls':>6} {'chars':>10} {'imgs':>5} {'est_tok':>9} {'share':>6}")
for c, n, ch, im, tok in rows:
    print(f"{c:22} {n:6d} {ch:10d} {im:5d} {tok:9d} {100*tok/max(total_tok,1):5.1f}%")

print('top tools:', toolcount.most_common(12))
