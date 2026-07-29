# Spec — Windows desktop release

- **Date:** 2026-07-29
- **Status:** Approved for engineering preview; runtime gates pending
- **Downstream:** [implementation plan](../plans/2026-07-29-windows-desktop.md)
- **Target outcome:** a Windows build that preserves Deck's core terminal
  behavior, not merely an installer that launches

## 1. Problem

SpaceVibe Deck is currently a macOS product. Tauri and `portable-pty` provide
part of the Windows foundation, but several core behaviors are explicitly
macOS-only. Packaging the current source as-is would launch PowerShell while
silently losing process names, live working directories, reliable agent
detection, Windows path links, keyboard shortcuts, and complete process-tree
cleanup.

The Windows release must therefore be treated as a platform port with a release
pipeline, not as a bundle-configuration change.

## 2. Goals

The first Windows beta must:

1. Install, launch, update by replacement, and uninstall on Windows 11 x64.
2. Open real PowerShell PTYs with working input, output, resize, Unicode, color,
   and high-volume streaming.
3. Detect and launch installed Claude Code, Codex, and Gemini CLI commands.
4. Preserve live pane CWD and process identity so split panes, pane headers,
   Attention Rail, and busy-close guards remain truthful.
5. Close the entire pane process tree without leaving agent processes behind.
6. Support Windows paths, editor links, workspace recents, presets, settings,
   notifications, and file dialogs.
7. Use Windows-native keyboard and window conventions without stealing shell
   control sequences such as `Ctrl+C`, `Ctrl+D`, `Ctrl+W`, or `Ctrl+K`.
8. Produce a repeatable Windows installer from CI without regressing macOS.

## 3. Non-goals

- Microsoft Store submission.
- Windows on ARM64.
- Windows 10 as a supported target.
- WSL, Command Prompt, Git Bash, or a user-selectable default shell.
- A custom frameless Windows title bar.
- Auto-update infrastructure.
- Linux support.
- Redesigning the app chrome or changing the Deck domain model.

## 4. Current constraints

| Area | Current source fact | Windows consequence |
| --- | --- | --- |
| PTY | [`default_shell`](../../src-tauri/src/pty.rs) checks `SHELL` before its Windows fallback, and the crate is `portable-pty` | Basic ConPTY spawn is partly prepared, but a Windows machine with `SHELL` set may incorrectly launch Git Bash |
| Agent launch | [`agent-launch.ts`](../../src/terminal/agent-launch.ts) treats the first output byte as prompt readiness, then types the agent after a blind three-second fallback | A PowerShell banner or initialization output can receive and swallow the command before the prompt is ready |
| Agent detection | [`detect_agents`](../../src-tauri/src/agents.rs) runs a Unix login shell and accepts only `/`-prefixed paths | No Windows agent is detected |
| Pane information | [`process_name` and `process_cwd`](../../src-tauri/src/info.rs) return `None` outside macOS | Busy guard, inherited CWD, pane badges, and process-gated attention degrade |
| Pane teardown | [`kill_pty`](../../src-tauri/src/pty.rs) terminates process groups only on macOS | Child agents may outlive a closed pane |
| Paths | [`links.rs`](../../src-tauri/src/links.rs), [`terminal-links.ts`](../../src/lib/terminal-links.ts), and [`shell-escape.ts`](../../src/lib/shell-escape.ts) assume Unix home, separators, and shell quoting | Drive-letter, UNC, backslash, and PowerShell paths are incomplete |
| Modifiers | [`DEFAULT_KEYMAP`](../../src/terminal/action-registry.ts) and pointer/search paths hardcode `metaKey`; `Cmd+Shift+C` already owns `copy-cwd` | Keyboard commands, links, drag modes, and board/preset pointer gestures are inaccessible or collide on Windows |
| Native menu | [`menu::install`](../../src-tauri/src/menu.rs) is a no-op outside macOS | Windows must not depend on the macOS menu path |
| Window chrome | [`App`](../../src/ui/app.tsx) and [`styles.css`](../../src/styles.css) reserve space for macOS traffic lights and overlay chrome | The current shell would create incorrect Windows spacing/controls |
| Packaging | [`tauri.conf.json`](../../src-tauri/tauri.conf.json) sets `targets: "all"` and a macOS-only short description; the icon set already includes Windows assets | A default Windows build emits MSI and NSIS, and carries incorrect installer metadata |
| Release | [`release.yml`](../../.github/workflows/release.yml) builds only `universal-apple-darwin` on macOS | No Windows artifact is produced or tested |

