# Windows desktop engineering preview implementation plan

**Spec**: [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
**Goal**: Build a Windows 11 x64 engineering preview that preserves Deck's shared pane, tab, layout, attention, and settings behavior while putting Windows-only shell, process, path, input, chrome, bundle, and release behavior behind explicit platform contracts.
**Architecture**: Rust remains the authority for PTY sessions, the validated user-profile directory, working directories, process identity, editor launches, and process-tree teardown. Platform adapters isolate macOS, Windows, and compile-only unsupported behavior; the Preact layer receives one validated immutable desktop environment before rendering and derives home display, keymaps, primary-modifier behavior, labels, and chrome from it. Windows packaging is staged as a private unsigned NSIS engineering artifact; no beta or public-release claim is allowed until the real Windows runtime gates pass.

## 1. Expected outcomes

- macOS behavior and generated native menu accelerators remain unchanged — verify with `npm test`, `npm run build`, `npm run generate:menu:check`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml`.
- Windows ignores `SHELL`, prefers `pwsh.exe`, falls back to `powershell.exe`, loads the normal user profile, and injects session-only prompt integration — verify with Windows Rust tests `selects_pwsh_before_windows_powershell`, `ignores_shell_on_windows`, and `builds_profile_loading_prompt_integration`.
- Windows automatic agent launch waits only for structured `OSC 133;B`, launches once, and never writes on its 15-second timeout — verify with `npm test -- src/terminal/agent-launch.test.ts`.
- Agent discovery accepts only absolute allowlisted Windows command paths and degrades to `Shell only` after three seconds — verify with Windows Rust tests in `agent_discovery.rs`.
- each Windows pane owns a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object and a failed assignment/termination is surfaced — verify with Windows Rust tests plus the real-device process-tree gate.
- one WMI `Win32_Process` snapshot classifies all requested panes as `idle-shell`, `agent`, `busy`, or `unknown` using deterministic precedence and PID-reuse rejection — verify with Rust fixture tests in `process_snapshot.rs`.
- pane headers, Attention Rail, split CWD inheritance, and close confirmation consume the explicit process contract without inventing an idle shell or CWD — verify with focused Vitest suites for `process-info`, `pane-info-poller`, `agent-attention`, `close-guard`, and `tab-manager`.
- drive-letter, slash-style, UNC, relative, and `:line:column` paths resolve safely; verbatim prefixes never reach UI/editor argv — verify with `npm test -- src/lib/terminal-links.test.ts` and Windows Rust tests in `links.rs`.
- editor launches use structured IPC; Windows built-ins execute directly and custom templates reject shell syntax — verify with `npm test -- src/lib/editor-command.test.ts src/terminal/link-client.test.ts` and Windows Rust editor tests.
- Windows keyboard, clipboard, link, board, preset, search, and drag gestures follow the approved Windows chord map while protected bare terminal control sequences still reach the PTY — verify with the keymap, pointer, link, search, and clipboard Vitest suites.
- Windows uses native decorated system chrome and correct in-app spacing at `1100x720` and `480x320` in top-tab and sidebar modes — verify structurally with component tests and visually with real Windows screenshots before beta approval.
- a non-publishing `windows-check` job exists before Windows implementation begins, gates every completed Windows slice when remote execution is authorized, and later produces exactly one private unsigned x64 NSIS `-setup.exe`; no MSI is emitted — verify with the `windows-check` job and its retained GitHub Actions artifact.
- living docs describe the implemented preview and list every unpassed Windows runtime gate — verify with relative-link checks and the `Chưa khớp thực tế` ledgers in `docs/ARCHITECTURE.md` and `docs/CONTEXT.md`.

## 2. Sources of truth

**Canonical data**: `PtyState` owns live pane session identity, validated shell-reported CWD, platform teardown handles, and root-process creation identity. A single Windows WMI snapshot per `pty_info` call supplies descendant process facts. `ACTION_REGISTRY` remains the action identity source; platform keymaps and formatted labels are derived from it.

**Read from**:

- PowerShell session output for `OSC 133;B` readiness and Windows Terminal-compatible CWD metadata.
- the Rust filesystem boundary for absolute/existing-directory and absolute/existing-file validation.
- one `Win32_Process` WMI query per polling cycle for `ProcessId`, `ParentProcessId`, `CreationDate`, `Name`, `ExecutablePath`, and `CommandLine`.
- platform-specific Tauri configuration files for window and bundle behavior.
- one initialized desktop-environment value, containing the validated platform and user-profile directory, returned by Rust before Preact renders.

**Do not read from**:

- `SHELL` on Windows.
- selected-agent intent as proof that an agent process is live.
- raw terminal text as an editor executable or trusted CWD.
- per-pane PowerShell/WMI subprocesses.
- undocumented remote-PEB inspection.
- frontend-built shell command strings for editor launches.
- macOS menu accelerator data as the Windows keymap.

## 3. Business rules and invariants

- **Shared-domain neutrality**: pane, tab, split-tree, layout, attention-state, settings persistence, and coordinator ownership remain platform-neutral — verify by keeping platform conditionals out of those domain reducers and running existing suites unchanged.
- **Windows shell**: `pwsh.exe` wins over `powershell.exe`; `SHELL`, WSL, Git Bash, and `cmd.exe` never select the pane shell — verify with Windows shell-selection tests.
- **Normal profile**: PowerShell starts without `-NoProfile`; prompt integration is injected into the child session and never writes a profile file — verify by asserting launch argv and searching the diff for profile writes.
- **Readiness**: only `OSC 133;B` releases an armed Windows agent; banners, arbitrary bytes, `OSC 133;A`, and elapsed time do not — verify with agent-launch tests.
- **Launch once**: a pane writes at most one automatic agent command — verify with duplicate-marker and re-arm tests.
- **Timeout safety**: Windows timeout removes the armed launch and shows a non-blocking manual-launch message without calling `write_pty` — verify with fake timers and a message callback spy.
- **Validated CWD**: a new shell-reported CWD replaces the last value only when it is absolute and currently names a directory — verify with Rust parser/state tests.
- **One home provider**: the platform adapter supplies one validated user-profile directory for default PTY CWD, terminal-link expansion, and frontend `~` display; frontend code never calls a second home-directory provider — verify with Rust platform tests, platform initialization tests, and a source scan for direct `homeDir()` calls.
- **Single snapshot**: one `pty_info(ids)` request performs one WMI query regardless of pane count — verify with an injected snapshot-provider call counter.
- **Process truth**: no descendants is `idle-shell`; recognized agent is `agent`; unrecognized descendant is `busy`; incomplete/failed inspection is `unknown` — verify with fixture graphs.
- **Agent precedence**: direct executable match beats wrapper signature, then deeper descendant, newer creation time, and higher PID — verify with ordered fixture tests.
- **PID reuse**: descendants older than or disconnected from the stored root-session creation identity are rejected — verify with reused-PID fixtures.
- **Attention gate**: only `kind: "agent"` opens the process gate; selected-agent intent alone never does — verify with `agent-attention` and `tab-manager` tests.
- **Fail-safe close**: `busy` and `agent` show named confirmation; `unknown` shows generic confirmation; `idle-shell` closes without prompting — verify with `close-guard` tests.
- **Process-tree ownership**: closing a Windows pane closes or terminates its Job Object before reporting success; an error leaves retryable session state — verify with Windows Job Object tests and close-path tests.
- **Path preservation**: comparison may normalize case/separators, but user-visible terminal text is not rewritten; `\\?\` prefixes are removed only after canonicalization at the Rust boundary — verify with path tests.
- **Structured editor IPC**: `editor`, `template`, canonical file path, line, and column are validated independently — verify with malformed IPC tests.
- **No custom-editor shell**: Windows custom templates are parsed into executable plus argv; pipes, redirection, expansion, and shell operators are rejected — verify with command-line parser tests.
- **Primary modifier**: one predicate maps to `metaKey` on macOS and `ctrlKey` on Windows across keyboard and pointer paths — verify with platform-parameterized tests.
- **Protected terminal controls**: bare `Ctrl+C`, `Ctrl+D`, `Ctrl+W`, `Ctrl+K`, `Ctrl+F`, and other conventional control sequences never resolve to an app action — verify with an explicit protected-key test set.
- **Menu stability**: menu generation always reads the macOS keymap, so Windows chords cannot change Cocoa accelerators — verify with `npm run generate:menu:check`.
- **Native Windows chrome**: Preact never implements Windows minimize, maximize, close, Snap, resize, or title-bar accessibility — verify by configuration/component inspection and real Windows screenshots.
- **Artifact cardinality**: a Windows release build produces one NSIS setup executable and zero MSI files — verify with the bundle validator.
- **Release honesty**: unsigned artifacts remain private engineering/private-beta assets with SmartScreen copy; a public Windows release is blocked on signing and runtime acceptance — verify in the staged release workflow and docs.
- **TDD feedback**: pure Windows selection, parsing, normalization, classification, and lifecycle state transitions compile and run on macOS behind injected providers; Windows API adapters additionally pass `windows-check` before the next dependent Windows slice starts.

## 4. Scope

**Included**:

- explicit Rust and frontend platform contracts.
- PowerShell selection, session-only prompt/CWD integration, and allowlisted agent discovery.
- structured prompt readiness and safe launch timeout.
- Windows Job Object ownership and WMI process classification.
- explicit pane process kind/agent IPC and consumers.
- Windows path extraction, normalization, editor argv launch, and shell-paste quoting.
- Windows keymap, primary modifier, terminal copy/paste, dynamic labels, and pointer gestures.
- native Windows title-bar configuration and in-app chrome spacing.
- neutral metadata, NSIS-only Windows configuration, Windows CI, and staged release artifact validation.
- macOS regression tests and living-doc updates.

**Excluded**:

- Windows 10, ARM64, WSL, Git Bash, Command Prompt, or a shell selector.
- Microsoft Store, MSIX, auto-update infrastructure, or Partner Center work.
- public Windows download before trusted signing/timestamping.
- custom Windows title-bar controls.
- Linux product support beyond preserving the existing compile/test fallback.
- redesigning Deck chrome or changing pane/tab/layout/settings domain semantics.
- claiming that any real Windows runtime gate passed without Windows 11 evidence.
- pushing, publishing, signing, or deploying artifacts without separate authorization.

## 5. Risks, gates, and fixed Windows chord map

### Accepted risks for the engineering preview

- The current machine is macOS-only. Local work can prove pure logic, macOS regression safety, configuration shape, and source-level Windows compilation only when a target toolchain permits it; it cannot prove ConPTY, WMI permissions, Job Object behavior, WebView2, IME, SmartScreen, or native Windows visuals.
- `portable-pty` exposes the spawned PID after creation. The initial engineering implementation can assign that root promptly to a Job Object, but the real-device gate must prove that no supported agent child escapes. If the race is observable, the design returns to review instead of adding an undocumented recursive-kill fallback.
- WMI access to npm shim command lines under a standard non-admin account is unproved. Inspection failure must remain `unknown`, never idle.
- Windows signing credentials are not in scope. The workflow may create an unsigned draft/private artifact only.
- `wmi` connections are neither `Send` nor `Sync`; each poll creates one connection inside one blocking task and performs one snapshot, never one connection/query per pane.

### TDD execution protocol

- Every task starts with the smallest named failing test from its Verify section. Run it and record that it fails for the intended missing behavior before editing production code.
- Add only the minimum production code for Green, rerun the targeted test, then refactor and rerun the broader task verification.
- Windows selection, command-line parsing, shell-integration parsing, process classification, path normalization, and Job Object lifecycle state are separated from OS calls through injected providers so their Red-Green loop runs on macOS.
- Windows API integration tests remain `cfg(windows)` and are Green only after the non-publishing `windows-check` job passes on the scoped commit.
- `windows-check` runs on each authorized PR push. Creating a branch/worktree, committing, pushing, opening a PR, or manually dispatching a workflow requires separate user authorization. Without that authorization, record the Windows CI gate as pending and do not start the next dependent Windows-only slice or claim it Green.

### Runtime gates that remain mandatory

- **Gate W1**: `OSC 133;B` remains reliable after a banner, a normal PowerShell profile, and a deliberately slow profile.
- **Gate W2**: WMI exposes direct-binary and npm-shim command lines without elevation.
- **Gate W3**: a per-pane Job Object terminates the ConPTY PowerShell tree for Claude Code, Codex, and Gemini CLI without breaking them.
- **Gate W4**: the Windows Tauri configuration emits exactly one correct NSIS setup executable.

Failure of any gate reopens the design. Tasks below may produce an engineering preview, but completion of those tasks does not waive these gates.

### Windows action-to-chord map

- `copy-selection`: `Ctrl+Shift+C`.
- `paste`: `Ctrl+Shift+V`.
- `copy-cwd`: `Ctrl+Alt+Shift+C`.
- `split-row`: `Ctrl+Shift+D`.
- `split-column`: `Ctrl+Alt+Shift+D`.
- `close-pane`: `Ctrl+Shift+W`.
- `close-tab`: `Ctrl+Alt+Shift+W`.
- `focus-next`: `Ctrl+Alt+BracketRight`.
- `focus-prev`: `Ctrl+Alt+BracketLeft`.
- `focus-left`, `focus-right`, `focus-up`, `focus-down`: `Ctrl+Alt+Arrow`.
- `swap-left`, `swap-right`, `swap-up`, `swap-down`: `Ctrl+Alt+Shift+Arrow`.
- `toggle-expand`: `Ctrl+Shift+E`.
- `toggle-zoom-pane`: `Ctrl+Shift+Enter`.
- `new-tab`: `Ctrl+Shift+T`.
- `reopen-tab`: `Ctrl+Alt+Shift+T`.
- `open-tab-options`: `Ctrl+Alt+Shift+R`.
- `next-tab`: `Ctrl+Tab`.
- `prev-tab`: `Ctrl+Shift+Tab`.
- `select-tab-1` through `select-tab-8`: `Ctrl+1` through `Ctrl+8` by physical digit position.
- `select-last-tab`: `Ctrl+9` by physical digit position.
- `zoom-in`: `Ctrl+=` and `Ctrl+Shift+=`.
- `zoom-out`: `Ctrl+-`.
- `zoom-reset`: `Ctrl+0`.
- `find`: `Ctrl+Shift+F`.
- `find-next`: `F3`.
- `find-previous`: `Shift+F3`.
- `clear-buffer`: `Ctrl+Shift+K`.
- `new-preset`: `Ctrl+Alt+Shift+N`.
- `save-preset`: `Ctrl+Alt+Shift+S`.
- `focus-next-attention`: `Ctrl+Shift+A`.
- `toggle-settings`: `Ctrl+,`.
- `scroll-page-up`, `scroll-page-down`: `Shift+PageUp`, `Shift+PageDown`.
- `scroll-to-top`, `scroll-to-bottom`: `Shift+Home`, `Shift+End`.
- Open board `pick-folder`: `Ctrl+Shift+O`.
- Preset editor split gestures: `Ctrl+ArrowRight` and `Ctrl+ArrowDown` while the editor owns focus.
- Link activation and hover decoration: hold `Ctrl`.
- Pane drag swap mode: hold `Ctrl`; release it to return to dock mode.
- Window close: native `Alt+F4`; no Preact binding.
- Bare `Ctrl+C`, `Ctrl+D`, `Ctrl+W`, `Ctrl+K`, `Ctrl+F`, `Ctrl+O`, and normal shell/TUI controls remain unbound and reach the PTY.

## 6. Tasks

### Task 1: Record engineering-preview approval and preserve the gate boundary

**Files**:

- [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
- [2026-07-29-windows-desktop.md](2026-07-29-windows-desktop.md)

**Decision**: The approved implementation target is an unsigned engineering preview; real Windows gates remain unpassed and mandatory.

**Build**:

- confirm the spec already records approved engineering-preview status with runtime gates pending.
- confirm the spec downstream field links to this plan.
- retain the exact failure rule that a failed gate returns the design to review.

**Verify**:

- `rg -n "Approved for engineering preview|Runtime gates pending|2026-07-29-windows-desktop.md" docs/specs/2026-07-29-windows-desktop-design.md` → all three approval markers are present.


### Task 1A: Establish the non-publishing Windows TDD lane

**Files**:

- [ci.yml](../../.github/workflows/ci.yml)

**Depends on**: Task 1

**Decision**: `windows-check` exists before Windows-specific production code and never publishes an installer or GitHub Release.

**Build**:

- add a `windows-latest` job beside the existing Linux job using Node 22, stable Rust, npm cache, and Cargo cache.
- run `npm ci`, `npm run generate:menu:check`, `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml`.
- keep the job non-admin, triggered by the existing pull-request/push events, and free of release permissions, installer upload, signing, and publication.
- preserve the Linux job and give the Windows job the stable name `windows-check` so later slices and branch protection use one gate.

**Verify**:

- local `npm test`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` pass before the workflow change is offered for remote execution.
- after separate authorization for a PR branch/worktree and push, the first `windows-check` URL is recorded and the job is green before Task 5 starts.


### Task 2: Add the Rust platform module skeleton

**Files**:

- [mod.rs](../../src-tauri/src/platform/mod.rs)
- [macos.rs](../../src-tauri/src/platform/macos.rs)
- [unsupported.rs](../../src-tauri/src/platform/unsupported.rs)

**Depends on**: Task 1A

**Decision**: Platform APIs are selected with `cfg` and re-exported from one module; the contract includes one validated user-profile provider, and Linux keeps compile-only fallback behavior without being promoted to supported status.

**Build**:

- define `PlatformName`, `DesktopEnvironment`, `ShellLaunch`, `SessionIdentity`, `PlatformSession`, and `user_home()` contract shapes.
- move macOS shell selection, validated home lookup, process inspection, and process-group termination behavior behind `macos.rs` without changing semantics.
- provide unsupported compile/test fallbacks that return explicit unknown process state and a missing home rather than guessing.

**Verify**:

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → no formatting diff.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::` → platform unit tests pass on macOS.


### Task 3: Route existing Rust seams through the platform contract

**Files**:

- [lib.rs](../../src-tauri/src/lib.rs)
- [pty.rs](../../src-tauri/src/pty.rs)
- [agents.rs](../../src-tauri/src/agents.rs)

**Depends on**: Tasks 1A and 2

**Decision**: `pty.rs` retains transport/session orchestration; platform modules own shell construction and teardown. `agents.rs` retains the Tauri command and allowlist contract; discovery delegates by platform.

**Build**:

- register the platform module and a validated `desktop_environment` command returning platform plus user-profile directory.
- replace `cfg!(windows)` and direct `SHELL` selection in `pty.rs` with `ShellLaunch`.
- replace direct `$HOME` fallback in `resolve_spawn_cwd` with the platform `user_home()` provider; invalid or missing home returns a user-readable spawn error.
- store immutable platform session metadata in each `Session`.
- delegate teardown and agent discovery without changing macOS results.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml pty::` → existing PTY and home-fallback tests pass.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml agents::` → existing agent-discovery tests pass.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::` → platform contract tests pass.
- `rg -n "cfg!\\(windows\\)|var\\(\"SHELL\"\\)" src-tauri/src/pty.rs` → no Windows shell decision remains in shared PTY orchestration.


### Task 4: Initialize one frontend platform value before rendering

**Files**:

- [platform.ts](../../src/lib/platform.ts)
- [platform.test.ts](../../src/lib/platform.test.ts)
- [main.tsx](../../src/main.tsx)

**Depends on**: Task 3

**Decision**: Preact and terminal code read one validated immutable `DesktopEnvironment` initialized through Rust before `render`; tests can initialize it explicitly.

**Build**:

- define `DesktopPlatform = "macos" | "windows" | "unsupported"` plus a validated absolute `homeDir`, and reject unknown IPC values.
- expose platform predicates and `hasPrimaryModifier(event)` without reading user-agent strings.
- initialize the desktop environment before settings and app render; initialization failure uses `unsupported` with an empty home and logs one diagnostic.

**Verify**:

- `npm test -- src/lib/platform.test.ts` → accepted values, invalid/relative home rejection, one-time initialization, and modifier mapping pass.
- `npm run build` → platform initialization types and bundles.


### Task 4A: Consume the initialized home directory in frontend display

**Files**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)
- [open-board.tsx](../../src/open-board/open-board.tsx)
- [open-board.removal.test.tsx](../../src/open-board/open-board.removal.test.tsx)

