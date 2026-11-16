# P0-K01 / P0-K02: token baseline from a manual runtime-test session

Status: **PASS_SCOPED** for P0-K01 (a baseline exists, with the scope limits below); **NOT_RUN** for P0-K02 (calibration attempted, inconclusive). Date of analysis: 2026-11-16.

Source: the agent transcript (.jsonl) of one manual runtime-test session. Scripts: `scripts/analyze-transcript.py` and `scripts/calibrate-chars.py` take any transcript path.

## Scope limits (read first)

- The session mixes **code review, manual runtime testing, tooling work and planning/writing**. The numbers below are for the whole session. The manual-test share is estimated by tool category, not by a verified segmentation.
- Tool-result tokens are **estimates** (chars / 3.5, 1500 tokens per screenshot). Neither factor is calibrated (see P0-K02), so treat result-token figures as order of magnitude.
- Token counts are not cost: cache reads are billed far below fresh input. This note counts tokens, not money.

## Measured usage (from the transcript's own `usage` fields)

| Item | Value |
|---|---|
| Assistant messages | 461 |
| Tool calls | 642 |
| Fresh input tokens | ~1.1 thousand |
| Cache-creation input tokens | ~1.72 million |
| Cache-read input tokens | ~136.1 million |
| Output tokens | ~387 thousand |
| Average context re-read per assistant message | ~295 thousand tokens |

## Estimated tool-result volume

Total estimated result tokens: ~287 thousand (about 0.2% of cache-read volume).

| Category | Calls | Est. result tokens | Share |
|---|---|---|---|
| browser (Claude Browser / Chrome tools) | 258 | ~130k | 45% |
| bash (other: reading logs, scans, edits) | 131 | ~87k | 30% |
| file read | 31 | ~38k | 13% |
| computer-use | 22 | ~10k | 3% |
| bash git | 28 | ~8k | 3% |
| bash build/serve | 17 | ~7k | 2% |
| other (write/edit/env/meta) | rest | ~7k | ~3% |

The hand-test categories (browser, computer-use, build/serve, env checks) are about **311 of 642 calls (48%)** and about **148k of 287k estimated result tokens (52%)**.

Most-called tools: Bash 191, browser `computer` 122, Write 52, browser `javascript_tool` 49, `read_console_messages` 36, Read 31.

## What this says

1. **The number of turns drives the volume.** Every assistant message re-reads the whole context (~295k tokens on average). Result tokens (~287k) are tiny next to cache reads (~136M). Removing a tool call removes one full context re-read; shrinking one result barely moves the total.
2. **So the primary metric for the system is calls (turns) per conclusion**, with response size second. Plan section 9 listed both; this baseline says to rank calls first.
3. **Browser interaction was the largest result source (45%)**, with 122 `computer` actions and 36 console reads, consistent with the root causes in `docs/local-runtime-test-system-notes.md` (polling, screenshots, unfiltered logs).
4. **Output tokens (~387k) exceed total tool-result tokens**, because the agent wrote long plans, summaries and documents. A tool cannot reduce that part; report length discipline matters too.

## P0-K02 calibration: inconclusive

Method: compare characters added between consecutive assistant messages with the growth of the reported context size (input + cache read + cache creation), over 390 message pairs with no images.

Result: about **1.5 characters per token** overall (median 1.49, quartiles 1.18–1.83), against the assumed 3.5.

Why this cannot be trusted as the tool-result ratio:
- Context growth also includes content not present in the transcript text: system reminders, attachment blocks, model thinking, tool-definition changes.
- Much of the text is Vietnamese with diacritics, which tokenizes poorly.

What can be said: **chars/3.5 probably underestimates tokens**, plausibly by up to 2x for this session, so the result-token estimates above are likely a floor. A real tokenizer on the tool results alone is still needed. `tiktoken` is not installed here (`cl100k` is only a proxy for Claude in any case).

## Decisions and follow-ups

- Plan v4 section 9: make **calls per conclusion** the headline metric; keep response tokens as the second metric. (Not yet edited into the plan.)
- Replace the chars/3.5 constant with a calibrated value before any threshold in section 9 is treated as a target.
- Segment this transcript (review vs test vs planning) to get an honest hand-test-only baseline; the 48% estimate above is by category only.
- Compare image cost against Anthropic's width x height / 750 formula once screenshot dimensions are available in the transcript.
