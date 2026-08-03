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
  picker, the file sidebar with preview and diff, and a full-window Settings
  screen with a category rail
  ([`SettingsScreen`](../src/ui/settings/settings-screen.tsx) `current`,
  [category registry](../src/ui/settings/settings-categories.ts) `current`) —
  a new category is one registry entry plus one file under `sections/`.
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

- An unsigned NSIS setup is published publicly as the
  [v0.9.0-windows-preview](https://github.com/mxrsv/spacevibe-deck/releases/tag/v0.9.0-windows-preview)
  prerelease (2026-07-31), and the landing resolves its download link at load
  time
  ([shared release source](../marketing/landing-prototype/src/release-data.js#fetchPublishedReleases) `current`,
  [link upgrade](../marketing/landing-prototype/src/download-links.js#upgradeReleaseLinks) `current`).
  The landing header exposes a Changelog item; the GitHub CTA also shows the
  latest stable tag and links that tag to the dedicated bilingual changelog,
  which lists stable releases and previews from the same validated response
  ([landing CTA](../marketing/landing-prototype/src/directions/a.js#renderDirectionA) `current`,
  [changelog view](../marketing/landing-prototype/src/changelog-view.js#renderReleaseList) `current`).
  The manual engineering job in CI still validates one NSIS setup, rejects MSI
  output, and refuses to build unless the repository is private
  ([artifact job](../.github/workflows/ci.yml#L111-L159) `current`); the repo
  was public on 2026-08-01, and how the published exe was produced is not
  recorded in reachable history.
- Gates W1–W4 and the full real-device checklist remain pending
  ([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).
  First field report, 2026-08-01: the installer fails with an NSIS
  "Extract: error writing" when targeting a secondary drive; the default
  per-user install to `%LOCALAPPDATA%` on the system drive succeeds.
- Real Windows screenshots at `1100x720` and `480x320` in top-tab and sidebar
  modes remain pending user eye approval
  ([demo surface](specs/2026-07-29-windows-desktop-design.md#77-window-chrome-and-demo-surface) `decided`).
- Signing remains pending — the preview ships unsigned, so SmartScreen warns
  on install, and the landing says so next to the Windows CTA. The existing
  public macOS release remains unchanged; the tagged workflow now stages the
  next macOS stable and Windows preview as separate updater-enabled releases
  ([release.yml](../.github/workflows/release.yml) `current`).

## Stack

Tauri 2 + Rust + Preact + xterm.js. Signals for state; module stores are
window-scoped. The Rust PTY/window coordinator, tab materialize, layout engine
and close-coordinator paths are the load-bearing seams — treat `src-tauri`
module boundaries as in-flight when planning.

## Cross-platform auto-update — 2026-08-03

Implemented source boundaries:

- Deck checks once after launch and exposes `Update` → `Downloading…` →
  `Install & Relaunch`; download and installation require separate clicks
  ([controller](../src/updater/update-controller.ts#L82-L208) `current`,
  [chrome action](../src/updater/update-action.tsx) `current`).
- On 2026-08-04, the macOS App menu added `Check for Updates…` for explicit
  rechecks and `Release Notes…` for the existing web changelog; current/error
  checks receive native feedback and never start a download
  ([menu registry](../src/terminal/action-registry.ts#L138-L159) `current`,
  [menu behavior](../src/updater/update-menu-actions.ts#L62-L90) `current`).
- Installation reuses fresh pane inspection with update-specific copy, flushes
  pending settings, and retains retry state on download, flush, install, or
  relaunch failure
  ([App integration](../src/ui/app.tsx#L182-L210) `current`,
  [close guard](../src/terminal/close-guard.ts) `current`).
- Tauri grants only updater check/download/install and process restart. macOS
  points at stable `latest.json`; Windows points at the fixed unsigned preview
  channel; updater artifacts are enabled only by the release config
  ([capability](../src-tauri/capabilities/default.json) `current`,
  [macOS channel](../src-tauri/tauri.macos.conf.json) `current`,
  [Windows channel](../src-tauri/tauri.windows.conf.json) `current`,
  [release config](../src-tauri/tauri.release.conf.json) `current`).
- The tag workflow isolates macOS stable from Windows preview, keeps both as
  drafts until their validation gates pass, and promotes Windows `latest.json`
  only from an exact-SHA artifact with checked digests and GitHub release asset
  membership
  ([release workflow](../.github/workflows/release.yml#L1-L314) `current`,
  [validator](../scripts/verify-updater-manifest.mjs) `current`).

Remaining delivery gates:

- Deploy the current landing artifact and verify
  `https://deck.spacevibe.dev/landing-prototype/changelog/` returns `200`
  before shipping the desktop menu link; it returned `404` on 2026-08-04,
  while `npm run build:landing` produced the expected changelog artifact.
- Generate and securely back up the production Tauri updater keypair, commit
  only its public key through `DECK_UPDATER_PUBLIC_KEY`, and configure the
  private key/password as protected GitHub Secrets. No production key was
  generated during implementation.
- Manually install the first updater-enabled release from v0.9.0, then run the
  signed disposable-manifest update flow on macOS and real Windows 11 x64.
- Obtain user eye approval for the `1100x720` and `480x320` screenshots in both
  top-tab and sidebar layouts. Windows remains an unsigned B2 preview, so
  Authenticode/SmartScreen publisher identity is intentionally unresolved.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                                             | Intent    | Status         | Evidence                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Code comments no longer cite `FR-…` … or `ADR …`" (History note) | `current` | `contradicted` | 4 comments remain: [agents.rs](../src-tauri/src/agents.rs#FR-025) `current`, [open-board.tsx](../src/open-board/open-board.tsx#FR-025) `current`, [migrate.rs](../src-tauri/src/migrate.rs#ADR 0028) `current` |

The historical comment drift was found on 2026-07-27. The delivery-state drift
found by the [2026-08-01 audit](review/2026-08-01-doc-drift.md) `current` was
resolved the same day by rewriting the Delivery state bullets above.

Gates W1-W4, the real-device checklist, screenshots, and signed distribution are
NOT listed above: per the docs convention, `decided`/`building` claims are
backlog rather than drift. They are tracked in the Delivery state bullets above,
and no pending gate is inferred as passed.

The 2026-07-30 pre-ship audit's code blockers (A1-A8) were remediated on
2026-07-31; the `current` claims above were re-checked against that code. The
audit's delivery blocker B1 (no installer can be produced from a public repo)
was overtaken on 2026-07-31 by the published prerelease; B3 (gates never run)
still stands and remains in the Delivery state bullets.

Known residuals from that remediation, recorded here so they outlive the working
notes — none contradicts a `current` claim above, so none is a drift row:

- The remediation now RUNS on Windows in CI, not only on macOS: run 30613282200
  (2026-07-31, `windows-check`) executed 125 Rust tests on `windows-latest` —
  124 passed, and the one failure was the UNC assertion replaced below. That run
  carries the first real-host proofs of the branch: Windows PowerShell 5.1 parses
  the prompt integration and emits a real ESC byte, and a Job Object tracks and
  releases a grandchild process (Gate W3). Overtaken 2026-08-01: the preview
  installer is published and was field-installed by an end user; structured
  manual QA has still not run.
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