**Depends on**: Task 4

**Decision**: pane/status/sidebar and Open board home display consume only the initialized `DesktopEnvironment.homeDir`.

**Build**:

- remove direct `@tauri-apps/api/path` `homeDir()` calls from TabManager and Open board.
- inject or read the initialized immutable home value at their existing construction/render boundaries.
- preserve empty-home degradation without fabricating `~`.

**Verify**:

- `npm test -- src/terminal/tab-manager.test.ts src/open-board/open-board.removal.test.tsx` → macOS and Windows home values reach the existing display state and empty-home degradation remains safe.
- `rg -n "homeDir\\(" src/terminal/tab-manager.ts src/open-board/open-board.tsx` → no second frontend home provider remains.
- `npm run build` → all home consumers compile against the initialized environment.


### Task 5: Add Windows shell selection and prompt injection

**Files**:

- [shell.rs](../../src-tauri/src/platform/windows/shell.rs)
- [mod.rs](../../src-tauri/src/platform/windows/mod.rs)
- [pty.rs](../../src-tauri/src/pty.rs)

**Depends on**: Tasks 1A, 3, and 4A

**Decision**: Windows searches for `pwsh.exe`, then `powershell.exe`, never reads `SHELL`, does not pass `-NoProfile`, and injects prompt/CWD integration only through child-session argv.

