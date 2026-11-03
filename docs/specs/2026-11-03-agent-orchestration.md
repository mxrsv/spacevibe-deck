# Agent orchestration: the Deck CLI and the orchestrate skill

Date: 2026-11-03
Status: Draft for the owner's review. The direction was decided in chat on 2026-11-03 (stage 2 of
the Deck roadmap): a skill is the brain, a Deck CLI is the hands. Items 1–5 under
[Decisions](#decisions-owner-2026-11-03) are the owner's picks; items 6–14 are the defaults this
spec was written with, for the owner to accept or change when approving. Nothing is built yet.
Source: a scout of how reference apps and agent CLIs build orchestration (2026-11-03, report in
the session scratchpad `~/scratch/spacevibe-deck/orchestrator-scout-2026-11-03.md`); ideas only,
nothing copied.
Execution: [implementation plan](../plans/2026-11-03-agent-orchestration.md) (gitignored, primary
checkout only).
Baseline: written against local `main` `1657c55c` (27 commits ahead of `origin/main` `66e75f4e`).
Host: Electron on macOS and Linux. Windows gets no `deck` command in this scope: panes there have
no wrapper bin directory and no hook transport (`hooksSupported()` is false on `win32`).

## Purpose

Today nothing outside Deck's own renderer can act on Deck: the hook endpoint only receives an
agent's lifecycle events, and typing into a PTY goes through `write_pty` from the renderer. An
agent in a pane that wants to split work across other agents has to ask the user to open
worktrees and paste prompts by hand. This spec gives an agent running in a Deck pane a command,
`deck`, to create a worktree, open another agent in it, send that agent a prompt, read what it
printed, wait until it is idle or needs the user, and close it; and a guide, printed by the same
command, that tells a coordinating agent how to run several workers that way. Deck stays
read-only towards git except `git worktree add`, which it already runs.

## Decisions (owner, 2026-11-03)

Items 1–5 were decided in chat after the scout; 6–14 are the defaults the spec recommends.

1. **The brain is a skill, the hands are a CLI.** The coordinator is an ordinary agent (Claude
   Code, Codex or any CLI Deck runs) following a guide; Deck ships no coordinator process, no
   task scheduler and no DAG engine. Every reference app read puts the coordinator in an agent
   and keeps the app to bookkeeping.
   - Turned down: an orchestration engine inside Deck (a reference app's inbox-and-gate model);
     a built-in "Run" surface.
2. **State lives in the coordinator's context; results are text envelopes.** A worker ends its
   turn with a `DECK_WORKER_DONE` or `DECK_WORKER_BLOCKED` block in its own output; the
   coordinator keeps a task table in its context. No durable task store in Deck in this scope.
   - Turned down: structured JSON results over IPC; task IDs minted by Deck.
3. **`wait` is a real signal, not a poll of the screen.** `deck pane wait` resolves from the pane's
   agent phase and attention, the same hook-backed state the rail draws, so a coordinator can
   wait for "idle" or "needs you" instead of reading terminal snapshots on a timer, which the
   reference app that polls documents as unreliable.
4. **The user approves the breakdown before any worker starts, and orchestration is one level
   deep.** The guide makes the coordinator print its task table and wait for the user's go in
   its own pane; a worker never spawns workers.
5. **Deck never merges.** Workers work in their own worktree and branch; the user integrates.
   Deck's git writes stay `git worktree add`. A later round may take the reference app's
   durable `worker_done` with injected IDs and gates if envelopes prove too loose.
6. **Reach: `deck` exists only inside Deck panes**, written to the agent-shell bin directory with
   the wrappers, so a plain terminal never sees it and PATH outside Deck does not change.
   - Turned down: a global install (`npm i -g`, Homebrew); a `deck://` protocol.
7. **Transport: the hook endpoint's loopback listener gains `/control/v1/*` routes**, authenticated
   the way hooks are (pane id, per-pane token, the caller's tty), never through a proxy.
   - Turned down: a Unix socket or named pipe (a second transport to secure and test); MCP in
     this scope (a reference app offers both; the CLI is what its skill uses).
8. **The CLI is a shell shim**: `sh` plus `curl`, like the hook scripts; every decision and all
   formatting happen in main. No Node entry point, no new dependency, nothing to bundle.
9. **Scope of control: a coordinator acts on itself and on the panes it opened.** `pane list`
   shows every pane in its window; `send`, `read`, `wait` and `close` accept the caller's own
   pane (`read` and `wait` only) and panes the caller opened through `deck pane open`.
   - Turned down: any pane in the window (a worker could type into the user's pane); explicit
     adoption of a user-started pane (`--any`), kept as a later addition.
10. **The guide ships inside Deck and is read with `deck skill orchestrate`**, versioned with the
    app the way a reference app's `skills get` is. No file to install, nothing to drift.
    - Turned down: a repo-level skill file users copy into `~/.claude/skills/`.
11. **The phase reaches main as a mirror.** The renderer reports each pane's attention snapshot
    to main as it changes; `list` and `wait` answer from main's copy. A request to the renderer
    per call would make `wait` a poll again and depend on a live window.
12. **Opening, sending, reading and closing go main → renderer**, through the window that owns the
    caller's pane, and reuse the existing paths: materialization for open, `injectIntoPane`'s
    paste-then-gated-Enter for send, the pane serializer for read, the pane's close action for
    close. No second typing path.
13. **Gated by a release switch `agentControl`** (`src/lib/release-switches.ts`), off outside dev
    until the guide ships; main reads the same switch to provision the shim and mount the routes.
14. **Name: `deck`.** The bin directory is first on PATH inside panes, so a user's own `deck`
    binary would be shadowed there; accepted, with `svdeck` as the fallback if it bites.

## How the reference apps do it

Read on 2026-11-03 from their public documentation and one public skill file; details and
URLs in the scout report. Names stay out of this repository.

- **Reference app A** ships an orchestrate skill (about 190 lines) that a coordinator agent
  follows. It keeps a task table in the coordinator's context (task, dependencies, workspace,
  terminal, status, result), opens one workspace and branch per worker through the app's CLI,
  sends each worker a bounded prompt, polls `terminals read` in short passes, and ends each
  worker with a text envelope (`…_WORKER_DONE` with task, summary, files, checks, handoff;
  `…_WORKER_BLOCKED` with task, reason, needs). It states that the envelope is a prompt
  convention, not a durable event; that terminal presence says nothing about whether an agent
  is working; and that the app does not merge worker branches.
- **Reference app B** keeps the coordinator an agent too (its old `coordinator-start` command
  "performs no effects") and points it at `<app> skills get orchestration --full`. The app keeps
  bookkeeping: a run inbox, tasks with status and dependencies, a dispatch per attempt, a
  `worker_done` message sent exactly once with injected task and dispatch IDs, questions and
  decision gates, and a `check --wait` with heartbeats. Marked experimental.
- **Reference app C** (a terminal with cloud agents) makes the parent agent propose a breakdown
  that the user approves before children launch, keeps orchestration one level deep, and gives
  runs a `BLOCKED` state that means "waiting on the user".
- Across agent CLIs the coordinator is the normal agent with a spawn tool; results come back as a
  final message; one worktree per worker is the norm where parallel editing happens; the user
  merges.

Deck takes A's shape (skill, table, envelopes, no merge), C's approval gate and depth, and adds
the one thing Deck already has that A lacks: a hook-backed phase to wait on. B's durable IDs and
gates are the named next round.

## Requirements

### Reach

- **ORC1**: With the `agentControl` switch on, Deck writes an executable `deck` into the
  agent-shell bin directory at boot, beside the agent wrappers, with the same mode and atomic
  write. Panes whose shell gets the bootstrap (zsh, bash, fish) see it on PATH; other shells
  and Windows do not. Nothing is written when the switch is off.
- **ORC2**: Outside a Deck pane (no `DECK_PANE_ID`, `DECK_HOOK_TOKEN` or `DECK_HOOK_PORT`), every
  `deck` command prints one line saying it must run inside a Deck pane and exits 3. The same
  happens inside a pane whose wrapper removed those variables (a Codex daemon subcommand, or
  opencode with Signals off): the line names that case.
- **ORC3**: `deck --help` and `deck <command> --help` describe every command and flag below.
  Usage errors exit 2. `--json` on any command switches the output to one JSON object; without
  it the output is short text for a human reading the pane.

### Identity and authorization

- **ORC4**: Every request carries the pane id, the pane token and the tty of the agent process
  that runs the shim (`DECK_AGENT_PID` when the wrapper set it, else the shim's parent). Main
  accepts a request only when the token matches that pane's token in constant time **and** the
  reported tty is that pane's tty. "No such pane", "wrong token" and "wrong tty" get the same
  403, as hooks do.
- **ORC5**: The listener stays `127.0.0.1` on the OS-chosen hook port; the shim calls it with
  `--noproxy '*'` and a bounded timeout; bodies are capped like hook posts. A control route
  refuses anything but POST; arguments travel as a form-encoded body (`curl --data-urlencode`,
  so the shim never builds JSON in `sh`), and `json=1` selects a JSON reply.
- **ORC6**: Main records, for every pane opened through `deck pane open`, the pane that opened it.
  `send`, `read`, `wait` and `close` are allowed on the caller's own pane (`read` and `wait`
  only) and on panes the caller opened; any other target is refused with the same answer as a
  missing pane. The record dies with either pane.
- **ORC7**: A pane cannot close itself through `deck`, and `send` never targets the caller's own
  pane.

### Commands

- **ORC8 `deck status`**: the app version, the caller's pane id and window, the switch state, and
  whether the caller may open panes (it is an agent pane with a known agent).
- **ORC9 `deck worktree create --repo <path> --branch <name> [--dest <path>]`**: runs the existing
  `addWorktree` (`git worktree add <dest> -b <branch>`, 60 s, never `-B` or `--force`). `--dest`
  defaults to the repository's parent directory joined with the branch name, `/` replaced by
  `-`. Prints the path; errors use the existing closed error codes. No setup step runs.
- **ORC10 `deck pane list`**: every pane in the caller's window: id, agent id or `shell`, phase,
  attention, confidence, cwd, and whether the caller opened it. Phase and attention come from
  main's mirror (ORC17); a pane with no mirror yet reads `unknown`.
- **ORC11 `deck pane open --cwd <path> --agent <id> [--prompt <text>] [--name <label>]`**: opens a
  new tab in the caller's window at `cwd` with that agent through the materialize seam, as the
  Open board does for a workspace with an agent (fresh shell, launch command typed once the
  shell is ready), names the tab when asked, and returns the new pane id once the PTY exists.
  `--prompt` is delivered as ORC12 after the agent reads idle for the first time. `cwd` must be
  an existing directory; `agent` must be an enabled, discovered agent. Opening fails closed
  when the window is gone.
- **ORC12 `deck pane send <id> [--no-submit] (<text> | --stdin)`**: pastes the text through the
  pane's existing paste path and, unless `--no-submit`, sends Enter 500 ms later only if the
  pane still runs the same agent process, reads idle, and raised no new attention since the
  paste: the diff-comment delivery gate, unchanged. Terminal controls and escape sequences are
  stripped first. Sends to one pane are serialized. The reply says `sent`, `pasted` or the
  refusal.
- **ORC13 `deck pane read <id> [--lines <n>] [--envelope]`**: the last `n` lines (default 200,
  max 2000) of the pane's scrollback as plain text, ANSI stripped, from the renderer's
  serializer. `--envelope` instead returns the last complete envelope (ORC21) as JSON, or
  `none`.
- **ORC14 `deck pane wait <id> --for idle|needs-you|exited|turn [--timeout <s>]`**: blocks until
  the pane's mirrored state reaches the target, then prints the state (phase, attention,
  confidence) and exits 0; exits 124 at the timeout (default 600 s, max 3600). `idle` is phase
  `idle` or `exited` with no `requested`, `warning` or `error` attention; `needs-you` is
  attention `requested`, `warning` or `error`, or phase `exited`; `exited` is phase `exited`;
  `turn` is any of the three, the worker's turn ended one way or another, which is what the
  guide waits for (a clean completion reads `idle` with a `completed` latch, not `needs-you`).
  The shim re-issues bounded requests until main answers, so no single HTTP call waits longer
  than 60 s.
- **ORC15**: After `deck pane send` to a pane, a `wait --for idle` on that pane does not resolve on
  the idle that preceded the send: it resolves once the pane has been `working` since the send,
  or when 5 s pass without any phase change (the agent took no turn), in which case the reply
  says so.
- **ORC16 `deck pane close <id> [--force]`**: closes a pane the caller opened, through the pane's
  normal close action. A pane whose agent is `working` or whose attention is `requested` is
  refused without `--force`; with it, the close proceeds without a census prompt for that pane.
  Never closes the caller.

### The phase mirror

- **ORC17**: The renderer reports a pane's attention snapshot (phase, attention, source,
  confidence, agent id, agent pid) to main whenever it changes, through one flat IPC command
  (R6). Main keeps the latest per pane and drops it when the PTY ends. The mirror is the single
  source for ORC10 and ORC14; main never classifies phase itself.
- **ORC18**: A mirror older than 120 s with phase `working` is reported with confidence
  `inferred`, mirroring the rail's hollowing, so a coordinator can tell a stale "working" from a
  live one.

### The orchestrate guide

- **ORC19 `deck skill orchestrate`**: prints the guide, versioned with the app. It is a complete
  brief a coordinator can follow with no other document: (1) check the control surface with
  `deck status`; (2) split the work into tasks with explicit dependencies, each small enough for
  one worker turn, and print the task table (task id, dependencies, worktree, pane, status
  `pending|ready|running|completed|blocked|failed`, result); (3) stop and wait for the user's
  go in the coordinator's own pane before opening anything; (4) one worktree and one worker per
  task, opened with `deck worktree create` then `deck pane open`; (5) the worker brief fields:
  task id, objective, the files it may change, acceptance criteria and the commands that verify
  them, prior findings it needs, a warning not to broaden scope or touch other files, the
  reminder that the coordinator sees only its final output, and the envelope to end with;
  (6) the loop: `wait --for turn` on every running worker, `read --envelope`, mark the table,
  promote tasks whose dependencies completed, redispatch a failed task only after changing the
  brief, and read a pane whose `working` is older than 120 s (confidence `inferred`) instead of
  trusting it; (7) a `BLOCKED` envelope or a `requested` attention goes to the user, never
  answered by the coordinator on its own; (8) verify a `DONE` envelope's checks before marking
  it completed, and report worker claims separately from checks the coordinator ran; (9) Deck
  does not merge: hand the user the list of branches; close workers only when asked.
- **ORC20**: The guide tells the coordinator to pass the repository's own `AGENTS.md` rules into
  every brief, and names no product other than Deck.

### Envelopes

- **ORC21**: A worker's final output ends with exactly one of:

  ```text
  DECK_WORKER_DONE
  task: <task id>
  summary: <one line>
  files: <comma-separated paths or none>
  checks: <commands and outcomes>
  handoff: <next-step context or none>
  ```

  ```text
  DECK_WORKER_BLOCKED
  task: <task id>
  reason: <one line>
  needs: <decision, access or dependency>
  ```

  `read --envelope` returns the last complete block whose header is a line of its own, after
  the gutter a TUI draws in front of output (`⏺ `, `│ `, `> `, indentation) is ignored; a block
  whose `task` is a placeholder such as `<task id>` (the brief's template echoed on screen) is
  skipped; a block with a missing field, or none at all, is `none`. The parser lives in main and
  has unit tests for both blocks, a truncated block, two blocks (the last wins), a header inside
  a longer word, a decorated block and an echoed template.

### Safety

- **ORC22**: Nothing in this scope stages, commits, pushes, opens a PR, removes a worktree or
  runs a command from a repository file. The only git write is ORC9.
- **ORC23**: `send` and `open --prompt` never type into a pane that is not an agent pane or whose
  agent process changed since the request was gated (the existing `stale` outcome).
- **ORC24**: A refused or malformed request is logged by main with the pane id and reason, never
  with the token.

### Documentation

- **ORC25**: A user guide `docs/user/orchestration.md` describes the flow in the product's voice
  (what to type in the coordinator pane, what the user approves, what happens in the rail),
  with its `vi` translation stamped; `CHANGELOG.md` gains the entry when the switch flips;
  `docs/internals/terminal.md` gains a short "control layer" paragraph beside the contract layer
  (the mirror, the authorization, the one typing path).

## Acceptance

- Unit tests in main: ORC4 (token, tty, unknown pane → one 403), ORC5 (method, body cap),
  ORC6–7 (scope, self-close refused), ORC9 (dest default, error codes pass through), ORC14–15
  (each target, timeout, the post-send rule), ORC17–18 (mirror update, drop on exit, hollowing),
  ORC21 (the parser cases). The shim's argument parsing has a test that runs it under `sh` with a
  stub `curl`.
- Contract tests: the new command channels and the main → renderer command event are pinned in
  `scripts/electron-ipc-contract.test.ts` and `electron/wire-contract.test.ts`.
- Renderer tests: the command handler opens a tab through the materialize seam and reports the
  pane id; send goes through `injectIntoPane` with the process gate; read uses the serializer;
  close refuses a working pane without `--force`.
- Provisioning test: the shim is written with the wrappers when the switch is on and absent when
  off; `deck` outside a pane exits 3.
- Owner's walk, in the running app, as the final task: in a Claude Code pane, `deck skill
  orchestrate`; the coordinator proposes two tasks; the owner says go; two Codex workers open in
  two worktrees; the coordinator waits, reads both envelopes and reports; the rail showed both
  workers; the owner closes them. No Playwright run unless the owner asks (owner, 2026-10-24).
- On request only: `test-deck-app` drives the same flow headless.

## Out of scope

An MCP server or SDK; Windows; calls from a terminal outside Deck; adopting panes the
coordinator did not open; nested orchestration; a run or task surface in the UI; durable task
IDs, gates and a `worker_done` event in Deck (the named next round); worktree setup scripts
(their own idea); reading an agent's transcript instead of the screen; closing or removing
worktrees; merge, push, PR; automations and schedules; cross-machine control.

## Open questions

- Whether `pane list` should include other windows (today: the caller's window only).
- Whether `open` should offer a split in the caller's tab instead of a new tab (today: tab only).
