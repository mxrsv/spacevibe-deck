# Markdown rendered view — design

Date: 2026-08-23
Status: `decided` (owner approved the design and each choice in chat, 2026-08-23)
Scope: renderer only, inside the file surface. Electron-only in effect — the file
surface has no Tauri implementation. Two new dependencies (owner-decided; §7).

## 1. The decided model

Opening a `.md` file from the file explorer shows the **rendered document**, not
Monaco. One control — and ⌘⇧V — flips the surface to source and back. Editing
happens only in source mode; the rendered view is a read-only picture of the
buffer as it currently is, saved or dirty.

| Gesture | Behaviour |
| --- | --- |
| Open `.md` / `.markdown` from the tree | Rendered view |
| Open `.mdx` | Source (JSX renders as broken prose; source is the honest default) |
| Toggle control / ⌘⇧V | Flip rendered ↔ source for this tab |
| The agent writes the file while it shows | Rendered view re-renders from the reloaded buffer, debounced |
| First edit in source mode | Ordinary dirty-tab flow, untouched; flipping back renders the dirty buffer |

The core loop this serves is the file explorer's own: *read what the agent
changed*. Reading is the common gesture, so it costs zero clicks.

## 2. Naming

`preview` is taken: `FileTabEntry.preview` is the italic replaceable tab slot
(file-explorer spec §4.1). This feature is the **rendered view** everywhere —
`viewMode: "rendered" | "source"`, `MarkdownView`, `markdown-render.ts`. The
word "preview" must not appear in its identifiers, or every future reader
resolves it against the wrong concept.

## 3. Mount shape

- `file-surface-store` gains per-path `viewMode`, defaulted by extension as in
  §1. Session-scoped: mode is remembered per open tab and dies with it. It is
  NOT a settings field — persisting it was considered and dropped (YAGNI; the
  default is right on nearly every open).
- `stage-surface.tsx` picks the mount: `MarkdownView` (new, `src/files/ui/`)
  when the path is markdown and mode is `rendered`, else `FileEditor`
  unchanged.
- No R4 seam moves. TabManager keeps knowing nothing about files; the tab chip,
  preview-slot promotion, dirty registry and close flow are all untouched.

## 4. The toggle

- A single control on the surface's top-right corner, the corner
  `ExternalChangeBar` already established as surface chrome. Icon-only per
  DL-23.10 (tooltip, no native `title`), stating the mode it would switch TO.
- `toggle-markdown-view` joins the action registry at ⌘⇧V (VS Code's own chord
  for this), menu regenerated via `generate:menu`. The action is performable
  only while a markdown file surface is showing (`action-performable.ts`
  pattern) — anywhere else the chord passes through untouched.

## 5. Rendering pipeline

- **`marked` is lazily imported** inside the first `MarkdownView` mount, the
  Monaco precedent: nothing markdown-shaped may enter the entry chunk, and app
  startup is unchanged for a user who never opens a markdown file.
- **The input is the live buffer, never the disk.** The view renders the same
  content the source editor would show — `documentFor`'s current text,
  including unsaved edits — so it rides the external-change silent-reload path
  for free: the watcher reloads the buffer, the view re-renders. Debounce
  ~150ms so an agent streaming a file does not thrash layout.
- **Fenced code blocks are tokenized by Monaco's own colorizer** against the
  enumerated `EDITOR_LANGUAGES` set. No new dependency and no new cost:
  opening `.md` already lazy-loads Monaco today, and the toggle's source mode
  needs it anyway. A language outside the enumerated set renders as plain
  monospace — the same legible outcome the editor gives it.
- **GFM tables and task lists** come from `marked`'s GFM mode. Task-list
  checkboxes are inert pictures — the rendered view is read-only, and a
  checkbox that writes to the file is a different feature.
