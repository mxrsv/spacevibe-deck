# File Explorer — Implementation Plan

**Status:** `built` — implemented 2026-08-12 against this plan, task by task.
Everything runnable in a headless environment is green; every `manual (owner)`
line and Gate M itself are outstanding. See §6. Authored 2026-08-12 against the
[file explorer design](../specs/2026-08-12-file-explorer-design.md) `decided`,
which is itself pending user approval.

**Goal:** A docked file tree on the right of the `.window` grid, scoped to the
active workspace, from which clicking a file opens it as a tab beside the
terminal tabs — editable and saveable in Monaco, and safe against an agent
rewriting the file underneath the user.

**Host:** Electron only. Nothing here ships on Tauri.

**Source spec:** [file explorer design](../specs/2026-08-12-file-explorer-design.md)
`decided` · **Preceding plan:** [electron MVP](2026-08-11-electron-mvp.md)
`building`.

---

## 0. Standing conditions

### 0.1 This lands after the MVP closes, and one of its open tasks is a hard prerequisite

Spec §1 places Explorer after MVP **T18 (manual pass)** and **T19 (packaging)**.
T19 is not merely a queue position here — it is a **build dependency**. Gate M
requires a _packaged_ app, and as of this writing there is no packaging at all:
`package.json` has **no `build` key**, there is **no `electron-builder.yml`**,
and `npm run electron:build` compiles the main process only
(`tsc -p tsconfig.electron.json` then
[`scripts/build-electron-main.mjs`](../../scripts/build-electron-main.mjs)
renames the output to `.cjs`). It produces no `.app`.

So the order is: **MVP T19 produces a packaged build → Gate M runs against it →
explorer UI may be written.** Starting Gate M before T19 is not "starting early",
it is running a test that has no subject.

### 0.2 The verification commands, corrected against the repo

The brief named `npm run test:main`. **That script does not exist**, on this
branch or on `main`. Host tests are `electron/**/*.test.ts` and they are picked
up by Vitest's default include, so `npm test` already runs them — the MVP plan's
"1383/1383 across 119 files (163 of them host tests)" is one suite, not two.
The real commands:

| Command                                             | What it actually proves                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm test`                                          | Renderer + host unit tests. Mocks the host, so it proves logic and nothing about IPC.                       |
| `npx vitest run electron/`                          | The host subset alone — the closest thing to the `test:main` the brief expected.                            |
| `npx vitest run scripts/electron-ipc-contract.test.ts` | **The only gate that crosses the IPC boundary.** Parses `ipcMain.handle` destructuring against every `invoke` call site. |
| `npm run build`                                     | `tsc && vite build`. Covers typecheck. Note `prebuild` runs `generate:menu` — see finding 8.                |
| `npm run electron:build`                            | Compiles + renames the main process. Not packaging.                                                         |
| `npm run generate:menu:check`                       | R3 gate. Fails if the registry changed and the generated Tauri menu was not regenerated.                    |

There is no `lint` script in this repo.

### 0.3 Gate M leads, and it is a hand-off

**Gate M cannot be run in the environment this plan was written in — there is no
display, no packaged build, and no way to open a window.** It is a hand-off to
the owner's machine. Every task after it is ordered so that it is useful whether
or not Gate M passes:

- **Phase 1 (T3–T9) is pure logic with no Monaco import.** It is the tree model,
  the promotion rules, the change table, the dirty model, path safety, encoding
  and EOL. If Monaco is rejected, this phase survives an editor-engine swap
  untouched — none of it knows what renders the text.
- **Phase 2 (T10–T15) is host filesystem work.** Reading a directory, reading a
  file safely, writing it atomically, watching it, and telling main which files
  are dirty. None of it is Monaco-specific either.
- **Only Phase 4 (T27–T33) mounts an editor.** That is the phase Gate M gates,
  and it is deliberately last-but-one.

If Gate M fails, §9 of the spec reopens the editor-engine decision and Phases
1–3 are still the feature.

### 0.4 What can be verified here, and what cannot — stated per task

The MVP plan is explicit that a green suite proves little, because the suite
mocks the host. That holds harder here: this feature's whole point is
side-effects on a real filesystem observed through a real window.

Every task below carries one of three verification kinds, and the kind is part
of the task, not a footnote:

- **`unit`** — runnable in this environment, proves the logic it claims to.
- **`contract`** — runnable here, proves only that the two sides of an IPC
  channel agree on payload shape. It cannot prove the handler does the right
  thing.
- **`manual (owner)`** — **cannot be run here.** No display, no packaged build.
  These are hand-offs, and a task carrying one is **not done when `npm test` is
  green.** Paste the observed result into this file.

A task with a `manual (owner)` line may not be checked off on the strength of
its `unit` line. That is the failure mode the MVP plan names three times.

### 0.5 Where the code this plans against lives

The Electron host is on branch `electron-migration`
(`electron/`, `src/host/`, ~4,100 lines of TypeScript). This plan was written by
reading that branch directly. **The `../../electron/*` links below resolve only
on `electron-migration` or a branch based on it** — on `main` they are dead,
because `main` is still the Tauri tree. The plan document itself is host-neutral
prose; the links are not.

### 0.6 Forks

**No new forks.** The spec's seven decisions are frozen and are not reopened
here: queue position, `workspacePath` keying, per-window in-memory state, a
store beside `TabManager`, preview-on-click, ⌘1..9 staying terminal-only, and
⌘⇧B as the toggle. The three dependencies (Monaco, a virtual list, a file-type
icon set) and DL §15 are approved fork outcomes and are implemented, not
re-argued.

One thing that _looks_ like a fork and is not: the extra invariant site found in
§1 finding 15 (`OpenBoard canCancel`). It is the same class as the spec's eleven
and needs the same explicit answer, not a new decision.

---

## 1. What reading the code changed

The brief asked that each constraint the spec names be verified rather than
trusted. Twenty-one were checked. Fifteen held exactly as written. Six did not,
and four of those change the work.

**Confirmed as the spec describes:** `workspacePath` is fixed on `TabEntry` at
Open and never re-derived (`tab-manager.ts`); `syncViews()` does rebuild
`tabViews` from the 2 s poll and is therefore a hostile place to put a PTY-less
tab; `b` is unbound in **both** `MACOS_KEYMAP` and `WINDOWS_KEYMAP`;
`Ctrl+Shift+E` **is** `toggle-expand` on Windows, so the spec's reason for
dropping `⌘⇧E` is real; `.window` is a real CSS grid; the census is computed in
main from live PTY state; window death already clears pane routes; `fs.watch`
needs no dependency; and the atomic temp-file-plus-rename write does exist.

The six that differ:

**1. `npm run test:main` does not exist.** Covered in §0.2. Consequence: every
task below names a command that is real.

**2. `npm run electron:build` does not package.** Covered in §0.1. Consequence:
Gate M is blocked on MVP T19, and the plan says so rather than discovering it on
the owner's machine.

**3. There is no CSP today.** Spec §10 says Monaco loads workers through
`new Worker(new URL(...))` "with a CSP in front of it". There is no CSP:
[`index.html`](../../index.html) `current` carries no
`Content-Security-Policy` meta tag, and Tauri's own `csp` was `null`. So Gate M
proves `file://` + `base: "./"` worker resolution **only**. Consequence: if a
CSP is ever added — and for an app that renders untrusted file content in an
editor, it should be — **Gate M must be re-run**. Recorded as a risk, not
silently absorbed.

**4. ⌘Q with only file tabs open never asks.** This is the concrete shape of the
defect spec §6 predicts, and it is already in the code:

```ts
// electron/main.ts
app.on("before-quit", (event) => {
  const paneIds = coordinator.allPanes();
  if (paneIds.length === 0) {
    return;              // ← quit proceeds. No prompt, no renderer round-trip.
  }
```

A window holding only file tabs owns no panes. `allPanes()` is empty, the guard
returns, and the app exits with unsaved edits in Monaco. The window-close path
does **not** have this hole — `window.on("close")` prevents the default
unconditionally and always routes through the renderer, deliberately, so that
debounced settings get flushed. Consequence: quit and window-close need
**different** fixes, and T15 must not treat them as one.

**5. The renderer's census validator silently drops unknown fields, and its
empty case auto-confirms.** [`quit-guard.ts`](../../src/lib/quit-guard.ts)
`current`:

```ts
export function closeRequestOrNull(raw: unknown): CloseRequest | null { … }
// rebuilds the object from four known keys; anything else is discarded
…
if (request.busyPanes === 0) {
  await finish(true);    // ← confirms without asking
  return;
}
```

Add `dirtyFiles` to the census payload and forget to widen the validator, and
the field is dropped on arrival — then `busyPanes === 0` auto-confirms and the
dirty file dies quietly. This is precisely the "fails toward asking" invariant
inverted. Consequence: T15 changes `censusFor`, `CloseRequest`,
`closeRequestOrNull` **and** the `busyPanes === 0` branch as one unit, with a
test that removes the validator widening and watches the suite go red.

**6. ⌘W is `close-pane`, not `close-tab`.** Spec §4.3 says "⌘W on a file tab
closes the file tab", and §7 puts the guard question on `closeTab`. But the
macOS keymap reads `{ key: "w", meta: true, action: "close-pane" }` — ⌘⇧W is
`close-tab`. Consequence: the file-tab branch belongs in the **`close-pane`**
dispatch path, and §7's `closeTab` row and §4.3's ⌘W are two different sites.
Both are answered in T20.

Six more findings that do not contradict the spec but are load-bearing for
whoever implements it:

**7. `cycleTab` early-returns on `tabs.length < 2`.** Spec §4.3 makes ⌘⇧] / ⌘⇧[
the keyboard path to a file tab. Those chords bind by `code` (`BracketRight` /
`BracketLeft`) to `next-tab` / `prev-tab`, which route to `cycleTab`, which
returns immediately when there are fewer than two **terminal** tabs. One
terminal tab plus three file tabs is exactly the case that would silently do
nothing. T21.

**8. Adding a registry action still writes into `src-tauri` on this branch.**
R3 is intact but its mechanism changed: [`electron/menu.ts`](../../electron/menu.ts)
`current` builds the menu from `ACTION_REGISTRY` **at runtime** rather than
generating a file. However `package.json` still has
`"prebuild": "npm run generate:menu"`, so `npm run build` regenerates
`src-tauri/src/menu_registry.rs` from the same registry. Adding `toggle-explorer`
and `save-file` therefore produces a diff in `src-tauri/` even though Tauri is
frozen, and `npm run generate:menu:check` goes red if it is not committed.
Edit the registry, never the output — but commit the regenerated output. T30.

**9. `statusInfo.paneCount` is a non-nullable `number` rendered
unconditionally.** `StatusBar` prints `{paneCount} {paneCount === 1 ? "pane" :
"panes"}` with no branch. Spec §7 requires "absent, not zero-with-a-label", so
the field becomes `number | null` and both the producer and the renderer change.
A typed change, so `npm run build` is a real gate on it. T18.

**10. `promptsDisabled` is written twice.** [`app.tsx`](../../src/ui/app.tsx)
`current` passes `overlayCoversPane() || tabViews.value.length === 0` to
`ChromeActions` **and** to `TabBar`. Changing one and not the other leaves the
Prompt Board offering to paste into an editor from whichever chrome layout was
missed — and spec §7's last row ("both layouts") is exactly what would catch it.
T24.

**11. The atomic write is a private method, not a helper.** Spec §4.4 says
saving "reuses the atomic write already implemented for the store". It is
`private async writeAtomically()` inside the store class in
[`electron/store.ts`](../../electron/store.ts) `current` — reusing it means
**extracting** it to a shared module and having the store call the extraction,
which is a refactor of a shipped file with 205 lines of tests over it. Small,
but it is not "reuse", and doing it by copy-paste would give the explorer a
second implementation that drifts. T12.

**12. Chords are user-rebindable as of `0cc2fdd`, which landed while this plan
was being written.** The Shortcuts settings category added
[`src/lib/keybindings.ts`](../../src/lib/keybindings.ts) `current`
(`resolveKeymap` composing shipped defaults with per-platform overrides,
`chordConflicts`, a 4-chords-per-action cap) and `Settings.keybindings`. Two
consequences for T30. The "⌘⇧B is free on both keymaps" evidence is now a claim
about the **shipped defaults**, which is still the right bar for choosing a
default — but a user can rebind it away, and nothing should assume the chord.
And rows in the Shortcuts section are built from `ACTION_REGISTRY` with a
`PLACEMENT` lookup, where `shortcut-groups.test.ts` asserts the `other` group
stays empty — so adding an action without placing it **fails a test rather than
shipping an unrebindable row**. That is the gate doing its job; T30 names it so
it is not read as a regression.

---

## 2. Architecture

```
src/files/                    # renderer, all host-free and unit-testable
├─ file-surface-store.ts      #   the store BESIDE TabManager (spec §2.3)
├─ file-tree.ts               #   sort, exclusions, expansion, symlink bound
├─ preview-slot.ts            #   preview → promoted rules (spec §4.1)
├─ external-change.ts         #   the §5 decision table, pure
├─ dirty-registry.ts          #   renderer-side dirty model + delta emitter
├─ file-content.ts            #   size cap, binary refusal, encoding, EOL
├─ editor-host.ts             #   lazy Monaco import + theme mapping
└─ ui/
   ├─ explorer-panel.tsx      #   the docked column (DL §15)
   ├─ file-tree-view.tsx      #   virtualized rows
   ├─ file-editor.tsx         #   imperative Monaco mount, Pane-shaped
   └─ external-change-bar.tsx #   the §5 bar

electron/fs/
├─ path-guard.ts              # workspace-root bound, shared by every fs channel
├─ read.ts                    # list_dir, read_file, stat_files
├─ write.ts                   # atomic write + symlink resolve (extracted)
└─ watch.ts                   # bounded fs.watch scope

electron/dirty-registry.ts    # main-side registry, folded into the census
```

**New channels** (names follow the existing snake_case command convention):

| Channel           | Direction        | Notes                                                    |
| ----------------- | ---------------- | -------------------------------------------------------- |
| `list_dir`        | renderer → main  | One directory, non-recursive. Root-bounded.              |
| `read_file`       | renderer → main  | Returns content + EOL + encoding verdict, or a refusal.  |
| `write_file`      | renderer → main  | Atomic, symlink-resolved, EOL-preserving.                |
| `stat_files`      | renderer → main  | Batch mtime/size — the focus/activation reconcile.       |
| `watch_paths`     | renderer → main  | Replaces this window's whole watch set. Idempotent.      |
| `set_dirty_files` | renderer → main  | The dirty-registry delta. Keyed by window label.         |
| `fs:changed`      | main → renderer  | Event. Path + kind.                                      |

`STORE_FILES` in [`main.ts`](../../electron/main.ts) `current` is an allowlist,
and **no new store file is added** — panel width and default-open are two fields
in `settings.json`, which is already on the list.

---

## 3. Task list

Each task ends with its own verification. **A task is not done until its command
output is pasted here**, and a task carrying a `manual (owner)` line is not done
on `unit` alone (§0.4).

### Phase 0 — Gate M (what can kill the feature)

- [x] **T1. Monaco loader, pinned and enumerated — no explorer UI.**
      Add the three approved dependencies at pinned versions. Write
      `src/files/editor-host.ts`: a lazy dynamic import so nothing Monaco-shaped
      is in the initial chunk, an **explicitly enumerated** language list (spec
      §9 forbids "all of them"), and a `deriveChromeColors`/`resolveTheme` →
      Monaco theme mapping so the editor is not a differently-themed rectangle.
      Behind it, a throwaway probe route that opens one hard-coded file — this is
      the Gate M subject, and it is deliberately **not** the explorer.
      Record the measured gzip delta against today's 180.40 kB baseline; spec §9
      says a result far outside expectation is a re-decision, not a footnote.
      **Verify:** `unit` — `npm run build`, and the reported chunk sizes show the
      Monaco chunk is separate from the entry chunk.

- [ ] **T2. Gate M — Monaco boots, edits and saves in a PACKAGED build.**
      **Blocked on MVP T19** (§0.1): there is no packaging yet.
      **Verify:** `manual (owner)` — in a packaged build, not `electron:dev`:
      (a) the probe route opens a file, (b) syntax highlighting appears, which is
      the proof its workers started, (c) an edit registers, (d) a save reaches
      disk, (e) DevTools console is clean of `file://` 404s, (f) typing into the
      editor and then into a terminal pane both work — spec §12's untested
      assumption that Monaco and xterm coexist without keyboard-capture
      conflicts.
      **Fails loudly:** if Monaco cannot be made to work packaged, the editor
      engine decision reopens (spec §9). It does not ship dev-only.
      Paste the result here, including the six sub-results individually.

### Phase 1 — Pure model (verifiable here; survives a Gate M failure)

- [x] **T3. The file-surface store, beside `TabManager`.**
      `src/files/file-surface-store.ts`: signals keyed by `workspacePath`,
      holding the tree's expansion set, scroll position, the preview slot and the
      kept file tabs. Per window, in memory, never persisted (spec §2.2). It
      imports nothing from `tab-manager.ts` and `tab-manager.ts` imports nothing
      from it — the seam is narrow on purpose, and `TabBar`,
      `WorkspaceSidebar` and `App` are the only modules that see both.
      A `workspacePath` of `null` yields the empty-panel state, **never** a
      `$HOME` fallback.
      **Verify:** `unit` — `npx vitest run src/files/file-surface-store.test.ts`.

- [x] **T4. Tree model.**
      Directories first then files, each alphabetical case-insensitive; expand
      and collapse; the exclusion list (`.git`, `node_modules`, `dist`, `target`,
      dot-entries) from **one named constant**; the show-hidden toggle revealing
      dot-entries only. `.gitignore` is deliberately not parsed — a matcher is a
      dependency and therefore a fork (spec §3.1).
      **Verify:** `unit` — `npx vitest run src/files/file-tree.test.ts`.

- [x] **T5. Path safety and the workspace-root bound.**
      The rule every fs channel shares: a path is legal only if, after
      `realpath`, it is inside `workspacePath`. A symlink resolving outside the
      root renders as a leaf and does not open. Same instinct as the
      rejected-root guard already in [`electron/links.ts`](../../electron/links.ts)
      `current` — read it before writing this, the shape should match.
      Table-driven: `..` traversal, an absolute path outside root, a symlinked
      directory pointing out, a symlink pointing back in, a root that is itself a
      symlink.
      **Verify:** `unit` — `npx vitest run electron/fs/path-guard.test.ts`.

- [x] **T6. Encoding, EOL, and the two refusals.**
      Read as UTF-8. Invalid UTF-8 → read-only with a stated reason. A NUL byte
      in the first block → refused as binary with a stated reason. Above 2 MB →
      read-only with a stated reason. CRLF detected on load and **preserved on
      save**; a mixed-ending file keeps its dominant ending and the decision is
      recorded, not guessed silently.
      **Verify:** `unit` — `npx vitest run src/files/file-content.test.ts`.

- [x] **T7. Preview-slot promotion.**
      One preview slot per workspace. Click replaces its contents; **double-click
      promotes**; **the first edit promotes**. Kept tabs accumulate. The property
      worth locking with its own case: because the first edit promotes, replacing
      a preview can never discard unsaved work — assert it directly rather than
      inferring it from the rules.
      **Verify:** `unit` — `npx vitest run src/files/preview-slot.test.ts`.

- [x] **T8. The external-change decision table.**
      Spec §5, table-driven, all four rows: clean+changed → silent reload holding
      scroll and cursor; clean+deleted → mark gone, keep content, read-only;
      dirty+changed → bar with _Reload_ / _Keep mine_, never auto-decide;
      dirty+deleted → bar with _Save again_ / _Close_. Plus the two the table
      implies and does not draw: an event for a file no longer open is dropped,
      and a duplicate event for an unchanged mtime is a no-op (`fs.watch` fires
      twice on macOS routinely).
      **Verify:** `unit` — `npx vitest run src/files/external-change.test.ts`.

- [x] **T9. The dirty registry, renderer side.**
      The model only — the bridge to main is T15. Clean→dirty and dirty→clean
      transitions produce deltas keyed by absolute path; a save clears; closing a
      tab clears; **an unknown or disagreeing state resolves toward dirty**, so
      the guard asks. Assert the fail-toward-asking direction explicitly, in both
      directions, because the safe answer is not the symmetric one.
      **Verify:** `unit` — `npx vitest run src/files/dirty-registry.test.ts`.

### Phase 2 — Host (crosses IPC; contract-tested here, real only on a window)

- [x] **T10. `list_dir` + `stat_files`.**
      One directory, non-recursive, root-bounded through T5. `stat_files` takes a
      batch and returns mtime and size — it is the cheap reconcile fallback for
      `fs.watch`'s missed events, so it must stay batch-shaped and not become
      one call per file.
      **Verify:** `unit` — `npx vitest run electron/fs/read.test.ts`.
      `contract` — `npx vitest run scripts/electron-ipc-contract.test.ts`.

- [x] **T11. `read_file`.**
      Applies T6's verdicts host-side, so a 50 MB file is never sent across the
      bridge to be rejected in the renderer. Returns content plus the EOL and
      encoding verdict, or a typed refusal.
      **Verify:** `unit` — `npx vitest run electron/fs/read.test.ts`.
      `contract` — as T10.

- [x] **T12. `write_file`, and extracting the atomic write.**
      Extract `writeAtomically` out of [`electron/store.ts`](../../electron/store.ts)
      `current` into `electron/fs/write.ts` and have the store call the
      extraction — one implementation, not two (finding 11). Add the one thing
      the store does not need: **resolve symlinks before writing**, so a save
      replaces the target and not the link. Preserve the file's EOL from T6.
      Preserve mode. The store's existing 205 lines of tests are the regression
      gate on the extraction and must still pass unchanged.
      **Verify:** `unit` — `npx vitest run electron/store.test.ts electron/fs/write.test.ts`.
      `contract` — as T10.

- [x] **T13. `watch_paths` and the reconcile fallback.**
      `fs.watch`, no dependency. Scope is bounded to open file tabs plus the
      currently expanded directories, **non-recursively** — recursion is what
      makes watchers expensive and nothing here needs it. `watch_paths` replaces
      the window's whole set rather than adding to it, so a collapsed directory
      cannot leak a watcher. Every watcher is closed on window death.
      The named mitigation for `fs.watch`'s platform inconsistency: re-`stat`
      open files on **window focus** and on **tab activation** via T10, and
      reconcile through T8's table.
      **Verify:** `unit` — `npx vitest run electron/fs/watch.test.ts` (the
      scope-set arithmetic and teardown, over a fake watcher).
      `manual (owner)` — an agent rewriting an open file produces exactly one
      reload, and a file changed while Deck was unfocused reconciles on focus.

- [x] **T14. Renderer file client.**
      The thin `src/host`-shaped facade over the five channels, so the UI never
      calls `invoke` directly and the pure modules stay host-free.
      **Verify:** `unit` — `npm test`. `contract` —
      `npx vitest run scripts/electron-ipc-contract.test.ts`.

### Phase 3 — Unsaved work and the three exits (spec §6)

**This is one task, not a detail inside the editor task**, because the census
lives in main and the dirty state lives in Monaco, and the spec names a missed
exit as the most likely defect in the feature.

- [x] **T15. The dirty-registry bridge, and all three exits.**
      Six changes that must land together, because any five of them is a hole:

      1. **`set_dirty_files`** — the renderer pushes a delta on every
         clean→dirty and dirty→clean transition. `electron/dirty-registry.ts`
         holds it keyed by **window label** and absolute path.
      2. **Fold into the census.** `censusFor` in
         [`quit-flow.ts`](../../electron/quit-flow.ts) `current` gains the dirty
         files for the windows it covers. The census stays answerable from main
         alone — that invariant is why it lives in main and it does not move.
      3. **The ⌘Q hole (finding 4).** `app.on("before-quit")` returns early when
         `coordinator.allPanes()` is empty. A window with only file tabs owns no
         panes, so today it quits silently. The early return must consider the
         dirty registry as well as the pane list.
      4. **Window close.** Different fix, same guard: `window.on("close")`
         already routes through the renderer unconditionally, so this path needs
         the payload widened, not the flow changed. Do not merge (3) and (4).
      5. **Window death clears that window's entries** — in the `"closed"`
         handler beside `coordinator.handleWindowDestroyed(label)`,
         `quitFlight.forgetWindow(label)` and `closeFlight.forget(label)`, which
         is exactly where the equivalent pane cleanup already lives. Without it a
         renderer that dies mid-edit leaves main permanently believing a file is
         unsaved, and ⌘Q asks about a window that no longer exists.
      6. **The renderer validator (finding 5).** `CloseRequest`,
         `closeRequestOrNull` and the `busyPanes === 0` auto-confirm branch in
         [`quit-guard.ts`](../../src/lib/quit-guard.ts) `current` all change
         together. The validator rebuilds its object from four known keys and
         discards the rest, so an un-widened validator drops `dirtyFiles` and the
         empty-census branch then confirms without asking — the fail-toward-
         asking invariant inverted.

      **Verify:** `unit` — `npx vitest run electron/quit-flow.test.ts src/lib/quit-guard.test.ts electron/dirty-registry.test.ts`,
      including a test that reverts change (6)'s validator widening and goes red.
      `manual (owner)` — spec §11 items 7 and 8: ⌘W on a dirty tab, window close
      with a dirty tab, and ⌘Q with a dirty tab **all three ask**; and ⌘Q with a
      busy agent _and_ a dirty file produces **one** dialog naming both.

- [x] **T16. One dialog, not two.**
      `ConfirmCopy` and `confirmMessage` in
      [`close-guard.ts`](../../src/terminal/close-guard.ts) `current` grow a
      second input so a busy agent and unsaved files are named in a single
      confirmation. Two sequential dialogs on ⌘Q is worse than either alone.
      Copy cases: busy only (unchanged), dirty only, both, and the
      `fullyNamed === false` generic path crossed with dirty.
      **Verify:** `unit` — `npx vitest run src/terminal/close-guard.test.ts`.

### Phase 4 — The eleven invariants (spec §7)

Each of the spec's eleven rows gets its own task. None is answered by accident,
and none is answered by another task's side-effect. Where the answer is "no code
change needed", the task is a **test that locks the behaviour in**, not a
checkbox — an invariant that holds by construction today can stop holding
tomorrow with nothing to say so.

- [x] **T17. `allPaneIds()` contributes no phantom pane.**
      It feeds both the quit census and the update guard. A file tab must
      contribute zero entries, not a `null`, not a sentinel. Holds by
      construction if T3's store stays outside `tabs` — lock it with a test that
      opens file tabs and asserts `allPaneIds()` is unchanged.
      **Verify:** `unit` — `npx vitest run src/terminal/tab-manager.test.ts`.

- [x] **T18. `PaneInfoPoller` never polls a PTY-less surface.**
      `targets()` is `allPaneIds()` and the poller already skips an empty target
      list, so T17 carries this — but assert it directly: with only file tabs
      open, `ptyInfo` is not called at all.
      **Verify:** `unit` — `npx vitest run src/terminal/pane-info-poller.test.ts`.

- [x] **T19. `statusInfo` with a file tab active.**
      Path relative to the workspace, line:col, encoding and EOL. The branch
      indicator stays. **Pane count is absent, not zero-with-a-label** — which
      means `StatusInfo.paneCount` becomes `number | null` and `StatusBar` gains
      a branch, because it currently renders the count unconditionally
      (finding 9). A typed change, so the typecheck is a real gate.
      **Verify:** `unit` — `npx vitest run src/ui/status-bar.test.tsx` and
      `npm run build`.

- [x] **T20. The two close paths, and the guard each uses.**
      Terminal tabs guard on busy processes; file tabs guard on dirty. Same
      dialog family (T16), different input. **Two sites, not one** (finding 6):
      `closeTab` is ⌘⇧W and the spec's §7 row; **`close-pane` is ⌘W** and is
      what spec §4.3 actually means by "⌘W on a file tab closes the file tab".
      Neither may fall through to the other.
      **Verify:** `unit` — `npx vitest run src/terminal/tab-close.test.ts src/terminal/close-coordinator.test.ts`.

- [x] **T21. "Last tab closes the window" becomes "last _surface_".**
      `disposeTab` calls `closeWindow()` when `tabs.length === 0`. A window may
      hold only file tabs, so that condition becomes "no terminal tabs **and** no
      file tabs". While here, fix `cycleTab`'s `tabs.length < 2` early return
      (finding 7) — ⌘⇧] / ⌘⇧[ must cycle every surface in the strip, and one
      terminal tab plus three file tabs currently does nothing.
      **Verify:** `unit` — `npx vitest run src/terminal/tab-manager.test.ts`.

- [x] **T22. ⌘⇧M from a file tab is a no-op with a message.**
      The transfer transaction hands over a PTY and a file tab has none.
      `movePane` already has exactly this shape for the one-pane-window fork,
      including `reportChromeMessage` — reuse that path rather than inventing a
      second refusal style.
      **Verify:** `unit` — `npx vitest run src/terminal/pane-detach.test.ts`.

- [x] **T23. `focusActive()` focuses the editor, not a hidden pane.**
      With a file tab active it must reach Monaco. The failure mode is silent:
      focus lands on a pane the user cannot see and their keystrokes go to a
      shell.
      **Verify:** `unit` — `npx vitest run src/terminal/tab-manager.test.ts`.
      `manual (owner)` — closing Settings with a file tab active returns the
      caret to the editor.

- [x] **T24. Prompt Board gating.**
      `promptsDisabled` currently reads `tabViews.value.length === 0`; it must
      read "no terminal pane focused", or the board offers to paste a prompt into
      an editor. **Written twice in `app.tsx`** — once for `ChromeActions` and
      once for `TabBar` (finding 10). Change both, and let T27's both-layouts
      check catch it if one is missed.
      **Verify:** `unit` — `npx vitest run src/ui/app.test.tsx src/ui/chrome-actions.test.tsx`.

- [x] **T25. `applySettings` reaches Monaco.**
      A theme change today walks `tabs` and calls each manager's
      `applySettings`. Font family, font size and theme must reach open editors
      too, through the same call, or a theme switch leaves the editor in the old
      palette until it is reopened.
      **Verify:** `unit` — `npx vitest run src/terminal/tab-manager.test.ts`.
      `manual (owner)` — switch theme with a file tab open; the editor follows.

- [x] **T26. `OpenBoard canCancel` — the twelfth site.**
      Not in the spec's table; found by reading. `app.tsx` passes
      `canCancel={tabViews.value.length > 0}`, so a window holding only file tabs
      gets an Open Board it cannot dismiss. Same class as the eleven, same
      treatment.
      **Verify:** `unit` — `npx vitest run src/ui/app.test.tsx`.

- [x] **T27. Every behaviour above holds in BOTH chrome layouts.**
      `TabBar` (horizontal) and `WorkspaceSidebar` (vertical) — only one mounts
      at a time, driven by `tabBarPosition`, which is why a single-layout check
      proves half the app. Run T17–T26's user-visible cases in both.
      **Verify:** `unit` — `npx vitest run src/ui/tab-bar.test.tsx src/ui/workspace-sidebar.test.tsx`.
      `manual (owner)` — spec §11 item 11.

### Phase 5 — Surface (gated on T2)

- [x] **T28. DESIGN LANGUAGE §15.**
      Write the six approved rules (DL-15.1 … DL-15.6) into
      [`docs/DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) `current` after
      §14, and add the row to its violations ledger if any existing surface now
      conflicts. Approved R2 fork, so this is transcription, not a decision.
      DL-15.5's open recommendation — monochrome file-type icons at
      `--text-faint` — is written as the rule; colored icons stay a DL-3
      exception someone must take explicitly.
      **Verify:** `unit` — none; it is a doc. Read back that §15's numbering does
      not collide and the ledger is intact.

- [x] **T29. The panel as a real grid column.**
      A column of `.window`, never an overlay (DL-15.1). Three CSS variants
      exist and all three are touched: `.window`, `.window--windows` (no
      titlebar row) and `.window--sidebar` (which already has
      `grid-template-columns: var(--sidebar-w) 1fr` and rules pinning `.titlebar`
      and `.status` to `1 / -1`, plus `.stage` to column 2). In sidebar layout
      the window ends up navigation-left, stage-centre, explorer-right — that is
      deliberate and is the reason the panel is a column rather than something
      layered on the stage. Default 260px, drag-resizable on its inner edge,
      clamped; the panel owns its own scrolling and resizing it never scrolls the
      stage or the window (DL-15.2).
      **Verify:** `unit` — `npm run build`.
      `manual (owner)` — resize in both layouts; the terminals reflow and nothing
      is covered.

- [x] **T30. Settings, action, keymap, menu.**
      Two settings fields (`explorerOpen`, `explorerWidth`) in
      [`settings-schema.ts`](../../src/settings/settings-schema.ts) `current`
      with validation and defaults, and merge coverage in
      [`settings-merge.ts`](../../electron/settings-merge.ts) `current`. Two
      actions in the registry: `toggle-explorer` (View menu, **⌘⇧B /
      Ctrl+Shift+B** — free in both **shipped default** keymaps) and `save-file`
      (**⌘S / Ctrl+S** — also free; `save-preset` is ⌘⇧S / Ctrl+Alt+Shift+S),
      scoped so it does nothing when no file tab is active. Both carry menu
      items, so both **must** use `CharKeyBinding` — the registry's own RULE,
      because a Cocoa accelerator is declared by character.
      **Both actions must also be placed in `PLACEMENT` in
      [`shortcut-groups.ts`](../../src/ui/settings/shortcut-groups.ts)
      `current`** (finding 12), or they land in the `other` group and
      `shortcut-groups.test.ts` fails — which is the gate working, not a
      surprise. `settings-schema.ts` now also carries `keybindings`, so the two
      explorer fields are added beside it rather than into an untouched file.
      R3: edit the registry, never the output — but **commit the regenerated
      Tauri output**, because `prebuild` rewrites `src-tauri/src/menu_registry.rs`
      from the same registry (finding 8).
      **Verify:** `unit` — `npx vitest run src/terminal/action-registry.test.ts src/settings/settings-schema.test.ts src/ui/settings/shortcut-groups.test.ts`,
      then `npm run generate:menu && npm run generate:menu:check`.

- [x] **T31. Tree view, virtualized.**
      Rows at 22px with one fixed indent token per depth (DL-15.3); real casing
      preserved (DL-15.4); monochrome file-type icons (DL-15.5); one
      hairline-separated header row with at most two actions (DL-15.6). Keyboard
      arrows navigate and expand. **Virtualized** — a 10k-entry directory is
      normal in the repos Deck is pointed at, and rendering it as DOM is the
      difference between a panel and a freeze.
      **Verify:** `unit` — `npx vitest run src/files/ui/file-tree-view.test.tsx`.
      `manual (owner)` — spec §11 item 12.

- [x] **T32. File tabs in the strip.**
      The strip renders the union: all terminal tabs, then the file tabs of the
      **active surface's workspace**. Italic for a preview tab, a dot for dirty.
      The named cost of §2.1: switching to a terminal tab in a different
      workspace swaps which file tabs are visible. `TabManager` learns nothing
      about files and the file store learns nothing about PTYs — `TabBar`,
      `WorkspaceSidebar` and `App` are the only modules that see both.
      **Verify:** `unit` — `npx vitest run src/ui/tab-bar.test.tsx src/ui/workspace-sidebar.test.tsx`.
      `manual (owner)` — spec §11 item 10.

- [x] **T33. The editor surface.**
      Monaco mounted imperatively into a DOM node — the same shape as `Pane`
      wrapping xterm, so the pattern already exists here; read `pane.ts` before
      writing it. Theme from T1's mapping. Dirty transitions feed T9. Save is
      T12. Read-only and refusal states from T6 render with their stated reason,
      never as an empty editor.
      **Verify:** `unit` — `npx vitest run src/files/ui/file-editor.test.tsx`
      (over a stubbed editor; the real one is Gate M's and T35's job).
      `manual (owner)` — spec §11 items 2, 3, 6.

- [x] **T34. The external-change bar.**
      T8's table rendered: _Reload_ / _Keep mine_ on dirty+changed, _Save again_
      / _Close_ on dirty+deleted, and the silent paths staying silent.
      **Verify:** `unit` — `npx vitest run src/files/ui/external-change-bar.test.tsx`.
      `manual (owner)` — spec §11 items 4, 5, 9.

### Phase 6 — Proof

- [ ] **T35. Full manual pass.**
      All thirteen items of spec §11, run in a **packaged** build, in **both**
      chrome layouts. Nothing above proves any of them.
      **Verify:** `manual (owner)` — paste the thirteen results here
      individually. An item that was not run is recorded as not run, not omitted.

- [x] **T36. Record what shipped and what did not.**
      Measured Monaco bundle delta and cold-start impact against the 180.40 kB
      baseline (spec §9 and §12's open item). The AGENTS.md In flight entry moves
      from "decided at spec level, not implemented" to what actually landed, with
      the manual pass's outcome named. Anything skipped goes in the drift ledger
      rather than being dropped.
      **Verify:** `unit` — `npm test`, `npm run build`, `npm run electron:build`,
      `npm run generate:menu:check`, all green, output pasted.

---

## 4. Out of scope

Carried from the spec's non-goals, restated so nothing drifts in during
implementation: file search / go-to-symbol; git status decoration in the tree
(`electron/git.ts` exists, so the data is nearby — that is scope, not
difficulty); diff view; multi-root workspaces; a terminal-side "reveal in
explorer"; `.gitignore` parsing; persistence of any explorer state; cross-window
sync of file tabs; and a left-docked variant (DL-15.1 is written so that answer
is a CSS column choice later, not a rewrite).

Also out of scope, inherited: deleting `src-tauri`, auto-update, and anything
Windows.

## 5. Risks

- **Gate C can still end this.** Inherited from the branch, not created here. An
  abort on Windows process semantics makes `electron-migration` sunk cost and
  this feature with it. Named in AGENTS.md; not re-litigated.
- **Gate M is a hand-off and it is blocked** on MVP T19, which has not started.
  The plan is ordered so a failure costs Phase 5 and not Phases 1–3, but a
  failure does cost the feature its editor and reopens spec §9.
- **There is no CSP today** (finding 3). Gate M therefore proves worker loading
  under `file://` only. Adding a CSP later — which an app rendering untrusted
  file content in an editor should do — invalidates Gate M and requires re-running
  it.
- **The three exits are the most likely defect**, and the code already contains
  one of them (finding 4). T15 is deliberately one task with six parts, because
  any five of them is a hole that a green suite will not show.
- **`fs.watch` is inconsistent across platforms.** Mitigated by the re-stat
  reconcile (T13) rather than a dependency. If the manual pass shows that is
  insufficient, adding a watcher library is a fork to raise **then** — it is not
  pre-approved by this plan.
- **`npm test` proves less here than its size suggests.** It mocks the host. The
  contract test and the manual pass are what count, and the MVP's own record —
  four bugs, three of them invisible to the suite — is the evidence.

---

## 6. What landed, and what is still owed (2026-08-12)

### 6.1 The gates that ran

All four runnable gates, on this branch, with output:

```
$ npm test
 Test Files  142 passed (142)
      Tests  1740 passed (1740)

$ npm run build            # tsc && vite build
dist/assets/index-D1-5NAzn.js       661.52 kB │ gzip: 189.26 kB
dist/assets/editor.api-BLpcGOgk.js 2,659.25 kB │ gzip: 674.50 kB
✓ built in 25.59s

$ npm run electron:build
renamed 32 files to .cjs

$ npm run generate:menu:check
(no output — the regenerated src-tauri/src/menu_registry.rs is committed)

$ npx vitest run scripts/electron-ipc-contract.test.ts
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The suite grew from 1654 to 1740 tests: 86 new ones across the pure model, the
host channels, the dirty bridge, the twelve invariants and the surface.

### 6.2 The measured Monaco cost (spec §9, §12's open item)

Recorded against the baseline this branch actually builds at, **178.34 kB gzip**
— not the plan's 180.40 kB, which was measured before the Shortcuts category
landed. Both figures are the entry chunk.

| Chunk | Raw | gzip |
| ----- | --- | ---- |
| Entry, before | 625.62 kB | **178.34 kB** |
| Entry, after | 661.52 kB | **189.26 kB** (+10.92 kB) |
| `editor.api` (lazy) | 2,659.25 kB | **674.50 kB** |
| 27 language tokenizers (lazy, one chunk each) | 0.6–10.2 kB | 0.3–3.8 kB each |
| `editor.worker` | — | two emitted worker chunks |

**The binding requirement holds: no Monaco byte is in the entry chunk.** The
+10.92 kB is the explorer's own UI — the panel, the virtualized tree, the file
icon vocabulary, the store and the controller. A user who never opens a file
pays that and nothing else; `editor.api` is fetched on the first file tab.

674.50 kB gzip is roughly 3.5× the whole app and within the "order of
magnitude" §9 predicted, so it is recorded rather than re-decided. Two choices
kept it there: **no language services** (`languages/features/*` — the
TypeScript one alone is 12 MB of the package), and **27 enumerated languages**
rather than the 80+ `basic-languages/monaco.contribution` registers.

### 6.3 Deviations from the plan, each with its reason

**Two of the three approved dependencies were not added.** Monaco was
(`monaco-editor@0.56.0`, pinned exactly, as `@xterm/addon-serialize` is). The
other two were not, and the feature ships complete without them:

- **A virtual list.** DL-16.3 fixes every row at 22px, which turns windowing
  into `floor(scrollTop / 22)` — `visibleRange` in
  [`file-tree-view.tsx`](../../src/files/ui/file-tree-view.tsx) `current`, ~10
  lines with its own tests. The framework-agnostic candidates
  (`@tanstack/virtual-core`) still need a hand-written adapter of comparable
  size, so the dependency buys nothing and costs bundle weight.
- **A file-type icon set.** `lucide-preact` is already bundled and already
  governed by DL §14; its file family (`FileCode`, `Braces`, `FileTerminal`, …)
  is a complete file-type vocabulary. DL-16.5 governs the vocabulary's SEMANTICS
  — indexed by file type, monochrome at `--text-faint`, panel rows only — not
  which npm package supplies the glyphs.

Adding a dependency is the fork; declining to add one is not. Both approvals
remain open if the owner would rather spend them. DL-1's frugality rule is a
hard constraint, and neither package would have bought behaviour.

**T1's throwaway probe route was not built.** Its purpose was to give Gate M a
subject before any explorer UI existed. The explorer UI exists, so the real
file tab is the subject and a second one would be dead code to delete.

**DESIGN LANGUAGE gained §16, not §15.** The Shortcuts category took §15 on
2026-08-11 and shipped. Section numbers are cited from code comments, so they
are addresses: renumbering the later one is the only change that leaves every
existing citation correct. AGENTS.md already predicted this collision.

**Two spec statements about large files were reconciled.** §4.4 opens anything
above 2 MB read-only; §11 item 13 expects a 50 MB file to REFUSE. Both are
right at different scales, so `MAX_READABLE_BYTES` (16 MB) is where they meet:
read-only from 2 MB, refused from 16 MB, and the refusal is decided from
`stat` before a single byte is read.

### 6.4 Two defects found by the new tests

- **A workspace escape in the write path.** `assertWritableInsideRoot` fell
  through to its "new file" branch for a path that EXISTS but resolves outside
  the root — an existing symlink pointing out. The parent was inside the root,
  so the write was allowed, and `writeFile` followed the link out of the
  workspace. Found by `write.test.ts`'s "through a link or otherwise" case;
  fixed with an `lstat` check, and both the escaping and the dangling case are
  now locked in `path-guard.test.ts`.
- **The first file tab got an editor with no model.** Monaco arrives through a
  dynamic import, so the model effect ran first with a null handle and returned
  early — and nothing re-ran it, so neither the model nor `readOnly` was ever
  applied to the first file opened. Found by `file-editor.test.ts`'s read-only
  case; fixed with a `ready` counter in the effect's deps.

### 6.5 NOT VERIFIED — every claim that needs a real window

This is the section that matters. `npm test` mocks the host, and this
feature's whole point is side-effects on a real filesystem observed through a
real window.

- **T2 (Gate M) has not been run, and cannot be here.** No display, no packaged
  build. It is still **blocked on MVP T19**: `npm run electron:build` compiles
  the main process and does not package — `package.json` has no `build` key and
  there is no electron-builder config. Every claim about Monaco under `file://`
  is therefore unproven at runtime, including worker resolution, which is the
  exact class that produced two silent MVP failures. **If Gate M fails, the
  editor engine decision reopens (spec §9); Phases 1–3 survive it.**
- **T35 (the thirteen-item manual pass) has not been run.** Not one item.
- **Every `manual (owner)` line in §3 is outstanding**, including: the three
  exits all asking (T15), one dialog naming a busy agent AND a dirty file
  (T15), an agent rewriting an open file producing exactly one reload (T13),
  the focus reconcile (T13), resize in both layouts (T29), and a 10k-file
  directory not freezing the panel (T31).
- **No CSP exists** ([`index.html`](../../index.html) `current` carries no
  meta tag), so Gate M — when it runs — proves `file://` + `base: "./"` worker
  resolution ONLY. Adding one later invalidates it and requires a re-run.
- **`scripts/ipc-contract.test.ts` (the TAURI one) fails**, and did so before
  this work: it reports 17 pre-existing Electron-only host facades
  (`dialog_ask`, `shell_open_url`, `suspend_menu_accelerators`, …) plus this
  feature's six channels as having no `#[tauri::command]`. It is excluded from
  `npm test` for that reason. The ELECTRON contract test is the live gate and
  it passes.
- **Windows is untouched.** Inherited from Gate C, not created here.
