# Windows PR #7 ship-blocker remediation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Audit:** [2026-07-30-windows-desktop-pr7-audit.md](../review/2026-07-30-windows-desktop-pr7-audit.md)
**Spec:** [2026-07-29-windows-desktop-design.md](../specs/2026-07-29-windows-desktop-design.md)
**Branch:** `feat/windows-desktop`

**Goal:** Close the code-side ship blockers A1, A3, A4, A5, A6 and A8 from the pre-ship audit, so a Windows engineering-preview installer can be produced once the delivery gates (B1–B3) and manual QA are separately satisfied.

**Architecture:** Every fix stays inside the platform seams the branch already established. The PowerShell prompt-integration script keeps its OSC contract and only changes how the ESC byte is spelled. Shell-integration CWD validation moves out from under the global session mutex without changing its observable "last valid wins" semantics. Clipboard actions gain real dispatch targets on the existing action-registry → keymap → `commands` path instead of a second pane-local key handler. WebView2 accelerator keys are disabled through the one API surface Tauri 2.11.5 actually exposes (`with_webview` + COM), because the wry builder flag is not passed through. Process identity leaves the synchronous spawn path.

**Tech Stack:** Rust (Tauri 2.11.5, portable-pty 0.9, wmi 0.18, windows-sys 0.61, windows-core `=0.61.2`, webview2-com 0.38), Preact + xterm.js, Vitest, `cargo test`.

## Global Constraints

- English only for every string, comment and doc — no Vietnamese in this repo (R1).
- Commit messages: English, conventional commits with a scope (W5). One commit per task.
- Windows target is Windows 11 x64; PowerShell 7 is preferred and Windows PowerShell 5.1 is a **supported** fallback (spec §9 line 347).
- `windows-core` stays pinned at `=0.61.2` — mixed 0.61/0.62 COM traits do not interoperate (`src-tauri/Cargo.toml:36-38`).
- Do **not** add a recursive-kill fallback for the Job Object race — the implementation plan forbids it (`2026-07-29-windows-desktop.md:104`). Run Gate W3 instead.
- Menu code is generated; edit the registry, never the output (R3).
- Verification available on the macOS dev host: `npm test`, `npx tsc --noEmit`, `cargo test --locked`, `cargo fmt --check`. Windows-only behavior is **not** verifiable here — no `x86_64-pc-windows-msvc` target is installed. Every task states what it defers to CI (`windows-check`) and what it defers to manual QA.
- `cargo clippy` currently reports 6 pre-existing errors on this branch (confirmed identical with the task diffs stashed). CI does not run clippy (`ci.yml` runs `cargo fmt --check` + `cargo test` only). Do not fix them inside these tasks (W3).

---

## Fix-order and coupling — read before starting

The audit's fix-order hazards make the task order load-bearing, not stylistic:

| Constraint                                                                                                                                                                     | Consequence for this plan                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 unmasks A3.** No ESC byte reaches the parser today, so `retain_valid_cwd` never runs. Flipping the escape makes the UNC network stall and NTLM egress live the same hour. | A3 lands **first** (Tasks 1 and 2), A1 **after** (Task 3). Tasks 1 and 2 are no-ops on today's runtime, which is exactly why they are safe to land alone. |
| **A4 unmasks A5.** Making the chords reachable turns a dead feature into an unbracketed raw PTY write.                                                                         | Task 4 does both in one commit. Do not split it.                                                                                                          |
| **A1 unmasks C2.** The console flash needs a non-null cwd.                                                                                                                     | Out of scope here; expect QA item 11 to start reproducing after Task 3.                                                                                   |
| **A2's fix already landed** (`f75fe12`) and touched the prior M2 fix.                                                                                                          | Nothing to do; Task 2 must not reintroduce a `Session` drop under the lock.                                                                               |

`consume_shell_integration` is called from exactly one thread per session — the emitter thread spawned in `spawn_shell` (`pty.rs:319` and `pty.rs:334` are both inside that single `thread::spawn`). Task 2 depends on this: it is why splitting one lock window into two cannot interleave with itself for the same pane id.

---

## File Structure

**Modify:**

- `src-tauri/src/shell_integration.rs` — add root rejection to `retain_valid_cwd`; it stays the single place that decides whether a shell-reported CWD is acceptable.
- `src-tauri/src/pty.rs` — `consume_shell_integration` splits its one lock window into parse (locked) → validate (unlocked) → apply (locked).
- `src-tauri/src/platform/windows/shell.rs` — `PROMPT_INTEGRATION` escape spelling, and the test that must stop passing while the bug is live.
- `src-tauri/src/platform/windows/mod.rs` — `create_session` stops doing WMI work.
- `src/terminal/pane.ts` — `Pane` gains `copySelection()` / `paste()`; the pane-local clipboard key handler is removed.
- `src/terminal/terminal-manager.ts` — active-pane delegates, following the existing `clearActive()` pattern.
- `src/terminal/tab-manager.ts` — `commands` gains the two missing dispatch targets.
- `src-tauri/src/lib.rs` — one `setup` call for the Windows webview settings.
- `src-tauri/Cargo.toml` — `webview2-com` becomes a direct Windows-only dependency.

**Create:**

- `src-tauri/src/platform/windows/process_identity.rs` — targeted root-process creation time via `GetProcessTimes`, replacing the full-machine WMI enumeration on the spawn path.
- `src-tauri/src/platform/windows/webview.rs` — the `ICoreWebView2Settings3` call, isolated so `lib.rs` keeps one `#[cfg]`-gated line.
- `src/terminal/dispatch-coverage.test.ts` — the guard that every keymap action has a dispatch target.

**Delete:** nothing. `src/terminal/terminal-clipboard.ts` is kept and reused — Task 4 changes who calls it, not what it does.

---

## Task 1: Reject network and verbatim roots before any filesystem probe (A3, part 1)

Lands before A1 deliberately: it is unreachable at runtime today, so it cannot regress anything, and it must be in place before the ESC byte starts arriving.

**Files:**