## 5. Options

### Option A — Bundle-only preview

Build the current source on Windows, accept missing pane metadata and shortcuts,
and publish an unsigned installer.

- **Best for:** a private technical spike only.
- **Cost:** small enough for a disposable spike, not a release estimate.
- **Risk:** high product risk despite low implementation effort. The app appears
  functional while close guards, split CWD, agent detection, and attention
  behavior are wrong.

### Option B — Parity-first Windows beta

Add Windows-specific runtime seams, native Windows chrome behavior, a dedicated
keymap, and a Windows CI/private-artifact job. Stage a private unsigned
engineering preview first; require code signing before a public direct-download
release.

- **Best for:** validating real Windows demand without taking on Store
  certification.
- **Cost:** no calendar estimate until the Windows feasibility gates below pass.
- **Risk:** medium. Process/CWD integration and terminal keyboard behavior need
  real-device verification.

### Option C — Store-ready release from day one

Do Option B plus signing operations, Store-compatible installer behavior,
submission metadata, certification, and update policy.

- **Best for:** a committed Windows launch with an established publisher
  identity.
- **Cost:** Option B plus engineering and external identity/certification lead
  time.
- **Risk:** high schedule uncertainty before product behavior is validated.

## 6. Recommendation

Choose **Option B**.

The first milestone is a Windows 11 x64 engineering preview distributed as a
private, retention-limited GitHub Actions artifact containing one `NSIS`
`-setup.exe`. It may be unsigned only while access is private and named testers
are explicitly warned about SmartScreen. It must not be attached to the
existing public GitHub Release. A public Windows download is blocked until the
artifact is signed with a trusted Windows publisher identity and the real-device
acceptance gates pass.

The private-artifact workflow must fail closed if the repository is not private.

No Apple Developer account is involved in the Windows pipeline.

### 6.1 Feasibility gates before estimation

Run disposable spikes on a standard, non-admin Windows 11 account before
approving an implementation estimate:

1. PowerShell prompt integration emits reliable OSC 133 readiness after a
   banner, a normal profile, and a deliberately slow profile.
2. WMI exposes command lines for direct binaries and npm-installed agent shims
   without elevation.
3. A per-pane Windows Job Object can own and terminate the ConPTY PowerShell
   tree without breaking the three supported agents.
4. The platform-specific Tauri configuration produces exactly one NSIS setup
   executable with Windows-correct metadata.

Failure of any gate returns the design to review; it is not absorbed as an
implementation detail.

## 7. Design decisions

### 7.1 Platform boundary

Platform differences must live behind explicit platform contracts instead of
being scattered through view components:

- shell selection and command discovery;
- home-directory and path normalization;
- pane CWD/process inspection;
- process-tree termination;
- primary modifier across keyboard, pointer click/hover, and drag gestures;
- shortcut labels and platform-specific input behavior;
- window chrome mode;
- bundle and release configuration.

Shared pane, tab, layout, attention, and settings behavior remains
platform-neutral.

### 7.2 Shell and agent discovery

- Prefer `pwsh.exe` when installed; otherwise use `powershell.exe`.
- On Windows, ignore `SHELL` unconditionally. `SHELL` remains a Unix-only input;
  it must never select Git Bash, MSYS, WSL, or another shell for this release.
- Load the user's normal PowerShell profile. Do not write to or modify the
  user's profile on disk.
- Keep WSL, `cmd.exe`, Git Bash, and shell selection out of the first beta.
- Resolve allowlisted agents through the Windows executable search path with a
  three-second upper bound.
- Accept only absolute results whose final command name matches `claude`,
  `codex`, or `gemini`, including normal Windows executable suffixes.
- Failure degrades to `Shell only` with a logged diagnostic; it must not block
  app startup.

### 7.3 Prompt readiness and automatic agent launch

The injected, session-only PowerShell prompt integration emits:

- Windows Terminal-compatible CWD metadata;
- `OSC 133;A` at the beginning of the prompt;
- `OSC 133;B` when the prompt has finished rendering and is ready for input.

`OSC 133;B` is the only Windows readiness signal that may release an armed
automatic agent command. A banner, arbitrary first byte, `OSC 133;A`, or elapsed
time never counts as ready.

