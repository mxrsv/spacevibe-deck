# Spec — Cross-platform auto-update

- **Date:** 2026-08-03
- **Status:** Approved 2026-08-03
- **Downstream:** [implementation plan](../plans/2026-08-03-cross-platform-auto-update.md)
- **Decision:** macOS stable + unsigned Windows preview (B2)
- **Cost boundary:** no paid Apple Developer or Authenticode certificate is added

## 1. Problem

Deck publishes downloadable installers, but an installed copy never checks for a
new version. Every user must discover a release, download it, and replace or run
the installer manually.

The update path must work on both supported desktop targets without turning the
unsigned Windows engineering preview into a supported Windows release. It must
also preserve Deck's core safety rule: an update may not silently terminate live
agent or terminal processes.

## 2. Approved outcome

1. A launched Deck app checks once, asynchronously, for a newer version.
2. macOS follows the latest stable GitHub Release.
3. Windows follows a separate, clearly labelled unsigned preview channel.
4. Deck never downloads or installs merely because the check found an update.
   It exposes a small chrome action beside Settings: `Update`, then
   `Downloading…`, then `Install & Relaunch`.
5. Download begins only when the user clicks `Update`; installation begins only
   when the user later clicks `Install & Relaunch`.
6. Immediately before installation, Deck performs the existing fresh process
   inspection and blocks on the same busy/unknown confirmation policy as Quit.
7. Accepted updates install and relaunch Deck.
8. Every update artifact is signed with the free Tauri updater key. No private
   key is committed, logged, or placed in a `.env` file.

This is application-level update signing, not operating-system publisher
identity. Windows may continue to show `Unknown publisher` or SmartScreen UI,
and the macOS bundle remains ad-hoc signed. Those limitations are intentional in
B2.

## 3. Non-goals

- Authenticode, Microsoft Store, MSIX, or a supported Windows stable release.
- Apple Developer signing, notarization, the Mac App Store, or Sparkle.
- Linux, Windows ARM64, Windows 10, beta/stable selection, or downgrade support.
- Automatic download, silent background installation, or installation without
  user consent.
- A Settings category, modal update announcement, custom progress screen, toast
  system, or design-language change.
- Publishing a release, pushing a tag, creating GitHub Secrets, or generating a
  production private key during implementation. Those remain separate operator
  actions.

## 4. Current source constraints

| Area | Current fact | Consequence |
| --- | --- | --- |
| Startup | [`main`](../../src/main.tsx) initializes platform and stores before rendering | Start the check after render; never delay first paint on network I/O |
| Platform | [`getDesktopEnvironment`](../../src/lib/platform.ts) returns `macos`, `windows`, or `unsupported` | Web preview and unsupported platforms skip updater initialization |
| Quit safety | [`confirmClose`](../../src/terminal/close-guard.ts) refreshes every pane's process state and fails closed on unknown inspection | Update installation reuses this gate with update-specific copy |
| Pending state | [`flushSettingsSave`](../../src/settings/settings-store.ts) persists debounced settings before exit | Flush after consent and before installation |
| App ownership | [`App`](../../src/ui/app.tsx) owns the tab manager and all pane ids | Inject update startup here; do not weaken or duplicate the close coordinator |
| Chrome actions | [`ChromeActions`](../../src/ui/chrome-actions.tsx) owns the action cluster and Settings gear | Put the conditional text action immediately beside Settings |
| Native safety UI | [`close-guard.ts`](../../src/terminal/close-guard.ts) already uses Tauri dialog prompts | Reuse native dialogs only for busy/unknown confirmation and failures |
| macOS bundle | [`tauri.macos.conf.json`](../../src-tauri/tauri.macos.conf.json) uses ad-hoc `signingIdentity: "-"` | Tauri updater signing is separate; Apple signing remains out of scope |
| Windows bundle | [`tauri.windows.conf.json`](../../src-tauri/tauri.windows.conf.json) emits one NSIS installer | Generate and publish only the NSIS updater artifact |
| Stable release | [`release.yml`](../../.github/workflows/release.yml) currently builds only universal macOS | Expand the tagged workflow without publishing Windows into the stable release |

The worktree currently contains an in-progress Settings redesign. Auto-update
must avoid its new settings files and CSS. The only expected overlap is a narrow
startup integration in `src/ui/app.tsx`; preserve all unrelated edits there.

