# Landing Changelog Implementation Plan

**Goal**: Show the latest stable Deck version beside the landing GitHub CTA and add a dedicated bilingual changelog page backed by published GitHub Releases.
**Architecture**: Extract the GitHub Releases fetch and selection rules into one browser module shared by the existing download-link upgrade and the changelog page. Keep the package version as the rendered fallback, then replace it with the latest stable published tag when the API succeeds. Build the changelog as a second Vite HTML entry with safe DOM rendering, the existing locale state, and the landing's editorial frame and monochrome visual language.

## 1. Expected outcomes

- The landing row reads `View on GitHub → vX.Y.Z`, and the version opens the dedicated changelog page — verify with `upgradeReleaseLinks` tests and a desktop/mobile browser screenshot.
- `/landing-prototype/changelog/` lists published stable and prerelease releases newest-first with loading, empty, and failure states — verify with `changelog-view.test.js` and browser inspection.
- macOS and Windows download resolution keeps its current stable/prerelease rules — verify with the existing `download-links.test.js` suite.
- Both landing HTML entries ship in the production artifact — verify with `npm run build:landing` and file checks under `marketing/landing-prototype/dist/landing-prototype/`.

## 2. Canonical data source

**Canonical data**: Published release tags, release notes, dates, prerelease state, and downloadable assets returned by the GitHub Releases API for `mxrsv/spacevibe-deck`.

**Read from**: The public GitHub Releases list endpoint at page load; `package.json` supplies only the offline initial version label.

**Do not read from**: Hand-maintained changelog arrays or pinned release URLs, because they drift when a new release is published.

## 3. Business rules and invariants

- **Landing version**: Show the newest non-prerelease tag; keep the package version when the API is unavailable — verify with `uses the latest stable tag and preserves the fallback on failure`.
- **Release order**: Preserve the GitHub newest-first order and include prereleases with an explicit Preview label — verify with `renders stable and prerelease entries newest-first`.
- **Safe notes**: Insert external release-note text through DOM text nodes, never executable HTML — verify with `renders release notes as inert text`.
- **Download selection**: macOS accepts `.dmg` assets only from stable releases; Windows accepts `.exe` assets from any published release — verify with `download-links.test.js`.
- **Locale continuity**: EN/VI switches update page chrome without translating GitHub-authored release notes — verify with `updates changelog chrome when the locale changes`.

## 4. Scope / Out of scope

**In scope**:

- Add the version link beside the landing GitHub CTA.
- Add a responsive changelog-only page using the existing landing design system.
- Add shared release-data logic, automated tests, a landing build script, and current-state documentation.
- Render and inspect desktop and mobile screenshots.

**Out of scope**:

- Change release, signing, versioning, or publishing configuration.
- Add a Markdown parser or any dependency.
- Edit app chrome, the marketing video stage, or sibling repositories.

## 5. Tasks

### Task 1: Lock the shared release-data contract with failing tests

**Files**:

- [download-links.test.js](../../marketing/landing-prototype/src/download-links.test.js)
- [release-data.test.js](../../marketing/landing-prototype/src/release-data.test.js)

**Decision**: One normalized release list supplies download URLs, the latest stable tag, and changelog records.

**Build**:

- Add a landing version fixture and assertions for stable selection plus offline fallback preservation.
- Add validation tests for malformed API payloads and normalized release fields.
- Run the targeted tests before implementation and confirm the failure names the missing shared contract.

**Verify**:

- `npm test -- marketing/landing-prototype/src/release-data.test.js marketing/landing-prototype/src/download-links.test.js` → exits non-zero before Task 2 for the expected missing export or behavior.

---

### Task 2: Implement shared GitHub Releases data and upgrade the landing CTA

**Files**:

- [release-data.js](../../marketing/landing-prototype/src/release-data.js)
- [download-links.js](../../marketing/landing-prototype/src/download-links.js)
- [main.js](../../marketing/landing-prototype/src/main.js)
- [a.js](../../marketing/landing-prototype/src/directions/a.js)
- [direction-a.css](../../marketing/landing-prototype/styles/direction-a.css)

**Depends on**: Task 1

**Decision**: Render the package version immediately, link it to the changelog route, and replace its label with the latest stable tag from the shared request.

**Build**:

- Implement validated release fetching, stable-tag selection, and platform asset selection without mutating the API payload.
- Refactor the download upgrade to consume the shared release list and update `[data-release-version]` only on success.
- Reshape the GitHub CTA into a project row whose authored underline follows the separate version link.
- Preserve keyboard focus, mobile wrapping, and reduced-motion behavior.

**Verify**:

- `npm test -- marketing/landing-prototype/src/release-data.test.js marketing/landing-prototype/src/download-links.test.js` → all targeted tests pass.

---

### Task 3: Lock and implement changelog states

**Files**:

- [changelog-view.test.js](../../marketing/landing-prototype/src/changelog-view.test.js)
- [changelog-view.js](../../marketing/landing-prototype/src/changelog-view.js)
- [changelog.js](../../marketing/landing-prototype/src/changelog.js)
- [copy.js](../../marketing/landing-prototype/src/copy.js)

**Depends on**: Task 2

**Decision**: Render a chronological release ledger with loading, populated, empty, and recoverable error states; GitHub release bodies remain inert text.

**Build**:

- First add failing DOM tests for order, Preview labels, inert notes, errors, and locale updates.
- Implement state rendering with semantic `article`, `time`, heading, and external release links.
- Reuse the existing EN/VI locale state for page chrome and preserve GitHub-authored release-note content.

**Verify**:

- `npm test -- marketing/landing-prototype/src/changelog-view.test.js` → all changelog DOM tests pass after the initial expected red run.

---

### Task 4: Build the dedicated changelog entry and visual treatment

**Files**:

- [index.html](../../marketing/landing-prototype/changelog/index.html)
- [changelog.css](../../marketing/landing-prototype/styles/changelog.css)
- [vite.build.mjs](../../marketing/landing-prototype/vite.build.mjs)
- [package.json](../../package.json)

**Depends on**: Task 3

**Decision**: Use the landing's frame, type, plus-grid, and achromatic light language, with a release-ledger rail as the page's signature artifact.

**Build**:

- Add the second accessible HTML entry and a dedicated `build:landing` command.
- Style desktop and mobile as distinct compositions, including custom release markers, version hierarchy, visible focus, loading/error treatments, and restrained entry reveals.
- Honor `prefers-reduced-motion` and keep the page useful without decorative motion.

**Verify**:

- `npm run build:landing` → exits 0 and emits both `landing-prototype/index.html` and `landing-prototype/changelog/index.html`.
- Desktop 1440×900 and mobile 390×844 screenshots show readable notes, no horizontal overflow, and a visible path back to Deck.

---

### Task 5: Verify the full feature and record current state

**Files**:

- [CONTEXT.md](../CONTEXT.md)

**Depends on**: Task 4

**Decision**: Record only the shipped landing/changelog behavior and retain the existing reality-drift ledger.

**Build**:

- Add anchored `current` claims for the shared Releases source and changelog route.
- Inspect the final diff to confirm no app, release-config, video, generated, or sibling-repo files changed.

**Verify**:

- `npm test` → full Vitest suite exits 0.
- `npm run build` → TypeScript and production app build exit 0.
- `npm run build:landing` → landing production build exits 0.
- `git diff --check` → exits 0.