If no `OSC 133;B` arrives within a bounded 15-second launch timeout, Deck cancels
the automatic write and shows a non-blocking message asking the user to launch
the agent manually. The timeout must never type blindly into the PTY. Each pane
still launches its armed agent at most once.

### 7.4 CWD, process identity, and pane lifecycle

The current nullable `pty_info` contract cannot distinguish an idle shell from
an inspection failure. Extend it with an explicit process state:

```ts
type PaneProcessKind = "idle-shell" | "agent" | "busy" | "unknown";

interface PaneProcessInfo {
  readonly id: number;
  readonly cwd: string | null;
  readonly process: string | null;
  readonly kind: PaneProcessKind;
  readonly agent: "claude" | "codex" | "gemini" | null;
}
```

- Track live CWD through child-session shell integration emitted by PowerShell,
  using Windows Terminal-compatible CWD metadata. The integration is injected
  into the spawned session only and never persists in the user's profile.
- Treat every reported CWD as untrusted terminal output: accept it only when it
  is an absolute, existing filesystem directory.
- Put each spawned PowerShell root in a per-pane Windows Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; child breakaway is disabled unless a
  supported-agent compatibility spike proves a documented exception necessary.
- Read one WMI `Win32_Process` snapshot per poll cycle for all live panes,
  requesting `ProcessId`, `ParentProcessId`, `CreationDate`, `Name`,
  `ExecutablePath`, and `CommandLine`. Do not use undocumented remote-PEB
  reading through `NtQueryInformationProcess`, and do not spawn PowerShell/WMI
  subprocesses per pane.
- Reject PID-reuse edges by comparing `CreationDate` with the owning shell
  session. Only descendants of that session are eligible.
- Normalize executable identity by lowercasing the basename and stripping
  `.exe`, `.cmd`, `.bat`, and `.ps1`.
- A direct normalized executable match for `claude`, `codex`, or `gemini` is an
  agent candidate. For wrapper processes (`node`, `cmd`, or PowerShell), parse
  `CommandLine` with Windows argv rules and match a versioned signature table:
  `@anthropic-ai/claude-code`, `@openai/codex`, or `@google/gemini-cli`.
  `node.exe` alone is never an agent signal.
- Candidate precedence is deterministic: direct executable match over wrapper
  signature, then deepest descendant, then newest `CreationDate`, then highest
  PID. The selected-agent intent may validate a match but is never sufficient
  by itself to claim a live agent.
- No descendants means `idle-shell`. A live unrecognized descendant means
  `busy`. A failed or incomplete snapshot means `unknown`, not idle.
- Attention Rail opens its process gate only for `kind: "agent"`. Busy-close
  treats `busy` normally and shows a generic fail-safe confirmation for
  `unknown`.
- Closing a pane terminates its Job Object. A successful close leaves no
  descendant process and no PTY reader thread.
- If pane metadata temporarily cannot be read, the UI may show unknown state,
  but it must not fabricate an idle shell or a working directory.

This is a release gate because split-pane CWD inheritance, Attention Rail
gating, agent labels, and destructive close confirmation all depend on it.

### 7.5 Windows paths and editor links

- Support `C:\...`, `C:/...`, UNC paths, relative paths, and optional
  `:line:column` suffixes.
