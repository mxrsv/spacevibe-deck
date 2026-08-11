# AGENTS.md — SpaceVibe Deck

> **Boundary:** standalone desktop app — unrelated to the SpaceVibe web/backend repos, no shared DB or API.
> Never edit sibling repos from this session. Workspace map: [`../AGENTS.md`](../AGENTS.md) `current`.

A minimal macOS terminal for running many AI agent CLIs side by side. Formerly Stackgrid. Stack: Tauri 2 + Rust backend, Preact + xterm.js frontend, Vite 6, Vitest. All strings, comments and docs in this repo are **English only**.

## Direction & forks

**Where this is going.** A minimal macOS terminal for running many agent CLIs side by
side. Standalone desktop app — no shared DB, no API, no dependency on the web repos.

**In flight — already decided, do not reopen:**

- v0.10.0 shipped 2026-08-04 (macOS stable + unsigned Windows preview). The tag is
  what CI builds from, and `validate-source` rejects a tag whose `package.json`,
  `Cargo.toml` and `tauri.conf.json` versions disagree.
- v0.11.0 shipped 2026-08-05 — the hardened-updater release, and the gate that
  blocked everything else is closed. `releases/latest` and the first-ever
  `windows-preview-channel` both serve it. What it changed and what was verified
  now lives in [`docs/CONTEXT.md`](docs/CONTEXT.md) `current` and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) `current`; the plan it came from
  is frozen at
  [hardened-updater release plan](docs/plans/2026-08-04-hardened-updater-release.md) `current`.
