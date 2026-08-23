# Plan — the rail row quotes the pane's OWN session (2026-08-22)

Fixes the bug where several agent rows in one project cluster print the identical
sentence and never stop printing it. Diagnosis and adversarial verification are in
[docs/CONTEXT.md](../CONTEXT.md#one-sentence-on-three-rows--2026-08-22) `current`.

## 1. The defect, in three links

1. **No identity anchor.** A tail request carries `(agent, cwd, lastSeenAt)` and nothing
   else ([`ResumeRequest`](../../electron/resume/resolve.ts) `current`).
   [`selectCandidate`](../../electron/resume/resolve.ts) `current` picks
   `argmin |candidate.mtimeMs - request.lastSeenAt|` and the `taken` dedup set lives for
   exactly ONE batch, so the pane→session pairing is re-guessed from scratch every 300ms
   and permutes freely.
2. **A `null` answer is sticky.** `merged` in
   [`session-tail-store.ts`](../../src/terminal/session-tail-store.ts) `current` keeps the
   previous sentence when the answer is null, so a pane never loses a sentence it was once
   handed — including one that belongs to a session it is no longer paired with.
3. **`null` is the common answer for a working pane.** The reader takes the last 64 KiB of
   the transcript only; a streaming session's last 64 KiB is dominated by
   `user:tool_result` records (measured 486 of 616 records past the window on this
   machine's corpus) and frequently holds ZERO assistant `text` part.

Composed: pane A is paired with file F and shows F's sentence; next batch A is re-paired
with an active file that answers null, so A KEEPS F's sentence while F is released to pane
B, which now shows it too. Repeat for C. Nothing ever clears it.

`lastSeenAt` is `pane.changedAt`, which
[`commit`](../../src/terminal/agent-attention.ts) `current` bumps only when a VISIBLE field
changes — a much coarser clock than a transcript's mtime, which moves on every write. The
two quantities being matched run on different beats.

## 2. What this plan does NOT do

- No birthtime anchoring for panes that started a FRESH conversation (§7).
- No change to `resume_lookup`'s answer. The restore path keeps today's ranking; only the
  tail path pins. `session-tail.ts`'s header claim that both paths "must pick the SAME
  file" is amended in the same task.
- No pane-cwd request (the request still carries the TAB's `workspacePath`). Narrowing that
  cannot disambiguate several panes in ONE cwd, which is the case in the report.

## 3. Fork check

None of the fork-listed categories is touched: no PTY ownership, no process classification,
no window coordinator, no tab materialization (`MaterializeIntent` is unchanged), no
close/quit coordination, no bundle/signing/updater input, no `docs/DESIGN-LANGUAGE.md`
rule, no sibling repo. `session_tail` is an existing Electron-only flat channel and is NOT
pinned by `scripts/electron-ipc-contract.test.ts`; its request keys stay flat (R6). The
renderer surface does not move, so the rail's DL rules are untouched.

## 4. Design

### 4.1 Pair-and-pin (the core)

A tail request gains an optional `preferredId`: the session this pane was paired with last
time. `resolveSessionTails` resolves a batch in **two passes**:

- **Pass 1 — honour the pins.** Every request naming a `preferredId` that is still a
  candidate of its agent, still matches the cwd predicate, and is not yet taken, claims that
  candidate.
- **Pass 2 — argmin the rest.** Unpinned requests (and pins that could not be honoured) run
  `selectCandidate` over what pass 1 left.

Two passes, not one, is load-bearing: with a single pass in request order, a fresh pane
sitting earlier in the batch argmin-picks F before the pane that PREFERS F is reached, the
preference fails, and the churn resumes wearing a different costume.

A pin skips the 30-day cutoff and the recency ranking on purpose. The pin is direct evidence
of which conversation a pane is running; recency is a guess about it.

### 4.2 The answer carries its id

`session_tail` answers `{ id, tail } | null` per position instead of a bare
`string | null`. The renderer learns a pane's FIRST pairing from the answer, and can tell a
kept pairing from a changed one. Merge table in the store:

| answer | pairing | tail |
| --- | --- | --- |
| `null` (no candidate, bad request, scan threw) | keep | keep — an absent scan is not evidence the pane went quiet |
| `id` equals the stored pairing, `tail` null | keep | keep — same conversation, window just held no sentence |
| `id` equals the stored pairing, `tail` set | keep | overwrite |
| `id` differs from the stored pairing | replace | overwrite, INCLUDING to empty — the old sentence belongs to a conversation this pane is no longer paired with |

The last row is what makes a fossil impossible: a sentence outlives its pairing nowhere.

### 4.3 Seed the true id from the resume paths — BUILT, THEN WITHDRAWN (2026-08-22)

`noteResumedPane` was given the resolved session id and `resumeClaims` became a FIFO queue of
ids, so a restored pane would start out pinned to the conversation it actually reopened.
**Withdrawn the same day on adversarial review.** A mark is keyed by `(workspace, agent)` and
has no causal link to a pane:

- it is claimed by the first matching pane the process poll happens to recognize, which need
  not be the pane that typed `--resume <id>` — refs `[none, B]` leave ONE mark and the pane
  that opened a fresh conversation takes it;
- it is left as soon as `materialize` resolves, while the command is only armed and its
  `writePty` can still fail, so a mark can outlive an agent that never started.

Under the old count both mistakes cost one extra question. Under an id they pin a row to a
conversation it is not in, permanently — strictly worse than the drift this plan set out to
fix, because a drift corrects itself and a pin does not. Reproduced as a failing test before
withdrawing.

Doing this correctly needs a mark bound to a pane id, which means `materialize` reporting
which pane received which command — the tab-materialization seam, and therefore a fork. Until
then a restored pane's first pairing is ranked like any other; §4.1 still makes it stable.

### 4.3b A pairing must not outlive its agent generation

A pane id outlives its occupants: `claude` → shell → `claude` reuses it. Without this the
pairing survives, the pane keeps sending it as `preferredId`, main keeps honouring it, and the
new agent's row is pinned to the previous agent's sentence for as long as the pane lives.

Two tells, both already on `PaneView` and both produced by `agent-attention.ts`'s own
generation handling: the agent label changed (covering the `null` shell step), or `hasRun`
went true → false (the gate reopening; the other direction is the same agent finally working).
`fingerprintOf` gained `hasRun` and now covers every pane, not just agent panes, so a
generation change cannot be skipped as a repeat before the forget runs.

### 4.4 Fewer nulls: grow the window

`fromTranscript` re-reads from the end at 64 KiB → 256 KiB → 1 MiB, stopping at the first
window that yields a sentence. There is deliberately no early exit on a short read: it looks
like "the whole file is in hand", but `tailBytes` makes a single `readSync`, which may return
fewer bytes than asked for, and treating that as end-of-file would abandon a transcript whose
sentence is still there.

Growing the window rather than stitching chunks: a JSONL line split across a chunk boundary
has to be re-joined, and getting that wrong invents sentences. Re-reading costs ~1.3 MiB per
miss, per pane, at most once per debounce.

### 4.5 Two related fossils on the same path

- `sentFingerprint` is `paneId:changedAt` only. A pane whose AGENT changes without a visible
  state change is never re-fetched and keeps the previous agent's sentence. The fingerprint
  gains the agent.
- `paneTails` is never pruned, so a closed pane's entry survives. Both maps drop pane ids
  that are absent from the current snapshot (only when the snapshot has at least one tab, so
  a momentarily empty `tabViews` during restore cannot wipe the store).

Both are the same defect class this plan exists to remove — a sentence outliving the thing
it described — reached from the same two modules, so they are in scope.

## 5. Tasks

| # | File | Change |
| --- | --- | --- |
| T1 | `electron/resume/resolve.ts` | `ResumeRequest.preferredId?: string`; validate it in `isValidRequest`; pass it through `validateResumeRequests`; export `findCandidateById` |
| T2 | `electron/resume/session-tail.ts` | two-pass allocation; answer `{ id, tail }`; growing tail window; amend the header's "same file" claim |
| T3 | `src/lib/agent-resume.ts` | mirror `preferredId` on the wire type |
| T4 | `src/host/session-tail-host.ts` | defensive parse of the `{ id, tail }` answer |
| T5 | `src/terminal/session-tail-store.ts` | `paneSessions` map, send the pin, merge table §4.2, fingerprint gains agent + `hasRun`, forget dead panes AND replaced occupants (§4.3b), reset epoch |
| T6 | `src/terminal/session-restore.ts`, `src/sessions/resume-session.ts` | ~~pass the session id to `noteResumedPane`~~ — built, then reverted (§4.3) |
| T7 | tests | `resolve.test.ts` (pass-through), `session-tail.test.ts` (two passes, window growth), `session-tail-store.test.ts` (merge table, queue, prune) |
| T8 | docs | `docs/CONTEXT.md` section, `AGENTS.md` entry + drift row |

## 6. Verification

`npx vitest run electron/resume src/terminal/session-tail-store.test.ts`,
`npx tsc --noEmit`, `npm run electron:build`. The full `npm test` and `npm run build` are
run if they are green on a pristine `HEAD` — concurrent sessions have had them red.

No host pass and no owner eye review are possible from here; the rail is Electron-only for
tails, and the bug takes minutes of real agent traffic to reproduce.

## 7. Follow-up, not in this plan

- **Birthtime anchoring for fresh panes.** A session file's `birthtime` is when the
  conversation started, which is the pane's own start time — a far better first pairing than
  mtime proximity. `head.ts` would carry `birthtimeMs` and pass 2 would prefer a candidate
  born after the pane started. This makes the FIRST pairing right; §4.1 only makes it
  stable.
- **Pane cwd instead of tab cwd** in the request, for panes spawned in a subdirectory.
- **The 300-file scan cap is global, applied before the cwd filter** — 39 of this machine's
  206 Deck transcripts already fall off the end. It did not cause this report (the source
  file ranked 7th) but it will cause a "my rail is blank" one.

## 8. Smoke test (owner-side, the only place this bug appears)

No suite can establish this. The defect needs a real corpus, real tool traffic and minutes of
wall clock — three of the four newest transcripts answering `null` is what makes the churn
visible, and that state only exists while agents are actually working.

### S0. Isolate userData FIRST

`electron/main.ts` never calls `app.setPath("userData", …)`, so every dev run reads and writes
the same `~/Library/Application Support/Electron` as the owner's real sessions. Launch through
a wrapper that sets it before requiring the compiled main, or accept that the run mutates real
workspace state:

```js
// <scratchpad>/dev-isolated.cjs
const { app } = require("electron");
app.setPath("userData", "<scratchpad>/userdata");
require("<repo>/dist-electron/electron/main.cjs");
```

```bash
npm run build && npm run electron:build
npx electron <scratchpad>/dev-isolated.cjs
```

Two instances coexist (`main.ts` takes no single-instance lock), so this does not collide with
an `electron:dev` already open.

### Make ground truth trivial

Every check below depends on knowing which sentence belongs to which pane. Ask each agent to
end its reply with a unique marker — `PANE-A`, `PANE-B`, `PANE-C` — and the rail either shows
the right one or it does not. No internals, no logging.

| # | Scenario | Steps | Pass |
| --- | --- | --- | --- |
| S1 | **The reported bug** | One project, 3–4 `claude` panes in the SAME cwd. Give each a tool-heavy task ending in its own marker. Wait for all to finish. | Three DISTINCT rows, each showing its own marker. Any two rows sharing a sentence is a fail. |
| S2 | **Stability** | Leave S1 idle 5 minutes, touching nothing. | No row's sentence changes or moves to another row. This is where the churn used to happen. |
| S3 | **Generation reset (H1)** | In pane A, exit the agent to the shell. Then start a fresh `claude` and have it say `PANE-A2`. | The row goes blank when the agent exits, then shows `PANE-A2`. Showing `PANE-A` at any point after the exit is a fail. |
| S4 | **Buried sentence** | In one pane, after its last message, give it a long tool-only run (read many files, no further prose). | The row keeps showing that last message. Going blank means the growing window is not reaching it. |
| S5 | **Restore** | Quit, relaunch, let restore finish. | Each row shows its own pane's sentence. **Known weak spot:** the first pairing after restore is ranked, not pinned (§4.3), so a wrong row here is a KNOWN gap, not a regression — record it rather than treating it as a pass/fail. |
| S6 | **Close** | Close one pane of S1. | No ghost row; the remaining rows keep their own sentences. |
| S7 | **Mixed agents** | One `claude` and one `codex` in the same tab, each with its own marker. | Each row shows its own agent's marker. |

S1 and S3 are the two that matter: S1 is the reported bug, S3 is the defect this change
introduced and then fixed. The rest are regression cover.

### What a failure looks like

Two rows carrying one sentence is the original bug. A row carrying a sentence its pane never
said, stably, is a wrong pin — the new failure mode, and the one to report with the pane's cwd
and how many sessions that cwd has on disk.
