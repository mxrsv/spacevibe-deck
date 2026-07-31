# Review — PR #7 `feat/windows-desktop`, pre-ship audit

- **Date:** 2026-07-30
- **Scope:** GitHub PR [#7](https://github.com/mxrsv/spacevibe-deck/pull/7), head `1a2e3d0`, diffed against `main` at `fa21b54` — 52 files, +4473/-442
- **Spec:** [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
- **Plans:** [implementation](../plans/2026-07-29-windows-desktop.md), [delivery](../plans/2026-07-29-windows-desktop-delivery.md)
- **Supersedes as the current verdict:** [2026-07-30-windows-desktop-preship-review.md](2026-07-30-windows-desktop-preship-review.md) (that record reviewed the pre-runtime checkpoint on `main`; its findings are adjudicated below)
- **Process:** ten independent auditors, one per risk dimension, each followed by an adversarial refuter, merged by an adjudicator that re-read the source for the top findings
- **Coverage gap:** the `concurrency-lifecycle` auditor died on a transport error and did not report. Nine of ten dimensions completed. Deadlock, teardown-ordering and macOS-regression ground is partially covered by A2, A3, A8 and C8 below, but this dimension was not swept on its own terms and should be re-run.
- **Verification environment:** macOS host; no Windows code was compiled or executed. Every finding is reasoned from source with file:line citations, and the items that need real hardware are listed as a manual QA checklist.

---

# PR #7 — Windows Desktop: Final Pre-Ship Adjudication

**Head:** `1a2e3d0157decb26b335371482fa32b0c85053aa` on `feat/windows-desktop`
**Question answered:** should a Windows installer be published from this branch?

---

## VERDICT: **BLOCK**

Not "ship as labeled engineering preview." Two independent reasons:

1. **On a stock Windows 11 machine the app is visibly broken before the user does anything.** No `pwsh.exe` means `powershell.exe` 5.1, which does not understand the `` `e `` escape the injected prompt uses. Every prompt line renders as literal `e]133;Ae]9;9;"C:\Users\dev"PS C:\Users\dev> e]133;B`, agent auto-launch never fires (15 s timeout, every pane, every time), and CWD tracking is dead. That is the product's headline feature, failing 100% deterministically, on the configuration the spec itself names as supported.
2. **There is no artifact to ship and no way to produce one.** `windows-engineering-bundle` is `workflow_dispatch`-only and throws unless the repo is private (`ci.yml:112`, `ci.yml:118-125`); the repo is public. No NSIS setup has ever been built. Gates W1–W4 have zero evidence.

Beyond those two: copy and paste do not work at all on Windows, closing a busy pane can hang the entire app, and one keystroke (F5) destroys every tab and orphans every PTY.

### Shortest honest list of what flips this to SHIP AS LABELED ENGINEERING PREVIEW

| # | Fix | Size |
|---|---|---|
| 1 | Replace `` `e `` with `$([char]27)` in `PROMPT_INTEGRATION` (`platform/windows/shell.rs:17,19,26`) | 3 chars ×3 |
| 2 | Move the `Session` drop and the `is_dir()` probe out from under `PtyState.sessions` (`pty.rs:403-414`, `pty.rs:146-168`) | ~20 lines |
| 3 | Reject `\\`-rooted candidates before any filesystem call in `retain_valid_cwd` / `resolve_one` / `validate_open_editor_request` | ~10 lines |
| 4 | Make copy/paste actually reachable **and** route paste through `terminal.paste()` — both in the same change (`action-registry.ts:671-672` + `terminal-clipboard.ts:43-53`) | ~15 lines |
| 5 | `with_browser_accelerator_keys(false)` on the main webview | 1 line |
| 6 | Move the WMI identity lookup off the spawn path (`platform/windows/mod.rs:33`) — or replace it with `GetProcessTimes` on the handle portable-pty already owns | ~10 lines |
| 7 | AltGr guard in `matchBinding`, or move `focus-next`/`focus-prev` off Ctrl+Alt+Bracket | ~5 lines |
| 8 | Commit README / ARCHITECTURE / CONTEXT (the SmartScreen warning is a spec precondition for handing testers an unsigned binary) | `git add` |
| 9 | Actually run the bundle job once and record the run URL + artifact name | 1 dispatch |
| 10 | Execute the manual QA checklist below on real hardware (Gates W1–W4) | ~1 hour |

Items 1–7 are under 100 lines of code combined. This is a **fixable** BLOCK, not a rearchitecture.

---

## Spot-check accounting

I re-read source for the top 11 findings. **3 dropped**, and I say why:

- **DROPPED — "NSIS install mode / `allowDowngrades` undeclared."** Both failure scenarios are refuted by the NSIS template: with `installMode: currentUser` the script compiles `RequestExecutionLevel user` and emits no per-machine option at all, and a downgrade renders an explicit `newerVersionInstalled` warning page rather than installing silently. Real nit, zero shipping impact.
- **DROPPED — "`open_editor` accepts `template` over IPC = arbitrary process execution."** The base commit (`git show fa21b54:src-tauri/src/links.rs`) took a renderer-supplied string straight into `$SHELL -lc`. This PR replaced that with a structured request, an `EditorId` parse, a shell-operator reject list, a canonical-existing-file check, and argv-not-shell execution. It is a large net hardening. And the same compromised renderer can already call `spawn_shell` + `write_pty` (`lib.rs:46-62`), so `open_editor` adds nothing an attacker did not have.
- **DROPPED — "WebView2 `downloadBootstrapper` silent gives an unactionable abort."** The template prints `webview2InstallError` = `"Error: Installing WebView2 failed with exit code $1"` before `Abort`, which satisfies spec §9. Supported target is Windows 11 x64, which ships the Evergreen runtime in-box.

