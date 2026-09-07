# File surface, browser tab and path opening

Three things share the stage with the terminal grid: documents opened from the file
explorer, the browser tab, and the routing that turns a path an agent printed into one of
those. All of it is Electron only: the file channels, the `WebContentsView` and the external
app catalog have no Tauri counterpart, and `open_editor` is the one path Tauri keeps.

## Surfaces beside tabs

- **The file surface store lives beside `TabManager`, never inside it.**
  [`file-surface-store.ts`](../../src/files/file-surface-store.ts) imports nothing from
  `tab-manager.ts` and vice versa, because `syncViews` rebuilds tab views from a process poll
  and a PTY-less tab could not survive that. `App`, `TabBar` and the strip are the only
  modules that see both. The browser store keeps the same seam: `browserSurfaceActive` and
  `activeFileTab` are held mutually exclusive by `App`, and the two stores never import each
  other.
- **`SurfaceStrip`** ([`stage-surface-strip.ts`](../../src/ui/stage-surface-strip.ts)) is
  everything `TabManager` is allowed to know: `count`, `total`, `activeIndex`, activate,
  deactivate, focus, close, save, and three optional methods, `orderKey`, `runEditCommand`
  and `canToggleView`/`toggleView`. Index space is the active workspace's file tabs, then
  the browser as the one index past them; the merged strip places every chip by `orderKey`,
  so the browser can sit before a file tab.
- **Exactly one of terminal grid, document or browser owns the stage.** The document and the
  browser surface cover `.stage__tabs` rather than unmounting it, so taking the stage back
  costs no xterm reflow and no PTY resize. A document stays mounted on `activeFileTab` alone,
  not on the dock being open.
- **Per window, in memory.** File tabs and view modes are not settings; only the dock's width
  and default-open state persist. Session restore carries the main window's file list in
  its own record.
- **The preview slot** ([`preview-slot.ts`](../../src/files/preview-slot.ts)): a single click
  opens a file into the workspace's one preview tab, replaced in place keeping its
  `openedAt`; a double-click or the first edit promotes it to a kept tab; a dirty preview is
  promoted rather than replaced, so replacing a preview never discards work.

## Explorer and editor

- The tree ([`file-tree.ts`](../../src/files/file-tree.ts)) is virtualized by plain index
  arithmetic, 22px rows, hides `.git`, `node_modules`, `dist` and `target` by a fixed list
  rather than by parsing `.gitignore`, sorts directories first with a locale compare and a
  code-unit tie-break, and walks with a visited set so a symlink cycle inside the root cannot
  loop. A symlink out of the root renders as a leaf and does not open.
- Monaco is imported lazily on the first file tab and its languages are enumerated one
  import at a time in [`editor-host.ts`](../../src/files/editor-host.ts), because a loop over
  strings is not statically analyzable. Language services (TypeScript, JSON, CSS, HTML
  workers) are deliberately not loaded. One editor instance swaps models per tab with saved
  view state, so a silent reload keeps scroll and cursor; external changes are applied with
  `pushEditOperations`, never `setValue`, to keep the undo stack.
- **External change policy** ([`external-change.ts`](../../src/files/external-change.ts)):
  a clean document reloads silently or is marked gone; a dirty one is asked (reload / keep
  mine, save again / close); a prompt already up is never replaced under the pointer.
  `fs.watch` misses events on every platform, so a re-`stat` of every open document on
  window focus is the designed mitigation, one `stat_files` batch per workspace.
- **Dirty resolves toward dirty.** The renderer's registry pushes its complete set to main on
  every change (`set_dirty_files`), and main's copy is what the quit and window-close census
  reads, so a wedged renderer cannot make ⌘Q forget an unsaved file. A failed save marks the
  document `unknown`, which keeps the guard asking.
- Content limits ([`file-content.ts`](../../src/files/file-content.ts), compiled into main
  too): editable up to 2 MiB, readable up to 16 MiB, binary refused by a NUL byte in the
  first 8 KiB, invalid UTF-8 decoded lossily and opened read-only, line endings detected by
  the dominant kind.

## Main-process file guards

- **A path is legal only if, after `realpath`, it is inside the workspace root, itself
  realpath'd** ([`path-guard.ts`](../../electron/fs/path-guard.ts)). Comparison is
  `path.relative`, never `startsWith`; the root is resolved per call, not cached; a UNC-shaped
  root is rejected before any filesystem call. `root` travels with every file channel
  rather than being remembered per window, because two windows can hold different
  workspaces.
- A write target that exists but does not resolve inside the root **throws** even when its
  parent is fine: `fs.writeFile` followed a committed symlink out of the workspace once.
- **Atomic writes are one implementation** ([`write.ts`](../../electron/fs/write.ts)): a
  unique temp sibling opened `wx` so a symlink planted at the temp name cannot be followed,
  then rename; the store uses the same function. A directory target is refused because its
  dirname would be the workspace's parent.
- Watching is non-recursive, on directories not files (an atomic writer destroys the inode a
  file watcher holds), and every `watch_paths` call **replaces** the window's whole scope so
  a collapsed directory cannot leak a watcher. Caps: 256 directories and 2,048 files per
  window, 512 paths per `stat_files` counted before deduplication, 64 roots per
  `workspace_for_path`. Events coalesce over 40ms in main and 100ms in the renderer.