- Modify: `src-tauri/src/shell_integration.rs:85-93` (`retain_valid_cwd`)
- Test: `src-tauri/src/shell_integration.rs` (the existing `mod tests`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `retain_valid_cwd(current: Option<PathBuf>, candidate: &str) -> Option<PathBuf>` — signature unchanged. Task 2 relies on this exact signature.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `src-tauri/src/shell_integration.rs`:

**These must target `has_rejected_root` directly, not `retain_valid_cwd`.** Going through `retain_valid_cwd` would be vacuous on the macOS dev host: `PathBuf::from(r"\\host\share").is_absolute()` is `false` on POSIX, so the existing code already returns `current` for the right answer by the wrong reason, and the test would pass before the fix exists. Asserting the predicate itself is what actually fails first.

```rust
    #[test]
    fn rejects_network_and_verbatim_roots() {
        use super::has_rejected_root;

        // Asserted on the predicate, not through retain_valid_cwd: on this
        // dev host a UNC string is not `is_absolute()`, so the outer function
        // already returns `current` and would pass without the guard. The
        // guard is what must stop `is_dir()` from reaching the SMB redirector
        // — and from offering the interactive user's NTLM credentials to
        // whatever host terminal output happened to name.
        for candidate in [
            r"\\10.255.255.1\share",
            r"\\corp\projects\deck",
            r"\\?\C:\Users\dev",
            r"\\?\UNC\corp\projects",
        ] {
            assert!(
                has_rejected_root(candidate, &PathBuf::from(candidate)),
                "{candidate} must be rejected before any filesystem call"
            );
        }
    }

    #[test]
    fn accepts_ordinary_local_roots() {
        use super::has_rejected_root;

        // The guard must not swallow legitimate candidates — a drive-letter
        // path on Windows, and this host's own temp dir everywhere.
        let temp = std::env::temp_dir();
        assert!(!has_rejected_root(
            &temp.to_string_lossy(),
            &temp
        ));
        assert!(!has_rejected_root(r"C:\Users\dev", &PathBuf::from(r"C:\Users\dev")));
    }

    #[test]
    fn retains_current_cwd_for_a_rejected_root() {
        // The end-to-end shape, kept alongside the predicate tests so the
        // wiring is pinned even though this one cannot fail on POSIX.
        let current = Some(std::env::temp_dir());

        assert_eq!(
            retain_valid_cwd(current.clone(), r"\\10.255.255.1\share"),
            current
        );
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml shell_integration`
Expected: FAIL to compile — `cannot find function \`has_rejected_root\` in module \`super\``. That compile failure is the proof the first two tests are not vacuous. `retains_current_cwd_for_a_rejected_root` will pass once the module compiles, on this host, for the reason stated in its comment — that is expected and is why it is not the primary assertion.

- [ ] **Step 3: Implement the root rejection**

Replace `retain_valid_cwd` in `src-tauri/src/shell_integration.rs`:

```rust
/// A candidate root that must never reach the filesystem.
///
/// On Windows `\\host\share` is `is_absolute()`, and `is_dir()` on it is a real
/// `CreateFileW` into the MUP/SMB redirector: ~21 s per unreachable host, and
/// Windows offers the interactive user's NTLMv2 credentials to whatever host the
/// candidate names. The candidate comes verbatim off the PTY (`parse_payload`
/// accepts any `9;9;<anything>` with no nonce and no origin check), so terminal
/// output alone must not be able to choose a network destination. Verbatim
/// prefixes are rejected on the same pass — the spec already requires they never
/// flow onward into UI or editor argv.
fn has_rejected_root(candidate: &str, path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};

        let _ = candidate;
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            return matches!(
                prefix.kind(),
                Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::Verbatim(..)
            );
        }
        false
    }
    #[cfg(not(windows))]
    {
        // Windows path parsing is what classifies a prefix, and it is absent
        // here — so keep the guarantee testable on the macOS dev host with the
        // textual form instead. No legitimate POSIX working directory starts
        // with a backslash pair.
        let _ = path;
        candidate.starts_with(r"\\")
    }
}

pub fn retain_valid_cwd(current: Option<PathBuf>, candidate: &str) -> Option<PathBuf> {
    let candidate = candidate.trim();
    let path = PathBuf::from(candidate);
    if has_rejected_root(candidate, &path) {
        return current;
    }
    if path.is_absolute() && path.is_dir() {
        Some(path)
    } else {
        current
    }
}
```

Add `Path` to the existing import at the top of the file:

```rust
use std::path::{Path, PathBuf};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml shell_integration`
Expected: PASS — all `shell_integration::tests` including the four pre-existing CWD tests (`rejects_relative_cwd`, `rejects_missing_cwd`, `retains_last_valid_cwd`, `parses_split_windows_cwd`).

- [ ] **Step 5: Run the full Rust suite and format check**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: `test result: ok. 115 passed` (113 today plus the two new), and no formatting output.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/shell_integration.rs
git commit -m "fix(shell-integration): reject network and verbatim CWD roots before probing

A shell-reported CWD arrives verbatim off the PTY with no nonce and no origin
check, and \`is_dir()\` on a UNC candidate is a real CreateFileW into the SMB
redirector — seconds of blocking per unreachable host, plus an NTLMv2 handshake
offered to whatever host the terminal named. Reject UNC, verbatim-UNC and
verbatim roots before any filesystem call.

Unreachable at runtime until the PowerShell escape fix lands, which is why it
goes first: the guard must precede the byte that activates it."
```

---

## Task 2: Validate the shell-reported CWD outside the session lock (A3, part 2)

**Files:**

- Modify: `src-tauri/src/pty.rs:146-182` (`consume_shell_integration`)

**Interfaces:**

- Consumes: `retain_valid_cwd(Option<PathBuf>, &str) -> Option<PathBuf>` from Task 1.
- Produces: `consume_shell_integration(app: &AppHandle, id: u32, data: &str)` — signature unchanged; both call sites (`pty.rs:319`, `pty.rs:334`) stay as they are.

**Semantics that must not change:** last valid candidate in the batch wins; a batch whose candidates are all invalid leaves `session.cwd` at its previous value; `PromptReady` events still emit in order, after the CWD update.

- [ ] **Step 1: Write the failing test**

`consume_shell_integration` needs Tauri managed state, so the lock-ordering property is asserted on an extracted pure helper instead. Add to `mod tests` in `src-tauri/src/pty.rs`:

```rust
    #[test]
    fn folds_only_directory_candidates_and_keeps_the_last_valid_one() {
        use super::validate_cwd_candidates;

        let valid = std::env::temp_dir();
        let valid_text = valid.to_string_lossy().into_owned();

        // All invalid -> None, so the caller leaves session.cwd untouched.
        assert_eq!(
            validate_cwd_candidates(&["relative/one".into(), r"\\corp\share".into()]),
            None
        );
        // Last valid wins, matching the previous in-lock fold.
        assert_eq!(
            validate_cwd_candidates(&["relative/one".into(), valid_text.clone()]),
            Some(valid.clone())
        );
        // A trailing invalid candidate does not erase an earlier valid one.
        assert_eq!(
            validate_cwd_candidates(&[valid_text, "relative/two".into()]),
            Some(valid)
        );
    }
```

Also add the import line to the existing `use super::{...}` in that module: `validate_cwd_candidates`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pty::tests::folds_only_directory_candidates`
Expected: FAIL to compile — `cannot find function \`validate_cwd_candidates\` in module \`super\``.

- [ ] **Step 3: Implement the split**

Replace `consume_shell_integration` in `src-tauri/src/pty.rs` and add the helper above it:

```rust
/// Last candidate that names an existing directory, or `None` when the batch
/// held nothing acceptable — in which case the caller leaves the session's
/// current value alone. Hits the filesystem, so it must run unlocked.
fn validate_cwd_candidates(candidates: &[String]) -> Option<PathBuf> {
    candidates
        .iter()
        .fold(None, |current, candidate| {
            retain_valid_cwd(current, candidate)
        })
}

fn consume_shell_integration(app: &AppHandle, id: u32, data: &str) {
    // One emitter thread per session owns every call for a given id (both call
    // sites are inside the single `thread::spawn` in `spawn_shell`), so the
    // parse → validate → apply sequence below cannot interleave with itself and
    // the two lock windows are safe to split.
    let (events, candidates) = {
        let state = app.state::<PtyState>();
        let Ok(mut sessions) = state.sessions.lock() else {
            return;
        };
        let Some(session) = sessions.get_mut(&id) else {
            return;
        };
        let parser = std::mem::take(&mut session.shell_integration);
        let (next_parser, events) = parser.parse(data);
        session.shell_integration = next_parser;
        let candidates = events
            .iter()
            .filter_map(|event| match event {
                ShellIntegrationEvent::CurrentDirectory(candidate) => Some(candidate.clone()),
                ShellIntegrationEvent::PromptReady => None,
            })
            .collect::<Vec<_>>();
        (events, candidates)
    };

    // Deliberately outside the lock: validation is a filesystem call on a path
    // the terminal chose, and a batch can carry hundreds of candidates (up to
    // BATCH_MAX_BYTES of output). `write_pty`, `resize_pty` and `kill_pty` are
    // sync commands taking this same lock on the UI thread, so a slow probe
    // held under it freezes the window.
    if let Some(cwd) = validate_cwd_candidates(&candidates) {
        let state = app.state::<PtyState>();
        if let Ok(mut sessions) = state.sessions.lock() {
            if let Some(session) = sessions.get_mut(&id) {
                session.cwd = Some(cwd);
            }
        }
    }

    let coordinator = app.state::<WindowCoordinator>();
    for event in events {
        if event == ShellIntegrationEvent::PromptReady {
            emit_to_owner(
                app,
                &coordinator,
                id,
                EVENT_PROMPT_READY,
                PromptReadyPayload { id },
            );
        }
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml pty::tests::folds_only_directory_candidates`
Expected: PASS.

- [ ] **Step 5: Run the full Rust suite, format check, and confirm no lock spans a probe**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: `test result: ok. 116 passed`.

Then read `consume_shell_integration` once more and confirm by eye: `retain_valid_cwd` (via `validate_cwd_candidates`) appears between the two `sessions.lock()` blocks and inside neither, and no `Session` value is dropped inside a lock window.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "fix(pty): validate shell-reported CWDs outside the session lock

The fold that turned CurrentDirectory events into session.cwd ran inside the
PtyState.sessions lock, and retain_valid_cwd does a real filesystem probe on a
path terminal output chose. A mapped network drive or a UNC candidate could hold
the global lock for seconds while write_pty, resize_pty and kill_pty — sync
commands on the UI thread — queued behind it.

Split into parse (locked) -> validate (unlocked) -> apply (locked). Safe because
one emitter thread per session owns every call for a given id. Last-valid-wins
and leave-cwd-alone-on-invalid semantics are unchanged, pinned by a new test on
the extracted validate_cwd_candidates helper."
```

---

## Task 3: Spell the prompt-integration ESC in a way Windows PowerShell 5.1 understands (A1)

**Files:**

- Modify: `src-tauri/src/platform/windows/shell.rs:14-28` (`PROMPT_INTEGRATION`)
- Test: `src-tauri/src/platform/windows/shell.rs:213-232` (`builds_profile_loading_prompt_integration`)

**Interfaces:**

- Consumes: Tasks 1 and 2 must be committed first — this task is what makes their code paths reachable.
- Produces: no signature change. `PROMPT_INTEGRATION` stays a `&str` embedded in the `-Command` argv built by `build_shell_launch`.

- [ ] **Step 1: Rewrite the test so it fails while the bug is live**

The current assertion is `script.contains("OSC 133;A") || script.contains("]133;A")`, which the broken literal `` `e]133;A `` also satisfies — it substring-matches the Rust source, not the byte PowerShell will emit. Replace the three OSC assertions in `builds_profile_loading_prompt_integration` with:

```rust
        // `e is PowerShell 6.0+. Windows PowerShell 5.1 drops the backtick and
        // keeps a literal "e", so every prompt line would render the escape as
        // text and no OSC sequence would ever reach the parser. $([char]27) is
        // valid in both hosts — exactly as $([char]7) already is on these lines.
        assert!(!script.contains("`e"), "PowerShell 5.1 cannot parse `e");
        assert!(script.contains("$([char]27)]133;A"));
        assert!(script.contains("$([char]27)]133;B"));
        assert!(script.contains("$([char]27)]9;9;"));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml builds_profile_loading_prompt_integration`
Expected: FAIL with `PowerShell 5.1 cannot parse \`e`.

- [ ] **Step 3: Flip the three escapes**

In `src-tauri/src/platform/windows/shell.rs`, `PROMPT_INTEGRATION` becomes:

```rust
const PROMPT_INTEGRATION: &str = r#"$Global:__DeckOriginalPrompt = $function:Prompt;
function Global:prompt {
  $loc = $executionContext.SessionState.Path.CurrentLocation;
  $out = "$([char]27)]133;A$([char]7)";
  if ($loc.Provider.Name -eq "FileSystem") {
    $out += "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]7)";
  }
  if ($null -ne $Global:__DeckOriginalPrompt) {
    $out += $Global:__DeckOriginalPrompt.Invoke();
  } else {
    $out += "PS $loc$('>' * ($nestedPromptLevel + 1)) ";
  }
  $out += "$([char]27)]133;B$([char]7)";
  return $out;
}"#;
```

Note the backticks on the `9;9;` line are **kept** — those are PowerShell's escape for a literal `"` inside a double-quoted string, valid in 5.1, and unrelated to `` `e ``.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml builds_profile_loading_prompt_integration`
Expected: PASS.

- [ ] **Step 5: Run the full Rust suite and format check**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: `test result: ok. 116 passed`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/platform/windows/shell.rs
git commit -m "fix(windows-shell): emit ESC as \$([char]27) so PowerShell 5.1 parses the prompt

