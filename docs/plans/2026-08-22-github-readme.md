# GitHub README Implementation Plan

**Spec**: [2026-08-22-github-readme-design.md](../specs/2026-08-22-github-readme-design.md)
**Status**: Complete; automated checks and owner eye review passed.
**Goal**: Replace the pre-V1 repository page and its tracked marketing images with an evidence-backed SpaceVibe Deck 1.0 page organized around the attention loop.
**Architecture**: `README.md` remains the single public product page and links the moving `releases/latest` route. The two existing PNG paths are replaced in place from one real Electron V1 capture, while the spec and living context record the implementation state and any remaining owner-review evidence.

## 1. Expected outcomes

- The first GitHub viewport identifies the audience, attention promise, served architectures, Windows limitation, and latest-release download action — verify in the GitHub-rendered Markdown output.
- The body presents Launch, Watch, Jump, and Resume before four or five V1 proof groups — verify with a heading and phrase scan over `README.md`.
- No retired Tauri, Stackgrid migration, separate Windows-preview, or no-session-restore claim remains — verify with a forbidden-copy scan over `README.md` and both PNGs.
- The tracked hero and social preview show the real current Electron V1 shell, with the Agent Rail readable in the hero — verify by opening both final PNGs at original size and at GitHub inline width.
- Relative links and image paths resolve and the edited files contain no whitespace errors — verify with the link checker and `git diff --check`.

## 2. Sources of truth

**Canonical data**: Release identity and highlights come from `CHANGELOG.md`, `package.json`, `electron-builder.release.yml`, `.github/workflows/electron-release.yml`, `src/lib/agent-catalog.ts`, and current source anchors named by `docs/CONTEXT.md`.

**Taken from**: The public Electron release workflow and served `releases/latest` assets for delivery facts; current code and living docs for product behavior; one real current V1 app capture for product imagery.

**Not taken from**: The current README, old Stackgrid/Tauri images, gallery or landing mockups that disagree with the app, competitor phrasing, unmeasured performance claims, or a fabricated app surface.

## 3. Business rules and invariants

- **Moving download destination**: Every primary platform CTA resolves through `https://github.com/mxrsv/spacevibe-deck/releases/latest`; no versioned asset URL is embedded — verify with `rg -n "releases/(download|tag)/|releases/latest" README.md`.
- **Honest platform scope**: macOS is Apple Silicon only; Windows is x64, unsigned, SmartScreen-prone, and runtime-unverified for 1.0 — verify against `electron-builder.release.yml` and the release workflow notes.
- **Precise attention evidence**: Latest-turn extraction names Claude Code, Codex, and OpenCode; unsupported tails degrade to the agent name, and resume quality is not presented as universal — verify against `src/lib/agent-catalog.ts`, `electron/resume/`, and the current context ledger.
- **Real product imagery**: The app surface in each final image comes from a current Electron V1 capture with the Agent Rail visible; composition may crop or frame that capture but may not redraw it — verify by comparing the source capture and final PNGs.
- **Trust without overclaiming**: The page says MIT, no Deck account, no Deck telemetry, and local session data; it does not claim agents are offline or Deck makes no network requests — verify by copy scan.
- **Shared worktree isolation**: Only the README, the two existing marketing PNGs, and the approved documentation trail are edited; unrelated Agent Rail and workspace-reorder changes remain untouched — verify with path-scoped `git diff --name-only` and `git status --short`.

## 4. Scope / Out of scope

**In scope**:

- Rewrite `README.md` around the attention promise, attention loop, V1 proof groups, install/trust facts, compact agent and shortcut references, source build, contribution, license, and the final reality ledger.
- Replace `.github/assets/screenshot.png` and `.github/assets/social-preview.png` in place from a current V1 app capture.
- Update the approved spec/plan/context trail with implementation and evidence status.
- Render the Markdown and present the rendered page plus both images for owner eye review.

**Out of scope**:

- App UI, release workflow, package metadata, landing page, video, GitHub About/topics, repository settings, release publication, commit, push, or PR.
- A complete manual, exhaustive compatibility table, benchmarks, testimonials, download counts, or community claims.
- Any unrelated dirty-worktree change.

## 5. Tasks

### Task 1: Freeze the public facts and capture gate

**File(s)**:

- [CHANGELOG.md](../../CHANGELOG.md)
- [package.json](../../package.json)
- [electron-builder.release.yml](../../electron-builder.release.yml)
- [electron-release.yml](../../.github/workflows/electron-release.yml)
- [agent-catalog.ts](../../src/lib/agent-catalog.ts)
- [CONTEXT.md](../CONTEXT.md)

**Decision**: The release workflow and current source win over old README, image, gallery, and historical copy.

**Build**:

- Record the exact 1.0 highlights, built-in agent labels, served architectures, updater behavior, and Windows disclosure used by the README.
- Confirm that the source image is either an owner-supplied current V1 capture or a newly owner-authorized native Electron capture; reject every current tracked image as a substitute when it lacks the current Agent Rail.

**Verify**:

- `node -p "require('./package.json').version"` → output `1.0.0`.
- `rg -n "arm64|x64|unsigned|SmartScreen" electron-builder.release.yml .github/workflows/electron-release.yml` → finds the platform and disclosure anchors used by the copy.
- Visual inspection of the selected source capture → current Electron shell and readable Agent Rail are both present.

---

### Task 2: Produce the current V1 hero

**File(s)**:

- [screenshot.png](../../.github/assets/screenshot.png)

**Dependencies**: Task 1

**Decision**: Replace the existing path with a crop/composition whose app pixels come from the approved real V1 capture and whose rail remains legible at GitHub inline width.

**Build**:

- Crop sensitive or irrelevant desktop surroundings without altering the app UI.
- Size and compress the PNG for a full-width README hero while preserving rail text and status marks.

**Verify**:

- `magick identify .github/assets/screenshot.png` → reports a valid PNG with a landscape aspect ratio.
- Open the image at original size and at approximately 900 CSS pixels wide → app chrome is intact and Agent Rail content remains readable.
- `rg -a -i "stackgrid|tauri" .github/assets/screenshot.png` → no embedded retired identity text.

---

### Task 3: Rewrite the product page

**File(s)**:

- [README.md](../../README.md)

**Dependencies**: Task 1, Task 2

**Decision**: Lead with “Know which agent needs you next.”, then explain Launch, Watch, Jump, Resume before the V1 capability groups and compact reference material.

**Build**:

- Replace the above-fold badges, promise, supporting sentence, download CTA, hero, and adjacent Windows disclosure.
- Add the four-beat attention loop with precise latest-turn and resume limitations.
- Condense the product into attention rail, one project stage, session restoration, local usage accounting, and workflow-neutral agent groups.
- Add latest-release install links, updater choice, trust statements, six built-in agents plus custom commands, a small shortcut set, source build, contribution, license, and an evidence-backed final `## Chưa khớp thực tế` ledger.
- Remove settings archaeology, retired host architecture, Stackgrid migration, old Windows preview, exhaustive feature/manual copy, and stale shortcut claims.

**Verify**:

- `rg -n "Know which agent needs you next|Launch|Watch|Jump|Resume|Apple Silicon|Windows x64|unsigned|SmartScreen|Chưa khớp thực tế" README.md` → finds every required public element.
- `rg -ni "Stackgrid|no Electron|Tauri 2|engineering preview|doesn't restore sessions|does not restore sessions|v0\.9\.0-windows-preview" README.md` → exits with no matches.
- `rg -n "Claude Code|Codex|OpenCode|Antigravity|Gemini CLI|Cursor|custom" README.md` → finds all six catalog labels and the custom-agent statement.

---

### Task 4: Produce the V1 social preview

**File(s)**:

- [social-preview.png](../../.github/assets/social-preview.png)

**Dependencies**: Task 2, Task 3