- Use the Windows user-profile directory as home and display it as `~`.
- Normalize for comparison without rewriting the original user-visible path.
- Strip `\\?\` and convert `\\?\UNC\` back to normal Win32/UNC form at the Rust
  boundary after `canonicalize`; verbatim paths must not leak into UI copy or
  editor arguments.
- The frontend sends structured editor intent (`editor`, validated file path,
  line, and column), not a prebuilt shell command.
- Windows launches built-in editors directly as executable plus argv; it never
  runs `$SHELL -lc`.
- A custom Windows editor template is parsed into executable plus argv using
  Windows command-line rules before placeholder substitution. Pipes,
  redirection, variable expansion, and other shell syntax are unsupported and
  rejected with a user-readable error.
- Terminal text must never become an executable name. The editor id/template and
  canonical file path are validated independently at the IPC boundary.
- `Ctrl+click` activates URLs and validated file paths on Windows. Plain click
  remains available to terminal selection and TUI mouse input.

### 7.6 Keyboard and pointer modifier contract

Windows gets a dedicated keymap; it is not a mechanical `Cmd` → `Ctrl`
replacement.

- Bare `Ctrl+C`, `Ctrl+D`, `Ctrl+W`, `Ctrl+K`, `Ctrl+F`, and other conventional
  terminal control sequences continue to reach the PTY.
- Copy and paste use `Ctrl+Shift+C` and `Ctrl+Shift+V`.
- Copy Working Directory moves from the colliding chord to
  `Ctrl+Alt+Shift+C` on Windows. Its macOS chord remains unchanged.
- App commands use collision-audited `Ctrl+Shift` or other Windows Terminal-like
  chords.
- A single primary-modifier predicate covers keyboard events, search-bar local
  handling, link click/hover state, pane drag swap-vs-dock, Open board pointer
  gestures, and preset-editor pointer gestures. It resolves to `metaKey` on
  macOS and `ctrlKey` on Windows.
- Every visible shortcut label, tooltip, status hint, and Settings description
  reflects the active platform.
- Existing macOS chords and generated macOS menu behavior remain unchanged.
- Automated tests cover modifier matching and prove the protected bare `Ctrl`
  sequences are not captured.

The implementation plan must include the complete Windows action-to-chord table
before code changes begin.

### 7.7 Window chrome and demo surface

Use the native decorated Windows title bar and system controls. Do not recreate
minimize, maximize, close, Snap, resizing, or accessibility behavior in Preact.

- In top-tab mode, remove the blank traffic-light spacer on Windows.
- In sidebar mode, retain a compact in-app toolbar for Deck actions beneath the
  native title bar.
- Keep the existing visual language; this is platform adaptation, not a
  redesign.
- The eye-review demo surface is the real Windows app at `1100×720` and the
  minimum `480×320`, in both top-tab and sidebar modes.

Approval of this spec confirms the Windows UI idea and approach. Frontend
implementation still requires screenshot approval against
[`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md).

### 7.8 Packaging and release

- Keep only platform-neutral metadata in the base Tauri configuration. Replace
  the current macOS-only short description with neutral copy; OS-specific
  window and bundle values belong in platform-specific configuration.
- The Windows platform configuration sets `bundle.targets` to `["nsis"]`.
  A default Windows build must not emit an MSI.
- Produce exactly one x64 `NSIS` setup executable on a `windows-latest` CI
  runner; CI fails if the expected setup asset count is not one.
- Use Evergreen WebView2 and let the installer bootstrap it when absent.
- The unsigned engineering preview is retained as a private GitHub Actions
  artifact and never attached to a tagged GitHub Release.
- A future signed public release may contain both existing macOS assets and the
  Windows asset under the same application version only after Gates W1–W4, the
  full real-device checklist, and separate publication authorization pass.
- CI must build the Windows artifact on Windows; cross-compiling from the
  current macOS job is not the release path.
- Private engineering preview: an unsigned GitHub Actions artifact is permitted
  for named testers with repository access and an explicit SmartScreen warning.
- Public direct download: trusted code signature and timestamp are mandatory.
- Microsoft Store packaging and Partner Center publication remain a later
  decision.

## 8. User flow

1. An authorized engineering tester downloads the private Windows setup
   artifact from the successful GitHub Actions run.
2. Installer verifies or bootstraps WebView2, then installs Deck.
3. Deck opens with native Windows window controls and the Open board.
4. User selects a workspace, preset, and detected agent.
5. Deck opens PowerShell panes in the selected workspace, waits for
   `OSC 133;B`, and launches the agent exactly once.
6. Split/new panes inherit the live CWD when available.
7. Status, Attention Rail, and close confirmation reflect the live process.
8. Closing a pane or Deck terminates the owned process tree after the existing
   confirmation flow.

## 9. Failure behavior

| Failure | Required behavior |
| --- | --- |
| PowerShell 7 is absent | Fall back to Windows PowerShell |
| No supported PowerShell can spawn | Show a user-readable pane error; do not create a fake live pane |
| Agent discovery times out or fails | Show `Shell only`; log the diagnostic |
| Prompt-ready marker does not arrive in 15 seconds | Cancel automatic launch and tell the user to launch manually; never type on timeout |
| Shell integration emits an invalid CWD | Ignore it and retain the last validated CWD |
| WMI process inspection fails or command line is unavailable | Show unknown process state; close uses fail-safe confirmation; do not claim idle or agent |
| Process-tree termination fails | Surface the failure and keep enough session state to retry; do not silently report a clean close |
| WebView2 bootstrap fails | Installer reports the prerequisite failure and aborts cleanly |
| Unsigned private beta triggers SmartScreen | Release notes explain the expected warning; public release remains blocked |
| Windows artifact build fails | No private artifact is offered and no GitHub Release is created or edited |

