# RedDogToolkit

A local runtime-test toolkit for Cocos Creator slot games, built for one purpose: **let an AI agent test a game without burning tokens on logs and screenshots.**

It runs as a small background service. It opens your game in a headless Chrome, records what happens (console, network, WebSocket, label text, Spine state, frames), checks the recording with assertions, and answers the agent in a few hundred tokens. Big data stays on disk; the agent reads only what it asks for.

- A per-user **service** on loopback, with a **dashboard** (plain HTML, no framework) for status, start/stop, environment checks, recent runs, token use, plans waiting for approval, and logs.
- An **MCP server** with six tools (`gameplay_describe`, `_query`, `_propose`, `_apply`, `_job`, `_artifact`) and a **CLI**.
- Evidence you can diff and page through, assertions for data and logic, per-frame capture, and a strict write guard.

Version 1.0.x is a first release. Read **Status and limits** before relying on it.

## What it can do

| Area | What you get |
|---|---|
| Environment | `doctor`: Chrome, token file, preview server, stale compile cache, stale bundle, backend reachability. One line per problem, with its fix. |
| Recording | Headless Chrome via CDP. Console, page errors, unhandled promise rejections, HTTP, WebSocket (heartbeats filtered), watched Label text and Spine `animation@timeScale` (changes only). Survives page reloads. |
| Visual | Screenshots (path and price returned, never the image), per-frame burst capture with a budget, flash detection (A→B→A within a few frames), baseline compare with ignore regions. |
| Assertions | Sequence rules (`once`, `order`, `any`, `never`, `within`, counts inside a window), repeated calls, commands that never finish, listener duplicates per emit, exact-decimal wallet check, non-negative and exclusive-mode invariants, schema errors with the failing path. |
| Evidence | Immutable per-run artifacts, paged reads with cursors, `unchanged` replies when nothing changed, run-to-run `diff` that returns only the difference. |
| Safety | Writes to a backend need a stored plan and a human approval bound to that exact plan (single use, expires). One run per user at a time. Tokens are masked everywhere. |

## Token design

Each reply has a budget per capability, checked in tests. Over-budget replies are cut and the full result is saved to disk with a reference (errors are never cut). The reply for a clean `evidence.check` is about 150 tokens; waiting for a value to appear is one call and no image. A per-call ledger is written to `<state>/ledger.jsonl` instead of being added to every reply. All token figures use a worst-case estimate of 1.5 characters per token, which is itself uncalibrated.

## Install (macOS)

Build the installer: `npm run package` → `output/RedDogToolkit-<version>-macos.zip` (pure JavaScript, one zip for Intel and Apple Silicon; needs Node 22.16+, and Chrome for browser features).

On any Mac: unzip, then in Terminal run `bash install.sh` inside the folder (`INSTALL.txt` in the zip explains each step). It never uses sudo and creates only:

- `~/Library/Application Support/RedDogToolkit/` (versions, `current`, `config.json`, `state/`)
- `~/.local/bin/reddog` and `~/.local/bin/reddog-mcp`
- `~/Applications/RedDogToolkit.app` (opens the dashboard)

It does not edit your shell profile, install a login item, or register the MCP server anywhere. If `~/.local/bin` is not on your PATH it prints the line to add. Re-running upgrades in place and keeps your config and state; `bash uninstall.sh` removes the program (`--purge` removes state too).

The installer is **not signed with an Apple Developer ID and not notarized** (that needs a paid Apple account), so Gatekeeper may ask once for a downloaded `.command` file; `bash install.sh` avoids it. It removes the quarantine flag from what it installs and ad-hoc signs the app. Choose a Node with `REDDOG_NODE=/path/to/node bash install.sh`.

## Use

```bash
reddog doctor                       # check the environment
reddog service start                # start the background service
reddog service status
reddog dashboard                    # print the dashboard URL (default http://127.0.0.1:7481)
reddog service plan                 # PRINT the login item that would start it at login; writes nothing
reddog service stop
reddog describe                     # capabilities and availability
reddog query gameplay.evidence.check --params '{"runId":"<id>"}'
```

Without a running service the CLI and the MCP server fall back to an in-process engine (`REDDOG_STANDALONE=1` forces that). To use the MCP server, point your AI client at the `reddog-mcp` command; this project does not edit any client's configuration.

### Approving a write

