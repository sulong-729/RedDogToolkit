# S1 (partial): first run against a real Cocos slot game

Date: 2026-11-16. One real game served by the Cocos Creator 3.7.3 editor preview on loopback, opened by the toolkit's headless Chrome through the debug service. **No login token was supplied**, so the game stopped at its start screen and no gameplay, wallet or spin data was produced. Nothing was written to any backend.

## What worked on the real engine

| Check | Result |
|---|---|
| Scene detection | `cc.director.getScene()` answered; `scene-ready` fired. |
| Rendering | The start screen rendered in headless Chrome at 60 FPS (the engine's own debug bar). |
| Node access | The in-page sampler walked 1040 nodes and found 12 active `Label` nodes with real paths (wallet, win amount, total bet, collect counters, a multiplier). They were empty because no one was logged in. |
| Sampler | With a 5-label watchlist it recorded one record (the initial values) and then nothing while they stayed unchanged. |
| Console / logic | The default `Trigger <event> → <context>` pattern matched all 27 event-manager log lines of the load. Per-emit counting reported a listener context appearing twice in a single emit, the same kind of duplicate a static review had found earlier. |
| Screenshot | 720x1280 PNG, priced at 1229 image tokens by the width x height / 750 formula. |

## What it taught us (bugs found and fixed)

1. **Same-origin noise.** 1997 of 1998 recorded `http` records were the editor's preview server delivering assets and configuration by `fetch` (1.5 MB, 15 s). They are not evidence. The filter only dropped images and media by file extension. Default now: do not record GETs to the page's own origin (`recordSameOriginGets`, default false). Result: 1 record instead of 1998 for the same run. A cross-origin call is still recorded; a test pins both.
2. **Frame burst size.** Real frames are about 1 MB each as PNG. The default 50 MB budget stopped a 3-second burst at 51 frames and reported `capped`, as designed. A real game needs a smaller default budget or lossy frames for long bursts.

## Not answered

Gameplay, wallet and spin data (needs a login token and the staging scenarios); Spine nodes (none were active at the start screen); one-frame flashes on real effects; behaviour of a long session; any game other than this one.
