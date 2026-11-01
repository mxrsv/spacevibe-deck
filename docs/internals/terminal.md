# Terminal, panes and tabs

> For maintainers. Using Deck? See [docs/user/](../user/).

The stage is a set of tabs, each a split tree of panes, each pane one xterm.js instance bound
to one PTY that the main process owns. This page covers the PTY manager and its ownership
model, the tab and layout layer in the renderer, how a tab is materialized and an agent
launched into it, how a pane's phase and attention are derived, and the close, quit and
window-transfer protocols. The vocabulary is in [glossary.md](glossary.md).

## PTY ownership (main)

The Electron [agent pane header](../../src/terminal/pane-agent-header.tsx) reads
the same pane tail as the sidebar and disposes its subscriptions with the pane.
The header draws no buttons (DL-32.8): the Claude Effort picker and the pane's
split, Focus expand and Close actions were removed on 2026-10-10; those acts live in
`More` and on their chords. Claude's own model/effort picker is still reachable with
its default Meta+P inside the terminal. The experimental Codex App Server bridge
was removed when the owner narrowed the scope to Claude Code.

[`electron/pty/manager.ts`](../../electron/pty/manager.ts) spawns and owns every PTY.
Ids are process-local integers from 1, never reused.

- **Every pane command validates ownership through the coordinator first.** `write_pty`,
  `resize_pty` and `kill_pty` call `assertOwner(paneId, windowLabel)`; a pane routed to
  another window, or one mid-transfer, is refused with a `PaneAccessError`. Output is
  delivered by `coordinator.deliver`, which drops (never broadcasts) an event with no route.
