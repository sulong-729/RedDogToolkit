# Design

## Goal

Make an AI agent's runtime testing of a Cocos slot game cheap in tokens and safe to run. The expensive parts of manual agent testing are not the tool results; they are **the number of turns** (each turn re-reads the whole context) and **unfiltered logs and screenshots**. So the design minimises calls per conclusion, keeps bulk data on disk, and prices every reply.

## Shape

```
agent ── MCP (6 tools, thin) ──┐
person ─ CLI ──────────────────┼──► daemon (127.0.0.1, bearer token in <state>/endpoint.json, mode 0600)
dashboard (separate process) ──┘        ├─ engine + capability registry
                                        ├─ one headless Chrome session at a time, one run per user
                                        └─ evidence store, token ledger, plans and approvals (all under <state>)
```

- The **daemon** hosts the engine. The CLI and MCP adapter are clients; they fall back to an in-process engine when no daemon runs.
- The **dashboard** is a separate process so it stays reachable when the daemon is stopped. It reads the state directory and never holds the daemon's token.
- **Contracts** (request envelope, error codes, capability descriptor, six-tool facade) follow Black Dolphin Forge's, with additive extensions: a `runner` process kind, a per-capability reply budget and verification reference, extra error codes, and an optional `cost` field used only when a reply exceeds its budget.

## Capabilities

Query: `doctor`, `freshness`, `evidence.events|ui|server`, `evidence.listeners`, `evidence.diff`, `evidence.check`, `frames.analyze`. Job: `observe`, `screenshot`, `frames`. Reserved and `unavailable`: `run`, `runall`, `cheat`, `tokens`. Every capability declares a reply budget; a descriptor missing a required field is refused when registered.

## Evidence

Each run writes an immutable folder: `flow.log`, `events.jsonl`, `ui-frames.jsonl`, `server.jsonl`, `frames.jsonl` plus `frames/`, `screenshots/`, `result.json`. Records carry a run id, a sequence number, a shared millisecond clock and a checkpoint. They are written synchronously and redacted on the way in, so a reload or a crash loses nothing already recorded. Reads are paged with cursors tied to (run, file); `ifRevision` turns an unchanged re-read into a tiny `unchanged` reply; a missing run is `SNAPSHOT_EXPIRED`.

Recording happens outside the page (Chrome DevTools Protocol), not by hooking `console.log` in the page. UI state comes from a small in-page sampler that reads only a configured watchlist and reports only changes. Frames and UI samples correlate by time, not by a shared frame number.

## Assertions and what they need

Assertions are pure functions over records. Whatever a game must supply (log patterns, server field names, node paths) comes from its profile; a missing input produces `skip` with a reason, never `pass`. A reply that would exceed its budget must fit itself: the check shows at most two failures, says how many more there are, and saves the full list to the run.

## Write safety

1. A staging write goes through `propose`, which stores the plan and returns its hash. Nothing is written.
2. A person approves that exact hash. An approval is single use, expires after ten minutes, and is bound to the stored plan content and operation.
3. `apply` consumes it. A client-sent "approved" flag has no effect.
4. A write whose outcome is unknown is `indeterminate` and is never replayed blindly.
5. One run per user at a time; a stale lock whose process is gone is reclaimed.

The approval step is deliberately not an MCP tool. See the README for the limit of this model.

## Token accounting

Replies are measured with a worst-case estimate of 1.5 characters per token. A per-call ledger records tokens per operation. Budgets are checked in tests with a UUID request id, because the first measurements used a 2-character id and were too optimistic. The estimate is uncalibrated; every token result is `PASS_SCOPED`.

## Tests

`docs/testing/cases.md` lists the cases by phase; `docs/testing/results.json` records each result with its scope and evidence; `npm run catalog` joins them into `test-catalog.csv|json`. Statuses: `PASS`, `PASS_SCOPED` (passed within a stated scope), `NOT_RUN`.

| Phase | Scope | State |
|---|---|---|
| 0 | Feasibility spikes | partial: token baseline, Forge integration note, GPU flags |
| 1 | Config, redaction, write guard, doctor, budgets | implemented |
| 2 | Headless browser, recorder, evidence reads | implemented (fake page) |
| 3 | Screenshots, frames, sampler, flash detection | implemented (fake page, synthetic images) |
| 4 | Assertions, listeners, diff, base suite | implemented (synthetic evidence) |
| 5 | Staging scenarios, cheat adapter | not implemented |
| 6 | Many games from profiles | not implemented |
| 7 | Stabilisation | not implemented |
| 8 | Service and dashboard | implemented |

## Open work

Run it against a real game. Calibrate the token estimator against a real tokenizer. Shrink the MCP tool list. Build the staging scenarios. Sign and notarize the installer. Add a Windows service plan.
