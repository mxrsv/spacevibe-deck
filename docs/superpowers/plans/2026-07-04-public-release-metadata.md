# Public Release Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare `mxrsv/stackgrid` for public visibility: LICENSE, public README, custom app icon (variant A1), complete macOS bundle metadata, GitHub repo metadata, social preview image, and a tag-triggered release pipeline.

**Architecture:** No application code changes. All work is repo assets (`.github/assets/`), config (`tauri.conf.json`, `.gitignore`), docs (README, LICENSE), one GitHub Actions workflow, and `gh` CLI calls for server-side repo metadata. Icon and social preview are rendered from SVG sources via `sharp` (librsvg) — ImageMagick was tested and fails on the gradient, do NOT use it.

**Tech Stack:** Tauri 2 CLI (`npx tauri icon`), sharp (temporary, `--no-save`), GitHub Actions + `tauri-apps/tauri-action@v0`, `gh` CLI.

## Global Constraints

- All strings, comments, and docs in English (repo convention).
- Work directly on `main`, no feature branch (owner's standing rule). Commit after each task.
- Repo root for all commands: `/Users/kyantran/Documents/Development/glow-workspace/stackgrid` (own git repo, remote `https://github.com/mxrsv/stackgrid.git`).
- `docs/` is gitignored — never `git add` anything under `docs/`.
- Do NOT push and do NOT create tags until Task 9 (push) and owner approval (tag).
- License: MIT, copyright holder `mxrsv`, year `2026`.
- GitHub description (verbatim): `A minimal macOS terminal for AI agent CLIs — split panes, themes, built with Tauri 2 + xterm.js`
- Topics (verbatim): `tauri`, `terminal`, `macos`, `xterm-js`, `preact`, `rust`, `typescript`, `ai-agents`, `claude-code`, `pty`
- Pitch line (verbatim): `A minimal macOS terminal for AI agent CLIs — split panes, themes, real PTY. Built with Tauri 2, xterm.js and Preact.`
- Bundle: publisher `mxrsv`, copyright `© 2026 mxrsv`, category `DeveloperTool`, min macOS `10.15`, ad-hoc signing `"-"`, homepage `https://github.com/mxrsv/stackgrid`.
- Icon colors: gradient `#6f8ff7 → #2e4fd8`, panes `#141726`, side marks `#47548f`, white `#ffffff`.
- Asset paths: `.github/assets/icon.svg`, `.github/assets/screenshot.png`, `.github/assets/social-preview.png`.
- CI: `macos-latest`, universal binary (`aarch64-apple-darwin` + `x86_64-apple-darwin`), `GITHUB_TOKEN` only, trigger on tag `v*`.

---

### Task 1: LICENSE + .gitignore hygiene

**Files:**
- Create: `LICENSE`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `LICENSE` at repo root (Task 6 README links to it; GitHub auto-detects MIT for the badge).

- [ ] **Step 1: Write LICENSE**

Create `LICENSE` (no extension) at repo root with the standard MIT text:

```text
MIT License

Copyright (c) 2026 mxrsv

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Update .gitignore**

Current state (verified 2026-07-04): `node_modules`, `dist`, `.DS_Store`, `.vscode/*` (+`!extensions.json`), `docs/` already ignored; `src-tauri/target` ignored via `src-tauri/.gitignore`. Missing: `.playwright-mcp/`, `.planning/`.

Append to `.gitignore` (after the `docs/superpowers/` line):

```gitignore

# Local tool state
.playwright-mcp/
.planning/
```

- [ ] **Step 3: Verify ignores**

Run: `git check-ignore .playwright-mcp .planning docs && git status --short`
Expected: first command prints both paths (planning may not exist — `git check-ignore .playwright-mcp docs` must print both); `git status --short` shows only `A`/`??` for `LICENSE` and `.gitignore`, no `.playwright-mcp/` entry.

- [ ] **Step 4: Commit**

```bash
git add LICENSE .gitignore
git commit -m "chore: add MIT license and ignore local tool state"
```

---

### Task 2: macOS bundle metadata in tauri.conf.json

**Files:**
- Modify: `src-tauri/tauri.conf.json:30-40` (the `bundle` object)

**Interfaces:**
- Consumes: nothing.
- Produces: complete `bundle` section that Task 9's local build and Task 8's CI build both consume.

- [ ] **Step 1: Extend the bundle section**

Replace the current `bundle` object (keep `active`, `targets`, `icon` exactly as they are) so it reads:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "publisher": "mxrsv",
  "copyright": "© 2026 mxrsv",
  "category": "DeveloperTool",
  "shortDescription": "A minimal macOS terminal for AI agent CLIs",
  "longDescription": "Stackgrid is a lightweight desktop terminal built with Tauri 2, xterm.js and Preact — designed for running AI agent CLIs like Claude Code, Codex and Gemini with split panes, themes and persistent settings.",
  "homepage": "https://github.com/mxrsv/stackgrid",
  "macOS": {
    "minimumSystemVersion": "10.15",
    "signingIdentity": "-"
  },
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

- [ ] **Step 2: Validate config**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')); console.log('JSON OK')" && npx tauri info > /dev/null && echo "TAURI OK"`
Expected: `JSON OK` then `TAURI OK` (tauri CLI fails fast on schema violations).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat: complete macOS bundle metadata (publisher, category, ad-hoc signing)"
```

---

### Task 3: App icon A1 "Electric Blue"

**Files:**
- Create: `.github/assets/icon.svg`
- Modify (regenerate): `src-tauri/icons/*` (`icon.icns`, `icon.ico`, all PNGs — replaces default Tauri icons)

**Interfaces:**
- Consumes: nothing.
- Produces: `.github/assets/icon.svg` (Task 4 embeds the same shapes; Task 6 README displays it) and regenerated `src-tauri/icons/` (consumed by builds).

**Renderer note:** MUST use sharp. ImageMagick's built-in SVG renderer was tested on this exact SVG and produced a black background (gradient unsupported) with a missing chevron.

- [ ] **Step 1: Write the master SVG**

Create `.github/assets/icon.svg` with exactly:

```svg
<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6f8ff7"/>
      <stop offset="1" stop-color="#2e4fd8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="115" fill="url(#bg)"/>
  <rect x="84" y="100" width="200" height="312" rx="22" fill="#141726"/>
  <rect x="304" y="100" width="124" height="148" rx="22" fill="#141726"/>
  <rect x="304" y="264" width="124" height="148" rx="22" fill="#141726"/>
  <path d="M122 168 l44 38 -44 38" stroke="#ffffff" stroke-width="20" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="184" y="230" width="62" height="16" rx="8" fill="#ffffff"/>
  <rect x="332" y="150" width="52" height="12" rx="6" fill="#47548f"/>
  <rect x="332" y="178" width="34" height="12" rx="6" fill="#47548f"/>
  <rect x="332" y="314" width="46" height="12" rx="6" fill="#47548f"/>
  <rect x="332" y="342" width="58" height="12" rx="6" fill="#47548f"/>
</svg>
```

- [ ] **Step 2: Install sharp (temporary, not saved)**

Run: `npm install --no-save sharp`
Expected: exits 0; `package.json` unchanged (`git diff --stat package.json` prints nothing).

- [ ] **Step 3: Render 1024×1024 PNG with Apple-style margin**

macOS Big Sur+ convention: the squircle artwork occupies ~80% of the canvas; `tauri icon` does NOT add this margin itself. Render the squircle at 820 px and pad to 1024 with transparency:

```bash
node -e "
const sharp = require('sharp');
sharp('.github/assets/icon.svg', { density: 300 })
  .resize(820, 820)
  .extend({ top: 102, bottom: 102, left: 102, right: 102,
            background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('/tmp/stackgrid-icon-1024.png')
  .then(i => console.log('rendered', i.width + 'x' + i.height));
"
```

Expected: `rendered 1024x1024`.

- [ ] **Step 4: Visually verify the render**

Read `/tmp/stackgrid-icon-1024.png` (image view). Expected: blue vertical gradient squircle centered with transparent margin, three dark panes, white chevron + cursor bar clearly visible. If the gradient is black or the chevron missing, the wrong renderer was used — go back to Step 2/3.

- [ ] **Step 5: Regenerate the Tauri icon set**

Run: `npx tauri icon /tmp/stackgrid-icon-1024.png`
Expected: log lines writing `src-tauri/icons/icon.icns`, `icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `Square*.png`, `StoreLogo.png`; exit 0.

- [ ] **Step 6: Verify the icns contents and small-size legibility**

```bash
rm -rf /tmp/stackgrid-iconset && iconutil --convert iconset src-tauri/icons/icon.icns --output /tmp/stackgrid-iconset && ls /tmp/stackgrid-iconset
```

Expected: `icon_16x16.png` … `icon_512x512@2x.png` listed. Then Read `src-tauri/icons/32x32.png` (image view) — chevron and pane layout must still be recognizable at 32 px.

- [ ] **Step 7: Commit**

```bash
git add .github/assets/icon.svg src-tauri/icons
git commit -m "feat: custom app icon (A1 Electric Blue) replacing default Tauri icons"
```

---

### Task 4: Social preview image (1280×640)

**Files:**
- Create: `.github/assets/social-preview.svg` (source, tracked for future edits)
- Create: `.github/assets/social-preview.png` (rendered output)

**Interfaces:**
- Consumes: icon shapes from Task 3 (inlined below — no file dependency).
- Produces: `.github/assets/social-preview.png` for the manual GitHub Settings upload (Task 9 handoff).

- [ ] **Step 1: Write the SVG template**

Create `.github/assets/social-preview.svg` with exactly:

```svg
<svg width="1280" height="640" viewBox="0 0 1280 640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d0f1a"/>
      <stop offset="1" stop-color="#1a2140"/>
    </linearGradient>
    <linearGradient id="iconbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6f8ff7"/>
      <stop offset="1" stop-color="#2e4fd8"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.25" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#3d5af1" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#3d5af1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <rect width="1280" height="640" fill="url(#glow)"/>

  <!-- App icon A1, 144 px -->
  <g transform="translate(96,118) scale(0.28125)">
    <rect width="512" height="512" rx="115" fill="url(#iconbg)"/>
    <rect x="84" y="100" width="200" height="312" rx="22" fill="#141726"/>
    <rect x="304" y="100" width="124" height="148" rx="22" fill="#141726"/>
    <rect x="304" y="264" width="124" height="148" rx="22" fill="#141726"/>
    <path d="M122 168 l44 38 -44 38" stroke="#ffffff" stroke-width="20" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="184" y="230" width="62" height="16" rx="8" fill="#ffffff"/>
    <rect x="332" y="150" width="52" height="12" rx="6" fill="#47548f"/>
    <rect x="332" y="178" width="34" height="12" rx="6" fill="#47548f"/>
    <rect x="332" y="314" width="46" height="12" rx="6" fill="#47548f"/>
    <rect x="332" y="342" width="58" height="12" rx="6" fill="#47548f"/>
  </g>

  <text x="96" y="368" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#ffffff">Stackgrid</text>
  <text x="96" y="426" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="27" fill="#a7b0d8">A minimal macOS terminal for AI agent CLIs</text>
  <text x="96" y="470" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="21" fill="#5d6690">Split panes · Themes · Real PTY — Tauri 2 + xterm.js + Preact</text>

  <!-- Split-pane terminal mock -->
  <g transform="translate(672,104)">
    <rect width="512" height="432" rx="18" fill="#10131f" stroke="#262c4a" stroke-width="1.5"/>
    <circle cx="28" cy="26" r="7" fill="#ff5f57"/>
    <circle cx="52" cy="26" r="7" fill="#febc2e"/>
    <circle cx="76" cy="26" r="7" fill="#28c840"/>
    <line x1="0" y1="52" x2="512" y2="52" stroke="#1c2138" stroke-width="1.5"/>
    <line x1="300" y1="52" x2="300" y2="430" stroke="#1c2138" stroke-width="1.5"/>
    <line x1="300" y1="242" x2="512" y2="242" stroke="#1c2138" stroke-width="1.5"/>

    <!-- left pane -->
    <path d="M24 86 l14 12 -14 12" stroke="#7aa2f7" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="52" y="104" font-family="Menlo, Monaco, monospace" font-size="17" fill="#c0caf5">claude</text>
    <rect x="24" y="128" width="180" height="10" rx="5" fill="#33395c"/>
    <rect x="24" y="152" width="140" height="10" rx="5" fill="#33395c"/>
    <rect x="24" y="176" width="210" height="10" rx="5" fill="#2a3052"/>
    <rect x="24" y="200" width="120" height="10" rx="5" fill="#2a3052"/>
    <rect x="24" y="236" width="34" height="14" rx="4" fill="#7aa2f7"/>

    <!-- right top pane -->
    <path d="M324 86 l14 12 -14 12" stroke="#9ece6a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="352" y="104" font-family="Menlo, Monaco, monospace" font-size="17" fill="#c0caf5">codex</text>
    <rect x="324" y="128" width="120" height="10" rx="5" fill="#33395c"/>
    <rect x="324" y="152" width="90" height="10" rx="5" fill="#2a3052"/>

    <!-- right bottom pane -->
    <path d="M324 276 l14 12 -14 12" stroke="#bb9af7" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="352" y="294" font-family="Menlo, Monaco, monospace" font-size="17" fill="#c0caf5">gemini</text>
    <rect x="324" y="318" width="130" height="10" rx="5" fill="#33395c"/>
    <rect x="324" y="342" width="100" height="10" rx="5" fill="#2a3052"/>
  </g>
</svg>
```

- [ ] **Step 2: Render to PNG**

sharp must still be installed from Task 3 Step 2 (if not, rerun `npm install --no-save sharp`).

```bash
node -e "
const sharp = require('sharp');
sharp('.github/assets/social-preview.svg', { density: 144 })
  .resize(1280, 640)
  .png()
  .toFile('.github/assets/social-preview.png')
  .then(i => console.log('rendered', i.width + 'x' + i.height));
"
```

Expected: `rendered 1280x640`.

- [ ] **Step 3: Visually verify**

Read `.github/assets/social-preview.png` (image view). Check: dark gradient background; icon, white "Stackgrid" wordmark and two tagline lines on the left; terminal window with traffic lights, one tall left pane (`claude`) and two stacked right panes (`codex`, `gemini`) on the right. Text must be real glyphs, not boxes (if boxes appear, fontconfig missed the font — change `font-family` first value to `Arial` and re-render).

- [ ] **Step 4: Commit**

```bash
git add .github/assets/social-preview.svg .github/assets/social-preview.png
git commit -m "feat: social preview image for GitHub repo card"
```

---

### Task 5: Hero screenshot (requires the owner at the keyboard)

**Files:**
- Create: `.github/assets/screenshot.png`

**Interfaces:**
- Consumes: running app (`npm run tauri dev`).
- Produces: `.github/assets/screenshot.png` embedded by Task 6 README.

**Note:** Content inside the terminal (running an agent CLI, arranging panes) needs a human; do the setup, then hand the capture command to the owner.

- [ ] **Step 1: Launch the app**

Run: `npm run tauri dev` (background). Expected: window "Stackgrid" opens after compile (~1–2 min first time).

- [ ] **Step 2: Owner arranges the scene**

Ask the owner to: use Tokyo Night theme (default), press ⌘D to split, run an agent CLI (e.g. `claude`) in the main pane so real output is visible, and size the window to roughly 1100×720.

- [ ] **Step 3: Capture the window**

Run: `screencapture -w .github/assets/screenshot.png` — the cursor becomes a camera; the owner clicks the Stackgrid window. Expected: PNG with window shadow on transparent background.

- [ ] **Step 4: Check size, downscale if heavy**

Run: `ls -la .github/assets/screenshot.png && sips -g pixelWidth .github/assets/screenshot.png`
If the file is over 2 MB, run: `sips --resampleWidth 1800 .github/assets/screenshot.png`
Expected: file well under 2 MB, width ≥ 1400 px.

- [ ] **Step 5: Stop the dev app and commit**

Stop the `tauri dev` process, then:

```bash
git add .github/assets/screenshot.png
git commit -m "docs: hero screenshot for README"
```

---

### Task 6: README rewrite

**Files:**
- Modify: `README.md` (full rewrite)

**Interfaces:**
- Consumes: `LICENSE` (Task 1), `.github/assets/icon.svg` (Task 3), `.github/assets/screenshot.png` (Task 5).
- Produces: public-facing README.

- [ ] **Step 1: Replace README.md entirely**

````markdown
<p align="center">
  <img src=".github/assets/icon.svg" width="128" alt="Stackgrid icon" />
</p>

<h1 align="center">Stackgrid</h1>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/mxrsv/stackgrid/releases/latest"><img src="https://img.shields.io/github/v/release/mxrsv/stackgrid" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/platform-macOS%2010.15%2B-lightgrey" alt="Platform: macOS 10.15+">
  <img src="https://img.shields.io/badge/built%20with-Tauri%202-24C8DB" alt="Built with Tauri 2">
</p>

> A minimal macOS terminal for AI agent CLIs — split panes, themes, real PTY. Built with Tauri 2, xterm.js and Preact.

![Stackgrid — split panes running agent CLIs](.github/assets/screenshot.png)

## Features

- **Real PTY** — spawns a login shell (`$SHELL -l`) via `portable-pty`, so your PATH, aliases and dotfiles just work.
- **Split panes** — vertical and horizontal splits, drag dividers to resize, keyboard-driven focus cycling.
- **Themes** — Tokyo Night, Dracula, One Dark, Catppuccin Mocha presets with per-color overrides.
- **Persistent settings** — font, theme and layout survive restarts.
- **Lightweight** — native Tauri 2 shell, no Electron.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/mxrsv/stackgrid/releases/latest).
2. Drag **Stackgrid** into **Applications**.
3. First launch — the app is not signed with an Apple Developer ID yet, so macOS Gatekeeper will warn you. Either:
   - Right-click **Stackgrid.app** → **Open** → **Open**, or
   - Run `xattr -cr /Applications/Stackgrid.app` once.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘D | Split pane vertically |
| ⌘⇧D | Split pane horizontally |
| ⌘⇧W | Close pane |
| ⌘] / ⌘[ | Focus next / previous pane |

## Build from source

Requires Node.js 20+, Rust (stable) and the Tauri 2 prerequisites for macOS.

```bash
npm install
npm run tauri dev     # development
npm run tauri build   # release build → src-tauri/target/release/bundle/
```

## License

[MIT](LICENSE) © 2026 mxrsv
````

- [ ] **Step 2: Verify links and assets resolve**

Run: `ls .github/assets/icon.svg .github/assets/screenshot.png LICENSE`
Expected: all three paths listed, no error.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for public release"
```

---

### Task 7: GitHub repo metadata

**Files:** none (server-side via `gh`; account `mxrsv` already authenticated — verified 2026-07-04).

**Interfaces:**
- Consumes: nothing.
- Produces: repo description + topics visible on the GitHub page.

- [ ] **Step 1: Set description and topics**

```bash
gh repo edit mxrsv/stackgrid \
  --description "A minimal macOS terminal for AI agent CLIs — split panes, themes, built with Tauri 2 + xterm.js" \
  --add-topic tauri --add-topic terminal --add-topic macos --add-topic xterm-js \
  --add-topic preact --add-topic rust --add-topic typescript --add-topic ai-agents \
  --add-topic claude-code --add-topic pty
```

Expected: exit 0, prints the repo URL.

- [ ] **Step 2: Verify**

Run: `gh repo view mxrsv/stackgrid --json description,repositoryTopics --jq '{description, topics: [.repositoryTopics[].name]}'`
Expected: the exact description above and all 10 topics.

---

### Task 8: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: bundle config from Task 2, icons from Task 3.
- Produces: on tag `v*` push — GitHub Release "Stackgrid v\<version\>" with a universal `.dmg` attached.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml` with exactly:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  release:
    runs-on: macos-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Setup Rust (universal targets)
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install frontend dependencies
        run: npm ci

      - name: Build and publish release
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: v__VERSION__
          releaseName: "Stackgrid v__VERSION__"
          releaseDraft: false
          prerelease: false
          args: --target universal-apple-darwin
```

- [ ] **Step 2: Validate YAML**

Run: `npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo "YAML OK"`
Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: release pipeline building universal macOS dmg on v* tags"
```

---

### Task 9: Local build verification, push, handoff

**Files:** none created (build artifacts only, gitignored).

**Interfaces:**
- Consumes: everything above.
- Produces: pushed `main`; handoff checklist for the owner.

- [ ] **Step 1: Full local release build**

Run: `npm run tauri build` (takes several minutes).
Expected: exits 0; artifacts at `src-tauri/target/release/bundle/macos/Stackgrid.app` and `src-tauri/target/release/bundle/dmg/Stackgrid_0.1.0_aarch64.dmg`.

- [ ] **Step 2: Verify bundle metadata in the built app**

```bash
plutil -p src-tauri/target/release/bundle/macos/Stackgrid.app/Contents/Info.plist \
  | grep -E 'NSHumanReadableCopyright|LSApplicationCategoryType|LSMinimumSystemVersion'
codesign -dv src-tauri/target/release/bundle/macos/Stackgrid.app 2>&1 | grep Signature
```

Expected: copyright `© 2026 mxrsv`, category `public.app-category.developer-tools`, minimum system `10.15`, and `Signature=adhoc`.

- [ ] **Step 3: Owner eye-check of the icon**

Run: `open src-tauri/target/release/bundle/macos/` and `open src-tauri/target/release/bundle/macos/Stackgrid.app`.
Owner confirms: Finder icon and Dock icon show the A1 squircle at a size consistent with neighboring system apps (not oversized). If oversized: re-do Task 3 Step 3 with a smaller artwork (e.g. `.resize(780, 780)` + `extend 122`) and re-run Task 3 Steps 5–7.

- [ ] **Step 4: Push main**

```bash
git push origin main
```

Expected: all release-prep commits on `github.com/mxrsv/stackgrid`.

- [ ] **Step 5: Deliver the handoff checklist to the owner**

Manual steps only the owner can do:

1. **Social preview:** GitHub → repo **Settings → General → Social preview** → upload `.github/assets/social-preview.png`.
2. **Make repo public** (when ready): `gh repo edit mxrsv/stackgrid --visibility public --accept-visibility-change-consequences`.
3. **First release** (explicit approval required — do not run without it):
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
   Then watch `gh run watch` — CI produces the Release with `Stackgrid_0.1.0_universal.dmg`. Download on a clean machine/account and confirm right-click → Open works.