## 5. Product flow

### 5.1 Automatic check

- Run once per cold launch after `App` has mounted and the tab manager exists.
- Do not poll, persist a timer, or repeat after a failed check.
- A missing network, invalid response, or unavailable endpoint writes a concise
  diagnostic and leaves Deck usable. Automatic checks do not show an error dialog.
- `unsupported` platform and web-only Vite preview are no-ops.

### 5.2 Update available

Do not interrupt the user with a dialog. Reveal one compact text button directly
before the Settings gear:

| State | Visible label | Interaction |
| --- | --- | --- |
| Checking / current | hidden | no chrome movement after the one startup check settles |
| Available | `Update` | click downloads the signed artifact; it does not install |
| Downloading | `Downloading…` | disabled, `aria-busy="true"` |
| Downloaded | `Install & Relaunch` | click enters the fresh process gate, then installs |
| Installing | `Installing…` | disabled, `aria-busy="true"` |
| Download failed | `Retry Update` | click retries the download |
| Install failed | `Retry Install` | click re-enters the process gate and retries install |
| Relaunch failed | `Relaunch` | click retries relaunch only; never reinstalls |

The button's accessible name and tooltip include current and available SemVer.
Remote release notes are treated as untrusted plain text and never rendered as
HTML. They may appear only in the tooltip after being bounded to a safe length.

Only one update flow may exist at a time. A completed download remains an
explicit second decision: nothing may turn the downloaded state into an install
without a new click.

### 5.3 Button treatment and responsive behavior

The update action extends the existing quiet chrome rather than introducing a
new CTA language:

- location: immediately before the Settings gear, after the existing separator;
- height `24px`, radius `7px`, horizontal padding `9px`, `--ui-font` at `11.5px`;
- available/downloaded: `--accent` text, a 15% accent wash, and a permitted inset
  1px accent hairline; hover strengthens the wash, never lifts or casts a shadow;
- downloading: `--text-faint` with the regular 6% chrome wash and no looping
  animation;
- retry: `--red` communicates the failed state while the focus ring remains
  `--accent`;
- transitions are color/background only at the existing `0.13s` state budget;
  reduced motion removes them;
- focus-visible uses the existing 2px accent outline, and state changes announce
  through a polite live region without moving focus;
- at the `480px` minimum width, `Install & Relaunch` visually shortens to
  `Relaunch`; its accessible name stays `Install update and relaunch Deck`.

The authored character comes from the precise state transition and theme-bound
hairline, not decorative motion. This preserves Deck's resource-frugal identity
and does not require a design-language amendment.

### 5.4 Installation gate

After the user clicks `Install & Relaunch` and immediately before installation:

1. Fetch fresh process information for every pane.
2. If every pane is an idle shell, continue without another prompt.
3. If a named process is busy, ask with update-specific copy such as
   `claude is still running. Install update and restart anyway?`.
4. If any process cannot be inspected, fail closed and ask with generic unknown
   copy.
5. Cancellation retains the running app and does not call install or relaunch.
6. Flush pending settings. A flush failure retains the downloaded update in an
   install-failed state and never calls install or relaunch.
7. Install, then relaunch where the platform updater has not already exited the
   process.

Busy/unknown dialog, download, install, flush, and relaunch failures are handled
explicitly. User-facing failures stay in the button state or a short native error
dialog; detailed context stays in console diagnostics and never includes secrets.

## 6. Technical shape

### 6.1 Tauri plugins and capabilities

Add compatible v2 versions of:

- `tauri-plugin-updater` / `@tauri-apps/plugin-updater`;
- `tauri-plugin-process` / `@tauri-apps/plugin-process` for relaunch.

Initialize both desktop plugins in the existing Tauri builder. Grant only the
updater check/download/install and process relaunch permissions required by this
flow; do not use broad default permissions when narrower permissions exist.

Enable `bundle.createUpdaterArtifacts: true`. Store the public updater key in
Tauri configuration. Platform configuration supplies different HTTPS endpoints:

- macOS: the stable release `latest.json`;
- Windows: a fixed preview-channel `latest.json` asset.

Production must never enable insecure transport or runtime downgrade comparison.

### 6.2 Frontend ownership