\`e was added in PowerShell 6.0. Windows PowerShell 5.1 — the only shell on a
stock Windows 11 box, and a spec-mandated fallback — drops the backtick and
keeps a literal 'e', so every prompt rendered as
e]133;Ae]9;9;\"C:\\Users\\dev\"PS C:\\Users\\dev> e]133;B, OSC_PREFIX never
matched, prompt-ready never fired, agent auto-launch always hit its 15 s
timeout, and session.cwd stayed None forever.

The test asserted script.contains(\"]133;A\") against the Rust literal, which the
broken form also satisfied; it now asserts the emitted escape and rejects \`e."
```

- [ ] **Step 7: Record what this activates**

This is the commit after which QA items 2, 3, 5 and 11 become meaningful. Note in the PR description that A3's guards (Tasks 1–2) are in place and that C2's console flash is now expected to be observable.

---

## Task 4: Make copy and paste reachable, and route paste through xterm (A4 + A5)

**One commit.** Deleting the dead-chord problem without routing paste through `Terminal.paste()` converts a dead feature into a pastejacking and CRLF-as-Enter hazard.

**Design decision:** keep the chords in `WINDOWS_KEYMAP` (`action-registry.ts` is the SSOT for shortcuts) and give the two actions real entries in the `commands` table, delegating through `terminal-manager` to the pane — the same shape `clear-buffer` → `clearActive()` → `Pane.clear()` already uses. The pane-local `attachCustomKeyEventHandler` clipboard handler is removed: `handleShortcut` is a capture-phase window listener that calls `stopPropagation()`, so a handler on the xterm textarea is unreachable by construction. `terminal-clipboard.ts` is kept and called from the pane instead.

**Files:**

- Modify: `src/terminal/pane.ts:39-70` (the `Pane` interface), `src/terminal/pane.ts:194-198` (remove the key handler), and the pane factory body
- Modify: `src/terminal/terminal-manager.ts:103` (interface) and `:568` (implementation area)
- Modify: `src/terminal/tab-manager.ts:860-936` (the `commands` table)
- Test: `src/terminal/terminal-clipboard.test.ts`, `src/terminal/tab-manager.test.ts`

**Interfaces:**

- Consumes: `createTerminalClipboardHandler` is no longer used; the two exported helpers it wraps are. Refactor `terminal-clipboard.ts` to export `copyTerminalSelection(terminal, dependencies?)` and `pasteIntoTerminal(terminal, dependencies?)` directly, and delete `createTerminalClipboardHandler`.
- Produces:
  - `Pane.copySelection(): void`
  - `Pane.paste(): void`
  - `TerminalManager.copyActiveSelection(): void`
  - `TerminalManager.pasteIntoActive(): void`

- [ ] **Step 1: Write the failing tests**

In `src/terminal/terminal-clipboard.test.ts`, replace the handler-shaped harness with one over the two exported functions, and pin the xterm routing:

```ts
interface PasteHarness {
  readonly terminal: {
    getSelection(): string;
    hasSelection(): boolean;
    paste: ReturnType<typeof vi.fn<(text: string) => void>>;
  };
  readonly readText: ReturnType<typeof vi.fn<() => Promise<string>>>;
  readonly writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  readonly reportError: ReturnType<typeof vi.fn<(message: string) => void>>;
}

function createPasteHarness(selection = ""): PasteHarness {
  return {
    terminal: {
      getSelection: () => selection,
      hasSelection: () => selection !== "",
      paste: vi.fn(),
    },
    readText: vi.fn(async () => "line one\r\nline two"),
    writeText: vi.fn(async () => {}),
    reportError: vi.fn(),
  };
}

it("routes paste through Terminal.paste so xterm brackets it and normalizes CRLF", async () => {
  const h = createPasteHarness();

  pasteIntoTerminal(h.terminal, {
    readText: h.readText,
    writeText: h.writeText,
    reportError: h.reportError,
  });
  await vi.waitFor(() => expect(h.terminal.paste).toHaveBeenCalledTimes(1));

  // Terminal.paste applies prepareTextForTerminal (\r?\n -> \r) and
  // bracketTextForPaste (DECSET 2004). Writing to the PTY directly would skip
  // both: Windows clipboard text is CRLF, and CR into a ConPTY is Enter for
  // PSReadLine, so a multi-line paste would submit N times.
  expect(h.terminal.paste).toHaveBeenCalledWith("line one\r\nline two");
});

it("copies a non-empty selection and reports a clipboard failure", async () => {
  const h = createPasteHarness("selected");
  h.writeText.mockRejectedValueOnce(new Error("denied"));

  copyTerminalSelection(h.terminal, {
    readText: h.readText,
    writeText: h.writeText,
    reportError: h.reportError,
  });

  await vi.waitFor(() =>
    expect(h.reportError).toHaveBeenCalledWith(
      "Couldn't copy the terminal selection",
    ),
  );
});
```

In `src/terminal/tab-manager.test.ts`, the chords must be proven to reach the pane through the real capture-phase path. The existing `fakePane` (`:109-146`) has no clipboard methods and `wire`/`setup` (`:161-210`) cannot inject pane spies, so thread them first.

Widen `fakePane`'s override parameter (`:115`):

```ts
  overrides: {
    search?: Pane["search"];
    copySelection?: Pane["copySelection"];
    paste?: Pane["paste"];
  } = {},
```

and add to its returned object, next to `clear() {}`:

```ts
    copySelection: overrides.copySelection ?? (() => {}),
    paste: overrides.paste ?? (() => {}),
```

Thread the overrides through `wire` — add a third parameter and pass it to `fakePane`:

```ts
function wire(
  pty: PtyClient,
  extraDeps: Partial<TabManagerDeps> = {},
  paneOverrides: Parameters<typeof fakePane>[2] = {},
): {
```

```ts
const createPane: CreatePaneFn = (id, _settings, events) => {
  eventsById.set(id, events);
  const pane = fakePane(id, events, paneOverrides);
  panesById.set(id, pane);
  return pane;
};
```

and through `setup` — add to its options object and forward:

```ts
  /** Pane-level spies, e.g. the clipboard methods the Ctrl+Shift chords hit. */
  paneOverrides?: Parameters<typeof fakePane>[2];
```

```ts
const { tm, emitSignal, focusPaneDirectly } = wire(
  pty,
  options.deps,
  options.paneOverrides,
);
```

Then add the test:

```ts
it("dispatches the Windows clipboard chords to the active pane (prior H1, audit A4)", async () => {
  // Both chords resolved in WINDOWS_KEYMAP but had no entry in the commands
  // table, so dispatchAction's `commands[action]?.()` was a silent no-op —
  // and the pane-local handler on the xterm textarea could never be reached,
  // because handleShortcut is a capture-phase window listener that
  // stopPropagation()s first. Driving `window` is that real path.
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({
    platform: "windows",
    homeDir: String.raw`C:\Users\dev`,
  });
  const copySelection = vi.fn();
  const paste = vi.fn();
  const { tm } = setup({ paneOverrides: { copySelection, paste } });
  await tm.materialize({ layout: null, cwds: [String.raw`C:\work`] });

  // Upper-case `key` on purpose: Shift is held, and matchBinding lowercases.
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "C", ctrlKey: true, shiftKey: true }),
  );
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true }),
  );

  expect(copySelection).toHaveBeenCalledTimes(1);
  expect(paste).toHaveBeenCalledTimes(1);
  tm.dispose();
});
```

Place it inside the existing Windows-platform `describe` block so the `beforeEach` at `:261-266` (which initializes the environment to `macos`) is overridden by the explicit reset above, matching the idiom already used at `:392-400`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/terminal/terminal-clipboard.test.ts src/terminal/tab-manager.test.ts`
Expected: FAIL — `pasteIntoTerminal is not defined` / `copyTerminalSelection is not defined`, and the tab-manager test reports `copyActiveSelection` called 0 times.

- [ ] **Step 3: Export the two clipboard operations**

In `src/terminal/terminal-clipboard.ts`, keep `ClipboardDependencies`, `DEFAULT_DEPENDENCIES` and the two private bodies, widen the terminal shape to include `paste`, export the operations, and delete `createTerminalClipboardHandler`:

```ts
interface TerminalClipboardTarget {
  getSelection(): string;
  hasSelection(): boolean;
  /**
   * xterm's own paste entry point — applies prepareTextForTerminal (\r?\n ->
   * \r) and bracketTextForPaste (DECSET 2004). Writing clipboard bytes to the
   * PTY directly skips both.
   */
  paste(text: string): void;
}

export function copyTerminalSelection(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  if (!terminal.hasSelection()) {
    return;
  }
  const selection = terminal.getSelection();
  if (selection === "") {
    return;
  }
  void Promise.resolve()
    .then(() => dependencies.writeText(selection))
    .catch(() => {
      dependencies.reportError("Couldn't copy the terminal selection");
    });
}

export function pasteIntoTerminal(
  terminal: TerminalClipboardTarget,
  dependencies: ClipboardDependencies = DEFAULT_DEPENDENCIES,
): void {
  void Promise.resolve()
    .then(() => dependencies.readText())
    .then((text) => terminal.paste(text))
    .catch(() => {
      dependencies.reportError("Couldn't paste from the clipboard");
    });
}
```

- [ ] **Step 4: Expose the operations on the pane and the manager**

In `src/terminal/pane.ts`, add to the `Pane` interface next to `clear()`:

```ts
  /** Copy the current selection to the system clipboard (Ctrl+Shift+C). */
  copySelection(): void;
  /** Paste the clipboard through xterm's bracketed-paste path (Ctrl+Shift+V). */
  paste(): void;
```

Implement them in the pane factory's returned object:

```ts
    copySelection() {
      copyTerminalSelection(term);
    },
    paste() {
      pasteIntoTerminal(term);
    },
```

Remove the now-dead handler block:

```ts
if (getDesktopEnvironment().platform === "windows") {
  term.attachCustomKeyEventHandler(
    createTerminalClipboardHandler(term, (data) => events.onData(id, data)),
  );
}
```

and update the import to `import { copyTerminalSelection, pasteIntoTerminal } from "./terminal-clipboard";`. Drop the `getDesktopEnvironment` import from `pane.ts` if nothing else in the file uses it — check with `grep -n getDesktopEnvironment src/terminal/pane.ts` before removing.

In `src/terminal/terminal-manager.ts`, add to the interface beside `clearActive(): void;`:

```ts
  copyActiveSelection(): void;
  pasteIntoActive(): void;
```

and implement beside `clearActive()`, following its exact shape for resolving the active pane.

- [ ] **Step 5: Wire the dispatch targets**

In `src/terminal/tab-manager.ts`, add to `commands` next to `"clear-buffer"`:

```ts
    "copy-selection": () => activeManager()?.copyActiveSelection(),
    paste: () => activeManager()?.pasteIntoActive(),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/terminal/terminal-clipboard.test.ts src/terminal/tab-manager.test.ts && npx tsc --noEmit`
Expected: PASS, and `tsc` produces no output.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all files pass. `action-registry.test.ts:56-57` and `keymap.test.ts:342-343` — which previously certified the bug by asserting only that the ids and chords existed — should still pass; they are now backed by real dispatch rather than describing a no-op.

- [ ] **Step 8: Commit**

```bash
git add src/terminal/terminal-clipboard.ts src/terminal/terminal-clipboard.test.ts \
        src/terminal/pane.ts src/terminal/terminal-manager.ts \
        src/terminal/tab-manager.ts src/terminal/tab-manager.test.ts
git commit -m "fix(clipboard): give the Windows copy/paste chords real dispatch targets

WINDOWS_KEYMAP claimed Ctrl+Shift+C and Ctrl+Shift+V, but neither id had an
entry in the commands table, so dispatchAction's commands[action]?.() was a
silent no-op — and the handler added on the xterm textarea could never fire,
because handleShortcut is a capture-phase window listener that
stopPropagation()s first. Runtime behaviour was byte-identical to the state
prior review H1 flagged.

Route both through the existing action -> commands -> manager -> pane path that
clear-buffer already uses, and paste via Terminal.paste() so xterm applies
CRLF normalization and bracketed paste. Doing only the first half would turn a
dead feature into a pastejacking and one-keystroke-execution hazard: Windows
clipboard text is CRLF and CR into a ConPTY is Enter for PSReadLine."
```

---

## Task 5: Fail the build when a keymap action has no dispatch target

The class-level guard. Prior H1 came back as audit A4 because nothing tested that a bound action actually does something; a passing suite certified the bug twice.

**Files:**

- Create: `src/terminal/dispatch-coverage.test.ts`
- Modify: `src/terminal/tab-manager.ts` — export the dispatchable id set

**Interfaces:**

- Consumes: `Pane.copySelection`/`paste` and the `commands` entries from Task 4.
- Produces: `DISPATCHABLE_ACTIONS: ReadonlySet<ShortcutAction>` exported from `tab-manager.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/terminal/dispatch-coverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MACOS_KEYMAP, WINDOWS_KEYMAP } from "./keymap";
import { DISPATCHABLE_ACTIONS } from "./tab-manager";

