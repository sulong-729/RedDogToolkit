// Node, label and Spine state per frame: CDP sampler (P3-T02/T03). Forge's observer is a
// checkpoint snapshot, not a stream, so per-frame state needs this recorder (S8 note).
//
// Injected before any page script. It does two things:
//   1. emits one `scene-ready` when the engine reports a scene (Phase 2);
//   2. emits `rejection` for every unhandled promise rejection (a swallowed error otherwise leaves no trace);
//   3. if a watchlist is configured, every N frames reads the watched Label strings and Spine `animation@timeScale`
//      and emits ONLY what changed. Reading is by name substring; nothing outside the watchlist is read.
// Verified against a fixture that mimics the cc API; the real engine is a later spike (S1).

export interface WatchConfig {
    /** Node-path substrings to watch. Empty = sampler off. */
    watch: string[];
    /** Sample every N frames. */
    every: number;
}

export const RECORDER_SCRIPT = `(() => {
  if (window.__reddog) return; window.__reddog = true;
  const cfg = window.__reddog_cfg || { watch: [], every: 6 };
  const watching = cfg.watch.length > 0;
  const match = (p) => cfg.watch.some((w) => p.includes(w));
  let sceneSent = false, frame = 0, last = {};
  window.addEventListener('unhandledrejection', (e) => {
    try { window.__reddog_emit(JSON.stringify({ type: 'rejection', text: String(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 1000) })); } catch (x) {}
  });
  function walk(node, path, out, depth) {
    if (!node || depth > 24 || node.activeInHierarchy === false) return;
    const p = path ? path + '/' + node.name : node.name;
    const cc = window.cc;
    if (match(p)) {
      const label = cc.Label && node.getComponent && node.getComponent(cc.Label);
      if (label) out[p] = String(label.string);
      const sk = cc.sp && cc.sp.Skeleton && node.getComponent && node.getComponent(cc.sp.Skeleton);
      if (sk) { const cur = sk.getCurrent && sk.getCurrent(0); out[p + '#spine'] = (cur && cur.animation ? cur.animation.name : '-') + '@' + sk.timeScale; }
    }
    for (const c of node.children || []) walk(c, p, out, depth + 1);
  }
  function tick() {
    frame++;
    try {
      const cc = window.cc, scene = cc && cc.director && cc.director.getScene && cc.director.getScene();
      if (scene && !sceneSent) { sceneSent = true; window.__reddog_emit(JSON.stringify({ type: 'scene-ready', name: String(scene.name) })); }
      if (scene && watching && frame % cfg.every === 0) {
        const cur = {}; walk(scene, '', cur, 0);
        const changes = {};
        for (const k of Object.keys(cur)) if (last[k] !== cur[k]) changes[k] = cur[k];
        for (const k of Object.keys(last)) if (!(k in cur)) changes[k] = null;
        last = cur;
        if (Object.keys(changes).length) window.__reddog_emit(JSON.stringify({ type: 'ui', frame, changes }));
      }
    } catch (e) {}
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();`;

/** Anthropic's published image estimate: width x height / 750 tokens. Used to price an image the agent chooses to view. */
export function imageTokens(width: number, height: number): number {
    return Math.ceil((width * height) / 750);
}