Everything below survived my own read of the cited lines.

---

## A. SHIP BLOCKERS — code

### A1 (critical) PowerShell 5.1 cannot parse the prompt-integration escape — headline feature dead on stock Windows

`src-tauri/src/platform/windows/shell.rs:14-28`

```
:17   $out = "`e]133;A$([char]7)";
:19   $out += "`e]9;9;`"$($loc.ProviderPath)`"$([char]7)";
:26   $out += "`e]133;B$([char]7)";
```

`` `e `` was added in PowerShell **6.0** (`about_Special_Characters`). Windows PowerShell 5.1 drops the backtick before an unrecognised escape and keeps the literal `e`. `POWERSHELL_CANDIDATES` (`shell.rs:12`) falls back to `powershell.exe`, and `executable_candidates` (`shell.rs:62-71`) deliberately adds `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` — so 5.1 is a first-class path, and it is the **only** path on a stock Win11 box. Spec §9 line 347 mandates it: *"PowerShell 7 is absent → Fall back to Windows PowerShell."*

Downstream, verified end to end: `shell_integration.rs:3` `OSC_PREFIX = b"\x1b]"` can never match → no `PromptReady` → `pty:prompt-ready` (`pty.rs:170-181`) never emits → `notePromptReady` never called → every armed pane hits `WINDOWS_AGENT_LAUNCH_TIMEOUT_MS = 15_000` (`agent-launch.ts:8`) and lands in `cancelled` permanently (`arm` skips cancelled ids, `agent-launch.ts:126-132`), with one auto-dismissing 6 s toast that names no pane. `session.cwd` (`pty.rs:166`) stays `None` forever, so pane headers, split-inherit-cwd (`terminal-manager.ts:329`) and `git_branch` all degrade.

CI cannot see this: `windows-latest` ships pwsh 7, and the only test (`shell.rs:213-232`) substring-matches the **Rust literal** (`script.contains("]133;A")`), which a literal `e]133;A` also satisfies.

**Fix:** `$([char]27)` — valid in both hosts, exactly as `$([char]7)` already is on the same lines.

### A2 (high) `kill_pty` drops the ConPTY master under the global session mutex while the only thread that can drain the output pipe is blocked on that same mutex

`src-tauri/src/pty.rs:397-414`, `146-168`, `283-297`, `319`

`kill_pty` locks at `:403` and holds the guard to `:414`. `sessions.remove(&id);` at `:410` is a statement whose unused `Option<Session>` drops **at the semicolon**, under the guard. `Session` declares `master` first (`pty.rs:38`), and by that point it holds the last `Arc<Mutex<Inner>>` (`pty.rs:247` dropped the slave; `try_clone_reader`/`take_writer` hand out FileDescriptors, not Arc clones), so the drop reaches `PsuedoCon::drop` → `ClosePseudoConsole`.

The closing link is **new in this PR**: the diff adds `+consume_shell_integration(&output_app, id, &data);` at `pty.rs:319`, and that function locks the same mutex at `:149` on every output batch. The reader parks in `tx.send` (`:290`) once the 64-slot `sync_channel` (`:98`, `:283`) fills — the documented intended backpressure (`:94-97`).

Cycle: reader blocked in `tx.send` → emitter blocked in `sessions.lock()` → `kill_pty` holding the lock inside `ClosePseudoConsole` → conhost blocked writing into an undrained pipe → reader. Nothing breaks it. Worse than the finding's arithmetic implied: the ConPTY output pipe is `CreatePipe(..., nSize = 0)` (filedescriptor-0.8.3 `windows.rs:429`), i.e. the ~4 KiB system default — conhost blocks after ~4 KiB of unflushed output, not 512 KiB. And `kill_pty` is a **non-async** command (`pty.rs:397-402`), so on Tauri 2.11.5 it runs on the WebView2 message-pump thread: the window goes Not-Responding, not merely unresponsive to keys. `TerminateJobObject` kills PowerShell but not `OpenConsole.exe`, which is a child of the app and never in the pane job — so conhost is alive and still owes a flush.

**User-visible:** close a pane during `cargo build` / `npm ci` / streamed agent tokens → whole app freezes, all tabs, recovery only via Task Manager.

**Confidence:** structure is certain; the *"ClosePseudoConsole blocks"* premise needs hardware (QA item 4).

### A3 (high) Untrusted terminal output triggers a blocking filesystem probe under the same global mutex — freeze + outbound NTLM

`src-tauri/src/pty.rs:146-168` → `src-tauri/src/shell_integration.rs:85-93`

The lock taken at `pty.rs:149` is held across the fold at `:157-164`, which calls `retain_valid_cwd` at `:161`; that function does `path.is_absolute() && path.is_dir()` at `shell_integration.rs:88` — a real `CreateFileW` — on a string taken verbatim off the PTY (`parse_payload`, `:73-83`, accepts any `9;9;<anything>`, no nonce, no origin check, no root check).

Two triggers, both real:

- **Non-adversarial:** the injected prompt itself emits `$($loc.ProviderPath)` (`shell.rs:19`) on **every prompt**. A corporate user sitting in `Z:\proj` or `\\corp\projects` stats a network path under the global lock on every prompt redraw. `PathBuf::from(r"\\host\share").is_absolute()` is true on Windows (UNC prefix), so no guard exists.
- **Adversarial:** any program printing `ESC]9;9;"\\10.255.255.1\x"BEL` blocks in the MUP/SMB redirector (~21 s per dead-host attempt, WebDAV fallback longer) while holding the lock — and Windows offers the interactive user's NTLMv2 credentials to the named host. Amplifier: the fold processes **every** `CurrentDirectory` event in a batch, and a batch is up to `BATCH_MAX_BYTES = 64 KiB` (`pty.rs:102`) — hundreds of sequential network round trips in one lock hold.

Blocked consumers verified: `write_pty` (`:369`), `resize_pty` (`:382`), `kill_pty` (`:403`), `remove_session` (`:141`), `session_snapshots` (`:671`) — the first three are sync commands on the main thread, so this freezes the UI outright.

**Coupling warning:** dormant today because A1 means no ESC byte ever arrives. **Fixing A1 activates A3.** Fix both or neither.

### A4 (high) Copy and paste do not work on Windows — prior finding H1 re-implemented, not fixed

`src/terminal/action-registry.ts:671-672` + `src/terminal/tab-manager.ts:1093-1111, 1293`

`WINDOWS_KEYMAP` still claims both chords:
```
{ key: "c", ctrl: true, shift: true, action: "copy-selection" },
{ key: "v", ctrl: true, shift: true, action: "paste" },
```
`handleShortcut` is a **capture-phase** window listener (`tab-manager.ts:1293`); `isChromeTextField` (`:1017-1023`) explicitly excludes `.pane__term`, so it does not bail for terminal keystrokes; `matchBinding` lowercases `event.key` (`keymap.ts:59`) so `"C"` matches `"c"`; it then calls `event.preventDefault(); event.stopPropagation(); dispatchAction(action)` (`:1108-1110`), and `commands[action]?.()` (`:1066`) is a **silent no-op** — I read the entire table (`:860-936`): no `copy-selection`, no `paste`. I confirmed these are the only two orphaned ids in the whole keymap.

The new handler at `pane.ts:194-198` (`attachCustomKeyEventHandler`) lives on the xterm **textarea**, i.e. the event target — unreachable after capture-phase `stopPropagation()`. Reproduced in this repo's own jsdom.

No fallback exists: bare Ctrl+V becomes `^V` (0x16) and is cancelled by xterm; `menu.rs:1` gates the entire menu subsystem behind `#[cfg(target_os = "macos")]`, so there is no Edit ▸ Copy; and `capabilities/default.json:16-17` grants clipboard read/write to a caller that does not exist.

The test suite **certifies the bug**: `keymap.test.ts:342-343` asserts both chords resolve, and `action-registry.test.ts:56-57` asserts both ids exist. One ~5-line test — *every action in every keymap has a dispatch target* — would have caught this and prior H1.

### A5 (high, rides with A4) Paste writes raw clipboard bytes to the PTY: no bracketed paste, no CRLF normalization

`src/terminal/terminal-clipboard.ts:43-53`

`readText().then(send)`, where `send` is `(data) => events.onData(id, data)` (`pane.ts:193`) → `pty.writePty` (`pane-lifecycle.ts:62-73`) → `session.writer.write_all(data.as_bytes())` (`pty.rs:368-378`). It never calls `Terminal.paste()`, so it skips `prepareTextForTerminal` (`\r?\n` → `\r`) and `bracketTextForPaste` (DECSET 2004). Windows clipboard text is CRLF, and CR into a ConPTY is Enter for PSReadLine.

Currently unreachable because of A4 — **which is exactly why it is a blocker.** Fixing A4 turns a dead feature into a pastejacking / one-keystroke-execution hazard, and breaks multi-line prompts into N agent turns. Both must land in the same commit.

### A6 (high) WebView2 browser accelerator keys left enabled — F5 or Ctrl+R destroys the session and orphans every PTY

`src-tauri/tauri.windows.conf.json` (no webview settings at all)

Grepping `accelerator_keys|default_context_menus|browser_accelerator` across `src-tauri/src` and all `src-tauri/*.json` returns **nothing**, and nothing in tauri-runtime-wry sets it either — so wry's default stands (`wry-0.55.1/src/lib.rs:1687` `browser_accelerator_keys: true`), and the disabling call at `webview2/mod.rs:582-585` is inside `if !pl_attrs.browser_accelerator_keys` and never runs. Per `ICoreWebView2Settings3::put_AreBrowserAcceleratorKeysEnabled`, that keeps Ctrl+R / F5 (Reload), Ctrl+F / F3 (Find), Ctrl+P (Print) live.

No guard exists: grep for `beforeunload|unload|visibilitychange` over `src/` returns nothing, and `tab-manager.ts:1294-1295` documents that session restore was deliberately removed. `PtyState` is Tauri managed state (`pty.rs:55-56`) that survives a webview reload, and there is no `CloseRequested`/`on_window_event` handler — so every pre-reload session stays in the map with no listener draining it until the process exits.

Pane-focused F5 is cancelled by xterm; the exposure is **chrome-focused** F5/Ctrl+R (after clicking a tab or the gear), plus Ctrl+P and Ctrl+F everywhere. One keystroke = every tab, every pane, all scrollback gone, PTYs leaked. One-line fix.

### A7 (high) AltGr collides with Ctrl+Alt bracket chords — `[`, `]`, `~` untypeable on German / Spanish / Italian / Nordic layouts

