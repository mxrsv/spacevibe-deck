# Markdown rendered view — implementation plan

Date: 2026-08-23
Spec: [2026-08-23-markdown-rendered-view-design.md](../specs/2026-08-23-markdown-rendered-view-design.md) `decided`
Status: `building`

Renderer-only, inside the file surface. Electron-only in effect. Two new
dependencies, both owner-decided in the spec's §7.

## Decisions this plan takes that the spec left open

- **T-A. The rule number is DL §31.** §30 (the notice row) is the current
  highest section, and this rulebook appends rather than filling a gap
  (§22 stays reserved). The whole treatment is one section, not a sub-point of
  §4: a rendered document is a reading surface with its own type scale, and
  DL-4.4's four-rung chrome ladder deliberately does not describe it.
- **T-B. ⌘⇧V is macOS-only.** Ctrl+Shift+V is already `paste` in
  `WINDOWS_KEYMAP`, and a performable action that declines the key does NOT
  fall through to a second binding — it stops consuming and the event reaches
  whatever holds focus, so a Windows binding would break paste in a terminal
  rather than share the chord. Same precedent as `save-file`, which is bare ⌘S
  with no Windows binding. The toggle control is the reachable half on Windows.
- **T-C. Images resolve containment through `workspace_for_path` and read
  through `read_image_as_data_url`.** Spec §6 asks for "the existing
  `FileClient.read` IPC — so the main-process path guard answers containment".
  `read_file` cannot serve it: `looksBinary` refuses any file with a NUL byte
  in its first 8 KiB, which is every PNG. Both halves of the spec's
  requirement still hold with two channels that already exist —
  `workspace_for_path` answers containment through `resolveInsideRoot`, the
  explorer's own guard, main-process side; `read_image_as_data_url` carries
  the bytes (extension allowlist, 1 MB cap). **No new IPC**, so §9 stands.
  The picture arrives as a `data:` URL rather than the spec's blob URL —
  equivalent, with no revoke lifecycle to leak, and the precedent the logo and
  banner stores already run on.
- **T-D. Two passes, not an async parse.** `renderMarkdown` is synchronous and
  pure: it returns HTML in which every fenced block, every mermaid fence and
  every local image is a *placeholder* carrying `data-*` attributes. The async
  work — Monaco's colorizer, mermaid, the image read — runs against the DOM
  after the HTML is injected. That keeps the whole §6 policy unit-testable
  without a DOM, a Monaco or a mermaid, and keeps the first paint immediate.

## Tasks

| # | Task | Files |
| --- | --- | --- |
| T1 | `marked` + `mermaid` in `dependencies`; fork-queue entry in AGENTS.md | `package.json`, `AGENTS.md` |
| T2 | The §6 policy as pure functions | `src/files/markdown-policy.ts` (+ test) |
| T3 | The render pipeline: marked config, renderer overrides, placeholders | `src/files/markdown-render.ts` (+ test) |
| T4 | The async enhancement pass: colorize, mermaid, images | `src/files/markdown-enhance.ts` (+ test) |
| T5 | `viewMode` in the store, defaulted by extension, session-scoped | `src/files/file-surface-store.ts` (+ test) |
| T6 | `MarkdownView` — debounce, mount, delegated clicks, toggle control | `src/files/ui/markdown-view.tsx` (+ test) |
| T7 | `stage-surface.tsx` picks the mount | `src/files/ui/stage-surface.tsx` (+ test) |
| T8 | `toggle-markdown-view`: registry, keymap, performable, seam, dispatch | `action-registry.ts`, `default-keymaps.ts`, `action-performable.ts`, `surface-strip.ts`, `tab-action-scope.ts`, `tab-manager.ts`, `file-surface-controller.ts`, generated menu |
| T9 | DL §31 and the stylesheet partial | `docs/DESIGN-LANGUAGE.md`, `src/styles/17-markdown.css`, `src/styles.css` |
| T10 | Docs: AGENTS.md direction bullet + drift row, `docs/CONTEXT.md` section | `AGENTS.md`, `docs/CONTEXT.md` |

## Verification

`npm test`, `npx tsc --noEmit`, `npm run build`, `npm run generate:menu:check`,
`npm run lint`. Suite/build is the evidence class this lands with; the native
`electron:dev` pass and the owner eye review are owed and named in AGENTS.md's
drift table.