- Listings are uncapped on purpose; the panel virtualizes. Symlink resolution runs through a
  32-wide async pool so a large directory cannot stall the event loop.

## Markdown

`.md` and `.markdown` open rendered; `.mdx` opens as source. ⌘⇧V (`toggle-markdown-view`,
macOS only) flips a document. The view is a read-only picture of the **live buffer**,
debounced 150ms, so it rides the external-change path for free.

The policy ([`markdown-policy.ts`](../../src/files/markdown-policy.ts)) is pure and exists so
the feature needs no Content Security Policy; nothing in it may grow a rule only a CSP would
enforce.

- Raw HTML is escaped and shown verbatim, not sanitized.
- A link carries its decision in `data-md-target` and its destination in `data-md-href`,
  never in `href`: there is nothing to follow, so nothing to intercept. `http`, `https`,
  `mailto` and `tel` go out through `shell_open_url` (which re-validates the scheme in main);
  an in-workspace relative link raises the same `requestPathOpen` a ⌘+click does; `#anchor`
  scrolls; `javascript:`, `data:`, `file:` and every unhandled scheme, and anything
  resolving outside the root by segment-wise comparison, render as plain text.
- Images are local only. A local image inside the root gets its bytes through
  `workspace_for_path` (containment answered in main) and `read_image_as_data_url`
  (extension allowlist, 1 MB cap); a remote image is a labelled placeholder, never a fetch.
  `read_file` cannot serve this because it refuses every PNG as binary.
- Fenced code is colorized by Monaco's own colorizer against the enumerated language set;
  `mermaid` is imported only when a document holds a fence, and a diagram that fails keeps
  its code block plus an error line.

## Browser tab

The browser is a chip on the strip whose surface is a native `WebContentsView`
([`electron/browser/view.ts`](../../electron/browser/view.ts)).

- **A native view paints above every DOM layer**, so the renderer tells the host when to hide
  it. `browserPanelObscured` in [`app-policy.ts`](../../src/ui/app-policy.ts) is wider than
  the focused-pane overlay check on purpose: any DOM pixel trying to paint over the stage
  (the quick picker, the consent modal, the Prompt Board, the persist-error bar, a settings
  load error) hides the view. The renderer measures its placeholder and sends the rectangle;
  the host never guesses one.
- One persistent session (`persist:deck-browser`) shared by every window; `sandbox: true`,
  no node integration, every permission request denied, `window.open` denied and handed to
  the OS. Only `http:` and `https:` load; `file:` is out because the panel injects a script
  into whatever it loads. A typed host that does not normalize opens nothing rather than a
  web search, because that would send the user's text off the machine.
- Closing the tab hides the view rather than destroying it, so a reopen keeps the route,
  scroll and dev-server session.
- **Inspect** injects the vendored react-grab bundle into the page's main world with its
  telemetry disabled before it initializes. A grab is untrusted: the preload forwards it only
  within 3 seconds of a trusted gesture and at most every 250ms, main enforces a second
  200ms floor, the payload is capped and re-parsed, and
  [`grab-format.ts`](../../src/browser/grab-format.ts) strips every C0 and C1 control so a
  bracketed-paste terminator cannot ride in. `GRAB_PASTE_DISABLED` in
  [`browser-store.ts`](../../src/browser/browser-store.ts) currently stops a grab at the
  clipboard; the paste path is kept, never submits, and is one constant away.

## Opening a path an agent printed

Detection ([`terminal-links.ts`](../../src/lib/terminal-links.ts)) is renderer-only and
reaches both hosts; routing is Electron only.

- Path segments use Unicode letter, mark and number classes so non-ASCII names match, and
  exclude symbols so an agent TUI's box-drawing characters cannot fuse into a path. Grammars:
  slashed, bare-with-extension, Windows drive, UNC and relative, tsc's `(line,col)`, quoted
  paths (the only route to a space) with Python's `, line N`, git's `a/` and `b/` prefixes
  stripped renderer-side, and ESLint's cross-line rows. At most 24 candidates per line.
  Boundaries are consumed groups, not lookbehinds, because a lookbehind throws at module
  evaluation on older JavaScriptCore.
- Resolution goes through `resolve_paths` in a batch; misses are cached for 5 seconds and
  hits for the pane's life, so a file an agent names before writing it becomes clickable.
- **A path inside a workspace this window has open always opens in Deck**, as a preview tab
  revealed at its line. Containment is answered by `workspace_for_path` in main through the
  path guard, and it returns the root as the renderer spelled it, because every
  file-surface lookup is keyed by that string. Anything else goes to the app selected on
  the split button beside `More`: editors keep the `open_editor` template (the only route
  that carries a line), git and terminal apps open the repository or directory, Finder
  reveals. Installed means the bundle exists; launch is `execFile` argv, never a shell string.
- The link provider raises `requestPathOpen` and never imports the file layer; `App` decides
  where the path opens, clearing the request before the await so a second click during a
  slow answer raises a fresh one.
- On Tauri, and in any host that cannot answer `external_apps`, an editor selection keeps its
  template, anything else falls back to VS Code, and the split button is hidden. On Windows,
  `open_editor` is unavailable and no external app bundle is detected.
