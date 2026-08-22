# GitHub README — The Attention Cockpit

- **Date:** 2026-08-22
- **Status:** decided; implemented and owner-approved
- **Implementation plan:** [2026-08-22-github-readme.md](../plans/2026-08-22-github-readme.md) `current`

## 1. Context

**Origin:**

- The owner asked to replace the repository's pre-V1 README with a more polished,
  marketing-effective GitHub page for SpaceVibe Deck 1.0.
- The owner selected Direction A: position Deck around the attention loop, while learning
  from strong open-source README pages without cloning Orca or Superset.
- The primary conversion is a V1 download. A GitHub star is a secondary outcome, not the
  page's main call to action.

**Problem:**

- [`README.md`](../../README.md) describes the retired Tauri product: it says "no
  Electron," pauses stable macOS distribution, treats Windows as a separate engineering
  preview, says sessions do not restore, and shows a July Stackgrid-era screenshot.
- The page is organized as an exhaustive feature manual. The product's strongest reason
  to exist — helping an operator see which agent needs attention and reach it quickly — is
  buried inside that inventory.
- The tracked social preview also says Stackgrid and Tauri, so the repository's visual
  identity contradicts SpaceVibe Deck 1.0 before a visitor reads the first sentence.

**Decisions:**

- Lead with **"Know which agent needs you next."**
- Describe Deck as an **attention-first desktop terminal for CLI agents**, not an IDE, an
  AI orchestrator, or a general-purpose agent development environment.
- Tell one product loop above the feature inventory:
  **Launch → Watch → Jump → Resume**.
- Put the latest-release download before architecture, shortcuts, settings, or build
  instructions.
- Keep the platform limits honest and close to the download: macOS is Apple Silicon only;
  Windows is x64, unsigned, and runtime-unverified for 1.0.
- Preserve the durable trust claims: MIT, local session data, no accounts, and no
  telemetry. Do not revive the retired "no Electron" claim or replace it with an
  unmeasured performance claim.
- Use Deck's own attention loop and visual language. Do not copy Orca's centered
  agent-logo strip or "orchestrator" vocabulary, and do not copy Superset's exhaustive
  supported-agent/product-surface tables.

## 2. Sources of truth

**Canonical:**

- [`CHANGELOG.md`](../../CHANGELOG.md) for the user-facing 1.0 release promise and shipped
  highlights.
- [`package.json`](../../package.json) for the current product version.
- [`electron-builder.release.yml`](../../electron-builder.release.yml) and
  [the Electron release workflow](../../.github/workflows/electron-release.yml) for the
  shipping identity, architectures, updater assets, and Windows disclosure.
- [`src/lib/agent-catalog.ts`](../../src/lib/agent-catalog.ts) for built-in agent names.
- [`docs/CONTEXT.md`](../CONTEXT.md) and the current source anchors it names for feature
  behaviour and verification limits.
- GitHub's `releases/latest` route for the moving download destination; the README must not
  hardcode a versioned asset URL that becomes stale on the next release.

**Not canonical:**

- The current README, current screenshot, current social preview, Tauri release docs, old
  Stackgrid migration copy, or older competitor research.
- Gallery, landing, or video mockups when they disagree with the shipping V1 app.
- Claims based only on similarity to Orca, Superset, cmux, or another product.

## 3. Content architecture

### 3.1 Above the fold

The first screen on GitHub contains, in order:

1. SpaceVibe Deck icon and name.
2. A restrained badge row: latest release, MIT, macOS Apple Silicon, Windows x64.
3. The headline: **"Know which agent needs you next."**
4. One supporting sentence explaining that Deck runs CLI agents side by side, shows their
   latest words and attention state, and returns the operator to the correct pane.
5. One primary CTA: **Download SpaceVibe Deck 1.0**, linked to `releases/latest`.
6. One current V1 hero image whose Agent Rail is legible without opening the original.
7. A compact Windows disclosure immediately below the CTA or hero, not buried in a later
   installation section.

The hero must not place a supported-agent logo strip between the promise and the product.
The screenshot is the proof.

### 3.2 The attention loop

A short, scannable section replaces the old feature-first opening:

| Beat | Product proof |
| --- | --- |
| **Launch** | Start a built-in or custom CLI agent in the current project or another worktree. |
| **Watch** | Read each supported agent's latest words and its working, asked, or failed state from the rail. |
| **Jump** | Select the project/pane that needs intervention without hunting through terminal tabs. |
| **Resume** | Reopen Deck and continue the agent conversations and workspaces it can resolve. |

The copy must preserve the current precision: latest-turn extraction is real for Claude
Code, Codex, and OpenCode; other agents degrade to their name, and resume quality varies by
agent.

### 3.3 What ships in V1

Use four or five proof-led groups rather than the current long feature catalogue:

- **Attention-first Agent Rail:** latest turns and actionable state.
- **One project stage:** real PTYs, split panes, worktrees, file editor, and browser tabs.
- **Sessions that come back:** crash-loop-safe workspace restoration and supported-agent
  resume.
- **Local usage accounting:** reads supported agents' local session logs without an account
  or telemetry.
- **Workflow-neutral agents:** six built-ins plus user-declared CLI commands.

Each group gets one short paragraph and, only when useful, a source link. The README is a
product page first; it must not expose internal decision history, retired UI, test counts,
or implementation caveats that do not change a user's decision.

### 3.4 Install and trust

- One install section links both platform labels to the latest release and names the exact
  served architectures.
- Windows carries the unsigned/SmartScreen and runtime-verification disclosure.
- The updater is explained in one sentence: Deck checks, the user chooses when to install
  and relaunch.
- A compact trust row states MIT, no accounts, no telemetry, and local session data. It
  does not claim that agents themselves are offline or that Deck makes no network request.

### 3.5 Reference material

- Keep a small "Built-in agents" list sourced from the catalog; custom CLI agents are one
  sentence, not an exhaustive compatibility claim.
- Reduce keyboard shortcuts to the small set that demonstrates the product loop; source
  and full keymap code remain linked for contributors.
- Keep build-from-source, tech stack, contribution pointer, and license near the end.
- Remove the old settings manual, retired Tauri architecture, historical Windows preview,
  preset/UI archaeology, and obsolete Stackgrid migration promise.
- Preserve the mandatory final `## Chưa khớp thực tế` ledger and make it accurately empty
  only after every current claim has been checked.

## 4. Visual assets

- Replace [`.github/assets/screenshot.png`](../../.github/assets/screenshot.png) in place;
  do not add a second hero filename. The replacement must show the current Electron V1
  shell and make the attention rail readable at GitHub's inline width.
- Replace [`.github/assets/social-preview.png`](../../.github/assets/social-preview.png) in
  place with the SpaceVibe Deck name, the attention headline, and the V1 shell. Remove all
  Stackgrid and Tauri text.
- Keep [`.github/assets/icon.svg`](../../.github/assets/icon.svg) unless inspection finds a
  V1 identity mismatch.
- Do not use generated fake app chrome as product proof. A composed background or crop is
  acceptable, but the app surface itself must come from the real V1 UI.
- Updating the tracked social-preview file does not change GitHub repository settings. Any
  upload to GitHub's Social preview setting is a separate, owner-authorized action.

## 5. Failure modes

- If no current V1 capture is available, the README must not label an old image `current`
  or ship a fabricated substitute. The visual part stays explicitly incomplete until a
  real capture is supplied or owner-authorized capture is performed.
- If a feature claim cannot be anchored to current code, release notes, or current docs,
  cut the claim instead of softening it into vague marketing copy.
- If macOS/Windows delivery facts conflict across files, the public release workflow and
  served release assets win; the conflict is reported rather than silently resolved.
- If a direct release asset name would be needed, use `releases/latest` instead so the CTA
  survives the next version.
- If rendering exposes broken links, unreadable image text, or horizontal overflow, the
  README remains unapproved even when Markdown syntax is valid.
- Existing unrelated changes in the shared checkout remain untouched and uncommitted.

## 6. Completion and exclusions

**Done:**

- A visitor can identify Deck's audience, differentiated promise, supported platforms,
  Windows limitation, and download action without scrolling past the hero.
- The page follows the attention loop before presenting V1 capability groups.
- Every Tauri-era, Stackgrid migration, separate Windows-preview, and no-session-restore
  claim is removed or corrected.
- Both tracked marketing images use the SpaceVibe Deck V1 identity and the current UI.
- Relative links and image paths resolve; `git diff --check` passes; the Markdown is
  rendered for review; the owner eye-approves the rendered result.
- Only README/marketing assets and the approved documentation trail are changed.

**Not done:**

- Application UI, landing page, marketing video, release workflow, package metadata, GitHub
  About text/topics, repository social-preview settings, release publication, commit, or
  push.
- A complete user manual or complete keyboard shortcut reference.
- New product claims, benchmarks, download counts, testimonials, community links, or
  comparison tables without current evidence.
- Changes to unrelated in-flight Agent Rail/workspace-reorder work.

## 7. Resolved questions

- **ASSUMPTION:** The primary CTA remains the latest V1 download and GitHub stars remain a
  secondary outcome.
- **ASSUMPTION:** The existing icon remains the approved SpaceVibe Deck identity.
- **RESOLVED:** The owner supplied a 2244×1388 capture of the packaged Electron V1 shell on
  2026-08-22, with the Agent Rail visible. That capture is the only app-pixel source used by
  both tracked PNGs. The owner approved the rendered result on 2026-08-22.
