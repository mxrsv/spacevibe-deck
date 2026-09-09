---
kind: trust-audit
reviewed_at: 2026-09-03
scope: every signal Deck reads off an agent CLI (claude, codex, opencode, gemini, agy, cursor-agent, custom) — identity, state, last turn, model, session, resume, cwd, discovery, usage
head_sha: 57d3f3f54a7d0a79fd12b77e052c5196e93d7c9f
dirty: true (the working tree carries the uncommitted rail-card work; every anchor below was read from the tree, not from HEAD)
evidence: static read of the code; official CLI docs fetched 2026-09-03; peer-app research 2026-09-03; one empirical classification check. NO running host was observed.
---

# Agent signal trust audit — what Deck knows about an agent, and how much of it is true

**Why this exists.** The Agent Inbox ([spec](../specs/2026-09-02-agent-inbox-redesign-design.md))
is a surface whose whole value is the truth of five words per row: _working_, _asked_,
_done_, _failed_, _idle_, plus the sentence under them. The owner asked for the accuracy of
those words to be established before the inbox is built on them. This report answers, per
agent and per signal: **where does Deck get it, is that a supported contract or a guess, how
fresh is it, and where is it known to lie.**

**What this is not.** No code was changed, no gate was run, no agent was watched in a running
Deck. Every "would" in §4 is inferred from the code and marked so; §8 is the list of things
the owner's `electron:dev` session must actually look at.

## 0. Verdict

Deck's agent picture rests on **three tiers of trust**, and the rail draws all three with one
pen:

| Tier | What it is | Where Deck uses it |
| --- | --- | --- |
| **C — contract** | A mechanism the CLI (or the OS) documents for hosts. Two of Deck's C rows carry a Deck-maintained step on top — the `argv` → agent table in `classify.ts`, and the `ConEmuANSI` spoof that makes Claude emit OSC 9;4 — and §9 argues those steps are interop, not contract | process table (`ps`), Claude's OSC 9;4 progress (`terminalProgressBarEnabled`), OSC 9/777/BEL notifications, `command -v` discovery |
| **R — reverse-engineered** | A file or database the CLI writes for itself, read by Deck with no published schema | Claude `~/.claude/projects/**/*.jsonl`, Codex `~/.codex/sessions/**/rollout-*.jsonl`, opencode `opencode.db` + legacy `storage/`, Antigravity `.pb` blobs — tail, model, session id, resume id, usage |
| **H — heuristic** | A guess from timing or proximity | "working" for every non-Claude agent (sustained output), pane→session pairing (mtime nearest `changedAt`), tab cwd standing in for pane cwd |

Nine findings, ranked in §4 (§4.10 lists what was checked and holds). The five that change
what the inbox may claim:

1. **`cursor-agent` is never an agent.** Process classification lacks it on both hosts, so a
   Cursor pane is `busy`: no rail row, no state, no tail, no resume. Confirmed by running the
   classifier ([§4.1](#41-cursor-agent-classifies-as-busy-not-agent)).
2. **Claude's explicit "needs input" signal never reaches Deck by default.** Claude Code's
   `preferredNotifChannel` defaults to `auto`, which sends a notification only in iTerm2,
   Ghostty and Kitty and "does nothing elsewhere"; Deck's `TERM_PROGRAM` is `SpaceVibeDeck`.
   So the `requested` latch has no Claude producer unless the user sets `terminal_bell`, and
   every Claude `asked` today is the _finished-unchecked_ fold ([§4.2](#42-claudes-needs-input-signal-has-no-producer-under-deck)).
   Codex is the opposite case: it rings a BEL in Deck by default, for approvals AND for
   finished turns alike, and only while its pane is unfocused ([§5.2](#52-codex-cli-verified-2026-09-03-unless-marked)).
3. **`failed` has no producer.** The only path to `error` is OSC 9;4 state 2, which Claude's
   docs do not describe emitting; a crashing agent lands in `asked` ([§4.3](#43-failed-is-dead-vocabulary)).
4. **Claude's precise state signal is a spoof that is macOS-only and user-defeatable.** OSC 9;4
   is gated on `ConEmuANSI=ON`, which Deck sets only on macOS; on Windows Claude is heuristic;
   and a user's `terminalProgressBarEnabled: false` downgrades Claude to heuristic with no
   visible change, though the tracker already computes `confidence` ([§4.4](#44-the-osc-94-signal-is-conditional-and-the-rail-hides-the-condition)).
5. **The sentence can be one turn stale by design.** The tail is re-read only when a pane's
   visible STATE changes, and Anthropic documents that the transcript "is written
   asynchronously and may lag" the turn ([§4.6](#46-the-tail-is-refreshed-on-state-change-not-on-write-and-the-file-lags-the-turn)).

Everything the rail says about **claude/codex/opencode beyond identity and (for Claude)
working/idle** is tier R or H. That is not an accusation — no CLI publishes its transcript
schema — but the inbox should draw tier C and tier R/H differently, or say which one it is
drawing.

Two facts from the research half change the shape of the fix. **Claude Code ships a
registry:** `claude agents --json` lists every live interactive session with `pid`, `cwd`,
`sessionId` ("usable with `claude --resume`"), `status` and `waitingFor`
(`permission prompt`, `input needed`, …) — Deck already holds each pane's foreground pid,
so the mtime pairing (§4.7) and the missing "needs input" (§4.2) both have a documented
answer for Claude ([§5.1](#51-claude-code-verified-2026-09-03)). And **no peer app pairs
sessions by mtime**; the ones that report state truthfully take it from the CLI's hooks or
stream, and the ones that went hook-only report the same failure class — a missed hook
leaves the sidebar wrong until restart ([§6](#6-how-peer-apps-read-the-same-signals)).
Deck's process-table + OSC layer is exactly the fallback those apps lack; the work is to put
a contract layer on top of it, not to replace it.

## 1. Evidence boundary

- **Tree.** `main` at `57d3f3f` plus the uncommitted rail-card/launcher work. Anchors are
  `path#Lnn` into the tree as read on 2026-09-03; a concurrent session can move them.
- **Read, in full:** `src/terminal/agent-activity.ts`, `agent-attention.ts`,
  `agent-notifier.ts`, `pane-info-poller.ts`, `src/lib/osc-progress.ts`,
  `osc-notification.ts`, `process-info.ts`, `electron/platform/classify.ts`,
  `electron/pty/info.ts`, `electron/resume/*.ts` (all eight), `electron/agents.ts`,
  `src/ui/sessions/live-session-state.ts`, `src/sessions/recent-activity-sync.ts`. Read in
  part (the relevant functions): `tab-manager.ts`, `session-tail-store.ts`,
  `agent-rail-model.ts`, `session-restore.ts`, `agent-launch.ts`, `agent-resume.ts`,
  `electron/platform/macos.ts` / `windows.ts`, `electron/pty/spawn.ts`,
  `electron/shell-integration.ts`, `electron/usage/discover.ts`, `electron/sessions/*.ts`,
  `src-tauri/src/pty.rs` / `info.rs`.
- **Official docs fetched 2026-09-03:** `code.claude.com/docs/en/terminal-config`,
  `/hooks` (full markdown), `/statusline`, `/settings-reference` (full markdown),
  `/agent-view`; Codex config reference and four source files; opencode server, SDK and
  plugin pages plus the generated types and `attention.ts`; Gemini hooks, hooks reference,
  notifications; Cursor CLI parameters; Antigravity conversations and statusline pages.
  Every §5/§6 line carries its URL.
- **Delegated research:** two subagents returned reports on 2026-09-03 (official
  contracts; peer apps), every claim URL-carrying. Before entry here, seven load-bearing
  claims were re-fetched by this session and confirmed verbatim (`claude agents --json`
  fields, the `terminalSequence` hook field, Antigravity's `agent_state`, opencode's
  `focusSkip`, Gemini's OSC 9 + BEL notifications, Agent Deck's identity invariant, cmux
  issue #3749). Claims taken from the reports without a re-fetch are marked **reported**.
- **Executed, read-only, on this machine:** `classifyProcess` through `tsx` against the six
  built-in names (§4.1); a walk of `~/.gemini` — the Antigravity `.pb` store Deck scans, the
  CLI's own `conversation_metadata.json` and `conversation_summaries.db` (schema and a
  group-by), and the Gemini `history/` and `tmp/*/chats/` directories (§5.3, §5.6);
  `grep` over the bundled xterm.js for focus reporting (§5.2); `claude agents --json`, which
  listed this machine's live Claude sessions with `pid`, `cwd`, `sessionId` and `status`
  (§5.1). Nothing was written and no agent was launched.
- **Not observed:** any agent in a running Deck; any OSC byte on a real PTY; any
  transcript write timing. The 2026-08-17 corpus measurements in
  [session-tail-parsing](2026-08-17-session-tail-parsing.md) are the only runtime data this
  report leans on, and they are eighteen days old.

## 2. The four input channels

Every fact the rail prints arrives on one of four channels. The trust tier is a property of
the channel, and the rail never prints which channel a fact came from.

### 2.1 PTY bytes (tier C for the sequences, H for the fallback)

- **OSC 9;4 progress** — parsed off every output chunk by
  [`parseProgressEvents`](../../src/lib/osc-progress.ts#L86) into
  [`agent-activity.ts`](../../src/terminal/agent-activity.ts). Once a pane has ever reported a
  state, OSC is the sole source for that pane (`isWorking`,
  [L200](../../src/terminal/agent-activity.ts#L200)): non-zero = working, 0 = idle, 2 = error,
  4 = warning. Reset when the polled foreground process changes
  ([L271](../../src/terminal/agent-activity.ts#L271)).
- **Sustained-output fallback** — for a pane that has never reported OSC: working = a streak
  of non-echo output ≥ 400 ms (`DEFAULT_MIN_STREAK_MS`), still fresh within 3 000 ms
  (`DEFAULT_RECENT_MS`), where output within 300 ms of a keystroke is echo and a silence
  > 1 200 ms starts a new streak ([L93–L96](../../src/terminal/agent-activity.ts#L93)). A
  3 200 ms timer in `tab-manager` feeds one synthetic idle so the decay renders without a
  poll ([L2465](../../src/terminal/tab-manager.ts#L2465)).
- **OSC 9 (non-progress), OSC 777 `notify;…`, BEL** — xterm handlers in
  [`pane.ts`](../../src/terminal/pane.ts#L238) classified by
  [`classifyOscNotification`](../../src/lib/osc-notification.ts#L56); each becomes one
  `requested` signal with no payload text.
- **OSC 133;B** (prompt ready) and **OSC 9;9** (cwd) — parsed main-process side by
  [`shell-integration.ts`](../../electron/shell-integration.ts#L120). 133;B drives only the
  launcher's readiness on Windows; it never reaches the attention tracker.

### 2.2 Process table (tier C)

One `ps -A -o pid=,pgid=,tpgid=,tty=,args=` per 2 s poll
([macos.ts#L105](../../electron/platform/macos.ts#L105),
[`DEFAULT_INTERVAL_MS`](../../src/terminal/pane-info-poller.ts#L4)), joined tty → tpgid →
pgid to find the foreground process, then
[`classifyProcess`](../../electron/platform/classify.ts#L170): argv0 basename, or the script
name behind `node`/`bun`/`python`, looked up in
[`AGENT_BY_BINARY`](../../electron/platform/classify.ts#L25) (five names) and then in the
user's custom-agent matchers; shells → `idle-shell`; anything else → `busy`. Windows walks
the process tree instead ([windows.ts#L439](../../electron/platform/windows.ts#L439)). cwd is
`lsof -d cwd` on the foreground pid, refreshed on a separate clock, with OSC 9;9 as the
fallback. The classification is the **gate** for everything in 2.1: the tracker ignores every
byte from a pane whose last poll was not an agent
([`gateAccepts`](../../src/terminal/agent-attention.ts#L267)).

### 2.3 Session stores on disk (tier R)

Read in the main process only (Electron; Tauri has no `session_tail` or `resume_lookup`
command at all — verified by grep over `src-tauri/src/`). Bounded, symlink-refusing reads
([`head.ts`](../../electron/resume/head.ts)):

| Agent | Store | Identity | cwd | Tail | Model |
| --- | --- | --- | --- | --- | --- |
| claude | `~/.claude/projects/<slug>/*.jsonl`, newest 300 files, 64 KiB / 60 lines head ([`CLAUDE_RESTORE_SCAN`](../../electron/resume/claude.ts#L29)) | `sessionId` on line 1 | first `cwd` field in the head | newest `type:"assistant"` record with a `text` part, read from the END of the file in 64 KiB → 256 KiB → 1 MiB steps ([`TAIL_WINDOW_STEPS`](../../electron/resume/session-tail.ts#L57)) | `message.model` on the newest assistant record ([L124](../../electron/resume/session-tail.ts#L124)) |
| codex | `~/.codex/sessions/**` + `archived_sessions/**` `rollout-*.jsonl`, newest 300, same head budget ([`CODEX_RESTORE_SCAN`](../../electron/resume/codex.ts#L40)); rollouts whose `session_meta.payload.source` is `"exec"` or an object are dropped ([L60](../../electron/resume/codex.ts#L60)) | `payload.id` on line 1 | `payload.cwd` | newest `payload.type:"message"`, `role:"assistant"` ([L97](../../electron/resume/session-tail.ts#L97)) | `turn_context.payload.model` ([L147](../../electron/resume/session-tail.ts#L147)) |
| opencode | `~/.local/share/opencode/opencode.db` via `node:sqlite`, `session WHERE parent_id IS NULL` newest 300 ([`SESSIONS_SQL`](../../electron/resume/opencode-db.ts#L36)); legacy `storage/` json tree merged behind it, deduped by id ([L153](../../electron/resume/opencode.ts#L153)) | `session.id` | `session.directory` | newest `part` with `type = 'text'` on an `assistant` message ([`TAIL_SQL`](../../electron/resume/opencode-db.ts#L60)) | `message.data.modelID` of that same text-bearing turn |
| agy | `~/.gemini/antigravity/conversations/*.pb`, newest 300, 512 KiB head ([L53](../../electron/resume/agy.ts#L53)) | filename | none — raw-byte containment of the request cwd in the head | none | none |
| gemini | no scan; resume answers `{ kind: "latest" }` unconditionally ([resolve.ts#L166](../../electron/resume/resolve.ts#L166)) | — | — | none | none |
| cursor-agent, custom | no scan | — | — | none | none |

The pairing that decides WHICH file a pane is quoting is §3 row 8; it is the H-tier piece
inside this R-tier channel.

### 2.4 PATH probe (tier C)

`sh -ilc "command -v claude; command -v codex; …"` with a 3 s timeout
([agents.ts#L209](../../electron/agents.ts#L209)); Windows walks `PATH` with the `.cmd`/`.exe`
suffixes. Cached 30 s in the renderer. This is the only channel with no trust problem: an
absolute path either resolves or it does not.

## 3. Signal × agent matrix

Legend: **C** contract · **R** reverse-engineered · **H** heuristic · **—** not produced.
"Fresh" is how quickly a change on the agent's side can reach the rail. Host: E = Electron
only, B = both hosts.

| # | Signal (rail word) | claude | codex | opencode | gemini | agy | cursor-agent | custom | Fresh | Host |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Identity** (glyph, row exists at all) | C `ps` | C | C | C | C | **— `busy`** (§4.1) | C by first word of the declared command | ≤ 2 s poll | B |
| 2 | **working** (phase) | C OSC 9;4 — macOS only, user-defeatable (§4.4); H elsewhere | H | H | H | H | — | H | OSC: per chunk. H: 400 ms to turn on, 3 s silence to turn off | B |
| 3 | **asked — needs input** (`requested`) | C OSC 9/777/BEL — **no producer by default** (§4.2) | C BEL — default on, **only while Codex believes the pane is unfocused**, and for turn-complete as well as approval (§5.2) | — no bell/OSC found in the docs fetched; the contract route is the plugin `permission.asked` event or `/event` (§5.4) | — | — | — | BEL if the tool rings one | per byte | B |
| 4 | **asked — finished, unchecked** (`completed`) | C: OSC 9;4 → 0 after non-zero | H: streak decay, or agent→shell poll ([L382](../../src/terminal/agent-attention.ts#L382)) | H | H | H | — | H | OSC: per chunk; H: 3–3.2 s after last output; process: ≤ 2 s | B |
| 5 | **failed** (`error`) | C OSC 9;4 state 2 — **not documented as emitted** (§4.3) | — | — | — | — | — | — | — | B |
| 6 | **Last sentence** | R jsonl tail | R rollout tail | R SQLite | — | — | — | — | 300 ms after a pane STATE change, never on a write (§4.6) | E |
| 7 | **Model** | R `message.model` | R `turn_context` | R `modelID` | — | — | — | — | same batch as 6; **withheld from the card by decision** ([agent-rail.tsx#L198](../../src/ui/agent-rail.tsx#L198)) | E |
| 8 | **Session id / pairing** | R id + H pairing | R + H | R + H | — (`latest`) | R id + H containment | — | — | first ask ranked, then pinned (§4.7) | E |
| 9 | **Resume on restore** | `claude --resume <id>` | `codex resume <id>` | `opencode -s <id>` | `gemini --resume latest` — the `latest` keyword is unverified (§5.3) | `agy --conversation <id>`, `--continue` fallback | bare `cursor-agent` (no scanner) | declared command, no resume | boot only | E (Tauri types nothing) |
| 10 | **cwd** (header, links, branch) | C `lsof`; OSC 9;9 fallback | C | C | C | C | C (as `busy`) | C | lsof on its own clock; tail REQUEST uses the tab's path, not the pane's | B |
| 11 | **Installed** | C | C | C | C | C | C | C | boot + 30 s revalidate | B |
| 12 | **Token usage** (dashboard) | R jsonl `usage` incl. `subagents/` | R `token_count` events | — | — | — | — | — | dashboard scan | B (Rust twin) |
| 13 | **Recent activity row + live dot** | R listing; dot = pane paired to that exact id | R | **—** (has a tail source, no history row — [`SessionAgent`](../../electron/sessions/model.ts#L8)) | — | — | — | — | 600 ms debounce, 4 s floor ([L37](../../src/sessions/recent-activity-sync.ts#L37)) | E |

How a row's word is chosen ([`paneState`](../../src/ui/agent-rail-model.ts#L298)):
`error` → **failed**; `requested` / `warning` / `completed` → **asked**; else `phase ===
"working"` → **working**; else `hasRun` → **done**, otherwise **idle**. Three tracker
states share one yellow word, and the tracker's own `confidence: "explicit" | "inferred"`
([agent-attention.ts#L37](../../src/terminal/agent-attention.ts#L37)) reaches no pixel.

## 4. Findings — where Deck can lie

Ranked by how often a user would meet it, then by how wrong the rail would be. Each names
its evidence class: **confirmed** (executed or read in a doc) or **inferred** (read in code,
never observed).

### 4.1 `cursor-agent` classifies as `busy`, not `agent`

**Confirmed.** [`AGENT_BY_BINARY`](../../electron/platform/classify.ts#L25) holds `claude`,
`codex`, `gemini`, `opencode`, `agy`; [`info.rs#L52`](../../src-tauri/src/info.rs#L52) holds
the same five. The renderer's `agentProcessMatchers` maps **custom** agents only
([agent-catalog.ts#L159](../../src/lib/agent-catalog.ts#L159)), so nothing supplies the sixth
built-in. Run on 2026-09-03:

```
$ npx tsx  # classifyProcess(name, true) for each built-in
claude        {"kind":"agent","agent":"claude"}
codex         {"kind":"agent","agent":"codex"}
opencode      {"kind":"agent","agent":"opencode"}
gemini        {"kind":"agent","agent":"gemini"}
agy           {"kind":"agent","agent":"agy"}
cursor-agent  {"kind":"busy","agent":null}
node /opt/homebrew/bin/cursor-agent --force → {"kind":"busy","agent":null}
```

**Consequence.** A Cursor pane is a busy shell to every consumer of the classification: no
rail row (`paneRows` drops `agent === null`), the attention gate never opens (no state, no
notification), the tail store never asks, the journal records no agent so restore relaunches
nothing, and the quit census counts it as a busy job rather than an agent. `AGENTS.md`
records the 2026-08-19 fork as "the list reaches process classification
(`agentProcessMatchers`)" — that sentence is untrue for a built-in. **Fix is one line per
host, but process classification is fork-listed** (§7.1).

### 4.2 Claude's "needs input" signal has no producer under Deck

**Confirmed from docs, unobserved in Deck.** The only explicit sources of `requested` are
OSC 9 / OSC 777 / BEL. Claude Code decides whether to emit any of those from
[`preferredNotifChannel`](https://code.claude.com/docs/en/settings-reference), fetched
2026-09-03:

> `"auto"`: Claude Code sends a desktop notification in iTerm2, Ghostty, and Kitty, rings
> the bell in Terminal.app only when its audible bell is off, and does nothing elsewhere
> … **Default**: `"auto"`

Deck's PTY carries `TERM_PROGRAM=SpaceVibeDeck` ([spawn.ts#L116](../../electron/pty/spawn.ts#L116)),
so under the default Claude sends **nothing**. Only a user who has set
`"terminal_bell"` (or `iterm2_with_bell`) produces a BEL Deck can hear. And even then the
`Notification` event that rings it fires late by design
([hooks](https://code.claude.com/docs/en/hooks), fetched 2026-09-03): `permission_prompt`
"and the prompt has waited about six seconds", `idle_prompt` "Claude finished responding
about 60 seconds ago and you haven't typed since".

**Consequence.** For Claude, every yellow mark the rail has ever shown was the
`completed` fold — "OSC went 3 → 0" — not a question. Two readings of a permission prompt
are possible and **the code cannot tell them apart**:

- if Claude clears the progress state while it waits for approval, the row goes `asked`
  (correct word, wrong reason) and the OS notification says **"Claude finished"**
  ([`KIND_PHRASE`](../../src/terminal/agent-notifier.ts#L57)) about a pane that is blocked on
  a yes/no;
- if Claude keeps the progress state busy through the wait, the row says **`working`** for as
  long as the prompt sits there.

The docs say only that Claude "reports an in-progress state to the terminal and clears it
when the turn ends". Which branch is real is **live check #1** (§8). Either way the row is not
reporting a question; it is reporting the absence of progress bytes.

### 4.3 `failed` is dead vocabulary

**Confirmed by grep.** The only `latch(…, "error", …)` is
[`reduceActivity`](../../src/terminal/agent-attention.ts#L291) on OSC 9;4 severity 2. No
process-exit path carries a code into the tracker (`noteExit` sets `phase: "exited"` and
touches nothing else — [L421](../../src/terminal/agent-attention.ts#L421)), and no output
grammar produces `error`. Anthropic's `terminalProgressBarEnabled` entry describes an
in-progress state and a clear, nothing about an error state. **A Claude process that dies
mid-run** goes agent → shell on the next poll and is latched `completed` if it was working
([L382](../../src/terminal/agent-attention.ts#L382)) — so a crash reads as **asked**, in the
same yellow as a finished run. The rail spec's "`failed` is not allowed to read as `idle`"
holds trivially, because nothing can reach `failed`. The same is true of `warning`: OSC
state 4 is its only producer, equally undocumented, so the `warning` → `asked` fold has
never had a case either.

### 4.4 The OSC 9;4 signal is conditional, and the rail hides the condition

**Confirmed from docs + code.** Claude emits OSC 9;4 "only in terminals that support the
indicator: ConEmu, Ghostty 1.2.0 or later, and iTerm2 3.6.6 or later"
([settings-reference](https://code.claude.com/docs/en/settings-reference), `Default: true`).
Deck qualifies by setting `ConEmuANSI=ON` — **on macOS only**, on both hosts
([spawn.ts#L125](../../electron/pty/spawn.ts#L125), [pty.rs#L338](../../src-tauri/src/pty.rs#L338)),
deliberately not faked on Windows because tools take ConEmu-specific paths on a real ConPTY.
So:

- **Windows:** Claude is a heuristic agent like every other. Gate C already says Windows is
  unwitnessed; this adds that the ONE explicit state signal is absent there by design.
- **Any platform:** a user with `terminalProgressBarEnabled: false` — a `/config` toggle —
  silently moves their Claude panes to the heuristic. The tracker records this
  (`confidence: "inferred"` on every completion), and the rail draws it identically.
- **The spoof has an expiry.** Both env blocks say "drop this once Claude Code recognises
  Deck by name"; today's documented gate names three products and Deck is not one.

### 4.5 The startup blind window drops the first transition

**Inferred, unobserved.** The tracker ignores — does not store, does not replay — any
transition for a pane it has never polled ([L313](../../src/terminal/agent-attention.ts#L313))
or whose gate is closed ([`gateAccepts`](../../src/terminal/agent-attention.ts#L267)), and
opening the gate "does not replay any pre-gate activity"
([L367](../../src/terminal/agent-attention.ts#L367)). The gate opens on a poll that finds an
agent in the foreground; polls run every 2 s plus one on materialize, and the agent is not
yet in the foreground at materialize (the shell is). A run whose `9;4;3` lands before the next
poll is invisible: `activity` knows it is working (the legacy `agentBusy` spinner shows),
but the tracker's phase stays `unknown`, the rail says **idle**, `hasRun` stays false so **no
tail is requested**, and the eventual `9;4;0` produces no `completed` because `prev.phase`
was never `working`. The whole run leaves no trace until the NEXT transition. Window: ≤ 2 s
per launch.

Who can hit it, read from the launch paths rather than assumed: **not** `launchTask`'s
paste — `TASK_PROMPT_AUTOSEND` is `false`, so the user presses Enter long after the gate
opened — and **not** restore's `--resume`, which sits at a prompt until typed into. The
victims are launches that start working at once: a positional prompt typed by hand
(`claude "…"`, `codex "…"`), `agy -p`, or a resumed session with queued input.

A second consequence of the same drop is worse and hits `launchTask` itself. Claude
emits `9;4;0` once when its UI is up ([pty.rs#L337](../../src-tauri/src/pty.rs#L337)); if
that lands before the gate opens it is dropped, and because `activity` has now seen OSC
from the pane the heuristic bookkeeping stops for good — **no further transition reaches the
tracker until real work starts**. `launchTask`'s readiness gate
([`submitAllowed`](../../src/prompts/inject.ts#L50)) requires the tracker to say
`phase: "idle"`, which it now cannot, so [`waitForPromptReady`](../../src/terminal/tab-manager.ts#L978)
polls to its ceiling and the launch ends `prompt-not-sent` with nothing pasted, on a pane
that is visibly sitting at Claude's prompt. Whether Claude's startup `0` beats the 2 s poll
is a race decided by Claude's own boot time — live check #5.

### 4.6 The tail is refreshed on state change, not on write — and the file lags the turn

**Confirmed from docs + code.** `session-tail-store` fires on `tabViews` identity and
dedupes on `paneId:agent:hasRun:changedAt`
([L204](../../src/terminal/session-tail-store.ts#L204)); `changedAt` moves only when a
pane's visible state (phase / attention / unread / label) changes. A transcript write is not
an event. Anthropic's hooks page, fetched 2026-09-03:

> The transcript file is written asynchronously and may lag the in-memory conversation, so
> it may not yet include the current turn's most recent messages when a hook fires. Hooks
> that need the final assistant text of the current turn should use `last_assistant_message`
> on Stop …

So at the exact moment the rail asks (working → idle, 300 ms later) the newest sentence may
not be on disk. `merged` keeps the previous sentence on a null tail
([L337](../../src/terminal/session-tail-store.ts#L337)) and nothing re-asks until the pane's
state moves again — which, for a pane the user then leaves alone, is never. The row can show
the **previous turn's** sentence for the whole time the user is looking at it. The
2026-08-22 fix removed the sentence walking BETWEEN rows; it did not add a second ask.

### 4.7 Pairing is a guess for the first ask, then frozen

**Confirmed from code; all four limits already recorded in `AGENTS.md` and restated here as
one list because the inbox will inherit them.** For a pane with no `preferredId`,
[`selectCandidate`](../../electron/resume/resolve.ts#L102) takes, among the newest **300
files of that agent across every project** (the cap is applied before the cwd filter),
those within 30 days whose cwd equals the request cwd **or is null**, and picks the one whose
mtime is nearest the pane's `changedAt`. The request cwd is the **tab's** workspace path
([L255](../../src/terminal/session-tail-store.ts#L255)), so a pane running in a sub-directory
or a sibling worktree matches only through the null-cwd wildcard, i.e. never for Claude and
Codex, which write a cwd. Two panes of one agent in one checkout are separated by greedy
dedup and `changedAt` proximity alone. The first answer is then pinned
([`findCandidateById`](../../electron/resume/resolve.ts#L141), no cutoff, no ranking) until
the pane's occupant changes — a wrong first guess is a wrong pin for the pane's whole life.
Meanwhile Claude hands its `session_id` to any hook and to the status line on every update,
and `claude agents --json` answers `pid` → `sessionId` → `cwd` → `status` for every live
interactive session (§5.1) — run on this machine today, it did exactly that. Deck already
knows each pane's foreground pid from `pty_info`. The guess exists because Deck reads the
file system instead of the process (§7.5).

### 4.8 `working` for every non-Claude agent is a timing heuristic

**Inferred; the constants are confirmed.** codex, opencode, gemini, agy, cursor (were it
classified) and custom agents never report OSC 9;4 (§5 records what each documents), so their
working state is "≥ 400 ms of non-echo output within the last 3 s". Codex's BEL (§5.2)
adds a true `requested` on top, but only for an unfocused pane. Anything a TUI animates
counts — a spinner, a streaming diff, a status-bar clock — and any static screen counts as
idle after 3 s, which the tracker converts to `completed` → **asked**. So a static approval
prompt reads as a finished run, an animated approval prompt reads as working, and a long
tool call with no screen output reads as finished until the output resumes (then `completed`
clears itself and re-latches on the next decay). The 2026-08-17 rail spec accepted this for
v1; the inbox makes it a primary surface.

### 4.9 Gaps that are absences, not lies

- **Model** is R-tier on all three agents that produce it and is correctly withheld from the
  card ([agent-rail.tsx#L198](../../src/ui/agent-rail.tsx#L198)). Note the opencode value is
  the model of the newest **text-bearing** turn, not the newest turn.
- **gemini** has identity, heuristic state and nothing else: no scan, no tail, no id, resume
  is `--resume latest` unconditionally. The documented no-argument `--resume` means "most
  recent"; the `latest` keyword Deck types is not in the official post (§5.3).
- **agy** resumes by containment over an undocumented protobuf; a cwd that is a prefix of
  another project's path can match the wrong file. Accepted best-effort in the scanner's own
  comment — and unnecessary: the CLI keeps a JSON/SQLite index with the cwd as a URI (§5.6).
- **opencode** has a tail source but no Recent-activity row and no usage counter; **Recent
  activity and usage are claude + codex only.**
- **Tauri** has identity, state and cwd; none of tail, model, pairing or resume. Every
  "the rail says what the agent just said" claim is Electron-only.
- Claude tail does not filter `isSidechain` records
  ([`claudeTailFromLines`](../../electron/resume/session-tail.ts#L72)); the 2026-08-17 corpus
  counted zero in the 30 newest transcripts, so low today.
- **Reported** (§5.2): Codex compresses cold rollouts to `.jsonl.zst`; Deck's walk keeps
  only `.jsonl`, so an old session is invisible to resume and to Recent activity once
  compressed. Affects age, not the live rows.

### 4.10 What was checked and holds

Stated so the list above is not read as "everything is wrong":

- The OSC 9;4 parser handles split sequences and caps its carry; progress payloads are
  refused by the notification classifier ([`PROGRESS_PAYLOAD`](../../src/lib/osc-notification.ts#L22)),
  so `9;4;…` can never masquerade as `requested`.
- `pty_info` rejects rather than answering `unknown` when the table cannot be read, and
  `unknown` never becomes `busy`; the poller keeps last-known values.
- Every scanner is bounded (300 files, 64 KiB heads, `lstat` before `open`, symlinks
  refused); opencode ids are validated before being pasted into a path; resume ids pass
  `SESSION_REF_SAFE` before a PTY write.
- The attention axis never downgrades (`latch` is monotonic) and clears only on an
  acknowledged focus while the window is foreground.
- The tail/model/pairing triple is carried as one unit, so a re-pairing drops both fields;
  a pane whose agent generation changes is forgotten before the next ask.
- `resolveSessionTails` honours every pin in a first pass before ranking anything, which is
  the fix that stopped one sentence walking across three rows.

## 5. What the CLIs officially offer

Every line names the URL it was read from and the date; a claim from memory is marked
`UNVERIFIED (recall)`. The point of this section is the **C column**: which of the R/H rows
above have a documented replacement.

### 5.1 Claude Code (verified 2026-09-03)

| Signal | Documented mechanism | Source |
| --- | --- | --- |
| working / idle | `terminalProgressBarEnabled` (default `true`): OSC 9;4 in-progress while Claude works, cleared when the turn ends — **only** in ConEmu, Ghostty ≥ 1.2.0, iTerm2 ≥ 3.6.6 | [settings-reference](https://code.claude.com/docs/en/settings-reference) |
| needs input | `preferredNotifChannel` (default `auto`; `terminal_bell`, `iterm2`, `iterm2_with_bell`, `kitty`, `ghostty`, `notifications_disabled`) — `auto` "does nothing elsewhere" | same |
| needs input, exact | `Notification` hook, matchers `permission_prompt` (fires after ~6 s), `idle_prompt` (~60 s), `agent_needs_input`, `agent_completed`, `elicitation_*`; `PermissionRequest` hook fires **when** a tool call needs a decision | [hooks](https://code.claude.com/docs/en/hooks) |
| finished | `Stop` hook with `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons`; `StopFailure` "when the turn ends due to an API error" | same |
| failed | `StopFailure`, `PostToolUseFailure` | same |
| identity, session, cwd, model | every hook's stdin: `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `effort`, `hook_event_name`; `SessionStart` / `SessionEnd` bracket the process | same |
| model, cost, context, session | status line stdin JSON (`model.id`, `model.display_name`, `session_id`, `transcript_path`, `workspace.current_dir`, `workspace.project_dir`, `cost.total_cost_usd`, `context_window.used_percentage`, `rate_limits.*`, `version`), debounced 300 ms, event-driven | [statusline](https://code.claude.com/docs/en/statusline) |
| **live session registry** | `claude agents --json` "prints active sessions as a JSON array and exits": per session `cwd`, `kind` (`interactive` \| `background`), `startedAt` always; `pid`, `status` while the process is alive; `waitingFor` when `status` is `waiting` — `permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`; `sessionId` "the full session UUID, usable with `claude --resume`"; `--cwd <path>` filters. Interactive sessions included. **Run on this machine 2026-09-03:** every interactive session on the box was listed with `pid`, `cwd`, `sessionId`, `name` and `status: "idle"`, and one with `status: "waiting"`, `waitingFor: "dialog open"` | [agent-view](https://code.claude.com/docs/en/agent-view); local run |
| host-chosen terminal marker | a hook may return `terminalSequence`: "A terminal escape sequence for Claude Code to emit on your behalf … Restricted to OSC `0`/`1`/`2`/`9`/`99`/`777` and BEL"; "Claude Code emits it for you through its own terminal write path"; fires even on `StopFailure`, whose other output is ignored | [hooks](https://code.claude.com/docs/en/hooks) |
| transcript | `projects/<project>/<session>.jsonl` ("Full conversation transcript"), `<session>/subagents/`, `<session>/tool-results/`, `.orphaned-*` / `.superseded-*` variants; `sessions/` holds "one small file per running session, used to detect concurrent sessions and crashes"; `transcript_path` documented as **written asynchronously, may lag**. The sessions page, verbatim: "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release. To build on session data, use `/export` or the script interfaces instead" | [claude-directory](https://code.claude.com/docs/en/claude-directory), [hooks](https://code.claude.com/docs/en/hooks), [sessions](https://code.claude.com/docs/en/sessions) |
| resume | `claude --resume <id>`, `--continue`; **reported:** `--session-id <uuid>`, `--fork-session` | [cli-reference](https://code.claude.com/docs/en/cli-reference) (reported) |

**The one fact that matters most:** everything Deck guesses about a Claude pane — its session
id, its cwd, its model, the last sentence, whether it is waiting on a permission — is handed
to any hook command on stdin, keyed by the exact `session_id`, at the moment it happens, and
`claude agents --json` answers the same questions for every live session on demand, keyed by
`pid`. The transcript Deck reads is the same data, later and lossier.

### 5.2 Codex CLI (verified 2026-09-03 unless marked)

| Signal | Documented mechanism | Source |
| --- | --- | --- |
| needs input / finished, in-terminal | `tui.notifications` (`boolean \| array<string>`, "Enable TUI notifications; optionally restrict to specific event types") — **default `Enabled(true)`**; `tui.notification_method` = `auto \| osc9 \| bel` (default `auto`); `tui.notification_condition` = `unfocused \| always` (default `unfocused`). Events: `agent-turn-complete`, `approval-requested` (exec, edit and elicitation share the name), `plan-mode-prompt`. `auto` picks OSC 9 when `terminal_info()` names Ghostty, iTerm2, Kitty, Warp or WezTerm and BEL for every other name — **Deck lands on BEL by inference** (`SpaceVibeDeck` is not on that list; the detection module itself was not read); `unfocused` is read from crossterm focus events (DECSET 1004, which xterm.js 6 implements) | [config reference](https://learn.chatgpt.com/docs/config-file/config-reference); [`config/src/types.rs`](https://github.com/openai/codex/blob/main/codex-rs/config/src/types.rs); [`tui/src/notifications/mod.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/notifications/mod.rs); [`tui/src/chatwidget/notifications.rs`](https://github.com/openai/codex/blob/main/codex-rs/tui/src/chatwidget/notifications.rs) |
| finished, out-of-band | `notify` (`array<string>`): "Command invoked for notifications; receives a JSON payload from Codex", unset = disabled. Payload keys: `type: "agent-turn-complete"`, `thread-id`, `turn-id`, `cwd`, `client`, `input-messages`, `last-assistant-message`, appended as the **final argv argument**; the source carries a TODO to remove it once hooks replace it | same; [`hooks/src/legacy_notify.rs`](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/legacy_notify.rs) |
| lifecycle, exact | hooks: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `SubagentStart`, `SubagentStop`, `UserPromptSubmit`, `Stop`, `Interrupt` — inline `[hooks]` in `config.toml` or a `hooks.json`; command and MCP-tool handlers run, "prompt and agent hook handlers are parsed but skipped" | same |
| working / progress | nothing about OSC 9;4 or a progress bar on the reference page; **reported:** a code search for `"9;4"` in the Codex repo found no emitter | same |
| structured stream | **reported:** `codex exec --json` emits `turn.started` / `turn.completed` (with `usage`) / `turn.failed`, `item.started` / `item.completed`, `error`; `codex app-server` (JSON-RPC, `initialize` required) emits `turn/started`, `turn/completed` with `completed \| interrupted \| failed`, `thread/status/changed`, `thread/list` filtered by `cwd`; the hook list has **no `Notification`** event | [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [app-server](https://learn.chatgpt.com/docs/app-server) (reported) |
| rollouts, resume | not on the reference page. **Reported** from `codex-rs/rollout/src/`: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl`, line 1 `session_meta`, **cold files compressed to `.jsonl.zst`**, plus `archived_sessions/`; hooks docs call the transcript "not a stable interface for hooks and may change over time". `codex resume <id \| name>`, `--last`, `--all`, `codex fork` | [`rollout/src`](https://github.com/openai/codex/tree/main/codex-rs/rollout/src), [hooks](https://learn.chatgpt.com/docs/hooks) (reported) |

Three consequences for Deck. **Codex rings a BEL in Deck by default** — `auto` resolves an
unrecognised `TERM_PROGRAM` to the BEL backend — on `approval-requested` AND on
`agent-turn-complete`, but **only while the pane is unfocused** in crossterm's eyes, which
is exactly the case the rail exists for. So Codex is today the one agent whose `requested`
latch has a live producer, and Deck cannot tell its two events apart: a finished turn rings
the same BEL as an approval prompt, and both latch `requested` ("needs attention"). Second,
a Codex pane that holds keyboard focus rings nothing, so an approval prompt in the focused
pane relies on the heuristic like everyone else. Third, **Codex has the same hook vocabulary
Claude has**, `Stop` and `PermissionRequest` included, so §7.5's contract route is not
Claude-only. Whether xterm.js actually answers Codex's focus query in a Deck pane is
**live check #8**.

### 5.3 Gemini CLI (verified 2026-09-03 unless marked)

| Signal | Documented mechanism | Source |
| --- | --- | --- |
| resume | `gemini --resume` (most recent), `gemini --resume <index>`, `gemini --resume <UUID>`, `gemini --list-sessions`; on by default from v0.20.0 | [Google Developers Blog](https://developers.googleblog.com/pick-up-exactly-where-you-left-off-with-session-management-in-gemini-cli/) |
| resume, the form Deck types | `gemini --resume latest` — the `latest` keyword is **not** in the official post; it appears in a source-derived wiki and third-party cheat sheets only. `UNVERIFIED` — live check #10 | — |
| session store | "project-specific", no on-disk path in the official post. On this machine both `~/.gemini/history/<project>/` (holding `.project_root`) and `~/.gemini/tmp/<project>/chats/` exist, the latter empty — layout `UNVERIFIED` against docs | local `ls`, 2026-09-03 |
| lifecycle, exact | hooks in `settings.json` → `hooks`: `SessionStart`, `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`, `Notification`; every hook's stdin carries `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp` | [hooks](https://geminicli.com/docs/hooks/), [reference](https://geminicli.com/docs/hooks/reference/) |
| needs input, exact | `Notification` with `notification_type` "currently only `\"ToolPermission\"`", plus `message` and `details` | reference |
| finished + last text | `AfterAgent` carries `prompt`, `prompt_response` ("the agent's final generated text"), `stop_hook_active` | reference |
| terminal notifications | `general.enableNotifications: true` (off unless set): "Action required" (waiting for user input or tool approval) and "Session complete", sent as **OSC 9**, with a fall back to "a terminal bell (BEL)"; terminals listed: iTerm2, WezTerm, Ghostty, Kitty; labelled "an experimental feature currently under active development" | [notifications](https://geminicli.com/docs/cli/notifications/) |
| working / progress | nothing about OSC 9;4 on the pages fetched | — |
| lifecycle | **reported:** the changelog banner says "Unpaid tier and Google One users: Gemini CLI will be replaced by Antigravity CLI on June 18th"; latest release v0.54.0 (2026-08-06); env `GEMINI_SESSION_ID`, `GEMINI_CWD`, `GEMINI_PROJECT_DIR` | [changelogs](https://geminicli.com/docs/changelogs/) (reported) |

**Consequence.** Gemini, which Deck treats as its poorest agent (no scan, no tail, `latest`
resume), hands a host the same trio Claude does — `session_id`, a permission notification
and the final text — through hooks. Deck's "no session scanner" is a choice about which
channel to read, not a limit of the CLI.

### 5.4 opencode (verified 2026-09-03 unless marked)

| Signal | Documented mechanism | Source |
| --- | --- | --- |
| server | `opencode serve [--port <number>] [--hostname <string>]`, default `127.0.0.1:4096`, OpenAPI 3.1 at `/doc`; **the TUI itself starts this server on a random port**, pinned by the same two flags | [server docs](https://opencode.ai/docs/server/) |
| working / idle, exact | `GET /session/status` → `{ [sessionID]: SessionStatus }`; `SessionStatus` is `{ type: "idle" } \| { type: "retry", attempt, message, next } \| { type: "busy" }`; pushed as `session.status` / `session.idle` on the stream | same; [`types.gen.ts` (dev)](https://github.com/sst/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts) |
| event stream | `GET /event` (SSE, first event `server.connected`) and `GET /global/event`; event names include `session.created` / `updated` / `deleted` / `idle` / `status` / `error` / `compacted` / `diff`, `message.updated`, `message.part.updated`, `message.removed`, `permission.updated`, `permission.replied`, `todo.updated`, `file.edited`, `pty.*` | same |
| needs input, exact | `permission.updated` carries a `Permission`; the host answers with `POST /session/:id/permissions/:permissionID` `{ response, remember? }` | server docs |
| failed | `session.error` event | `types.gen.ts` |
| identity, cwd, session | `Session` = `{ id, projectID, directory, parentID?, title, version, time: { created, updated, compacting? }, … }` via `GET /session`, `GET /session/:id` | `types.gen.ts` |
| last message | `GET /session/:id/message?limit=` | server docs |
| storage | `opencode.db` / `storage/` are **not documented on the pages fetched**; Deck's SQLite reader rests on the 2026-08-17 discovery alone | — |
| plugin hooks | a plugin in `.opencode/plugins/` or `~/.config/opencode/plugins/` exports `event: async ({ event }) => …` and sees `session.idle`, `session.error`, `session.status`, `permission.asked`, `permission.replied`, `message.updated`, `message.part.updated`, `tool.execute.before` / `after`; the docs' own example fires a desktop notification on `session.idle` | [plugins](https://opencode.ai/docs/plugins/) |
| terminal notifications | the TUI's `attention` feature: `question.asked` / `permission.asked` / busy → idle / `session.error` request a desktop notification and a sound. **Gated on focus** — [`focusSkip`](https://github.com/anomalyco/opencode/blob/dev/packages/tui/src/attention.ts) skips with `"focus_unknown"` until the renderer has seen a focus or blur event, and notifications default to `when: "blurred"`; so a terminal that never answers focus reporting gets **no** notification, ever. **Reported:** `attention.enabled` "Defaults to false"; the wire form is chosen by OpenTUI — OSC 99 / 777 / 9 by terminal detection or `OPENTUI_NOTIFICATION_PROTOCOL`; there is no BEL path (a PR adding one was closed unmerged) | [tui docs](https://opencode.ai/docs/tui/), [OpenTUI notifications](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/notifications.mdx) (reported) |
| naming drift | the plugin docs name the event `permission.asked`; the generated SDK types name it `permission.updated` — both fetched by this session, and they disagree | plugins page vs `types.gen.ts` |

**Consequence.** opencode is the one agent whose TUI is already a client of a local server
that answers `busy` / `idle` / `permission` **per session id** — tier C, and it needs
nothing from the transcript. The cost is the port: launched bare it is random; launched
`opencode --port <n>` it is known.

### 5.5 cursor-agent (verified 2026-09-03)

| Signal | Documented mechanism | Source |
| --- | --- | --- |
| resume | `--resume [chatId]` ("Resume a chat session"), `--continue` ("alias for `--resume=-1`"), subcommands `ls` and `resume` | [CLI parameters](https://cursor.com/docs/cli/reference/parameters) |
| machine-readable | `-p, --print` with `--output-format text \| json \| stream-json` | same |
| launch flag Deck ships | `-f, --force` ("Force allow commands unless explicitly denied"), `--yolo` alias | same |
| session store, notifications | **not on the page**. **Reported (community, Cursor staff, 2026-07-13):** CLI sessions live in `~/.cursor/chats` and `~/.cursor/acp-sessions/<id>/store.db`, and "There is no common stable session id" between IDE and CLI | [forum](https://forum.cursor.com/t/local-ide-agent-chats-and-the-agent-cli-still-use-separate-session-stores/165486) (reported) |
| hooks | **reported:** `hooks.json` with `stop` (`status` `completed \| aborted \| error`), `sessionStart` (`session_id`), `beforeShellExecution` …; the docs say only `workspaceOpen` "Runs in the Cursor desktop app and CLI", and staff describe CLI hook support as partial (`beforeShellExecution`, `afterShellExecution`, `afterFileEdit`, `postToolUse`, `stop`, `sessionStart` as of 2026-04) | [hooks](https://cursor.com/docs/hooks.md), [forum](https://forum.cursor.com/t/cursor-cli-doesnt-send-all-events-defined-in-hooks/148316) (reported) |
| tokens / cost | **reported:** none — stream-json carries only `duration_ms` / `duration_api_ms` | [output-format](https://cursor.com/docs/cli/reference/output-format) (reported) |

Deck's `COMMAND_TABLE` forms for `cursor-agent` match the documented flags; nothing reaches
them today because of §4.1.

### 5.6 Antigravity (`agy`) — partly verified 2026-09-03

| Signal | Mechanism | Source |
| --- | --- | --- |
| resume | `agy -c` / `agy --continue` and a Session Picker overlay, sessions "scoped … to your current working directory" | [official conversations page](https://antigravity.google/docs/cli/conversations/) |
| resume by id | `--conversation <id>` — quoted from `agy --help` in third-party guides, and printed by the CLI itself at exit ("Resume: `agy --conversation=<uuid>` (or `-c`)"); **not on the official page fetched** — `UNVERIFIED (third-party)` | [DEV Community](https://dev.to/arindam_1729/antigravity-cli-a-hands-on-guide-to-googles-terminal-coding-agent-5bc7), [Medium](https://medium.com/google-cloud/antigravity-cli-tutorial-series-part-2-conversations-conversations-and-conversations-76f61756d5bb) |
| **state, pushed** | the status line script receives JSON on stdin "whenever the agent state changes": `agent_state` ∈ `"idle"`, `"thinking"`, `"working"`, `"tool_use"`, `"initializing"`; `tool_confirmation_pending` ("True when a tool confirmation dialog is showing"); `pending_input_count`; `task_count`; `execution_mode`; `conversation_id` (`session_id` is its alias); `model.id` / `display_name`; `cwd`, `workspace.current_dir` / `project_dir`; `context_window.*`; `transcript_path` (optional). The only agent in this audit whose documented push includes a working / thinking / tool-use distinction AND a waiting flag | [statusline](https://antigravity.google/docs/cli/statusline/) |
| terminal title, notifications | **reported:** a `title` script in `settings.json` drives the terminal title on the same payload; `notifications: on \| off` "Emits system desktop and terminal bell chime notifications upon task completions" — completion only, sequence unstated | [title](https://antigravity.google/docs/cli/title/), [settings](https://antigravity.google/docs/cli/settings/) (reported) |
| store, as documented | the data root is `~/.gemini/antigravity-cli/`; **reported:** the hooks page places the transcript there (`transcript.jsonl`), and "most recent" for `-c` is read from `~/.gemini/antigravity-cli/cache/last_conversations.json`, "a JSON map associating absolute workspace directory paths with their most recently active conversation ID". **The `.pb` blobs Deck reads appear in no document fetched** | [settings](https://antigravity.google/docs/cli/settings/), [resume](https://antigravity.google/docs/cli/commands/resume) (reported) |
| store, as found on this machine | `~/.gemini/antigravity/conversations/<uuid>.pb` (31 files, what Deck scans) **plus an index the CLI keeps** at `~/.gemini/antigravity-cli/cache/conversation_metadata.json` (`ID`, `Preview`, `NumSteps`, `UpdatedAt`, `WorkspaceURIs: ["file:///…"]`, `AppDataDir`, `AgentName`) and `~/.gemini/antigravity-cli/conversation_summaries.db` (`conversation_id`, `workspace_uris`, `status`, `not_fully_idle`, `last_user_input_time`, `parent_conversation_id`, `agent_name`, `app_data_dir`). Index ↔ `.pb` agree 31/31 | local read, 2026-09-03 |
| caveat | every indexed conversation on this machine has `AppDataDir: "antigravity"` (the IDE) and the newest is 2026-03-02; the CLI itself, installed 2026-08-15, has written **no** conversation here, so whether `agy` writes into the same `.pb` directory is `UNVERIFIED` | local read |

**Consequence.** Deck matches an `agy` pane to a conversation by searching 512 KiB of
protobuf for the cwd string (§2.3). The CLI keeps a JSON and a SQLite index beside it with
the cwd as a `file://` URI, the update time, a parent id (sub-conversations) and a
`not_fully_idle` flag. Still tier R, but structured — and it would give the rail an agy
sentence (`Preview`) where today it has none.

## 6. How peer apps read the same signals

Read from source on 2026-09-03 unless marked; READMEs and landing pages in this category
say nothing about mechanism, so every mechanism line below points at a file.

### 6.1 Claude Squad (`smtg-ai/claude-squad`) — PTY, like Deck

- **Transport:** one tmux session per instance, one git worktree per instance; agents are
  whatever command the user names (`claude`, `codex`, `aider`, `gemini`).
- **State:** `Status` is `Running` ("claude is working"), `Ready`, `Loading`, `Paused`
  ([`session/instance.go`](https://github.com/smtg-ai/claude-squad/blob/main/session/instance.go)).
  `HasUpdated()` runs `tmux capture-pane -p -e -J`, hashes the screen, and reports
  `updated` when the hash moved and `hasPrompt` when the screen contains one of three
  literal strings — Claude `"No, and tell Claude what to do differently"`, Aider
  `"(Y)es/(N)o/(D)on't ask again"`, Gemini `"Yes, allow once"`
  ([`session/tmux/tmux.go`](https://github.com/smtg-ai/claude-squad/blob/main/session/tmux/tmux.go)).
  A separate check looks for `"Do you trust the files in this folder?"`.
- **Trust class:** pure H — screen-diff for working, prompt-string matching for waiting. It
  is Deck's sustained-output fallback with a prompt grammar bolted on, and it breaks the day
  a CLI rewords its prompt. No session id, no last message.

### 6.2 Crystal (`stravu/crystal`) — headless stream, not a terminal

- **Transport:** spawns `claude --verbose --output-format stream-json [-p prompt]
  [--resume <id>] [--model …]` under node-pty and parses every line as JSON; Codex is
  driven the same way ("similar to Claude's stream-json mode")
  ([`claudeCodeManager.ts`](https://github.com/stravu/crystal/blob/main/main/src/services/panels/claude/claudeCodeManager.ts),
  [`codexManager.ts`](https://github.com/stravu/crystal/blob/main/main/src/services/panels/codex/codexManager.ts)).
- **State and identity:** the manager parses `type: "system", subtype: "init"` and
  `assistant` lines; end-of-run and exit handling live in its base class, which was not
  read, so "the `result` line closes the run" is the stream-json shape, not a quoted line.
  The session id is stored per panel and passed back as `--resume`.
- **Permissions:** default `--dangerously-skip-permissions`; in "approve" mode Claude is
  launched with `--permission-prompt-tool mcp__crystal-permissions__approve_permission`
  against a local MCP bridge, so **the permission request arrives as a structured call**, not
  as a screen to read.
- **Trust class:** C throughout — but the user never types into Claude's own TUI. The
  README now redirects to a successor product; the mechanism is still the reference case for
  "read the stream, not the screen".

### 6.3 Vibe Kanban (`BloopAI/vibe-kanban`) — one executor per CLI, all structured

- **Transport:** Claude via `-p … --verbose --output-format=stream-json
  --input-format=stream-json --include-partial-messages --replay-user-messages`, with
  `--permission-prompt-tool=stdio` for approvals and `--resume <id>` for follow-ups
  ([`executors/claude.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/claude.rs));
  Cursor via `-p --output-format=stream-json`; Droid and Amp likewise; **Codex through
  `codex app-server`** over JSON-RPC with a bespoke client "because the codex-app-server
  client must handle server-initiated" requests
  ([`executors/codex.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/executors/src/executors/codex.rs),
  `codex/jsonrpc.rs`).
- **State, identity, last message:** `extract_session_id()` reads `session_id` off
  `assistant` / `user` / `tool_use` / `tool_result` / `result` lines; `ClaudeLogProcessor`
  normalises every line into typed entries (`AssistantMessage`, `ErrorMessage`,
  `TokenUsageInfo`); the `result` line's `is_error` and `subtype == "success"` decide the
  attempt's end state.
- **Trust class:** C. The cost is the same as Crystal's: the agent's own TUI is gone, and
  every CLI needs its own executor.

### 6.4 Agent Deck (`asheshgoplani/agent-deck`) — TUI kept, hooks first, tmux fallback

- **Transport (reported):** tmux plus hooks it installs itself — Claude `settings.json`
  hooks for `SessionStart`, `UserPromptSubmit`, `Stop`, `Notification` matched on
  `permission_prompt|elicitation_dialog`; Codex `notify = ["agent-deck", "codex-notify"]`
  ([`claude_hooks.go`](https://github.com/asheshgoplani/agent-deck/blob/main/internal/session/claude_hooks.go),
  [`codex_hooks_cmd.go`](https://github.com/asheshgoplani/agent-deck/blob/main/cmd/agent-deck/codex_hooks_cmd.go)).
- **State (reported):** the hook handler writes `{status, session_id, event, ts}` per
  instance; `UserPromptSubmit` → running, `Stop` / `PermissionRequest` / `PostToolUse` →
  waiting, `Notification` changes nothing unless its matcher is a permission or elicitation
  prompt; the file is trusted only inside a freshness window (2 min; 20 s for a running
  Codex) and then the app falls back to tmux polling; a Claude `Stop` is not "done" while
  background work is pending
  ([`sessionstatus.go`](https://github.com/asheshgoplani/agent-deck/blob/main/internal/sessionstatus/sessionstatus.go)).
- **Identity (verified):** its own
  [`session-id-lifecycle.md`](https://github.com/asheshgoplani/agent-deck/blob/main/docs/session-id-lifecycle.md)
  states invariant 1 as "Disk scans are non-authoritative for identity binding": an id binds
  only from a tmux `*_SESSION_ID` env, a hook `session_id`, or a sidecar anchor file.
- **Trust class:** C first, H as fallback — the only hybrid in the sample, and the one
  closest to what Deck already has half of.

### 6.5 CCManager (`kbwo/ccmanager`) — TUI kept, regex over the screen

- **Reported:** own PTY into `@xterm/headless`; every 100 ms a per-agent regex runs over
  the last 30 screen lines — Claude `do you want|would you like … yes|❯`, `esc to cancel` →
  waiting; `esc to interrupt`, a spinner glyph, the token-stats line → busy; idle after a
  1 500 ms debounce
  ([`stateDetector/claude.ts`](https://github.com/kbwo/ccmanager/blob/main/src/services/stateDetector/claude.ts)).
- **Its own failure record (reported):** issue #227 (closed 2026-03-13), "State detection
  shows idle when Claude Code is busy" — "recent versions of Claude Code no longer display
  `esc to interrupt`"; #117, #113, #84 are earlier "update state detection strategy"
  issues ([#227](https://github.com/kbwo/ccmanager/issues/227)).
- **Trust class:** H, and the clearest evidence of what H costs over time.

### 6.6 The hook camp — Orca, Emdash, Superset, cmux, Warp (reported unless marked)

- **Orca** (`stablyai/orca`, the product the inbox spec names): node-pty + xterm, agents
  run interactively; managed Claude hooks for `SessionStart`, `UserPromptSubmit`, `Stop`,
  `StopFailure` ("without this hook Orca leaves the turn spinning"), `SubagentStart/Stop`,
  `TeammateIdle`, `PreToolUse`, `PostToolUse(Failure)`, `PermissionRequest`, `PostCompact`
  ("a manual /compact ends at an idle prompt without emitting Stop"); scripts POST to a
  loopback port with the pane identity in an env var, spooling to a file when the endpoint
  is unreachable; a second channel parses a private `OSC 9999` from the PTY; states
  `working | blocked | waiting | done`; a Claude status-line script forwards `rate_limits`
  ([`hook-settings.ts`](https://github.com/stablyai/orca/blob/main/src/main/claude/hook-settings.ts),
  [`agent-status-osc.ts`](https://github.com/stablyai/orca/blob/main/src/shared/agent-status-osc.ts)).
  Issues: #14018 stuck "working" when re-minted panes never reach the pipeline; #15791
  payloads ≥ ~1 MB dropped silently.
- **Emdash** (`generalaction/emdash`): node-pty + a loopback hook server; start →
  `working`, stop → `completed`, error → `error`, notification → `awaiting-input` **only**
  for `permission_prompt` / `idle_prompt`
  ([`agent-state.ts`](https://github.com/generalaction/emdash/blob/main/packages/core/src/runtimes/tui-agents/node/runtime/agent-state.ts)).
- **Superset** (`superset-sh/superset`): PTY + hooks written into each CLI's **global**
  config at boot (Claude events incl. `StopFailure`, `PermissionRequest`; Codex
  `~/.codex/hooks.json`; an opencode plugin), collapsed to Start / PermissionRequest /
  Stop. Its own `HOOKS_INVESTIGATION.md` records hooks firing in non-Superset terminals;
  #6641 (open) a Codex subagent finishing "causes the orange light to go green" while the
  main agent still works
  ([`agent-wrappers`](https://github.com/superset-sh/superset/blob/main/packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts),
  [#6641](https://github.com/superset-sh/superset/issues/6641)).
- **cmux** (`manaflow-ai/cmux`, libghostty): status entirely from `cmux notify` hooks and
  OSC 9/99/777. **Verified:** issue #3749 (open, 2026-05-08), "Sidebar agent status is
  hook-only with no fallback — codex agents go silent when hooks miss": "The current
  architecture is **100% hook-driven with zero fallback**"; it proposes PID liveness,
  process-tree heuristics, OSC title hints, and reading the Notification `message` to
  split `idle_prompt` from a permission request
  ([#3749](https://github.com/manaflow-ai/cmux/issues/3749)).
- **Warp**: PTY terminal; a Claude plugin installs six hooks and sends JSON **over
  OSC 777** to the terminal; Codex via `notification_condition = "always"`; categories
  Complete / Request / Error
  ([plugin README](https://github.com/warpdotdev/claude-code-warp/blob/main/README.md)).

### 6.7 Headless daemons and closed products (reported)

- **HumanLayer / CodeLayer**: `claude --print --output-format stream-json` under a daemon;
  `waiting_input` set by an approval manager over MCP; README calls the code deprecated.
- **Conductor**: closed source; changelog names the Anthropic Agent SDK and an alternative
  Codex SDK plus a "Big Terminal Mode"; state mechanism undocumented.

### 6.8 What the category tells Deck

| App | Keeps the agent's own TUI? | Working / waiting from | Session id from | Tier |
| --- | --- | --- | --- | --- |
| Deck | yes | OSC 9;4 (Claude, macOS) / output timing; BEL (Codex, unfocused) | transcript mtime ranking, then pinned | C + R + H |
| Claude Squad | yes | screen hash / prompt strings | none | H |
| CCManager | yes | regex over the last 30 lines | none | H |
| Agent Deck | yes | hooks with freshness windows, tmux fallback | hook / tmux env, never disk | C → H |
| Orca | yes | hooks + private OSC, file spool | hook payload | C, two channels |
| Emdash · Superset · cmux · Warp | yes | hooks (Claude / Codex / opencode plugin) → loopback or OSC 777 | hook payload | C, hook-only |
| Crystal · Vibe Kanban · HumanLayer | no | stream-json `result`, app-server RPC, MCP approvals | stream lines | C |

- **No peer pairs a pane to a session by mtime.** Stream apps take the id from the event;
  hook apps take it from the payload; Agent Deck wrote "disk scans are non-authoritative"
  down as an invariant. Deck's §4.7 is alone in the category.
- **Screen-scraping is the approach whose maintainers report it breaking on every TUI
  change** (CCManager #227 and predecessors; Claude Squad's three literal strings). Deck's
  sustained-output heuristic is a cousin: it scrapes timing rather than text, which is why it
  survives rewording and fails on animation instead.
- **Hook-only is the approach whose maintainers report "wrong until restart"** — cmux
  #3749, Superset #3931/#6254/#6641, Orca #14018/#15791 — always "the hook did not fire or
  could not be attributed to a pane". The mitigations they built or proposed (freshness
  windows + tmux polling, a spool file + a second OSC channel, PID liveness) are the
  process-table + OSC layer Deck already runs.
- **`Stop` is not "done" and `Notification` is not "needs input" without its matcher.**
  Agent Deck holds `running` while background work is pending; Orca registers `StopFailure`,
  `SubagentStop`, `TeammateIdle`, `PostCompact` for the cases where `Stop` lies; Superset
  #6641 is a subagent `Stop` turning the light green; Agent Deck, Emdash and Warp all gate
  "needs input" on `permission_prompt` / `idle_prompt` / `elicitation_dialog`.
- **Nobody reads transcripts for live state.** Deck's tail / model / pairing channel has no
  peer; its nearest analogue is the prompt-string grammar, with the same failure shape (the
  CLI moves a file or a string, the host lies silently — opencode 1.18, 2026-08-17).

## 7. Recommendations — proposals for the fork queue, not decisions

Each touches something `AGENTS.md` lists as a fork (process classification, PTY env, IPC,
DL rules). None is made here.

1. **Add `cursor-agent` to both classification tables** (`classify.ts`, `info.rs`) with a
   test that walks `BUILTIN_AGENTS` and asserts every id classifies as `agent`. Smallest
   change, largest lie removed. Process classification is fork-listed.
2. **Render `confidence`.** The tracker already says explicit vs inferred per pane; the rail
   and the inbox should draw an inferred `asked`/`done` differently (a hollow mark, a
   different label) or state it in the accessible name. A DL rule.
3. **Give `failed` a producer — but only a CLI's own error event.** `StopFailure` (Claude),
   `turn.failed` / `turn/completed: failed` (Codex), `session.error` (opencode) latch
   `error`. A non-zero exit of the foreground agent is NOT `failed` on its own: it is also
   what Ctrl-C, a deliberate `/exit` under a wrapper and a killed pane look like (§9,
   Codex's objection). Carry the exit status into `noteExit` as a distinct
   _ended unexpectedly_ state instead of folding it into `asked`. PTY ownership and the
   tracker are fork-listed.
4. **Close the blind window.** When `launchTask` or restore types a command, poll once as the
   launcher fires and again ~1 s later, or have the gate replay the activity module's
   current snapshot on open. Tab materialization is fork-listed.
5. **Poll `claude agents --json` beside `pty_info`.** One process per poll answers, for
   every live Claude session, `pid` → `sessionId` → `cwd` → `status` / `waitingFor`. Joined
   on the pane's foreground pid Deck already has, that is an exact pairing (§4.7 gone for
   Claude), a documented `requested` for `permission prompt` / `input needed` (§4.2), and
   `--resume` ids that never came from a file — with no hook install, no settings change and
   no new channel into the CLI. Cost: one child process per tick, the same shape as
   `lsof`; `status` values other than `waiting` are undocumented. Process classification /
   PTY are fork-listed. **This is the highest-value single change in the report.**
6. **Take Claude's hooks for what the registry cannot say.** A Deck-owned hook set delivered
   through a launch-time `--settings` override (a file under `userData`) posting
   `Stop` / `StopFailure` / `SessionEnd` gives `last_assistant_message` at Stop (§4.6) and a
   true `failed` (§4.3). Two lessons from §6 travel with it: keep the process/OSC layer as
   the fallback (cmux #3749), and do not read `Stop` as done or `Notification` as
   needs-input without its matcher (Superset #6641, Emdash). The cheapest variant needs no
   socket at all: a hook returning `terminalSequence` makes Claude emit an OSC 777 that the
   existing pane handler already turns into `requested` (§5.1) — Warp's design, on Deck's
   current seams. Launch profile / PTY env are fork-listed.
7. **Re-ask the tail once after idle.** Until #6 exists, a second `session_tail` request
   ~2 s after a working → idle transition covers the documented write lag for all three
   R-tier agents at the cost of one bounded read.
8. **Send the pane's cwd, not the tab's,** in the tail/resume request — `pane_info`
   already has it. Removes one whole class of "no tail in a worktree pane".
9. **Say what is Electron-only.** Tauri panes have no tail, model or pairing; the inbox
   mockup should not draw them for Tauri.
10. **Read Antigravity's index instead of its protobuf** (`conversation_metadata.json` /
    `conversation_summaries.db`, §5.6): exact cwd, exact recency, parent-id exclusion and a
    `Preview` sentence, for one JSON read. Still tier R; no fork category beyond the scanner.
    Better: ship a status-line script for `agy`, whose `agent_state` and
    `tool_confirmation_pending` are the richest documented push in this audit (§5.6).
11. **For opencode, pin the port and answer its focus query.** `opencode --port <n>` (§5.4)
    makes `GET /session/status` and the `/event` stream reachable per pane — tier C
    `busy` / `idle` and `permission.*` with no transcript at all. Its terminal
    notifications, and Codex's, are gated on focus reporting (§5.2, §5.4), so the PTY must
    answer DECSET 1004 — live check #8 says whether it does; `OPENTUI_NOTIFICATION_PROTOCOL`
    in the spawn env picks the OSC form Deck already parses. Launch profile / PTY env are
    fork-listed.
12. **Gemini: turn on what exists.** `general.enableNotifications` sends OSC 9 with a BEL
    fall-back for "Action required" and "Session complete" (§5.3) — both land on Deck's
    existing handlers; the choice is whether Deck sets it for the user.

## 8. Live-run checklist for the `electron:dev` session

The report above is static. Each line is one thing to watch, with the branch that decides a
finding. Run on macOS; note which Claude Code / Codex / opencode versions were on the machine.

0. **Does OSC 9;4 still arrive at all?** Fresh `claude`, default settings, one short task.
   Does the row turn `working` within a second of Enter, and back within a second of the
   answer? The spoof's "verified empirically" in `spawn.ts` / `pty.rs` is undated, and the
   documented gate names products, not the `ConEmuANSI` variable. If the row moves only on
   the 3 s heuristic cadence, every Claude cell in §3 row 2 and row 4 is H, not C. (§4.4)
1. **Claude permission prompt, default settings.** Launch `claude` in a pane, ask for an
   edit outside the allow-list, do not answer. Watch the rail for ≥ 10 s. Record: does the
   row go `asked` or stay `working`? Does the OS notification say "finished"? (§4.2, §4.3)
2. **Claude with `preferredNotifChannel: terminal_bell`.** Same prompt. Does a BEL arrive
   and does the row go `asked` within ~6 s of the prompt? (§4.2)
3. **Claude with `terminalProgressBarEnabled: false`.** Run one task. Does the row still
   turn `working`, and when? Is the OS notification for completion the same? (§4.4)
4. **Kill Claude mid-task** (`kill -9` its pid from another pane). What does the row say
   after the next poll: `asked`, `done`, `idle`? (§4.3)
5. **Startup race, two halves.** (a) `launchTask` a prompt into a fresh Claude pane ten
   times: how often is the prompt pasted, and how often does the launch end
   `prompt-not-sent` with Claude visibly at its prompt? (b) Type `claude "say hi"` by hand
   in a fresh pane: does the row ever show `working`, and does it show `asked` when the
   answer lands? (§4.5)
6. **Sentence freshness.** After a Claude turn ends, compare the rail sentence with the
   transcript's last assistant text at +0 s, +2 s, +10 s. Does the rail ever catch up
   without a further state change? (§4.6)
7. **Two Claude panes, one checkout, started 30 s apart.** Do the two sentences stay on
   their own rows across ten turns? Now start a third in a sub-directory of the same
   checkout: does it ever get a sentence? (§4.7)
8. **Codex approval prompt, focused and unfocused.** Trigger an approval with the Codex pane
   focused: does the row change? Then click into another pane before the prompt appears:
   does a BEL arrive and the row go `asked` at once? Then let a turn COMPLETE while
   unfocused: does that BEL also read as `asked`, and what does the OS notification say?
   Repeat the first case for opencode. (§4.8, §5.2)
9. **`cursor-agent` pane.** Confirm it draws no rail row and the pane header says `busy`.
   (§4.1)
10. **Gemini restore.** Close and reopen Deck with a `gemini` pane open; record the command
    typed and whether `gemini` accepts it. (§4.9)
11. **`claude agents --json` against Deck's panes.** With three Claude panes open (one
    waiting on a permission), run it from a fourth pane: does every pane appear with a
    `pid` that matches `pty_info`'s foreground pid, and does the waiting one carry
    `status: "waiting"` + `waitingFor: "permission prompt"`? How long does the command
    take? (§5.1, §7.5)
12. **Focus reporting.** In a Codex pane, and in an opencode pane with `attention.enabled`
    on, click into another pane and let a turn finish: does a BEL / OSC arrive? If neither
    ever does, the PTY is not answering DECSET 1004 and §7.11 needs that first. (§5.2, §5.4)

## 9. Second opinion — Codex CLI, 2026-09-03

On the owner's ask, `codex exec` (codex-cli 0.153.0, read-only sandbox, `-C` this repo)
was given §0–§7 of this report and the six candidate directions (A poll
`claude agents --json`; B launch-scoped hook injection; C global injection; D opt-in; E
headless stream; F other) and asked for a decision memo. Its answer, verbatim:

> ## Decision memo
>
> 1. **Recommendation: staged A → launch-scoped contract adapters (a refined B/F).**
>
>    First, make the UI honest: distinguish `explicit`, `inferred`, and `unknown`; fix Cursor
>    classification and the startup blind window; stop presenting heuristic completion as
>    "asked."
>
>    Then ship A for Claude: reconcile `claude agents --json` with each pane's foreground
>    PID. After that, add per-pane adapters:
>
>    - Claude, Codex, Gemini: launch-scoped hooks.
>    - opencode: pinned local port plus `/event` SSE.
>    - Antigravity: status-line integration.
>    - Unsupported/custom agents: clearly marked `inferred` state from `ps`/OSC/output
>      timing.
>
>    Keep the real TUIs and retain `ps`/OSC as freshness-bounded fallback. Reject C, D,
>    and E.
>
> 2. **Three strongest reasons**
>
>    1. **Structured identity must originate inside the process.** Deck currently pairs
>       sessions by cwd, mtime, and proximity, then permanently pins the first guess. The
>       report found no peer using mtime this way. Claude's registry and hook payloads,
>       Codex/Gemini hooks, opencode events, and Antigravity's status line all provide exact
>       session identity.
>    2. **Launch-scoped integration has the right ownership boundary.** Superset's global
>       hooks fire in terminals Superset does not own (§6.6). That is unacceptable for
>       Deck: global mutation creates surprising behavior, uninstall debt, and cross-app
>       attribution bugs. Opt-in setup avoids mutation but guarantees uneven coverage — the
>       sidebar cannot claim trustworthiness when users may have skipped setup.
>    3. **Deck's product is the interactive TUI.** Headless streams provide excellent
>       contracts but destroy the feature Deck is built around. Orca and Agent Deck
>       demonstrate that structured hooks plus a PTY fallback can preserve both. This also
>       matches Deck's established "terminal cockpit" direction.
>
> 3. **Disagreement with the report**
>
>    I disagree with §0 calling `ps` classification and Deck's Claude OSC path tier C
>    without qualification. The OS process record is contractual; translating argv into
>    "this is an agent" is Deck-maintained inference — `cursor-agent` being omitted proves
>    it. Likewise, impersonating ConEmu to induce OSC 9;4 is interoperability, not a
>    supported Deck contract.
>
>    I also would not implement §7.3 literally. A non-zero foreground-process exit does not
>    necessarily mean "failed"; it may be interruption, deliberate cancellation, or wrapper
>    behavior. Only `StopFailure`, `session.error`, `turn.failed`, or an equivalent CLI
>    event should produce **failed**. An unexplained process death should be **ended
>    unexpectedly**, not confidently failed.
>
>    Finally, `claude agents --json` is the best first increment, but not the highest-value
>    strategy: it improves only Claude and does not provide the final assistant sentence or
>    reliable failure semantics.
>
> 4. **Two biggest risks**
>
>    - **Dropped or reordered events leave stale state.** Bound this with sequence numbers,
>      timestamps, PID/session validation, per-source freshness deadlines, periodic
>      reconciliation, and automatic fallback to `ps`/OSC. Never let an old hook event
>      overwrite a newer process generation.
>    - **Configuration and local-endpoint hazards.** Use per-launch overlays without editing
>      user files. Bind to loopback, require an unguessable per-pane token, cap payload
>      size, reject unknown pane/session pairs, and make hook failures non-blocking. Do not
>      replace `CODEX_HOME` unless authentication, sessions, and user configuration remain
>      intact.
>
> 5. **Verify first**
>
>    Run three Claude panes — including two in the same cwd and one waiting for permission —
>    and repeatedly compare `claude agents --json` PIDs against Deck's `pty_info`. Measure
>    detection latency, restart behavior, and whether `waitingFor` clears correctly. If that
>    mapping is not exact and stable, stop: the proposed foundation is unsound.
>
> TL;DR: Preserve the TUIs, obtain truth from launch-scoped first-party event channels, and
> display heuristics honestly only as fallback.

**Reconciliation with this report.** Three of Codex's points are accepted and folded in:
the tier table in §0 now names the two Deck-maintained steps inside its C rows; §7.3 no
longer turns a non-zero exit into `failed`; and its ordering — honest UI first (§7.1,
§7.2), then the Claude registry (§7.5), then per-pane adapters (§7.6, §7.10, §7.11,
§7.12), with `ps`/OSC kept as a freshness-bounded fallback — is the same staging §7 lists,
now with the reason for the order stated. One nuance stands: `claude agents --json` is the
highest-value **single change** because it needs no injection and closes two findings at
once, and Codex's own "verify first" is live check #11; it is not the whole strategy, and
§7 never said it was. Its two risk bounds (freshness deadlines and generation checks on
hook events; loopback + per-pane token + payload cap, never `CODEX_HOME` replacement)
belong in the spec that follows this report, not here.

## 10. Prior documents this builds on

- [2026-08-16 agent status rail design](../specs/2026-08-16-agent-status-rail-design.md) —
  the state vocabulary and the `completed` → `asked` fold (§3, §4.6).
- [2026-08-17 session-tail parsing](2026-08-17-session-tail-parsing.md) — the only corpus
  measurements behind the tail parsers; still the source for the `isSidechain` / `<`-prefix
  rules.
- [2026-08-22 rail tail pane pairing plan](../plans/2026-08-22-rail-tail-pane-pairing.md) —
  pinning, the two-pass allocation, and the four limits restated in §4.7.
- [2026-07-23 agent attention rail plan](../plans/2026-07-23-agent-attention-rail.md) — the
  tracker's gate and latch model.
- [2026-09-02 agent inbox redesign](../specs/2026-09-02-agent-inbox-redesign-design.md) —
  the surface this audit exists for.
