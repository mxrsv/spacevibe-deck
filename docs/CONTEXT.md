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
- Agents are user-extensible: beyond the built-in five, an agent is a label plus
  a full command line declared in Settings → agents
  ([catalog](../src/lib/agent-catalog.ts) `current`,
  [section](../src/ui/settings/sections/agents-section.tsx) `current`). A
  built-in id equals its binary name, so a workspace's remembered `lastAgent`
  resolves without migration. Discovery probes only names that pass
  [`is_probe_safe`](../src-tauri/src/agents.rs) `current` — the macOS probe
  interpolates them into a shell.
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
  while the hero shows the current combined `.dmg` and `.exe` asset download
  count. The changelog lists stable releases and previews from the same
  validated response
  ([landing CTA](../marketing/landing-prototype/src/directions/a.js#renderDirectionA) `current`,
  [download total](../marketing/landing-prototype/src/release-data.js#totalInstallerDownloads) `current`,
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
- ~~Generate the production updater keypair~~ — done; `0.10.0` and `0.11.0`
  shipped signed against it. The key is the one thing that must never change:
  its public half is compiled into every build already in the field, so a new
  keypair makes old builds refuse new ones and every user reinstalls by hand.
- Run the update flow on real Windows 11 x64. macOS closed on 2026-08-05
  (see below); Windows was deliberately skipped.
- Obtain user eye approval for the `1100x720` and `480x320` screenshots in both
  top-tab and sidebar layouts. Windows remains an unsigned B2 preview, so
  Authenticode/SmartScreen publisher identity is intentionally unresolved.

## Hardened updater — 0.11.0, shipped 2026-08-05

`0.11.0` is the bootstrap the rest of the update story rests on: from here every
later patch reaches users on its own, so this one had to be right.

What the release actually changed:

- The release validator reproduces Tauri's Minisign check in Node — packet
  parsing, key-id equality, BLAKE2b-512 prehashing for `ED`, the payload
  signature and the trusted-comment global signature — over bytes re-downloaded
  from the exact draft, not over the staging directory
  ([verifier](../scripts/verify-updater-manifest.mjs) `current`).
- macOS gained the same collect → re-download → verify → publish gate Windows
  already had; before this, macOS only checked that a signature string was
  non-empty ([release workflow](../.github/workflows/release.yml) `current`).
- The updater plugin is pinned to a fork revision with upstream PR #3516 and a
  macOS transactional swap ([pin](../src-tauri/Cargo.toml) `current`).

What was verified on real hardware, 2026-08-05:

- macOS `0.11.0-rc.1` → `0.11.0-rc.2` upgraded end to end through an isolated RC
  channel. The installed bundle kept mode `0755` rather than the extraction
  directory's `0700` — upstream issue #3506 proven fixed at runtime.
- A manifest advertising a non-existent `0.11.0-rc.3` with one flipped signature
  byte was downloaded and refused; nothing installed, no bundle touched.
- Both published channels were re-verified against the live bytes after release:
  `releases/latest` and `windows-preview-channel` both serve `0.11.0` with valid
  signatures.
- Windows end-to-end was **skipped by decision**, and failure injection with it.
  Recorded with its cost in [AGENTS.md](../AGENTS.md) `current`.

Before buying signing certificates, check three things — none are about the
certificates themselves, all three are about what gets edited in the same sitting:

1. **Never rotate the updater keypair.** See the delivery gate above.
2. **macOS: changing the signing identity resets TCC.** Permissions the user
   granted are bound to the code signature, so moving from the ad-hoc identity
   to a Developer ID makes macOS treat it as a different app. Updates still
   install; the app just forgets it was ever allowed
   ([current identity](../src-tauri/tauri.macos.conf.json) `current`).
3. **Windows: keep `bundle.publisher` byte-identical.** NSIS derives its product
   identity from it, so changing it to match a certificate's legal name makes
   the installer place a second copy beside the first instead of upgrading
   ([publisher](../src-tauri/tauri.conf.json) `current`).

## Reaching updates without a menu bar — 0.12.0

`src-tauri/src/menu.rs` is gated `#[cfg(target_os = "macos")]` end to end, so
Windows has no menu and therefore had no `Check for Updates…` and no
`Release Notes…`. The chrome button only appears once an update has been
found, which left a Windows user with no pending update unable to ask for one
without restarting Deck.

- Settings gains an `about` category — two config rows on the existing
  `action` kind, so §6's closed set needed no new entry
  ([section](../src/ui/settings/sections/about-section.tsx) `current`,
  [registry](../src/ui/settings/settings-categories.ts) `current`).
- The pill drives the controller already in use; the description answers the
  press rather than leaving it silent.
- The running version comes from the bundle, not the updater — the updater's
  view reports an empty string until a check finds something
  ([store](../src/updater/app-version.ts) `current`).
- Sections take no props, so `App` publishes its controller through a
  window-scoped signal
  ([store](../src/updater/active-update-controller.ts) `current`).
- OpenCode was the only built-in agent absent from `AGENT_LOGOS` and wore a
  letter avatar beside three brand marks
  ([logo map](../src/open-board/open-board.tsx) `current`). Agents the user
  declares still fall through to the letter avatar.

## Antigravity CLI becomes the fifth built-in — 2026-08-07

Google announced on 2026-05-19 that Gemini CLI would stop serving free, AI Pro
and Ultra users on 2026-06-18, replaced by Antigravity CLI — command `agy`, a
closed-source Go binary installed by a shell script rather than npm. Nothing in
Deck knew the name, so an `agy` pane classified as `busy`: no dot color, no
agent label, and the board offered no chip for it.

- `agy` joins `BUILTIN_AGENTS`, and the row is reordered by reach rather than
  by history: Claude, Codex, OpenCode, Antigravity, Gemini. That list is also
  the digit-key order, so `4` now opens Antigravity and `5` Gemini — a
  deliberate break with the keys people already have in their fingers, taken
  because the row should lead with what is actually reached for
  ([catalog](../src/lib/agent-catalog.ts) `current`,
  [Rust mirror](../src-tauri/src/agents.rs) `current`).
- Gemini CLI stays. Paid Code Assist licences still reach the service, and a
  built-in id equals its binary name, so dropping `gemini` would strand every
  `lastAgent` on disk holding that string with no migration to catch it.
- `agy` shares Gemini's `--cyan`. The theme injects eight colors; four are
  taken, `--red` is error-only (DL-3.2) and `--accent` _is_ the theme's blue,
  reserved for interactive (DL-3.1). A new token sourced from `brightBlue` was
  the first choice and was dropped on evidence: `brightBlue` equals `blue` in
  three of the four presets ([presets](../src/settings/themes.ts) `current`),
  so the dot would have read as the accent color
  ([dot map](../src/lib/process-info.ts) `current`).
- Windows identifies it by executable name only — a single Go binary has no
  node wrapper, so there is no npm signature to match
  ([snapshot](../src-tauri/src/platform/windows/process_snapshot.rs) `current`).
- Its brand mark is the first raster one in `AGENT_LOGOS` — Google publishes
  the Antigravity icon as PNG. Stored at 96px against a 15px chip, which keeps
  3x headroom at 5.5 kB, and checked on the dark chrome background to confirm
  the alpha channel is real and not a white plate
  ([logo map](../src/open-board/open-board.tsx) `current`).
- Known-open: its OSC 9;4 behaviour is unobserved — a closed-source binary
  cannot be read for it, so the activity tracker falls back to the
  sustained-output heuristic until someone runs it
  ([activity](../src/terminal/agent-activity.ts) `current`).

## Prompt Board — 2026-08-08

A chrome popover of reusable prompt templates. One click pastes a template body
(plus optional skill / subagent reference lines) into the agent session running
in the pane that was focused when the popover opened. Opened by ⌘⇧P /
Ctrl+Shift+P or View → Prompts…; the trigger sits beside Settings in the tab
bar. Zero new dependencies, npm or cargo.

- Templates are `{id, label, body, autoSend}` in the settings store beside
  `customAgents`, validated with the same drop-not-repair discipline — a
  malformed entry is dropped, never guessed at, because its body is pasted
  verbatim into a live PTY
  ([catalog](../src/prompts/prompt-templates.ts) `current`,
  [validation](../src/settings/settings-schema.ts) `current`).
- Injection rides xterm's bracketed-paste path
  ([`Pane.pasteText`](../src/terminal/pane.ts) `current`), which is the only
  route that lands a multi-line body in an agent TUI's composer as one block.
  Ordering of "paste frame, then `\r`" is structural, not timed: every write
  for a pane now chains behind the previous one's settled promise in a per-pane
  FIFO queue ([`enqueueWrite`](../src/terminal/pane-lifecycle.ts) `current`),
  so `onData` keystrokes and a programmatic submit share one order.
- `autoSend` is never an unconditional Enter. Immediately before `\r` is
  enqueued a triple gate is re-read: the pane still runs the SAME agent it ran
  at capture (fresh `pty_info`, not the 2s poll cache), its attention snapshot
  is `idle` with nothing latched beyond `completed`, and it is still in some
  tab's layout ([`submitAllowed`](../src/prompts/inject.ts) `current`,
  [orchestration](../src/terminal/tab-manager.ts) `current`). A failed gate
  degrades to paste-only and says "Pasted — not sent".
- Detection is a read-only Rust scan — no shell, no PTY. It walks
  `~/.claude/skills`, `~/.claude/agents`, the project's own `.claude/…` found
  by walking up from the pane's cwd, and every active plugin's `installPath`
  read from `installed_plugins.json`; Codex gets `~/.codex/skills` and
  `~/.codex/agents/*.toml`. Symlinks are refused rather than followed, reads
  are head-bounded at 16 KiB, results capped at 200 per kind, and a missing
  directory or unreadable file is an empty list rather than an error
  ([scanner](../src-tauri/src/prompt_assets.rs) `current`).
- Frontmatter and TOML are parsed by hand, not by a crate: the zero-dependency
  rule holds, and every descriptor verified on disk carries `name` /
  `description` as a plain, quoted or folded scalar. A Codex agent is named by
  its **file stem**, not its `name =` field — the stem is what the CLI loads by
  path, so a disagreeing field would send the wrong reference into the prompt.
- The surface is DL §12 rows inside a new DL §13 anchored popover, plus
  `CommitTextarea` — the multi-line sibling of `CommitInput`, with the same
  local-draft discipline because the popover's parent never unmounts
  ([popover](../src/prompts/prompt-popover.tsx) `current`,
  [control](../src/ui/controls/commit-textarea.tsx) `current`,
  [rules](DESIGN-LANGUAGE.md) `current`).
- Restore Defaults wipes templates along with declared agents — it always did
  for agents; the confirm sentence now says so
  ([copy](../src/ui/settings/sections/reset-section.tsx) `current`).

Verified 2026-08-08: `npm test` 1093 passing across 96 files, `npm run build`
(tsc + vite) green, `npm run generate:menu:check` green, `cargo test` 151
passing. The popover surface was eye-reviewed against §12/§13 on a screenshot of
its real rendered DOM over the real stylesheet.

Known-open, deliberately: the acceptance table in the plan's Task 12 Step 4 has
NOT been run. Nothing has driven ⌘⇧P inside a running desktop build, so a real
paste into a live Claude composer, a real auto-send through the gate, and the
popover closing when its target pane's tab closes are all unobserved outside
unit tests. `agy`, `gemini` and `opencode` have no verified asset layout, so a
pane running one of them hides the pickers and pastes the body alone.

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