/**
 * Prior review H1 and pre-ship audit A4 were the same defect twice: a chord
 * resolved in the keymap to an action with no dispatch target, and
 * `commands[action]?.()` swallowed it silently. Both times the suite passed
 * because it only asserted that the binding and the action id existed.
 */
describe("keymap dispatch coverage", () => {
  it.each([
    ["MACOS_KEYMAP", MACOS_KEYMAP],
    ["WINDOWS_KEYMAP", WINDOWS_KEYMAP],
  ] as const)("every %s action has a dispatch target", (_name, keymap) => {
    const orphans = keymap
      .map((binding) => binding.action)
      .filter((action) => !DISPATCHABLE_ACTIONS.has(action));

    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/terminal/dispatch-coverage.test.ts`
Expected: FAIL to resolve — `DISPATCHABLE_ACTIONS` is not exported from `./tab-manager`.

- [ ] **Step 3: Export the dispatchable id set**

`commands` is built inside the manager closure, so the id set is declared at module scope in `src/terminal/tab-manager.ts` and the table is checked against it:

```ts
/**
 * Every action `dispatchAction` can actually run: the `commands` table's keys,
 * plus the ids it handles inline before consulting the table.
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
/**
 * The ids `commands` implements. This is the full current table (37 entries,
 * verified against `tab-manager.ts:860-936`) plus the two Task 4 added.
 */
const COMMAND_ACTIONS = [
  "clear-buffer",
  "close-pane",
  "close-tab",
  "copy-cwd",
  "copy-selection",
  "find",
  "find-next",
  "find-previous",
  "focus-down",
  "focus-left",
  "focus-next",
  "focus-next-attention",
  "focus-prev",
  "focus-right",
  "focus-up",
  "new-preset",
  "new-tab",
  "next-tab",
  "open-tab-options",
  "paste",
  "prev-tab",
  "reopen-tab",
  "save-preset",
  "scroll-page-down",
  "scroll-page-up",
  "scroll-to-bottom",
  "scroll-to-top",
  "split-column",
  "split-row",
  "swap-down",
  "swap-left",
  "swap-right",
  "swap-up",
  "toggle-expand",
  "toggle-settings",
  "toggle-zoom-pane",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
] as const satisfies readonly ShortcutAction[];

/**
 * Every action `dispatchAction` can actually run: `COMMAND_ACTIONS` plus the
 * ids it resolves inline, before consulting the table — `select-last-tab` and
 * the `select-tab-N` family, both handled by the `selectTabIndex` branch.
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
export const DISPATCHABLE_ACTIONS: ReadonlySet<ShortcutAction> =
  new Set<ShortcutAction>([
    ...COMMAND_ACTIONS,
    "select-last-tab",
    // Derived, not hand-listed: the registry owns how many tabs are addressable,
    // and a hard-coded 1..8 would silently rot if that changed.
    ...ACTION_REGISTRY.map((action) => action.id).filter(
      (id): id is ShortcutAction => /^select-tab-\d+$/.test(id),
    ),
  ]);
```

`ACTION_REGISTRY` is already imported by `tab-manager.test.ts:8`; add the same import to `tab-manager.ts` if it is not there yet.

Then type the table against that tuple, so a missing entry is a compile error rather than a convention:

```ts
const commands = {
  // ...every existing entry, unchanged, plus Task 4's two...
} satisfies Record<(typeof COMMAND_ACTIONS)[number], () => void>;
```

`satisfies` (not a type annotation) is deliberate: it checks completeness without widening the inferred type, so `commands[action]?.()` still narrows correctly at the call site.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/terminal/dispatch-coverage.test.ts && npx tsc --noEmit`
Expected: PASS with `orphans` empty, and no `tsc` output.

- [ ] **Step 5: Verify the guard is not vacuous**

Temporarily delete the `"copy-selection"` entry from `commands` and its id from `COMMAND_ACTIONS`, then run the test again.
Expected: FAIL with `expected [ 'copy-selection' ] to deeply equal []`. Restore both, re-run, confirm PASS.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test && npx tsc --noEmit
git add src/terminal/dispatch-coverage.test.ts src/terminal/tab-manager.ts
git commit -m "test(keymap): fail when a bound action has no dispatch target

Prior review H1 and pre-ship audit A4 were one defect surfacing twice: a chord
resolved to an action with no entry in the commands table, and
commands[action]?.() swallowed it. Both times the suite passed, because it only
asserted the binding and the id existed.

Export the dispatchable id set and assert every MACOS_KEYMAP and
WINDOWS_KEYMAP binding lands in it. The commands table is now typed with
satisfies against the same tuple, so an omission is a compile error too."
```

---

## Task 6: Disable WebView2 browser accelerator keys (A6)

**The audit calls this a one-line fix; it is not.** Tauri 2.11.5 does not expose `with_browser_accelerator_keys`. wry declares it (`wry-0.55.1/src/lib.rs:1720`, `WebViewBuilderExtWindows`) but `tauri-runtime-wry` never passes it through, so wry's `browser_accelerator_keys: true` default stands and the disabling branch at `webview2/mod.rs:582-585` never runs. The only reachable route is `WebviewWindow::with_webview` (`tauri-2.11.5/src/webview/mod.rs:1668`) → `PlatformWebview::controller()` (typed `ICoreWebView2Controller`, `mod.rs:177-184`) → `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled` (`webview2-com-sys-0.38.2/src/bindings.rs:35685`).

**Files:**

- Create: `src-tauri/src/platform/windows/webview.rs`
- Modify: `src-tauri/src/platform/windows/mod.rs` (declare the module, re-export)
- Modify: `src-tauri/src/platform/mod.rs` (facade entry, no-op on non-Windows)
- Modify: `src-tauri/src/lib.rs:38-45` (call it in `setup`)
- Modify: `src-tauri/Cargo.toml:36-46` (add `webview2-com`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `platform::harden_webview(window: &tauri::WebviewWindow) -> Result<(), String>` — a no-op returning `Ok(())` on non-Windows.

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[target.'cfg(target_os = "windows")'.dependencies]`:

```toml
# Already in the lock transitively via tauri; declared directly so the
# ICoreWebView2Settings3 call has a supported path. Must stay on the same
# windows-core 0.61 bindings as the pin above — mixed 0.61/0.62 COM traits do
# not interoperate.
webview2-com = "0.38"
```

Run `cargo tree --manifest-path src-tauri/Cargo.toml -i windows-core --target x86_64-pc-windows-msvc` and confirm a single `windows-core v0.61.2` node. If two versions appear, stop and report — do not relax the pin.

- [ ] **Step 2: Write the module**

Create `src-tauri/src/platform/windows/webview.rs`:

```rust
//! WebView2 hardening applied after the window exists.
//!
//! Tauri 2.11.5 exposes no builder flag for this: wry declares
//! `with_browser_accelerator_keys` but `tauri-runtime-wry` does not forward it,
//! so wry's `true` default stands and Ctrl+R / F5 (Reload), Ctrl+F / F3 (Find)
//! and Ctrl+P (Print) stay live. A reload destroys every tab and pane — the app
//! has no session restore (removed deliberately, see tab-manager.ts) and no
//! `beforeunload` guard — while `PtyState` survives as Tauri managed state with
//! no listener draining it, so every pre-reload PTY leaks until process exit.

use tauri::WebviewWindow;

pub fn harden_webview(window: &WebviewWindow) -> Result<(), String> {
    window
        .with_webview(|webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
            use windows_core::Interface;

            let controller = webview.controller();
            // SAFETY: `controller` is a live ICoreWebView2Controller owned by wry
            // for the lifetime of this webview, and `with_webview` runs this
            // closure on the thread that created it — the affinity WebView2
            // requires. Every call is a vtable call on that interface; failures
            // are returned as HRESULTs, not unwinds.
            unsafe {
                let Ok(core) = controller.CoreWebView2() else {
                    return;
                };
                let Ok(settings) = core.Settings() else {
                    return;
                };
                let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
                    return;
                };
                let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        })
        .map_err(|error| error.to_string())
}
```

- [ ] **Step 3: Wire the facade and the setup call**

In `src-tauri/src/platform/windows/mod.rs`, add `pub(crate) mod webview;` to the module list and re-export:

```rust
pub fn harden_webview(window: &tauri::WebviewWindow) -> Result<(), String> {
    webview::harden_webview(window)
}
```

In `src-tauri/src/platform/mod.rs`, add the facade entry following the existing per-platform re-export pattern, with a non-Windows arm:

```rust
/// Post-creation webview hardening. Only Windows has anything to do here.
#[cfg(not(target_os = "windows"))]
pub fn harden_webview(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
```

In `src-tauri/src/lib.rs`, inside `.setup(|app| { ... })` after `menu::install(app)?;`:

```rust
            // Browser accelerator keys are on by wry's default and Tauri has no
            // builder flag for them: one F5 in the chrome discards every tab and
            // orphans every PTY. Applied per window, so a future second window
            // needs the same call.
            for window in app.webview_windows().values() {
                platform::harden_webview(window)?;
            }
```

Add `mod platform;` usage — it is already declared at `lib.rs:9`, so only the call is new. `app.webview_windows()` returns a map; `menu::install` already takes `app`, so no new imports beyond what `Manager` provides (already imported at `lib.rs:14`).

- [ ] **Step 4: Verify it compiles on both targets**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS — this exercises the non-Windows arm.

Then, for the Windows arm:

```bash
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

Expected: clean check. `cargo check` does not link, so the MSVC toolchain is not required. **If the target cannot be added or the check cannot run on this host, do not claim the task verified** — record it as CI-pending and let `windows-check` be the gate.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/src/platform/windows/webview.rs \
        src-tauri/src/platform/windows/mod.rs \
        src-tauri/src/platform/mod.rs src-tauri/src/lib.rs
git commit -m "fix(windows-webview): disable WebView2 browser accelerator keys

wry defaults browser_accelerator_keys to true and tauri-runtime-wry does not
forward the builder flag, so Ctrl+R / F5, Ctrl+F / F3 and Ctrl+P stayed live.
The app has no session restore and no beforeunload guard, and PtyState survives
a webview reload as managed state with no listener draining it — so one
chrome-focused F5 discarded every tab, every pane and all scrollback, and leaked
every PTY until process exit.

No builder flag exists in Tauri 2.11.5, so this goes through with_webview ->
ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled. webview2-com is
promoted to a direct Windows dependency on the same windows-core 0.61 bindings
as the existing pin."
```

- [ ] **Step 6: Note what remains**

Ctrl+P and Ctrl+F are covered by the same setting. Right-click behaviour (audit D-section) is a **separate** setting (`AreDefaultContextMenusEnabled`) and is deliberately **not** changed here — QA item 6 must first establish whether xterm's `rightClickHandler` already yields a working Paste menu.

---

## Task 7: Take the WMI enumeration off the pane spawn path (A8)

**Design decision:** replace the WMI lookup with `GetProcessTimes`, rather than wrapping the existing WMI call in `spawn_blocking`. `spawn_shell` is a synchronous `#[tauri::command]`; making it `async` to reach `spawn_blocking` would change the command signature and every call site, whereas the value needed is one 64-bit creation time for one PID that the OS will hand over from a process handle. `windows-sys` already carries `Win32_System_Threading` and `Win32_Foundation`, so no new dependency is required.

**Files:**

- Create: `src-tauri/src/platform/windows/process_identity.rs`
- Modify: `src-tauri/src/platform/windows/mod.rs:26-42` (`create_session`), module list
- Keep: `process_snapshot::process_creation_date` — still used by the polling path, which already runs under `spawn_blocking` (`info.rs:185`)

**Interfaces:**

- Consumes: `SessionIdentity::with_creation_date(Option<u32>, Option<i64>)` (`platform/mod.rs:73`), unchanged.
- Produces: `process_identity::creation_time_micros(process_id: u32) -> Result<i64, String>` — microseconds, on the same scale as `process_snapshot`'s `timestamp_micros()` so the two producers stay comparable.

- [ ] **Step 1: Write the failing test**

Create the module with its test first. Add to `src-tauri/src/platform/windows/process_identity.rs`:

```rust
#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn reads_the_current_process_creation_time() {
        let own = std::process::id();

        let creation = super::creation_time_micros(own).expect("own process must have a start time");

        // FILETIME epoch is 1601; anything after the Unix epoch confirms the
        // conversion, and a positive value confirms the handle was opened.
        assert!(creation > 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_a_process_id_that_cannot_be_opened() {
        // PID 0 is the System Idle Process — OpenProcess always denies it, which
        // is the error path that must stay an Err rather than a silent zero.
        assert!(super::creation_time_micros(0).is_err());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
Expected: FAIL — `cannot find function \`creation_time_micros\``. These are `#[cfg(target_os = "windows")]`tests, so they cannot execute on the macOS host;`windows-check` in CI is what runs them. Record that explicitly rather than treating a macOS pass as evidence.

- [ ] **Step 3: Implement the targeted lookup**

```rust
//! Root-process creation identity for a pane, read from the process handle.
//!
//! `create_session` runs inline on the WebView2 UI thread (tao makes it an STA),
//! so the previous `Win32_Process` WMI query — a fresh COM connection plus a
//! full-machine enumeration with `ExecutablePath` and `CommandLine`, walked one
//! object per LRPC round trip with no timeout — blocked every pane spawn and
//! could hang it indefinitely against a wedged WmiPrvSE. `GetProcessTimes` needs
//! one handle and returns in microseconds.

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
};

/// Microseconds since the Unix epoch, matching `process_snapshot`'s scale so a
/// pane's identity is comparable regardless of which producer supplied it.
#[cfg(target_os = "windows")]
pub(crate) fn creation_time_micros(process_id: u32) -> Result<i64, String> {
    // SAFETY: PROCESS_QUERY_LIMITED_INFORMATION is the least privilege that
    // satisfies GetProcessTimes and succeeds across integrity levels for a child
    // we just created. A null return is the documented failure signal.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return Err(format!("Cannot open process {process_id} for identity"));
    }

    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: `handle` is non-null and owned here; all four out-params are live
    // stack slots for the duration of the call.
    let ok = unsafe {
        GetProcessTimes(
            handle,
            &mut creation,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    };
    // SAFETY: `handle` came from OpenProcess above and is closed exactly once.
    let closed = unsafe { CloseHandle(handle) };
    debug_assert!(closed != 0, "CloseHandle failed on a handle we opened");

    if ok == 0 {
        return Err(format!("Cannot read start time for process {process_id}"));
    }
    Ok(filetime_to_unix_micros(&creation))
}

/// FILETIME counts 100-nanosecond ticks from 1601-01-01; the Unix epoch is
/// 11644473600 seconds later.
#[cfg(target_os = "windows")]
fn filetime_to_unix_micros(value: &FILETIME) -> i64 {
    const TICKS_PER_MICROSECOND: i64 = 10;
    const EPOCH_DIFFERENCE_MICROSECONDS: i64 = 11_644_473_600 * 1_000_000;

    let ticks = ((value.dwHighDateTime as u64) << 32 | value.dwLowDateTime as u64) as i64;
    ticks / TICKS_PER_MICROSECOND - EPOCH_DIFFERENCE_MICROSECONDS
}
```

Confirm `PROCESS_QUERY_LIMITED_INFORMATION`, `GetProcessTimes`, `OpenProcess`, `CloseHandle` and `FILETIME` all resolve under the features already enabled in `Cargo.toml` (`Win32_Foundation`, `Win32_System_Threading`). If `FILETIME` is not re-exported from `Foundation` in `windows-sys` 0.61, take it from wherever `cargo doc` places it rather than adding a feature.

- [ ] **Step 4: Use it on the spawn path and stop discarding the error**

In `src-tauri/src/platform/windows/mod.rs`, add `pub(crate) mod process_identity;` and replace the creation-date line in `create_session`:

```rust
    #[cfg(target_os = "windows")]
    let creation_date = match process_identity::creation_time_micros(root_pid) {
        Ok(creation_date) => Some(creation_date),
        Err(error) => {
            // SessionIdentity is Copy and written once, never backfilled, so a
            // silent miss pins this pane to `unknown` for its whole life — no
            // Attention Rail gate, generic close dialog. Do not swallow it.
            eprintln!("Deck: pane identity unavailable for pid {root_pid}: {error}");
            None
        }
    };
```

The `.ok()` that discarded the error is removed. `process_snapshot::process_creation_date` stays for the polling path.

- [ ] **Step 5: Verify**

Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml && cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
Expected: PASS on the non-Windows arm.

Run: `cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc`
Expected: clean.

The two new tests execute only on `windows-check`. State this in the PR rather than implying local coverage. QA item 9 measures the improvement (cold 4-pane preset, click to fourth pane).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/platform/windows/process_identity.rs \
        src-tauri/src/platform/windows/mod.rs
git commit -m "perf(windows): read pane identity from the process handle, not WMI

create_session called process_creation_date, which opens a fresh WMI connection
and enumerates every process on the machine with ExecutablePath and CommandLine
— forcing an OpenProcess per target — then filters one PID in Rust. Its only
caller is spawn_shell, a sync command, so it ran inline on the WebView2 STA UI
thread with no timeout: multi-pane presets serialized behind it and a wedged
WmiPrvSE could hang a spawn indefinitely. pty_info already wraps the identical
work in spawn_blocking; the spawn path never did.

GetProcessTimes on a PROCESS_QUERY_LIMITED_INFORMATION handle answers the one
question asked. The error is also logged instead of .ok()'d away — SessionIdentity
is Copy and never backfilled, so a silent miss pinned a pane to unknown for its
entire life with no diagnostics anywhere."
```

---

## Out of scope — still open after this plan

These stay open by design; the plan closes code blockers only.

| Item                                                                                                                                                       | Why not here                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** — no installer can be produced (`windows-engineering-bundle` is `workflow_dispatch`-only and throws unless the repo is private; the repo is public) | Delivery-channel decision, not code. Needs a private mirror dispatch or a spec amendment. Gate W4.                                                                                                                                     |
| **B2** — README / ARCHITECTURE / CONTEXT uncommitted                                                                                                       | The good copy is in the working tree but must not be committed as-is: three `current`-labelled anchors claim the pane-local Windows clipboard path works, which Task 4 changes. Update those anchors, then commit with approval (D14). |
| **B3** — Gates W1–W4 never run                                                                                                                             | Requires real hardware. `windows-check` structurally cannot catch A1–A8.                                                                                                                                                               |
| **`concurrency-lifecycle` audit dimension**                                                                                                                | The auditor died on a transport error and this dimension was never swept on its own terms. It covers exactly the deadlock and teardown ground of the already-landed A2 fix (`f75fe12`). Re-run before ship.                            |
| **A2 regression test**                                                                                                                                     | `kill_pty` needs a Tauri managed-state harness; the audit lists the failing-`terminate_session` test as follow-up.                                                                                                                     |
| **C1–C11, section D**                                                                                                                                      | Ship-with-known-risk and follow-up tiers. C2 becomes observable after Task 3; C1 (VS Code `.cmd` on PATH) is the highest-value of the remainder, and `agent_discovery.rs:10` already has the `COMMAND_SUFFIXES` list to reuse.         |

## Verification summary

After every task:

```bash
npm test
npx tsc --noEmit
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc   # Tasks 6-7
```

Baseline before this plan: 879 Vitest tests across 68 files, 113 Rust tests, `tsc` clean, `cargo fmt` clean. Do not report a task complete without pasting the relevant output (W4). No task in this plan is verifiable as _working on Windows_ from the macOS dev host — every Windows behavioural claim belongs to `windows-check` or to the audit's manual QA checklist, and must be attributed there rather than to a green local run.
