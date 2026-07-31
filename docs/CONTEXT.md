# SpaceVibe Deck — working context

## Docs layout

- `docs/DESIGN-LANGUAGE.md` — canonical rulebook for chrome UI: tokens, color
  roles, typography, motion, copy. Rules are numbered (`DL-3.2`) and cited from
  code comments. Single source of truth for the app's visual language.
- `docs/specs/`, `docs/plans/` — per-feature design notes and implementation
  plans, dated `YYYY-MM-DD`.
- `docs/review/` — audit and drift-review findings.
- `docs/intent/`, `docs/archive/`, `docs/CONTEXT-archive.md` — historical
  material, kept for provenance, not authoritative.
- Domain glossary: repo-root `CONTEXT.md`.

## History note (2026-07-27)

This tree used to run an **adk ADR-first pipeline**: `PIPELINE.lock`, an
append-only ADR log in `docs/decisions/` (0001–0028), and six docs rendered from
it — `PRINCIPLES.md`, `PRD.md`, `BUSINESS-FLOW.md`, `ARCHITECTURE.md`,
`UX-DESIGN.md`, `REQUIREMENTS.md`. All of it was removed on 2026-07-27; the
git history still has it.

Consequences worth knowing:

- Code comments no longer cite `FR-…`, `UX §…`, `BF-Rule …` or `ADR …` — those
  references were stripped when the docs went away. `DL-…` citations stay valid.
- Design decisions are no longer recorded as immutable ADRs. Record them in the
  relevant spec or plan under `docs/specs/` / `docs/plans/`.
- Older files under `docs/plans/` and `docs/review/` still reference the removed
  docs. They are point-in-time records; left as written.

## Product snapshot

- Job: observe and control many agent CLIs in parallel on desktop.
- macOS is the current public release; Windows 11 x64 is an engineering preview
  ([platform configs](../src-tauri/tauri.macos.conf.json) `current`,
  [Windows config](../src-tauri/tauri.windows.conf.json) `current`).
- Surfaces: layout presets and the preset editor, pane swap, multi-window
  move/join, the Open board (workspace ∥ preset), the post-materialize agent
  picker, the file sidebar with preview and diff.
- Session persists chrome only, never CWD; presets carry optional per-pane CWDs
  separately.
- Out of scope: embedding agent UI, SSH, chasing iTerm parity, editing from the
  sidebar, a notarized ship gate.

## Windows engineering preview — 2026-07-29

Implemented source boundaries:

- Windows prefers `pwsh.exe`, falls back to `powershell.exe`, uses
  `USERPROFILE`, and injects session-only prompt/CWD integration
  ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L12-L113) `current`).
