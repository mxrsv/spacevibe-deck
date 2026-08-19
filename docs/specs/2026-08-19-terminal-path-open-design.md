# Opening a path an agent printed — design

**Status:** approved and implemented 2026-08-20. Frozen — the record of what
was built, and what it cost, lives in
[docs/CONTEXT.md](../CONTEXT.md#opening-a-path-an-agent-printed--2026-08-20)
`current`. Two departures from the text below, both recorded there: the git
`a/` prefix is stripped by a shared `stripDiffPrefix` in `terminal-links.ts`
rather than inline in the provider, and the quoted-path rule matches DOUBLE
quotes only (a single quote pairs with the next apostrophe in prose and
swallows every path between them). §5's Tauri rule needed a mechanism the
design does not name: a host that cannot ANSWER `external_apps` is a third
state, not a machine with nothing installed, and `available` in
`external-apps-host.ts` is what tells the two apart. §4.2's icon mechanism is
also wrong in practice: `app.getFileIcon` returns the GENERIC document icon
for a `.app` bundle (measured 2026-08-20), so the icon is the bundle's own
`.icns` converted by `/usr/bin/sips` instead.
**Date:** 2026-08-19.
**Hosts:** detection reaches both; the Deck-editor target and the app launcher are
Electron-only. Tauri keeps today's behaviour whole.

## 1. What this is

Today ⌘+click on a path in terminal output launches an **external** editor
([`openCandidate`](../../src/terminal/link-provider.ts) `current`). This design
routes that click to Deck's own editor when the file belongs to a workspace the
window already has open, widens what counts as a path so more of what agents
actually print becomes clickable, and puts the external app on the chrome as a
split-button beside `More` instead of leaving it buried in Settings.

Three layers, deliberately separable:

| Layer                                           | Where it runs               | Reaches                                 |
| ----------------------------------------------- | --------------------------- | --------------------------------------- |
| 1. Detection — what text is a path              | renderer, pure              | both hosts                              |
| 2. Routing — Deck editor or external app        | renderer + one new channel  | Electron; Tauri keeps the external path |
| 3. External app catalog and its toolbar control | renderer + two new channels | Electron only                           |

**No agent integration exists or is needed.** Detection reads the characters on
the terminal line, so `claude`, `codex`, `gemini`, `opencode`, `cursor-agent`,
and any compiler or test runner they invoke, all travel one path. What differs
between agents is the _grammar_ they print paths in, which is §2's subject.

## 2. Layer 1 — detection

### 2.1 What already works

Measured against this machine's own `~/.claude` corpus (8 most recent Deck
sessions, 2026-08-19):

| Shape                             | Real sample                             | Today                         |
| --------------------------------- | --------------------------------------- | ----------------------------- |
| `path:line:col`                   | `src/files/ui/file-editor.tsx:65`       | works                         |
| bare relative path                | `FAIL  src/terminal/search-bar.test.ts` | works                         |
| absolute, `~/`, Windows drive/UNC | —                                       | works                         |
| Rust diagnostics                  | `--> src/main.rs:12:5`                  | works (space is a boundary)   |
| Claude Code tool lines            | `Read(src/foo.ts)`                      | works (parens are boundaries) |

[`extractLinkCandidates`](../../src/lib/terminal-links.ts) `current` is already
Unicode-aware, caps candidates per line, and treats box-drawing glyphs as
non-path characters, so TUI decoration cannot fuse into a candidate.

### 2.2 What is added

| Shape    | Real sample                                         | Gap                          | Fix                                                                                                                                    |
| -------- | --------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| tsc      | `src/ui/agent-quick-picker.test.tsx(340,15): error` | file links, **line is lost** | extend `SUFFIX` with a `\((\d+),(\d+)\)` alternative; the clickable text includes `(340,15)` so it parallels `:line:col`               |
| git diff | `--- a/src/terminal/tab-manager.ts`                 | not clickable at all         | renderer emits the **prefix-stripped** path as an extra entry in the same resolve batch and prefers the verbatim hit when both resolve |
| Python   | `File "src/x.py", line 12`                          | line not captured            | a quoted-path rule; also the only route to paths containing spaces, since the quotes bound the token                                   |
| ESLint   | path on one line, `12:5  error  …` below            | needs two lines              | its own module, §2.3                                                                                                                   |

The diff fix is **renderer-side on purpose**. Doing it in
[`resolveOne`](../../electron/links.ts) `current` would have to be mirrored in
[`links.rs`](../../src-tauri/src/links.rs) `current` or become a host parity gap,
and it would reshape a payload R6 freezes. Emitting a second candidate keeps
`resolve_paths` untouched on both hosts and hands Tauri the same improvement.