## 10. Verification and acceptance

### Automated

- Existing frontend tests and typecheck pass unchanged on CI.
- Rust unit tests run on Windows in addition to the current CI platform.
- Windows shell tests prove `SHELL` is ignored and `pwsh` falls back to Windows
  PowerShell.
- Agent-launch tests prove banner/first-byte/`OSC 133;A` do not launch,
  `OSC 133;B` launches once, and timeout never writes.
- Process tests cover direct binaries, npm `node.exe` shims, suffix
  normalization, PID reuse, precedence, unknown state, and Job Object teardown.
- Path/editor tests cover drive and UNC paths, verbatim-prefix removal,
  structured argv launch, and rejection of custom shell syntax.
- Modifier tests cover both keyboard and pointer call sites, prove protected
  terminal control sequences remain uncaptured, and protect the Copy/Copy CWD
  split.
- Platform metadata validation proves Windows copy contains no macOS-only claim
  and the build produces exactly one NSIS setup asset.

### Real Windows runtime

- Clean Windows 11 x64 VM or device, without a preinstalled Deck build.
- Install, first launch, relaunch, replacement install, and uninstall.
- PowerShell 7 present and absent.
- `SHELL` set to a Git Bash path; Deck still opens PowerShell.
- Normal, banner-producing, and deliberately slow PowerShell profiles.
- At least one real supported agent CLI; all three discovery paths tested when
  available in both direct-binary and npm-shim forms under a non-admin account.
- Open workspace, split both directions, resize repeatedly, switch tabs, and
  stream high-volume output.
- Change CWD, split, and verify the new pane starts in that directory.
- Start an agent, verify busy/attention state, close the pane, and confirm no
  descendant process remains.
- Validate `Ctrl+C` interrupt, `Ctrl+Shift+C/V`,
  `Ctrl+Alt+Shift+C`, Windows shortcut labels, modifier-based pane drag, board
  and preset gestures, and `Ctrl+click` links.
- Validate Unicode filenames, spaces, drive-letter paths, UNC paths, and
  Vietnamese IME input.
- Validate notifications in foreground and background.
- Capture screenshots for both tab-bar positions at the two required viewport
  sizes.
- Record SmartScreen behavior for unsigned beta and signed release candidates.

### macOS regression

- Existing macOS build, menu generation check, unit tests, and release artifact
  remain unchanged.
- macOS shortcuts, traffic-light layout, PTY cleanup, agent detection, path
  links, and notification behavior receive a focused smoke test.

## 11. Rollout

1. **Engineering preview:** local/CI Windows build; no release claim.
2. **Private engineering cohort:** unsigned GitHub Actions NSIS artifact for
   named testers with repository access and known SmartScreen friction.
3. **Public beta:** signed and timestamped NSIS artifact on the shared GitHub
   Release only after runtime acceptance passes and publication is separately
   authorized.
4. **Store evaluation:** decide whether Microsoft Store, auto-update, ARM64, and
   Windows 10 support justify separate specs.

## 12. Approval decisions

Approving this draft accepts these defaults:

1. Windows 11 x64 only for the supported beta.
2. Native Windows title bar, not custom window controls.
3. PowerShell only; no WSL or shell selector.
4. Parity-first beta rather than a degraded bundle-only preview.
5. Private unsigned GitHub Actions artifact followed by a separately authorized
   signed public download.
6. NSIS direct download before any Microsoft Store work.
7. OSC 133 prompt readiness, WMI process identity, and per-pane Job Objects are
   release gates rather than optional follow-ups.

## 13. References

- [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri platform-specific configuration](https://v2.tauri.app/develop/configuration-files/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Microsoft SmartScreen reputation](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
- [Windows Terminal shell integration](https://learn.microsoft.com/windows/terminal/tutorials/shell-integration)
- [Windows Terminal same-directory integration](https://learn.microsoft.com/windows/terminal/tutorials/new-tab-same-directory)
- [Microsoft Win32_Process](https://learn.microsoft.com/windows/win32/cimwin32prov/win32-process)
- [Microsoft Windows Job Objects](https://learn.microsoft.com/windows/win32/procthread/job-objects)
