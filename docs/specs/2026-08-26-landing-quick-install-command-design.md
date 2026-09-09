# Landing quick-install command — three visual directions, one safe bootstrap

- **Date:** 2026-08-26
- **Status:** approved for implementation; visual direction selection pending

## 1. Context

**Origin:**

- The owner asked to add a quick install command to the Deck landing and shared a tabbed
  command block as a reference for the command format.
- The owner clarified that the reference defines only the interaction grammar — platform
  selection, one command line and copy — and must not become the visual design.

**Problem:**

- The current hero offers separate macOS and Windows download buttons. A visitor still has
  to download an installer, find it and complete the platform flow manually.
- Deck needs a short, copyable command that starts the official install path while retaining
  visible direct-download fallbacks.
- The command module must feel native to Deck's framed, technical landing rather than a copy
  of the supplied reference or a stock terminal card.

**Decisions:**

1. The command performs a real bootstrap: macOS installs the app; Windows downloads and
   starts the official NSIS installer. Windows remains interactive because Deck must not
   bypass SmartScreen or installer consent.
2. The public commands are:
   - macOS: `curl -fsSL https://deck.spacevibe.dev/install.sh | sh`
   - Windows PowerShell: `irm https://deck.spacevibe.dev/install.ps1 | iex`
3. The landing shows explicit macOS and Windows controls. Browser OS detection may select an
   initial control, but it never hides the other platform or changes the command after the
   user has chosen one.
4. Three genuinely different, Deck-native visual directions are built on an in-stack page
   route for owner eye review. The supplied screenshot is not a style reference.
5. No visual direction reaches the public landing before one option is explicitly chosen.
   The losing variants are removed after the chosen treatment is promoted.
6. The current macOS and Windows download links remain available as fallbacks.

## 2. Canonical sources

**Canonical:**

- Published release metadata and installer URLs come from GitHub Releases through the same
  validation rules used by
  [`release-data.js`](../../marketing/landing-prototype/src/release-data.js) `current`.
- Stable macOS means the newest published, non-prerelease `.dmg` for Apple Silicon. Stable
  Windows means the newest published, non-prerelease `*-setup.exe` for x64.
- Product identity, supported architectures and the unsigned-Windows warning remain defined
  by the
  [Electron stable release design](./2026-08-20-electron-stable-release-design.md) `decided`.
- `https://deck.spacevibe.dev/install.sh` and
  `https://deck.spacevibe.dev/install.ps1` are the stable public bootstrap endpoints. Their
  implementation lives with the landing artifact and is copied into the Vite output by the
  landing build.

**Not canonical:**

- The command module does not pin a release tag, installer filename or GitHub asset URL in
  HTML or copy.
- Browser user-agent detection is only an initial presentation hint; it is not an installer
  compatibility decision.
- The reference screenshot contributes no color, spacing, border, typography or layout
  decisions.

## 3. Solution architecture

### 3.1 Bootstrap endpoints

**macOS bootstrap:**

1. Fail fast unless the host is Darwin on `arm64`.
2. Resolve the newest stable macOS `.dmg` from validated GitHub release data.
3. Download into a newly created temporary directory over HTTPS and clean it on every exit.
4. Mount the image, locate exactly one `SpaceVibe Deck.app`, and validate the app with
   `codesign --verify --deep --strict` and `spctl --assess` before copying it.
5. Install into `/Applications` when writable; otherwise install into
   `$HOME/Applications`. Print the final path. Do not silently elevate with `sudo`.
6. Detach the image and remove temporary files whether the install succeeds or fails.

**Windows bootstrap:**

1. Fail fast unless the host is 64-bit Windows.
2. Resolve the newest stable x64 `*-setup.exe` from validated GitHub release data.
3. Download into the user's temporary directory over HTTPS.
4. Validate that the final URL is a GitHub release asset and verify the payload SHA-512
   against `latest.yml` before execution.
5. Start the installer normally and wait for it to exit. Do not pass silent-install flags,
   suppress SmartScreen or instruct the user to weaken Windows security.
6. Remove the temporary installer after the process exits and return a non-zero status on
   cancellation or failure.

Both bootstraps validate every response shape they consume, print the release version being
installed, and stop before modifying an existing installation when release resolution or
verification fails. The endpoint responses use a short cache lifetime so a bootstrap fix is
not held for the lifetime of an app release.

### 3.2 Shared command behavior

- macOS and Windows are real keyboard-operable controls with selected state exposed through
  `aria-selected` or the equivalent semantic radio pattern.
- The command line remains selectable text. Copy is an explicit button with an accessible
  name; success and failure are announced without changing layout width.
- A successful copy gives restrained visual feedback and restores the normal label after a
  short interval. Clipboard failure leaves the command selectable and shows a clear message.
- The current direct download links sit inside or immediately below each option as
  `Download manually` fallbacks.