### 2.3 Cross-line (ESLint)

Sequenced **last**, in its own module, because it is the only part that reads
more than one logical line.

- The header line (`src/foo.ts`) already links today; this work only adds the
  line jump to the `12:5  error …` rows beneath it.
- Scan upward from the position row, capped at **50 logical lines**, stopping at
  the first line that is not a position row.
- **Cache hazard, must be handled:** the provider caches by
  `${cwd}\0${logical.text}` ([`link-provider.ts`](../../src/terminal/link-provider.ts)
  `current`). `12:5  error  no-unused-vars` is byte-identical under two different
  file headers, so a cross-line entry must key by the resolved header path as
  well, or bypass the cache entirely. Without this, the second file's rows open
  the first file's document.

## 3. Layer 2 — routing

### 3.1 The decision

On ⌘+click of a resolved path:

1. Ask the main process which open workspace root contains it.
2. A root answered → open the file in Deck's editor as a **preview** tab
   (`keep: false`, matching the tree's single click; the first edit promotes it)
   and reveal `line`/`column`.
3. No root → hand it to the app selected on the toolbar control (§4), by that
   app's declared rule.

Containment is decided **main-process side**, not by prefix-matching in the
renderer: `resolve_paths` answers canonical (realpath'd) absolutes while the
renderer holds workspace roots as raw strings, and comparing the two fails the
moment a root is itself a symlink — the `/tmp`-on-macOS case
[`path-guard.ts`](../../electron/fs/path-guard.ts) `current` documents. The new
channel reuses `resolveInsideRoot` and therefore inherits the same guard the
explorer's reads and writes already pass through. Roots are tried in the
clicked pane's own workspace first, then the window's others.

### 3.2 Wiring, and what does not move

`openCandidate` is the only routing change. The provider must not import the
file layer — it reaches it the way it already reaches chrome state, through a
window-scoped signal in [`chrome/events.ts`](../../src/chrome/events.ts)
`current` (the same module it already uses for `reportPersistError`). `App`
observes that signal and calls the controller.

This preserves two invariants: `TabManager` still knows nothing about files
(the seam [`file-surface-controller.ts`](../../src/files/file-surface-controller.ts)
`current` documents), and no R4 seam — PTY, materialization, layout, close —
is touched.

### 3.3 The reveal seam

[`openFile`](../../src/files/file-surface-controller.ts) `current` takes no
position, and nothing consumes `document.line`/`column` on open. Add an optional
position argument that writes a `pendingReveal` entry in
[`file-surface-store.ts`](../../src/files/file-surface-store.ts) `current`;
[`FileEditor`](../../src/files/ui/file-editor.tsx) `current` consumes and clears
it **after the model is attached**.

It has to be a stored request rather than an imperative call because Monaco
arrives through a dynamic `import()`: a click can land before the editor exists.
The same seam covers the already-open case — clicking a second path in a file
that is already on the stage goes through `activateFile`, which mounts nothing.

**Known trap on this path.** `FileEditor` returns `null` while
`documentFor(path)` is `undefined`, and its mount effect has `[]` deps, so an
editor that misses its first render never mounts (recorded 2026-08-19). Traced
for this design: [`openFileTab`](../../src/files/file-surface-store.ts) `current`
writes the empty document in the same synchronous call that sets
`activeFileTab`, and signal renders are batched, so the ⌘+click path renders
with a document present — the same path the tree's click already takes, which
Gate M passed packaged. It is **not** a prerequisite, but any change to that
ordering breaks this feature silently, so the reveal test must assert a mounted
editor rather than a store value.

## 4. Layer 3 — the external app

### 4.1 The control

A split-button at the stage strip's trailing end, immediately before `More`
([`feature-toolbar.tsx`](../../src/ui/toolbar/feature-toolbar.tsx) `current`):
the selected app's icon, then a caret. The icon opens the **active tab's
workspace folder** in that app; the caret opens a menu of the installed ones.

Menu order and grouping, hairline-separated per DL-23.5:

1. VS Code, Cursor, Zed
2. GitHub Desktop, GitKraken
3. Finder
4. Terminal, iTerm2, Ghostty, Hyper

### 4.2 Detection and icons

A catalog in the main process — the same shape
[`electron/agents.ts`](../../electron/agents.ts) `current` mirrors
`BUILTIN_AGENTS` in — declaring per app: id, label, group, macOS bundle path(s),
and how it opens a folder, a file, and a repo.

- **Installed** = the bundle exists. A `.app` is a directory, so the existing
  `dirs_exist` check is the mechanism; no new detection channel.
- **Icon** = `app.getFileIcon(bundlePath)` → `nativeImage` → data URL. The real
  icon of the version installed, and no third-party logo enters the repo.
- An app that is not installed is **absent from the menu**, mirroring how
  Settings › Agents splits Installed from Available.

Rendering the icon as an `<img>` with a data URL is not a DL-14.1 violation:
that rule governs authored `<svg>` functional icons, and
[`agent-logos.ts`](../../src/lib/agent-logos.ts) `current` is the standing
precedent for brand marks arriving as image assets.
`scripts/icon-system.test.ts` counts `<svg` occurrences and is unaffected.

### 4.3 What each app does with a target

One rule per app, declared in the catalog, so the ⌘+click fallback and the
button never disagree:

| Group       | ⌘+click on an out-of-workspace **file**                                           | Button click (a **folder**)                                                          |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Editors     | open at `file:line:col` through the existing validated `open_editor` CLI template | open the folder                                                                      |
| Finder      | reveal the file (`open -R`)                                                       | open the folder                                                                      |
| Terminals   | open the containing directory                                                     | open the folder                                                                      |
| Git clients | open the containing repository root; none found → say so                          | open the workspace's repository root, or the folder itself when git does not know it |

Launching is `execFile` with argv, never a shell string — the rule
[`electron/links.ts`](../../electron/links.ts) `current` already enforces for
editor templates.

## 5. Settings

One field replaces `editorId`/`editorCommand`: `externalAppId`, a catalog id.
The `Links & editor` category keeps its place in the rail and becomes the same
picker the caret menu shows — both write that one field, so the chrome and
Settings can never disagree. Settings is also the **only** picker on Tauri,
where the toolbar control does not exist.

**Migration and the feature it costs.** `editorId` `vscode`/`cursor`/`zed` map
to the same catalog app. A stored `custom` command has no catalog equivalent and
falls back to the first installed app in catalog order; **the custom editor
command stops being reachable**, which is a real loss and belongs in
`AGENTS.md`'s drift table the way the preset rename/delete loss does.

**On Tauri** the button does not exist, so a selection made under Electron can
be an app Tauri cannot launch. A non-editor selection there falls back to VS
Code's template — the alternative is a ⌘+click that does nothing on the host
users are still running.

**No kill switch in v1.** A path inside an open workspace always opens in Deck;
there is no switch and no second chord to force it outward. ⌘⌥+click is the
obvious later addition if this proves wrong in use.

## 6. IPC

Three new flat channels, Electron-only, payload keys written once in the
renderer facade per R6 (`scripts/electron-ipc-contract.test.ts` parses it):

| Channel              | Args                                         | Returns                                                  |
| -------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `workspace_for_path` | `{ path, roots }`                            | the containing root, or null                             |
| `external_apps`      | `{}`                                         | `[{ id, label, group, iconDataUrl }]` for installed apps |
| `open_in_app`        | `{ appId, path, isDirectory, line, column }` | void                                                     |

`resolve_paths` and `open_editor` are unchanged, so the Tauri twin stays valid.

## 7. Testing

- `terminal-links.test.ts` — one case per added grammar, each built from a real
  sample in §2.
- A pure `decideLinkTarget` unit — root answered vs not, per-app rule selection.
- Cross-line module — including the two-headers-same-position-row case that the
  cache would otherwise get wrong.
- Reveal — asserts a mounted editor at the right position, for both a cold open
  and an already-open file.
- `electron-ipc-contract.test.ts` — the three new channels.
- Catalog — every app declares all three open rules; no app is unreachable.

## 8. Verification owed

Suite and build are the floor, not the evidence. This design is not complete
until a native `npm run electron:dev` pass covers: a ⌘+click into Deck's editor
landing on the right line; a click on an out-of-workspace path reaching the
selected app; the button opening a workspace in each installed app; and the
menu showing exactly what is installed. Windows behaviour for detection,
launching and icons is **Gate C — unverifiable here**. Owner eye review of the
split-button is owed under DL §9.6.

## 9. Forks this opens

- **A split-button with a caret is a new control shape** in the feature toolbar
  (DL §23 today knows icon controls and the `More` menu only). One new rule.
- **The chrome carries an OS-supplied brand icon.** Not a DL-14.1 violation per
  §4.2, but the _source_ is new — icons that arrive at runtime from the user's
  machine rather than from the repo — and that deserves a sentence in §14.
- **Three new IPC channels and a settings-schema change**, both fork-listed
  categories.

## 10. Out of scope

Directories are not linkified (no line to land on), VS Code's `vscode://`
scheme is not used, cross-line grammars other than ESLint's, and any per-agent
parser.