`src/terminal/action-registry.ts:678-679`

```
{ code: "BracketRight", ctrl: true, alt: true, action: "focus-next" },
{ code: "BracketLeft",  ctrl: true, alt: true, action: "focus-prev" },
```
`matchBinding` (`keymap.ts:52-71`) compares only `metaKey/shiftKey/altKey/ctrlKey` — no `getModifierState("AltGraph")` anywhere in `src/`. Windows delivers AltGr as left-Ctrl + right-Alt, which Chromium surfaces as `ctrlKey && altKey`. **This repo's own dependency proves it**: xterm's `_isThirdLevelShift` (`CoreBrowserTerminal.ts:1105-1109`) exists solely to work around it. The app's capture handler runs first and `preventDefault()`s, suppressing character insertion. Because these are `code` bindings they hit the physical key on every layout.

Spanish/Italian: `[` = AltGr+BracketLeft, `]` = AltGr+BracketRight. German/Nordic: `~` = AltGr+BracketRight. A terminal where you cannot type `[`, `]` or `~` and instead the focus jumps panes.

*(The Ctrl+Alt **arrow** bindings at `:680-694` are safe — arrows are not AltGr-composable.)*

### A8 (high) Every pane spawn runs a full-machine WMI `Win32_Process` enumeration synchronously on the STA main thread, unbounded

`src-tauri/src/platform/windows/mod.rs:33` → `process_snapshot.rs:106-115, 82-88`

`create_session` calls `process_creation_date(root_pid).ok()`, which is **not** a targeted lookup: it does a fresh `WMIConnection::new()` (CoCreateInstance + ConnectServer + CoSetProxyBlanket) plus `SELECT ProcessId, ParentProcessId, CreationDate, Name, ExecutablePath, CommandLine FROM Win32_Process` over **every process on the machine**, then filters one PID in Rust. Its only caller is `spawn_shell` (`pty.rs:249`), declared `pub fn` with no `async` (`pty.rs:196-197`) → runs inline on the WebView2 UI thread, which tao makes an STA (`tao-0.35.3 window.rs:104, 1450`).

The authors knew: `pty_info` wraps the *identical* WMI work in `spawn_blocking` (`info.rs:185`). The spawn path did not get it. Multi-pane presets serialize (`terminal-manager.ts:413` awaits each `spawnPane` in a loop). `ExecutablePath`/`CommandLine` force the provider to `OpenProcess` every target, and wmi-0.18.4 walks the enumerator one object per LRPC round trip with `Next(WBEM_INFINITE, ...)` (`result_enumerator.rs:209-216`) — **no timeout**. A wedged WmiPrvSE hangs `spawn_shell` forever; `ConnectServer` caps at 2 minutes.

Also: the `.ok()` at `mod.rs:33` discards the error permanently. `SessionIdentity` is `Copy`, written once, never backfilled — so one transient WMI hiccup pins that pane to `unknown` for its entire life (`classify_root` hard-fails at `process_snapshot.rs:161-163`), killing the Attention Rail gate (spec:231) and forcing the generic close dialog (spec:232), with **zero log output** anywhere (`grep eprintln!|log::|tracing::` over `platform/windows/` hits only `agent_discovery.rs:95,99,103`).

---

## B. SHIP BLOCKERS — delivery preconditions

### B1 No installer exists and none can be produced from this repository

`.github/workflows/ci.yml:108-125`

`windows-check` ends at `npm run tauri build -- --no-bundle --ci` — `--no-bundle` skips the bundler, so **NSIS packaging has never executed once**. The only bundling job is `if: github.event_name == 'workflow_dispatch'` (`:112`) with a first step that `throw`s unless `github.event.repository.private == "true"` (`:118-125`); `gh repo view` returns `isPrivate: false`. `release.yml:53` still passes `--target universal-apple-darwin` on `macos-latest` only.

The guard and the unchanged `release.yml` are **correct** — delivery plan `:230,:235` and spec `:114` mandate exactly this. The defect is that the spec chose "private, retention-limited GitHub Actions artifact" as the *sole* channel, and that channel is unreachable in a public repo. Prior C1's packaging clause is only cosmetically closed.

Consequence: **Gate W4 is unmet, and the validator (`verify-windows-bundle.mjs`) has only ever seen zero-byte synthetic fixtures** (`verify-windows-bundle.test.mjs:8-22`).

### B2 The docs are not in the PR — the SmartScreen warning is a spec precondition, and it is uncommitted

`git diff --name-only fa21b54..1a2e3d0` lists 52 files, **none** under `docs/` or `README.md`. `git show HEAD:README.md | grep -i windows` returns nothing. `docs/ARCHITECTURE.md:5` still says *"A macOS desktop terminal (Tauri 2)…"*.

Spec `:108-109` permits an unsigned artifact **only** *"while access is private and named testers are explicitly warned about SmartScreen."* At the PR head that warning exists nowhere in the committed tree, and `ci.yml:153-158` uploads only `nsis/*-setup.exe` with no NOTICE alongside it. The good copy exists in the working tree — it was simply never `git add`ed. This is D9/W4, and it is the docs dimension, so the "uncommitted edits are a fact, not a finding" carve-out does not apply.

**Also fix before committing:** three `current`-labelled anchors in the working-tree docs claim the pane-local Windows clipboard path works (`ARCHITECTURE.md:47-50`, `README.md:147-148`, `CONTEXT.md:64-65`) — contradicted by A4 — while both drift ledgers report clean. `CONTEXT.md:104-109` also puts six `decided`-intent rows in the drift table, which D7 says are backlog. `README.md:233` anchors `shift-enter.ts#L20-L63` against a 62-line file.