Create one feature-scoped updater module under `src/updater/`. It owns the
single-flight state machine and compact update-action component, and receives
injected seams for:

- platform;
- update check/download/install;
- the button view model and user actions;
- native busy/unknown confirmation;
- current pane ids and the busy guard;
- settings flush;
- relaunch and diagnostics.

The core state machine is testable without Tauri. `App` supplies the live pane
ids from its existing tab manager, starts the service once after mount, and
passes the updater view model into `ChromeActions`. No settings schema or
persistent store changes.

## 7. Release channels

### 7.1 macOS stable

A normal `vX.Y.Z` tag continues to create the stable macOS GitHub Release. The
release workflow receives the updater private key from GitHub Secrets, creates
the universal macOS updater archive and signature, and uploads Tauri's
`latest.json` beside the normal download assets.

### 7.2 Windows B2 preview

The same source version builds one unsigned NSIS installer in a separate GitHub
prerelease named `vX.Y.Z-windows-preview`. Its release title and body must say
`Unsigned Windows Preview`, describe SmartScreen/`Unknown publisher`, and state
that it is not the stable Windows channel.

The generated Windows manifest is copied to a fixed prerelease channel asset,
so installed preview builds have a non-versioned endpoint while historical
versioned prereleases remain immutable. Updating this channel is allowed only
after all of these pass:

- frontend tests and build;
- Rust tests and formatting;
- Windows desktop compilation;
- exactly one NSIS setup and zero MSI files;
- updater bundle and non-empty signature exist;
- manifest SemVer, HTTPS URL, signature, target, and repository owner/name
  validate against an allowlist.

The Windows artifact stays outside the stable macOS Release. Publishing and
moving the preview-channel manifest are release mutations and are not performed
without separate authorization.

## 8. Signing and secret custody

Tauri updater verification cannot be disabled. The production keypair is an
operator-owned release credential:

- generate it offline with the Tauri CLI only after explicit authorization;
- commit only the public key;
- store the private key and optional password as protected GitHub Secrets;
- expose secrets only to the release jobs that build signed updater artifacts;
- never echo, upload as an artifact, persist in `.env`, or pass into PR jobs;
- retain a secure backup because losing the private key breaks future updates
  for every installed updater-enabled build.

Unsigned in B2 refers only to missing Authenticode. The NSIS update is still
covered by the mandatory Tauri signature before Deck installs it.

## 9. Bootstrap and compatibility

Existing v0.9.0 macOS and Windows installations do not contain the updater or
public key. They cannot acquire this feature automatically. Every user must
manually install the first updater-enabled release once; updates after that can
be automatic.

The current app version remains the comparison source. Only a strictly greater
SemVer is accepted; preview builds use the same numeric app version as their
corresponding source release, while the GitHub prerelease tag carries the
`-windows-preview` channel label.

## 10. Verification gates

### Automated

- Unit tests: no update, hidden/available/downloading/downloaded/retry button
  states, separate download and install clicks, accepted idle install, busy
  cancellation, unknown process state, duplicate invocation,
  download/install/relaunch error, unsupported platform, and untrusted
  release-note bounds.
- Release-script tests: allowed targets, exact repository URLs, missing or empty
  signatures, invalid SemVer, MSI rejection, and channel manifest selection.
- Required repository commands: `npm test`, `npm run build`,
  `npm run generate:menu:check`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`,
  and `cargo test --locked --manifest-path src-tauri/Cargo.toml`.

### Runtime

- macOS: serve a signed disposable manifest for a higher test version; verify
  button states, download, busy guard, install, relaunch, and retained settings.
- Windows 11 x64: repeat the same flow with the unsigned NSIS preview and verify
  that live PowerShell/agent processes are never terminated before consent.
- Render the update-action states at `1100x720` and `480x320`, in top-tab and
  sidebar layouts; user eye approval is required before the UI can be called
  complete.
- Inspect the published manifests and signatures from both workflows before
  directing any installed build at them.

Windows runtime evidence must come from a real Windows machine. A macOS build or
CI compilation cannot mark that gate passed.

## 11. Approval boundary

Approving this spec authorizes an implementation plan, not code, dependency
installation, key generation, GitHub Secret creation, tag push, or release
publication. Each later mutation stays behind its own explicit gate.