**Build**:

- resolve the Windows user profile once through `user_home()`, validate it as an absolute existing directory, and reuse it for default PTY CWD and `DesktopEnvironment.homeDir`.
- resolve supported PowerShell executables with absolute paths using an injected Windows search provider so precedence and `SHELL` rejection tests run on macOS.
- construct session-only prompt integration that preserves the user's existing prompt output while emitting `OSC 133;A`, Windows Terminal CWD metadata, and `OSC 133;B`.
- return a user-readable spawn error when neither PowerShell is available.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::windows::shell::tests` → cross-platform provider tests `selects_pwsh_before_windows_powershell`, `falls_back_to_windows_powershell`, `ignores_shell_on_windows`, `rejects_relative_or_missing_user_profile`, and `builds_profile_loading_prompt_integration` pass locally.
- the authorized `windows-check` run passes the real executable-search and user-profile integration tests before Task 6 starts.
- `rg -n "NoProfile|Set-Content|Add-Content" src-tauri/src/platform/windows/shell.rs` → no profile suppression or profile write exists.


### Task 6: Add Windows agent discovery

**Files**:

- [agent_discovery.rs](../../src-tauri/src/platform/windows/agent_discovery.rs)
- [mod.rs](../../src-tauri/src/platform/windows/mod.rs)
- [agents.rs](../../src-tauri/src/agents.rs)

**Depends on**: Tasks 1A and 5

**Decision**: one bounded Windows search resolves only `claude`, `codex`, and `gemini` absolute commands with normal Windows executable suffixes.

**Build**:

- resolve each allowlisted command through an injected Windows executable-search provider without invoking a Unix/login shell; keep allowlist, normalization, and timeout logic testable on macOS.
- normalize final command names by lowercasing and stripping `.exe`, `.cmd`, `.bat`, and `.ps1`.
- preserve allowlist order, deduplicate names, log one diagnostic on failure, and return an empty list after the three-second bound.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::windows::agent_discovery::tests` → cross-platform provider tests `accepts_absolute_allowlisted_commands`, `rejects_relative_or_wrong_basename`, `normalizes_windows_suffixes`, and `times_out_to_empty` pass locally.
- the authorized `windows-check` run passes the real Windows search-path integration test before Task 10 starts.
- existing `agents.rs` macOS parsing tests remain green.