### B3 Gates W1–W4 have never run, and a green `windows-check` structurally cannot substitute

Exactly seven `#[cfg(target_os = "windows")] #[test]` functions exist in the tree. Never executed on Windows: `create_session`, `terminate_session`, `inspect_processes`, `pty_info`'s real Windows branch (the suite calls a `#[cfg(test)]` twin at `info.rs:167-174`), `spawn_shell`, `kill_pty`, `consume_shell_integration`, and the PowerShell script itself. The Job Object tests assign a plain `std::process::Command` child of the test process, not a ConPTY child — and they poll only `cmd.exe`'s exit, never the `ping.exe` grandchild (`job_object.rs:250-268`), so a root-only kill would keep them green.

`windows-check` **can** catch: WMI unavailable, Job Object primitives broken, no PowerShell on PATH, format/typecheck/menu drift. It **cannot** catch: any of A1–A8.

---

## C. SHIP WITH KNOWN RISK — real, survivable for a labeled preview if disclosed

| # | Finding | Evidence | Why survivable |
|---|---|---|---|
| C1 | **Built-in VS Code / Cursor editor links cannot launch.** `fixed_editor_program` returns bare `"code"`/`"cursor"` (`links.rs:239-246`); `run_editor_program` spawns with raw `Command::new` (`links.rs:371`); Rust std `resolve_exe` appends **only** `.exe` and never reads PATHEXT (`library/std/src/sys/process/windows.rs:498-513`). VS Code ships `code.cmd`, no `code.exe` on PATH. Default setting is `vscode` (`settings-schema.ts:57`). | Fails with a visible toast, not silently. Ironic: `agent_discovery.rs:10` already declares `COMMAND_SUFFIXES = ["", ".exe", ".cmd", ".bat", ".ps1"]` — the author solved this two files away. |
| C2 | **Console window flashes on every `cd`.** `git_branch` (`info.rs:201-204`) spawns `git` with no `creation_flags`; repo-wide grep for `CREATE_NO_WINDOW` returns nothing; `main.rs:2` makes release a GUI-subsystem process with no console to inherit. `links.rs:371` has the same gap. | Cosmetic but embarrassing. One flash per distinct cwd transition (`pane-info-poller.ts:47-49` gates on `cwd === lastBranchCwd`), **and only reachable once A1 is fixed** — dead cwd means no git call. |
| C3 | **Bare F3 / Shift+F3 captured globally**, so F3 never reaches htop / mc / lazygit (`action-registry.ts:720-721`; the only unmodified bindings in either keymap). Silently advances an invisible search. | One key, one class of TUI. No keymap customization surface, so no user workaround. |
| C4 | **2 s poller reconnects COM and re-enumerates every process, forever, including minimised.** `DEFAULT_INTERVAL_MS = 2000` (`pane-info-poller.ts:4`), no visibility gating anywhere in `src/`, new `WMIConnection` per call (`process_snapshot.rs:84-85`), uMax=1 per COM round trip. `freshCwd`/materialize/close-guard each pay a full snapshot for a value WMI never supplies. No in-flight guard (`poll()` has no re-entrancy flag; `close-guard.ts:59` has one). | Battery/CPU quality, not breakage. The per-poll snapshot itself is spec-mandated (spec:211-214); the reconnect, missing cache and missing backoff are the implementation's own choices. Magnitude unmeasured (QA item 9). |
| C5 | **One unreadable descendant collapses a whole pane to `unknown`.** `process_snapshot.rs:187-191` uses `?` inside the loop, discarding an already-matched `claude.exe` when a later `cmd.exe` row has `CommandLine = NULL` (`:277-282`; `is_wrapper` = node/cmd/powershell/pwsh at `:311-313`). Win32_Process returns NULL for rows it could not `OpenProcess`. | Transient — self-heals next cycle. Sharp edge is coinciding with a close or an attention event. |
| C6 | **`"unsupported"` platform silently gets the macOS keymap and ⌘ labels with every pointer gesture dead** (prior L2). `keymap.ts:31`, `shortcut-label.ts:78,86`, `platform.ts:99-108`. Reachable on Windows: `desktop_environment` errors if `USERPROFILE` fails `is_dir()` (`platform/mod.rs:121-125`), and `USER_HOME` is a `OnceLock` so one transient failure is cached for the whole run; the fallback only `console.warn`s (`platform.ts:88-96`), invisible in release. | Requires a redirected/roaming profile that is unmounted at startup. Narrow but total when hit. |
| C7 | **Agent discovery only reads the app process PATH** (`agent_discovery.rs:16-22`), so fnm's documented `fnm env \| Invoke-Expression` in `$PROFILE`, mise, and per-shell `$env:PATH` edits are invisible — picker shows "Shell only" while `claude` works fine when typed. `agents.rs:94-104`'s doc comment still describes Unix interactive-login semantics and is now wrong for Windows. There is no "agent not listed?" affordance (`open-board.tsx:731-754`). | Registry-PATH installers (npm, winget, scoop, nvm-windows) all work. |
| C8 | **A failed `kill_pty` orphans the tree with no retry path.** `pty.rs:405-410` correctly retains state (prior M2 fixed), but all three frontend call sites do `killPty(...).catch(() => {})` and delete the pane anyway (`pane-lifecycle.ts:105,114,121`), and nothing ever retries. `platform/windows/mod.rs:82` is `let _ = killer;` — no TerminateProcess backstop. | Bounded: the retained job handle still carries `KILL_ON_JOB_CLOSE` (`job_object.rs:82`), so the tree dies at app exit. M2 is half-fixed; spec §9's "surface the failure" half is open. |
| C9 | **Agent-launch timeout UX.** `onTimeout` discards the pane id (`tab-manager.ts:309-310`), posts into the shared storage-failure bar (`chrome/events.ts:31-36`) that auto-dismisses after 6 s (`persist-error-bar.tsx:4`), N panes collapse to one toast, and the pane is permanently un-armable (`agent-launch.ts:126-132`; `arm` is called from exactly one site, `tab-manager.ts:636`). | Pure UX — but it is the failure surface for A1, so testers will see it constantly. |
| C10 | **`"unsupported"` also blind-types the agent into the PTY** — `agent-launch.ts:74` defaults to `"macos"`, and every guard is `=== "windows"`, so `"unsupported"` fires on the first ConPTY byte and blind-writes after 3 s. Spec §7.3 forbids exactly this. | Only reachable via C6's failure path. |
| C11 | **No Windows chrome screenshots exist.** `ls -R docs/review` returns six `.md` files, no `assets/`. Spec §7.7 requires 1100×720 and 480×320 in both tab modes. `app.test.tsx:24-80` asserts structure only. | The working-tree CONTEXT.md already records this as pending. |

