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

- **A file explorer panel is decided at spec level (2026-08-12)**,
  [spec](docs/specs/2026-08-12-file-explorer-design.md) `decided`,
  [plan](docs/plans/2026-08-12-file-explorer.md) `planned` (written 2026-08-12).
  **Not implemented — no code written, spec pending user review.** The plan
  reopens none of the seven calls below; it did surface four facts by reading
  the Electron branch. **Gate M is blocked on MVP T19**, because
  `npm run electron:build` compiles the main process and does not package —
  there is no `build` key and no electron-builder config, so a packaged build
  does not exist to test Monaco in. **`npm run test:main` does not exist** —
  host tests are `electron/**/*.test.ts` and `npm test` already runs them.
  **There is no CSP today**, so Gate M proves `file://` worker resolution only
  and must be re-run if one is ever added. And **⌘Q with only file tabs open
  would not ask**: `before-quit` returns early when `coordinator.allPanes()` is
  empty, which is exactly §6's predicted defect already sitting in the code.
  A docked column on the right of the `.window` grid holding a file tree of the
  active workspace; clicking a file opens it as a **tab beside the terminal
  tabs**, editable and saveable in Monaco. Electron only — nothing here ships on
  Tauri. Seven calls, each with its reason: **it lands after the MVP closes**
  (T18 manual pass + T19 packaging), in the Electron-only feature queue beside
  the token dashboard and pane-detach Phase B — folding a new feature into a
  scope that is 10,504 lines of Rust rewritten and smoke-verified only would
  move the parity bar mid-flight. **State is keyed by `workspacePath`, one
  explorer per workspace** — a tab already fixes that path at Open and never
  re-derives it from a live CWD, so an agent's `cd` cannot move the tree; the
  cost is that switching to a terminal tab in another workspace swaps which
  file tabs are visible. **State is per window, in memory, not persisted** —
  this reverses the brainstormed assumption that two windows on one workspace
  share file tabs, because Deck has no session restore (file tabs would be the
  only restored UI state) and cross-window sync is already a named blocking
  major; the accepted consequence is that the same file open in two windows
  resolves last-save-wins, surfaced through the external-change bar. **File
  tabs live in a store BESIDE `TabManager`, not inside `TabView`** — `syncViews`
  rebuilds `tabViews` from the 2 s process poll, so a PTY-less tab would have to
  survive a rebuild whose only input is process information, inside an R4 seam
  freshly ported and not yet manually verified; a bug there would be
  indistinguishable from a port bug. **Clicking opens a preview tab (italic,
  replaced by the next click), promoted by double-click or first edit** — the
  first edit promotes, so replacing a preview never discards work. **⌘1..9 stay
  terminal-only** because file tabs open and close constantly and digit slots
  would renumber several times a minute; ⌘⇧] / ⌘⇧[ reach them instead. **The
  toggle is ⌘⇧B / Ctrl+Shift+B** — `b` is free on both keymaps; `⌘⇧E` was
  dropped on evidence because `Ctrl+Shift+E` is already `toggle-expand` on
  Windows. Three approved dependencies: **Monaco, a virtual list, a file-type
  icon set** — Monaco is the largest addition this repo has made (renderer
  bundle is 180.40 kB gzip today), so it is lazily imported on the first file
  tab and its language set enumerated, with **Gate M** — Monaco boots, edits and
  saves in a _packaged_ build — required before any explorer UI is written,
  because the MVP was already bitten twice by silent packaging failures
  (absolute Vite asset paths under `file://`, CommonJS/ESM mismatch). DESIGN
  LANGUAGE gains **§15 (docked side panels)** — an approved R2 fork; a
  permanently docked column is a surface class §11 (full-window) and §13
  (popover) do not cover. Deliberately left open: `.gitignore` is not parsed in
  v1 (a matcher is a fork), git decoration in the tree, and whether file-type
  icons may be colored — DL-15.5 recommends monochrome because §3's color roles
  are strict and each hue already means something. The load-bearing detail for
  whoever implements it: **all three exits must respect a dirty file** — ⌘Q,
  window close, and tab close — and since the census is computed in main while
  dirty state lives in Monaco, the renderer pushes a dirty-registry delta whose
  entries are cleared on window death, failing toward asking.

- **A Shortcuts settings category shipped on the Electron branch (2026-08-11)** —
  every action, the chord it answers to on each platform, and a way to change
  it. Four forks resolved with the user, each with its reason: **(1) it rebinds,
  not just displays** — the user chose the editable option over a read-only
  cheat sheet, so the work is a keymap override layer rather than a list;
  **(2) it lands on `electron-migration`, not `main`** — the Tauri freeze is
  honoured to the letter, so Tauri 0.12.x does not get it and the code merges
  forward with the branch; **(3) DESIGN LANGUAGE gains a real §15 (shortcut
  rows)**, not an extension of §6 — a row shows the same setting on two
  platforms with only one editable, which §5's one-interactive-value rule
  cannot express. **This takes the §15 number: the unimplemented file-explorer
  spec's "§15 (docked side panels)" must renumber when it is written**, as must
  the token-dashboard spec's data-table §; **(4) both keymaps are shown at
  once**, the running platform's chord as the editable pill and the other as a
  read-only readout — a chord can only be RECORDED on the keyboard that
  produces it, so offering to capture a Windows chord on a Mac would be a lie.
  What is load-bearing and easy to break: the **native menu must be rebuilt on
  every rebind, and its accelerators suspended while a chord is being
  recorded**. Cocoa consumes an accelerator before the webview sees the
  keydown, so a menu still advertising the old chord runs the OLD action, and
  without suspension pressing ⌘W to rebind `close-pane` closes the pane instead
  of being recorded — that is most of the interesting actions. Both halves are
  covered (`electron/menu.test.ts`, the `shortcutCaptureActive` gate in
  `tab-manager.ts`). Overrides are stored per platform and per action, an empty
  list means "unbound" and an absent key means "default" — confusing the two
  turns reset into unbind. A collision is **reported on both rows, never
  refused**, because swapping two actions' chords must pass through a colliding
  state. Deliberately left open: rebinding the non-running platform, and
  multiple chords per action (the store holds a list, the UI writes one).
  **Not verified: anything needing a real window or a packaged build** — the
  accelerator suspension and the menu rebuild are asserted against a mocked
  `electron` module, not observed in Cocoa, so they inherit the Electron MVP's
  outstanding manual pass. One bug the tests did catch and the design missed:
  reserving Tab wholesale left Windows' shipped `Ctrl+Tab` / `Ctrl+Shift+Tab`
  impossible to re-record; only BARE Tab is reserved now, for focus escape.

  **Reviewed by three parallel agents on 2026-08-11 and repaired; two of the
  findings were blockers, and the green suite could not see either.** (1)
  `acceleratorFor` hardcoded `["CmdOrCtrl"]` and never read `binding.meta`,
  which was safe only while every macOS menu binding shipped with `meta` —
  rebinding Find to ⇧D produced `CmdOrCtrl+Shift+D`, i.e. `split-column`'s
  chord, so **Split Horizontally silently stopped working** and nothing
  reported it, because the collision existed only in the generated accelerator
  and never in the resolved keymap `chordConflicts` scans. Accelerators are now
  built from the binding's own modifiers with a named-key table, and a chord
  that cannot be spelled installs NO accelerator rather than a wrong one.
  (2) Shift counted as a sufficient modifier, so `Shift+A` was bindable —
  taking capital A from every pane, and making Shift+Enter (the agent newline
  in `shift-enter.ts`, not a registry action and therefore unreportable as a
  conflict) silently stealable. Admissibility is now one rule,
  `isAdmissibleChord`, applied at capture **and** at load, so a hand-edited
  `settings.json` can no longer bind what the UI refuses. Four more: bare
  arrows/Home/End were bindable and cost every pane its shell history (the
  "produces no character" justification was simply wrong — they send escape
  sequences); override-vs-override ordering was **inverted**, so re-confirming
  the chord you wanted handed it to the action you didn't; the suspension flag
  was an unowned global in main that a window dying mid-record left stuck for
  the whole app, and that one window un-suspended out from under another
  (now a `Set` keyed by sender, cleared on `closed` and `render-process-gone`);
  and `check-for-updates`/`open-release-notes` had editable pills over actions
  `dispatchAction` cannot run — they are excluded, with a test asserting the
  exclusion equals exactly the non-dispatchable set. DL gains **DL-15.8**
  (a refused keystroke says why) and DL-15.6 now describes what reset actually
  removes. The one coverage hole worth naming: **nothing tested that
  `activeKeymap()` — the only consumer on the keydown path — picks up a
  rebind**; `active-keymap.test.ts` now drives `matchBinding` with no keymap
  argument.

- **The shipped Windows preview answers Ctrl+R and Ctrl+W with actions Deck
  never asked for (found 2026-08-11, fixed).** `buildMenu` returned early on
  non-darwin without calling `Menu.setApplicationMenu`, and Electron installs
  its DEFAULT menu whenever an app never sets one. `titleBarStyle:
"hiddenInset"` makes the window frameless on Windows too, so the menu **bar**
  is skipped while its accelerators are already registered — invisible, and
  live. `WINDOWS_KEYMAP` binds none of Ctrl+R/W/A/Z/M, so nothing contested
  them: **Ctrl+R reloaded the renderer and Ctrl+W closed the window**, while
  Deck's own close-pane sits on Ctrl+Shift+W. Fixed by passing `null`
  explicitly. Unrelated to the Shortcuts feature and older than it. **Not
  observed on a Windows machine** — the repo half is verified, the Electron
  half is read from `root_view.cc`/`native_window.cc`, and Gate C still has no
  hardware.

- **"Cocoa consumes an accelerator before the webview sees the keydown" is a
  Tauri-era belief that may be FALSE on Electron (raised 2026-08-11, not
  settled).** It appears in ten places — `action-registry.ts`, `tab-manager.ts`,
  `app.tsx` and now `keybindings.ts`/`menu.ts` — and was carried across the host
  migration without re-testing. Chromium's `RenderWidgetHostViewCocoa` claims
  ⌘-chords through `performKeyEquivalent:` and forwards them to the renderer;
  the main menu is reached only on the UNHANDLED path, so a renderer
  `preventDefault()` already stops the menu item. VS Code rebinds ⌘C/⌘V on
  macOS with nothing but a `preventDefault` on an input — no menu suspension at
  all. If that holds, Deck's whole accelerator-suspension mechanism is
  redundant. **Two-minute test settles it: open Shortcuts, click a pill, press
  ⌘Z.** Separately confirmed from Electron source: a `role:` item's accelerator
  CANNOT be stripped (`MenuItem` backfills the role default over both
  `undefined` and `null` via loose `==`, then freezes the property), so the ~10
  role chords are outside the current mechanism either way. The purpose-built
  API is `webContents.setIgnoreMenuShortcuts()`, which covers roles and needs no
  rebuild — deferred until the two-minute test says which problem is real.

- **A chrome gallery landed 2026-08-12** — a second Vite entry,
  [`gallery.html`](gallery.html) `current` → [`src/gallery/`](src/gallery/main.tsx) `current`,
  served by `npm run prototype:gallery` on `127.0.0.1:5175`. It exists because the
  visual system is about to be constrained (numeric scales, interaction states,
  overlay genres) and one running app is a poor place to judge it: a live window
  shows exactly one state at a time, while the questions being asked are
  comparative — both tab-bar positions, all seven update phases, every attention
  kind, both modals, the two popovers whose frames disagree. `npm run dev` is
  **not** blocked, which was checked rather than assumed: every boot IPC call
  catches its own failure (`window_boot_mode failed; booting normally`,
  `Failed to load settings, using defaults`), so the app shell and the Open
  board do paint in a plain browser — the "web-only preview" claim in this file
  is accurate. What it cannot do is persist a setting, list prompt assets or
  reach a second state without being driven there, which is what the gallery's
  IPC stub and seeded signals supply. **No DL rule was changed, no
  dependency added, nothing in the app bundle moved**, so no fork category was
  touched; the placement question was the user's call and the answer was `main`,
  because a dev harness carries over to Electron unchanged. Four calls, each with
  its reason: **real components, never a mock** — `marketing/stage/appwin.js` is
  already a hand-written second copy of the chrome and it has drifted (it holds
  Tokyo Night at 60% saturation for the landing's sake), so the gallery mounts
  `DesktopChrome`, `TabBar`, `WorkspaceSidebar`, `StatusBar`, `SettingsScreen`,
  `TabPopover`, `PromptPopover`, `PresetEditor`, `SavePresetDialog` and
  `OpenBoard` directly, plus every real settings section for the seven value
  kinds. **A root entry, not a folder under `marketing/`** — `vite marketing`
  resolves its config from that root, where none exists, so there is no Preact
  plugin and `.tsx` does not compile (which is why the landing prototype is
  plain JS with HTML strings). At the repo root it inherits `vite.config.ts`,
  and `vite build` walks `index.html` only, so the bundle is untouched —
  verified 180.47 kB gzip with no gallery code in `dist/`, and
  [`scripts/gallery-entry.test.ts`](scripts/gallery-entry.test.ts) `current`
  fails if any app module ever imports from `src/gallery/`. **Tauri IPC is
  stubbed** in `src/gallery/host-stub.ts` (named `tauri-stub.ts` until it grew
  the Electron hook too), installed as an import side effect
  because ES imports hoist and a call at the top of the entry would still run
  after every module below it; unknown commands resolve `null` and are listed
  in the page footer rather than only console-warned. **No direction picker
  yet** — a redesign direction will be a block of token overrides, and nothing
  honest can sit behind that switch until a direction is chosen; theme
  switching goes through the real `updateSettings` → `applyThemeVars` path, so
  what the specimens show is what Settings would give. One app-code change came
  with it: the CSS-var block was lifted out of `app.tsx`'s theme effect into
  [`applyThemeVars`](src/lib/theme-vars.ts) `current`, behaviour unchanged, so
  the gallery cannot become a second copy of that list. Deliberately absent:
  `.search-bar` (built imperatively against a live `Pane`, so a specimen would
  mean re-typing its DOM) and `.zoom-overlay` (it paints `var(--bg)` and
  nothing else). **What it measured live**, replacing the counts that used to
  be quoted from memory: 11 font sizes, 13 radii, **23 spacing steps**, 12
  durations, 11 `z-index` layers, 12 distinct `--fg` state mixes and 20
  `--accent` mixes all chosen at use sites, and 3 hardcoded colours
  (`.btn--primary` `#000`, `.search-bar`'s rgba shadow — the DL-1.3 violation
  already in §10 — and a `white` inside `.drop-overlay.is-swap`'s `color-mix`).
  Two of those numbers were **wrong in the first version and were corrected on
  2026-08-12 after the external Codex review below**: the audit counted whole
  declaration strings, so `padding: 6px 14px` read as one value and the total
  came out 67 instead of 23 actual steps, and the colour scan matched hex and
  `rgb()` only, so the `white` was invisible. Named colours are now scanned
  from `cssText` with the name fenced as `(?<![-\w])…(?![-\w])`, which is what
  keeps `white-space` and `var(--red)` from reading as violations. The
  constraint work itself is **not started**; the sequencing decided with it is
  that DL freezes **which** scales exist while the redesign chooses their
  **values**, so the rulebook is not written twice.
- **A browser panel with react-grab Inspect shipped on the Electron branch
  (2026-08-12)** — a docked column on the right of the stage that loads a dev
  server, and an Inspect mode that turns any element on that page into
  component-and-source context pasted straight into the focused agent pane.
  Four forks resolved with the user, each with its reason: **(1) it is a docked
  column, not a pane, a tab or a separate window** — a pane would have reopened
  the R4 layout/pane-lifecycle seams for a surface that is not a PTY, while a
  tab could not show the page and the agent at once, which is the entire loop;
  **(2) react-grab is a vendored, pinned `dist/index.global.js`, not an npm
  dependency** — the script is injected into someone else's page, so a
  dependency entry buys no typing, no bundling and no tree shaking, and would
  add a `react >= 17` peer plus `bippy` to a repo with no React; the committed
  bytes are the reviewed bytes, hash-locked by a test against
  [`SOURCE.md`](electron/vendor/react-grab/SOURCE.md) `current`; **(3) a grab
  goes into the focused pane AND stays on the clipboard** — the clipboard half
  is free, because our `getContent` hook returns the same string react-grab
  copies, which also makes "no pane to paste into" a message rather than a lost
  selection; **(4) MVP straight to code**, no spec round, decisions recorded
  here.
  Calls made while building, each with its reason: **a grab is NEVER submitted**
  — not even behind the Prompt Board's triple gate, because that gate answers
  "is this pane ready for input", not "did a human write this", and the text
  comes from a page Deck did not write; the grab text is stripped of every C0
  control on the way in, since a paste rides bracketed-paste and an embedded
  `ESC[201~` would close the bracket and leave the rest being read as
  keystrokes. **Telemetry is off** — react-grab's default is a version-check
  request to react-grab.com on every init, and it can only be set at `init()`,
  so the bootstrap sets `__REACT_GRAB_DISABLED__` before the bundle runs and
  initialises it itself. **The chord is ⌘⇧I / Ctrl+Shift+I** — `i` for Inspect,
  free on both keymaps; **`b` was deliberately left alone** because the
  file-explorer spec reserves ⌘⇧B for its own docked panel, and the two specs
  now claim the same slot on the right of the stage — whoever builds the
  explorer resolves that, it is not resolved here. DESIGN LANGUAGE gains a real
  **§17 (docked side panels)**, an approved R2 fork. It is 17 and not 16
  because the branch's own frame work already cites `DL-16` from nine places
  in `src/` — that rule's text is still unwritten and now carries a drift-ledger
  row in the rulebook. The explorer spec's "§15 (docked side panels)" was
  already stale (Shortcuts took §15) and folds into §17 when it is built.
  **Verified in a real Electron window**, not only against mocks: the smoke
  harness now boots the host, serves a local page into the panel and asserts
  the whole chain — the bundle reaches the page's MAIN world (an isolated world
  sees no React fiber expandos, which would silently reduce every grab to plain
  HTML), a grab crosses page → preload → IPC → renderer, Inspect arms the page,
  **no request reaches react-grab.com**, and closing the panel destroys the
  page. 22/24 smoke checks pass; the two failures predate this work and are the
  Linux container (`platform=unsupported`, and cwd with no shell integration).
  That run found two things the mocked suite could not: `window.__REACT_GRAB__`
  was never set because disabling self-init also skips its `setGlobalApi`, and
  `generateSnippet` can fail to settle in a throttled frame — so `getContent`
  now races a 2 s deadline and falls back to the element's markup, since that
  hook sits between ⌘C and BOTH destinations. **Not verified: a real React dev
  server.** Component names and `file:line` come from react-grab reading React's
  fiber, and no React app was available here — the transport is proven, the
  richness of what it carries is upstream's behaviour. Also unverified on
  Windows, like everything else on this branch (Gate C). One knock-on worth
  knowing: the menu is generated from `ACTION_REGISTRY`, which both hosts
  share, so R3's regenerated
  [`menu_registry.rs`](src-tauri/src/menu_registry.rs) `current` now carries a
  View ▸ Browser item the Tauri build cannot serve. It is inert there rather
  than broken, and it only ever matters if Gate C aborts the migration — in
  which case this feature comes out whole.

  **A code review of that commit returned 15 findings; 14 were real
  (2026-08-12) and all are fixed.** The three that mattered: (1) any page in
  the panel could **forge the grab event** — no gesture check, no rate limit —
  and paste into the focused pane at will; the gate now lives in the preload's
  isolated world and keys off `isTrusted`, which page script cannot set, with a
  rate limit at both ends. (2) `sanitizeGrabText` stripped C0 but not **C1**,
  and `U+009B 201~` is the 8-bit CSI form of the same bracketed-paste escape it
  exists to block. (3) The panel hid its native view only for
  `overlayCoversPane()`, so the **Prompt Board popover** (`right: 0`, 320px)
  opened INSIDE the panel's column and was invisible behind it; the hide rule
  now covers every floating surface, and `tabPopoverOpen` was added to
  `chrome/events.ts` for the one bit the popovers' component-local state has to
  expose. Also fixed: the toggle **destroyed the page** instead of hiding it,
  so "reopening keeps the page" never actually happened (it rides `setVisible`
  now); `browserHomeUrl` had no UI at all, so Settings gains a **browser
  category**; and grabs were sent from `getContent`, which the bundle races
  against its own abort signal, so a cancelled copy still pasted — sending
  moved to the `onCopySuccess` / `onAfterCopy` plugin hooks. The one finding
  that did NOT survive verification: closing a window was said to throw out of
  the cleanup path and strand PTYs; a probe on Electron 43 showed
  `webContents.close()` there is a no-op, so it was downgraded to a guard.

  Two things the fixes themselves taught, both now locked by tests. An escape
  written `\n` inside `inject.ts`'s template literal is consumed by TypeScript
  and emits a REAL newline into the generated script: the whole injection was a
  SyntaxError and Inspect was dead on every page, while every `toContain`
  assertion still passed — the test now parses the script with `new Function`.
  And `dispatchEvent` cannot exercise the new gate, because a synthesised event
  is never trusted and `executeJavaScript(..., true)` marks user ACTIVATION,
  which is a different thing; only `sendInputEvent` into a focused view
  produces trust. The smoke harness now covers both sides — a forged grab is
  dropped, a REAL `copyElement` reaches the renderer — at 24/26, with the same
  two pre-existing Linux failures.

- **The chrome redesign toward the ChatGPT desktop feel is decided at fork
  level (2026-08-12)**, and the comparison matrix the review asked for is
  implemented on `main`. The redesign itself is **not started**: no DL section
  is written, no token scale exists in `:root`, no direction is designed.
  Three forks resolved with the user, each with its reason. **It lands on
  `electron-migration`, not `main`** — the Tauri freeze is honoured to the
  letter, exactly as the Shortcuts category was, and the frame it has to style
  only exists there: `5ef509a` collapsed the 26px title bar and the 33px tab
  bar into one 34px command row, so styling `main`'s two-row chrome would be
  designing a surface that is already gone. **DL freezes all nine scale groups
  from the review's §3 in one pass** — spacing, radius, type, weight, leading,
  duration/easing, border, control height, surface/state and layer — because
  closing them in two passes writes the rulebook twice; the split already
  decided still holds, DL says WHICH scales exist and the redesign picks their
  VALUES. **The neutral wash moves from `--fg` to `--tone` now**, without
  waiting for a live comparison: the matrix measured what today's rule
  resolves to, and the same 6% hover is `rgb(192, 202, 245)` on Tokyo Night,
  `rgb(248, 248, 242)` on Dracula and `rgb(171, 178, 191)` on One Dark — a
  wash carrying the theme's foreground hue, which "quiet neutral surfaces"
  cannot be built from. All four bundled presets are dark, so `--tone` is
  `#ffffff` in every one of them and the change shows on every surface.

  **The review's own section numbering is stale and must not be followed.** Its
  §4 says "§15 is already reserved for docked side panels, so these start at
  §16". On `electron-migration` §15 is written and is **Shortcut rows**, and
  **DL-16 is already claimed** by the command-row frame — cited from
  `styles.css`, `app.tsx`, `tab-bar.tsx` and `app.test.tsx`, with the rule
  itself still awaiting R2 approval. The three new sections take their numbers
  on that branch, against what is written there.

  **What landed on `main` (gallery only — the app bundle is unchanged at
  180.47 kB gzip, and `scripts/gallery-entry.test.ts` is what keeps that
  true):** a seventh gallery section carrying the review's §6 item 2 matrix —
  four themes across, five states down, both tab-bar positions, one size —
  plus a config-row block, which is where focus and disabled are legible and
  the window shell has almost nothing to show. Hover, active and focus are
  forced by [`force-states.ts`](src/gallery/force-states.ts) `current`, which
  reads the app's own rules back out of the live stylesheet and re-emits every
  one of them scoped under a marker class. **The whole sheet is copied, in
  source order, not only the rules carrying a pseudo-class** — copying only
  those would move them past every later rule in the file and a selected tab
  would start reading as a hovered one. `@media` rules are skipped: their
  condition is about the viewport and a cell is not one. **Cell width is 680px,
  measured rather than chosen** — below it the tab bar cannot fit four tabs
  beside the add button and six actions, so every label clips (at 560px the
  four labels get 7, 9, 0 and 4 pixels), and from 680 to 900 nothing changes.
  Two defects the four green gates could not see and the rendered screenshot
  did: the forced sheet re-applied the app's own `.window { height: 100vh;
width: 100vw }` at a specificity the gallery's cell override merely tied
  with, so every forced cell grew to the size of the viewport; and the
  sidebar's fourth workspace row was cut in half. **Still blocked:** the two or
  three real ChatGPT desktop screenshots (review §6 item 1) have not been
  supplied, so no direction is designed and no token value is picked.

  **The harness is now merge-ready for `electron-migration`, proven by merging
  it (2026-08-12).** It was not before, and a clean `git merge-tree` said
  nothing about it: `DesktopChromeProps` is identical on both branches and
  `app.tsx` merges coherently — the inline CSS-var block disappears and
  `applyThemeVars` takes over — but the stub installed only
  `window.__TAURI_INTERNALS__`, and that branch replaced it with
  `src/host/bridge.ts`, which reads `globalThis.__deckHost` and throws when it
  is absent. **29 non-test renderer modules** import that layer,
  `settings-store` among them. The failure would have been silent in the worst
  way: `unhandledCommands` only counts calls that reach the stub, so zero
  arriving would have printed "every IPC call the specimens made was answered
  by the stub" while nothing was stubbed at all. **Both hooks are installed
  now**, over one canned table split three ways — the channels both hosts share
  (`bridge.ts` kept Tauri's names), Tauri's `plugin:*`, and the Electron host's
  flat ones. The store shapes genuinely differ (resource id returning
  `[value, found]` versus file name returning the bare value), so both are
  answered against one backing map. Scale factor, focus and drag-drop are
  deliberately NOT stubbed for Electron: `window-host.ts` answers them from
  `devicePixelRatio`, `document.hasFocus()` and DOM drag events with no IPC
  hop, so a channel would invent a contract that does not exist.
  **`CELL_WIDTH` is 760px, the larger of the two frames' measured thresholds** —
  the collapsed DL-16 command row also gives up `--frame-lights-w` (78px) to
  the traffic lights, so labels clip until 760 there while this branch clears at
  680, and above each threshold nothing moves up to 900. **Verified on a real
  merge rather than asserted**: in a worktree holding the merged tree the
  gallery boots, all seven sections list, an unknown channel sent through
  `__deckHost` surfaces in the footer (so "all answered" is earned rather than a
  zero-call false positive), a `store_set`/`store_get` round-trip returns its
  value, ten settings sections and 78 config rows render, and cycling theme
  moves `--bg` from `#16161e` to `#282a36`. Gates on that merged tree: **1495
  tests / 129 files**, tsc, `generate:menu:check`, build 178.30 kB gzip. The
  only merge conflict is `AGENTS.md`, where both branches appended to this
  list.

  **Merged into this branch on 2026-08-12, and the merge itself was the last
  trap.** Between the dry run and the real one, `main`'s three visual-system
  commits arrived here with **rewritten hashes** (`0309502`, `160c78e`,
  `e2793d9`), so git no longer saw one history: it saw the gallery added twice
  and raised **add/add conflicts on nine files**. Seven of them were resolvable
  by provenance rather than by reading a diff — this branch's copy of every
  gallery file and of `theme-vars.ts` was verified byte-identical to `main`'s
  baseline, so "take the incoming side" is exactly "their content plus the
  changes made on top of it". The review doc took the opposite side, because
  the visual-system branch never touched it and this branch had corrected its
  §15 premise. `AGENTS.md` needed three different answers in three hunks, not a
  union: this branch's four new bullets, the incoming stub-path edit, and BOTH
  sides of the third. **The trap was `tauri-stub.ts`:** the rename to
  `host-stub.ts` happened on a commit whose identity no longer matched, so
  rename detection failed and the merge kept the old file alongside the new
  one — a dead duplicate of the module that is the harness's whole IPC truth,
  which nothing imported and nothing would have failed on. It was deleted by
  hand. **One statement inherited from the review is wrong on this branch**:
  its §4 now says "§16 is free on both branches", but `DL-16` is already cited
  here from `styles.css`, `app.tsx`, `tab-bar.tsx` and `app.test.tsx` for the
  command-row frame. Left as written rather than edited inside a merge; the
  numbering answer is the one above.

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