### Task 7: Parse shell integration and retain only validated CWD

**Files**:

- [shell_integration.rs](../../src-tauri/src/shell_integration.rs)
- [pty.rs](../../src-tauri/src/pty.rs)

**Depends on**: Tasks 1A and 5

**Decision**: Rust parses chunked shell-integration output, emits structured prompt-ready events, and updates a session CWD only after filesystem validation.

**Build**:

- implement a bounded streaming parser for `OSC 133;B` and Windows Terminal CWD metadata split across arbitrary PTY chunks.
- emit `pty:prompt-ready` for every complete ready marker.
- validate CWD as absolute and existing before immutably replacing the session's last valid CWD; invalid values leave the prior value untouched.

**Verify**:

- Rust tests `parses_split_prompt_ready`, `parses_split_windows_cwd`, `rejects_relative_cwd`, `rejects_missing_cwd`, and `retains_last_valid_cwd` pass.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml shell_integration::` → all parser bounds and chunk tests pass.


### Task 8: Make automatic agent launch platform-safe

**Files**:

- [pty-client.ts](../../src/terminal/pty-client.ts)
- [agent-launch.ts](../../src/terminal/agent-launch.ts)
- [agent-launch.test.ts](../../src/terminal/agent-launch.test.ts)

**Depends on**: Tasks 4 and 7

**Decision**: macOS retains first-output plus fallback behavior; Windows launches only on `pty:prompt-ready` and cancels without writing after 15 seconds.

**Build**:

- add `listenPromptReady` to production and memory PTY clients.
- inject platform and non-blocking timeout-message callbacks into `createAgentLauncher`.
- keep at-most-once state immutable per transition and cancel timers on prune/dispose.

**Verify**:

- `npm test -- src/terminal/agent-launch.test.ts` → banner, first byte, `OSC 133;A`, ready, duplicate-ready, timeout-no-write, prune, and macOS regression cases pass.


### Task 9: Wire prompt readiness and timeout messaging into tab materialization

**Files**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)
- [events.ts](../../src/chrome/events.ts)

**Depends on**: Task 8

**Decision**: TabManager forwards structured readiness and uses the existing non-blocking chrome message surface for manual-launch guidance.

**Build**:

- register and dispose the prompt-ready listener alongside output/exit listeners.
- pass the initialized platform to the launcher.
- show `PowerShell was not ready in time. Launch the agent manually.` on Windows timeout without closing or fabricating pane state.

**Verify**:

- `npm test -- src/terminal/tab-manager.test.ts` → structured readiness launches once and timeout leaves the pane alive with zero automatic writes.


### Task 10: Own each Windows pane with a Job Object

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [job_object.rs](../../src-tauri/src/platform/windows/job_object.rs)
- [pty.rs](../../src-tauri/src/pty.rs)

**Depends on**: Tasks 1A and 5

**Decision**: Windows uses target-specific `windows-sys 0.61` APIs and stores an RAII Job Object handle with kill-on-close enabled; no silent PID-only success path is allowed.

**Build**:

- add target-specific `windows-sys` features for Foundation, Security, JobObjects, and Threading and update [Cargo.lock](../../src-tauri/Cargo.lock) in the same slice without unrelated upgrades.
- create the Job Object, set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, open/assign the spawned root process, and retain the handle in `Session`.
- put handle ownership and retryable close transitions behind an injected provider so lifecycle Red-Green tests run on macOS; keep Win32 handle calls in the `cfg(windows)` adapter.
- make explicit close/termination errors preserve retryable session/coordinator state; normal drop still closes the handle.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::windows::job_object::tests` → cross-platform provider tests `sets_kill_on_close`, `assigns_spawned_process`, `closes_owned_tree`, and `keeps_session_on_termination_failure` pass locally.
- the authorized `windows-check` run passes Win32 Job Object creation, assignment, and close integration tests before Task 11 starts.
- real-device Gate W3 remains required even when these tests pass.