---

## D. FOLLOW-UP — fix after, not before

- **Job Object assignment races an already-running shell** (`job_object.rs:14-22, 97-107`; portable-pty passes no `CREATE_SUSPENDED`, `psuedocon.rs:139-153`). The window is a few dozen instructions between `CreateProcessW` returning and `AssignProcessToJobObject` — PowerShell cannot load the CLR and fork a grandchild inside it. The real item is **process**: Gate W3 (plan:121) is mandatory and has no evidence. Do not add the recursive-kill fallback (plan:104 forbids it).
- **Win32 Job Object tests never observe a grandchild** (`job_object.rs:250-302`). Use `QueryInformationJobObject(JobObjectBasicProcessIdList)` and assert two PIDs before, zero after. *(The "leaks a process handle" claim in the source report is wrong — `std::process::Child` closes its `OwnedHandle` on drop.)*
- **PID-reuse rejection is applied only at the root edge** (`process_snapshot.rs:232-251`): the BFS queue carries `(process_id, depth)`, so every descendant is compared against the *shell's* creation date, never its own parent's. A recycled PID at depth ≥ 2 can graft a foreign subtree onto a pane. `Descendant` already carries `creation_date` (`:117-123`) — one-line fix.
- **`resolve_paths` does up to 64 blocking `canonicalize` calls inline in an async command** (`links.rs:102-121`), plus `candidate_base.is_dir()` on every hover; `open_editor` does the same inline (`links.rs:218`). Wrap in `spawn_blocking` with a deadline. (Mostly subsumed by the A3 UNC rejection.)
- **`git_branch` blocks a tokio worker with no timeout** (`info.rs:199-204`) while its sibling uses `spawn_blocking`.
- **Zero WMI diagnostics.** `info.rs:134-136` pattern-matches the `SnapshotError` away, `mod.rs:33` `.ok()`s the other; `pty_info` returns `Ok` on every path so the frontend `catch` never fires. A WMI-broken machine is undiagnosable in the field.
- **Unsafe-FFI hygiene** (`job_object.rs:47-68`): `Send`/`Sync` for the whole PTY subsystem is obtained accidentally by storing `HANDLE` as `isize`; changing it to the real type silently breaks `.manage()` at `lib.rs:35`. Six `unsafe` blocks (`:64,76,83,99,102,110`) with no `// SAFETY:`. `CloseHandle`'s BOOL discarded.
- **`windows::inspect_process` is a dead stub** returning `complete: false` (`platform/windows/mod.rs:56-62`) but is re-exported through the platform facade — a future caller compiles clean and silently reports `Unknown`.
- **Command-line parser splits on Unicode whitespace** (`command_line.rs:7,45`) where `CommandLineToArgvW` splits only on 0x20/0x09.
- **MSYS `/c/...` paths** are linkified but resolve to `C:\c\Users\...` and vanish (`links.rs:85-88`).
- **Windows absolute paths containing a space are never linkified** (`terminal-links.ts:134-165,193-198`) — `C:\Program Files\...`, `C:\Users\John Smith\...`. Pre-existing (not in this diff), pinned by a test.
- **`windows-core = "=0.61.2"`** (`Cargo.toml:36-46`) freezes an unsafe-surface COM crate against patch releases; prefer `>=0.61.2, <0.62` plus `cargo audit` in `windows-check`.
- **Vacuous tests to rewrite or delete:** `ignores_shell_on_windows` (`shell.rs:188-200` — the `"SHELL"` fixture key is never requested, so it would pass if production *did* read `$SHELL`, defeating spec §10's named guarantee), `keeps_session_on_termination_failure` (`job_object.rs:241-248` — tautological), `platform/mod.rs:178-183`, `shell.rs:245-251`. Add the missing one: `kill_pty` with an injected failing `terminate_session`.
- **Right-click behaviour is unknown**, not broken. Default WebView2 context menus are on (wry default), but xterm registers `rightClickHandler` unconditionally (`CoreBrowserTerminal.ts:355-357`) and moves the textarea under the cursor, which usually yields the editable-field menu with a working Paste. Settle it in QA item 6 before writing any fix.
- Prior L1 (`open-board.tsx:88-94`, fabricated `KeyBinding` for label text), L4 (`platform.ts:85-96`, the early return is before the `await`, so two concurrent callers still reach the throwing path), L5 (`styles.css:97-99` `.deck-toolbar` uses `var(--bg)` vs DESIGN-LANGUAGE.md:46 — needs a DL ruling since `.titlebar` does the same), and `unsupported.rs` still has zero tests.

---

## Prior review adjudication (2026-07-30 BLOCK verdict)

| ID | Prior finding | Status | Evidence |
|---|---|---|---|
| **C1** | No Windows runtime behind the platform contract | **Closed (code) / open (gates)** | `platform/mod.rs:5-7,22-26` re-exports a real `windows` module; `platform/windows/{shell,agent_discovery,job_object,process_snapshot,command_line}.rs` exist. Editor `$SHELL -lc` replaced by structured argv (`links.rs:343-368`, `editor-command.ts:44-63`). But the resolution demanded Gates W1–W4 — W1 is actively contradicted by A1, and the packaging clause is still open (B1). |
| **H1** | Windows clipboard chords bound to unimplemented actions | **STILL OPEN — disguised** | A handler was added (`terminal-clipboard.ts`, wired at `pane.ts:194-198`) but `action-registry.ts:671-672` and the swallowing dispatch (`tab-manager.ts:1108-1110`) are untouched. Runtime behaviour is byte-identical to the reviewed checkpoint. See A4. |
| **H2** | Ctrl+Shift+O never matches because `event.key` is `"O"` | **Closed** | `open-board.tsx:407` lowercases single-char keys; `open-board.removal.test.tsx:232` now sends `key: "O"`. |
| **M1** | Ctrl+Shift+= arrives as `"+"` | **Partially closed** | `action-registry.ts:716` is now `{ key: "+", ctrl: true, shift: true }`, correct on US. Still dead on DE/ES/IT/Nordic, where `+` is unshifted BracketRight (key `"+"`, `shiftKey` false) and `=` is Shift+0 — neither binding matches. Zoom-out works, so it reads as broken. |
| **M2** | `kill_pty` failure path destroys retry state | **Closed in backend, unreachable in UI** | `pty.rs:403-411` now `get_mut` → `terminate_session(...)?` → `remove` only on success, pinned by `job_object.rs:241-248`. But every caller does `.catch(() => {})` and deletes the pane (`pane-lifecycle.ts:105,114,121`) and nothing retries — spec §9's "surface the failure" half is open. See C8. Note this reorder is what now drops the ConPTY master under the lock (A2). |
| **M3** | Bundle-validator tests never run in CI | **Closed** | `ci.yml:91-92` adds `node --test scripts/verify-windows-bundle.test.mjs` to `windows-check`. (Only in that lane; `package.json:18` still excludes it from `npm test`. Acceptable.) |
| **M4** | Living docs stale | **STILL OPEN** | Zero doc files in the PR diff. See B2. |
| **M5** | No mandated screenshot approval for Windows chrome | **STILL OPEN** | No `docs/review/assets/`. See C11. |
| **L1** | Fabricated `KeyBinding` for the Open Folder label | **STILL OPEN** | `open-board.tsx:88-94`, disconnected from the real matcher at `:429-437`. |
| **L2** | `"unsupported"` silently gets macOS behaviour | **STILL OPEN — worse** | `keymap.ts:31`, `platform.ts:99-108` unchanged; now also mis-branches the agent launcher into blind-typing (`agent-launch.ts:74`). See C6/C10. |
| **L3** | Green `windows-check` cannot detect "Windows can't spawn a shell" | **Partially closed** | Real Windows-gated tests now exist (`shell.rs:253-263`, `agent_discovery.rs:218-234`, `process_snapshot.rs:618-639`, `job_object.rs:270-302`) and `cargo test --locked` runs on windows-latest. But nothing spawns a shell, nothing inspects emitted bytes, and the Job Object tests never observe a descendant — A1–A3 and A8 all pass CI. `unsupported.rs` still has zero tests. |
| **L4** | Double-throw in `initializeDesktopEnvironmentFromBackend` | **Partially closed** | `platform.ts:85-87` early-returns, but *before* the `await`, so two concurrent callers still reach the throwing path at `:95`. One call site today (`main.tsx:13`), so latent. |
| **L5** | `.deck-toolbar` uses `var(--bg)` vs DESIGN-LANGUAGE `--chrome-*` | **STILL OPEN** | `styles.css:97-99` vs `DESIGN-LANGUAGE.md:46`; no ledger row. `.titlebar` (`styles.css:69`) does the same, so this needs a DL ruling, not an opportunistic edit. |

**Three prior findings — H1, M4, M5 — are silently still open, and H1 is a High from a BLOCK verdict that was answered with unreachable code.** That pattern is itself a finding: the fix was written but never exercised through the real event path.

---

## What cannot be known without real Windows hardware — manual QA checklist

Run in order on a **stock Windows 11 x64 machine with no PowerShell 7 installed**. Items 1–3 will fail today; do them first because they gate everything else.

1. **PowerShell 5.1 escape (Gate W1, blocks A1).** Run `powershell.exe -NoLogo -NoExit -Command "$out = \"` + `` `e]133;B\"; [int[]][char[]]$out"``. **Expect:** first value `27`. **Today expect:** `101` (the letter `e`) — confirms A1.
2. **Prompt render.** Launch Deck, open one pane. **Expect:** a clean `PS C:\Users\<you>>` prompt. **Today expect:** `e]133;Ae]9;9;"C:\Users\<you>"PS C:\Users\<you>> e]133;B` on every line.
3. **Agent auto-launch (Gate W1).** Open a workspace with `claude` selected. **Expect:** `claude` starts within ~2 s of the first prompt. **Today expect:** 15 s of nothing, then one 6-second toast reading "PowerShell was not ready in time", pane permanently un-armable.
4. **ConPTY close deadlock (A2).** In one pane run `Get-ChildItem -Recurse C:\Windows`; while output floods, press the pane-close chord and confirm. **Expect:** pane closes, other panes keep repainting. **Failure:** window goes white / "Not Responding". If so, attach WinDbg and confirm the main thread sits in `ClosePseudoConsole` → `WaitForSingleObject` while an emitter thread sits in `Mutex::lock`.
5. **UNC freeze + NTLM egress (A3).** Start Wireshark filtering `tcp.port==445 || tcp.port==80`. In a pane run `Write-Host -NoNewline "$([char]27)]9;9;`"\\10.255.255.1\share`"$([char]7)"`. **Expect:** no network traffic, no stall. **Failure:** app freezes for ~21 s and a SMB SESSION_SETUP with your NTLMv2 response goes out. Repeat with `cd \\<reachable-server>\share` to confirm the non-adversarial trigger.
6. **Clipboard (A4/A5).** Select pane text → Ctrl+Shift+C → paste into Notepad. **Expect:** the text. **Today expect:** nothing. Then Ctrl+Shift+V with a multi-line clipboard. **Also record:** right-click in a pane — note whether you get the Edge page menu or a Cut/Copy/Paste menu, and whether Paste works. That determines whether a right-click fallback already exists.
7. **Session loss (A6).** Open two tabs with running processes, click the gear button, press **F5**. **Expect:** nothing. **Failure:** app reloads to the Open board; then check Task Manager for surviving `powershell.exe` + `conhost.exe` pairs. Repeat with Ctrl+P and Ctrl+F.
8. **AltGr (A7).** Switch to the German or Spanish keyboard layout. In a pane type `~` (DE) or `[` (ES). **Expect:** the character. **Failure:** no character, focus jumps panes. Also test Ctrl+`+` for zoom-in (prior M1 residue).
9. **Spawn cost (A8).** Open a 4-pane preset from a cold boot. **Expect:** panes appear in well under a second with the window repainting throughout. **Measure:** time from click to fourth pane; `Measure-Command { Get-CimInstance Win32_Process | Out-Null }` for the per-call cost; watch `WmiPrvSE.exe` + Deck CPU with the app **minimised for 5 minutes** (C4).
10. **Editor link (C1).** `where code` — record whether `code.exe` appears. Then Ctrl+click a file path in a pane with VS Code as the editor. **Expect:** VS Code opens the file at the line. **Today expect:** toast "Couldn't start the editor: program not found (os error 2)".
11. **Console flash (C2).** With the app foregrounded and maximised, `cd` into a git repo in a pane. **Expect:** no window appears. **Failure:** a black console flashes. *(Only observable once A1 is fixed.)*
12. **Job Object tree kill (Gate W3).** Start `claude` in a pane, note the full process tree in Process Explorer, close the pane. **Expect:** every descendant gone. Repeat for `codex` and `gemini`. Then kill Deck from Task Manager with panes open and re-check for orphans.
13. **WMI under a standard non-admin account (Gate W2).** Verify pane dots reach `agent`/`busy`/`idle`, not `unknown`, for both a direct binary and an npm `.cmd` shim. Then run `Get-CimInstance Win32_Process | ? {$_.CommandLine -eq $null}` on a busy machine to gauge C5's frequency.
14. **Installer (Gate W4).** Dispatch `windows-engineering-bundle` from a private mirror. **Expect:** exactly one `*-setup.exe`, zero MSI, correct Add/Remove Programs metadata. Install on a clean VM **with WebView2 absent and the network off** and record the abort text. Record the run URL, artifact name and setup filename in `docs/CONTEXT.md`.
15. **Long paths / non-ASCII.** Install under a profile like `C:\Users\Bình`, verify `%APPDATA%\dev.spacevibe.deck` is created and settings persist. Dump the embedded manifest (`mt.exe -inputresource:"SpaceVibe Deck.exe";#1 -out:x.manifest`) and check for `<longPathAware>`.
16. **Chrome screenshots (spec §7.7, C11).** Capture 1100×720 and 480×320, top-tab and sidebar, into `docs/review/assets/`.

---

## Fix-order hazards — read before touching anything

- **A1 unmasks A3.** No ESC byte today means `retain_valid_cwd` never runs. Fix the escape and the OSC-9;9 network stall goes live the same hour. Land the root rejection + off-lock validation in the same commit.
- **A4 unmasks A5.** Deleting the two keymap lines makes an unbracketed, un-normalized raw PTY write reachable. Route through `terminal.paste()` in the same commit.
- **A1 unmasks C2.** The console flash needs a non-null cwd.
- **A2's fix touches the M2 fix.** The reorder that closed prior M2 is what put the `Session` drop under the lock. Keep `terminate_session` under the lock; move only the `remove`d value's drop outside it.
- **Do not add a recursive-kill fallback** for the Job Object race — plan:104 explicitly forbids it. Run Gate W3 instead.