- **Mermaid**: `mermaid` is dynamically imported only when a document actually
  contains a ` ```mermaid ` fence — most documents never pay for it. The SVG is
  themed from the resolved Deck theme (both `deck-light` and `deck-dark`). A
  diagram that fails to parse renders as an ordinary code block with mermaid's
  error message beneath it — never a blank hole.

## 6. Security policy

Chosen so the feature needs **no CSP** — adding one later invalidates the
passed Gate M run and forces a rerun, so any future renderer change that wants
a CSP is an owner decision, not a footnote.

- **Raw HTML in markdown is escaped and shown verbatim**, block and inline.
  Not sanitized-and-allowed: escaping needs no allowlist to maintain and no
  sanitizer dependency, and the corpus this serves (agent-written docs) loses
  nothing.
- **`javascript:` and `data:` links are dead** — rendered as plain text.
- **`http(s)` links** go through the existing external-open path; nothing
  navigates in-place.
- **Relative links to files inside the workspace** open in Deck's own editor
  through the preview slot — the same routing ⌘+click on an agent-printed path
  already does. A link resolving outside the workspace root is dead.
- **Images are local-only.** A relative `![]()` inside the workspace root is
  read through the existing `FileClient.read` IPC — so the main-process path
  guard answers containment — and shown via a blob URL. Remote image URLs
  render a labelled placeholder; **the rendered view performs no network
  fetch, ever.**

## 7. Dependencies and forks

Per AGENTS.md, dependencies and DL rules are forks. The owner resolved these
in the brainstorming conversation (2026-08-23):

1. **`marked` joins `dependencies`** — owner chose a library over a hand-rolled
   subset, and `marked` over `markdown-it` (needs plugins for task lists) and
   the remark/unified tree (~10+ transitive packages). One package, GFM
   built-in, renderer hooks for §5/§6.
2. **`mermaid` joins `dependencies`** — owner chose mermaid in v1 scope,
   knowing the weight; the lazy import in §5 is what makes it acceptable.
3. **One new DL rule** for rendered-document typography (§8) — recorded in the
   DL ledger when the work lands, with this spec as the deciding record.

The AGENTS.md fork-queue entry is written by the implementation session when
the work starts, telemetry-spec-§13 style.

## 8. DL treatment

The rendered document is chrome, so DL binds it:

- A reading type scale (heading sizes, body line-height) built from the theme's
  tokens — both modes, `deck-light` and `deck-dark`, with no literal colours.
- Body copy capped near 72ch and centered; code blocks and tables may run
  wider inside their own `overflow-x` containers.
- Hairlines, blockquote rules and table borders use the existing `--hair`
  family; no new colour tokens.

The exact rule number is taken at implementation time — next free number above
the current highest, per the §22-stays-reserved convention.

## 9. Host and parity

Electron-only in effect, by inheritance: the file surface (Gate M) has no
Tauri implementation, so no Tauri behaviour changes and none is claimed. The
new code is renderer-side plus zero new IPC — image reads reuse the existing
file-read channel — so no contract in
`scripts/electron-ipc-contract.test.ts` moves.

## 10. Testing and evidence

- Unit: the render policy as pure functions — raw-HTML escaping, link routing
  (`javascript:` dead, external, in-workspace, outside-root dead), image
  resolution and the remote-image placeholder, debounce behaviour, default
  mode per extension.
- Component: `MarkdownView` mounts and re-renders on buffer change;
  the toggle flips mode and the mode survives a tab switch; `.mdx` defaults to
  source; a mermaid parse failure shows the fallback block.
- Suite/build are the evidence class this lands with; the native
  `electron:dev` pass and the owner eye review are owed and named in
  AGENTS.md's drift table like every sibling surface.

## 11. Not built, on purpose

- No side-by-side split (touches layout coordination — a fork for a later
  phase if wanted).
- No scroll sync between the two modes.
- No export (PDF/HTML), no print styling.
- No persisted view-mode setting.
- No interactive checkboxes, no in-place link navigation, no remote content of
  any kind.