### Task 11: Model and classify one Windows WMI process snapshot

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [command_line.rs](../../src-tauri/src/platform/windows/command_line.rs)
- [process_snapshot.rs](../../src-tauri/src/platform/windows/process_snapshot.rs)

**Depends on**: Tasks 1A and 10

**Decision**: target-specific `wmi 0.18` performs one typed `Win32_Process` query; classification is pure and fixture-testable.

**Build**:

- deserialize the six required WMI fields in the `cfg(windows)` provider and represent missing fields explicitly.
- keep snapshot graph traversal, wrapper command-line parsing, signature matching, PID-reuse rejection, and precedence in platform-neutral pure modules compiled on macOS.
- return an explicit incomplete snapshot error when required root/creation facts are unavailable.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::windows::process_snapshot::tests` → pure fixture tests cover direct binaries, npm shims, `node.exe` without a signature, suffix normalization, PID reuse, precedence ties, no descendants, busy descendants, and incomplete snapshots on macOS.
- injected provider test `queries_wmi_once_for_many_panes` records exactly one query locally; the authorized `windows-check` run additionally passes WMI deserialization and connection tests before Task 12 starts.


### Task 12: Extend `pty_info` with explicit process truth

**Files**:

- [info.rs](../../src-tauri/src/info.rs)
- [pty.rs](../../src-tauri/src/pty.rs)
- [mod.rs](../../src-tauri/src/platform/windows/mod.rs)

**Depends on**: Tasks 1A, 7, and 11

**Decision**: `pty_info` returns `kind` and `agent` for every requested live pane; Windows CWD comes from validated shell integration and process identity comes from the shared snapshot.

**Build**:

- expose immutable session identities and validated CWD snapshots without leaking mutable session handles.
- perform one platform inspection for all requested IDs.
- serialize `kind` as `idle-shell`, `agent`, `busy`, or `unknown` and agent as `claude`, `codex`, `gemini`, or null.

**Verify**:

- `cargo test --locked --manifest-path src-tauri/Cargo.toml info::` → macOS process-contract tests pass.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml platform::` → pure Windows fixtures and the current-host platform tests pass.
- the authorized `windows-check` run passes the full Rust suite before Task 13 starts.
- a provider failure returns requested IDs with `kind: "unknown"` rather than an empty result or idle shell.


