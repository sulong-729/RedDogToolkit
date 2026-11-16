# S8: can the gameplay domain become part of Black Dolphin Forge?

Status: **PASS_SCOPED** (P0-T08). Method: read Forge source (`~/cocos-ai-toolkit`, commit `6998b99`, version 0.10.0). **Nothing was executed**: no daemon started, no bridge attached, no game loaded. Every statement is from reading code.

Files read: `src/daemon/{dispatcher,server,client}.ts`, `src/mcp/server.ts`, `src/contracts/*`, `src/runtime/{service,client,transport}.ts`, `runtime/bridge.ts`, `runtime/domains/{ui,animation}.ts`, `src/domains/ui.ts`, `src/platform/paths.ts`, `src/build/profiles.ts` (head). Not read: graph, editor, mutation, source navigator, jobs internals, `build/service.ts` body.

## Answers to the four conditions in plan section 3

**(a) Does the runtime bridge attach to a real Cocos game preview?** Plausible, unverified.
- The bridge is page-side code. It must be attached from a developer bootstrap using `System.import('cc')` and `System.import('cc/env')`, then `attachPreview({cc, url, token, preview, build})`. It refuses unless preview is true, build is false, the daemon URL is `http://127.0.0.1:<port>`, the token is 64 hex characters and the engine is one of 3.7.3, 3.6.3, 2.1.3, 2.4.15.
- Our runner controls its own Chrome, so it can inject that bootstrap (for example with `evaluateOnNewDocument`) without touching game assets, which is what Forge's rules ask for.
- The preview origin must be exact `http://localhost:<port>` or `http://127.0.0.1:<port>` with an explicit port; `http://localhost:7456` qualifies. A permit (`runtime.preview.permit`) lasts 10 minutes, max 16 at a time.
- Unknown: whether `System.import('cc')` resolves inside a real Cocos game preview before login, and whether capture works on a game with thousands of nodes. Only S1 can answer.

**(b) Can a new domain be added without editing Forge core?** No, small but real edits are needed.
- `Registry.register` itself is open to any capability.
- But `createDispatcher` (`src/daemon/dispatcher.ts`) hard-wires each domain with its own `registerX(...)` call, so a new domain needs an import and a call there.
- The authorization predicate passed to `new Registry(...)` is a name allowlist (`project.register`, `bridgeControls`, `mutationControls`, `runtimeControls`, `jobControls`); a non-read-only gameplay capability would have to be added.
- The `facade()` function hard-codes which operations each tool accepts: `cocos_propose` only four operations, `cocos_apply` only `editor.apply`/`editor.document.apply`, `cocos_job` only `job.start/status/cancel`, `cocos_artifact` only `artifact.read`/`job.artifact.read`; `cocos_query` rejects anything not read-only. Exposing `gameplay.*` through the six tools means editing those lists.
- Tool names are `cocos_*`, not `gameplay_*`; our `OwnerProcess = 'runner'` and the extra `Capability` fields are not in Forge's types (at run time `process: 'runner'` would map to source `disk`, so it would work, but the types would not compile).

**(c) Ownership.** `package.json` has `"private": true`, no LICENSE file; the repository sits in the user's home directory. The working tree there has uncommitted changes under `extensions/cocos-ai-bridge/` that this project did not make. Whether we may edit Forge remains the user's decision.

**(d) Daemon lifecycle.** No conflict if isolated. The daemon is a per-user loopback HTTP server with a random bearer token written to `endpoint.json` in the state directory. `COCOS_AI_STATE_DIR` selects an isolated instance, so a test instance would not touch the user's normal one. Only the `/v1/runtime` route accepts browser origins; `/v1/rpc` rejects any request carrying an Origin header.

## What Forge's runtime observer can and cannot give us

Can (from `runtime/domains/ui.ts`): node active state, UITransform geometry and screen corners, Widget, Layout configuration, ScrollView, Mask, **`Label.string` (truncated at 2000 characters)**, Label font, Sprite frame identity, and `ui.diagnose` findings (inactive ancestry, zero size, unresolved Widget target, viewport overflow). Read-only by design.

Cannot:
- **Not a per-frame stream.** It is an on-demand snapshot: a client asks, the page polls the daemon about every 400 ms, then captures after the next draw. Up to 5000 nodes per capture, 8 queued reads. Sampling every frame, or catching a one-frame flash, is not what it does.
- **No Spine telemetry.** The animation reader covers `cc.Animation` component states only and reports Spine tracks as unavailable (the source says so in `stateScope`). Our `animation@timeScale` need is not met.
- **No input, no game flow, no network, no wallet.** Runtime actions (`input.simulate`, `animation.play`, ...) are registered as unavailable on purpose.

So it fits **state snapshots at named checkpoints** (read a label, check a widget). It does not replace our own in-page, per-frame recorder.

## Build

`src/build/profiles.ts` shows a build profile needs one scene UUID, a Python path, an engine root, target `web-mobile`. It was qualified on a synthetic project. Whether it can build a real, multi-scene Cocos project (many scenes, a start scene, submodule assets) is unknown and belongs to spike S6. Our earlier Dev18 build needed `startScene`, `name` and a `scenes` list.

## Decision (recommended, for the user to confirm)

**Integrate by composition, not by merging into the Forge process.**

1. Keep the gameplay domain as its own package (the scaffold), with its own registry and contracts that mirror Forge's. No Forge edits, no dependency on Forge's release cycle.
2. Where Forge is genuinely better, call its daemon as a **client** over its authenticated RPC (`endpoint.json` + `POST /v1/rpc`): `runtime.capture` / `runtime.query` / `ui.diagnose` for checkpoint snapshots, and `build.*` if S6 passes. Run a separate Forge instance with `COCOS_AI_STATE_DIR` if isolation is wanted.
3. Keep our own per-frame recorder, Spine reader, network capture, click control and cheat adapter.
4. Expose only the six `gameplay_*` tools to the agent. The agent should not also load Forge's six tools for this work; every tool schema sits in the context of every turn, and the P0-K01 baseline showed turns are the cost driver.

Revisit a true merge only if the user wants to edit Forge: it would need the dispatcher, authorization and facade allowlist changes listed in (b).

## Still open (not settled by reading)

- Whether `attachPreview` works on a real Cocos game preview (S1).
- Whether Forge's build can handle a real Cocos project (S6).
- Whether the user wants any edit to `~/cocos-ai-toolkit`.