**Decision**: Replace the existing 1280×640 asset with SpaceVibe Deck, the attention headline, and the same real V1 shell; keep text inside GitHub's safe visual area.

**Build**:

- Compose the approved V1 capture with the product name and attention headline without redrawing the app surface.
- Remove all Stackgrid and Tauri identity and retain enough contrast for GitHub's repository card crop.

**Verify**:

- `magick identify -format '%wx%h\n' .github/assets/social-preview.png` → output `1280x640`.
- Open the image at original size and card-preview size → product name, headline, and V1 shell remain legible without clipping.
- `rg -a -i "stackgrid|tauri" .github/assets/social-preview.png` → no embedded retired identity text.

---

### Task 5: Close the documentation trail

**File(s)**:

- [2026-08-22-github-readme-design.md](../specs/2026-08-22-github-readme-design.md)
- [2026-08-22-github-readme.md](2026-08-22-github-readme.md)
- [CONTEXT.md](../CONTEXT.md)

**Dependencies**: Task 2, Task 3, Task 4

**Decision**: Record implementation and verification truth without claiming owner eye approval before it occurs.

**Build**:

- Mark the spec decision and implementation state accurately, preserving any visual-approval gap.
- Add a current context entry anchored to the README and both image paths, then update the final reality ledger.
- Mark the plan complete only after all automated checks pass; leave owner eye review explicitly open until the owner approves the rendered output.

**Verify**:

- `rg -n "github-readme|README.md|screenshot.png|social-preview.png|owner eye" docs/CONTEXT.md docs/specs/2026-08-22-github-readme-design.md docs/plans/2026-08-22-github-readme.md` → finds the implementation and evidence trail.
- Inspect every new living-doc anchor from `docs/CONTEXT.md` → each resolves relative to that file and carries an intent label.

---

### Task 6: Render and verify the finished page

**File(s)**:

- [README.md](../../README.md)
- [screenshot.png](../../.github/assets/screenshot.png)
- [social-preview.png](../../.github/assets/social-preview.png)

**Dependencies**: Task 5

**Decision**: Automated syntax checks are necessary but do not replace rendered owner review.

**Build**:

- Render `README.md` with GitHub-flavored Markdown into a scratchpad outside the repository.
- Check the first viewport, image scaling, badges, tables, code blocks, horizontal overflow, and every relative link.
- Present the rendered page, hero, and social preview to the owner; incorporate only requested README/asset corrections.

**Verify**:

- `gh api markdown -f mode=gfm -f context=mxrsv/spacevibe-deck -F text=@README.md` → returns rendered HTML without an API error.
- Inline link/image validation over `README.md` → every repository-relative target exists and no versioned release asset URL appears.
- `git diff --check -- README.md .github/assets/screenshot.png .github/assets/social-preview.png docs/specs/2026-08-22-github-readme-design.md docs/plans/2026-08-22-github-readme.md docs/CONTEXT.md` → exits 0 with no output.
- Owner reviews the rendered page and both final PNGs → explicit approval is recorded before the README is called visually complete.

## 6. Implementation record — 2026-08-22

- The owner supplied a 2244×1388 packaged Electron V1 capture with the current Agent Rail.
  `.github/assets/screenshot.png` preserves it pixel-for-pixel after metadata removal
  (`magick compare -metric AE` → `0`).
- `.github/assets/social-preview.png` is 1280×640 and composes that same capture beside the
  SpaceVibe Deck name and “Know which agent needs you next.” No app pixels were redrawn.
- GitHub's Markdown API rendered the icon, badges, headline, hero and every expected H2 without
  error. Fourteen repository-relative targets resolve.
- Required-copy, forbidden-copy, moving-release, image-identity, Prettier and
  `git diff --check` gates all exit 0. The hero was inspected at 900×557 and the social card at
  640×320.
- The owner approved the rendered page, hero and social preview on 2026-08-22. The tracked
  social preview still needs a separate GitHub repository-settings upload; this plan does not
  authorize that action.