### Task 13: Consume the explicit process contract in frontend display logic

**Files**:

- [process-info.ts](../../src/lib/process-info.ts)
- [process-info.test.ts](../../src/lib/process-info.test.ts)
- [pty-client.ts](../../src/terminal/pty-client.ts)
- [pty-client.test.ts](../../src/terminal/pty-client.test.ts)
- [pane-info-poller.test.ts](../../src/terminal/pane-info-poller.test.ts)
- [tab-materialize.test.ts](../../src/terminal/tab-materialize.test.ts)
- [close-guard.test.ts](../../src/terminal/close-guard.test.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Depends on**: Task 12

**Decision**: frontend agent truth comes from `kind` plus `agent`; process display remains nullable and never infers an agent from a selected intent.

**Build**:

- add `PaneProcessKind` and agent fields to `PaneProcessInfo`.
- derive agent color/header badge from explicit agent identity.
- render `unknown` without fabricating `shell`; keep an empty CWD empty.
- make `tildify` compare Windows drive/backslash paths case-insensitively at segment boundaries while preserving original display text and separator style.
- migrate every typed `PaneProcessInfo` literal in process-info, PTY-client, pane-info-poller, tab-materialize, close-guard, and TabManager tests to explicit `kind` and `agent` values in this task.

**Verify**:

- `npm test -- src/lib/process-info.test.ts src/terminal/pty-client.test.ts src/terminal/pane-info-poller.test.ts src/terminal/tab-materialize.test.ts src/terminal/close-guard.test.ts src/terminal/tab-manager.test.ts` → all four kinds, every migrated fixture, agent colors, unknown header, and macOS/Windows tildify cases pass.
- `npm run build` → no old three-field `PaneProcessInfo` literal remains as a typecheck failure before Tasks 14–15.


### Task 14: Gate attention only on explicit agent state

**Files**:

- [tab-manager.ts](../../src/terminal/tab-manager.ts)
- [agent-attention.test.ts](../../src/terminal/agent-attention.test.ts)
- [tab-manager.test.ts](../../src/terminal/tab-manager.test.ts)

**Depends on**: Task 13

**Decision**: only `info.kind === "agent"` with a non-null recognized agent opens Attention Rail and busy-spinner process gates.

**Build**:

- replace process-name inference in poll reconciliation, tab summaries, and status info.
- close the gate on `idle-shell`, `busy`, and `unknown` without replaying pre-gate activity.
- preserve shared attention reducer semantics and legacy unread state.

**Verify**:

- focused tests prove selected intent, `node`, busy wrapper, and unknown snapshots do not open the gate; recognized direct/wrapper agent snapshots do.


### Task 15: Make close confirmation fail safe for unknown inspection

**Files**:

- [pane-info.ts](../../src/terminal/pane-info.ts)
- [close-guard.ts](../../src/terminal/close-guard.ts)
- [close-guard.test.ts](../../src/terminal/close-guard.test.ts)

**Depends on**: Task 13

**Decision**: fresh inspection failure becomes explicit unknown state; close is never silently approved because metadata could not be read.

**Build**:

- synthesize unknown entries for requested panes when fresh IPC fails or omits an ID.
- prompt with process names for `agent`/`busy`.
- use generic fail-safe copy for `unknown`; allow immediate close only when every target is `idle-shell`.

**Verify**:

- `npm test -- src/terminal/close-guard.test.ts` → idle, agent, busy, unknown, missing-ID, IPC-failure, dialog-failure, and re-entrant cases pass.


### Task 16: Recognize Windows terminal paths

**Files**:

- [terminal-links.ts](../../src/lib/terminal-links.ts)
- [terminal-links.test.ts](../../src/lib/terminal-links.test.ts)

**Depends on**: Tasks 1A and 4

**Decision**: path extraction recognizes Unix and Windows forms without treating URL schemes, box drawing, or arbitrary colon text as files.

**Build**:

- add drive-letter backslash/slash, UNC, and Windows relative candidates with optional line/column suffixes.
- preserve original matched text and path separators.
- retain URL precedence and candidate-count bounds.

**Verify**:

- `npm test -- src/lib/terminal-links.test.ts` → drive, UNC, spaces policy, Unicode, suffix, URL overlap, malformed drive, and Unix regressions pass.


### Task 17: Canonicalize Windows paths without leaking verbatim prefixes

**Files**:

- [links.rs](../../src-tauri/src/links.rs)

**Depends on**: Tasks 1A, 4A, and 16

**Decision**: Rust remains the file-existence authority and normalizes canonical Windows verbatim paths only at the IPC boundary.

**Build**:

- use the platform `user_home()` provider from Tasks 2 and 5 for tilde expansion; do not read `HOME`, `USERPROFILE`, or another provider in `links.rs`.
- accept absolute drive/UNC and relative paths against validated pane CWD.
- strip `\\?\` and convert `\\?\UNC\` to normal UNC after canonicalization.
- keep index alignment and per-request path bounds.

**Verify**:

- platform-neutral normalization tests cover drive, UNC, tilde, verbatim drive/UNC removal, separator preservation, and case comparison on macOS.
- the authorized `windows-check` run covers real drive/UNC filesystem resolution, relative paths, missing files, directories, and unknown CWD before Task 18 starts.
- existing macOS `links.rs` tests pass unchanged.


### Task 18: Send structured editor intent from the frontend

**Files**:

- [editor-command.ts](../../src/lib/editor-command.ts)
- [editor-command.test.ts](../../src/lib/editor-command.test.ts)
- [link-client.ts](../../src/terminal/link-client.ts)
- [link-client.test.ts](../../src/terminal/link-client.test.ts)
- [link-provider.ts](../../src/terminal/link-provider.ts)
- [link-provider.test.ts](../../src/terminal/link-provider.test.ts)

**Depends on**: Task 17

**Decision**: frontend never sends a prebuilt executable shell string; it sends editor id, custom template, canonical file path, line, and column.

**Build**:

- replace command construction with an immutable `OpenEditorRequest`.
- keep editor preset labels/settings schema stable.
- update production and memory clients to record structured requests.
- preserve user-readable errors for empty custom templates and IPC failure.

**Verify**:

- `npm test -- src/lib/editor-command.test.ts src/terminal/link-client.test.ts src/terminal/link-provider.test.ts` → the Red test fails on legacy string IPC first, then structured request, empty custom template, URL separation, and error cases pass after the minimum production change.


### Task 19: Validate and launch editor argv in Rust

**Files**:

- [links.rs](../../src-tauri/src/links.rs)
- [command_line.rs](../../src-tauri/src/platform/windows/command_line.rs)

**Depends on**: Tasks 1A, 11, and 18

**Decision**: built-in Windows editors launch as executable plus argv; custom templates use Windows argv parsing and reject shell syntax before placeholder substitution.

**Build**:

- deserialize and validate editor id, canonical absolute file, positive line/column, and bounded template independently.
- map VS Code, Cursor, and Zed to fixed executable/argv shapes.
- reject pipes, redirects, command chaining, variable expansion, and empty executables in custom templates.
- retain the macOS login-shell launch adapter behind the platform boundary.

**Verify**:

- platform-neutral command-line tests cover fixed editors, spaces/Unicode/UNC, placeholders, missing placeholders, shell operators, empty command, and invalid path on macOS.
- the authorized `windows-check` run passes Windows executable launch success/failure tests before Task 20 starts.
- `rg -n "command: String" src-tauri/src/links.rs src/terminal/link-client.ts` → legacy string IPC is gone.


### Task 20: Quote dropped paths for the active platform shell

**Files**:

- [shell-escape.ts](../../src/lib/shell-escape.ts)
- [shell-escape.test.ts](../../src/lib/shell-escape.test.ts)
- [terminal-manager.ts](../../src/terminal/terminal-manager.ts)

**Depends on**: Task 4

**Decision**: dropped paths use existing POSIX escaping on macOS and single-quoted PowerShell literals on Windows.

**Build**:

- make path quoting platform-explicit.
- double embedded PowerShell single quotes and preserve Unicode/backslashes.
- keep one trailing space after multi-path insertion.

**Verify**:

- `npm test -- src/lib/shell-escape.test.ts src/terminal/terminal-manager.test.ts` → POSIX regression and Windows drive/UNC/space/quote cases pass.


### Task 21: Replace the Cmd-held module with a primary-modifier contract

**Files**:

- [primary-modifier.ts](../../src/terminal/primary-modifier.ts)
- [primary-modifier.test.ts](../../src/terminal/primary-modifier.test.ts)
- [meta-key.ts](../../src/terminal/meta-key.ts)
- [link-provider.ts](../../src/terminal/link-provider.ts)
- [link-provider.test.ts](../../src/terminal/link-provider.test.ts)
- [osc-link-handler.ts](../../src/terminal/osc-link-handler.ts)
- [osc-link-handler.test.ts](../../src/terminal/osc-link-handler.test.ts)

**Depends on**: Task 4

**Decision**: link hover/activation tracks the active platform's primary modifier; the old `meta-key.ts` module is replaced rather than duplicated.

**Build**:

- rename held-state APIs from Meta-specific to primary-modifier terminology.
- use `hasPrimaryModifier` for key and mouse reconciliation.
- update link and OSC handlers plus their existing `./meta-key` mocks while preserving plain-click terminal/TUI behavior.

**Verify**:

- `npm test -- src/terminal/primary-modifier.test.ts src/terminal/link-provider.test.ts src/terminal/osc-link-handler.test.ts` → Windows Ctrl Red cases and obsolete `./meta-key` mocks fail before production edits, then Cmd behavior on macOS and Ctrl behavior on Windows pass.
- `test ! -e src/terminal/meta-key.ts` → obsolete module is removed.


### Task 22: Apply the primary modifier to pointer and local-key surfaces

**Files**:

- [pane-drag.ts](../../src/terminal/pane-drag.ts)
- [pane-drag.test.ts](../../src/terminal/pane-drag.test.ts)
- [open-board.tsx](../../src/open-board/open-board.tsx)
- [open-board.test.tsx](../../src/open-board/open-board.test.tsx)
- [preset-editor.tsx](../../src/presets/preset-editor.tsx)
- [preset-editor.test.tsx](../../src/presets/preset-editor.test.tsx)

**Depends on**: Task 21

**Decision**: pane drag mode, Open Folder, and preset-editor split gestures use the shared primary-modifier predicate.

**Build**:

- switch drag swap/dock mode live when Cmd/Ctrl changes.
- bind Open Folder to Cmd+O on macOS and Ctrl+Shift+O on Windows.
- bind preset split gestures to Cmd+Arrow on macOS and Ctrl+Arrow on Windows.

**Verify**:

- `npm test -- src/terminal/pane-drag.test.ts src/open-board/open-board.test.tsx src/presets/preset-editor.test.tsx` → Windows modifier Red cases fail before production edits, then both platforms and modifier release during drag pass.


### Task 23: Define separate macOS and Windows keymaps

**Files**:

- [action-registry.ts](../../src/terminal/action-registry.ts)
- [action-registry.test.ts](../../src/terminal/action-registry.test.ts)
- [keymap.test.ts](../../src/terminal/keymap.test.ts)

**Depends on**: Task 4

**Decision**: action identity/scope/menu metadata stays shared; `MACOS_KEYMAP` preserves every current chord and `WINDOWS_KEYMAP` implements the fixed map in section 5.

**Build**:

- rename the current default to `MACOS_KEYMAP`.
- add the complete Windows bindings without capturing protected bare Ctrl sequences.
- select the default keymap from the initialized platform.
- collision-check bindings within each platform.

**Verify**:

- `npm test -- src/terminal/action-registry.test.ts src/terminal/keymap.test.ts` → macOS exact-regression, Windows full-map, collision, physical-digit, and protected-Ctrl tests pass.


### Task 24: Keep menu generation macOS-only and update local search handling

**Files**:

- [generate-menu.ts](../../scripts/generate-menu.ts)
- [menu_registry.rs](../../src-tauri/src/menu_registry.rs)
- [search-bar.ts](../../src/terminal/search-bar.ts)

**Depends on**: Task 23

**Decision**: Cocoa generation reads `MACOS_KEYMAP` explicitly; search-bar-local handling matches the active platform's global find bindings.

**Build**:

- update generator imports and regenerate menu output without changing generated accelerators.
- route search local keydown through the same platform binding matcher for find/next/previous.

**Verify**:

- `npm run generate:menu` then `npm run generate:menu:check` → generated registry is current.
- `git diff -- src-tauri/src/menu_registry.rs` → no accelerator content changes beyond generator header/import wording if required.
- `npm test -- src/terminal/search-bar.test.ts` → macOS and Windows local search cases pass.


### Task 25: Add Windows terminal copy and paste

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [lib.rs](../../src-tauri/src/lib.rs)
- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)
- [default.json](../../src-tauri/capabilities/default.json)

**Depends on**: Task 4

**Decision**: use the official Tauri clipboard plugin; grant only text read/write permissions needed by the Windows chords.

**Build**:

- add matching Rust and JavaScript clipboard-manager v2 dependencies and update both lockfiles in this slice without unrelated upgrades.
- register the plugin in the Tauri builder in `src-tauri/src/lib.rs`.
- grant main-window read-text and write-text permissions.

**Verify**:

- `npm install --package-lock-only` updates `package-lock.json`, and the Rust dependency update writes `src-tauri/Cargo.lock`; inspection shows no unrelated package upgrade.
- `rg -n "tauri_plugin_clipboard_manager|clipboard-manager:(allow-read-text|allow-write-text)" src-tauri/src/lib.rs src-tauri/capabilities/default.json` → plugin registration and only the required text permissions are present.
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`, `npm ci`, and `npm run build` resolve the locked plugin APIs.
- the authorized `windows-check` run is green before Task 26 starts.


### Task 26: Route Windows clipboard chords without stealing PTY controls

**Files**:

- [terminal-clipboard.ts](../../src/terminal/terminal-clipboard.ts)
- [terminal-clipboard.test.ts](../../src/terminal/terminal-clipboard.test.ts)
- [pane.ts](../../src/terminal/pane.ts)

**Depends on**: Tasks 23 and 25

**Decision**: Windows `Ctrl+Shift+C/V` are pane-local clipboard actions; macOS native copy/paste behavior and bare Ctrl input remain unchanged.

**Build**:

- copy only non-empty xterm selection through the plugin.
- paste clipboard text through pane `onData` so input/activity tracking remains truthful.
- return terminal event ownership correctly and surface clipboard errors non-blockingly.

**Verify**:

- `npm test -- src/terminal/terminal-clipboard.test.ts` → copy, no-selection, paste, clipboard failure, macOS bypass, and protected bare Ctrl cases pass.


### Task 27: Derive all visible shortcut labels by platform

**Files**:

- [shortcut-label.ts](../../src/lib/shortcut-label.ts)
- [shortcut-label.test.ts](../../src/lib/shortcut-label.test.ts)
- [chrome-actions.tsx](../../src/ui/chrome-actions.tsx)

**Depends on**: Task 23

**Decision**: shortcut labels are formatted from platform binding data; tooltips do not hardcode Cmd/Ctrl glyphs.

**Build**:

- format macOS glyph labels and readable Windows `Ctrl+...` labels.
- update chrome action tooltips to request labels by action id.
- cover actions with multiple bindings using the preferred display binding.

**Verify**:

- `npm test -- src/lib/shortcut-label.test.ts` → macOS and Windows label snapshots pass.
- `rg -n "⌘|Cmd\\+" src/ui/chrome-actions.tsx` → no hardcoded shortcut remains.


## 7. Delivery continuation

Remaining shortcut copy, chrome, packaging, CI, release staging, documentation, and real-Windows evidence continue in [2026-07-29-windows-desktop-delivery.md](2026-07-29-windows-desktop-delivery.md). Approval of this implementation plan covers that linked delivery plan as one scope.
