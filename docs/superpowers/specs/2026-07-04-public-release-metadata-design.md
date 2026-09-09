# Public Release Metadata — Design

**Date:** 2026-07-04
**Status:** Approved (pending user review of this document)
**Note:** `docs/` is intentionally gitignored in this repo — this spec stays local-only. Assets referenced by README live under `.github/assets/` (tracked).
**Scope:** Prepare the existing GitHub repo (`mxrsv/stackgrid`) for public visibility and give the macOS app complete bundle metadata, a custom icon, and an automated release pipeline.

## Context

Stackgrid is a Tauri 2 + xterm.js + Preact terminal app for running AI agent CLIs. The repo already exists at `github.com/mxrsv/stackgrid` with remote configured. Current state: default Tauri icons, minimal `tauri.conf.json` bundle section, no LICENSE, README written for developers only, no release pipeline.

All decisions below were confirmed with the owner during brainstorming; a visual demo of every deliverable was reviewed and approved (icon variant **A1 — Electric Blue** chosen).

## 1. Repository files

### LICENSE

- MIT, copyright holder `mxrsv`, year 2026. Standard full MIT text at repo root.

### README.md (rewrite, English)

Structure:

1. Title with app icon, badge row: license (MIT), latest release, platform (macOS 10.15+), built with Tauri 2.
2. One-line pitch (blockquote): "A minimal macOS terminal for AI agent CLIs — split panes, themes, real PTY. Built with Tauri 2, xterm.js and Preact."
3. Hero screenshot — captured from the real app (split panes, Tokyo Night theme, agent CLI running). Stored at `.github/assets/screenshot.png`.
4. Features (real PTY, split panes, themes, persistent settings, lightweight).
5. Install: download `.dmg` from Releases; Gatekeeper note for unsigned app — right-click → Open, or `xattr -cr /Applications/Stackgrid.app`.
6. Keyboard shortcuts table (⌘D, ⌘⇧D, ⌘⇧W, ⌘] / ⌘[).
7. Build from source (npm install / tauri dev / tauri build).
8. License footer.

### .gitignore

- Verify it excludes: `dist/`, `node_modules/`, `src-tauri/target/`, `.DS_Store`, `.playwright-mcp/`, `.planning/`, `.vscode/` (keep if intentionally shared — default: ignore).

## 2. GitHub repo metadata (via `gh repo edit`)

- **Description:** "A minimal macOS terminal for AI agent CLIs — split panes, themes, built with Tauri 2 + xterm.js"
- **Topics:** `tauri`, `terminal`, `macos`, `xterm-js`, `preact`, `rust`, `typescript`, `ai-agents`, `claude-code`, `pty`
- **Homepage:** none (repo itself).

## 3. Social preview

- 1280×640 PNG: dark gradient background, A1 icon + "Stackgrid" wordmark + tagline on the left, stylized split-pane terminal mock on the right (as approved in the demo).
- Generated from an HTML/SVG template rendered to PNG. Stored at `.github/assets/social-preview.png`.
- GitHub does not expose an API for social preview → owner uploads manually in **Settings → Social preview** (one click; instructions provided at handoff).

## 4. App icon — variant A1 "Electric Blue"

Approved design: macOS squircle, vertical gradient `#6f8ff7 → #2e4fd8`, three dark panes (`#141726`) in a split-grid layout (one tall left pane, two stacked right panes), white chevron prompt + white cursor bar in the main pane, muted line marks (`#47548f`) in the side panes.

Master SVG source (1024 render target):

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

Pipeline: SVG (kept at `.github/assets/icon.svg`) → render 1024×1024 PNG → `npx tauri icon <png>` regenerates the full set in `src-tauri/icons/` (`.icns`, `.ico`, all PNG sizes), replacing the default Tauri icons.

Note: macOS icons conventionally include transparent margin around the squircle; `tauri icon` handles masking — verify the result in Dock/Finder and adjust padding if the icon renders oversized next to system apps.

## 5. macOS bundle metadata (`tauri.conf.json`)

Add to `bundle`:

```json
"publisher": "mxrsv",
"copyright": "© 2026 mxrsv",
"category": "DeveloperTool",
"shortDescription": "A minimal macOS terminal for AI agent CLIs",
"longDescription": "Stackgrid is a lightweight desktop terminal built with Tauri 2, xterm.js and Preact — designed for running AI agent CLIs like Claude Code, Codex and Gemini with split panes, themes and persistent settings.",
"homepage": "https://github.com/mxrsv/stackgrid",
"macOS": {
  "minimumSystemVersion": "10.15",
  "signingIdentity": "-"
}
```

- `signingIdentity: "-"` = ad-hoc signing (no Apple Developer account yet). Users see a Gatekeeper warning on first launch; README documents the workaround. Upgrading later = set a Developer ID identity + notarization env vars in CI; config change only.

## 6. Release automation (GitHub Actions)

`.github/workflows/release.yml`:

- Trigger: push of tag matching `v*`.
- Runner: `macos-latest`; Rust targets `aarch64-apple-darwin` + `x86_64-apple-darwin`.
- `tauri-apps/tauri-action@v0` with `args: --target universal-apple-darwin` → builds one universal `.dmg` (Apple Silicon + Intel) and creates the GitHub Release with the artifact attached, release name `Stackgrid v<version>`.
- `GITHUB_TOKEN` only; no extra secrets until real code signing is added.

## Error handling / risks

- **Gatekeeper friction (accepted):** unsigned app requires right-click → Open. Mitigated by README instructions; resolved permanently when a Developer ID is purchased.
- **`tauri icon` output quality:** verify generated `.icns` at multiple sizes; the SVG uses simple shapes so small sizes should stay legible (chevron + panes remain visible at 32px).
- **CI build failures:** universal target requires both Rust targets installed in the workflow — included explicitly.
- **Social preview:** manual upload step; cannot be automated, called out in handoff checklist.

## Out of scope

- Apple Developer ID signing/notarization (future upgrade).
- Windows/Linux bundles (targets stay "all" locally but CI builds macOS only).
- App Store distribution, auto-updater.

## Verification

- `npm run tauri build` locally produces `.app`/`.dmg` with new icon + metadata (check Finder → Get Info).
- Tag `v0.1.0` push → CI produces a GitHub Release with universal `.dmg`; download on a clean account/machine, confirm right-click → Open works.
- Repo page shows description, topics, MIT badge, README with screenshot; link share shows social preview.
