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
- A Deck-native three-region workbench direction is being explored only in the
  chrome gallery before any shipping UI changes
  ([gallery design](specs/2026-08-12-agent-workbench-gallery-design.md) `building`).
- macOS is the current public release; Windows 11 x64 is an engineering preview
  ([platform configs](../src-tauri/tauri.macos.conf.json) `current`,
  [Windows config](../src-tauri/tauri.windows.conf.json) `current`).
- Surfaces: layout presets and the preset editor, pane swap, multi-window
  move/join, the Open board (workspace ∥ preset) reached from the sidebar's
  "Open workspace" row, AgentQuickPicker (the tab strip's `+`/⌘T fast path —
  single pane, active tab's workspace, no workspace/preset step), the
  post-materialize agent picker, the file sidebar with preview and diff, and a
  full-window Settings screen with a category rail
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
  ([WINDOWS_KEYMAP](../src/terminal/action-registry.ts#L701-L784) `current`,
  [commands table](../src/terminal/tab-manager.ts#L946-L1024) `current`,
  [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Resolved 2026-08-10: the capture-phase shortcut listener left `Ctrl+V`
  unbound, so it reached the active agent; Codex then treated a text paste as
  image paste. Deck now owns `Ctrl+V`, `Ctrl+Shift+V`, and physical
  `Shift+Insert` for text only, through the existing clipboard-to-xterm path.
  Deck leaves `Alt+V` unbound; whether the active agent CLI handles it for
  image paste is unverified. Plain Explorer Copy of a folder (`CF_HDROP`
  file-list data) and smart clipboard routing are unsupported
  ([WINDOWS_KEYMAP](../src/terminal/action-registry.ts#L701-L784) `current`,
  [clipboard text boundary](../src/terminal/terminal-clipboard.ts#L45-L55) `current`).
- This exact paste contract has unit coverage, but real Windows desktop E2E is
  still unverified; it remains part of the pending real-device checklist
  ([acceptance criteria](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).
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
- The same workflow now requires every active conventional `feat`, `fix`, and
  `perf` commit to declare `Release-Note: <user-facing description>` or
  `Release-Note: skip` before either draft build. Standard, nested, and merge
  reverts are removed; `skip` wins; breaking metadata routes the explicit
  public description into its own section; both platform releases share the
  change sections; and a release with no public entry fails before publishing
  generic copy. Manual Windows rebuilds of older tags instead reuse the reviewed
  stable GitHub release body, preserving the exact tag while avoiding a false
  failure against history created before the policy
  ([generator](../scripts/generate-release-notes.mjs#generateReleaseNotes) `current`,
  [workflow contract](../scripts/release-workflow.test.ts) `current`).

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

## Unified icon system — 2026-08-09

The app's functional icons now come from one place. Before this, chrome and the
settings rail carried hand-drawn SVG while rows, tabs and the search bar used
typographic characters — `×`, `▾`, `↹`, `↺`, `‹`, `›`, `↩` — so the same action
was a picture in one surface and a character in the next, at whatever weight
the surrounding font happened to give it.

- The source is `lucide-preact` (the first new runtime dependency chrome has
  taken), imported by name and drawn through one component that owns every
  presentation default — `aria-hidden`, `focusable`, `fill`, stroke and the
  four sizes the chrome uses
  ([`DeckIcon`](../src/ui/controls/deck-icon.tsx) `current`,
  [rules §14](DESIGN-LANGUAGE.md) `current`). `strokeWidth` is 1.8
  because the icons it replaced already drew at 1.8 in the same 24-unit box —
  true for chrome and the settings rail, but NOT for the Open Board, whose two
  folder drawings used a 16-unit box and came out heavier (≈1.4px against
  ≈1.1px now).
- CSS is where this kind of contract usually dies: a `stroke-width` or `width`
  rule beats an SVG attribute, and `.row__ico` / `.openfolder svg` had both.
  Those declarations are gone, their themed colours restated as `color` so
  `currentColor` resolves the same way it painted before
  ([styles](../src/styles.css) `current`).
- Prompt Board's one action became two: `ClipboardPaste` when a template only
  pastes, `Send` when it presses Enter, with the accessible name and tooltip
  saying the same thing. The safety gate is untouched and still authoritative —
  a Send that fails it pastes and reports "Pasted — not sent"
  ([popover](../src/prompts/prompt-popover.tsx) `current`,
  [gate](../src/prompts/inject.ts) `current`).
- The search bar stays imperative DOM but does not get a second icon path: it
  renders `DeckIcon` into its existing buttons with Preact and unmounts those
  roots on both disposal paths. Its buttons also gained explicit
  `aria-label`s — with the text replaced by an aria-hidden icon, the only name
  left would have been the tooltip
  ([bar](../src/terminal/search-bar.ts) `current`).
- Outside the library on purpose: the Deck brand mark, agent and OS logos,
  keyboard/terminal notation, status dots and `WorkspaceSpinner`. A filesystem
  test scans `src/**/*.{ts,tsx}` for authored `<svg>` and for retired glyphs,
  with counts as well as paths, so neither can come back quietly
  ([guard](../scripts/icon-system.test.ts) `current`). It earned itself
  immediately: it found a layout-preset delete button the plan had missed.

Verified 2026-08-09: `npm test` 1136 passing across 99 files (from 1103/96),
`npm run build` green, `npm run generate:menu:check` green, and
`npm run video:render` exit 0 across all four presets. Main JS gzip went
170.37 KiB → 172.67 KiB, **+2.30 KiB** against a 15 KiB ceiling, which is the
evidence that Rollup tree-shakes the barrel rather than shipping the catalog;
CSS shrank 9.02 → 8.97 KiB.

The marketing stage did NOT change and could not have: `marketing/stage/appwin.js`
draws its own chrome icons as inline SVG strings and imports nothing from `src/`,
so the app and the film now carry two different icon sets that happen to agree
because the marketing copies were traced from the same drawings. Nothing broke —
but `video:render` is a weaker gate than it looks for this migration, and the
film's chrome will drift from the app's the moment either side changes an icon
([stage icons](../marketing/stage/appwin.js) `current`). Reconciling them is out
of this migration's scope, which explicitly excluded marketing.

Visual review closed 2026-08-10. `npm run tauri dev` built and opened the native
app at 1100×720; macOS denied direct window capture because this session lacks
Screen Recording permission, so the same DOM was then captured at 1100×720 and
device scale 2 through the Vite surface in Tokyo Night, Dracula, One Dark and
Catppuccin Mocha. The Open Board folder icons, sidebar add slot, `Maximize2`,
settings rail and reset control were all legible and geometrically consistent;
no implementation adjustment followed the review. This proves the rendered
frontend across all four themes, not Windows WebView2 parity. The unified icon
system is therefore `current`, while real Windows visual E2E remains separate.

## Pane detach — Phase A landed 2026-08-10

Implemented from
[the plan](plans/2026-08-10-pane-detach-window.md) `current` in its own wave
order: the Rust transfer transaction, then the wave-1 frontend against fakes,
then the window lifecycle, then the frontend integration. Sections A, B and C
are complete; **section D (cross-window drag) was not started** and stays behind
the plan's §0.7 gate.

**Verified by command, with output.** `cargo test --locked` — 239 passed;
`cargo fmt --check` — clean; `npm test` — 1244 passed across 105 files;
`npm run build` (`tsc && vite build`) — clean; `npm run generate:menu:check` —
exits 0 with `menu_registry.rs` regenerated for the new Window-menu action.
Bundle: `dist/assets/index-*.js` went 172.68 kB → 180.40 kB gzip, entirely
`@xterm/addon-serialize@0.14.0` (the one dependency the spec pre-approved).

**One bug the gates could not see, found by pressing the key.** The first ⌘⇧M
failed with "Couldn't move the pane — it stayed here."; `open_pane_window`
declared a single `args: OpenPaneWindowArgs` parameter while the frontend sent
the frozen contract's flat `{ token, screenX?, screenY? }`. Tauri resolves each
command parameter by looking its camelCased name up in the invoke payload
([`ipc/command.rs`](https://docs.rs/tauri/2.11.5/src/tauri/ipc/command.rs.html)),
so it demanded a key literally named `args`. That mismatch compiles,
type-checks and passes every unit test — Vitest mocks the PTY client, `tsc` has
never heard of a Rust signature, and `cargo test` cannot read `src/`. Fixed by
taking the three arguments flat; a sweep of all 30 commands found no second
instance.
The [IPC contract test](../scripts/ipc-contract.test.ts) `current` now parses
both sides and fails on any command whose required payload keys a call site
does not send. It is the only gate in this repo that crosses
the IPC boundary.

**Verified by hand on 2026-08-10, after that fix.** ⌘⇧M on a pane detaches it
into a second window and **the scrollback arrives intact** — so `prepare` →
`stage` → `open_pane_window` → `claim` → `commit` all run end to end against a
real PTY, and the serialize/replay path works. The one-pane guard below behaves
as designed.

**Still NOT verified — and the automated gates cannot see any of it.**
Outstanding manual pass, under `npm run tauri dev`:

- Typing in the new window reaches the **same process** (an agent mid-run keeps
  answering), not a fresh shell.
- The route lock is now held **across** `app.emit_to` (that is what makes the
  ordering guarantee structural rather than timed). Run several panes producing
  continuous output, detach one and close a window while they are still
  writing, and watch for a **hang** rather than for a wrong result.
- Detach a pane, then force-kill the destination window's webview: the PTY must
  die, not leak (`sweep_and_reap` and `on_window_destroyed` have no unit test —
  `AppHandle` cannot be constructed in one).
- Destroy the destination before it claims: the source pane must return
  **immediately**, not after ten seconds. A ten-second wait means
  `reserve_destination` did not run.
- ⌘Q with a busy agent in the non-focused window: exactly one dialog, naming
  that agent; a second ⌘Q while it is open does nothing.
- Close one window of two: only its panes die. Close the last window: the
  process actually exits (`ps` shows no `spacevibe-deck`) — the old
  `prevent_exit` would have hung here.
- Change a setting in each window in turn: both stick, and both survive a
  relaunch.
- Windows only: F5 in a detached window does nothing, and the devtools console
  shows no capability errors.

**A fork resolved on the day, not in the spec or the plan.** ⌘⇧M from a window
holding exactly one pane is now a **no-op with a message** rather than a move.
Neither document covered it: the plan weighed a one-pane window only for the
Phase B _drag_ path (Task D9 and manual item 8), and only for dragging **into
another window**. Moving that pane to a NEW window closes this window and opens
another holding the same pane — the window is swapped, its geometry lost, and
the pane is risked through a whole transaction for no observable change. The
condition is **window-level, not tab-level**: a second tab keeps the window
alive, so splitting that tab out is still a real move. Only the new-window
target is guarded — offering the pane to an **existing** window merges it and
stays meaningful even from a one-pane window, which is exactly what manual item
8 asks for.

## Electron migration — prep opened 2026-08-11

**Status: prep only. No product code, no Electron dependency, nothing scaffolded
in the product tree.** The decisions are in
[`AGENTS.md`](../AGENTS.md) `current` In flight, the work sequence in the
[prep plan](plans/2026-08-11-electron-migration-prep.md) `current`, and the
target design in the
[design spec](specs/2026-08-11-electron-migration-design.md) `decided`.

Deck leaves Tauri for an Electron host written in Node/TS. The motivation is
ship speed and DX — the Rust seams are correct, they are just slow to move in —
and it is worth naming that this buys nothing a user can see. What a user gets
is worse on two axes at once: a larger binary and more RAM, plus a one-time
loss of every stored setting.

**Tauri feature work is frozen from this date.** Hotfixes still ship. The token
usage dashboard ([spec](specs/2026-08-10-token-usage-dashboard-design.md) `decided`)
and pane-detach Phase B ([plan](plans/2026-08-10-pane-detach-window.md) `current`,
section D) are the two features the freeze holds back, and both are
re-targeted at Electron rather than cancelled. The freeze lifts when the three
spike gates each reach a conclusion, not on a date — see below.

**The two open questions in the plan's §5 are answered (2026-08-11):**

- The public "no Electron" proof point is replaced by "no accounts, no
  telemetry" as the lead, with "made for agent CLIs" promoted beside it —
  agent detection, attention state, prompt board, presets. Deliberately not a
  performance claim: Electron would make one false, and a claim that a
  competitor can disprove is worse than no claim. The copy itself is NOT
  edited yet — [`README.md`](../README.md) `current` and
  [`copy.js`](../marketing/landing-prototype/src/copy.js) `current` still say
  "no Electron", which stays true until the cutover ships. Editing
  them is a cutover-plan task.
- The freeze ends on **gates, not on a calendar**. The plan proposed one week
  for the spike and six weeks to MVP parity; both were replaced, because the
  motivation ("ship speed and DX") has never been measured in hours or build
  minutes, so any deadline would have been a guess enforced against real work.
  The cost of the swap is the obvious one and is accepted rather than
  overlooked: a hanging gate hangs the freeze. Gate C is hardware-blocked right
  now, so this is not hypothetical.

**Spike baseline — ran 2026-08-11, 7/7 passed.** Throwaway spike, kept out of
the repo per F4 (session scratchpad, not the worktree): Electron 43.3.0 +
`node-pty` 1.1.0 + a Vite/Preact/xterm renderer loaded from `file://` with
`contextIsolation` on and `nodeIntegration` off. It spawns `$SHELL -l` on a
real PTY, streams bytes into xterm, resizes, and kills. Resize is checked by
reading `tput cols` back **from the shell** rather than by trusting the return
value, so SIGWINCH is proven to arrive. Login-shell agent detection was
reproduced exactly as [`agents.rs`](../src-tauri/src/agents.rs) `current` does
it — `$SHELL -ilc "command -v …"`, interactive login, 3 s budget — and found
all five built-in agents in 0.8–1.2 s. The **same script also passes inside the
packaged universal `.app`**, which is the only version of this proof that means
anything.

Four findings that change how Gate B reads, all of them packaging rather than
capability:

- **`node-pty` 1.1.0 is pure N-API** — 38 `napi_*` imports and **zero**
  `v8::`/`node::` internal symbols in the prebuilt `pty.node`. Its prebuilds
  are therefore ABI-stable across Electron versions, and the plan's stated
  Gate B risk ("`electron-rebuild`, prebuilds, ABI per Electron version") is
  mostly not real. Prebuilds ship for `darwin-arm64`, `darwin-x64`,
  `win32-x64` and `win32-arm64`, and the loader picks
  `prebuilds/<platform>-<arch>` **at runtime**, so a universal app ships both
  directories and the addon itself never needs `lipo`.
- **The npm tarball ships `spawn-helper` without the exec bit** (`0644`), and
  node-pty's `postinstall` only chmods `build/Release/`, never `prebuilds/`.
  The symptom is `posix_spawnp failed` on the first spawn and nothing else —
  no hint about permissions. A `chmod +x` fixes it and a postinstall step must
  do that for real. Worth noticing that this is the same failure family as the
  Tauri updater's issue #3506, which shipped a bundle with the wrong mode:
  file modes are where this project keeps getting bitten.
- **`asarUnpack` for `node-pty` is mandatory, not tuning.**
  `unixTerminal.js` rewrites `app.asar` → `app.asar.unpacked` in the
  `spawn-helper` path, so the module is unusable from inside an asar.
- **`mac.x64ArchFiles` is required** for the universal merge.
  `@electron/universal` refuses single-arch Mach-O files that are identical in
  both arch builds, which is exactly what node-pty's per-arch prebuild
  directories are. Without the rule the build fails; with
  `**/node_modules/node-pty/prebuilds/**` it succeeds.

**Measured size, apples to apples.** The packaged universal spike `.app` is
**502 MB**, of which 486 MB is Chromium in `Contents/Frameworks` and only 16 MB
is app code. The installed universal Tauri build is **33 MB**. That is roughly
**15×**, and it is the concrete form of the "binary size accepted for DX"
decision — the trade is now a number rather than a shrug. RAM was not measured.

**Gate status as of 2026-08-11 — none passed:**

| Gate                           | Blocked on                                                                                                                                                                                                                                                                      | Consequence                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A — `electron-updater` E2E     | Apple Developer Program **not bought yet**; Squirrel.Mac refuses an app that is not Developer ID signed and notarized                                                                                                                                                           | No macOS auto-update proof is possible until the identity exists              |
| B — `node-pty` universal in CI | **Partial — everything but CI is done.** A universal `.app` (x86_64 + arm64 verified with `file`) builds locally with `electron-builder` and passes the spike 7/7 when run from the bundle. What is left is one GitHub Actions run, which needs a branch pushed and is not done | Low residual risk, but the gate says "in CI" and a local build is not that    |
| C — Windows process semantics  | **No Windows machine available.** [`job_object.rs`](../src-tauri/src/platform/windows/job_object.rs) `current` and [`process_snapshot.rs`](../src-tauri/src/platform/windows/process_snapshot.rs) `current` are ~1,100 audited LOC with no Node equivalent                      | The migration's top risk, and the trigger for the plan's §0.2 abort criterion |

If Gate C can only be met with a native addon, the "pure Node/TS host" decision
was wrong and gets reopened explicitly — adding the addon quietly would delete
most of the DX argument that motivates the migration while leaving the
migration in flight.

## Electron MVP built — 2026-08-11

**The host is implemented and runs the real app.** Branch `electron-migration`,
commits `5b9305f` and `187af3f`, against
[the MVP plan](plans/2026-08-11-electron-mvp.md) `building`. ~4,100 lines of
TypeScript replace 10,504 lines of Rust; the renderer is unchanged apart from
its imports, which now point at 277 lines of facades under `src/host/`.

**The gate ordering was overridden by the owner.** Both the prep plan and the
spec say an MVP plan may only be authored after gates A, B and C conclude.
Gate A (no Apple identity) and Gate C (no Windows machine) are still open, so
**a Gate C abort can still make this branch sunk cost**. That is a named,
accepted risk, not an oversight.

**Verified, and the distinction matters here.** `npm test` is 1383/1383 across
119 files — but the suite mocks the host, so on its own it proves little about
a migration whose whole point is replacing the host. The evidence that counts
is a headed smoke run against the real app (`npm run electron:smoke`, 10/10):
the preload bridge is exposed, `contextIsolation` holds, **a terminal actually
paints (34 xterm rows after opening a workspace)**, agent detection finds all
five built-ins over IPC, a real PTY echoes back through `pty:output`,
`pty_info` classifies the pane as `idle-shell`/`zsh`, and `kill_pty` succeeds
for its owner.

**`pty_info` reads `ps`, not `node-pty`.** Measured, not assumed: `.process`
returned `"2.1.227"` for a real `claude` pane — the CLI's version banner — and
the executable name instead of argv0 for a renamed job. Deck classifies panes
by argv0 — that is why [`macos.rs`](../src-tauri/src/platform/macos.rs) `current`
reads `KERN_PROCARGS2` rather than `p_comm` — so trusting `.process`
would have labelled every agent pane `Busy` and silently killed the agent chip,
the dot colour and attention state. One `ps -A` per poll tick, joined
tty → `tpgid` → `pgid`: 69 ms for 717 rows against a 2 s interval.

**Windows is a stub that throws by name, not a port.**
[`process_snapshot.rs`](../src-tauri/src/platform/windows/process_snapshot.rs) `current`
and [`job_object.rs`](../src-tauri/src/platform/windows/job_object.rs) `current`
are ~1,100 audited lines with no machine to run a replacement on.
Porting them blind would manufacture confidence in the code where being wrong
is worst: a bad classification either lets quit kill a working agent or leaves
the user unable to quit.

**Four bugs the gates caught, each a class rather than a typo:**

1. **`offer_transfer` sent `targetLabel` while the host destructured `label`.**
   Caught by the new Electron IPC contract test on its first run — the same
   mismatch that shipped `open_pane_window` with four green gates.
2. **The host is CommonJS in an ESM repo**, so a `.js` file was loaded as an ES
   module and died on `exports`. Emitting `.cjs` was the fix; an ESM main
   process would have forced interop on every CommonJS dependency, `node-pty`
   included.
3. **Vite emitted absolute asset paths**, which under `file://` resolve to the
   filesystem root, 404, and produce a blank window with nothing on stderr.
4. **A failed background store write was swallowed** (`void this.save()`) —
   exactly the failure `settings_merge.rs` warns about, "how a full disk used
   to look like a successful write". Writes now report through an `onError`
   hook. The test was checked by reverting the fix and watching it go red.

**One deliberate behaviour change:** `kill_pty` no longer unregisters the pane
route. The exit path owns teardown, so the `pty:exit` following a kill still
reaches its owner instead of being dropped as "no route for pane".

**Not done:** the updater (Gate A), Windows (Gate C), cross-window drag,
packaging, and the full manual pass. Nothing here ships, and the Tauri build
remains what users run.

## Browser panel + Inspect — 2026-08-12

Electron only, on `electron-migration`. A docked column on the right of the
stage loads a dev server; Inspect turns any element on that page into
component-and-source context that lands in the focused agent pane.

### What it is made of

| Piece                                    | Where                                                                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Native web view, one per window          | [`electron/browser/view.ts`](../electron/browser/view.ts) `current`                                                                      |
| Injected bootstrap (pure string builder) | [`electron/browser/inject.ts`](../electron/browser/inject.ts) `current`                                                                  |
| Address-bar input rules                  | [`electron/browser/url.ts`](../electron/browser/url.ts) `current`                                                                        |
| Page → host bridge                       | [`electron/browser-preload.ts`](../electron/browser-preload.ts) `current`                                                                |
| Vendored react-grab 0.1.50               | [`electron/vendor/react-grab/`](../electron/vendor/react-grab/SOURCE.md) `current`                                                       |
| Panel chrome + measured hole             | [`src/browser/browser-panel.tsx`](../src/browser/browser-panel.tsx) `current`                                                            |
| Grab delivery + sanitising               | [`src/browser/browser-store.ts`](../src/browser/browser-store.ts) `current`, [`grab-format.ts`](../src/browser/grab-format.ts) `current` |

### The three facts that shape all of it

1. **The web content is a native view, not an element.** It paints above every
   DOM layer, so the renderer measures `.browser-panel__view` and sends the
   rectangle, and hides the view whenever an overlay opens. CSS cannot put the
   Open board in front of it.
2. **The injection has to run in the page's MAIN world.** React stores its
   fiber as an expando on the DOM node and expandos are per-world; from the
   preload's isolated world every element is plain HTML with no component and
   no source location. So the bundle goes in through `executeJavaScript`, and
   the grab comes back out through a DOM `CustomEvent` the preload forwards —
   the only channel two worlds share.
3. **The page is untrusted.** It can dispatch the grab event itself with any
   payload. Hence: parsed defensively, length-capped, every C0 control
   stripped (an embedded `ESC[201~` would break out of the bracketed paste and
   be read as keystrokes), and **never submitted** — a grab pastes and stops.

### Verified on a real window (2026-08-12)

`npm run electron:smoke` gained six checks and they pass: the panel attaches a
view and loads a page; `__deckGrab`, `__REACT_GRAB__` and
`__REACT_GRAB_MODULE__` all exist in the page's main world; a grab crosses
page → preload → IPC → renderer intact; Inspect arms react-grab in the page;
**no request reaches react-grab.com**; closing the panel destroys the page.
22/24 overall — the two failures are the Linux container (`platform=unsupported`,
cwd with no shell integration) and predate this work.

Two defects that run found and the mocked suite could not:

- `window.__REACT_GRAB__` was never set. Disabling the bundle's self-init also
  skips the `setGlobalApi` call inside it, so react-grab's documented handle was
  missing while everything else looked healthy.
- `generateSnippet` can fail to settle in a throttled frame. `getContent` sits
  between ⌘C and BOTH destinations, so an unsettled promise means no paste and
  no clipboard with nothing on screen; it now races a 2 s deadline and falls
  back to the element's markup.

### What the code review changed (2026-08-12)

15 findings, 14 real, all fixed in the follow-up commit. The ones that changed
behaviour rather than wording:

| Was                                                                     | Is                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Any page could dispatch the grab event; no gesture check, no rate limit | The preload gates on `isTrusted` — a bit page script cannot set — within 3 s, and both preload and host rate-limit                |
| `sanitizeGrabText` stripped C0 and DEL                                  | It strips C1 too; `U+009B 201~` is the same bracketed-paste escape without an ESC                                                 |
| The view hid only for `overlayCoversPane()`                             | It hides for every floating surface; the Prompt Board popover opened inside the panel's own column and was invisible              |
| The toggle destroyed the page                                           | It hides it, which is what "reopening keeps the page" always claimed                                                              |
| Grabs were sent from `getContent`                                       | They are sent from `onCopySuccess` / `onAfterCopy`, after the bundle's abort race has decided — a cancelled copy no longer pastes |
| `browserHomeUrl` had no UI                                              | Settings has a **browser** category                                                                                               |
| The `.js → .cjs` walk swept the vendored bundle                         | `vendor/` is skipped, and the output dir is cleared before the copy                                                               |

One finding did not survive verification: closing a window was said to throw
out of the cleanup path and strand PTYs. A probe on Electron 43 showed
`webContents.close()` on an already-destroyed contents is a no-op, so it became
a guard rather than a fix.

Two traps found while fixing, both now locked by tests:

- An escape written `\n` inside `inject.ts`'s template literal is consumed by
  TypeScript and emits a real newline into the generated script. The injection
  was a SyntaxError and Inspect was dead on every page while every `toContain`
  assertion passed. The test now runs `new Function(script)`.
- A synthesised DOM event can never exercise the new gate — `isTrusted` is
  false, and `executeJavaScript(..., true)` marks user activation, not trust.
  Only `sendInputEvent` into a focused view produces a trusted event, which is
  how the smoke run now drives a real copy.

Smoke is 24/26: a forged grab is dropped, a real `copyElement` reaches the
renderer, and the two failures are the same pre-existing Linux ones.

### Not verified

- **A real React dev server.** Component names and `file:line` come from
  react-grab reading React's fiber; no React app was available in this
  environment. The transport is proven end to end, the richness of what it
  carries is upstream behaviour.
- **Windows.** Same Gate C hole as the rest of the branch.
- **The panel under a real compositor** — resize, drag-to-width, and the
  hide-on-overlay path were exercised by unit tests and by the smoke run's
  bounds call, not by a human dragging the seam.

## File explorer — model merged, surface dropped — 2026-08-12

Electron branch only; nothing here ships on Tauri. Built against the
[plan](plans/2026-08-12-file-explorer.md) `partly-built` task by task, from the
[spec](specs/2026-08-12-file-explorer-design.md) `decided` — 34 of 36 tasks
done — and then **split in half before merge**. Read the plan's §8 before
touching any of it.

~~**THE FEATURE IS NOT USABLE.** There is no way to open a file in Deck.~~
**Superseded 2026-08-14: the surface was built on top of this model and host —
see the straight-through completion run below.** The
machinery merged and the chrome did not, at the time this section was written.
That was a decision, not a shortfall:
the owner is redesigning the Electron version completely, and while this was
being written `electron-migration` took DESIGN LANGUAGE §18 for the application
frame, wrote a **§19 "Docked side panels" for a browser panel that reserves
itself for the file explorer**, docked that panel as a STAGE column rather than
a `.window` grid column, and collapsed the chrome frame. (Those sections were
first numbered §16/§17 and moved up two on 2026-08-12 to dodge a cross-branch
collision; the numbers here were rewritten to match on 2026-08-14 — the exact
stale-citation class the redesign plan's §3.5 warns about, in a file the
citation gate never scans.) Merging a second docked-panel convention into a
frame about to be redrawn would have meant paying for the surface twice.

**What merged.**

- **Pure model** (`src/files/`) — the tree, the preview-slot promotion rules,
  the §5 external-change table, the dirty model, encoding/EOL, and the path
  bound. None of it knows what renders the text, so it survives an
  editor-engine change intact.
- **Host** (`electron/fs/`) — `list_dir`, `read_file`, `write_file`,
  `stat_files`, `watch_paths` and `set_dirty_files`, every one bounded to the
  workspace root by `path-guard.ts`. Registered in main; no renderer calls them
  yet. `writeAtomically` moved out of `JsonStore` into `fs/write.ts` and the
  store now calls it — one atomic writer, not two, with the store's existing
  205 lines of tests as the regression gate on the extraction. **This half is a
  security fix on its own**: the target branch still writes settings through a
  fixed-name `.settings.json.tmp` and a symlink-following `fs.writeFile`.
- **The dirty bridge across all four exits** (below).
- **An inert `SurfaceStrip` seam** in `TabManager`, whose only implementation is
  `INERT_SURFACES`. Nothing in production passes a real one. It stays because
  the invariants it encodes — "last surface, not last tab", the combined cycle
  index space, `movePane`'s refusal, the `applySettings`/`focusActive` fan-out —
  are expensive to retrofit and cheap to keep proven.

**What was dropped.** The docked panel, the virtualized tree, the file tabs in
both chrome layouts, DESIGN LANGUAGE §16, the explorer CSS and settings, and the
`toggle-explorer` / `save-file` actions. `file-editor.tsx` and
`external-change-bar.tsx` stay in the tree unmounted — they are not chrome, they
carry the Monaco lifecycle knowledge the redesign would otherwise rediscover
(the `ready` dep, the `applying` re-entry flag, `pushEditOperations` over
`setValue`, view-state pairing).

**The exits all changed together**, because any five of the six parts is a hole,
and this half merged whole. `app.on("before-quit")` returned early on an empty
pane list, so a window holding only file tabs would quit with unsaved edits and
no prompt; the census now carries `dirtyFiles`, `closeRequestOrNull` was widened
to keep the field, and the renderer's `busyPanes === 0` auto-confirm became
"empty in both dimensions". Installing an update is a **fourth** exit the spec's
three did not count — `app_relaunch` calls `app.exit(0)` and never reaches
`before-quit` — so `confirmInstall` passes `dirtyPaths()` itself. `confirmMessage`
names a busy agent and unsaved files in ONE dialog. Window death clears that
window's dirty entries beside the pane routes. With no surface the list is
always empty, so `close-guard.test.ts` now covers that half directly: it is the
only proof left that an unsaved file survives an exit.

**Monaco is a declared dependency that nothing reachable imports.** The build
therefore emits no `editor.api` chunk and the entry is 178.83 kB gzip, +0.49 kB
over the 178.34 kB baseline. The measurements taken while the surface existed —
entry 189.26 kB, a lazy 674.50 kB gzip `editor.api`, 27 per-language tokenizer
chunks, two worker chunks, no language services — are recorded in the plan's
§6.2 as what the surface cost, and must be re-taken when the redesign mounts it.

**Two defects the new tests caught.** Saving through an existing symlink that
pointed OUT of the workspace was allowed, because the link's parent was inside
the root and the guard fell through to its "new file" branch — a real escape,
now refused by an `lstat` check. And the first file tab got an editor with no
model, because Monaco's dynamic import resolves after the model effect has
already run and nothing re-ran it.

**NOT verified — everything needing a real window.** Gate M has not been run and
now has no subject: it was already blocked on MVP T19 producing a packaged
build, and nothing imports Monaco any more. The thirteen-item manual pass has
not been run at all; every `manual (owner)` line in the plan is outstanding.
`npm test` (1717 passing on the merged half), `npm run build`,
`npm run electron:build`, `generate:menu:check` and the Electron IPC contract
test are green, and none of them opens a window. The plan's §7.2 follow-ups
mostly went away WITH the surface — unreachable, not fixed — but three merged
because they live in the host layer: `realpathSync` runs synchronously per entry
on the main thread, and `stat_files` / `watch_paths` take unbounded arrays.

## Redesign phase 2 — the chrome transfusion — 2026-08-14

The gallery-proven direction reached the app.
[Plan](plans/2026-08-13-redesign-phases-2-5.md) `current`,
[shipping addendum](specs/2026-08-13-direction-token-rebuild-design.md) `decided`
(its §9), DL §20/§21 written, decisions D1–D12 owner-approved as written.

**What landed, in ten steps plus the mirrors.** The token layer (`--radius-control`
/ `--radius-surface`, `--duration`/`--ease`, `--state-hover-bg`); the shell —
`.deck-frame` is the head of the navigation column and the stage reaches the
window's top edge (DL-18.3 rewritten, rail 275px to keep a draggable titlebar);
navigation, atoms, settings shell, Open board, popovers and imperative surfaces
swept onto the tokens, closing four DL §10 ledger rows; the browser panel and
`src/files/ui` took the motion-pair residue; both hosts' pre-paint grounds now
match `--bg`'s `#16161e` (the Electron value was the gallery's `#101014`); and the
marketing mirrors were re-shaped by hand to the new shell — they import nothing
from `src/`, so the next chrome change owes them another manual pass.

**This is a cross-host visual change (D9).** `src/styles.css` is shared; Tauri
ships it. Nothing here may be labelled Electron-only.

**Evidence obtained.** All automated gates green at every step (`npm test` 160
files / 1975 tests, `build`, `generate:menu:check`, `electron:build`). Native
macOS Electron screenshots exist for steps 1–3 (frame 275×34 at origin, stage
from `y=0`, state matrix across four themes × five states). A Linux Electron
pass (xvfb, cloud session, 2026-08-14) exercised the real app end-to-end: the
smoke suite 24/27 (the three failures are Linux-environment PTY/platform
artifacts, not chrome), a real workspace opened over a live PTY with the
redesigned shell, and the browser panel's `WebContentsView` hole measured
**pixel-exact** against its DOM rect ({680, 35, 420×657} on both sides of the
IPC). Rendered stills of the marketing film and a headless capture of the built
landing show the mirrored shell.

**Still owed, named honestly.** The owner's eye review of every step (DL §9.6);
the `css-audit` re-read with the owner; a native macOS pass over steps 4–10; any
Tauri run at all — `styles.css` is shared, so that gap is real; the top-tab
layout render; Windows anything; light themes (all four presets are dark; a
light `--bg` via overrides is a named limit, not a claim).

## Redesign phases 3–5 — toolbar, Gate M path, usage port — 2026-08-14

The same program, continued to the edge of what a Linux cloud session can
verify. [Plan §0.8](plans/2026-08-13-redesign-phases-2-5.md) `current` is the
detailed record; the durable facts:

**Feature toolbar shipped (phase 3).** `DeckToolbar` projects registry actions
into the gallery-proven `FeatureToolbar`; `App` builds one element and both
layouts mount it, so the mounts cannot drift. `ChromeActions` is retired (its
gallery specimens render the shipping projection now). Browser is docked by
contract — [productization spec](specs/2026-08-13-browser-productization-design.md)
`decided`, amending the toolbar spec's main-surface sentence — and Usage joined
the tools group when its surface landed. DL §23 governs the tooltip and the
overflow menu; the menu got roving arrow-key focus, and the two remaining
toolbar gaps are accepted inside DL-23.4/23.7 with reasons.

**Gate M has a complete path~~ and no run~~ (phase 4).** `electron-builder.gate-m.yml`
(unsigned, local, `--dir --publish never` — D10), the `gate-m.html` harness
mounting the real `FileEditor` + one real xterm over the real hosts, and
`scripts/verify-electron-gate-m-package.mjs`, which checks the packaged
structure with a dependency-free asar reader and then drives typed focus
markers, tokenization, save-to-disk and `file://` asset health over CDP. The
harness ran end-to-end UNPACKAGED on Linux (tokenized Monaco, markers routed by
focus, save byte-exact, the dirty guard blocking a graceful close). ~~Gate M
itself requires the verification Mac, and no explorer surface exists or may be
written before it passes.~~ **Superseded 2026-08-14: Gate M ran packaged on the
verification Mac, PASS 6/6, and the explorer surface was built after it passed —
see the straight-through completion run below.**

**The usage dashboard is landed and ported (phase 5).** The branch merged over
`main` as a true merge; DL gained its §15/§16 in the reserved slots,
era-corrected against §20/§21. The ~3,700-line Rust backend now has a
module-for-module TypeScript port in `electron/usage/` — reader, discovery,
both parsers, atomic versioned cache (independent version space; cutover is a
clean install), single-flight scan yielding between bounded batches — behind
`usage_snapshot` on the bridge facade, with the renderer's direct Tauri import
gone. The parity gate is the load-bearing piece: a redacted JSONL fixture
corpus is checked in with a golden snapshot produced by the RUST scanner
itself, and `electron/usage/parity.test.ts` deep-equals the port against it,
cold and warm. An xvfb run rendered the dashboard over this machine's real
Claude transcripts through the real IPC path. ~~The §6.1.8 owner-machine
acceptance table has still never been run.~~ **Superseded 2026-08-14: it ran
on this machine's real corpus — see the straight-through completion run
below.**

**Browser restore (phase 5 §6.2).** `browserLastUrl` persists committed
main-frame navigations (a dedicated `browser:navigated` event — hash changes
deliberately excluded) and the toggle's cold open restores it, proven live
against a real HTTP server across a hard kill. The compositor manual pass and
a real-React Inspect check stay owed, as does everything native.

## Straight-through completion run — explorer surface, board redesign, usage acceptance — 2026-08-14

Executed from the
[straight-through completion plan](plans/2026-08-14-straight-through-completion.md)
`current`, 17 tasks run in parallel tracks on `main` with no new branch (owner's
global no-auto-branch rule). Full per-task evidence, screenshots and raw command
output live in
[the evidence record](review/2026-08-14-straight-through-evidence.md) `current`;
this section is the durable summary.

**Gate M passed packaged, on the owner's verification Mac.** All 6 checks PASS:
file opens in the packaged Monaco, syntax tokenization proves the packaged
`editor.worker` chunk loaded, a keystroke mutates the focused document, save
reaches disk, no `file://` asset 404s inside DevTools, and focus moves between
Monaco and xterm without either capturing the other's keystrokes
([verifier](../scripts/verify-electron-gate-m-package.mjs) `current`,
[gate-m harness](../gate-m.html) `current`). "Edit marks dirty" is evidenced as
content mutation, not a visible dirty-badge assertion — the harness page has no
dirty indicator to assert on. Adding a Content-Security-Policy later
invalidates this run and requires a rerun.

**The file explorer surface is built**, gated behind that Gate M pass as the
spec required: the docked panel, the virtualized tree at 22px row height with
monochrome icons, file tabs rendered as chips in both the sidebar and top-tab
toolbar layouts, the `toggle-explorer` (⌘⇧B) and `save-file` (⌘S) actions with
a regenerated menu, a focus guard so pane shortcuts no longer fire while a file
surface holds focus, document lifecycle fixes (an evicted preview document is
now disposed; `closeWorkspaceSurface`/`closeWorkspace` now exist and are wired
to a real caller), and `fs:changed` events driving a targeted tree refresh
instead of a full reload
([`createFileSurfaceController`](../src/files/file-surface-controller.ts#L115) `current`,
[`explorer-panel.tsx`](../src/files/ui/explorer-panel.tsx) `current`,
[`file-tree-view.tsx`](../src/files/ui/file-tree-view.tsx) `current`,
[`SurfaceStrip`](../src/terminal/tab-manager.ts#L278-L322) `current` — no
longer inert; a real strip is passed in). Electron only; no Tauri
implementation exists. **Pending: the owner's eye review of every rendered
change (DL §9.6) and a native macOS sign-off** — automated gates cannot
establish this, per this repo's own known-traps section in `AGENTS.md`.

**STOP #2 (10k-entry filesystem stall) cleared.** `listDir`'s per-symlink
`fs.realpathSync` was serial and blocking; a bounded async pool
(`MAX_REALPATH_CONCURRENCY = 32`) now resolves symlinked entries concurrently
without reordering the result
([`electron/fs/read.ts`](../electron/fs/read.ts) `current`). Measured on a
quiet machine, two 10k-entry fixtures (mixed symlinks; and the worst case,
every entry escaping the root), 10 reps each, two independent runs: max
sampled event-loop stall 13–16 ms, well under the 100 ms threshold that would
have forced a redesign.

**STOP #3 (bundle size) judged within expectation, not a blowout.** Entry
bundle gzip is 201.90 kB against a previously recorded 189.26 kB baseline —
+12.64 kB, explained by six further explorer commits landing on top of the
commit that baseline was measured at (file-tab chips, the worktree flow,
`fs:changed` refresh, the toggle-explorer/save-file actions, tree windowing,
the focus-guard fix). The lazy `editor.api` chunk is byte-identical at
674.50 kB gzip, proving no Monaco byte leaked into the eager entry and no new
eager Monaco chunk appeared.

**All four close/quit exits driven against the real production code path**,
intercepting `dialog.showMessageBox` rather than reading pixels (no Screen
Recording permission in this environment). A structural finding, verified
rather than assumed: **tab-level close guards never aggregate busy + dirty
into one dialog, by design** — only window-close and app-quit do that,
because a file tab's prompt should not accuse an unrelated terminal tab of
being busy
([`close-coordinator.ts`](../src/terminal/close-coordinator.ts) `current`,
[`close-guard.ts`](../src/terminal/close-guard.ts) `current`). Window-close and
quit both proved the combined message ("X is still running, and Y has unsaved
changes"), both proved settings flush before teardown by direct file mtime
comparison, and both survived repeated Cancel without silently clearing either
cause. The fourth exit, Install & Relaunch, needs a signed updater build and
stays blocked on Gate A.

**Usage §6.1.8 owner-machine acceptance ran on this machine's real
`~/.claude`/`~/.codex` corpus** — all 7 rows pass. An independent
hand-reimplemented oracle matched the real scanner exactly on 6 sampled files
(3 Claude, 3 Codex, including one subagent and one archived file). Cold scan:
5.76 s / ≈627.5 MiB peak RSS; warm scan (cache reload, unchanged corpus):
60.5 ms / ≈85.4 MiB — ≈95× faster, ≈7.4× lower peak RSS. A byte-level
instrumentation proof showed zero bytes read from any of 2050 unchanged files
on a warm poll. Missing/unreadable/stale corpus states all classify correctly.
The dashboard stayed interactive through a live cold scan (nav clicks
answered immediately while the header still read "reading this machine's
recorded history…"); a supplementary event-loop-lag measurement peaked at
106–120 ms during the scan's per-batch yields — noticeable but not a freeze,
and not the same 100 ms gate as STOP #2's `listDir` threshold.

**Major finding, not fixed — flagged for a follow-up task.**
[`discoverClaude`](../electron/usage/discover.ts#L197-L217) `current` walks
only one level into each session's `subagents/` directory. On this machine,
470 of 1906 total Claude `.jsonl` files (~25% of the corpus) live one level
deeper, at `<session>/subagents/workflows/<id>/*.jsonl`, and are silently
invisible to every count and total the Usage dashboard shows. Real,
reproducible, confirmed independently of the parity fixture (which never
exercised this depth) — the real-corpus run is what caught it, not the
fixture. Windows corpus behaviour is unverified (Gate C); everything above
ran on macOS only.

**Browser panel: compositor pass and a real-dev-server Inspect round trip.**
Resize (via an emulated viewport, no OS-level resize available in this
sandbox), drag-to-width (via the real `startResize` pointer-capture handler)
and hide-under-overlay (the panel's `WebContentsView` survives a Settings
open/close cycle without being destroyed, consistent with a visibility toggle
rather than teardown) are evidenced by DOM state and code citation, not a
native pixel overlay proof — that needs Screen Recording permission this
sandbox does not have
([`browser-panel.tsx`](../src/browser/browser-panel.tsx#L104-L165) `current`).
Inspect was driven end to end against this repo's own real Vite dev server:
react-grab's overlay highlighted a real element, a grab crossed
page → preload → IPC → renderer, and the formatted payload landed in the
focused pane's PTY. The panel's root now carries an explicit "Electron only"
tooltip and accessible name
([`browser-panel.tsx`](../src/browser/browser-panel.tsx) `current`). Both
toolbar layouts were captured with real content, closing a standing plan gap —
top-tab mode had never been rendered before this run.

**First `npm run tauri dev` run of this entire program.** Cargo built clean,
the native binary launched, and it loaded the same shared `styles.css` and
Vite dev server Electron uses. No CDP or screen-capture path exists for
WKWebView in this sandbox, so this is process/network proof only, named
honestly as such: the dev binary's dedicated `com.apple.WebKit.Networking` XPC
helper process held an ESTABLISHED TCP connection to `localhost:1420` with
real bytes exchanged. No pixel or interaction evidence for the redesigned
chrome under Tauri exists; that remains a real, open gap — `src/styles.css` is
shared, so the visual claim is untested on the host most users actually run.

**The open board was redesigned to one center surface with three views**
(home / config / worktree) and the board's own second sidebar (`.rail`) was
removed — the app's own `WorkspaceSidebar` is the one sidebar now
([`open-board.tsx`](../src/open-board/open-board.tsx) `current`,
[`open-board-home.tsx`](../src/open-board/open-board-home.tsx) `current`).
Home is mouse-only: centered mark, "Open project" (⌘O), a "Create worktree"
button, and the grouped Recent list; a single click on a recent switches to
config (Layout + Agent + Open, unchanged content, now with a Back control); a
double click opens immediately with the remembered combo. Contract invariant:
home ⟺ nothing picked. Known, disclosed gap: the home view has no footer, so a
mouse-only user with `canCancel: true` has no visible dismiss control there
besides Esc — flagged for the owner, not patched, because the locked contract
specified no footer on home.

**Create-worktree is an Electron-only flow reached from the open board's home
view**, gated behind `worktree-host`'s `available` (a `window.__deckHost`
presence check — every `src/host/*` facade in this repo is already
Electron-only, so this is the same three-way truth table the rest of the host
layer already uses)
([`worktree-host.ts`](../src/host/worktree-host.ts) `current`). `git worktree
add` runs main-process side via `execFile` with an argv array, never a shell
string; raw git error text never crosses IPC — only one of five closed error
codes does
([`electron/git/worktree.ts`](../electron/git/worktree.ts) `current`). The new
`worktree_add` IPC channel keeps the flat payload contract, pinned by both the
generic scanner and an explicit fixture in
[the IPC contract test](../scripts/electron-ipc-contract.test.ts) `current`.
Driven end to end in a real Electron host against a throwaway git repo: a real
`git worktree add` ran, the board handed off straight to the config view with
the new path selected, and a real `branch-exists` failure surfaced as friendly
copy with git's own error text staying out of the renderer. Windows is
unverified (Gate C); the destination-path builder is POSIX-only.

**Still owed, named honestly** (the deferred register this plan closes on):
the owner's eye review of every rendered change against the captured evidence
(DL §9.6); the `css-audit` re-read with the owner; native macOS sign-off for
phase 2 steps 4–10, both toolbar layouts, the explorer surface and the
redesigned open board; a Tauri-run sign-off; Install & Relaunch (Gate A);
every Windows claim across this whole run (Gate C); a Gate M rerun if a CSP is
ever added or the owner designates a different verification Mac; and the
browser productization spec's owed owner read.

## The stage tab strip, and the document off the panel — 2026-08-14

The explorer surface shipped with the editor parked in a `__preview` block at
the bottom of `ExplorerPanel` — the minimum slice that proved click-a-row →
document → edit end to end, and its own file comment said so. Spec §4.2 always
put the document **on the stage**; that half was never wired. Sidebar layout
compounded it: file tabs were nested rows in `RepositoryRail`, so the user's
open documents lived in a left column while the thing they opened rendered in
the bottom-right corner of a right column.

Both are closed now, on one shape the owner picked from three:

- **The chips moved out of the frame and into their own component.**
  [`TabStrip`](../src/ui/tab-strip.tsx) `current` holds the terminal segment,
  the separator, the file segment, the add button and the rename/colour
  popover; [`TabBar`](../src/ui/tab-bar.tsx) `current` is now only top-tab
  mode's frame around it (lights, strip, spacer, toolbar). No coordination
  moved with it — same six callbacks, same `FileSurfaceController` calls, so
  R4's seams were untouched and `tab-bar.test.tsx` passed unedited, which is
  the evidence the extraction was presentational.
- **Sidebar mode mounts the same strip on the stage**, as `.stage__strip`, in
  the half of the frame row that column 2 owns and that used to be empty. That
  is a new DL rule, [DL-18.6](DESIGN-LANGUAGE.md) `current`, plus an amendment
  to DL-18.3: the sidebar frame row now has **two** occupants split by the
  shell's vertical seam, not one. It adds an occupant, not a row — DL-18.1's
  count is what that rule was ever about.
- **The document renders on the stage** as `.stage__surface`, laid **over**
  `.stage__tabs` rather than replacing it, so the terminal grid keeps its
  measured size and taking the stage back costs no xterm reflow and no PTY
  resize round-trip. The mount condition **did** change, and for the better:
  the old preview block inherited `ExplorerPanel`'s `explorerOpen` gate, so its
  real condition was `explorerOpen && activeFileTab !== null` and ⌘⇧B disposed
  the open document along with the tree. It is `activeFileTab !== null` alone
  now — an open document is not part of the file tree. The condition lives in
  [`StageSurface`](../src/files/ui/stage-surface.tsx) `current` rather than
  inline in `App`, because `App` has no render harness here and anything
  written inline in it is unassertable. (The first draft of this section
  claimed the condition was unchanged; both reviewers caught it.)
- **The rail no longer lists documents at all.** Not moved — removed, with the
  "last surface, not last tab" fallback group and the `wsitem--file` styling.
  A rail row says which repository and worktree a session is in; the strip says
  what is open. Chosen by the owner over keeping both.

`ExplorerPanel` is the tree and nothing else now
([explorer-panel.tsx](../src/files/ui/explorer-panel.tsx) `current`).

**The co-mount class of bug, and the two rounds it took to actually close.**
Sidebar layout mounts the rail and the strip **together** — the first time two
tab surfaces have ever been alive at once. Both reach for module-level state
written on the assumption that only one of them exists.

Round one caught the visible half: `requestTabOptionsKey` (⌘⇧R) had two
listeners, so one keystroke opened two popovers. That was patched by giving the
chord to one surface.

Round two came out of the review, and it was the half that mattered.
`tabPopoverOpen` — the flag that hides the browser panel's native
`WebContentsView`, because a native view wins over every DOM layer no matter
the z-index — was a plain boolean that each surface assigned as
`open = mine !== null`. With both mounted, dismissing either popover cleared it
while the other was still up, and the native view came back **over a live
popover**: the same failure the Prompt Board case already cost this repo once.
The chord also went to the **rail** rather than the strip on review — the
rail's row is what the user is looking at in that layout, and its popover is
the only one carrying the workspace-logo actions, which the first fix had
silently dropped from the keyboard path.

Round three answered the question the fix left open: two popovers floating at
once was still reachable (right-click a rail row, then click a strip chip), and
the owner chose to forbid it rather than live with it. The shared state is now
**one slot**, not a set — `openTabPopover` / `closeTabPopover` /
`tabPopoverOwner` in [`events.ts`](../src/chrome/events.ts) `current` — so
claiming it IS how a surface tells the others to stand down. Two rules carry
the whole contract, and both are in one hook
([`useTabPopoverSlot`](../src/ui/tab-popover-slot.ts) `current`) so three
surfaces cannot drift into three answers: **a surface may only retract its own
claim** (the loser standing down must not report "nothing is open" while the
winner is on screen), and **an empty slot is not somebody else's** (or an
effect ordering would close the popover the same click just opened).

Every test in the repo mounted these components **alone**, which is why nothing
caught any of it. `repository-rail.test.tsx` now renders the sidebar layout the
way `App` assembles it, and each guard was confirmed by removing it and
watching the test fail: last-write-wins for the flag, then the stand-down
effect, then the ownership check in `closeTabPopover`.

**Evidence.** `npm test` 2391 passed / 196 files; `npm run build` clean;
`npm run generate:menu:check` clean; `npx tsc --noEmit` clean.
`scripts/design-language.test.ts` caught the DL-18.6 citations before the rule
was written, which is the ledger gate working. Shell geometry was eyeballed in
the **browser** preview (`npm run dev`, chips and documents injected through
the real stores) — that proves the row placement, the panel insets and the
document rectangle, and it proves nothing native. **Owed: a real
`npm run electron:dev` look, the owner's eye review (DL §9.6), and native macOS
sign-off.** The shape the explorer's Gate M pass covered has changed, so that
run's 6/6 does not carry over to this surface; plan T35 (packaged manual pass,
both layouts) was already unchecked and now covers a different picture.
Electron-only for the explorer half; the strip and the stage surface are shared
renderer code, so Tauri behaviour is unverified.

## AgentQuickPicker — the tab strip fast path — 2026-08-14

The tab strip's `+` button (`TabStrip`'s `.tab-add`, ⌘T) used to raise the Open
board's full workspace ∥ preset ∥ agent flow via `newTab()`
(`tab-manager.ts`). It now raises a lighter modal instead:
[`AgentQuickPicker`](../src/ui/agent-quick-picker.tsx) `current`, a
`.modal-scrim` genre alongside `PresetEditor`/`SavePresetDialog` — same
`agentQuickPickerOpen` signal, same "modal" tier in `openOverlayRanks()`
([`chrome/events.ts`](../src/chrome/events.ts) `current`,
[`tab-manager.ts`](../src/terminal/tab-manager.ts) `current`). Picking a chip
(click or digit key `1-9`/`0`) calls
[`TabManager.openQuickAgent`](../src/terminal/tab-manager.ts) `current`, which
materializes a single pane in the active tab's **live** cwd — a fresh
`pty_info` read of the focused pane, not the tab's static `workspacePath` —
carrying the active tab's workspace tag, with no workspace/preset step. A
window with no tabs yet falls back to `$HOME`, same as a bare pre-cutover
`newTab()` did.

The Open board's full flow (new workspace, worktree, layout preset) did not go
away; its entry point moved to the sidebar. `RepositoryRail`'s "Open
workspace" footer row (`onOpenWorkspace` prop, renamed from `onNewTab`) now
sets `boardOpen` directly instead of sharing the tab strip's `+`/⌘T action.
`WorkspaceSidebar` got the identical rename — dead code today, but the two are
deliberately kept prop-identical for the one-line revert
[`repository-rail.tsx`](../src/ui/repository-rail.tsx) `current` describes.

`new-tab`'s action scope stays `"board"`
([`action-registry.ts`](../src/terminal/action-registry.ts) `current`),
unchanged: the F2 reasoning that keeps ⌘T blocked while a modal-tier draft is
open (mount-focus stealing) holds just as well now that the action's own
target is a modal-tier overlay rather than the board.

**Evidence.** `npm test` 2423 passed / 199 files (the one failure,
`file-tree-view.test.tsx`'s 10,000-row windowing timeout, reproduces on an
unmodified tree — pre-existing, unrelated); `npm run build` clean; `npm run
generate:menu:check` clean. The component's visual design was built and
eye-approved against a screenshot via a real-component gallery specimen
(`overlays-section.tsx` `current`) before being wired into the app. **Owed:** a
native `npm run electron:dev` click-through and the owner's eye review of the
wired flow (not just the gallery specimen) — this session had no display to
drive a native Electron window.

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