- The landing stays English-only. Command strings, URLs and platform warnings are never
  translated.

### 3.3 In-stack visual review route

The review surface uses the existing Vite landing stack on a dedicated local demo server,
not a standalone HTML reconstruction. One review route exposes all three treatments against
the real hero, tokens, typography and responsive frame. A query parameter or local review
control may switch variants; normal production navigation does not link to the route.

Every direction carries the same copy, commands, interaction states and footprint budget so
the owner evaluates visual composition rather than different functionality.

### 3.4 Visual directions

#### Direction A — Frame Rail

- A full-width install rail locks into the landing's existing horizontal frame rules.
- Platform controls behave like route markers cut into the upper rule rather than tabs on a
  card. The command sits on one long baseline with the copy action terminating the rail.
- A subtle release/version readout and manual-download fallback occupy the lower edge.
- Tone: architectural, quiet, precise. Best fit with the current page grammar; risk is that a
  wide rail can compete with the product stage if its contrast is too high.

#### Direction B — Launch Console

- An asymmetric console splits platform selection and install status from the command
  viewport. The selector reads like a compact launch instrument, not a tab bar.
- The command viewport uses layered depth, a measured active edge and one state transition
  when the platform changes; it does not imitate a shell window or draw fake traffic lights.
- Manual download and the Windows unsigned note live in the status side, keeping the command
  line visually clean.
- Tone: operational, technical, tactile. Strongest interaction character; risk is extra
  density on the 390px layout.

#### Direction C — Embedded Prompt

- The command becomes a narrow prompt shelf integrated between the hero copy and the product
  stage instead of sitting inside a visible card.
- Platform choice is a two-position system switch aligned with the prompt prefix. Copy
  feedback travels along the shelf edge, making the interaction legible without a large
  container.
- Direct downloads appear as small trailing links beneath the shelf.
- Tone: minimal, product-first, distinctive. Preserves the hero's visual air; risk is that
  the install action may read too quietly without careful focus and hover treatment.

The three directions deliberately vary geometry, hierarchy, depth and control language.
They share no visual styling from the supplied reference beyond the required ability to
choose a platform, read one command and copy it.

## 4. Failure modes

- If the release API is unavailable, the bootstrap exits with a clear message and the landing
  still offers the stable GitHub Releases fallback.
- If the resolved asset is absent, malformed, prerelease-only or hosted outside the allowed
  GitHub release origin, the bootstrap exits without executing anything.
- If macOS signature or Gatekeeper assessment fails, the app is not copied.
- If Windows SHA-512 verification fails, the installer is not started.
- If the platform or architecture is unsupported, the command explains the supported target
  and points to GitHub Releases; it does not guess or install an emulated build.
- If Clipboard API access is unavailable or denied, the command stays selectable and the UI
  reports that automatic copy failed.
- If JavaScript or browser OS detection fails, macOS is the deterministic initial selection
  and both platform controls remain usable.
- If a command exceeds the mobile width, it scrolls horizontally inside its own line without
  widening the page; the copy control remains reachable.
- If reduced motion is requested, platform and copy-state changes are immediate and retain
  the same hierarchy.

## 5. Completion and exclusions

**Done:**

- Three in-stack variants are reviewable at 1440px and 390px with the same real command and
  fallback behavior.
- Each variant includes default, hover, focus, selected, copied, copy-failed and
  reduced-motion states.
- The owner chooses one direction from rendered screenshots or a running local page before
  promotion.
- The chosen direction is promoted into the real landing; losing review code is removed.
- The macOS bootstrap is tested against mocked release responses plus a non-destructive local
  fixture, and its signature/failure branches are covered.
- The Windows bootstrap is tested against mocked release responses and hashes; it is also run
  on Windows without bypassing the interactive installer or SmartScreen.
- Landing tests pin platform selection, copy success/failure, manual fallback links and
  unsupported-browser behavior.
- `npm run build:landing` emits both bootstrap endpoints and the landing/changelog entries.
- Final 1440px and 390px screenshots receive owner eye approval; build success alone is not
  visual acceptance.

**Not done:**

- Homebrew, WinGet, npm, bun or other package-manager distribution.
- Intel macOS, Windows ARM or Linux installation.
- Silent Windows installation or any SmartScreen/Gatekeeper bypass.
- Release-pipeline, signing, updater or application-runtime changes.
- A redesign of the rest of the landing page.
- Shipping all three visual variants publicly.

## 6. Open questions

- **ASSUMPTION:** The public bootstrap URLs are owned by the Deck landing deployment and may
  be served as static files from its Vite output.
- **ASSUMPTION:** Windows remains unsigned, so the quick command starts the standard installer
  but cannot make the platform warning disappear.
- **BLOCKER:** None for implementation planning after owner approval of this spec.
