# S4 (partial): headless Chrome, GPU flags and frame rate

Status: partial datapoint, not the full S4. Measured 2026-11-16 on one Apple M1 Pro Mac with the fixture page (not the real game).

| Chrome flags | rAF frames per second | WebGL renderer |
|---|---|---|
| `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` | ~17 | SwiftShader (software) |
| `--enable-unsafe-swiftshader` only | ~41 | Apple M1 Pro (Metal) |
| none | 60 | Apple M1 Pro (Metal) |

Conclusion: headless Chrome here uses the real GPU by default and WebGL works. Forcing software GL (copied from the prototype) cut the frame rate to about a quarter and made a per-frame sampler miss states. Default is now no GPU flags; `chromeArgs` in the config adds them for machines without a GPU.

Not answered by this note: behaviour of the real game under headless, sound, timing differences against a headed Chrome, and a machine without a GPU. Those remain open in S4.
