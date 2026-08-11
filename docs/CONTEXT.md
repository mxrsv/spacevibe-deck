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

| Piece | Where |
| ----- | ----- |
| Native web view, one per window | [`electron/browser/view.ts`](../electron/browser/view.ts) `current` |
| Injected bootstrap (pure string builder) | [`electron/browser/inject.ts`](../electron/browser/inject.ts) `current` |
| Address-bar input rules | [`electron/browser/url.ts`](../electron/browser/url.ts) `current` |
| Page → host bridge | [`electron/browser-preload.ts`](../electron/browser-preload.ts) `current` |
| Vendored react-grab 0.1.50 | [`electron/vendor/react-grab/`](../electron/vendor/react-grab/SOURCE.md) `current` |
| Panel chrome + measured hole | [`src/browser/browser-panel.tsx`](../src/browser/browser-panel.tsx) `current` |
| Grab delivery + sanitising | [`src/browser/browser-store.ts`](../src/browser/browser-store.ts) `current`, [`grab-format.ts`](../src/browser/grab-format.ts) `current` |

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

### Not verified

- **A real React dev server.** Component names and `file:line` come from
  react-grab reading React's fiber; no React app was available in this
  environment. The transport is proven end to end, the richness of what it
  carries is upstream behaviour.
- **Windows.** Same Gate C hole as the rest of the branch.
- **The panel under a real compositor** — resize, drag-to-width, and the
  hide-on-overlay path were exercised by unit tests and by the smoke run's
  bounds call, not by a human dragging the seam.

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
