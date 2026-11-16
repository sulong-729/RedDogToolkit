---
name: reddog-runtime-test
description: Use when testing a Cocos slot game's runtime (data, UI, logic, resume) with RedDogToolkit instead of hand-reading logs or screenshots.
---

# RedDogToolkit runtime test

Use the toolkit when a question needs the **running game**: what it sent, what it showed, which events fired. Read source or docs directly when the answer is in the code. Tokens are the point: every call re-reads the whole conversation, so aim for few calls and small replies.

## Before you start

1. Is it up? `reddog service status`. If not, `reddog service start` (it also works without the service, in-process, just slower per call).
2. `reddog doctor` once. One line per problem. Stop and tell the user if something fails; do not work around it.
3. A game that needs a login needs a token file (`~/.reddog/token.txt`). **The user creates it. Never write, print or paste a token.**
4. Keep the run's data where the user's config points. It may be a private game: never copy evidence into a public repo.

## Pick the capability by the question

| Question | Call (in this order, stop when answered) |
|---|---|
| Does the game load, what did it do for N seconds? | `gameplay.observe` (add `withToken`, `watch`, `seconds`) |
| Wait for a value instead of guessing a delay | `observe` with `until: {path, equals}`: one call, no screenshots |
| Logic problems: repeated calls, rejections, duplicate listeners | `gameplay.evidence.check {runId, game?}` |
| How many times did event X fire, and how many listeners | `gameplay.evidence.listeners {runId}` |
| What changed on screen (labels, Spine state) | `observe` with `watch`, then `gameplay.evidence.ui {runId, limit}` |
| What does it look like | `gameplay.screenshot` (use `scale` 0.25 or `clip`; one full image is about 1200 tokens) |
| Did something flash for a frame | `gameplay.frames` then `gameplay.frames.analyze` |
| What differs between two runs | `gameplay.evidence.diff {a, b}` |

Rules that save tokens: read replies, not files; page evidence with `limit`; re-read with `ifRevision`; ask for an image only when the question is visual; never poll with screenshots.

## Resume / reload flow

A resume test needs a server session already open (for example mid-Free). **The toolkit cannot create that state yet** (no cheat adapter, no staging scenarios, and it never writes to a backend without an approved plan). Ask the user to set it up, then:

1. `observe` with `withToken`, `watch` set to the labels that matter (balance, win, spins left, multiplier), `reloadAfterSeconds` after the game has loaded into that state, and `seconds` long enough to finish resuming. The recorder keeps one continuous record across the reload.
2. `evidence.listeners {runId}`: each resume event should appear once per reload (`emits=1`). Event names come from the game or its profile; do not guess them.
3. `evidence.check {runId, game}`: repeated requests, unhandled rejections, duplicate listeners.
4. `evidence.ui {runId}`: compare watched values before and after the reload. Values restored after a resume are recorded as changes.
5. Report the run id and the seq of each finding.

What this cannot do today, and what to say instead of pretending: assert an exact order of two events (only counts via `listeners`), take a screenshot inside the same reloaded session (each capability opens its own browser), start a Free/Bonus session.

## Reading results honestly

- `skip` means a check had no input (no profile, no log pattern). It is **not** a pass. Say so.
- `capped` or `truncated` means data was cut; the reply names where the full data is.
- Token figures are a worst-case estimate (1.5 chars/token), not a measurement.
- A capability reported `unavailable` is not implemented. Say that; do not substitute a guess.

## Never

- Run `reddog approve` or press the dashboard's approve button. That is the human's decision.
- Send anything to a backend the user did not ask for. This toolkit's writes need a stored plan and a human approval.
- Edit `~/.zshrc`, a login item or a client's MCP config for the user; print the line instead.