- The updater fork is [`mxrsv/plugins-workspace`](https://github.com/mxrsv/plugins-workspace),
  branch `fix/updater-macos-transactional-swap`, based on upstream `v2` commit
  `622f02bf` (the `ShellExecuteW` fix, PR #3516). Deck pins the exact revision
  `71df1a095d007fb94f0eb07940b0a78e57ac984e` in
  [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) `current` — an exact commit and
  not the branch, because a moving ref would change what ships without changing
  the tree. Base is `622f02bf` rather than `v2` HEAD so the pin carries only the
  three needed fixes: `v2` HEAD adds the `system-proxy` feature, which drags new
  dependencies into the bundle. Unpin once upstream releases a version
  containing #3505, #3506 and #3516.
- The updater that runs during an upgrade is the one inside the OLD build. So
  the hardening in 0.11.0 cannot protect the 0.10.0 → 0.11.0 hop itself: users on
  0.10.0 either bootstrap manually one last time or accept the unhardened
  updater for exactly that one transition. From 0.11.0 onward the guarantee holds.
- Verification before release required two hardened release candidates
  (`0.11.0-rc.1` → `0.11.0-rc.2`) upgraded for real on macOS AND Windows, plus a
  tampered-signature case and failure injection. **What actually ran (2026-08-05):**
  macOS upgraded for real end to end — discover, verify signature, download,
  install, relaunch — and the installed bundle kept mode `0755` instead of the
  extraction directory's `0700`, which is issue #3506 proven fixed at runtime and
  not only in tests. The tampered-signature case passed: a manifest advertising a
  non-existent `0.11.0-rc.3` with one flipped signature byte was downloaded and
  refused, with no install and no bundle touched. **Windows E2E was deliberately
  skipped** (decided 2026-08-05) — accepted because `windows-preview-channel` did
  not exist before 0.11.0, so no Windows user could receive an update through it
  and none can lose an app. The cost is the same trap this release exists to
  escape: the updater that runs an upgrade lives in the OLD build, so if the
  Windows updater is broken in 0.11.0 it cannot be patched retroactively and
  Windows users bootstrap by hand once more at 0.12.0. `ShellExecuteW` (#3516) is
  therefore in the shipped binary but never observed running. Failure injection
  was skipped too: the swap takes seconds, so killing it at the right instant is
  not reproducible; the breadcrumb logic carries 11 unit tests and the
  lose-the-app failure is covered by the fork's rollback tests.
- A refused signature reads as a network problem. The tampered-signature run
  surfaced it: verification happens inside Tauri's download step, so the UI lands
  on `download-failed` and
  [tells the user the download failed](src/updater/update-action.tsx#L24) `current`
  when the download in fact succeeded and the signature did not verify. Those are
  a flaky connection and a tampered update — the second deserves to stop the user,
  not invite another Retry. Left out of 0.11.0 because that release admits no UI
  work; it needs its own task.
- The GitHub release list has no convention, and 0.11.0 made that visible
  (raised 2026-08-05). Channel releases are **pointers, not versions** — each
  holds one `latest.json` — yet they sit in the list looking exactly like
  something to download, and every version costs two rows because the Windows
  preview is a separate release. Decided: finish 0.11.0 first, then collapse to
  one release per version with the Windows installer as an asset inside it, and
  write the rule down here. Not started. The prerelease flag itself stays — it is
  what keeps `releases/latest` from serving a test build to real users, not
  decoration.
- Landing download links resolve from the releases API at load (2026-08-01): the
  hand-bumped Windows prerelease pin is gone — publishing a release is the act
  that points the landing at it, so links never rot between releases.
- The `deck.spacevibe.dev` landing has no host chosen yet (domain parked).
- Four code comments still cite `FR-`/`ADR` against the claim in `docs/CONTEXT.md`
  (`agents.rs`, `open-board.tsx`, `migrate.rs`) — logged in that file's drift ledger,
  awaiting a human call: strip the comments or soften the claim.
- The marketing video renders from the DOM stage shared with the app — breaking app
  components silently breaks the video.
- Cross-platform auto-update for macOS and Windows is approved (2026-08-02), with
  the no-fee B2 Windows preview channel chosen on 2026-08-03: use free Tauri updater
  signing and GitHub Releases; auto-check only, then expose an explicit chrome
  `Update` → `Install & Relaunch` action beside Settings. Windows remains an unsigned,
  separately labelled prerelease until paid Authenticode signing is chosen later.
- Production builds minify with Terser, not esbuild (PR #9, merged 2026-08-04): esbuild
  0.25 drops xterm 6's function-local enum in `InputHandler.requestMode` but keeps a
  renamed reference, so the DECRQM query OpenCode sends at startup throws and stops
  xterm's write queue for good — a blank pane. `scripts/vite-config.test.ts` locks it.
- User-declared agents (`M2`) are approved (2026-08-04): an agent is a label plus a full
  command line, declared in a new Settings category, and `AgentChoice` stays a string id
  whose built-in ids equal their binary names — so every `lastAgent` already on disk
  keeps resolving and no migration exists to get wrong. The editable list needs a new
  design-language rule (§12), approved with it. See
  [spec](docs/specs/2026-08-04-user-declared-agents-design.md) `decided`.
- Antigravity CLI (`agy`) is the fifth built-in agent, decided and shipped in
  **v0.12.2 on 2026-08-07** — `releases/latest` and `windows-preview-channel`
  both serve it, and every release job passed except the two RC-channel ones,
  which are skipped for a non-RC tag. Google cut Gemini CLI off from free, AI Pro and Ultra users on
  2026-06-18 in favour of `agy`, so a Deck user on the new CLI got a pane with
  no dot color, no agent label and no chip. Four calls, each with its reason:
  **Gemini CLI stays** alongside it — paid Code Assist licences still reach the
  service, and a built-in id equals its binary name, so removing `gemini`
  would strand every `lastAgent` already on disk. **Label is "Antigravity"**,
  not "Antigravity CLI" — it fits the chip. **The dot shares Gemini's
  `--cyan`** rather than taking a new token: a fifth agent color does not
  exist in the eight the theme injects, and the `brightBlue` token first
  chosen was dropped on evidence — it equals `blue` in three of the four
  presets, and `--accent` _is_ the theme's blue, so the dot would have read as
  the accent color. **The row is ordered by reach, not history** — Claude,
  Codex, OpenCode, Antigravity, Gemini — which moves the digit keys people
  already know; accepted knowingly so the row leads with what gets used. The
  brand mark is the first raster one in `AGENT_LOGOS`, since Google publishes
  the icon as PNG. Deliberately left open: `agy`'s OSC 9;4 behaviour is
  unobserved because nobody here has it installed. Detail in
  [`docs/CONTEXT.md`](docs/CONTEXT.md) `current`.

- The Prompt Board landed 2026-08-08 —
  [spec](docs/specs/2026-08-08-prompt-board-design.md) `decided`,
  [plan](docs/plans/2026-08-08-prompt-board.md) `current`, implemented against
  that plan task by task. A chrome popover of reusable prompt templates pastes
  one into the agent session in the focused pane; ⌘⇧P / Ctrl+Shift+P and a
  View-menu item open it. What shipped and what was NOT verified is in
  [`docs/CONTEXT.md`](docs/CONTEXT.md) `current`. Five forks resolved with the
  user, then revised after an
  external Codex review (2 blockers, 6 majors, all accepted): (1) detection
  covers Claude Code AND Codex from v1, but Codex custom prompts are deferred —
  they are standalone slash commands, not embeddable references; (2) each
  template carries its own `autoSend` flag, and submit is triple-gated (fresh
  `pty_info` agent match, idle + unlatched attention snapshot, pane alive)
  because Enter into a permission dialog or a bare shell is the failure mode
  that matters — a failed gate degrades to paste-only; (3) templates live in
  the settings store beside `customAgents`; (4) the surface is a
  chrome-anchored popover, and DESIGN-LANGUAGE gains §13 (anchored popovers +
  `CommitTextarea`) — an approved R2 fork; (5) injection rides xterm's
  bracketed-paste path through a new per-pane FIFO write queue in
  `pane-lifecycle`, so paste-then-Enter ordering is structural, not timed. No
  new dependencies; the R4 seams stay untouched. The plan closed the spec's two
  open questions: the binding is **⌘⇧P / Ctrl+Shift+P** (`p` was free on both
  keymaps, and `CharKeyBinding` is mandatory because the action carries a macOS
  menu item), and a Codex agent `.toml` **does** carry a usable top-level
  `description`, though the scanner still names the agent by file stem because
  that is what the CLI loads by path.

- Detaching a pane into its own window is decided at core-architecture level
  (2026-08-10), [spec](docs/specs/2026-08-10-pane-detach-window-design.md) `decided`.
  **Not implemented — no code written, and implementation planning
  remains gated by the spec's §15 majors.** The original four product decisions
  stand: a full Deck window, bounded scrollback via the approved
  `@xterm/addon-serialize` dependency, cross-window drag in v1, and peer windows.
  A second adversarial review found eight blockers in the first Rust transaction:
  Tauri emit is not a delivery barrier, `SerializeAddon` does not preserve parser
  continuation, frontend queues do not cover every PTY operation, adoption had
  no payload transport, the buffer could not order prompt/exit events, death and
  abort rules conflicted, tokens did not make retries idempotent, and global quit
  had no complete state machine. The user approved the behavior-preserving
  remediation: **reopen the R4 PTY read loop and window/close coordinators** for
  a sequenced per-pane stream actor, transfer only at an acknowledged
  restart-safe xterm boundary, stage target-bound adoption payloads, retain a
  bounded terminal-outcome ledger, and coordinate quit in Rust. A move may fail
  safely after a 2 s boundary deadline rather than corrupt the TUI; live-adopt
  joins the destination tab without overwriting its metadata. If both owners are
  gone the PTY is killed instead of leaked. Transfer IDs are process-local
  integers, so **no `uuid` or parser dependency was approved**. Multi-window
  settings consistency and updater ownership remain separate blocking majors
  because neither belongs inside the pane transaction. Pointer capture evidence
  remains macOS-only (294 outside-window events over 6.4 s, one display,
  `scaleFactor = 2`); WebView2 and mixed-DPI are still hard gates before drag.

- The token usage dashboard is decided at spec level (2026-08-10),
  [spec](docs/specs/2026-08-10-token-usage-dashboard-design.md) `decided`.
  **Not implemented — no code written, plan not started, spec pending user
  review.** Machine-wide aggregates for Claude Code + Codex v1 — per-pane
  attribution was deliberately rejected, which deletes the pane→session
  mapping problem. Raw token counts plus USD estimated from a pinned LiteLLM
  pricing snapshot shipped in the bundle (approved bundle fork); a dedicated
  full-window `UsageScreen` with three entry points (ChromeActions button in
  both layouts, ⌘⇧U / Ctrl+Shift+U + View-menu item, Settings › agents link
  row). An external Codex review of the first strategy returned **not-sound**
  and was accepted in full; the four blockers reshaped ingestion: Codex
  usage is per-event cumulative **deltas** (last-snapshot misattributes
  multi-day, multi-model sessions), the Claude dedupe cache stores
  **contribution maps** keyed by `message.id`+`requestId` (a seen-set cannot
  express last-wins across offset resumes), the scan glob includes
  `subagents/*.jsonl` (~47% of Claude history by size on the dev machine),
  and the schema keeps six counter classes separate (Codex `cached_input` is
  a subset of input; Claude 5m/1h cache tiers price differently). Two R2
  forks approved: DL §11 generalizes to full-window screens, and a new
  read-only data-table §. No new dependencies, Rust or npm.

- Pane detach, **Phase A implemented 2026-08-10** against
  [the plan](docs/plans/2026-08-10-pane-detach-window.md) `current`, task by
  task. What landed: the Rust transfer transaction (`PaneRoute` under one
  lock, five commands, the 10 s / 4 MB bounds, the §7.6 window-death table and
  owner validation on `write_pty`/`resize_pty`/`kill_pty`); the window
  lifecycle (`deck-<n>` labels, boot mode, `open_pane_window`, per-window
  close, the quit single-flight and its Rust busy census, the settings
  patch-merge, the updater single-flight, the `Move Pane to Window ▸`
  submenu); and the frontend (`flush`/`serializeScrollback` on `Pane`, the
  detach and adopt orchestrators, `dockNewPane`, live-adopt into a new tab,
  boot-adopt, and the `move-pane-to-new-window` action on ⌘⇧M / Ctrl+Shift+M —
  `m` was free on both keymaps and macOS's Cocoa ⌘M Minimize does not claim
  the Shift variant). Behaviour changes worth naming: the **last tab now
  closes its window instead of quitting the app**, the frontend no longer
  registers `onCloseRequested` (Tauri auto-prevented every close through it),
  and the quit/close census is computed in Rust so a wedged webview can no
  longer make ⌘Q unanswerable. One new dependency, pre-approved by the spec:
  `@xterm/addon-serialize@0.14.0`, +7.7 kB gzip on the bundle (172.68 →
  180.40 kB). Two contract gaps the plan added over the spec and that are now
  load-bearing: **`stage_transfer`** (the source has no route to hand its
  serialized buffer to `claim_transfer` otherwise) and **`transfer:settled`**
  (after staging, the source has no other signal, so `awaitOutcome` rides
  that event and `offerTransfer` must `Err` on a dead label rather than let
  `emit_to` succeed silently). **Not verified: every claim that needs a real
  window.** `npm test`, `npm run build`, `cargo test` and
  `generate:menu:check` are green, and none of them cross the IPC boundary —
  the wave-4 manual pass in `docs/CONTEXT.md` is still outstanding.
  **Phase B (cross-window drag, section D) is NOT implemented and remains
  gated** on the plan's §0.7 Windows pointer-capture re-measurement, for which
  no machine exists today.

  **Verified on a real window 2026-08-10, after one bug the gates could not
  see.** The first ⌘⇧M failed because `open_pane_window` declared a single
  `args: OpenPaneWindowArgs` parameter while the frontend sent the frozen
  contract's flat `{ token, screenX?, screenY? }` — Tauri resolves each command
  parameter by looking its camelCased name up in the invoke payload, so it
  demanded a key named `args`. Exactly the silent-green class the plan's §0.6
  warned about. Fixed by taking the arguments flat, and
  [`scripts/ipc-contract.test.ts`](scripts/ipc-contract.test.ts) `current` now
  parses both sides and fails on any command whose required payload keys a call
  site does not send — the only gate here that crosses the IPC boundary. **Do
  not fold those three parameters back into a struct.** After the fix, detach
  and scrollback replay were confirmed by hand; the rest of the manual pass in
  [`docs/CONTEXT.md`](docs/CONTEXT.md) `current` is still outstanding.

  **One fork resolved on the day 2026-08-10, covered by neither spec nor plan:**
  ⌘⇧M from a window holding exactly one pane is a **no-op with a message**, not
  a move. Moving it would close this window and open another holding the same
  pane — geometry lost, and the pane risked through a whole transaction for no
  observable change. The condition is **window-level, not tab-level** (a second
  tab keeps the window alive, so splitting that tab out is still a real move),
  and **only the new-window target is guarded** — offering the pane to an
  existing window merges it and stays meaningful from a one-pane window, which
  is what the plan's Phase B manual item 8 asks for. The plan had weighed a
  one-pane window only for the _drag_ path (Task D9).

- **Leaving Tauri for Electron is decided at prep level (2026-08-11)** —
  [prep plan](docs/plans/2026-08-11-electron-migration-prep.md) `current`,
  [design spec](docs/specs/2026-08-11-electron-migration-design.md) `decided`.
  **No product code is written and none may be until that spec is approved and
  the spike clears its gates.** The reason is ship speed and DX, not a technical
  defect in Tauri: the host becomes a full rewrite in Node/TS (`node-pty`,
  `BrowserWindow`, `electron-updater`), and both a Rust NAPI/sidecar and a
  long-lived dual runtime were rejected because either one keeps the Rust
  toolchain that motivates the move. Four calls, each with its reason:
  **Tauri features are frozen** — hotfixes still ship to `releases/latest` and
  the Windows preview, but the token usage dashboard and pane-detach Phase B
  now land on Electron only, so nothing new is written twice. **The freeze ends
  on gates, not on a date** (§5-B resolved 2026-08-11): it lifts when gates A,
  B and C each reach a conclusion — pass or abort — because a calendar deadline
  against a motivation that has never been measured in hours would only be
  guessed. The standing risk is a freeze that runs long if a gate hangs;
  Gate C is hardware-blocked today, so that risk is live and named rather than
  discovered later. **The Apple Developer Program gets bought** — Deck ships
  unsigned on macOS today and the Tauri updater tolerates it by verifying its
  own Minisign signature, but `electron-updater` goes through Squirrel.Mac,
  which refuses an app that is not Developer ID signed and notarized. Without a
  paid identity there is no macOS auto-update at all. **Not bought as of
  2026-08-11**, which blocks Gate A. Windows stays unsigned preview (the B2
  decision); whether `electron-updater` updates an unsigned NSIS build is a
  spike question, not an assumption. **Cutover is a clean install with no data
  migration** — settings, workspaces, presets, prompt templates and
  `customAgents` do not come across, which deletes the Minisign key reuse, the
  handoff release, the `migrate.rs` equivalent and any export/import UI. The
  cost is accepted knowingly: a user with a configured prompt board has a
  genuine reason to stay on 0.12.x, so a final Tauri release must say in its
  notes that the next version is a manual download, and a doc page must name
  the old store path. **Work is isolated in a dedicated branch and worktree**
  (`electron-migration` at `~/Documents/Development/spacevibe-deck-worktrees/`),
  because Electron pulls native `node-pty` and Electron binaries that fight
  `npm install` in a checkout that must stay ready for Tauri hotfixes. Docs and
  fork edits may happen on the primary checkout; anything adding Electron deps
  runs only in the worktree. **"No Electron" stops being a proof point**
  (§5-A resolved 2026-08-11): the landing and README lead instead with "no
  accounts, no telemetry" and promote "made for agent CLIs" — deliberately not
  a performance claim, since Electron would make one false. That copy edit
  belongs to the cutover plan, not to prep; [`README.md`](README.md) `current`
  and [`copy.js`](marketing/landing-prototype/src/copy.js) `current` still say
  "no Electron" and stay true until the cutover ships.

  **Spec approved and the gate sequence OVERRIDDEN by the owner, 2026-08-11.**
  The design spec is approved; the Electron MVP starts now, with **Gate A
  (no Apple identity) and Gate C (no Windows machine) still open**. Both the
  prep plan and the spec said the MVP plan may only be authored after all
  three gates conclude, and that ordering is knowingly set aside — the owner
  asked to go full twice, after being told the spike was ~1% of the app. The
  accepted risk is stated rather than discovered later: **a Gate C abort can
  still kill this branch**, and the MVP work would be sunk with it. The abort
  criterion itself is unchanged — if Windows kill-tree or process
  classification needs a native addon, decision 2 reopens explicitly.
  Consequently the MVP is macOS-only in substance: the Windows platform module
  is a **stub that names Gate C**, not a port of
  [`process_snapshot.rs`](src-tauri/src/platform/windows/process_snapshot.rs) `current`,
  because porting 682 lines with no machine to run them would manufacture
  false confidence. Work order and scope live in the
  [MVP plan](docs/plans/2026-08-11-electron-mvp.md) `building`.

  **`pty_info` cannot be served by `node-pty` — decided on evidence
  2026-08-11, not a fork** (no AGENTS fork category covers it; `ps`/`lsof` are
  OS binaries, not shipped dependencies). Probes showed `node-pty`'s
  `.process` returns the **wrong string**: for a real `claude` pane it
  answered `"2.1.227"` (the CLI's version banner) and for a renamed job it
  answered the executable name instead of argv0. Deck classifies panes by
  argv0 — that is why [`macos.rs`](src-tauri/src/platform/macos.rs) `current`
  reads `KERN_PROCARGS2` rather than `p_comm` — so trusting `.process` would
  label every agent pane `Busy` and silently kill the agent chip, the dot
  colour and attention state. The Electron host instead runs one
  `ps -A -o pid=,pgid=,tpgid=,tty=,args=` per poll tick and joins foreground
  jobs by tty → `tpgid` → `pgid`, mirroring `argv0_name` including the `-zsh`
  dash strip. Measured: 717 rows in **69 ms**, against a 2 s poll interval, so
  it fits with room to spare. `cwd` keeps coming from OSC 9;9 shell
  integration as it does today; `lsof` is only the fallback and stays off the
  hot path.

**Forks → STOP and ask before writing code.** Collect them into ONE round at the start
of the task; if there are none, say "no forks" and just go.

- The load-bearing `src-tauri` seams: PTY, window coordinator, tab materialize, layout
  engine, close coordinator (R4).
- Bundle, signing, release or version config.
- Changes to the design language rules in `docs/DESIGN-LANGUAGE.md` (R2).
- Adding a dependency, or anything that changes what ships in the app bundle.

Not a fork: renaming internals, adding tests, styling within the existing DL rules,
editing the menu registry (never the generated output — R3).

**Write the answer down.** When the user resolves a fork, it MUST be recorded in the
"In flight" list within the same task, with a one-line reason; until it is written, the
work is not done. This list is a QUEUE, not an archive: once a thread closes, move the
decision down into `docs/ARCHITECTURE.md`.

**Prove it with commands** (L5/W4 — no output, no "done"): `npm test` ·
`npm run build` (this is `tsc && vite build`, so it covers typecheck). No separate
`lint` script in this repo. Note this repo uses **npm**, not pnpm like the web repos.

## Common commands

| Command                 | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server (web-only preview)                                  |
| `npm run tauri dev`     | full desktop app                                                    |
| `npm test`              | Vitest unit tests                                                   |
| `npm run build`         | typecheck + production build                                        |
| `npm run generate:menu` | regenerate menu from registry — never hand-edit generated menu code |
| `npm run video:render`  | render the marketing video from the DOM stage                       |

## Layout

```
src/                 # Preact UI
├─ chrome/           #   window chrome, tabs
├─ terminal/         #   xterm.js panes
├─ open-board/       #   workspace board (open/recents)
├─ presets/          #   layout presets
├─ settings/         #   settings UI + stores
└─ lib/              #   pure helpers
src-tauri/src/       # Rust: pty, window coordinator, menu, migrate…
marketing/           # marketing video stage (shares components with the app)
docs/                # DESIGN-LANGUAGE.md (DL rulebook), CONTEXT.md, specs/, plans/, review/
```

## Repo rules (R-rules — delta from the global standard)

- **R1.** English only for every string, comment and doc — no Vietnamese in this repo.
- **R2.** Chrome UI styling follows `docs/DESIGN-LANGUAGE.md`; rules are numbered (`DL-3.2`) and cited from code comments. Fix a violation → update the ledger at the bottom of that doc.
- **R3.** Menu code is generated (`npm run generate:menu`, checked by `generate:menu:check` in CI) — edit the registry, not the output.
- **R4.** The Rust PTY/window coordinator, tab materialize, layout engine and close-coordinator paths are load-bearing seams — treat `src-tauri` module boundaries as in-flight when planning changes there.
- **R5.** State is Preact signals; module stores are window-scoped.

## Known traps

- The ADR pipeline (`docs/decisions/`, PIPELINE.lock, derived docs) was removed on 2026-07-27 — old plans/reviews still reference it; they are point-in-time records, leave them as written.
- Marketing video renders from the DOM through a virtual clock and shares the app stage — breaking app components can silently break the video.

## Language

- Docs/comments: **English only**. Commit messages: English, conventional commits.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

Empty as of 2026-08-04: the v0.8.0 row was cleared when v0.10.0 became the
release in flight. Do not remove this section (D7).