- Each Windows pane owns a Job Object; WMI process snapshots expose explicit
  CWD/process/kind/agent truth and fail closed to `unknown`
  ([platform session](../src-tauri/src/platform/windows/mod.rs#L14-L84) `current`,
  [pty_info](../src-tauri/src/info.rs#L10-L34) `current`).
- Windows paths support drive, relative, Unicode, and location suffixes. UNC
  candidates are recognized by the frontend pattern but never resolved: hover
  and open-in-editor reject a `\\`-root before any filesystem call, so a UNC
  path is copy-pasteable and not clickable
  ([terminal-links.ts](../src/lib/terminal-links.ts) `current`,
  [has_rejected_root](../src-tauri/src/shell_integration.rs#L96-L122) `current`).
  Editor requests are structured and Windows custom templates are argv, not
  shell commands
  ([links.rs](../src-tauri/src/links.rs#L187-L314) `current`).
- The Windows keymap, primary modifier, visible labels, clipboard chords, and
  native decorated chrome are platform-owned
  ([WINDOWS_KEYMAP](../src/terminal/action-registry.ts#L670-L736) `current`,
  [commands table](../src/terminal/tab-manager.ts#L946-L1024) `current`,
  [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Pull-request CI compiles the Windows desktop without producing or publishing
  an installer
  ([windows-check](../.github/workflows/ci.yml#L65-L109) `current`). CI run
  [30475656139](https://github.com/mxrsv/spacevibe-deck/actions/runs/30475656139)
  passed Linux and Windows on 2026-07-29, including the Windows desktop build.

Delivery state:

- No Windows installer has been staged. The manual engineering job validates
  one NSIS setup, rejects MSI output, retains the artifact for seven days, and
  refuses to build unless the repository is private
  ([artifact job](../.github/workflows/ci.yml#L111-L159) `current`). GitHub
  reported this repository as public on 2026-07-29, so dispatch would fail at
  the privacy guard; no manual dispatch was performed.
- Gates W1–W4 and the full real-device checklist remain pending
  ([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).
- Real Windows screenshots at `1100x720` and `480x320` in top-tab and sidebar
  modes remain pending user eye approval
  ([demo surface](specs/2026-07-29-windows-desktop-design.md#77-window-chrome-and-demo-surface) `decided`).
- Signing and any public Windows distribution require a separate decision and
  authorization. The existing tagged macOS release remains unchanged
  ([release.yml](../.github/workflows/release.yml) `current`).

## Stack

Tauri 2 + Rust + Preact + xterm.js. Signals for state; module stores are
window-scoped. The Rust PTY/window coordinator, tab materialize, layout engine
and close-coordinator paths are the load-bearing seams — treat `src-tauri`
module boundaries as in-flight when planning.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                                             | Intent    | Status         | Evidence                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Code comments no longer cite `FR-…` … or `ADR …`" (History note) | `current` | `contradicted` | 4 comments remain: [agents.rs](../src-tauri/src/agents.rs#FR-025) `current`, [open-board.tsx](../src/open-board/open-board.tsx#FR-025) `current`, [migrate.rs](../src-tauri/src/migrate.rs#ADR 0028) `current` |

The historical comment drift was found on 2026-07-27.

Gates W1-W4, the real-device checklist, screenshots, and signed distribution are
NOT listed above: per the docs convention, `decided`/`building` claims are
backlog rather than drift. They are tracked in the Delivery state bullets above,
and no pending gate is inferred as passed.

The 2026-07-30 pre-ship audit's code blockers (A1-A8) were remediated on
2026-07-31; the `current` claims above were re-checked against that code. The
audit's delivery blockers B1 (no installer can be produced from a public repo)
and B3 (gates never run) are unchanged and remain in the Delivery state bullets.

Known residuals from that remediation, recorded here so they outlive the working
notes — none contradicts a `current` claim above, so none is a drift row:

- The remediation now RUNS on Windows in CI, not only on macOS: run 30613282200
  (2026-07-31, `windows-check`) executed 125 Rust tests on `windows-latest` —
  124 passed, and the one failure was the UNC assertion replaced below. That run
  carries the first real-host proofs of the branch: Windows PowerShell 5.1 parses
  the prompt integration and emits a real ESC byte, and a Job Object tracks and
  releases a grandchild process (Gate W3). Nothing has run on a real Windows
  DEVICE yet — no installer, no manual QA.
- `has_rejected_root` rejects UNC and verbatim roots, not mapped drive letters. A
  stale `Z:\` still reaches the filesystem — the audit's own "non-adversarial"
  example, missed by both the audit's code analysis and the remediation plan.
- `builds_profile_loading_prompt_integration` is a substring check on the Rust
  literal, so it cannot tell a working prompt from a broken one: renaming
  `Global:prompt` reproduces the original A1 failure with the suite green.
- Clickable UNC links were GIVEN UP for the A3 guard, deliberately and with a
  cost. `\\localhost\C$\...` resolved on Windows and CI proved it green until
  2026-07-31; `resolve_one` now shares `has_rejected_root` with
  `retain_valid_cwd`, so any `\\` root returns `None` before the filesystem is
  touched. The trade: hovering is passive and unintentional, while a probe into
  a host that terminal output named stalls the resolve on an unreachable share
  and offers the interactive user's NTLMv2 credentials to whoever chose that
  name. A UNC path stays copy-pasteable; mapped drive letters are unaffected
  (and still unguarded, per the residual above)
  ([resolve_one](../src-tauri/src/links.rs#L83-L104) `current`).
