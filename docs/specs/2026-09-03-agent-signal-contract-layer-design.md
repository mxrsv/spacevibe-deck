# The agent signal contract layer — design

Date: 2026-09-03
Status: `decided` — the DIRECTION is owner-decided ("let's go in that direction",
2026-09-03, after the [trust audit](../review/2026-09-03-agent-signal-trust-audit.md)
and the Codex second opinion in its §9), and the §1 fork table and the §10 defaults
were approved by "implement this spec, skip plan" the same day. **All four stages
were built on 2026-09-03 in one pass**, with no per-stage openspec proposal (the
owner's "skip plan"); what landed, where it departs from the text below, and what
evidence exists are recorded in
[docs/CONTEXT.md](../CONTEXT.md#the-rail-says-how-much-it-knows--2026-09-03)
`current`. Scope: how Deck learns an agent's state, session and last turn — four
stages; this document is the program-level design the code cites. Electron only;
Tauri keeps today's behaviour by inheritance (§8).

## 1. The change in one sentence, and the forks it opens

**Deck keeps the agents' real TUIs and stops guessing about them: it asks each CLI
through the channel that CLI documents, scoped to the pane Deck launched, and keeps the
process-table + OSC layer it already has as a freshness-bounded fallback that is drawn
as what it is — inferred.**

Every stage touches something `AGENTS.md` lists as a fork. Recorded here for approval,
not re-asked at build time:

| Stage | Fork category | What moves |
| --- | --- | --- |
| 0 | process classification | `cursor-agent` joins `AGENT_BY_BINARY` in `classify.ts` and `info.rs` |
| 0 | a rule in `docs/DESIGN-LANGUAGE.md` | DL-27.3 gains a confidence dimension (an inferred mark is drawn differently) and a sixth word, `ended` |
| 0 | R4 seam (tracker) | `PaneAttentionSnapshot` gains nothing new; `paneState` reads `confidence` it already has; `noteExit` learns the exit status |
| 0 | tab materialization | the launcher's arm path polls once when it fires (blind window, audit §4.5) |
| 1 | IPC | one new flat Electron-only channel, `agent_registry`, with a contract fixture (R6) |
| 1 | R4 seam (tracker, tail store) | `AttentionSource` gains `registry`; the tail request's `preferredId` may come from the registry |
| 2 | PTY env | `buildEnv` gains `DECK_PANE_ID` and `DECK_HOOK_TOKEN` per pane (the `ORCA_PANE_KEY` pattern) |
| 2 | launch profile / tab materialization | arm-time augmentation: Deck appends its own flags to the typed command, exempt from `commandProblem`, never stored in a preset or the journal |
| 2 | IPC-adjacent | a loopback HTTP endpoint in main for hook posts; a `hook_event` push channel to the renderer |
| 2 | settings schema | `agentSignalAdapters` (per-agent on/off, default on) — see §10 |
| 3 | R4 seam (tracker) | per-source freshness deadlines and generation checks |

NOT touched, in any stage: PTY ownership (spawn, kill, resize), the window coordinator,
layout, close/quit coordination, the keymap, any sibling repo, and — by decision — any
file in the user's own `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`
(§3.2).

## 2. The delta

| Signal | Today (`current`, per the audit's §3) | After stage 3 |
| --- | --- | --- |
| Identity | `ps` argv → a five-name table; Cursor is `busy` | six names; the hook payload's own `session_id` confirms the occupant |
| working / idle | OSC 9;4 (Claude, macOS, spoofed) else output timing | unchanged as the fallback; hooks and the opencode server say the same thing explicitly |
| asked — needs input | Claude: never; Codex: BEL while unfocused; others: never | Claude: `waitingFor` from the registry, `permission_prompt` / `idle_prompt` from hooks; Codex: BEL under `always`; opencode: `permission.*` on the stream |
| asked — finished, unchecked | OSC → 0, or 3 s of silence | explicit `Stop` / `session.idle` where a channel exists; the silence rule stays for the rest, drawn as inferred |
| failed | never (no producer) | `StopFailure`, `turn.failed`, `session.error`; a dead process is `ended`, never `failed` |
| Last sentence | transcript tail, re-read on a state change | `last_assistant_message` at `Stop` (Claude, Codex hooks); the tail stays for opencode and as the fallback |
| Session id / pairing | mtime nearest `changedAt`, then pinned | Claude: minted by Deck (`--session-id`) or read from the registry; hooks carry it; opencode: the server's `Session.id`; the mtime rank survives only for agents with no channel |
| Resume | `resume_lookup` guesses | the recorded id, when one was ever confirmed |
| What the row says about its own trust | nothing | explicit / inferred / unknown, one mark each |

## 3. What is settled, and by whom

### 3.1 Owner-settled, 2026-09-03

1. **Direction A → B, staged.** Poll the Claude registry first, then per-pane adapters;
   keep `ps` + OSC as the fallback. Codex's memo (audit §9) named the order; the owner
   took it.
2. **The real TUIs stay.** Headless stream-json / app-server / `serve`-only integration
   (Crystal, Vibe Kanban) is out — it removes the product.
3. **No global injection.** Deck writes nothing into a CLI's user-level config
   (Superset's `HOOKS_INVESTIGATION.md` is the reason: hooks firing in terminals the app
   does not own, and uninstall debt).
4. **Not opt-in-only.** A sidebar whose truth depends on the user having run a setup
   command cannot claim trust (Codex's reason 2). Adapters are on by default and
   switchable (§10.4).

### 3.2 Carried from the audit and the second opinion

- Process death is **`ended`**, not `failed` (audit §7.3 as amended). `failed` comes only
  from a CLI's own error event.
- The `argv` → agent table and the `ConEmuANSI` spoof are interop Deck maintains, not a
  contract; they stay, and the rail says so through the confidence mark (audit §0, §9).
- The Claude transcript is documented as "internal to Claude Code and changes between
  versions" (audit §5.1); this design reads it only as a fallback and never for state.
- The hook camp's failure class — a missed or unattributable hook leaves the sidebar
  wrong until restart (cmux #3749, Orca #14018, Superset #6641) — is bounded by stage 3,
  not by hope.

## 4. The stages

Each stage ships on its own and leaves Deck more truthful than before it; none depends
on the next.

### Stage 0 — honest UI and the two known lies

- **`cursor-agent` classifies as an agent** on both hosts; a test walks
  `BUILTIN_AGENTS` and asserts every id answers `kind: "agent"` (audit §4.1).
- **The mark carries its confidence.** `PaneAttentionSnapshot.confidence` already exists
  (`agent-attention.ts#L37`); `paneState` returns it beside the word, and DL-27.3 gains
  the rule: an **inferred** `asked` or `done` is drawn as a hollow mark, an **explicit**
  one filled; `unknown` (no signal yet) is the resting dot. Drawn as gallery candidates
  at build time, per the owner's standing rule that ink is chosen by eye, not by prose.
- **`ended`** — a sixth rail word: the foreground agent exited (any status) without a
  CLI error event. `noteExit` receives the exit code; `paneState` maps `phase: "exited"`
  to `ended`. It never reads as `asked`. (Codex's objection to the audit's §7.3.)
- **The blind window closes.** `AgentLauncher` fires → `poller.poll()` at once and again
  ~1 s later; the tracker, on a gate opening, seeds `phase` from `activity.snapshot()`
  instead of `unknown` (audit §4.5). This also removes the `launchTask` timeout the same
  drop causes.
- **The fold stays** (`completed` → `asked`) unless the owner vetoes it (§10.1); with the
  confidence mark, an inferred completion is at least distinguishable.

Evidence: unit suites on `classify`, `agent-attention`, `agent-rail-model`; gallery
candidates for the marks; live checks #0, #1, #4, #5 from the audit's §8.

### Stage 1 — the Claude registry

- **Poll `claude agents --json`** from the main process on its own clock (5 s, like
  `lsof`'s separation from the 2 s `ps` tick), using the DISCOVERED absolute path from
  `discoverAgents` — a packaged app's PATH is bare (`electron/agents.ts`). Answer over
  one flat channel `agent_registry` → `{ pid, cwd, sessionId, status, waitingFor, name,
  kind }[]`; a parse failure or a non-zero exit answers the previous list with a
  `stale: true` flag and degrades to today's behaviour. No documented minimum version:
  the first poll's success decides whether the channel is live for this install.
- **Join on pid.** `pty_info` already reports each pane's foreground `processId`; a row
  whose `pid` matches is that pane's session. `AttentionSource` gains `registry`;
  `status: "waiting"` latches `requested` with `confidence: "explicit"` and clears on the
  next poll that says otherwise; `waitingFor` is the accessible name's detail.
- **The pairing becomes a fact.** `sessionId` from the registry is the tail request's
  `preferredId` from the first ask, so the mtime rank never runs for a Claude pane the
  registry knows (audit §4.7). `resume_lookup` prefers a recorded registry id.
- **Entry criterion (Codex's gate, live check #11):** three Claude panes, two in one
  cwd, one waiting on a permission; the pid ↔ `pty_info` mapping must be exact and
  stable across ten polls, and `waitingFor` must clear when answered. If not, stop.

Evidence: contract fixture for `agent_registry`; unit suites; live check #11 with the
latency of the command recorded as an acceptance number.

### Stage 2 — per-pane adapters

The mechanism, once: **Deck augments the command it types, at arm time, with flags the
user never sees in a preset**, and every hook or server the flag enables reports to a
loopback endpoint that knows which pane it is.

- **Arm-time augmentation.** `AgentLauncher.arm` receives the preset verbatim today and
  `commandProblem` refuses quotes, backslashes and JSON — so a path with a space (macOS
  `userData` is `…/Application Support/SpaceVibe Deck/`) cannot be typed by a USER.
  Deck's own additions are not a preset: a new step beside
  [`applyResumeFlags`](../../src/lib/launch-command.ts) appends Deck-generated,
  shell-quoted flags after the user's command, is exempt from `commandProblem`, and is
  never written to a preset, the journal or the strip. Restore re-applies it at arm time
  from the journal's stored user command. Under Tauri the step is a no-op.
- **Pane identity into the child.** `buildEnv` adds `DECK_PANE_ID` and a per-pane random
  `DECK_HOOK_TOKEN`; a hook script reads both from its environment and posts them with
  the CLI's own `session_id`. Because the env is fixed at shell spawn while the pane's
  occupant changes, main **generation-checks** every post: the `session_id` must match
  the pane's current pairing or be the first for this occupant, else the post is logged
  and dropped.
- **The endpoint.** Main listens on `127.0.0.1` on a random port passed to the child as
  `DECK_HOOK_PORT`; every post must carry a token that matches its pane; payloads are
  capped at 64 KiB (Orca #15791); an unknown pane, a bad token or an oversize body is a
  400 and never reaches the tracker; a hook's own failure is non-blocking for the CLI
  (its exit code is 0 regardless). One push channel, `hook_event`, carries the accepted
  post to the renderer with flat keys.
- **Per agent, v1:**
  - **Claude** — `--settings <deck-file>`: a JSON file under `userData/agent-hooks/`
    holding `hooks` for `SessionStart`, `Stop` (with `last_assistant_message`),
    `StopFailure`, `SessionEnd`, `Notification` matched on `permission_prompt|idle_prompt`,
    and `PermissionRequest`; each command is Deck's own POSIX script posting stdin to
    the endpoint. `--settings` is documented as "override the same keys … for this
    session" and takes a path (≤ 2 MiB) — the user's own hooks keep firing, Deck's
    are added. Optionally **`--session-id <uuid>`** minted by Deck for a fresh launch, so
    the pairing exists before the first byte of output; a resumed pane keeps
    `--resume <id>`. The cheapest `requested` needs no endpoint at all: the
    `Notification` hook returns `terminalSequence` with an OSC 777, which the pane's
    existing handler already turns into `requested` — kept as the fallback for a hook
    whose post fails.
  - **Codex** — no per-launch hook override exists (hooks come only from `~/.codex` or
    `<repo>/.codex`, audit §5.2), so v1 does NOT install Codex hooks. What IS
    launch-scopable and inside `commandProblem`'s alphabet:
    `-c tui.notification_condition=always`, so Codex's BEL reaches Deck for
    `approval-requested` and `agent-turn-complete` whether or not the pane is focused.
    Codex stays inferred for working/idle and explicit only for `requested`.
  - **opencode** — `--port <n>` with a port Deck picks per pane (`opencode --help`:
    `--port … [default: 0]`); main subscribes to `GET /event` and reads
    `GET /session/status` on connect; `session.status` busy/idle, `session.idle`,
    `session.error`, `permission.updated` / `permission.asked` (the docs disagree on
    the name; both are handled) map to `working` / `completed` / `error` / `requested`,
    all explicit; `Session.id` is the pairing.
  - **Gemini, Antigravity, cursor-agent, custom** — their hooks and status lines live
    only in user-level files (audit §5.3, §5.6, §5.5), so v1 leaves them on the
    fallback, drawn as inferred. A later opt-in adapter (a documented settings snippet)
    is the D that §3.1 rejects as the ONLY path, not as an addition.

Evidence: contract fixtures for `hook_event` and the endpoint's request shape; a unit
suite for augmentation (exempt from `commandProblem`, absent from the journal); live
checks #1, #2, #6, #7, #8, #12.

### Stage 3 — freshness and reconciliation

- Every explicit source carries a **freshness deadline** (registry 2 polls, hook 120 s
  without a newer event while `ps` says the agent is alive, server: the SSE connection
  itself). Past it, the tracker falls back to `ps` + OSC and the mark turns inferred —
  Agent Deck's freshness-window rule, so a missed hook cannot pin a row forever.
- **An older event never overwrites a newer generation**: every accepted post carries
  the pane's generation at post time; the tracker discards posts from a previous
  occupant.
- **`Stop` is not done and `Notification` is not needs-input without its matcher** —
  encoded once in the adapter's event map, with `SubagentStop` and `TeammateIdle`
  ignored for the row's state (Superset #6641).

Evidence: unit suites on the tracker's deadline and generation paths; live check: kill
the endpoint mid-run and watch the row degrade to inferred instead of freezing.

## 5. Data model and seams

- **`AttentionSource`** — `osc-progress | osc-notification | bell | output-heuristic |
  process` today; gains `registry | hook | server`. `confidence` is unchanged and
  becomes rendered.
- **`AgentPhase`** — unchanged; `exited` maps to the new rail word `ended`.
- **`RailState`** — `failed | asked | working | done | idle` gains `ended`;
  `paneState` returns `{ state, confidence }`.
- **`PaneView`** — gains `sessionId?: string` (registry- or hook-confirmed) so the tail
  store and Recent activity join on a fact.
- **IPC** — `agent_registry` (request/response, flat), `hook_event` (push, flat), both
  Electron-only and fixture-pinned. `pty_info`, `session_tail`, `resume_lookup` keep
  their shapes.
- **Settings** — `agentSignalAdapters: { claude: boolean; codex: boolean; opencode:
  boolean }`, default all `true`.
- **Files Deck owns** — `userData/agent-hooks/claude.json` and its scripts, written by
  main at startup, never by the renderer, never under the user's `~/.claude`.

## 6. Failure modes

| Failure | What the user sees | Bound |
| --- | --- | --- |
| `claude agents --json` missing or a different shape | today's rail, marks inferred | stage 1's stale flag; parse errors never throw |
| The endpoint port is taken or the listener dies | Claude rows fall to `terminalSequence` OSC and then to inferred | stage 3 deadline; `terminalSequence` fallback |
| A hook posts for a pane whose occupant changed | nothing changes | generation check |
| A user preset already carries `--settings` or `--session-id` | Deck's augmentation is skipped for that flag and the row says inferred | augmentation checks the user's flags first |
| `--session-id` collides (restore retypes it) | never — the id is arm-time only, the journal stores the user's command | §4 stage 2 |
| opencode picks its own port (`--port` in the user preset) | Deck reads the user's value instead of minting one | augmentation parses the preset first |
| The user disables an adapter | that agent is inferred, drawn so | `agentSignalAdapters` |
| Dev run under `electron:dev` | the Deck-owned hook file lands in the REAL `userData` (known trap) | verification runs use a wrapper that sets `userData` first |

## 7. Done and excluded

Done means: every row's mark says explicit or inferred; a Claude pane's session is a
fact from the registry or a minted id; a Claude permission prompt reads `asked` within
the hook's own latency; a Codex approval rings through focus or not; an opencode pane's
busy/idle and permission come from its server; a dead agent reads `ended`; a Cursor
pane has a row.

Excluded, by decision: headless integration; global injection; hooks for Gemini,
Antigravity, Cursor and custom agents (opt-in later, §10.5); the token-usage dashboard
and Recent activity (they keep their R-tier scanners; the audit's §4.9 gaps are a
separate change); Tauri (no `session_tail`, no registry, no endpoint — the rail on
Tauri is unchanged); Windows (Gate C, and `ConEmuANSI` stays macOS-only).

## 8. Hosts and platforms

Electron only for stages 1–3. Stage 0's classification fix reaches both hosts (Rust
twin). Windows inherits stages 1–3 in code but is unverified (Gate C); the endpoint and
the scripts are POSIX in v1, so the Claude adapter is macOS/Linux until a PowerShell
script exists.

## 9. Verification

The audit's §8 is this program's acceptance list, promoted:

- **Stage 0:** live checks #0, #1, #4, #5; gallery candidates for the marks; suites.
- **Stage 1:** live check #11 as the entry criterion (exact, stable pid mapping, latency
  recorded); suites; contract fixture.
- **Stage 2:** live checks #1, #2, #6, #7, #8, #12; a run with the endpoint killed.
- **Stage 3:** the freeze-and-degrade run.
- Every stage: `npm test`, both typechecks, `npm run build`, the design-language gate,
  and a checkpoint. Headed runs go through a wrapper that sets `userData` to a scratch
  directory first.

## 10. Open questions — recorded for the owner's veto, with defaults

1. **The `completed` → `asked` fold** (owner, 2026-08-16). Codex would stop presenting
   heuristic completion as `asked`. Consequence: codex/opencode/gemini/custom panes lose
   nearly every `asked` they have today, since their only other producer is a BEL.
   **Default: keep the fold; draw inferred vs explicit differently** (stage 0).
2. **Mint Claude's session id at launch (`--session-id`)** vs. read it from the
   registry after the fact. Minting makes the pairing exist before the first byte and
   makes restore exact; it also means Deck names the file in `~/.claude/projects`.
   **Default: mint for fresh launches, read for everything else.**
3. **The augmentation's visibility.** The user sees `claude --dangerously-skip-permissions
   --settings '/…/agent-hooks/claude.json' --session-id …` typed into their shell.
   Alternative: a wrapper script so only `claude` appears. **Default: type it visibly** —
   the strip and the journal show the user's own command, and hiding what Deck runs is
   worse than showing it.
4. **Adapters on by default** with a per-agent switch under Settings → Agents.
   Alternative: off until the user turns them on (§3.1's rejected D). **Default: on.**
5. **Gemini / Antigravity / Cursor** — leave on the fallback in v1, or write a
   documented opt-in snippet the user pastes into their own settings. **Default: fallback
   in v1; the snippet is a later change.**
6. **Codex `tui.notification_condition=always`** raises a BEL in a FOCUSED pane too,
   which the user will also hear. **Default: set it; the mark is worth the beep.** The
   alternative is Codex staying unfocused-only and mostly inferred.
7. **Recent activity and the tail store** — once `PaneView.sessionId` is a fact, the
   tail store should stop ranking for those panes at all. **Default: yes, in stage 1.**

Answer with the number; silence keeps the default.
