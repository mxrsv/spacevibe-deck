> Generated from `~/.claude/templates/ARCHITECTURE.template.md` — LIVING doc, update in place (D1).

# SpaceVibe Deck — architecture

A desktop terminal (Tauri 2) for running many AI agent CLIs side by side:
Rust owns PTYs and native platform integration; a Preact + xterm.js frontend
renders panes, tabs and the workspace board. macOS is the current public
release; Windows 11 x64 is an engineering preview whose runtime gates remain
open ([macOS release workflow](../.github/workflows/release.yml) `current`,
[Windows spec](specs/2026-07-29-windows-desktop-design.md#10-verification-and-acceptance) `decided`).

## Modules and boundaries

| Module                                                                                                                        | Responsibility                                                           | In            | Out           |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- | ------------- |
| [src-tauri/src/pty.rs](../src-tauri/src/pty.rs) `current`                                                                     | PTY spawn/IO for agent CLIs                                              | commands      | shell procs   |
| [src-tauri/src/coordinator.rs](../src-tauri/src/coordinator.rs) `current`                                                     | window/pane coordination (load-bearing seam)                             | frontend      | windows       |
| [src-tauri/src/menu.rs](../src-tauri/src/menu.rs) `current` + [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current` | native menu — generated, edit the registry                               | build script  | macOS menu    |
| [src-tauri/src/migrate.rs](../src-tauri/src/migrate.rs) `current`                                                             | settings carry-over from the Stackgrid bundle id                         | first launch  | app dirs      |
| [src-tauri/src/platform/](../src-tauri/src/platform) `current`                                                                | platform shell, home, discovery and process lifecycle                    | PTY state     | OS APIs       |
| [src-tauri/src/info.rs](../src-tauri/src/info.rs#L10-L34) `current`                                                           | explicit pane CWD/process kind/agent truth                               | PTY sessions  | frontend      |
| [src-tauri/tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`                                           | native Windows chrome, WebView2 and NSIS-only bundle config              | Tauri build   | Windows app   |
| [src/terminal/](../src/terminal) `current`                                                                                    | xterm.js panes                                                           | chrome        | Tauri IPC     |
| [src/chrome/](../src/chrome) `current`                                                                                        | window chrome, tabs                                                      | main          | terminal      |
| [src/open-board/](../src/open-board) `current`                                                                                | workspace board: open, recents, workspaces store                         | chrome        | lib           |
| [src/settings/](../src/settings) `current` + [src/presets/](../src/presets) `current`                                         | settings UI/stores, layout presets                                       | chrome        | lib           |
| [src/ui/controls/deck-icon.tsx](../src/ui/controls/deck-icon.tsx) `current`                                                   | the one icon primitive — Lucide presentation defaults and the four sizes | every surface | lucide-preact |
| [src/updater/](../src/updater) `current`                                                                                      | single-flight update state, Tauri adapter and chrome action              | app           | Tauri         |
| [marketing/landing-prototype/](../marketing/landing-prototype) `current`                                                      | multi-page landing and live GitHub release changelog                     | Releases API  | dist          |
| [marketing/video/](../marketing/video) `current`                                                                              | marketing video stage — shares app components, virtual clock             | app stage     | video         |

## Main flows

1. Open a pane → frontend asks Rust to spawn a PTY ([pty.rs](../src-tauri/src/pty.rs) `current`) → output streams into an xterm.js pane ([src/terminal/](../src/terminal) `current`).
2. Window/pane lifecycle (split, move, close) goes through the coordinator ([coordinator.rs](../src-tauri/src/coordinator.rs) `current`); state lives in window-scoped Preact signal stores.
3. Workspace board ([open-board.tsx](../src/open-board/open-board.tsx) `current`) lists workspaces/recents ([workspace-recents.ts](../src/lib/workspace-recents.ts) `current`); existence checks mirror input order.
4. Chrome UI styling is governed by the numbered DL rulebook ([DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md) `current`), cited from code comments.
5. Windows shell creation prefers PowerShell 7, falls back to Windows
   PowerShell, and adds only session-local prompt/CWD integration
   ([shell.rs](../src-tauri/src/platform/windows/shell.rs#L84-L113) `current`).
6. Each Windows pane owns a kill-on-close Job Object; one WMI snapshot maps
   descendants into `idle-shell`, `agent`, `busy`, or `unknown`
   ([session ownership](../src-tauri/src/platform/windows/mod.rs#L26-L41) `current`,
   [process mapping](../src-tauri/src/info.rs#L111-L165) `current`).
7. Terminal links send structured editor intent. Windows validates canonical
   paths, parses custom templates as argv, rejects shell syntax, and launches
   the executable directly
   ([links.rs](../src-tauri/src/links.rs#L187-L314) `current`).
8. The initialized desktop environment selects the platform keymap, visible
   labels, pointer modifier, and Windows clipboard chords. The chords dispatch
   through the shared action path, not a pane-local handler
   ([platform.ts](../src/lib/platform.ts#L76-L107) `current`,
   [WINDOWS_KEYMAP](../src/terminal/action-registry.ts#L701-L784) `current`,
   [commands table](../src/terminal/tab-manager.ts#L1068-L1088) `current`,
   [Pane clipboard](../src/terminal/pane.ts#L362-L367) `current`,
   [terminal-clipboard.ts](../src/terminal/terminal-clipboard.ts#L27-L55) `current`).
9. After the tab manager exists, Deck checks the configured updater channel
   once. The macOS App menu may trigger a later manual check or open the trusted
   web changelog; download and install remain separate user actions.
   Immediately before install, `App` reuses the fresh pane close guard, flushes
   settings, then installs and relaunches
   ([App updater wiring](../src/ui/app.tsx#L182-L210) `current`,
   [update state machine](../src/updater/update-controller.ts#L82-L208) `current`,
   [update menu actions](../src/updater/update-menu-actions.ts#L62-L90) `current`).
10. The landing fetches one validated GitHub Releases list, derives stable
    macOS and preview Windows downloads from it, shows the latest stable tag,
    sums verified `.dmg` and `.exe` asset downloads into the hero proof, and
    feeds the same normalized records and their release-note bodies into the
    changelog page
    ([release-data.js](../marketing/landing-prototype/src/release-data.js#fetchPublishedReleases) `current`,
    [installer download total](../marketing/landing-prototype/src/release-data.js#totalInstallerDownloads) `current`,
    [changelog-view.js](../marketing/landing-prototype/src/changelog-view.js#renderReleaseList) `current`).

## Standing architecture decisions

- English only across strings/comments/docs — [AGENTS.md](../AGENTS.md) `current`.
- Functional icons come from `lucide-preact` through a single `DeckIcon`
  primitive, and nothing else authors an `<svg>` or presses a glyph character
  into an action's place. This is chrome's one approved runtime dependency
  (DL-1.1), bounded by a build-time gzip ceiling and a filesystem drift guard
  rather than by review attention. CSS must never set an icon's `width`,
  `height`, `stroke` or `stroke-width`: those declarations beat SVG attributes
  and would move geometry back out of the primitive
  ([DeckIcon](../src/ui/controls/deck-icon.tsx) `current`,
  [rules §14](DESIGN-LANGUAGE.md) `current`,
  [guard](../scripts/icon-system.test.ts) `current`).
- ADR pipeline removed 2026-07-27; decisions now live in dated specs/plans — [CONTEXT.md](CONTEXT.md) `current`.
- Menu is generated from a registry, never hand-edited — CI runs `generate:menu:check` — [menu_registry.rs](../src-tauri/src/menu_registry.rs) `current`.
- Overlay guard ranks overlays by z-order — `pane`(0) < `settings`(20) < `board`(30) < `modal`(40) — and blocks an action while any open overlay's rank is `>=` its own tier; `>=` (not `>`) is deliberate so two `modal`-tier overlays exclude each other with no extra concept needed — [OverlayTier/TIER_RANK](../src/terminal/action-registry.ts#L8-L37) `current`, [overlayBlocksAction](../src/terminal/tab-manager.ts#L931-L962) `current`.
- Action identity and scope are shared, but macOS and Windows keymaps are
  separate. Cocoa menu generation reads only the macOS map; the Windows map
  preserves bare Ctrl terminal controls except standard text paste:
  `Ctrl+V`, `Ctrl+Shift+V`, and physical `Shift+Insert` resolve to real
  `paste` targets in the shared `commands` table. Deck leaves `Alt+V` unbound;
  whether an active agent CLI handles it for image paste is unverified. The
  path reads clipboard text, then uses xterm's
  `Terminal.paste()` so bracketed paste and CRLF normalization apply; it does
  not support Explorer `CF_HDROP` file-list clipboard data or smart routing
  ([platform keymaps](../src/terminal/action-registry.ts#L520-L784) `current`,
  [commands table](../src/terminal/tab-manager.ts#L1068-L1088) `current`,
  [Pane clipboard](../src/terminal/pane.ts#L362-L367) `current`,
  [clipboard text boundary](../src/terminal/terminal-clipboard.ts#L45-L55) `current`,
  [menu generator](../scripts/generate-menu.ts) `current`).
- The macOS menu path can't tell an accelerator from a mouse click (Tauri's `MenuEvent` carries only an id), so only `destructive: true` actions (`close-pane`/`close-tab`/`clear-buffer`) are suppressed while a chrome text field holds the caret — every other action still runs there — [ActionDefinition.destructive](../src/terminal/action-registry.ts#L82-L115) `current`, [runAction](../src/terminal/tab-manager.ts#L1032-L1054) `current`.
- Terminal panes use xterm's official WebGL renderer so continuous block and
  box-drawing glyphs used by agent TUIs render without DOM-renderer seams. It
  is loaded only after `Terminal.open()` and disposes on initialization failure
  or WebGL context loss, preserving xterm's DOM renderer as a compatibility
  fallback ([pane.ts](../src/terminal/pane.ts) `current`).
- Windows uses native decorated system chrome; Preact renders only Deck's
  internal toolbar and omits synthetic minimize/maximize/close controls
  ([tauri.windows.conf.json](../src-tauri/tauri.windows.conf.json) `current`,
  [DesktopChrome](../src/ui/app.tsx#L48-L89) `current`).
- Pull requests compile the Windows desktop without bundling. An authorized
  manual run may build one unsigned NSIS setup and upload it for seven days,
  but the job fails before bundling unless the repository is private
  ([ci.yml](../.github/workflows/ci.yml#L65-L159) `current`). The tagged macOS
  release workflow is separate
  ([ci.yml](../.github/workflows/ci.yml#L65-L159) `current`).
- Tagged releases build updater-signed macOS stable and unsigned Windows
  preview drafts separately. Neither can publish until a validation job
  re-downloads every asset from that exact draft by API asset id and verifies
  it: the manifest signature must equal the downloaded sidecar, the digests
  must equal the build provenance, the asset set must be exactly what the
  platform descriptor names, and the payload must pass Minisign verification
  against `DECK_UPDATER_PUBLIC_KEY` — reproduced in Node rather than trusted
  from the bundler
  ([release DAG](../.github/workflows/release.yml) `current`,
  [manifest validator](../scripts/verify-updater-manifest.mjs) `current`,
  [Minisign verification](../scripts/verify-updater-manifest.mjs#verifyUpdaterSignature) `current`).
- Draft assets bind to build outputs **by digest, never by name**: tauri-action
  renames the bundle as it uploads and GitHub replaces spaces with dots, so the
  two sets never share a filename
  ([digest binding](../scripts/verify-updater-manifest.mjs#bindDraftToStagedBytes) `current`).
- The workflow accepts only exact `vX.Y.Z` or `vX.Y.Z-rc.N` source tags, so the
  `-windows-preview` and channel tags it creates cannot start another release.
  Release candidates are prereleases routed to dedicated RC channels; only a
  final release moves `windows-preview-channel`, and `releases/latest` ignores
  prereleases by construction
  ([tag and channel routing](../scripts/release-workflow.test.ts) `current`).
- Before either platform draft can build, the release workflow requires every
  active `feat`, `fix`, and `perf` commit since the prior source tag to carry an
  explicit `Release-Note: <user-facing description>` or `Release-Note: skip`
  trailer. Standard, nested, and merge-reverted commits are removed; `skip`
  suppresses the entry; and `!` or `BREAKING CHANGE:` routes the explicit
  public description into a separate breaking section. No public entry fails
  the release instead of publishing boilerplate. Stable macOS and the unsigned
  Windows preview share the same change sections; only Windows adds its
  distribution warning. A manual Windows rebuild for a pre-policy tag reuses
  that tag's reviewed stable GitHub release body, so retrying an already-shipped
  artifact does not retroactively apply the commit-trailer gate
  ([release-note generator](../scripts/generate-release-notes.mjs#generateReleaseNotes) `current`,
  [workflow gate](../scripts/release-workflow.test.ts) `current`).
- The updater plugin is pinned to a reviewed fork revision carrying upstream
  PR #3516 plus a macOS transactional bundle swap: the previous `.app` is moved
  aside and restored if the replacement or the permission fix fails, and the
  installed bundle keeps the previous root mode instead of the extraction
  directory's `0700`
  ([pin](../src-tauri/Cargo.toml) `current`).
- Runtime updater registration is compile-time gated by the operator-owned
  public key; local builds without `DECK_UPDATER_PUBLIC_KEY` keep the updater
  plugin disabled while the process plugin remains available
  ([Tauri plugin registration](../src-tauri/src/lib.rs#L28-L43) `current`).

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim | Intent | Status | Evidence |
| ----- | ------ | ------ | -------- |

| "a pane moves between windows without losing output" | `building` | (backlog) | Phase A of the pane-detach work landed 2026-08-10 with every automated gate green, but nothing that needs a real window has been exercised: no window was created, no PTY changed owner, and the lock-across-emit stall named in the plan's §0.6 is invisible to unit tests. The outstanding manual pass is listed in [CONTEXT.md](CONTEXT.md#pane-detach--phase-a-landed-2026-08-10) `building` |

| "the hardened updater installs correctly on Windows" | `building` | (backlog) | 0.11.0 shipped the `ShellExecuteW` fix without ever observing it run: the Windows end-to-end upgrade was deliberately skipped on 2026-08-05. The claim holds on macOS, where rc.1 → rc.2 upgraded for real and the installed bundle kept mode `0755`. See [AGENTS.md](../AGENTS.md) `current` for the accepted cost |

Updater claims above were re-checked on 2026-08-05 against the published
`0.11.0` bytes; the remaining `current` source/config claims were last checked
on 2026-07-29. Unpassed Windows delivery gates are tracked in
[CONTEXT.md](CONTEXT.md#windows-engineering-preview--2026-07-29) `current`.
Do not remove this section (D7).