- **Spawn** runs the user's shell (`$SHELL -l` on macOS, through the bootstrap in
  [Shell bootstrap and agent wrappers](#shell-bootstrap-and-agent-wrappers); `pwsh.exe` or
  Windows PowerShell on Windows, which throws rather than falling back to `cmd.exe`) with
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=SpaceVibeDeck` and
  `encoding: null` so bytes arrive as Buffers and a streaming UTF-8 decoder can hold back a
  split code point. `ConEmuANSI=ON` is set on macOS only, so Claude Code emits OSC 9;4.
  On Windows node-pty ignores the encoding and delivers strings, which the decoder passes
  through untouched.
- **Output is batched** ([`stream.ts`](../../electron/pty/stream.ts)): chunks queue up to
  64 KiB per batch, the source is paused above 512 KiB queued, and batches go out on a
  microtask. Three events reach the renderer: `pty:output` `{ id, data }`, `pty:exit`
  `{ id }` and `pty:prompt-ready` `{ id }`.
- **Main parses exactly two OSC sequences** ([`shell-integration.ts`](../../electron/shell-integration.ts)):
  `133;B` (prompt ready) and `9;9;<path>` (current directory). At most the last 8 cwd
  candidates per batch are probed, backwards, and a UNC-shaped root is rejected before any
  filesystem call, because probing `\\host\share` offers NTLM credentials to that host.
- **Kill** signals the foreground process group with SIGHUP, then SIGKILL after 500ms, and
  the shell group outright; groups 0 and 1 are refused. `killAll` reads the process table
  once for the whole batch. On Windows it is `taskkill /T`, which only walks the tree that
  exists at call time, so a crashed Deck orphans agents; accepted.

## Shell bootstrap and agent wrappers

On macOS and Linux, pane shells start through Deck-written files under `<userData>/agent-shell/`, so that
`claude`, `codex` and `opencode` typed in a pane resolve to Deck's wrappers. They are
rewritten atomically at every boot ([`provision.ts`](../../electron/agent-shell/provision.ts));
if that fails, panes start a plain `$SHELL -l` and the wrappers are absent. Windows is
untouched.

- **A wrapper must `exec` the real CLI.** Classification reads `ps args` of the tty's
  foreground process group, and Claude's session registry joins on the foreground pid. A
  wrapper that stays alive as a parent would change both
  ([`agent-wrappers.ts`](../../electron/agent-shell/agent-wrappers.ts)). The wrapper finds the
  real binary by skipping every `…/agent-shell/bin` on `PATH`, not just its own, so a Deck
  started from a pane of another install (dev inside release) never resolves to a wrapper.
- **Only pane spawns are bootstrapped.** `shellLaunch(paths)` in
  [`macos.ts`](../../electron/platform/macos.ts) takes the paths from
  [`spawn.ts`](../../electron/pty/spawn.ts); agent discovery, editors and `gh` launches still
  run a plain `$SHELL -l`, so the catalog sees the user's own `PATH`.
- **Each shell has its own mechanism**
  ([`shell-bootstrap.ts`](../../electron/agent-shell/shell-bootstrap.ts)), and none replaces
  the user's startup files:
  - zsh keeps `-l` and gets `ZDOTDIR` pointing at four Deck dotfiles. Each sources the user's
    file of the same name and hands `ZDOTDIR` back to the next Deck file. The user's
    `ZDOTDIR` is remembered in `DECK_ORIG_ZDOTDIR` after each file runs, so a `.zshenv` that
    relocates the dotfiles (`~/.config/zsh`) still reaches the real `.zshrc`. `.zshrc` and
    `.zlogin` also move the bin directory back to the front of `PATH` in a `precmd` hook,
    because mise and asdf rebuild `PATH` there and `nvm use` or `conda activate` prepend at
    the prompt. The `.zshrc` stage repoints `HISTFILE` when it is Deck's own
    `<zsh dir>/.zsh_history`: macOS `/etc/zshrc` derives it from `ZDOTDIR` while that is
    still Deck's, which would move the pane's history into userData.
  - bash runs `--rcfile`, which sources `/etc/profile`, the first of `~/.bash_profile`,
    `~/.bash_login` and `~/.profile`, then `~/.bashrc`, then prepends the bin directory. It
    is therefore **not a login shell** any more.
  - fish keeps `-l` and prepends the bin directory with `--init-command`.
  - bash and fish prepend once at startup and have no prompt hook, so a later `nvm use` or
    `conda activate` puts the real CLI ahead of the wrapper until the next pane.
  - Any other shell gets no bootstrap and no wrappers on `PATH`.
- **Identity is first-wins.** The outermost wrapper exports `DECK_AGENT_ID` and its own pid
  as `DECK_AGENT_PID`. An agent that launches another from its tool calls passes through a
  second wrapper, which only sets `DECK_AGENT_NESTED`. A wrapper reached again in the same
  pid is the same exec chain (a user's shim that execs `claude` by name) and keeps the
  identity. With no `DECK_AGENT_ID` but an inherited `CLAUDECODE`, which Claude Code sets for
  its tool subprocesses, the outer Claude skipped the wrapper, and the wrapper still sets
  `DECK_AGENT_NESTED`. Both hook scripts exit early when `DECK_AGENT_NESTED` is set or
  `DECK_AGENT_ID` names the other agent; the Claude script also exits when Claude's own
  `CLAUDE_PID` differs from `DECK_AGENT_PID`, which catches a nested `claude` that skipped
  the wrapper. The inner agent therefore never rotates the generation or draws marks on the
  outer one's row. `buildEnv` deletes these variables and `CLAUDE_PID` from the inherited
  environment: a Deck started from an agent's tool call would otherwise mark every pane
  nested.
- **The generation check is per pane and agent**
  ([`hook-server.ts`](../../electron/agent-hooks/hook-server.ts)). Keyed by pane alone, a
  nested Codex `SessionStart` evicted the pane's Claude occupant, and Claude's next `Stop`
  was then dropped as "a previous occupant".

## Process classification

`pty_info` answers `{ id, cwd, process, kind, agent }` per pane
([`electron/pty/info.ts`](../../electron/pty/info.ts)), where
`kind` is `idle-shell` / `agent` / `busy` / `unknown`.

- The foreground process is found from a **measured `ps` snapshot**, not node-pty's
  `.process` getter, which reads a truncated `p_comm` and once answered a version string for
  a `claude` pane. macOS runs `/bin/ps -A -o pid=,pgid=,tpgid=,tty=,args=` and joins on the
  pane's tty; `tpgid` names the foreground group. Windows runs one `Get-CimInstance
  Win32_Process` snapshot and walks the shell's descendant tree. `pty_info` picks the
  shallowest descendant that classifies as an agent, because an agent's long-lived children
  (stdio MCP servers, Codex's code-mode host) sit deeper than the agent. With no agent in the
  tree it picks the deepest, newest process, which Stop and close always target. Both reads
  reject rather than answer when the table cannot be read.
- Classification ([`platform/classify.ts`](../../electron/platform/classify.ts)): a built-in
  agent by binary name or by the script an interpreter is running, then a user-declared
  matcher (label as identity), then a shell name → `idle-shell`, otherwise `busy`. A pane's
  own shell running a command (`-c`, a script after `exec`) is `busy`; `ps` prints arguments
  without their quoting, so Deck's own bash and fish launch lines are recognized whole rather
  than parsed. An incomplete reading is `unknown`.
- **`unknown` is neither idle nor busy.** The census treats it as "cannot say", and a failed
  reading never becomes an empty census.
- cwd is the live `lsof -d cwd` answer first (macOS only), then the last OSC 9;9 the shell
  printed. On Windows the injected prompt's OSC 9;9 is the whole cwd story.

## Tabs, panes and layout (renderer)

- **[`TabManager`](../../src/terminal/tab-manager.ts)** owns the tabs: a list of
  `TabEntry { key, manager, openedAt, workspacePath }`. `workspacePath` is fixed for the
  tab's life and never re-derived from a pane's cwd. It publishes `tabViews` and
  `activeTabIndex` ([`tabs-store.ts`](../../src/terminal/tabs-store.ts)); every pane appears
  in `TabView.panes`, agent or not, and filtering belongs to the surface that renders rows.
  `syncViews` rebuilds the views from the 2-second pane poll and re-applies name and colour
  overrides so a rename survives polling.
- **[`TerminalManager`](../../src/terminal/terminal-manager.ts)** owns one tab's panes and its
  split tree ([`split-tree.ts`](../../src/lib/split-tree.ts), immutable; every operation
  returns a new tree). A split or dock takes a **fresh** cwd from `pty_info`, not the poll
  cache, and assigns `activeId` directly because `setActive` applies ratios to a DOM that
  does not match the just-split tree yet. `closePane` refuses a pane whose route is
  transferring: an aborted transfer would return an agent to a window with no UI for it.
- **[`LayoutEngine`](../../src/terminal/layout-engine.ts)** maps the tree to the DOM: Focus
  Expand gives the active pane at least 65% along its path, ratios clamp to 15–85%, zoom is an
  overlay that a structural rebuild drops first, and hit-testing goes through the engine so
  no consumer queries `.pane-slot` itself.
- **Pane** ([`pane.ts`](../../src/terminal/pane.ts)): xterm with fit, search, serialize,
  unicode-graphemes and WebGL addons. WebGL is scoped to the tab on screen: a pane mounted
  into a hidden tab never opens a context, [`hide()`](../../src/terminal/terminal-manager.ts)
  releases the ones it has, and `show()` builds them back before it fits. `display: none`
  frees none of this on its own — a WebGL drawing buffer belongs to the GL context, not the
  compositor, so it survives at full pane size.

  Cost is paid at ACTIVATION, not at first paint: `WebglRenderer`'s constructor runs
  `_initializeWebGLState()` → `handleCharSizeChanged()`, which sizes the canvas to the whole
  pane and acquires an atlas, outside `RenderService`'s IntersectionObserver pause gate — the
  pause only defers repainting and glyph upload. And each pane carries **two** pane-sized
  canvases: the WebGL one plus `LinkRenderLayer`'s 2D underline canvas. So loading the addon
  on a pane the user cannot see costs its full surface budget immediately, which is why the
  gate belongs at mount and not at first render.

  One measured 8-hour window with all eight tabs visited held **745 MB across 72 pane-sized
  surfaces in 15 distinct geometries** — more sizes than there were panes, and several wider
  than the window then was, so historical geometry from resizes and zoom toggles is retained
  too. Disposal removes both canvases, but it does not call `WEBGL_lose_context`, so release
  is collection-timed rather than immediate: treat reclamation as expected, not guaranteed.
  The initial `visible = false` in
  [`terminal-manager.ts`](../../src/terminal/terminal-manager.ts) is only correct because
  `addTab` sets `display: none` before it runs `initFresh`/`initFromLayout`; a path that
  showed a tab before initializing it would hand contexts back to hidden panes. Activation
  failure or a lost context still drops to the DOM renderer, now until the next `show()`
  rather than for the life of the pane. `flush()`
  waits for xterm's write drain so a transfer serializes after every byte landed. Paste is
  bracketed and `\n` becomes `\r`, the only route that lands a multi-line body in an agent
  TUI's composer as one block. The [paste boundary](../../src/lib/terminal-paste.ts) removes
  C0/C1 controls before framing, preserving tabs and line breaks; project asset names
  containing controls are rejected by the [scanner](../../electron/prompt-assets.ts).
- **Strip order** starts with the window-wide clock
  ([`open-sequence.ts`](../../src/lib/open-sequence.ts)).
  [`stripPreferences` and `mergeStripOrder`](../../src/lib/strip-order.ts) apply a manual
  order and pinned prefix without rewriting open keys or owner indexes. Preferences are
  renderer-local: they survive workspace/layout switches, but are not journaled across
  application restarts. The shell supplies `visibleTabIndexes` so keyboard digits/cycling
  count the same repository-scoped chips as the strip. Since 2026-09-28 every terminal tab
  (a [space mark](mission-control.md)) comes before every surface chip, each half in that
  merged order, and `stripSlots` partitions identically.
- **Strip close actions** ([`tab-strip-close.ts`](../../src/ui/tab-strip-close.ts)) capture
  identities before awaiting guards. A single close uses App's existing workspace cleanup;
  bulk closes target only visible, unpinned chips and deliberately omit that cleanup so it
  cannot sweep pinned or hidden files. Files close sequentially through their dirty guard,
  then terminals use one Busy confirmation; cancelling stops the remaining batch but does
  not undo earlier confirmed file closes. Files retained in another workspace become
  visible again when that workspace is reopened. Pinning a preview promotes it to a kept
  file tab so another preview cannot replace it.
- The closed-tab stack holds 10 snapshots in memory (`layout`, `cwds`, `name`, `dotColor`,
  `workspacePath`); ⌘⇧T reopens with fresh shells and does not re-run agents.

## Transient agent launch targets

The [agent launch page](../../src/launcher/agent-launch-page-store.ts) captures stable
terminal tab/pane identity before covering the stage. The page's context row can replace
that target in place: `retarget` re-captures through `captureAgentLaunchTarget` and bumps the
store's epoch, so a launch begun under the old checkout cannot commit; it starts nothing and
is refused while a launch is pending. Its
[target resolver](../../src/terminal/agent-launch-target.ts) prefers the active matching
checkout tab, then an exact root, then a matching nested tab; another worktree is not a
fallback. Windows path keys are comparison-only. Split launches require a fresh known
cwd; unavailable cwd does not fall back to home.

The captured target decides the FOLDER, not the slot: the pane goes where
[pane tiling](../../src/lib/pane-tiling.ts) puts it — the tab's roomiest leaf, split along
its longer side — so repeated launches tile instead of halving one pane into ever narrower
columns. It reads the structural ratios rather than the Focus Expand overlay, so a divider
dragged by hand still decides where the next agent lands, and it measures the shared stage
host because a background tab's own container is hidden. No eligible leaf falls back to the
captured pane's right edge.

[TabManager](../../src/terminal/tab-manager.ts) validates the request before insertion.
[TerminalManager](../../src/terminal/terminal-manager.ts) discards only newly spawned
resources if cancellation, disposal or transfer invalidates that operation. Registration
or insertion is the commit boundary: later page dismissal suppresses stale navigation,
not the committed agent. Adapter preparation rechecks the committed pane's ownership and
launchability independently of page visibility before arming its command. Optional guards
and no-focus initialization preserve existing materialization callers' defaults.

The page's launch receipt means a pane was created, not that its CLI is ready. Shell
readiness still belongs to [AgentLauncher](../../src/terminal/agent-launch.ts); command-write
failures from this route are reported visibly without automatically creating another pane.

An Install press reaches `launchAgentAtTarget` with a
[`LaunchCommandOverride`](../../src/terminal/agent-launch-target.ts) of kind `install`, the
one parameter later overrides share. The agent need not be detected. The command is armed
verbatim through `AgentLauncher`, with no signal-adapter augmentation, and is never recorded
in `launchCommandByPane`, so the journal cannot replay an installer. It is never counted as
an agent launch either, and a multi-line command is refused before any pane exists.

## Materialization and agent launch

`MaterializeIntent` ([`tab-materialize.ts`](../../src/terminal/tab-materialize.ts)) is the
one interface behind the Open board, the quick picker, closed-tab reopen, presets, rail drop
and session restore. `TabManager.materialize` owns the implementation.

| Field           | Contract                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------ |
| `layout`, `cwds` | The split tree and one cwd per leaf, left to right; cwd policy is `fresh`, `polled`, `none` or `given` |
| `agent`         | The agent to type into every pane; `null` for a reopen                                     |
| `launchCommand` | `undefined` resolves the agent's default preset, `null` forces the bare binary, a string is typed as is |
| `paneCommands`  | Per-pane commands that override `agent`; session restore's path                            |
| `workspacePath` | Absent means a tab with no workspace                                                       |

- **An agent is typed, not spawned.** [`AgentLauncher`](../../src/terminal/agent-launch.ts)
  writes `<command>\r` into the pane's interactive shell once it is ready, so the command
  inherits the shell's real `PATH`. On macOS readiness is first output, with a 3-second
  fallback; on Windows only `pty:prompt-ready` counts and a 15-second timeout cancels that
  pane and reports it. Each pane is typed into exactly once; a failed write leaves a plain
  shell and never sinks the tab. The launcher's keystrokes count as input so the echo does
  not light the working spinner.
- **The command is a string, validated at the door.** `commandProblem` in
  [`launch-profile.ts`](../../src/lib/launch-profile.ts) refuses separators, substitution,
  redirects, quotes, globs and newlines, and caps at 200 characters, because the string
  reaches a live shell verbatim. Resolution order in
  [`launch-command.ts`](../../src/lib/launch-command.ts): the starred preset, then any
  preset for the agent, then the catalog's shipped `defaultCommand`, then the bare binary.
- **The Open board resolves an agent before it promises one.**
  [`resolveAgent`](../../src/lib/workspace-recents.ts) reports *which* of three things
  happened — `chosen`, `substituted`, `shell-fallback` — where the older
  `resolveAgentChoice` returned an id and let a missing agent fall through to whatever stood
  first on `$PATH`. A row therefore cannot print one agent and open another.
  [`BoardComposer`](../../src/open-board/board-composer.tsx) seeds a **runnable** agent into
  a visible draft and starts nothing; picking a workspace fills the composer, it does not
  launch. An explicit Shell memory (`lastAgent: null`) resolves `chosen` forever after, so a
  machine with no agent CLI is asked once per folder, not on every open.
- **The catalog** ([`agent-catalog.ts`](../../src/lib/agent-catalog.ts)): a built-in's id, its
  binary name and its bare command are the same string, which is what keeps every
  `lastAgent` on disk resolving. Order is the digit-key contract, so new agents append.
- **One file per built-in agent.** Each lives under `src/lib/agents/` and holds its label,
  shipped command, dot colour, resume forms, model/effort flags and launch flags;
  [`agent-registry.ts`](../../src/lib/agents/agent-registry.ts) lists them in order. The
  catalog, the discovery probe and process classification in main, `COMMAND_TABLE`, and the
  runtime and launch-flag controls all derive from its active agents — never keep a second
  list. Adding an agent is that file plus one entry; a logo in
  [`agent-logos.ts`](../../src/lib/agent-logos.ts) is optional, and a telemetry key is a
  separate privacy change (without one the agent counts as `custom`). `withdrawn: true` turns
  an agent off everywhere while keeping its data, so its journaled panes restore as plain
  shells; `cursor-agent` is withdrawn. Per-agent adapters (hooks, resume scanners, usage)
  stay code.
  Discovery probes `sh -ilc "command -v <name>"` on macOS (interactive and login, because
  CLIs register `PATH` in rc files) and walks `PATH` with `.cmd`/`.exe` suffixes on Windows.
  Probe names are restricted to `[A-Za-z0-9._~+/-]`, enforced again in main.

## Agent phase and attention

Two independent axes per pane, both computed in the renderer and both gated on the last
poll having classified the pane's foreground process as an agent.

- **Phase** ([`agent-activity.ts`](../../src/terminal/agent-activity.ts)):
  `unknown` / `idle` / `working` / `exited`. OSC 9;4 progress, parsed from every output chunk,
  is the sole source once a pane has emitted one (state 0 clears; 2 is error; 4 is warning;
  anything else is working). Otherwise a sustained-output heuristic: at least 400ms of
  continuous output still fresh within 3 seconds, ignoring output within 300ms of the user's
  own keystrokes. A process change resets the record so a stale "busy" cannot pin the
  spinner. A 3.2-second re-sync timer feeds a synthetic idle when activity decays.
- **Attention** ([`agent-attention.ts`](../../src/terminal/agent-attention.ts)):
  `none` / `completed` / `requested` / `warning` / `error`, latched until acknowledged and
  never downgraded. Explicit signals (OSC 9;4 severity, OSC 9 or 777 notifications, the
  bell) outrank the heuristic, which may only ever produce `completed`. The UI reads
  attention before phase. `hasRun` separates a pane that finished and was checked (`done`)
  from one that never ran anything (`idle`).
- **Acknowledge** clears attention and per-pane unread, never a live phase. The one exception
  is an `exited` phase whose pane is no longer an agent: acknowledging it, or visible output
  in that pane, turns it `idle`, so the `ended` row goes back to being a shell. Focus counts only when
  the window is foreground, the tab is active, and DOM focus rests inside the pane.
- Notifications dedupe on the latch identity, so only a newly raised or escalated kind is
  forwarded, and the OSC classifier never carries the payload's title or body text.

### The contract layer

The heuristics above are the floor. Where a CLI can be made to *say* what it is doing, Deck
asks it, and the rail draws **how much it knows**: an inferred mark is a hollow ring, an
explicit one is filled, and a contract state older than 120 seconds turns inferred. The
mark also gained a sixth word, `ended`, for an agent whose process left the pane — it used
to wear `asked`'s yellow as an inferred `completed`. `phaseConfidence` in
[`agent-attention.ts`](../../src/terminal/agent-attention.ts) is the axis; each adapter is
switchable under Settings → Agents through the `agentSignalAdapters` setting.

**Claude, Codex and opencode Signals all ship on.** The per-agent
Signals switch in [`settings-schema.ts`](../../src/settings/settings-schema.ts) is resolved by
a revision ladder in [`signal-adapter-choice.ts`](../../src/settings/signal-adapter-choice.ts):
each rung turns one agent on once for a settings file saved under an older
revision and keeps every other stored value; from the current revision on, a stored value is
the user's choice. Revision 2 could not tell a chosen "off" from the old default, so a
revision-2 "off" for any of the three comes back on once. A file older than revision 2 still
reads as the defaults. Claude and Codex Signals register guarded hooks in the agent's user
config; opencode registers nothing and loads a Deck plugin instead. Claude's registry below
runs independently of the switch. Without hooks, API failures cannot produce the explicit
`failed` mark. Without the plugin, opencode provides no contract session identity for
[`live-session-state.ts`](../../src/ui/sessions/live-session-state.ts).

- **Claude answers a registry.** Main polls `claude agents --json`
  ([`claude-registry.ts`](../../electron/agent-registry/claude-registry.ts)) and the renderer
  joins it on the pid `pty_info` already reports, so a Claude pane's session id is a **fact**
  and its `waiting` is Claude's own word. The poll is demand-driven (an app with no Claude
  pane spawns nothing), answers the previous snapshot flagged `stale` rather than throwing,
  and runs the **discovered absolute path** — a packaged app's `PATH` is launchd's bare one.
- **Claude hooks cover manual launches.**
  [`claude-integration.ts`](../../electron/agent-hooks/claude-integration.ts) installs the
  script under this installation's `userData/agent-hooks/` and, when Signals is enabled,
  registers guarded commands in `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`).
  [`claude-user-settings.ts`](../../electron/agent-hooks/claude-user-settings.ts) preserves
  other settings and hooks, follows settings symlinks, preserves file permissions and
  refuses invalid JSON or a concurrent registration lock. Disabling removes only this
  installation's commands. The guard requires the matching `DECK_CLAUDE_HOOK_SCRIPT`
  plus the pane ID, token and port; it does nothing in an outside terminal or when the
  script is absent. Separate development and release installations do not remove each
  other's hooks. A registration error is logged and leaves registry discovery available;
  a later Signals change retries. A leftover `.deck-hooks.lock` is never stolen automatically.
- **Claude's turn hooks post a bounded body.** `UserPromptSubmit`, `PostToolUse` and
  `PostToolUseFailure` say `working`; their stdin carries the whole prompt or tool response,
  and the endpoint's 64 KiB cap would drop "back to working" exactly on large tool output. The
  [script](../../electron/agent-hooks/claude-hooks-file.ts) therefore reads a bounded prefix,
  posts only the event name, session id, turn id and tool name, and drains the rest of stdin. It posts
  nothing for a subagent: a top-level `agent_id` marks one, and only depth-1 keys are read, so
  a tool argument of that name cannot fake it. `working` clears a `requested` the hooks raised
  (the tool was approved); a registry-raised `requested` stays the registry's to clear.
- **A fresh hook phase outranks the output heuristic.**
  [`agent-attention.ts`](../../src/terminal/agent-attention.ts) refuses heuristic transitions,
  including the 3.2-second silence resync, while an explicit contract phase stands, so a quiet
  tool run cannot latch an inferred `completed` mid-turn. The phase hollows to inferred after
  120 seconds of silence, and the heuristic applies again.
- **Escape and Ctrl+C clear hook-backed work.** [`pane.ts`](../../src/terminal/pane.ts) reports
  the key without changing what it writes to the PTY. If the last contract signal was
  `working` or a hook-raised `requested` (an OSC 9;4 transition after it does not disarm), the
  pane reads idle with no completion latch. A registry-raised `requested`, `warning` and
  `error` stay, and the next hook overwrites.
- **Endpoint and script precede the first window.**
  [`main.ts`](../../electron/main.ts) waits for the hook listener and integration setup;
  [`spawn.ts`](../../electron/pty/spawn.ts) stamps each shell with its installation's script
  and authenticated pane environment. A shell created before this integration was added
  needs reopening. Claude must load its user settings; an explicit exclusion or disabled
  hooks leaves registry discovery as the fallback. Commands typed manually inherit the same
  environment as launcher commands. The [endpoint](../../electron/agent-hooks/hook-server.ts)
  validates tokens and session generations before routing events to the owning window.
  Main suppresses delivery when Signals is off, including hooks already loaded by a session.
- **Codex lifecycle hooks own its turn state.** Enabling Codex Signals registers eight events
  in `CODEX_HOME/hooks.json` through [`codex-hooks.ts`](../../electron/agent-hooks/codex-hooks.ts):
  Superset's set minus its Subagent events (`SessionStart`, `SessionEnd`, `UserPromptSubmit`,
  `PreToolUse` on `request_user_input` only, `PostToolUse`, `Stop`, `Interrupt`) plus the native
  `PermissionRequest`, to which the script never answers. An approval or a question maps to
  `requested`; `PostToolUse` says `working` and clears it. A subagent's events carry an
  `agent_id`; the script reports it and the endpoint drops the event. Registration preserves
  existing handlers and never edits `config.toml` or `notify`. The installation-specific
  `DECK_CODEX_HOOK_SCRIPT` guard restricts delivery to this Deck's authenticated panes. The
  [bridge](../../electron/agent-hooks/codex-integration.ts) requires POSIX and a Codex version
  with lifecycle hooks enabled. Existing shells need reopening to inherit the script path, and
  Codex must load the newly registered hooks. Only `Stop` forwards stdin, because it carries
  the last assistant message; every other event posts a bounded body, as Claude's turn hooks do.
- **Codex trusts a hook by its position, so Deck never moves one.** `config.toml` keys trust by
  `<file>:<event>:<group>:<handler>`. The four oldest events keep their order and the newer ones
  append after them, an enabled registration stays where it is, and disabling Signals empties
  Deck's group to `{"hooks": []}` instead of deleting it, unless nothing follows it. A
  later enable fills an emptied group again. Deleting a group in the middle of an event
  makes Codex ask the user to review hooks that did not change.
- **The wrapper trusts Deck's hooks and keeps Codex out of its shared daemon.**
  [`codex-wrapper-branch.ts`](../../electron/agent-shell/codex-wrapper-branch.ts) adds
  `--dangerously-bypass-hook-trust` to every launch in a pane except the info flags and the
  shared-daemon commands listed below, and `--no-daemon` to the
  interactive forms (bare `codex`, `resume`, `fork`; not `exec`, `review` or `--remote`).
  - *Why the bypass:* without it every Codex session opens on a hook-review screen. It runs
    every enabled hook in every config layer, trusted or not; a hook the user disabled in
    `config.toml` still stays disabled. The owner accepted the rest
    ([RISK1](../specs/2026-10-11-agent-status-hooks-by-default.md#risks)).
  - *Why not `--enable hooks`:* it would override a user's `[features] hooks = false` and run
    every hook unreviewed. Hooks are on by default in every Codex that accepts the bypass, so
    only a user who switched them off loses Signals, and that Codex row stays inferred.
  - *Why `--no-daemon`:* Codex 0.162 hosts an interactive session in a shared app-server daemon
    that runs hooks with the daemon's own environment, so they never reached the pane
    ([decision 4](../specs/2026-10-11-agent-status-hooks-by-default.md#decisions-owner-2026-10-11)).
    The cost is that these sessions do not appear in `codex agents` or remote control.
  - The wrapper adds the flags only while a marker file under `<userData>/agent-shell/` exists
    (created after the hooks are registered, removed before they go), so turning Signals off
    needs no wrapper rewrite. It also requires the real binary's `--help` to list the bypass;
    an older Codex launches unchanged. `--no-daemon` is added only when `--help` lists it too.
  - `--help`, `--version`, and a flag already present are left alone, and a flag after `--` is
    prompt text.
- **A daemon never speaks for a pane.** The daemon keeps the environment of whoever started it,
  which may hold a live pane's credentials. So the script sends the tty of the first `codex`
  process above it in `X-Deck-Tty`, and main accepts a Codex post only when that equals the
  pane's own tty ([`hook-request.ts`](../../electron/agent-hooks/hook-request.ts)); a daemon has
  none. Commands that use the shared daemon (`agents`, `app-server`, `remote-control`, `queue`, `archive`, `unarchive`, `delete`, `--remote`, `--remote-auth-token-env`)
  run with `DECK_PANE_ID`, `DECK_HOOK_TOKEN` and `DECK_HOOK_PORT` unset: the wrapper `unset`s
  them, and a launch command composed where no wrapper runs prefixes `env -u`, which csh and
  fish accept too.
- **opencode reports through a plugin the wrapper loads.** Deck writes
  [`opencode-plugin.ts`](../../electron/agent-shell/opencode-plugin.ts) under
  `<userData>/agent-shell/opencode/plugin/deck-signals.js` with the wrappers. While a runtime marker exists
  (owned by [`opencode-integration.ts`](../../electron/agent-hooks/opencode-integration.ts):
  created when Signals turns on, removed first when it turns off) the opencode wrapper exports
  `OPENCODE_CONFIG_DIR` pointing at `<userData>/agent-shell/opencode/`, and opencode loads
  `plugin/deck-signals.js` from there.
  Nothing is written to the user's opencode config, and Deck adds no `--port` and opens no
  opencode server.
  - *Root only.* Only the pane's root session speaks. A session with a parent is a subagent,
    and an unknown one counts as a child, so a failed lookup cannot let a subagent speak. A
    nested opencode (`DECK_AGENT_NESTED`, or another agent's identity) loads the plugin
    inert, and the renderer drops an opencode post for a pane known to run another agent.
  - *Wire.* The plugin posts seven events to a third endpoint path, `/hook/opencode`:
    `SessionStart`, `SessionEnd`, `Start` and `Stop` (the busy and idle edges), `Failed` (with
    a capped message), `PermissionRequest` and `PermissionReplied`. Every `Start` is
    preceded by a `SessionStart` for its session, because the generation check refuses an event
    from a session that is not the pane's current one and a post can be missed while Signals is
    off. A question answered or dismissed (`question.replied`, `question.rejected`) posts
    `PermissionReplied` like a permission reply.
  - *Proxy-proof loopback.* The post is written on a raw `node:net` socket to `127.0.0.1`,
    not `fetch` or `node:http`: both honour `HTTP_PROXY` inside opencode, which would send the
    pane's token to the user's proxy. It runs in opencode's process, so it stays small and
    never shells out. It returns before the post finishes and drops a failed one.
  - *Stays inferred:* Windows, a shell without a bootstrap, a typed absolute path, and any
    opencode started outside the wrapper's reach.
  - *The user's global `AGENTS.md` comes along by link.* opencode reads its global
    instructions from the config directory the variable replaces; finding none in Deck's, it
    fell back to `~/.claude/CLAUDE.md` (opencode 1.19.0). Boot links `AGENTS.md` there to
    `$XDG_CONFIG_HOME/opencode/AGENTS.md` (default `~/.config`), resolved from main's env
    ([`provision.ts`](../../electron/agent-shell/provision.ts)). A dangling link reads as
    absent, so a user with no file keeps plain opencode's fallback.
  - *A user's own `OPENCODE_CONFIG_DIR` is replaced* inside Deck panes while opencode Signals
    is on, so agents, commands, plugins and `AGENTS.md` from that directory do not load there
    ([RISK5](../specs/2026-10-11-agent-status-hooks-by-default.md#risks)).
- **Codex turn state belongs to the reducer.** A `Stop` ends the current response; if another
  hook requests continuation, Codex emits `UserPromptSubmit` for the continuation turn. The
  [turn reducer](../../src/terminal/codex-lifecycle.ts) rejects late completion from a
  previous turn; `Interrupt` returns to idle without a completion latch.
  [`SessionStart`](../../src/terminal/agent-attention.ts) establishes idle before the first
  turn, including on resume; replayed history cannot start a run or report an old answer as
  newly completed. A repeated start for the same session preserves an established turn.
  Terminal repaints and silence cannot override lifecycle phase, even after the confidence
  freshness window expires. Process exit still ends the pane; turning Signals off returns to
  the output fallback. Transcript tails are not lifecycle evidence.
- **Launch commands carry hooks flags only where no wrapper runs.**
  [`launch-augment.ts`](../../src/lib/launch-augment.ts) adds no Claude flags. Session identity
  comes from `SessionStart` or the registry, not a Deck-minted ID. For Codex, a pane started
  through Deck's bootstrap relies on the wrapper. Otherwise, on a POSIX host whose Codex lists
  the bypass (main probes `--help` and reports it through `agent_signal_config`), the composed
  command carries the same flags right after `codex`, and a daemon command is launched with the
  credentials emptied. Where Codex does not list the bypass, the old
  `-c tui.notification_condition=always` stays. opencode gets nothing from `launch-augment`.
  The journal retains the user's original command. Sessions outside Deck are not mapped to
  panes or controlled.
- Windows ships no hook script.

## Actions, keymaps and the menu

- [`action-registry.ts`](../../src/terminal/action-registry.ts) is the one list of actions:
  id, label, scope, menu placement and the `destructive` flag. Keymaps live in
  [`default-keymaps.ts`](../../src/terminal/default-keymaps.ts) as `MACOS_KEYMAP` and
  `WINDOWS_KEYMAP`; user rebinds are applied by `active-keymap.ts`.
- **Bind on whatever the menu accelerator binds on.** An action with a macOS menu item must
  use a character binding, because a Cocoa accelerator is declared by character; physical
  (`event.code`) bindings are only for actions with no menu item, which is what makes the
  bracket and digit chords work on non-US layouts. Ctrl+Alt chords are skipped while AltGr
  is down.
- **The overlay guard** ranks open overlays `pane` 0 < `settings` 20 < `board` 30 <
  `modal` 40 and blocks an action while any open rank is `>=` its scope's rank; `>=` is
  what makes two modals exclude each other with no extra concept.
- **A chord that cannot act does not eat the key.**
  [`action-performable.ts`](../../src/terminal/action-performable.ts) is asked before
  `preventDefault()`; a false answer leaves the event to whatever holds focus. The
  predicates: `copy-selection` needs a terminal on the stage; `copy-or-interrupt`
  (Ctrl+C on Windows) needs a terminal and a selection, and otherwise lets xterm encode the
  interrupt itself, because Deck writes no `\x03`; `toggle-markdown-view` needs a document
  that can toggle; `toggle-mission-control` needs a terminal tab and no overlay other than
  Mission Control itself; `save-file` is keyed by platform, because both keymaps share its
  row. On macOS (and the browser-only preview) it is always performable, so ⌘S is consumed
  wherever it lands, as before. On Windows it needs a surface (document, browser tab or
  Board) on the stage, because bare Ctrl+S is terminal flow control and must still reach
  the PTY.
- **The menu is derived from the registry at runtime.** `electron/menu.ts`
  imports the registry directly and builds the native menu on macOS only, installing
  `null` elsewhere so Electron's default accelerators cannot reload or close the window.
  Accelerators are suspended app-wide while any window records a shortcut, keyed by sender
  so a dead window cannot strip them for the rest of the run. The `destructive` actions
  (`close-pane`, `close-tab`, `clear-buffer`) are suppressed while a chrome text field holds
  the caret, because a menu event cannot say whether it came from a keystroke or a click.

## Close, quit and the census

- **The census is computed in main from live PTY state**, so a wedged renderer cannot make
  quit unanswerable. `censusFor` ([`quit-flow.ts`](../../electron/quit-flow.ts)) names busy
  processes and counts busy panes; `agent` and `busy` are busy, `unknown` makes the census
  not fully named. A reading that fails yields null, and null is refused, not treated as
  empty: refusing to close is recoverable, killing an agent on a guess is not.
- **Window close** always routes through the renderer, even with nothing busy, because the
  renderer's guard flushes debounced state before it auto-confirms. Order is load-bearing:
  abort any transfer involving the window first, then census. `CloseFlight` is per window;
  `QuitFlight` is app-wide, so a second ⌘Q while the dialog is open does nothing.
- **Quit** asks one window with every window's unsaved files deduplicated, and skips the
  question only when there are no panes and nothing dirty. With no window to answer it kills
  the PTYs and exits. `confirm_quit` runs `killAll` → telemetry flush → `saveAll` → exit.
- **An update install confirms the whole app** through
  [`update_census`](../../electron/ipc/register-updater.ts), including transferring panes and
  every window's dirty files. The [adapter](../../src/updater/electron-updater-adapter.ts)
  refuses installation when that census cannot be read or validated. After confirmation,
  `isInstalling()` bypasses duplicate close/quit prompts and `prepareForInstall` runs the same
  three teardown steps.
- **Renderer-side** ([`close-coordinator.ts`](../../src/terminal/close-coordinator.ts)): ⌘W
  closes the pane, or the tab when it is the last pane; the busy dialog runs on the final
  target and the id confirmed is the id closed, re-pinned after the dialog because a
  `pty:exit` can move focus during it. Tab-level guards never aggregate busy and dirty into
  one dialog; only window close and quit do. The last tab closing leaves the window on the
  Open board.

## Moving a pane between windows

The coordinator ([`electron/coordinator.ts`](../../electron/coordinator.ts)) routes every
pane to exactly one window or to an in-flight transfer.

1. `prepare_transfer` moves the route to `transferring`; output buffers up to 4 MiB.
2. The source serializes the pane (after `flush()`) and `stage_transfer`s the payload.
3. `open_pane_window` (flat `{ token, screenX?, screenY? }`) or `offer_transfer` names the
   destination. Only the source can reserve it; only that destination can `claim` the
   payload and `commit`. The [coordinator](../../electron/coordinator.ts) checks identities
   even when the caller knows the random transfer token.
4. Buffered events flush in order, then `transfer:settled` reaches both sides and the route
   is re-owned. Abort, a 10-second timeout, a full buffer or a dead destination settle as
   aborted and return the pane to the source; a dead source does not abort.

`paneId` crosses `prepare_transfer` as a string and is coerced; `offer_transfer` sends
`targetLabel`; `open_pane_window` takes its arguments flat. All three shapes are frozen by
[`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts).
A window's `close` aborts transfers involving it before anything else; `closed` terminates
the panes it still owned.