A write to a backend needs a plan (`reddog propose <op> --params … --mutations "a;b"`) and then a **person** approves it with `reddog approve <hash>` or the dashboard's *Duyệt* button. `approve` is not an MCP tool or a capability. Be honest about the limit: both the CLI and the dashboard can be driven by any process running as your user, so approval only means a human approved if your agent cannot run commands as you. The dashboard blocks other web pages and DNS rebinding (exact Host, per-start key, same-origin POST); it cannot block a local process.

### Configuration

`config.json` (see `reddog.config.example.json`): `stateDir`, `profilesDir`, `controllerPort`, `chromePath`, `chromeArgs`, `tokenFile`, `previewBase`, optional `cocosProject` and `stagingProbeUrl`, and `recordSameOriginGets` (default false: a dev preview server delivers thousands of asset files by `fetch`, which are not evidence). Checks that need an optional value report `skip`, never `pass`. The token is read only from `tokenFile` and is never printed. Per-game knowledge lives in a **profile** (`profiles/<id>.json`, see `profiles/example.json`): log patterns, server field names, watchlist. Anything you have not verified stays `null`, and the matching check is skipped.

## Cheat adapter (force a server state)

Slot tests often need a server-side state first (a free-game trigger, a big win). `gameplay.cheat.plan` and `gameplay.cheat` drive a team's HTTP cheat endpoint without a browser. **Every call is a write to a backend**, so it always runs as plan, human approval, apply:

1. `gameplay.cheat.plan {game, preset, environment?}` (MCP tool `gameplay_propose`): checks the preset, the allowed environment and that the token file is readable, stores a plan, returns its hash. Nothing is sent.
2. A person approves that exact hash (`reddog approve <hash>` or the dashboard's *Duyệt* button).
3. `gameplay.cheat {planHash}` (MCP tool `gameplay_apply`): performs **one** POST. No retry, no redirect following. If the outcome is unknown (timeout, reset) the reply is `indeterminate` and it must not be replayed blindly.

Clear Session (`action: "clear-session"`) is a separate plan, because it destroys an open Free/Bonus session. The test user id is read from the token file by the toolkit process; it is never an argument, never in a plan or a reply, and is masked everywhere. Where to call and the preset data come from a `cheat` block in the game's profile (`baseUrl` with `{env}`, `serviceId`, `sendPath`, `presets`); keep real values in a **private** profile, not in this repository. Tested only against a fake cheat server on loopback; see `docs/testing/results.json`.

## Skill for AI agents

`skills/reddog-runtime-test/SKILL.md` tells an agent when to use the toolkit, in what order, how to run a resume/reload test, and what it cannot do yet. Install it for Claude Code with `mkdir -p ~/.claude/skills && cp -R skills/reddog-runtime-test ~/.claude/skills/`. The installer does not do this for you.

## Develop

```bash
npm install
npm run check        # typecheck + build + tests
npm run catalog      # regenerate docs/testing/test-catalog.{csv,json}
npm run package      # build the installer zip
```

Layout: `src/contracts` (envelope, error codes, capability registry, six-tool facade), `src/modules/*` (one responsibility each), `src/service` (daemon, controller, dashboard, service control), `src/adapters` (`cli`, `mcp`), `profiles`, `installer`, `scripts`, `test`, `docs`. The contracts mirror those of Black Dolphin Forge, a separate toolkit by the same author, so this can be registered as a domain there later. See `docs/DESIGN.md`.

## Status and limits

- 112 tests pass. They run on a **fake game page**, on synthetic evidence, and on a real Chrome. One real game has been opened once, **without a login**, so no gameplay or wallet data exists yet: see `docs/spikes/S1-first-real-game-run.md` for what that run proved and what it did not.
- Not implemented: the staging scenarios (`run`, `runall`) and the `tokens` capability; they report `unavailable`. The cheat adapter exists but has only been exercised against a fake server.
- Most test results are recorded as `PASS_SCOPED` with the scope written next to them (`docs/testing/results.json`). Token figures use an uncalibrated estimator.
- The MCP tool list itself costs roughly 1400 tokens (worst-case estimate) in every agent turn; reducing it is open work.
- Installer: tested in throwaway home folders from the real zip. Not tested: another physical Mac, Intel hardware, Gatekeeper's real prompt.
- macOS only; there is no Windows service plan.
