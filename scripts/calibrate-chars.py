import json, sys, statistics

path = sys.argv[1]

def text_len(content):
    n = 0
    imgs = 0
    if isinstance(content, str):
        return len(content), 0
    for p in content or []:
        if not isinstance(p, dict): continue
        t = p.get('type')
        if t == 'text': n += len(p.get('text', ''))
        elif t == 'tool_use': n += len(json.dumps(p.get('input', {}), ensure_ascii=False)) + len(p.get('name', ''))
        elif t == 'tool_result':
            c, i = text_len(p.get('content'))
            n += c; imgs += i
        elif t == 'image': imgs += 1
        elif t == 'thinking': n += len(p.get('thinking', ''))
    return n, imgs

prev_ctx = None
chars = 0
imgs = 0
samples = []        # (chars_added, ctx_delta)
cur_id = None
last_usage = {}
order = []
events = []         # ('a', id, usage) | ('c', chars, imgs)

with open(path) as f:
    for line in f:
        try: r = json.loads(line)
        except Exception: continue
        t = r.get('type'); m = r.get('message') or {}
        if t == 'assistant':
            mid = m.get('id'); u = m.get('usage')
            if mid and u:
                if mid not in last_usage: order.append(mid)
                last_usage[mid] = u
                events.append(('a', mid))
            c, i = text_len(m.get('content'))
            events.append(('c', c, i, mid))
        elif t == 'user':
            c, i = text_len(m.get('content'))
            events.append(('c', c, i, None))

# walk: accumulate chars added after each assistant message until the next distinct assistant message
seen = set(); prev = None; acc_c = 0; acc_i = 0
for e in events:
    if e[0] == 'a':
        mid = e[1]
        if mid in seen: continue
        seen.add(mid)
        u = last_usage[mid]
        ctx = u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0)
        if prev is not None and acc_i == 0 and ctx > prev and (ctx - prev) < 60000:
            samples.append((acc_c, ctx - prev))
        prev = ctx; acc_c = 0; acc_i = 0
    else:
        acc_c += e[1]; acc_i += e[2]

tot_c = sum(c for c, d in samples); tot_d = sum(d for c, d in samples)
ratios = [c / d for c, d in samples if d > 200 and c > 200]
print(f"pairs={len(samples)} chars={tot_c} ctx_delta_tokens={tot_d} overall_chars_per_token={tot_c/tot_d:.2f}")
print(f"median per-pair chars/token={statistics.median(ratios):.2f}  p25={statistics.quantiles(ratios, n=4)[0]:.2f}  p75={statistics.quantiles(ratios, n=4)[2]:.2f}")
