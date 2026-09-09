# The explorer's root row and its actions — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** The explorer tab shows the workspace it is rooted at as row 0 of its own tree, and
that row carries New File, New Folder, Refresh and Collapse All.

**Architecture:** The root enters `flattenTree` as an ordinary `TreeRow`, so every index in
`FileTreeView`'s windowing math keeps agreeing with what is on screen. Focus moves from an
index to a path, because a create re-sorts the rows. The four controls are a trailing cluster
on that row, sized to the 22px row rather than to chrome. Creating goes out over one new
Electron-only channel whose name validator is a pure module both the renderer and main import;
Refresh and Collapse All are controller operations, because only the controller may call
`refreshWatch()`.

**Tech Stack:** Preact + `@preact/signals` renderer, Electron main process (`node:fs/promises`),
Vitest + jsdom, Playwright for the browser layout measurement, Phosphor icons.

**Spec:** [`docs/specs/2026-08-25-explorer-root-row-and-actions-design.md`](../specs/2026-08-25-explorer-root-row-and-actions-design.md)
`decided`. Read it before Task 1. Its §1 table is owner-decided; do not re-litigate a row of
it, and do not add anything its §12 puts out of scope.

---

## Global Constraints

- **R1 — English only.** Every string, comment, doc line and commit message in this repo is
  English. This plan document is English for the same reason.
- **R2 — the design language is executable policy.** `scripts/design-language.test.ts` resolves
  every `DL-<section>.<rule>` and `DL §<section>` citation it finds under `src/`, `electron/`
  and `scripts/` against `docs/DESIGN-LANGUAGE.md`. **A rule must exist in the rulebook before
  any source comment cites it**, which is why Task 1 comes first.
- **R4 — load-bearing seams stay explicit.** `flattenTree`, the file surface store and the
  controller are seams this plan changes deliberately and names in every task that touches one.
- **R6 — IPC payload shape is a contract.** `create_entry` is flat: `{ root, parent, name, kind }`.
  `scripts/electron-ipc-contract.test.ts` asserts key lists with `toEqual`, so **the key order
  is part of the contract** — write the same four keys in the same order at the invoke site, in
  the handler's destructure and in the new fixture.
- **R7 — gallery imports flow app → gallery only.** No shipping module may import `src/gallery/`.
- **Host:** Electron only. The file surface has no Tauri implementation, and the two create
  controls gate on the host facade's `available` flag explicitly (spec §10) rather than
  inheriting that fact.
- **Row height is a constant, not a measurement.** `ROW_HEIGHT = 22` in
  `src/files/ui/file-tree-view.tsx` is what every index is computed from. Nothing added by this
  plan may make a row taller than 22px.
- **Naming:** files are kebab-case; new modules must be imported by something in the same task
  (no orphans).
- **Immutability:** every store write builds a new object/Set/Map. Nothing mutates a stored value.

---

## Verification gates

Spec §11 names these. **Every one of them must be RUN and its output pasted before any
"done"/"passing" claim** (repo rule W4 — no success claim without evidence):

| Gate | Command |
| --- | --- |
| Unit suite | `npm test` |
| Renderer typecheck | `npx tsc --noEmit` |
| Main-process typecheck | `tsc -p tsconfig.electron.json` |
| Renderer bundle | `npm run build` |
| Main bundle | `npm run electron:build` |
| Design language | `npx vitest run scripts/design-language.test.ts` |
| IPC contract | `npx vitest run scripts/electron-ipc-contract.test.ts` |
| Gallery boundary | `npx vitest run scripts/gallery-entry.test.ts` |
| Layout measurement | Task 12's Playwright pass over the gallery |

**`npm run lint` is red at baseline** (41 pre-existing oxlint errors on a clean tree), so a red
lint run proves nothing about this work. Run `npx prettier --check` over the files this plan
touches instead, and read oxlint output only for the files you changed.

### What no automated gate can satisfy

**A native `npm run electron:dev` pass and the owner's eye review are OWED and are not
satisfied by anything above.** Nothing in this plan has been pressed in a running app: no root
row has been collapsed, no entry created, no tooltip seen, no status line read. Report the work
as suite/build-verified with those two explicitly outstanding, and write exactly that into
`AGENTS.md` and `docs/CONTEXT.md` in Task 13. Windows is Gate C and stays unverified.

### Concurrency hazard — read this before running any test

Other agent sessions share this checkout. They leave files staged and tests red.

- **Attribute before you blame.** A failing test is not this work's until you have shown it
  is. Two steps, in this order:
  1. **Cheap check first.** Run only the suites this plan touches
     (`npx vitest run src/files src/ui scripts/design-language.test.ts`) and read
     `git status --short`. If the failure names a file no task here lists under "Modified
     files", it belongs to another session — report it with that file name and move on.
  2. **If it names a file this plan DID touch,** reproduce it on a pristine tree before
     accepting it. Create the worktree in the session scratchpad, never inside the repo:
     `git worktree add <scratchpad>/pristine HEAD`. It needs its own install
     (`npm ci` in the worktree) because `node_modules` is not shared across worktrees;
     that cost is why step 1 comes first. Green there and red here means the failure is
     yours.
  **Never `git stash` to isolate** — see the third bullet.
- **Never `git add -A` or `git add .`** — the index routinely carries another session's work.
  Every commit in this plan names its paths explicitly.
- **Do not `git stash`.** The tree carries a large uncommitted checkpoint; stashing can strand it.

### Known traps that bite this work specifically

1. **`.iconbtn` never resets the UA's button padding.** Chrome gives every `<button>`
   `padding: 1px 6px`; `.iconbtn` sets only width/height/`display:grid`/`place-items:center`, so
   the grid track is 12px against a 15px glyph and every icon in the app sits ~1.5px left of
   centre. The cluster in Task 9 is deliberately **not** `.iconbtn` (spec §4.2) and declares
   `padding: 0` itself. Do not "simplify" it onto `.iconbtn`.
2. **`src/styles.css` has no global `box-sizing` reset.** Any element you give a percentage
   size AND a padding must declare `box-sizing: border-box` locally. Two shipped defects came
   from exactly this.
3. **A 1px overflow inside a scroll container moves chrome once focus lands in it.**
   `.file-tree` is `overflow-y: auto`. A cluster that overflows the row horizontally, or a row
   that overflows the container, will `scrollIntoView` the whole column the first time a button
   is focused. Task 12 measures for zero overflow at the 360px floor for this reason.
4. **`preact/compat` rewrites `onBlur`.** A synthetic blur dispatched in a test reaches no
   handler — call `element.focus()` / `element.blur()` in component tests instead.
5. **`useSignalEffect` runs on an animation frame.** A test that changes a signal must wait a
   frame, not a microtask.

---

## File structure

**New files**

| File | Responsibility |
| --- | --- |
| `src/files/entry-name.ts` | Pure name validator (spec §6.3). Imported by BOTH the renderer modal and the main-process handler. Dependency-free. |
| `src/files/entry-name.test.ts` | Its tests, including the Windows reserved names on macOS. |
| `src/files/tree-focus.ts` | Pure `resolveFocusIndex` — focus is a path, the index is derived (spec §3.4). |
| `src/files/tree-focus.test.ts` | |
| `src/files/create-target.ts` | Pure `createTargetDirectory` — where a new entry lands (spec §5.1). |
| `src/files/create-target.test.ts` | |
| `electron/fs/create-entry.ts` | The `create_entry` syscall half: guard, validate, `open(…, "wx")` / `mkdir`. |
| `electron/fs/create-entry.test.ts` | |
| `src/host/file-create-host.ts` | Host facade: `available` + one `invoke` (spec §6.4). |
| `src/files/ui/tree-root-actions.tsx` | The trailing cluster of four controls. |
| `src/files/ui/tree-root-actions.test.tsx` | |
| `src/files/ui/create-entry-dialog.tsx` | The naming modal on the shared `Modal` shell. |
| `src/files/ui/create-entry-dialog.test.tsx` | |
| `src/gallery/sections/explorer-tree-section.tsx` | Registered specimen mounting the REAL `FileTreeView`, for the layout measurement. |

**Modified files**

| File | Change |
| --- | --- |
| `docs/DESIGN-LANGUAGE.md` | New DL-19.9; DL-19.5 amended. |
| `src/files/file-tree.ts` | `flattenTree` takes `rootExpanded` and emits the root; `openDirectories` dedupes. |
| `src/files/file-tree.test.ts` | Every `flattenTree` case moves with the signature. |
| `src/files/file-surface-store.ts` | `rootExpanded` field, `EMPTY_SURFACE`, `setRootExpanded`, `collapseAllDirectories`, `pendingTreeFocus`, `explorerStatus`. |
| `src/files/file-surface-store.test.ts` | |
| `src/files/file-client.ts` | `FileClient.createEntry` + the default implementation. |
| `src/files/file-surface-controller.ts` | `toggleRoot`, `refreshTree`, `collapseAll`, `createEntry`. |
| `src/files/file-surface-controller.test.ts` | |
| `src/files/ui/file-tree-view.tsx` | Root row, focus by path, cluster mount, keyboard guard. |
| `src/files/ui/file-tree-view.test.tsx` | |
| `src/files/ui/explorer-tab.tsx` | Renders the DL-19.5 status line above the tree; passes `canCreate`. |
| `src/files/ui/explorer-tab.test.tsx` | |
| `src/chrome/events.ts` | `createEntryRequest` signal. |
| `src/ui/app-policy.ts` | `browserPanelObscured` gains `createEntryOpen`. |
| `src/ui/app.tsx` | Mounts the dialog; feeds `createEntryOpen`; passes `canCreate`. |
| `src/ui/app.test.tsx` | |
| `src/styles/14-dock.css` | The cluster's rules; `.file-tree__name { min-width: 0 }`; the status line. |
| `src/styles/10-modals.css` | `.create-entry` panel rules. |
| `electron/ipc/channels.ts` | `createEntry: "create_entry"`. |
| `electron/ipc/register-explorer.ts` | The handler. |
| `scripts/electron-ipc-contract.test.ts` | The `create_entry` fixture. |
| `scripts/gallery-entry.test.ts` | Pins the unpark. |
| `src/gallery/section-registry.ts` | Drawing out, real tree in; comment updated. |
| `docs/CONTEXT.md`, `CHANGELOG.md`, `AGENTS.md` | Task 13. |

**Deleted files:** none. `src/gallery/sections/explorer-header-variants.tsx` and its stylesheet
**stay in the tree** as the record of the review, unimported — the `unread-mark-variants`
precedent, documented in `src/gallery/section-registry.ts`'s own comment.

---

### Task 1: The rulebook, first

**Files:**
- Modify: `docs/DESIGN-LANGUAGE.md` (DL-19.5 in place; DL-19.9 appended after DL-19.8, immediately
  before `## 20. Numeric scales`)

**Why first:** `scripts/design-language.test.ts` collects every `DL-19.9` / `DL §19` citation in
`src/`, `electron/` and `scripts/` and resolves it against this file. A source comment citing
DL-19.9 before the rule exists turns that gate red. This rulebook append is also a **fork**
(`AGENTS.md` lists "a rule in `docs/DESIGN-LANGUAGE.md`"); the fork is already resolved by the
spec's owner-approved §1 table and is recorded in `AGENTS.md` in Task 13.

**Interfaces:**
- Produces: the rule ids `DL-19.9` and the amended `DL-19.5`, which Tasks 8–11 cite in comments.

- [ ] **Step 1: Amend DL-19.5**

Today it reads:

```
- **DL-19.5** One status line, directly under the header, in `--text-faint`
  (DL-3.4) — or `--red` when it reports a failure (DL-3.2). It is the panel's
  only place for transient text; a panel does not raise dialogs of its own.
```

Replace the final clause and append the spec's §4.4 wording verbatim as an amendment paragraph
in this file's own house style (the other rules in §19 carry their amendments inline, dated and
attributed):

```
- **DL-19.5** One status line, directly under the header, in `--text-faint`
  (DL-3.4) — or `--red` when it reports a failure (DL-3.2). It is the panel's
  only place for transient text.
  **Amended 2026-08-25:** a panel does not raise a dialog to report **its own
  state** — a failure, a progress step, an unreadable directory. That is what
  the status line is for, and it is the reason this rule exists: a background
  event must never steal the window. A dialog the **user pressed a control to
  open** is not that event, and may use the shared `Modal` shell (DL §29).
  Every existing use is untouched: listing errors still go to
  [`LoadError`](../src/ui/controls/load-error.tsx) `current`, and the create
  failures of the explorer's own cluster go to this status line, not to a
  second dialog.
```

- [ ] **Step 2: Add DL-19.9**

Append after DL-19.8, before `## 20. Numeric scales`:

```
- **DL-19.9** **A docked panel's tab hangs its own actions off the row that
  names what it is showing (2026-08-25, owner).** Not in the shared header, and
  not in a row of its own. The shared header stays the tab row (DL-19.3,
  DL-19.7) and never carries a control belonging to one tab. The actions are a
  trailing cluster of icon-only controls on that first row, **sized to the row
  rather than to chrome** — `.iconbtn`'s 24px box overflows a 22px data row by
  1px above and below, and the row cannot grow because its height is the
  constant every index in the virtual list is computed from. They are visible
  at rest. This is DL-27.18's arrangement applied to a docked panel; it adds no
  vertical chrome to a column whose floor is 360px wide
  ([`TreeRootActions`](../src/files/ui/tree-root-actions.tsx) `current`).
```

The `TreeRootActions` anchor is a `current` link to a file Task 9 creates. Write the rule now
and the link now; `scripts/docs-anchors.sh` is a workspace-level gate that is not part of this
repo's suite, so a link to a not-yet-existing file will not fail a gate here — but re-run
Task 9's step that creates the file before claiming this document is correct.

- [ ] **Step 3: Prove the gate is green**

```bash
npx vitest run scripts/design-language.test.ts
```

Expected: PASS, with the rule count one higher than before. If the gate reports an unresolved
citation for a rule this repo's other sessions added, that is theirs — check `git status` and
say so rather than editing their rule.

- [ ] **Step 4: Leave it uncommitted, and say so**

**Do NOT commit `docs/DESIGN-LANGUAGE.md`.** D14: documentation is never committed before the
owner has approved its content, and that rule explicitly outranks a skill or a plan telling you
to commit first. Leave the edit in the working tree and name it in your report alongside
Task 13's three documents.

This costs nothing downstream: `scripts/design-language.test.ts` reads the working tree, not
git, so every task after this one sees DL-19.9 and the amended DL-19.5 with the file unstaged.
When the owner approves, one commit carries the rulebook and Task 13's documents together:

```bash
# Only after the owner has read them.
git commit -- docs/DESIGN-LANGUAGE.md docs/CONTEXT.md CHANGELOG.md AGENTS.md \
  -m "docs: record the explorer root row, DL-19.9 and the DL-19.5 amendment"
```

---

### Task 2: The root is row 0 of the model, and `rootExpanded` is a store field

**Files:**
- Modify: `src/files/file-tree.ts` (`flattenTree`, `openDirectories`)
- Modify: `src/files/file-tree.test.ts`
- Modify: `src/files/file-surface-store.ts` (`FileSurfaceState`, `EMPTY_SURFACE`, `treeRows`, new setters)
- Modify: `src/files/file-surface-store.test.ts`

**Why one task:** `treeRows` is `flattenTree`'s only production caller and passes four arguments
today. Adding a required fifth breaks the build unless both move together, so they share a commit.

**Interfaces:**
- Produces:
  - `flattenTree(root, listings, expanded, showHidden, rootExpanded: boolean): TreeRow[]`
  - `openDirectories(rows, root): string[]` — now deduplicated
  - `FileSurfaceState.rootExpanded: boolean` (default `true`)
  - `setRootExpanded(workspacePath: string, rootExpanded: boolean): void`
  - `collapseAllDirectories(workspacePath: string): void`
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing model tests**

Add to `src/files/file-tree.test.ts`, inside the existing `describe("flattenTree")` block (its
`listings` fixture is already in scope):

```ts
  it("emits the root as row 0 at depth 0, with children at depth 1", () => {
    const rows = flattenTree("/r", listings, new Set(), false, true);
    expect(rows.map((r) => [r.name, r.depth])).toEqual([
      ["r", 0],
      ["src", 1],
      ["readme.md", 1],
    ]);
    expect(rows[0]).toMatchObject({ path: "/r", directory: true, expanded: true, outOfRoot: false });
  });

  it("emits exactly one row when the root is collapsed", () => {
    const rows = flattenTree("/r", listings, new Set(["/r/src"]), false, false);
    expect(rows.map((r) => r.name)).toEqual(["r"]);
    expect(rows[0].expanded).toBe(false);
  });

  it("keeps the root row when the root has no listing at all", () => {
    const rows = flattenTree("/r", new Map(), new Set(), false, true);
    expect(rows.map((r) => r.name)).toEqual(["r"]);
  });
```

And in `describe("openDirectories")`:

```ts
  it("names the root once even though the root row is itself expanded", () => {
    const rows = flattenTree(
      "/r",
      new Map<string, readonly DirEntry[]>([
        ["/r", [entry("/r/src", { directory: true })]],
        ["/r/src", [entry("/r/src/deep", { directory: true })]],
      ]),
      new Set(["/r/src", "/r/src/deep"]),
      false,
      true,
    );
    expect(openDirectories(rows, "/r")).toEqual(["/r", "/r/src", "/r/src/deep"]);
  });
```

Then update every EXISTING `flattenTree` call in this file to pass a fifth argument and to
expect the root row. The existing cases and what they become:

| Existing case | Change |
| --- | --- |
| "renders only the root's children when nothing is expanded" | pass `true`; expected becomes `[["r",0],["src",1],["readme.md",1]]` |
| "descends into expanded directories in display order" | pass `true`; depths shift by 1, root prepended |
| "descends two levels and keeps depth-first order" | pass `true`; depths shift by 1, root prepended |
| "shows an expanded directory with no listing yet as a childless row" | pass `true`; `toHaveLength(2)`, assert `rows[1].expanded` |
| "never walks into a symlink that resolves out of the root" | pass `true`; names become `["r", "away"]`, assert `rows[1].expanded === false` |
| "terminates on a symlink cycle inside the root" | pass `true`; names become `["r", "a", "r"]` — the `walked` set still stops the loop, and the third entry is the CHILD row named `r`, not a second root row |
| "is the root plus every expanded row" (openDirectories) | pass `true`; expectation is unchanged because of the dedupe |

- [ ] **Step 2: Run them and watch them fail**

```bash
npx vitest run src/files/file-tree.test.ts
```

Expected: FAIL — `flattenTree` currently takes four parameters, so the new cases get
`rootExpanded` swallowed and the root row never appears.

- [ ] **Step 3: Implement in `src/files/file-tree.ts`**

```ts
/** Last segment of an absolute path, honouring both separators — the root row's
 * name. Not `baseName` from `src/lib/path-name.ts`: this module is the tree
 * MODEL and imports nothing, which is what keeps it assertable with no host. */
function rootName(root: string): string {
  const cut = Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\"));
  return cut === -1 || cut === root.length - 1 ? root : root.slice(cut + 1);
}

export function flattenTree(
  root: string,
  listings: Listings,
  expanded: ReadonlySet<string>,
  showHidden: boolean,
  // The root's own expansion (design §3.3). It CANNOT be folded into
  // `expanded`, which already means "this child directory is open" — an empty
  // set is a fully collapsed tree whose root is still open, and there is no
  // spelling of that set which says "the root is shut".
  rootExpanded: boolean,
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walked = new Set<string>();
  const walk = (directory: string, depth: number): void => { /* unchanged */ };
  // Design §3.1: the root is a TreeRow like any other, never separate DOM above
  // the scroller — the spacer height, the window, the roving tabindex,
  // `scrollIntoView` and every arrow key are all index arithmetic over THIS
  // array, and a row outside it makes all five disagree with the screen.
  rows.push({
    path: root,
    name: rootName(root),
    directory: true,
    depth: 0,
    expanded: rootExpanded,
    outOfRoot: false,
  });
  if (rootExpanded) {
    walk(root, 1);
  }
  return rows;
}
```

`aria-level` is `depth + 1` at the call site already, so the root becomes level 1 and its
children level 2 with no further change (spec §3.1).

And:

```ts
export function openDirectories(rows: readonly TreeRow[], root: string): string[] {
  // Deduplicated since the root became a row: an expanded root row carries
  // `expanded: true`, so the naive concatenation named the root twice — a
  // duplicated `list_dir` on every Refresh and a duplicate in the watch set.
  return [...new Set([root, ...rows.filter((row) => row.expanded).map((row) => row.path)])];
}
```

- [ ] **Step 4: Run the model tests**

```bash
npx vitest run src/files/file-tree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing store tests**

Add to `src/files/file-surface-store.test.ts`:

```ts
describe("rootExpanded", () => {
  it("defaults to an open root", () => {
    expect(EMPTY_SURFACE.rootExpanded).toBe(true);
    expect(surfaceFor("/r").rootExpanded).toBe(true);
  });

  it("collapses and re-opens one workspace's root without touching another's", () => {
    setRootExpanded("/r", false);
    expect(surfaceFor("/r").rootExpanded).toBe(false);
    expect(surfaceFor("/other").rootExpanded).toBe(true);
    setRootExpanded("/r", true);
    expect(surfaceFor("/r").rootExpanded).toBe(true);
  });

  it("hides every child row while the root is collapsed", () => {
    setListing("/r", "/r", [
      { name: "src", path: "/r/src", directory: true, outOfRoot: false },
    ]);
    expect(treeRows("/r").map((row) => row.name)).toEqual(["r", "src"]);
    setRootExpanded("/r", false);
    expect(treeRows("/r").map((row) => row.name)).toEqual(["r"]);
  });
});

describe("collapseAllDirectories", () => {
  it("empties `expanded` and leaves `rootExpanded` alone (design §8)", () => {
    setListing("/r", "/r", [
      { name: "src", path: "/r/src", directory: true, outOfRoot: false },
    ]);
    toggleDirectory("/r", "/r/src");
    expect([...surfaceFor("/r").expanded]).toEqual(["/r/src"]);
    collapseAllDirectories("/r");
    expect([...surfaceFor("/r").expanded]).toEqual([]);
    expect(surfaceFor("/r").rootExpanded).toBe(true);
  });

  it("keeps every cached listing — collapsing is not a reload", () => {
    setListing("/r", "/r", []);
    collapseAllDirectories("/r");
    expect(surfaceFor("/r").listings.has("/r")).toBe(true);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

```bash
npx vitest run src/files/file-surface-store.test.ts
```

Expected: FAIL — `setRootExpanded` and `collapseAllDirectories` are not exported.

- [ ] **Step 7: Implement in `src/files/file-surface-store.ts`**

```ts
export interface FileSurfaceState {
  readonly expanded: ReadonlySet<string>;
  /**
   * Whether the ROOT row is open (design §3.3). Separate from `expanded`,
   * which already means "this child directory is open" — an empty set is a
   * fully collapsed tree whose root is still showing its children, so there is
   * no value of `expanded` that says "the root is shut".
   */
  readonly rootExpanded: boolean;
  readonly showHidden: boolean;
  // …unchanged…
}

export const EMPTY_SURFACE: FileSurfaceState = Object.freeze({
  expanded: new Set<string>(),
  rootExpanded: true,
  showHidden: false,
  // …unchanged…
});

export function setRootExpanded(workspacePath: string, rootExpanded: boolean): void {
  writeSurface(workspacePath, { rootExpanded });
}

/**
 * Collapse every child directory, leaving the root open (design §8).
 *
 * Listings are KEPT: collapsing is not a reload, and re-expanding is then
 * instant. The watch scope is recomputed from the visible rows by the
 * controller, which is why this is only half the operation — see
 * `FileSurfaceController.collapseAll`.
 */
export function collapseAllDirectories(workspacePath: string): void {
  writeSurface(workspacePath, { expanded: new Set<string>() });
}

export function treeRows(workspacePath: string | null): TreeRow[] {
  if (workspacePath === null) {
    return [];
  }
  const surface = surfaceFor(workspacePath);
  return flattenTree(
    workspacePath,
    surface.listings,
    surface.expanded,
    surface.showHidden,
    surface.rootExpanded,
  );
}
```

- [ ] **Step 8: Run the whole file surface suite**

```bash
npx vitest run src/files
```

Expected: PASS. `file-surface-controller.test.ts` and `file-tree-view.test.tsx` may report
row-count changes — the root row is now in every tree. Fix those expectations here; they are
this task's own consequence, not a later task's.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git commit -- src/files/file-tree.ts src/files/file-tree.test.ts \
  src/files/file-surface-store.ts src/files/file-surface-store.test.ts \
  src/files/file-surface-controller.test.ts src/files/ui/file-tree-view.test.tsx \
  -m "feat(explorer): the tree model emits its root as row 0"
```

---

### Task 3: The two pure helpers — focus by path, and where a create lands

**Files:**
- Create: `src/files/tree-focus.ts`, `src/files/tree-focus.test.ts`
- Create: `src/files/create-target.ts`, `src/files/create-target.test.ts`

**Why:** Spec §3.4 — a create, a refresh or a `showHidden` flip re-sorts `rows`, so the same
index names a different file, and §5.3 requires focus to land on a **created** entry, which is
an identity rather than a position. Spec §5.1 — the create target is derived from that focus.
Both are decisions, so both are pure functions with no DOM, tested without jsdom.

**Interfaces:**
- Consumes: `TreeRow` from Task 2.
- Produces:
  - `resolveFocusIndex(rows: readonly TreeRow[], focusedPath: string | null, fallbackIndex: number): number`
  - `createTargetDirectory(rows: readonly TreeRow[], focusedPath: string | null, root: string): string`

- [ ] **Step 1: Write the failing focus tests**

`src/files/tree-focus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveFocusIndex } from "./tree-focus";
import type { TreeRow } from "./file-tree";

const row = (path: string): TreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  directory: false,
  depth: 1,
  expanded: false,
  outOfRoot: false,
});

describe("resolveFocusIndex", () => {
  const rows = [row("/r"), row("/r/a"), row("/r/b")];

  it("answers the row that holds the focused path", () => {
    expect(resolveFocusIndex(rows, "/r/b", 0)).toBe(2);
  });

  it("answers the root when nothing is focused", () => {
    expect(resolveFocusIndex(rows, null, 2)).toBe(0);
  });

  it("falls back to the nearest surviving index when the path has left the tree", () => {
    expect(resolveFocusIndex([row("/r")], "/r/gone", 2)).toBe(0);
    expect(resolveFocusIndex(rows, "/r/gone", 7)).toBe(2);
    expect(resolveFocusIndex(rows, "/r/gone", 1)).toBe(1);
  });

  it("answers 0 for an empty tree rather than -1", () => {
    expect(resolveFocusIndex([], "/r/a", 3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/files/tree-focus.test.ts
```

Expected: FAIL — "Failed to resolve import ./tree-focus".

- [ ] **Step 3: Implement `src/files/tree-focus.ts`**

```ts
/**
 * Where the explorer's keyboard focus is, as an INDEX derived from a PATH.
 *
 * `FileTreeView` held a `focusedIndex` until 2026-08-25. Creating an entry,
 * refreshing a directory or flipping `showHidden` re-sorts the rows, so the
 * same index names a different file — and design §5.3 requires focus to land
 * on a CREATED entry, which is an identity, not a position. The component
 * therefore tracks the path and derives the index here, every render.
 *
 * Pure: no DOM, no store, no host, so the whole policy is assertable as three
 * arguments and a number.
 */
import type { TreeRow } from "./file-tree";

/**
 * The index `focusedPath` occupies, or the nearest surviving row.
 *
 * `null` means the root, which is index 0 since the root became a row of the
 * model (design §3.1). A path that has left the tree clamps `fallbackIndex`
 * — the index that path last occupied — into the current bounds, so a
 * collapse or a delete leaves focus where the row used to be rather than
 * jumping to the top.
 */
export function resolveFocusIndex(
  rows: readonly TreeRow[],
  focusedPath: string | null,
  fallbackIndex: number,
): number {
  if (rows.length === 0) {
    return 0;
  }
  if (focusedPath === null) {
    return 0;
  }
  const found = rows.findIndex((row) => row.path === focusedPath);
  if (found !== -1) {
    return found;
  }
  return Math.min(Math.max(0, fallbackIndex), rows.length - 1);
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/files/tree-focus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing create-target tests**

`src/files/create-target.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTargetDirectory } from "./create-target";
import type { TreeRow } from "./file-tree";

const dir = (path: string, depth: number): TreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  directory: true,
  depth,
  expanded: true,
  outOfRoot: false,
});
const file = (path: string, depth: number): TreeRow => ({ ...dir(path, depth), directory: false });

const rows = [dir("/r", 0), dir("/r/src", 1), file("/r/src/index.ts", 2), file("/r/readme.md", 1)];

describe("createTargetDirectory", () => {
  it("creates inside a focused directory", () => {
    expect(createTargetDirectory(rows, "/r/src", "/r")).toBe("/r/src");
  });

  it("creates beside a focused file", () => {
    expect(createTargetDirectory(rows, "/r/src/index.ts", "/r")).toBe("/r/src");
  });

  it("creates in the root when the root row is focused", () => {
    expect(createTargetDirectory(rows, "/r", "/r")).toBe("/r");
  });

  it("creates in the root when nothing is focused", () => {
    expect(createTargetDirectory(rows, null, "/r")).toBe("/r");
  });

  it("creates in the root when the focused path has left the tree", () => {
    expect(createTargetDirectory(rows, "/r/gone/deep.ts", "/r")).toBe("/r");
  });

  it("creates in the root for a symlink that resolves out of it", () => {
    const away: TreeRow = { ...dir("/r/away", 1), outOfRoot: true };
    expect(createTargetDirectory([dir("/r", 0), away], "/r/away", "/r")).toBe("/r");
  });
});
```

- [ ] **Step 6: Run and watch it fail**

```bash
npx vitest run src/files/create-target.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement `src/files/create-target.ts`**

```ts
/**
 * Where New File and New Folder put the entry (design §5.1).
 *
 * VS Code's rule: the FOCUSED directory, falling back to the workspace root.
 * "Always the root" was offered and declined — it is unusable once the user is
 * working deep in a tree. The modal states the answer as a line of its own,
 * because the button the user pressed sits on the ROOT's row and may well
 * create somewhere else.
 *
 * Pure, and separate from `tree-focus.ts`: that module answers where focus IS,
 * this one answers what focus MEANS for a create.
 */
import { canExpand, type TreeRow } from "./file-tree";
import { parentDirectory } from "../lib/path-name";

/** The directory a new entry belongs in. Always inside the tree the caller
 * named — an unknown focused path answers the root rather than guessing. */
export function createTargetDirectory(
  rows: readonly TreeRow[],
  focusedPath: string | null,
  root: string,
): string {
  if (focusedPath === null) {
    return root;
  }
  const focused = rows.find((row) => row.path === focusedPath);
  if (focused === undefined) {
    return root;
  }
  // A symlink out of the root renders as a leaf and cannot be walked into
  // (`canExpand`), so it cannot be created into either — creating there would
  // write outside the workspace, which the main-process guard would refuse
  // anyway. Answering the root makes the refusal impossible instead of loud.
  if (focused.directory && canExpand(focused)) {
    return focused.path;
  }
  return parentDirectory(focused.path);
}
```

- [ ] **Step 8: Run both, typecheck, commit**

```bash
npx vitest run src/files/tree-focus.test.ts src/files/create-target.test.ts
npx tsc --noEmit
git commit -- src/files/tree-focus.ts src/files/tree-focus.test.ts \
  src/files/create-target.ts src/files/create-target.test.ts \
  -m "feat(explorer): add the focus-by-path and create-target policies"
```

---

### Task 4: The name validator, shared by the renderer and main

**Files:**
- Create: `src/files/entry-name.ts`, `src/files/entry-name.test.ts`

**Why one module for both sides:** spec §6.3 says the validator is "new, not shared with the
launcher's" — a different axis from renderer-vs-main. `electron/fs/read.ts` and
`electron/fs/write.ts` already import `src/files/file-content.ts` in shipping main-process code,
and `dist-electron/src/files/` already exists in the build output, so a pure module under
`src/files/` is the established way to state a rule both processes must agree on. Mirroring it
(the `external-app-catalog` pattern) would give two copies of a security-relevant rule that can
drift. **Keep this file dependency-free** — no Preact, no signals, no `node:*` — or the main
bundle pulls the renderer in.

**Interfaces:**
- Produces:
  ```ts
  export type NameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };
  export function checkEntryName(name: unknown): NameCheck;
  ```
  Consumed by Task 5 (`electron/fs/create-entry.ts`) and Task 10 (the modal).

- [ ] **Step 1: Write the failing tests**

`src/files/entry-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkEntryName } from "./entry-name";

const reason = (name: unknown): string => {
  const result = checkEntryName(name);
  return result.ok ? "" : result.reason;
};

describe("checkEntryName", () => {
  it.each(["README.md", ".github", ".env", "a.b.c", "name with spaces", "Ünïcøde.ts"])(
    "accepts %j",
    (name) => {
      expect(checkEntryName(name)).toEqual({ ok: true });
    },
  );

  it("accepts a leading dot, which the task launcher's own validator refuses", () => {
    // Design §6.2: `createDirectory`'s `validName` rejects every name starting
    // with `.`, so `.github` could not be created through it. That is the
    // launcher's rule and it stays; this is the explorer's.
    expect(checkEntryName(".github").ok).toBe(true);
  });

  it.each([
    ["", "Type a name."],
    [" leading", "A name can't start or end with a space."],
    ["trailing ", "A name can't start or end with a space."],
    [".", "That name is reserved."],
    ["..", "That name is reserved."],
    ["a/b", "A name can't contain a path separator."],
    ["a\\b", "A name can't contain a path separator."],
    ["a\\u0000b", "A name can't contain control characters."],
    ["a\\tb", "A name can't contain control characters."],
    ["a\\u001fb", "A name can't contain control characters."],
    ["a\\u007fb", "A name can't contain control characters."],
    ["name.", "A name can't end with a dot."],
  ])("rejects %j", (name, expected) => {
    expect(reason(name)).toBe(expected);
  });

  it.each(["CON", "con", "PRN", "AUX", "NUL", "COM1", "com9", "LPT1", "lpt9", "CON.txt", "com3.tsx"])(
    "rejects the Windows device name %j on every platform",
    (name) => {
      // Design §6.3: a repository is shared. A name macOS accepts and Windows
      // cannot check out is a defect the creating machine should refuse.
      expect(reason(name)).toBe("That name is reserved on Windows.");
    },
  );

  it.each(["COM0", "LPT0", "COM10", "CONS", "NULL"])("accepts the near-miss %j", (name) => {
    expect(checkEntryName(name).ok).toBe(true);
  });

  it("rejects anything over 255 bytes, counted as UTF-8", () => {
    expect(checkEntryName("a".repeat(255)).ok).toBe(true);
    expect(reason("a".repeat(256))).toBe("That name is too long.");
    // 128 three-byte characters is 384 bytes but only 128 code units — the
    // limit is a filesystem limit, so it is counted in bytes.
    expect(reason("あ".repeat(128))).toBe("That name is too long.");
  });

  it("rejects a non-string, because main is the boundary and the renderer is not", () => {
    expect(checkEntryName(undefined).ok).toBe(false);
    expect(checkEntryName(42).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/files/entry-name.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/files/entry-name.ts`**

```ts
/**
 * Whether a name may be created inside a workspace (design §6.3).
 *
 * Imported by BOTH the renderer's naming modal and `electron/fs/create-entry.ts`.
 * The renderer's use is a CONVENIENCE — it disables the confirm and prints the
 * reason under the field — and main validates the same name again, because the
 * renderer is not the trust boundary.
 *
 * Deliberately NOT `createDirectory`'s `validName` (design §6.2): that one is
 * the task launcher's, and it refuses every name starting with `.`, so
 * `.github` could not be created. It stays as it is; the launcher's needs are
 * not the explorer's.
 *
 * Windows rules are enforced on BOTH platforms. A repository is shared, and a
 * name macOS accepts but Windows cannot check out is a defect the creating
 * machine should refuse.
 *
 * Dependency-free on purpose: no Preact, no signals, no `node:*`. The main
 * process compiles this file into its own bundle.
 */

/** The filesystem limit on one path component, on every platform Deck ships to. */
const MAX_NAME_BYTES = 255;

/** DOS device names, which Windows resolves before it looks at the directory —
 * with or without an extension, and case-insensitively. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** C0 controls plus DEL. NUL is in here; it is not a special case. */
// oxlint-disable-next-line no-control-regex -- the point of this rule is control characters
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export type NameCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: NameCheck = { ok: true };
const no = (reason: string): NameCheck => ({ ok: false, reason });

/**
 * The reasons are printed to the user under the modal's field and thrown as
 * the IPC error's message, so they are sentences, not codes. The check order is
 * fixed so a name failing two rules always reports the same one.
 */
export function checkEntryName(name: unknown): NameCheck {
  if (typeof name !== "string" || name === "") {
    return no("Type a name.");
  }
  if (name !== name.trim()) {
    return no("A name can't start or end with a space.");
  }
  if (CONTROL_CHARACTER.test(name)) {
    return no("A name can't contain control characters.");
  }
  if (name.includes("/") || name.includes("\\")) {
    return no("A name can't contain a path separator.");
  }
  if (name === "." || name === "..") {
    return no("That name is reserved.");
  }
  // Windows strips a trailing dot, so `a.` and `a` are the same entry there —
  // a name that means two different things on two platforms is one the
  // creating machine refuses. A trailing space is already gone with the trim
  // check above.
  if (name.endsWith(".")) {
    return no("A name can't end with a dot.");
  }
  if (RESERVED_DEVICE.test(name)) {
    return no("That name is reserved on Windows.");
  }
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    return no("That name is too long.");
  }
  return OK;
}
```

- [ ] **Step 4: Run it**

```bash
npx vitest run src/files/entry-name.test.ts
```

Expected: PASS. If `oxlint` objects to the control-character class, keep the disable comment —
the rule is the point.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git commit -- src/files/entry-name.ts src/files/entry-name.test.ts \
  -m "feat(explorer): add the entry-name validator both processes share"
```

---

### Task 5: The `create_entry` channel, end to end

**Files:**
- Create: `electron/fs/create-entry.ts`, `electron/fs/create-entry.test.ts`
- Create: `src/host/file-create-host.ts`
- Modify: `electron/ipc/channels.ts`
- Modify: `electron/ipc/register-explorer.ts`
- Modify: `src/files/file-client.ts`
- Modify: `scripts/electron-ipc-contract.test.ts`

**Why one task:** the contract test asserts `sites.length > 0` for the new channel AND that
every invoked channel has a handler. A handler with no call site fails the first assertion; a
call site with no handler fails the second. Both halves plus the fixture land together.

**This is a fork** (`AGENTS.md` lists IPC): one Electron-only flat channel joins `CHANNELS`.
Recorded in Task 13.

**Interfaces:**
- Consumes: `checkEntryName` (Task 4); `assertInsideRoot` / `assertWritableInsideRoot` from
  `electron/fs/path-guard.ts`.
- Produces:
  - `CHANNELS.createEntry = "create_entry"`
  - `createEntry({ root, parent, name, kind }): Promise<{ path: string }>` in
    `electron/fs/create-entry.ts`
  - `src/host/file-create-host.ts`: `available: boolean`, `createEntry(root, parent, name, kind): Promise<CreateEntryResult>`
  - `FileClient.createEntry(root, parent, name, kind): Promise<CreateEntryResult>`
  - `export type EntryKind = "file" | "directory"`, exported from `src/host/file-create-host.ts`

- [ ] **Step 1: Write the failing main-process tests**

`electron/fs/create-entry.test.ts`:

```ts
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntry } from "./create-entry";

let root = "";
let outside = "";

beforeEach(async () => {
  // `realpath`, because `tmpdir()` is a symlink on macOS (`/var` → `/private/var`)
  // and the guard canonicalizes both sides — the returned path is the
  // canonical one, so the expectations have to be too.
  root = await realpath(await mkdtemp(path.join(tmpdir(), "deck-create-entry-")));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), "deck-create-entry-out-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("createEntry", () => {
  it("creates an empty file", async () => {
    const result = await createEntry({ root, parent: root, name: "notes.md", kind: "file" });
    expect(result).toEqual({ path: path.join(root, "notes.md") });
    expect((await stat(result.path)).size).toBe(0);
  });

  it("creates one directory, never a chain", async () => {
    const result = await createEntry({ root, parent: root, name: "src", kind: "directory" });
    expect((await stat(result.path)).isDirectory()).toBe(true);
    await expect(
      createEntry({ root, parent: path.join(root, "missing"), name: "deep", kind: "directory" }),
    ).rejects.toThrow();
  });

  it("creates inside a nested parent", async () => {
    await mkdir(path.join(root, "src"));
    const result = await createEntry({
      root,
      parent: path.join(root, "src"),
      name: "index.ts",
      kind: "file",
    });
    expect(result.path).toBe(path.join(root, "src", "index.ts"));
  });

  it("refuses an existing entry of either kind with one message", async () => {
    await writeFile(path.join(root, "taken.md"), "x");
    await mkdir(path.join(root, "folder"));
    await expect(
      createEntry({ root, parent: root, name: "taken.md", kind: "file" }),
    ).rejects.toThrow("already exists");
    await expect(
      createEntry({ root, parent: root, name: "folder", kind: "directory" }),
    ).rejects.toThrow("already exists");
  });

  it("refuses a destination that is already a symlink", async () => {
    // Design §6.1: `wx` is `O_CREAT | O_EXCL` and fails if anything is there,
    // a symlink included — the same reasoning `writeFileAtomically`'s temp
    // file carries. Without it, New File would follow the link out.
    await symlink(path.join(outside, "target.txt"), path.join(root, "link.txt"));
    await expect(
      createEntry({ root, parent: root, name: "link.txt", kind: "file" }),
    ).rejects.toThrow();
    await expect(stat(path.join(outside, "target.txt"))).rejects.toThrow();
  });

  it("refuses a parent outside the named root", async () => {
    await expect(
      createEntry({ root, parent: outside, name: "escape.txt", kind: "file" }),
    ).rejects.toThrow("outside the workspace");
  });

  it("refuses a parent that reaches outside through a symlink", async () => {
    await symlink(outside, path.join(root, "away"));
    await expect(
      createEntry({ root, parent: path.join(root, "away"), name: "x.txt", kind: "file" }),
    ).rejects.toThrow("outside the workspace");
  });

  it("refuses an invalid name with the validator's own reason", async () => {
    await expect(
      createEntry({ root, parent: root, name: "a/b", kind: "file" }),
    ).rejects.toThrow("path separator");
    await expect(
      createEntry({ root, parent: root, name: "CON", kind: "file" }),
    ).rejects.toThrow("reserved on Windows");
  });

  it("accepts a leading dot", async () => {
    const result = await createEntry({ root, parent: root, name: ".env", kind: "file" });
    expect(result.path).toBe(path.join(root, ".env"));
  });

  it("refuses a kind it does not know", async () => {
    await expect(
      createEntry({ root, parent: root, name: "x", kind: "socket" as never }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run electron/fs/create-entry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `electron/fs/create-entry.ts`**

```ts
/**
 * `create_entry` — one new file or one new directory inside a workspace root
 * (design §6.1).
 *
 * ONE channel rather than two because authorization, name validation,
 * canonicalization and the EEXIST mapping are identical for both kinds; only
 * the final syscall differs.
 *
 * Neither existing channel could be reused (design §6.2): `writeTextFile`
 * renames over its target and cannot express "fail if it already exists", so
 * New File on it would silently truncate a file the user forgot about; and
 * `createDirectory` is the task launcher's — not bounded to a workspace root,
 * and its `validName` refuses every name starting with `.`, so `.github`
 * could not be created.
 *
 * Main builds the destination from `parent + name` and NEVER accepts a
 * composed path from the renderer.
 */
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { assertInsideRoot, assertWritableInsideRoot } from "./path-guard";
import { checkEntryName } from "../../src/files/entry-name";

export type EntryKind = "file" | "directory";

export interface CreateEntryParams {
  readonly root: string;
  readonly parent: string;
  readonly name: string;
  readonly kind: EntryKind;
}

export interface CreateEntryResult {
  readonly path: string;
}

export async function createEntry({
  root,
  parent,
  name,
  kind,
}: CreateEntryParams): Promise<CreateEntryResult> {
  // The renderer already refused this name and disabled its confirm. Main
  // checks it again because the renderer is not the trust boundary.
  const check = checkEntryName(name);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  if (kind !== "file" && kind !== "directory") {
    throw new Error("Deck can only create a file or a folder.");
  }
  // The parent must EXIST inside the root — `assertInsideRoot`, not the
  // writable variant, because creating into a directory that is not there is
  // a mistake rather than the "save a file an agent just deleted" case
  // `assertWritableInsideRoot` exists for.
  const parentDirectory = assertInsideRoot(root, parent);
  // Re-guarded after the join. A validated leaf on a canonical parent cannot
  // escape, and this is what SAYS so — it also throws for a destination that
  // already exists as a link pointing out of the root, before any syscall.
  const destination = assertWritableInsideRoot(root, path.join(parentDirectory, name));
  try {
    if (kind === "directory") {
      // `recursive: false` — one directory, and EEXIST rather than a silent
      // success for a name that is already taken.
      await mkdir(destination, { recursive: false });
    } else {
      // `wx` is `O_CREAT | O_EXCL`: it fails if ANYTHING is already there, a
      // symlink included, which is the same reasoning `writeFileAtomically`'s
      // temp file carries.
      const handle = await open(destination, "wx");
      await handle.close();
    }
  } catch (cause: unknown) {
    if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
      // One message for both kinds (design §6.1).
      throw new Error("An entry with that name already exists.", { cause });
    }
    throw new Error(
      kind === "directory" ? "Couldn't create the folder." : "Couldn't create the file.",
      { cause },
    );
  }
  return { path: destination };
}
```

- [ ] **Step 4: Run the main-process tests**

```bash
npx vitest run electron/fs/create-entry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register the channel**

In `electron/ipc/channels.ts`, inside the "File explorer" block, after `setDirtyFiles`:

```ts
  setDirtyFiles: "set_dirty_files",
  // Creating one file or one folder from the explorer's root row (design
  // 2026-08-25 §6.1). Electron-only like the blocks above — no
  // `#[tauri::command]` counterpart, and the two create controls are omitted
  // wherever the host facade reports itself absent. Flat
  // `{ root, parent, name, kind }` per R6; main builds the destination from
  // `parent + name` and never accepts a composed path from the renderer.
  createEntry: "create_entry",
```

In `electron/ipc/register-explorer.ts`, add the import and the handler. **The destructure order
is part of the contract** — `{ root, parent, name, kind }`:

```ts
import { createEntry } from "../fs/create-entry";
// …
  ipcMain.handle(CHANNELS.createEntry, (_event, { root, parent, name, kind }) =>
    createEntry({ root, parent, name, kind }),
  );
```

- [ ] **Step 6: Add the host facade `src/host/file-create-host.ts`**

```ts
/**
 * Creating one entry, as the renderer sees it (design §6.4).
 *
 * `workspace-create-host.ts`'s shape exactly: an `available` boolean read off
 * `__deckHost`, and one `invoke`. The two create controls are OMITTED where
 * `available` is false — a control that cannot answer is worse than no control
 * (DL-19.7's own reasoning for an unserviceable tab). Refresh and Collapse All
 * are renderer-only and always present, so the cluster never disappears
 * entirely.
 */
import { invoke } from "./bridge";

/** Electron-only; Tauri and browser previews do not install this bridge. */
export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export type EntryKind = "file" | "directory";

export interface CreateEntryResult {
  readonly path: string;
}

/** Flat payload per the renderer/main IPC contract (R6). The key ORDER is
 * asserted by `scripts/electron-ipc-contract.test.ts`. */
export function createEntry(
  root: string,
  parent: string,
  name: string,
  kind: EntryKind,
): Promise<CreateEntryResult> {
  return invoke<CreateEntryResult>("create_entry", { root, parent, name, kind });
}
```

- [ ] **Step 7: Add it to `FileClient`**

In `src/files/file-client.ts`:

```ts
import { createEntry as hostCreateEntry, type CreateEntryResult, type EntryKind } from "../host/file-create-host";
export type { CreateEntryResult, EntryKind };

export interface FileClient {
  // …unchanged…
  /** Create one file or one folder. The host facade owns the `invoke`; this
   * seam is what lets the controller's tests drive a fake. */
  createEntry(root: string, parent: string, name: string, kind: EntryKind): Promise<CreateEntryResult>;
}

export const defaultFileClient: FileClient = {
  // …unchanged…
  createEntry(root, parent, name, kind) {
    return hostCreateEntry(root, parent, name, kind);
  },
};
```

- [ ] **Step 8: Add the contract fixture**

In `scripts/electron-ipc-contract.test.ts`, directly after the `create_directory` test:

```ts
  it("create_entry carries the flat { root, parent, name, kind } payload on both sides", () => {
    // The explorer root-row work's explicit fixture, pinned the way
    // `create_directory` above is: proof this generic scanner actually reaches
    // the new channel rather than passing vacuously because it found none.
    const sites = callSites.filter((site) => site.channel === "create_entry");
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.keys).toEqual(["root", "parent", "name", "kind"]);
    }
    const entryHandlers = handlers.filter((handler) => handler.channel === "create_entry");
    expect(entryHandlers.length).toBeGreaterThan(0);
    for (const handler of entryHandlers) {
      expect(handler.required).toEqual(["root", "parent", "name", "kind"]);
    }
  });
```

- [ ] **Step 9: Run both gates**

```bash
npx vitest run scripts/electron-ipc-contract.test.ts electron/fs/create-entry.test.ts
npx tsc --noEmit
npx tsc -p tsconfig.electron.json
```

Expected: PASS on all four. If the contract test reports `create_entry` unhandled, the handler
name or the `CHANNELS` key is wrong — the resolver only understands `CHANNELS.<key>` and string
literals.

- [ ] **Step 10: Commit**

```bash
git commit -- electron/fs/create-entry.ts electron/fs/create-entry.test.ts \
  electron/ipc/channels.ts electron/ipc/register-explorer.ts \
  src/host/file-create-host.ts src/files/file-client.ts \
  scripts/electron-ipc-contract.test.ts \
  -m "feat(explorer): add the create_entry channel"
```

---

### Task 6: Controller tree maintenance — root toggle, Refresh, Collapse All

**Files:**
- Modify: `src/files/file-surface-controller.ts`
- Modify: `src/files/file-surface-controller.test.ts`

**Why the controller and not the store:** collapsing releases every descendant watcher, and only
the controller can call `refreshWatch()` (spec §8). A store-only update would leave those
watchers alive until some unrelated transition happened to fire.

**Interfaces:**
- Consumes: `setRootExpanded`, `collapseAllDirectories`, `visibleDirectories` (Task 2).
- Produces, on `FileSurfaceController`:
  - `toggleRoot(workspacePath: string): void`
  - `refreshTree(workspacePath: string): void`
  - `collapseAll(workspacePath: string): void`

- [ ] **Step 1: Write the failing tests**

Add to `src/files/file-surface-controller.test.ts`, following the file's existing fake-client
and controller-construction helpers:

```ts
describe("tree maintenance", () => {
  it("Refresh re-lists every visible directory and keeps the cached listings", async () => {
    // Design §7: clearing first destroys the map `visibleDirectories` reads, so
    // only the root would reload — and it throws away the deliberate "keep the
    // last good listing when a reload fails" behaviour.
    const listDir = vi.fn(async () => []);
    const controller = makeController({ listDir });
    setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
    setListing(WS, `${WS}/src`, []);
    toggleDirectory(WS, `${WS}/src`);
    listDir.mockClear();

    controller.refreshTree(WS);
    await flush();

    expect(listDir.mock.calls.map((call) => call[1])).toEqual([WS, `${WS}/src`]);
    expect(surfaceFor(WS).listings.has(WS)).toBe(true);
    expect(surfaceFor(WS).listings.has(`${WS}/src`)).toBe(true);
  });

  it("Refresh snapshots the scope BEFORE any load lands", async () => {
    // A load that collapsed or grew the tree mid-pass would otherwise change
    // the set being iterated.
    const seen: string[] = [];
    const listDir = vi.fn(async (_root: string, directory: string) => {
      seen.push(directory);
      collapseAllDirectories(WS);
      return [];
    });
    const controller = makeController({ listDir });
    setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
    setListing(WS, `${WS}/src`, []);
    toggleDirectory(WS, `${WS}/src`);
    seen.length = 0;

    controller.refreshTree(WS);
    await flush();

    expect(seen).toEqual([WS, `${WS}/src`]);
  });

  it("Collapse All empties `expanded`, leaves the root open, and re-arms the watch once", () => {
    const watchPaths = vi.fn(async () => {});
    const controller = makeController({ watchPaths });
    setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
    setListing(WS, `${WS}/src`, []);
    toggleDirectory(WS, `${WS}/src`);
    activeWorkspace.value = WS;
    watchPaths.mockClear();

    controller.collapseAll(WS);

    expect([...surfaceFor(WS).expanded]).toEqual([]);
    expect(surfaceFor(WS).rootExpanded).toBe(true);
    expect(watchPaths).toHaveBeenCalledTimes(1);
    expect(watchPaths.mock.calls[0][1]).toEqual([WS]);
  });

  it("toggling the root collapses it, then loads and re-watches on the way back open", async () => {
    const watchPaths = vi.fn(async () => {});
    const listDir = vi.fn(async () => []);
    const controller = makeController({ watchPaths, listDir });
    activeWorkspace.value = WS;
    setListing(WS, WS, []);
    watchPaths.mockClear();
    listDir.mockClear();

    controller.toggleRoot(WS);
    expect(surfaceFor(WS).rootExpanded).toBe(false);
    expect(watchPaths).toHaveBeenCalledTimes(1);

    controller.toggleRoot(WS);
    await flush();
    expect(surfaceFor(WS).rootExpanded).toBe(true);
    // `ensureListing` is a no-op for a listing already cached and error-free,
    // so re-opening does NOT re-read the root — that is Refresh's job.
    expect(listDir).not.toHaveBeenCalled();
  });
});
```

Reuse whatever `makeController` / `flush` helpers the file already defines; if it builds its
controller inline, follow that shape instead and keep the assertions identical.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/files/file-surface-controller.test.ts
```

Expected: FAIL — `refreshTree`, `collapseAll` and `toggleRoot` are not on the controller.

- [ ] **Step 3: Extend the interface**

In `src/files/file-surface-controller.ts`, on `FileSurfaceController`:

```ts
  /**
   * Open or shut the ROOT row (design §3.3). Not `toggleDirectory`: that one
   * writes the `expanded` set, which means something else entirely.
   */
  toggleRoot(workspacePath: string): void;
  /**
   * Re-read every directory whose contents are on screen (design §7).
   *
   * It must NOT clear the cached listings first: clearing destroys the map
   * `visibleDirectories` reads, so only the root would reload, and it throws
   * away the deliberate "keep the last good listing when a reload fails"
   * behaviour. The generation counter in `loadListing` already discards a
   * stale answer, so a Refresh racing the watcher's coalescer costs one
   * redundant `list_dir` and nothing else. The coalescer is deliberately not
   * reused: it exists to absorb bursts, and a Refresh the user PRESSED must
   * not be debounced with them.
   */
  refreshTree(workspacePath: string): void;
  /** Collapse every child directory, leaving the root open (design §8). */
  collapseAll(workspacePath: string): void;
```

- [ ] **Step 4: Implement them on the returned object**

Add the store imports (`collapseAllDirectories`, `setRootExpanded`, `surfaceFor`) and:

```ts
    toggleRoot(workspacePath) {
      const surface = surfaceFor(workspacePath);
      const next = !surface.rootExpanded;
      setRootExpanded(workspacePath, next);
      // Collapsing shrinks the visible scope to the root alone; expanding
      // restores it. Either way the watch set has to be re-stated, and only
      // this layer may say so.
      refreshWatch();
      if (next) {
        void this.ensureListing(workspacePath, workspacePath);
      }
    },

    refreshTree(workspacePath) {
      // Snapshotted BEFORE the first load: an answer landing mid-pass can
      // change which directories are visible, and the set being iterated must
      // not move under the loop.
      const directories = [...visibleDirectories(workspacePath)];
      for (const directory of directories) {
        void loadListing(workspacePath, directory);
      }
    },

    collapseAll(workspacePath) {
      collapseAllDirectories(workspacePath);
      // Design §8: collapsing releases every descendant watcher, and only the
      // controller can say so. A store-only update would leave them alive
      // until some unrelated transition happened to fire.
      refreshWatch();
    },
```

- [ ] **Step 5: Run the suite**

```bash
npx vitest run src/files
```

Expected: PASS. Note that any test constructing a `FileSurfaceController` literal (including
`file-tree-view.test.tsx`'s `fakeController`) now needs the three new methods — add
`toggleRoot: vi.fn()`, `refreshTree: vi.fn()`, `collapseAll: vi.fn()` there.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git commit -- src/files/file-surface-controller.ts src/files/file-surface-controller.test.ts \
  src/files/ui/file-tree-view.test.tsx \
  -m "feat(explorer): add root toggle, refresh and collapse-all to the controller"
```

---

### Task 7: Controller create — the status line's state and the created row's focus

**Files:**
- Modify: `src/files/file-surface-store.ts` (two signals)
- Modify: `src/files/file-surface-store.test.ts`
- Modify: `src/files/file-surface-controller.ts`
- Modify: `src/files/file-surface-controller.test.ts`

**Spec ambiguity resolved here:** §5.3 and §5.4 say the outcome "lands on the panel's DL-19.5
status line" but do not say who holds that string. **The call:** one window-scoped signal
`explorerStatus` in the store, holding `{ workspacePath, text, failed } | null`, replaced by the
next create and cleared when the workspace changes. One slot rather than a per-workspace map,
for `pendingReveal`'s reason: one action is one message, and a second action means the user moved on.

**Interfaces:**
- Consumes: `FileClient.createEntry` (Task 5); `isHidden` from `file-tree.ts`; `setShowHidden`,
  `setRootExpanded`, `toggleDirectory` (Task 2).
- Produces:
  - `explorerStatus: Signal<ExplorerStatus | null>` and `setExplorerStatus(...)`, `clearExplorerStatus()`
  - `pendingTreeFocus: Signal<string | null>`, `requestTreeFocus(path)`, `clearTreeFocus(path)`
  - `FileSurfaceController.createEntry(workspacePath, parent, name, kind): Promise<boolean>` —
    true when the entry was created.

- [ ] **Step 1: Write the failing store tests**

```ts
describe("explorerStatus", () => {
  it("holds one message at a time, scoped to a workspace", () => {
    setExplorerStatus("/r", "Showing hidden files so .github is visible.", false);
    expect(explorerStatus.value).toEqual({
      workspacePath: "/r",
      text: "Showing hidden files so .github is visible.",
      failed: false,
    });
    setExplorerStatus("/r", "An entry with that name already exists.", true);
    expect(explorerStatus.value?.failed).toBe(true);
    clearExplorerStatus();
    expect(explorerStatus.value).toBeNull();
  });
});

describe("pendingTreeFocus", () => {
  it("is spent only by the path it names", () => {
    requestTreeFocus("/r/new.ts");
    clearTreeFocus("/r/other.ts");
    expect(pendingTreeFocus.value).toBe("/r/new.ts");
    clearTreeFocus("/r/new.ts");
    expect(pendingTreeFocus.value).toBeNull();
  });
});

it("resetFileSurfaces clears both", () => {
  setExplorerStatus("/r", "x", true);
  requestTreeFocus("/r/a");
  resetFileSurfaces();
  expect(explorerStatus.value).toBeNull();
  expect(pendingTreeFocus.value).toBeNull();
});
```

- [ ] **Step 2: Run and watch it fail; then implement the store half**

```bash
npx vitest run src/files/file-surface-store.test.ts
```

In `src/files/file-surface-store.ts`:

```ts
/** One transient line for the explorer's DL-19.5 status row. */
export interface ExplorerStatus {
  readonly workspacePath: string;
  readonly text: string;
  /** Painted `--red` (DL-3.2) rather than `--text-faint` (DL-3.4). */
  readonly failed: boolean;
}

/**
 * The explorer's one status message, or null.
 *
 * A single slot rather than a per-workspace map, for `pendingReveal`'s reason:
 * one action is one message, and a second action means the user moved on. It
 * carries its workspace so a message raised in one tree cannot print under
 * another, which is the case a bare string would get wrong.
 */
export const explorerStatus = signal<ExplorerStatus | null>(null);

export function setExplorerStatus(workspacePath: string, text: string, failed: boolean): void {
  explorerStatus.value = { workspacePath, text, failed };
}

export function clearExplorerStatus(): void {
  explorerStatus.value = null;
}

/**
 * A path a newly created row should take focus on (design §5.3).
 *
 * A STORED request rather than an imperative call into the tree, exactly like
 * `pendingReveal` above: the create is answered by the controller, the focus
 * belongs to `FileTreeView`, and the row does not exist until the parent's
 * re-listing has landed and re-rendered.
 */
export const pendingTreeFocus = signal<string | null>(null);

export function requestTreeFocus(path: string): void {
  pendingTreeFocus.value = path;
}

/** Spend the request for `path`. A no-op for anything else — a stale entry
 * belongs to a create that is no longer being focused. */
export function clearTreeFocus(path: string): void {
  if (pendingTreeFocus.value === path) {
    pendingTreeFocus.value = null;
  }
}
```

Add both to `resetFileSurfaces()`.

- [ ] **Step 3: Write the failing controller tests**

```ts
describe("createEntry", () => {
  it("re-lists the parent explicitly, focuses the new row and opens a file as PREVIEW", async () => {
    const createEntryFake = vi.fn(async () => ({ path: `${WS}/notes.md` }));
    const listDir = vi.fn(async () => [
      { name: "notes.md", path: `${WS}/notes.md`, directory: false, outOfRoot: false },
    ]);
    const controller = makeController({ createEntry: createEntryFake, listDir });
    activeWorkspace.value = WS;
    setListing(WS, WS, []);
    listDir.mockClear();

    const ok = await controller.createEntry(WS, WS, "notes.md", "file");

    expect(ok).toBe(true);
    expect(createEntryFake).toHaveBeenCalledWith(WS, WS, "notes.md", "file");
    // Design §5.3.1: `fs.watch` is not trusted to deliver a create the user
    // just pressed — the repo already treats it as lossy.
    expect(listDir).toHaveBeenCalledWith(WS, WS);
    expect(pendingTreeFocus.value).toBe(`${WS}/notes.md`);
    // Design §5.3.3: the PREVIEW slot, so creating several files in a row does
    // not fill the strip.
    expect(fileTabsFor(WS).map((tab) => [tab.path, tab.preview])).toEqual([
      [`${WS}/notes.md`, true],
    ]);
  });

  it("expands the parent and does not open a folder", async () => {
    const controller = makeController({
      createEntry: vi.fn(async () => ({ path: `${WS}/src/new` })),
      listDir: vi.fn(async () => []),
    });
    activeWorkspace.value = WS;
    setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);

    await controller.createEntry(WS, `${WS}/src`, "new", "directory");

    expect([...surfaceFor(WS).expanded]).toContain(`${WS}/src`);
    // Design §5.3.2: the new folder itself starts collapsed.
    expect([...surfaceFor(WS).expanded]).not.toContain(`${WS}/src/new`);
    expect(fileTabsFor(WS)).toEqual([]);
  });

  it("re-opens a collapsed root when the create lands in it", async () => {
    const controller = makeController({
      createEntry: vi.fn(async () => ({ path: `${WS}/a.ts` })),
      listDir: vi.fn(async () => []),
    });
    activeWorkspace.value = WS;
    setRootExpanded(WS, false);
    await controller.createEntry(WS, WS, "a.ts", "file");
    expect(surfaceFor(WS).rootExpanded).toBe(true);
  });

  it("turns showHidden on for a hidden name and says so", async () => {
    const controller = makeController({
      createEntry: vi.fn(async () => ({ path: `${WS}/.github` })),
      listDir: vi.fn(async () => []),
    });
    activeWorkspace.value = WS;
    await controller.createEntry(WS, WS, ".github", "directory");
    expect(surfaceFor(WS).showHidden).toBe(true);
    expect(explorerStatus.value).toEqual({
      workspacePath: WS,
      text: "Showing hidden files so .github is visible.",
      failed: false,
    });
  });

  it("says nothing extra when showHidden is already on", async () => {
    const controller = makeController({
      createEntry: vi.fn(async () => ({ path: `${WS}/.env` })),
      listDir: vi.fn(async () => []),
    });
    activeWorkspace.value = WS;
    setShowHidden(WS, true);
    await controller.createEntry(WS, WS, ".env", "file");
    expect(explorerStatus.value).toBeNull();
  });

  it("routes every failure to the status line in red and creates nothing", async () => {
    const controller = makeController({
      createEntry: vi.fn(async () => {
        throw new Error("An entry with that name already exists.");
      }),
    });
    activeWorkspace.value = WS;
    const ok = await controller.createEntry(WS, WS, "taken.md", "file");
    expect(ok).toBe(false);
    expect(explorerStatus.value).toEqual({
      workspacePath: WS,
      text: "An entry with that name already exists.",
      failed: true,
    });
    expect(pendingTreeFocus.value).toBeNull();
  });
});
```

- [ ] **Step 4: Run and watch them fail, then implement**

On the interface:

```ts
  /**
   * Create one file or one folder, then do everything design §5.3 requires:
   * re-list the parent explicitly, expand it, focus the new row, and open a
   * FILE in the preview slot. Returns false when the create failed — the
   * reason is already on the status line by then (design §5.4).
   */
  createEntry(
    workspacePath: string,
    parent: string,
    name: string,
    kind: EntryKind,
  ): Promise<boolean>;
```

On the returned object:

```ts
    async createEntry(workspacePath, parent, name, kind) {
      let created: string;
      try {
        const result = await client.createEntry(workspacePath, parent, name, kind);
        created = result.path;
      } catch (error: unknown) {
        // Design §5.4: EEXIST, an invalid name main rejected, a permission
        // error — all one road, to the panel's own status line. No second
        // dialog, and the naming modal closes either way: a modal that
        // survives its own failure has to own an error state, and the status
        // line already exists.
        setExplorerStatus(
          workspacePath,
          error instanceof Error ? error.message : "Deck could not create that entry.",
          true,
        );
        return false;
      }
      if (disposed) {
        return true;
      }
      // Design §5.3.4: a hidden name under a hidden filter would create
      // something invisible. Turning the filter on is the honest answer, and
      // it is said out loud. There is no control to turn it back off — a known
      // gap, recorded in the spec's §15.
      if (isHidden(name) && !surfaceFor(workspacePath).showHidden) {
        setShowHidden(workspacePath, true);
        setExplorerStatus(workspacePath, `Showing hidden files so ${name} is visible.`, false);
      } else {
        clearExplorerStatus();
      }
      if (parent === workspacePath) {
        if (!surfaceFor(workspacePath).rootExpanded) {
          setRootExpanded(workspacePath, true);
        }
      } else if (!surfaceFor(workspacePath).expanded.has(parent)) {
        toggleDirectory(workspacePath, parent);
      }
      // Design §5.3.1: an explicit re-list, awaited. `fs.watch` is not trusted
      // to deliver a create the user just pressed — this repo already treats
      // it as lossy — and the row has to exist before focus can land on it.
      await loadListing(workspacePath, parent);
      if (disposed) {
        return true;
      }
      requestTreeFocus(created);
      refreshWatch();
      if (kind === "file") {
        // The PREVIEW slot, the same one a single click opens, so creating
        // several files in a row does not fill the strip (design §5.3.3).
        await this.openFile(workspacePath, created, false);
      }
      return true;
    },
```

`loadListing` is a hoisted function declaration in the controller's closure — the existing
`treeRefresh` wiring already references it before its textual definition, so calling it here is
safe.

- [ ] **Step 5: Run, typecheck, commit**

```bash
npx vitest run src/files
npx tsc --noEmit
git commit -- src/files/file-surface-store.ts src/files/file-surface-store.test.ts \
  src/files/file-surface-controller.ts src/files/file-surface-controller.test.ts \
  -m "feat(explorer): create an entry, then re-list, expand, focus and preview it"
```

---

### Task 8: `FileTreeView` renders the root row and focuses by path

**Files:**
- Modify: `src/files/ui/file-tree-view.tsx`
- Modify: `src/files/ui/file-tree-view.test.tsx`

**Why:** spec §3.2 and §3.4. This task is the tree only — the cluster arrives in Task 9, so this
one is reviewable on its own.

**Interfaces:**
- Consumes: `resolveFocusIndex` (Task 3), `toggleRoot` (Task 6), `pendingTreeFocus` /
  `clearTreeFocus` (Task 7), `rootExpanded` (Task 2).
- Produces: a `.file-tree__row` at index 0 whose `path` is the workspace path, drawn with a
  chevron and a name and NO type icon.

- [ ] **Step 1: Write the failing component tests**

```tsx
it("draws the root as row 0 with a caret and no folder icon", async () => {
  await mountTree();
  const rows = host.querySelectorAll(".file-tree__row");
  expect(rows[0].querySelector(".file-tree__name")?.textContent).toBe("r");
  expect(rows[0].getAttribute("aria-level")).toBe("1");
  expect(rows[0].querySelector(".file-tree__chevron")).not.toBeNull();
  // Design §3.2: `iconForRow` is not consulted for the root — the caret at
  // depth 0 already says "this is the folder everything is in".
  expect(rows[0].querySelector(".file-tree__icon")).toBeNull();
  expect(rows[1].getAttribute("aria-level")).toBe("2");
});

it("marks the root row so it can carry its own ink", async () => {
  await mountTree();
  expect(host.querySelector(".file-tree__row")?.classList.contains("is-root")).toBe(true);
});

it("clicking the root row toggles the root and not a directory", async () => {
  const toggleRoot = vi.fn();
  const toggleDirectory = vi.fn();
  await mountTree(fakeController({ toggleRoot, toggleDirectory }));
  (host.querySelector(".file-tree__row") as HTMLElement).click();
  expect(toggleRoot).toHaveBeenCalledWith(WS);
  expect(toggleDirectory).not.toHaveBeenCalled();
});

it("ArrowLeft on an open root collapses it; ArrowRight re-opens it", async () => {
  const toggleRoot = vi.fn();
  await mountTree(fakeController({ toggleRoot }));
  press("ArrowLeft");
  expect(toggleRoot).toHaveBeenCalledTimes(1);
});

it("keeps the root row while the listing is still loading", async () => {
  // Design §3.3: a workspace whose listing failed still says which folder
  // failed, and can still be refreshed.
  await mountTree(fakeController(), { listing: null });
  expect(host.querySelectorAll(".file-tree__row")).toHaveLength(1);
  expect(host.querySelector(".file-tree__status")?.textContent).toBe("Loading…");
});

it("says 'No files' beneath the root row, not instead of it", async () => {
  await mountTree(fakeController(), { listing: [] });
  expect(host.querySelectorAll(".file-tree__row")).toHaveLength(1);
  expect(host.querySelector(".file-tree__status")?.textContent).toBe("No files");
});

it("says nothing about emptiness while the root is collapsed", async () => {
  setRootExpanded(WS, false);
  await mountTree(fakeController(), { listing: [] });
  expect(host.querySelector(".file-tree__status")).toBeNull();
});

it("keeps focus on a path across a re-sort", async () => {
  await mountTree();          // rows: r, src, readme.md
  await focusRow(2);          // readme.md
  setListing(WS, WS, [
    { name: "aaa.ts", path: `${WS}/aaa.ts`, directory: false, outOfRoot: false },
    { name: "src", path: `${WS}/src`, directory: true, outOfRoot: false },
    { name: "readme.md", path: `${WS}/readme.md`, directory: false, outOfRoot: false },
  ]);
  await frame();
  const rows = [...host.querySelectorAll<HTMLElement>(".file-tree__row")];
  const stop = rows.findIndex((row) => row.tabIndex === 0);
  expect(rows[stop].querySelector(".file-tree__name")?.textContent).toBe("readme.md");
});

it("falls back to the nearest surviving row when the focused path leaves", async () => {
  await mountTree();
  await focusRow(2);
  setListing(WS, WS, [{ name: "src", path: `${WS}/src`, directory: true, outOfRoot: false }]);
  await frame();
  const rows = [...host.querySelectorAll<HTMLElement>(".file-tree__row")];
  expect(rows.findIndex((row) => row.tabIndex === 0)).toBe(1);
});

it("focuses the row a create asked for, once it exists", async () => {
  await mountTree();
  requestTreeFocus(`${WS}/readme.md`);
  await frame();
  expect(document.activeElement?.textContent).toContain("readme.md");
  expect(pendingTreeFocus.value).toBeNull();
});
```

Add the small helpers this file needs (`mountTree`, `focusRow`, `press`, `frame`) following the
harness the file already has; `frame` must await an animation frame, not a microtask — a signal
change reaches a Preact effect on the next frame in this repo.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/files/ui/file-tree-view.test.tsx
```

- [ ] **Step 3: Replace the index state with a path**

In `src/files/ui/file-tree-view.tsx`:

```tsx
  const surface = surfaceFor(workspacePath);
  const rows = treeRows(workspacePath);
  const loaded = surface.listings.has(workspacePath);

  const containerRef = useRef<HTMLDivElement>(null);
  // Keyed by PATH, not by index: rows re-sort under a create or a
  // `showHidden` flip, and an index-keyed map hands the focus effect a
  // stale element (design §3.4).
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusRef = useRef<string | null>(null);
  /** The index the focused path last occupied, so a path that leaves the tree
   * falls back to where it was rather than to the top. */
  const lastIndexRef = useRef(0);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const focusedIndex = resolveFocusIndex(rows, focusedPath, lastIndexRef.current);
  lastIndexRef.current = focusedIndex;
```

Delete the `useEffect` that clamped `focusedIndex` against `rows.length` — `resolveFocusIndex`
does that on every render now, with no state write and therefore no extra render.

- [ ] **Step 4: Rewrite the pending-focus effect against paths**

```tsx
  /* oxlint-disable react-hooks/exhaustive-deps -- runs after every render by design; the setState is guarded */
  useEffect(() => {
    const node = containerRef.current;
    const path = pendingFocusRef.current;
    if (node === null || path === null) {
      return;
    }
    const index = rows.findIndex((row) => row.path === path);
    if (index === -1) {
      // The row is not there yet — a create whose re-listing has not landed.
      // Leave the request armed; the next render tries again.
      return;
    }
    if (viewportHeight > 0) {
      const rowTop = index * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < node.scrollTop) {
        node.scrollTop = rowTop;
        setScrollTop(rowTop);
        return;
      }
      if (rowBottom > node.scrollTop + viewportHeight) {
        const next = rowBottom - viewportHeight;
        node.scrollTop = next;
        setScrollTop(next);
        return;
      }
    }
    rowRefs.current.get(path)?.focus();
    pendingFocusRef.current = null;
  });
  /* oxlint-enable react-hooks/exhaustive-deps */

  // A create asks for its own row by path (design §5.3), from the controller,
  // which cannot reach the DOM. The request is spent only once the row is
  // actually focusable — `pendingReveal`'s contract for the editor, applied to
  // the tree.
  //
  // `pendingTreeFocus.value` is read HERE, in the render body, and not inside
  // the effect. That read is what subscribes this component to the signal; a
  // signal touched only inside a no-deps effect never re-renders anything, so
  // the effect would not run again when the request arrives and the created
  // row would silently not take focus. (It would appear to work in the real
  // flow only because `setListing` forces a render first — which is exactly
  // the kind of accident a unit test is supposed to catch.)
  const wantedFocus = pendingTreeFocus.value;
  useEffect(() => {
    if (wantedFocus === null || !rows.some((row) => row.path === wantedFocus)) {
      return;
    }
    setFocusedPath(wantedFocus);
    pendingFocusRef.current = wantedFocus;
    clearTreeFocus(wantedFocus);
  }, [wantedFocus, rows]);
```

- [ ] **Step 5: Route activation and the arrow keys around the root**

```tsx
  function activateRow(row: TreeRow): void {
    // The root is a directory row, but its expansion is `rootExpanded`, not a
    // member of `expanded` (design §3.3) — so it cannot go through
    // `toggleDirectory`.
    if (row.path === workspacePath) {
      controller.toggleRoot(workspacePath);
      return;
    }
    if (row.directory) { /* unchanged */ }
    /* unchanged */
  }
```

In `handleKeyDown`, before anything else:

```tsx
    // A cluster button on the root row is a descendant of the container that
    // holds this listener. Without this guard, Enter on "New File" ALSO ran
    // `activateRow(rows[0])` and collapsed the tree — `stopPropagation` on the
    // button's click covers the pointer path only (DL-27.1's container-plus-hit-layer
    // shape, applied to a row).
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).classList.contains("file-tree__row")) {
      return;
    }
```

and in the ArrowRight / ArrowLeft branches:

```tsx
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (row.path === workspacePath) {
        if (!row.expanded) {
          controller.toggleRoot(workspacePath);
        }
        return;
      }
      if (row.directory && canExpand(row) && !row.expanded) { /* unchanged */ }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.path === workspacePath) {
        if (row.expanded) {
          controller.toggleRoot(workspacePath);
        }
        return;
      }
      if (row.directory && row.expanded) { /* unchanged */ }
      return;
    }
```

ArrowUp/ArrowDown set `setFocusedPath(rows[next].path)` and `pendingFocusRef.current = rows[next].path`.

`handleRowClick` loses its `index` parameter and records the path instead:

```tsx
  function handleRowClick(row: TreeRow, target: HTMLDivElement): void {
    setFocusedPath(row.path);
    target.focus();
    activateRow(row);
  }
```

- [ ] **Step 6: Render the root row and move the status text below the rows**

`rows` is never empty for a non-null workspace — the root is always there — so the old
`rows.length === 0` branch cannot fire. Replace the `body` block:

```tsx
  // The root row is always present, so `rows` is never empty and the old
  // "instead of the rows" status branches are gone: loading, empty and error
  // all KEEP the root row (design §3.3), which is what lets a workspace whose
  // listing failed still say which folder failed and still be refreshed.
  let status: ComponentChild = null;
  if (!loaded && !listingErrors.has(workspacePath)) {
    status = <p class="file-tree__status">Loading…</p>;
  } else if (loaded && surface.rootExpanded && rows.length === 1) {
    status = <p class="file-tree__status">No files</p>;
  }
```

and inside the row map:

```tsx
          const isRoot = row.path === workspacePath;
          return (
            <div
              key={row.path}
              ref={(el) => {
                if (el === null) {
                  rowRefs.current.delete(row.path);
                } else {
                  rowRefs.current.set(row.path, el);
                }
              }}
              role="treeitem"
              aria-expanded={row.directory ? row.expanded : undefined}
              aria-level={row.depth + 1}
              tabIndex={index === focusedIndex ? 0 : -1}
              class={`file-tree__row${isRoot ? " is-root" : ""}`}
              style={{ top: `${index * ROW_HEIGHT}px`, paddingLeft: `${8 + row.depth * 14}px` }}
              title={isRoot ? workspacePath : undefined}
              onClick={(event) => handleRowClick(row, event.currentTarget as HTMLDivElement)}
              onDblClick={() => handleDoubleClick(row)}
            >
              <span class="file-tree__chevron" style={{ visibility: row.directory ? "visible" : "hidden" }}>
                <DeckIcon icon={chevronForRow(row)} size={ROW_ICON} />
              </span>
              {/* Design §3.2: no type glyph on the root — the caret at depth 0
                  already says "this is the folder everything is in". */}
              {isRoot ? null : (
                <span class="file-tree__icon">
                  <DeckIcon icon={iconForRow(row)} size={ROW_ICON} />
                </span>
              )}
              <span class="file-tree__name">{row.name}</span>
            </div>
          );
```

Render `{status}` as a sibling AFTER `.file-tree__rows`, inside `.file-tree`.

- [ ] **Step 7: Add the root's own ink**

In `src/styles/14-dock.css`, after `.file-tree__name`:

```css
/* Design §3.2: the root's name is `--text-primary` where the rows are
   `--text-muted`. That one step is the whole reason the row reads as the root
   — it keeps the tree's 22px height and `--ui-font` (DL-19), because it is a
   row of the tree and not a header above it. */
.file-tree__row.is-root .file-tree__name {
  color: var(--text-primary);
}
```

- [ ] **Step 8: Run, typecheck, commit**

```bash
npx vitest run src/files
npx tsc --noEmit
npx prettier --check src/files/ui/file-tree-view.tsx src/styles/14-dock.css
git commit -- src/files/ui/file-tree-view.tsx src/files/ui/file-tree-view.test.tsx src/styles/14-dock.css \
  -m "feat(explorer): draw the root row and move focus from an index to a path"
```

---

### Task 9: The trailing cluster on the root row

**Files:**
- Create: `src/files/ui/tree-root-actions.tsx`, `src/files/ui/tree-root-actions.test.tsx`
- Modify: `src/files/ui/file-tree-view.tsx`
- Modify: `src/files/ui/explorer-tab.tsx`, `src/files/ui/explorer-tab.test.tsx`
- Modify: `src/ui/app.tsx` (passes `canCreate`)
- Modify: `src/styles/14-dock.css`

**Why a prop and not a module read:** spec §11 requires "the create controls are absent when the
facade reports unavailable". `available` is a `const` export — hard to fake without `vi.mock`.
`ExplorerTab` takes `canCreate: boolean` and `App` wires it from `file-create-host`'s `available`,
so the component test passes `false` directly.

**This task cites DL-19.9, DL-21.2, DL-21.3 and DL-23.10 in comments** — Task 1 must be done.

**Interfaces:**
- Consumes: `available` (Task 5), `refreshTree` / `collapseAll` (Task 6), `createEntryRequest` (Task 10).
- Produces:
  ```tsx
  export interface TreeRootActionsProps {
    readonly canCreate: boolean;
    /** 0 when the root row is the roving tab stop, −1 otherwise (design §4.3). */
    readonly tabIndex: 0 | -1;
    onNewFile(): void;
    onNewFolder(): void;
    onRefresh(): void;
    onCollapseAll(): void;
  }
  export function TreeRootActions(props: TreeRootActionsProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing cluster tests**

`src/files/ui/tree-root-actions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeRootActions } from "./tree-root-actions";

let host: HTMLDivElement;
const handlers = () => ({
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
  onRefresh: vi.fn(),
  onCollapseAll: vi.fn(),
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

describe("TreeRootActions", () => {
  it("draws four controls in spec order when the host can create", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "New file",
      "New folder",
      "Refresh",
      "Collapse all",
    ]);
  });

  it("omits the two create controls when the host cannot answer", () => {
    // Design §6.4: a control that cannot answer is worse than no control
    // (DL-19.7's own reasoning). Refresh and Collapse All are renderer-only,
    // so the cluster never disappears entirely.
    act(() => render(<TreeRootActions canCreate={false} tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Refresh",
      "Collapse all",
    ]);
  });

  it("mirrors the row's roving tab stop onto every button", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={-1} {...handlers()} />, host));
    for (const button of host.querySelectorAll("button")) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("stops a click from reaching the row behind it", () => {
    const rowClick = vi.fn();
    host.addEventListener("click", rowClick);
    const props = handlers();
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} />, host));
    act(() => (host.querySelector("button") as HTMLElement).click());
    expect(props.onNewFile).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("drops the native title and describes itself on hover (DL-23.10)", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
    const button = host.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBeNull();
    act(() => button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true })));
    const tip = document.querySelector(".action-tip");
    expect(tip?.textContent).toContain("New file");
    // None of the four is a keymap action, so there is no chord to print.
    expect(tip?.querySelector(".action-tip__kbd")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/files/ui/tree-root-actions.test.tsx
```

- [ ] **Step 3: Implement `src/files/ui/tree-root-actions.tsx`**

```tsx
/**
 * The four actions of the explorer tab, hanging off the row that names what
 * the tab is showing (DL-19.9, design §4).
 *
 * This is the rail's own arrangement — `.asr-cluster__add` hangs a launcher off
 * a project header (DL-27.18) — with the one difference the owner asked for:
 * the cluster does NOT hide at rest. The hover-reveal was the drawn candidate
 * and was declined, which removes its single real cost: a column that showed no
 * actions until the pointer arrived.
 *
 * Each control is 17×17 and is deliberately NOT `.iconbtn` (design §4.2).
 * `.iconbtn` is 24×24, and four of them inside a 22px `.file-tree__row`
 * overflow it by 1px above and 1px below — measured on the gallery drawing,
 * 2026-08-25. `ROW_HEIGHT` is the constant every index in `FileTreeView` is
 * computed from, so the row cannot grow to fit the control; the control
 * shrinks instead. `.iconbtn`'s own missing `padding: 0` reset is therefore
 * not inherited here — but any future `.iconbtn` on this surface must still
 * declare it locally.
 */
import { useRef } from "preact/hooks";
import {
  ArrowClockwise,
  ArrowsInLineVertical,
  FilePlus,
  FolderPlus,
} from "@phosphor-icons/react";
import { CHROME_ICON, DeckIcon, type DeckIconComponent } from "../../ui/controls/deck-icon";
import {
  ActionTooltip,
  tooltipTriggerProps,
  useTooltipVisibility,
} from "../../ui/controls/action-tooltip";

export interface TreeRootActionsProps {
  /** Whether the running host can answer `create_entry` (design §6.4, §10). */
  readonly canCreate: boolean;
  /**
   * The root row's roving tab stop, mirrored (design §4.3). Tab enters the
   * tree once, lands on the root row and walks into these four; it never
   * offers eight tab stops inside a list that is meant to be one.
   */
  readonly tabIndex: 0 | -1;
  onNewFile(): void;
  onNewFolder(): void;
  onRefresh(): void;
  onCollapseAll(): void;
}

interface ClusterButtonProps {
  readonly id: string;
  readonly label: string;
  readonly icon: DeckIconComponent;
  readonly tabIndex: 0 | -1;
  onPress(): void;
}

function ClusterButton({ id, label, icon, tabIndex, onPress }: ClusterButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  // DL-23.10: an icon-only chrome control with an action draws the §23
  // tooltip and drops its native `title`. The name only — none of the four is
  // a keymap action, so there is no chord to show (DL-23.1's content rule).
  const tooltip = useTooltipVisibility();
  return (
    <>
      <button
        ref={ref}
        type="button"
        class="file-tree__action"
        aria-label={label}
        aria-describedby={tooltip.anchor === null ? undefined : id}
        tabIndex={tabIndex}
        onClick={(event) => {
          // Design §4.3: the row is a container plus a hit layer now. Without
          // this, pressing New File would ALSO toggle the root.
          event.stopPropagation();
          onPress();
        }}
        // A double-click on a control must not reach the row's own
        // double-click handler either.
        onDblClick={(event) => event.stopPropagation()}
        {...tooltipTriggerProps(tooltip, ref)}
      >
        <DeckIcon icon={icon} size={CHROME_ICON} />
      </button>
      {tooltip.anchor !== null && (
        <ActionTooltip id={id} label={label} shortcut={null} reason={null} anchor={tooltip.anchor} />
      )}
    </>
  );
}

export function TreeRootActions(props: TreeRootActionsProps) {
  return (
    <span class="file-tree__actions">
      {props.canCreate && (
        <>
          <ClusterButton
            id="file-tree-new-file"
            label="New file"
            icon={FilePlus}
            tabIndex={props.tabIndex}
            onPress={props.onNewFile}
          />
          <ClusterButton
            id="file-tree-new-folder"
            label="New folder"
            icon={FolderPlus}
            tabIndex={props.tabIndex}
            onPress={props.onNewFolder}
          />
        </>
      )}
      <ClusterButton
        id="file-tree-refresh"
        label="Refresh"
        icon={ArrowClockwise}
        tabIndex={props.tabIndex}
        onPress={props.onRefresh}
      />
      <ClusterButton
        id="file-tree-collapse-all"
        label="Collapse all"
        icon={ArrowsInLineVertical}
        tabIndex={props.tabIndex}
        onPress={props.onCollapseAll}
      />
    </span>
  );
}
```

- [ ] **Step 4: Style it**

In `src/styles/14-dock.css`:

```css
/* DL-19.9: the tab's own actions, hanging off the row that names what the tab
   is showing. Always visible — the drawn hover-reveal was declined. */
.file-tree__actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 1px;
  margin-left: auto;
}

/* Design §4.2: `.asr-cluster__add`'s box exactly, because it solves exactly
   this problem one row height up. NOT `.iconbtn` — its 24px box overflows a
   22px row by 1px above and below, and `ROW_HEIGHT` is the constant every
   index in the virtual list is computed from, so the row cannot grow. The
   `padding: 0` here is load-bearing: the UA gives every button 1px 6px, which
   would push a 13px glyph out of a 17px box. */
.file-tree__action {
  display: flex;
  width: 17px;
  height: 17px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--duration) var(--ease);
}

/* DL-21.2: hover is the neutral step to `--text-primary`, the same signifier
   every other chrome control uses. */
.file-tree__action:hover {
  color: var(--text-primary);
}

/* DL-21.3: focus-visible is a 2px --accent outline, inset so it cannot add a
   pixel to a row whose height is a constant. */
.file-tree__action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

/* Design §4.6: the NAME gives way, never the controls. `.file-tree__name`
   already truncates; a flex item will not shrink below its content without
   this. */
.file-tree__name {
  min-width: 0;
}
```

Add `min-width: 0` to the existing `.file-tree__name` rule rather than declaring a second block
if the file's convention is one block per class.

- [ ] **Step 5: Mount it in `FileTreeView`**

Add a `canCreate` prop to `FileTreeViewProps`, and inside the root row, after the name span:

```tsx
              {isRoot && (
                <TreeRootActions
                  canCreate={canCreate}
                  // Design §4.3: keyboard reach follows the roving tabindex
                  // rather than fighting it.
                  tabIndex={index === focusedIndex ? 0 : -1}
                  onNewFile={() => requestCreate("file")}
                  onNewFolder={() => requestCreate("directory")}
                  onRefresh={() => controller.refreshTree(workspacePath)}
                  onCollapseAll={() => controller.collapseAll(workspacePath)}
                />
              )}
```

`requestCreate` is Task 10's; until then, stub it as a local that does nothing and note the TODO
in the commit message — or implement Task 10 first and reorder. **Recommended: run Task 10
before this step**, then wire both in one pass; the two are listed separately because they are
separately reviewable, not because they must land in this order.

Thread `canCreate` from `ExplorerTab` (new prop, defaulting nowhere — pass it explicitly) and
from `App`:

```tsx
import { available as fileCreateAvailable } from "../host/file-create-host";
// …
<ExplorerTab controller={fileController} workspacePath={…} canCreate={fileCreateAvailable} />
```

- [ ] **Step 6: Assert the row's own behaviour in `file-tree-view.test.tsx`**

```tsx
it("pressing a cluster control does not toggle the root — pointer and keyboard", async () => {
  const toggleRoot = vi.fn();
  const refreshTree = vi.fn();
  await mountTree(fakeController({ toggleRoot, refreshTree }));
  const refresh = host.querySelector('[aria-label="Refresh"]') as HTMLButtonElement;

  act(() => refresh.click());
  expect(refreshTree).toHaveBeenCalledTimes(1);
  expect(toggleRoot).not.toHaveBeenCalled();

  // The keyboard path is a SEPARATE bug: `stopPropagation` on the click covers
  // the pointer only, and the container's own `onKeyDown` would still run
  // `activateRow(rows[0])`.
  act(() => {
    refresh.focus();
    refresh.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(toggleRoot).not.toHaveBeenCalled();
});

it("hands the cluster the root row's tab stop and takes it away again", async () => {
  await mountTree();
  const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".file-tree__action")];
  expect(buttons().every((b) => b.tabIndex === 0)).toBe(true);
  await focusRow(1);
  expect(buttons().every((b) => b.tabIndex === -1)).toBe(true);
});

it("omits the create controls when the host cannot answer", async () => {
  await mountTree(fakeController(), { canCreate: false });
  expect(host.querySelector('[aria-label="New file"]')).toBeNull();
  expect(host.querySelector('[aria-label="Refresh"]')).not.toBeNull();
});
```

- [ ] **Step 7: Run, typecheck, commit**

```bash
npx vitest run src/files src/ui/app.test.tsx
npx tsc --noEmit
npx vitest run scripts/design-language.test.ts
npx prettier --check src/files/ui/tree-root-actions.tsx src/files/ui/file-tree-view.tsx src/styles/14-dock.css
git commit -- src/files/ui/tree-root-actions.tsx src/files/ui/tree-root-actions.test.tsx \
  src/files/ui/file-tree-view.tsx src/files/ui/file-tree-view.test.tsx \
  src/files/ui/explorer-tab.tsx src/files/ui/explorer-tab.test.tsx \
  src/ui/app.tsx src/styles/14-dock.css \
  -m "feat(explorer): hang the four actions off the root row (DL-19.9)"
```

---

### Task 10: The naming modal

**Files:**
- Create: `src/files/ui/create-entry-dialog.tsx`, `src/files/ui/create-entry-dialog.test.tsx`
- Modify: `src/chrome/events.ts`
- Modify: `src/ui/app-policy.ts`, `src/ui/app.test.tsx`
- Modify: `src/ui/app.tsx`
- Modify: `src/styles/10-modals.css`

**Where it mounts, and why:** `.dock-panel` carries `transform: translateX(100%)` at rest and
`transform: none` while open, plus `pointer-events: none` at rest. A `position: fixed`
descendant of a transformed ancestor resolves against that ancestor, so a modal mounted inside
`FileTreeView` would be positioned by the panel during the 0.28s slide and inert while the panel
is closing. **The dialog mounts in `App`**, raised through a request signal —
`editorRequest`'s exact precedent — which also hands `browserPanelObscured` its input for free.

**Interfaces:**
- Consumes: `checkEntryName` (Task 4), `createTargetDirectory` (Task 3),
  `controller.createEntry` (Task 7).
- Produces:
  ```ts
  // src/chrome/events.ts
  export interface CreateEntryRequest {
    readonly workspacePath: string;
    readonly parent: string;
    readonly kind: EntryKind;
  }
  export const createEntryRequest = signal<CreateEntryRequest | null>(null);
  ```
  and `BrowserPanelObscuredState.createEntryOpen: boolean`.

- [ ] **Step 1: Write the failing policy test**

In `src/ui/app.test.tsx`, beside the existing `browserPanelObscured` cases:

```ts
it("hides the native browser view while the explorer's naming dialog is up", () => {
  // The dock stays visible while a browser tab covers the stage, and a native
  // `WebContentsView` cannot be covered by any DOM layer — so this dialog's
  // open signal joins the guard the way `agentQuickPickerOpen` and
  // `usageConsentOpen` already have. This repo has shipped that bug twice.
  expect(browserPanelObscured({ ...allFalse, createEntryOpen: true })).toBe(true);
});
```

Add `createEntryOpen: false` to whatever base object the existing cases use.

- [ ] **Step 2: Run, watch it fail, implement the signal and the guard**

`src/chrome/events.ts`:

```ts
/**
 * The explorer's naming dialog, or null (design §5.2).
 *
 * A request signal rather than local state in the tree, for two reasons.
 * `.dock-panel` is transformed while it slides, and a `position: fixed` scrim
 * inside a transformed ancestor is positioned by that ancestor — so the modal
 * mounts in `App`, like `editorRequest`'s does. And `browserPanelObscured` has
 * to be able to read it: a native `WebContentsView` cannot be covered by any
 * DOM layer, so a dialog that does not declare itself draws underneath the
 * browser.
 */
export const createEntryRequest = signal<CreateEntryRequest | null>(null);
```

`src/ui/app-policy.ts`: add `readonly createEntryOpen: boolean;` to
`BrowserPanelObscuredState` and `state.createEntryOpen ||` to the disjunction.

`src/ui/app.tsx`: add `createEntryOpen: createEntryRequest.value !== null,` to the
`browserPanelObscured({…})` call.

- [ ] **Step 3: Write the failing dialog tests**

```tsx
it("names its destination and refuses an invalid name before main sees it", async () => {
  mountDialog({ workspacePath: "/r", parent: "/r/src", kind: "file" });
  expect(host.querySelector(".create-entry__destination")?.textContent).toContain("src");
  const input = host.querySelector("input") as HTMLInputElement;
  const confirm = host.querySelector(".is-primary") as HTMLButtonElement;

  expect(confirm.disabled).toBe(true);       // empty
  await type(input, "a/b");
  expect(confirm.disabled).toBe(true);
  expect(host.querySelector(".create-entry__reason")?.textContent).toBe(
    "A name can't contain a path separator.",
  );
  await type(input, "notes.md");
  expect(confirm.disabled).toBe(false);
  expect(host.querySelector(".create-entry__reason")).toBeNull();
});

it("accepts a leading dot", async () => {
  mountDialog({ workspacePath: "/r", parent: "/r", kind: "directory" });
  await type(host.querySelector("input") as HTMLInputElement, ".github");
  expect((host.querySelector(".is-primary") as HTMLButtonElement).disabled).toBe(false);
});

it("takes focus on mount, confirms on Enter and closes either way", async () => {
  const onCreate = vi.fn(async () => true);
  mountDialog({ workspacePath: "/r", parent: "/r", kind: "file" }, onCreate);
  expect(document.activeElement?.tagName).toBe("INPUT");
  await type(host.querySelector("input") as HTMLInputElement, "a.ts");
  await press("Enter");
  expect(onCreate).toHaveBeenCalledWith("/r", "/r", "a.ts", "file");
  expect(createEntryRequest.value).toBeNull();
});

it("closes on a failure too — the status line owns the reason (design §5.4)", async () => {
  mountDialog({ workspacePath: "/r", parent: "/r", kind: "file" }, vi.fn(async () => false));
  await type(host.querySelector("input") as HTMLInputElement, "taken.md");
  await press("Enter");
  expect(createEntryRequest.value).toBeNull();
});
```

- [ ] **Step 4: Implement `src/files/ui/create-entry-dialog.tsx`**

```tsx
/**
 * Naming a new file or folder (design §5.2).
 *
 * The shared `Modal` shell (DL §29) — one text field, a confirm and a cancel,
 * focus on mount, Escape and the scrim both close it. It follows
 * `SavePresetDialog`'s shape and adds no genre. Raising it is what DL-19.5's
 * 2026-08-25 amendment permits: a panel does not raise a dialog to report its
 * own STATE, and this is a dialog the user pressed a control to open.
 *
 * The field validates as the user types and the confirm stays disabled while
 * the name is invalid, with the reason printed under it. That validation is a
 * CONVENIENCE, never the boundary — main validates the same name again
 * (design §6.3), through the very same module.
 */
import { useSignal } from "@preact/signals";
import { Modal } from "../../ui/modal";
import { checkEntryName } from "../entry-name";
import { baseName } from "../../lib/path-name";
import type { EntryKind } from "../../host/file-create-host";

export interface CreateEntryDialogProps {
  readonly workspacePath: string;
  readonly parent: string;
  readonly kind: EntryKind;
  onCancel(): void;
  /** Resolves once the create has been attempted; the dialog closes either
   * way, because a modal that survives its own failure has to own an error
   * state and the panel's status line already exists (design §5.4). */
  onCreate(workspacePath: string, parent: string, name: string, kind: EntryKind): Promise<boolean>;
}

export function CreateEntryDialog(props: CreateEntryDialogProps) {
  const name = useSignal("");
  const busy = useSignal(false);
  const check = checkEntryName(name.value);
  const heading = props.kind === "file" ? "New file" : "New folder";
  // Design §5.1: the destination is stated so the answer is never guessed.
  // That matters more with the controls on the ROOT's row than it would in a
  // header — the button the user pressed may well create somewhere else. Shown
  // workspace-relative, because the absolute path is the tree's own root row.
  const destination =
    props.parent === props.workspacePath
      ? baseName(props.workspacePath)
      : `${baseName(props.workspacePath)}/${props.parent.slice(props.workspacePath.length + 1)}`;

  async function confirm(): Promise<void> {
    if (!check.ok || busy.value) {
      return;
    }
    busy.value = true;
    await props.onCreate(props.workspacePath, props.parent, name.value, props.kind);
    props.onCancel();
  }

  return (
    <Modal
      panelClass="create-entry"
      label={heading}
      onDismiss={props.onCancel}
      initialFocus="input"
      onKeyDown={(event) => {
        if (event.key !== "Enter") {
          return;
        }
        void confirm();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <h1>{heading}</h1>
      <p class="create-entry__destination">in {destination}</p>
      <input
        value={name.value}
        placeholder={props.kind === "file" ? "File name" : "Folder name"}
        onInput={(event) => {
          name.value = (event.target as HTMLInputElement).value;
        }}
      />
      {name.value !== "" && !check.ok && <p class="create-entry__reason">{check.reason}</p>}
      <div class="create-entry__actions">
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class="is-primary"
          disabled={!check.ok || busy.value}
          onClick={() => void confirm()}
        >
          Create
        </button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 5: Style it in `src/styles/10-modals.css`**

Follow `.save-preset`'s own block for the panel, the heading and the action row. Add only what
is new:

```css
/* DL-19.5, amended 2026-08-25: a dialog the user PRESSED a control to open may
   use the shared shell. The panel is `--sidebar-bg` like every other modal
   (DL-29.6). */
.create-entry {
  width: 320px;
}

.create-entry__destination {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--type-meta);
}

/* DL-3.2: a refusal is red. This is the field's own reason, not the panel's
   status line — that one lives under the dock's header and reports what main
   answered. */
.create-entry__reason {
  margin: 0;
  color: var(--red);
  font-size: var(--type-meta);
}
```

Copy `.save-preset`'s padding/gap/`--radius-surface`/`--ui-font` declarations into `.create-entry`
verbatim rather than inventing values; if `10-modals.css` already groups those under a shared
selector list, add `.create-entry` to that list instead.

- [ ] **Step 6: Mount it in `App` and raise it from the tree**

In `App`, beside the other modals:

```tsx
{createEntryRequest.value !== null && (
  <CreateEntryDialog
    workspacePath={createEntryRequest.value.workspacePath}
    parent={createEntryRequest.value.parent}
    kind={createEntryRequest.value.kind}
    onCancel={() => {
      createEntryRequest.value = null;
    }}
    onCreate={(workspacePath, parent, name, kind) =>
      fileController.createEntry(workspacePath, parent, name, kind)
    }
  />
)}
```

In `FileTreeView`, implement the `requestCreate` referenced by Task 9:

```tsx
  function requestCreate(kind: EntryKind): void {
    createEntryRequest.value = {
      workspacePath,
      // Design §5.1: the FOCUSED directory, falling back to the root. The
      // controls sit on the root's row and may well create somewhere else,
      // which is why the modal states the answer.
      parent: createTargetDirectory(rows, focusedPath, workspacePath),
      kind,
    };
  }
```

- [ ] **Step 7: Run, typecheck, commit**

```bash
npx vitest run src/files src/ui/app.test.tsx
npx tsc --noEmit
npx prettier --check src/files/ui/create-entry-dialog.tsx src/chrome/events.ts src/ui/app-policy.ts src/styles/10-modals.css
git commit -- src/files/ui/create-entry-dialog.tsx src/files/ui/create-entry-dialog.test.tsx \
  src/files/ui/file-tree-view.tsx src/chrome/events.ts src/ui/app-policy.ts \
  src/ui/app.tsx src/ui/app.test.tsx src/styles/10-modals.css \
  -m "feat(explorer): name a new entry in a modal that declares itself to the browser view"
```

---

### Task 11: The DL-19.5 status line

**Files:**
- Modify: `src/files/ui/explorer-tab.tsx`, `src/files/ui/explorer-tab.test.tsx`
- Modify: `src/styles/14-dock.css`

**Why `ExplorerTab` and not `FileTreeView`:** DL-19.5 puts the line "directly under the header",
which is above the tree, and the tree is a scroller — a line inside it would scroll away.

**Interfaces:**
- Consumes: `explorerStatus`, `clearExplorerStatus` (Task 7).

- [ ] **Step 1: Write the failing tests**

```tsx
it("prints a create failure in red under the header", async () => {
  setExplorerStatus(WS, "An entry with that name already exists.", true);
  await mountTab(WS);
  const line = host.querySelector(".file-tree-shell__status");
  expect(line?.textContent).toBe("An entry with that name already exists.");
  expect(line?.classList.contains("is-failure")).toBe(true);
  expect(line?.getAttribute("role")).toBe("status");
});

it("prints the hidden-files notice without the failure colour", async () => {
  setExplorerStatus(WS, "Showing hidden files so .github is visible.", false);
  await mountTab(WS);
  expect(host.querySelector(".file-tree-shell__status")?.classList.contains("is-failure")).toBe(false);
});

it("says nothing about another workspace's message", async () => {
  setExplorerStatus("/other", "boom", true);
  await mountTab(WS);
  expect(host.querySelector(".file-tree-shell__status")).toBeNull();
});

it("clears the line when the tab moves to a different workspace", async () => {
  setExplorerStatus(WS, "boom", true);
  await mountTab(WS);
  await mountTab("/other");
  expect(explorerStatus.value).toBeNull();
});
```

- [ ] **Step 2: Run, watch it fail, implement**

In `src/files/ui/explorer-tab.tsx`:

```tsx
export function ExplorerTab(props: ExplorerTabProps) {
  const { workspacePath } = props;
  // DL-19.5: the panel's ONE place for transient text, directly under the
  // header. It is the only place a failed create is ever reported — the naming
  // modal closes either way (design §5.4), and a second dialog would be
  // exactly what that rule exists to prevent.
  useEffect(() => {
    // A message belongs to the tree it was raised in; moving the tab to
    // another workspace retires it rather than reprinting it there.
    return () => clearExplorerStatus();
  }, [workspacePath]);

  if (workspacePath === null) {
    return (
      <p class="explorer-tab__empty" role="status">
        This tab has no workspace to show.
      </p>
    );
  }
  const status = explorerStatus.value;
  const line = status !== null && status.workspacePath === workspacePath ? status : null;
  return (
    <>
      {line !== null && (
        <p class={`file-tree-shell__status${line.failed ? " is-failure" : ""}`} role="status">
          {line.text}
        </p>
      )}
      <FileTreeView
        controller={props.controller}
        workspacePath={workspacePath}
        canCreate={props.canCreate}
      />
    </>
  );
}
```

`.file-tree-shell` is `flex: 1` inside `.dock-panel__body`; the status line is a sibling above
it, so it must be `flex-shrink: 0` and the shell must keep `min-height: 0`. Check the wrapper
`App` gives the tab; if the tab is not already inside a column flex container, wrap the two in
one `<div class="explorer-tab">` with `display: flex; flex-direction: column; height: 100%;
min-height: 0;` and **declare `box-sizing: border-box` on it** — `src/styles.css` has no global
reset, and this element has a percentage height.

CSS:

```css
/* DL-19.5: one status line, directly under the header, `--text-faint` — or
   `--red` when it reports a failure (DL-3.2). */
.file-tree-shell__status {
  flex-shrink: 0;
  margin: 0;
  padding: 6px 8px;
  color: var(--text-faint);
  font-family: var(--ui-font);
  font-size: var(--type-meta);
  line-height: 1.4;
}

.file-tree-shell__status.is-failure {
  color: var(--red);
}
```

- [ ] **Step 3: Run, typecheck, commit**

```bash
npx vitest run src/files
npx tsc --noEmit
npx vitest run scripts/design-language.test.ts
git commit -- src/files/ui/explorer-tab.tsx src/files/ui/explorer-tab.test.tsx src/styles/14-dock.css \
  -m "feat(explorer): route create outcomes to the panel's DL-19.5 status line"
```

---

### Task 12: The gallery — the drawing is parked, the real tree is registered, and the layout is measured

**Files:**
- Create: `src/gallery/sections/explorer-tree-section.tsx`
- Modify: `src/gallery/section-registry.ts`
- Modify: `scripts/gallery-entry.test.ts`

**Why:** spec §11's last bullet is a BROWSER measurement — jsdom has no layout, so no unit test
can answer it. The rail precedent (`agentRailNavigationSpecimen`) is to mount the real component
in the gallery and measure it there. And `explorer-header-variants.tsx` is a comparison page
whose candidate has now shipped: it leaves the registry and **stays in the tree**, exactly as
`unread-mark-variants` did, per the comment in `section-registry.ts` itself. Read that comment
before editing it.

- [ ] **Step 1: Add the specimen**

`src/gallery/sections/explorer-tree-section.tsx` mounts the REAL `FileTreeView` (R7 allows
gallery → app), seeded through the store's own exported writers, in a container fixed at
DL-19.4's 360px floor:

```tsx
/**
 * The shipping explorer tree, at the docked column's 360px floor.
 *
 * The REAL component and the real store — not a drawing. It replaces the
 * `explorer header direction` comparison page, whose candidate C shipped on
 * 2026-08-25; that file stays in the tree as the record of the review, out of
 * the registry, like `unread-mark-variants`.
 *
 * What it exists to answer is measurable and nothing else can answer it: jsdom
 * has no layout, so "every row is still 22px, the cluster fits inside the root
 * row, and nothing overflows at the floor" is a browser question.
 */
```

Seed with `resetFileSurfaces()` + `setListing(...)` for a root holding a directory, a couple of
files and a nested level, and pass a fake `FileSurfaceController` built from the gallery's
existing stub conventions. Give the mount `style={{ width: "360px" }}`.

- [ ] **Step 2: Swap the registry entry**

Replace the `explorer-header` entry with:

```ts
  { id: "explorer-tree", label: "explorer tree", Section: ExplorerTreeSection },
```

Delete the `ExplorerHeaderVariantsSection` import and extend the registry's own comment:

```
 * `explorer header direction` was registered on 2026-08-25 and taken out the
 * same day the work shipped: its candidate C is what the real tree draws now,
 * so a three-way comparison would show two treatments that lost beside a
 * `current` column that is no longer current. The file stays in the tree as
 * the record of that review, unimported like the other parked comparison
 * pages — and `explorer tree` takes its slot, mounting the shipping
 * `FileTreeView` where the drawing used to stand.
```

- [ ] **Step 3: Pin the unpark**

In `scripts/gallery-entry.test.ts`, inside "keeps only selected candidates after a comparison
round closes":

```ts
    const registry = readFileSync(join(SOURCE_ROOT, "gallery/section-registry.ts"), "utf8");
    // The drawing is parked, not deleted — the record of the review survives.
    expect(existsSync(join(SOURCE_ROOT, "gallery/sections/explorer-header-variants.tsx"))).toBe(true);
    expect(registry).not.toContain("ExplorerHeaderVariantsSection");
    expect(registry).toContain("ExplorerTreeSection");
```

- [ ] **Step 4: Run the gallery gate**

```bash
npx vitest run scripts/gallery-entry.test.ts
```

Expected: PASS, including the existing "no app module imports anything from src/gallery/" case.

- [ ] **Step 5: Measure it in a browser**

```bash
npm run prototype:gallery      # serves 127.0.0.1:5175
```

**Check the server is yours before trusting it** — another session may already hold that port
with a different build. Verify the served page shows the `explorer tree` section before
measuring.

Drive it with Playwright and record every number in the report. The assertions spec §11 names:

```js
// every row is still exactly ROW_HEIGHT
rows.every((r) => Math.round(r.getBoundingClientRect().height) === 22)
// the cluster sits INSIDE the root row, top and bottom
actions.every((b) => b.getBoundingClientRect().top    >= root.getBoundingClientRect().top &&
                     b.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom)
// each control is the 17x17 box, not .iconbtn's 24
actions.every((b) => Math.round(b.getBoundingClientRect().width) === 17)
// no horizontal overflow at the 360px floor — a 1px overflow MOVES chrome the
// first time focus lands inside the scroller
tree.scrollWidth <= tree.clientWidth
// the root row draws a caret and no type glyph
root.querySelector(".file-tree__chevron") !== null && root.querySelector(".file-tree__icon") === null
```

Also take a screenshot in `deck-dark` and one in `deck-light`, and check both a long workspace
name (the name must ellipsize, the cluster must not shrink — spec §4.6) and a collapsed root
(one row, still carrying the four controls — spec §3.3).

- [ ] **Step 6: Commit**

```bash
git commit -- src/gallery/sections/explorer-tree-section.tsx src/gallery/section-registry.ts \
  scripts/gallery-entry.test.ts \
  -m "chore(gallery): park the explorer header drawing and register the shipping tree"
```

---

### Task 13: The documentation

**Files:**
- Modify: `AGENTS.md` (a "Current direction" entry, a "Forks" open-queue entry, and §15's drift rows)
- Modify: `docs/CONTEXT.md` (D9 — a plan completed)
- Modify: `CHANGELOG.md` (D12 — a user-visible behaviour change)

**Do this LAST**, once every gate above has been run, so the evidence sentences are true rather
than hopeful. **D14: do not `git commit` any of these three until the owner has read them.**
Write the files, run the gates, and report; staging is the owner's call.

- [ ] **Step 1: Run the full gate list and keep the output**

```bash
npm test
npx tsc --noEmit
npx tsc -p tsconfig.electron.json
npm run build
npm run electron:build
npx vitest run scripts/design-language.test.ts scripts/electron-ipc-contract.test.ts scripts/gallery-entry.test.ts
```

Attribute every failure against a pristine tree before writing a number down. Paste the counts
verbatim into the docs — never round, never write "green" without the figure.

- [ ] **Step 2: `AGENTS.md` — Current direction**

Add an entry in the same voice as its neighbours, stating what changed, what it costs, and
exactly what is unverified:

```
- **The explorer shows its root, and that row carries the tab's four actions
  (2026-08-25).** New DL-19.9; DL-19.5 amended. The tree never said what it was
  rooted at — `flattenTree` emitted the root's CHILDREN at depth 0 — so two
  worktrees of one repository showed two identical columns of `src` /
  `electron` / `package.json`. The root is a `TreeRow` now, at index 0, drawn
  with a caret and a `--text-primary` name and NO folder icon, and it is in the
  MODEL rather than in separate DOM above the scroller because the spacer
  height, the window, the roving tabindex, `scrollIntoView` and every arrow key
  are all index arithmetic over one array. `rootExpanded` is a new
  per-workspace field and could not be folded into `expanded`, which already
  means "this child directory is open". **Focus moved from an index to a
  path** ([`resolveFocusIndex`](src/files/tree-focus.ts) `current`), because a
  create re-sorts the rows and §5.3 asks focus to land on a created ENTRY,
  which is an identity. The four controls are a trailing cluster on that row,
  **always visible** — the drawn hover-reveal was declined — and each is 17×17
  rather than `.iconbtn`'s 24×24, which overflows a 22px row by 1px above and
  below. Refresh re-lists every visible directory WITHOUT clearing the cache
  (clearing destroys the map `visibleDirectories` reads, so only the root would
  reload); Collapse All empties `expanded`, leaves the root open, and is a
  CONTROLLER operation because only the controller may call `refreshWatch()`.
  Creating goes out over one new Electron-only channel,
  [`create_entry`](electron/fs/create-entry.ts) `current` — `open(…, "wx")` or
  a non-recursive `mkdir`, so it can never overwrite, a symlink included — and
  its name validator is one pure module BOTH processes import, accepting a
  leading dot and refusing the Windows device names on every platform. The
  naming modal joins `browserPanelObscured`; failures land on the DL-19.5
  status line and never in a second dialog. **Root binding is stated, not
  fixed:** `resolveRoot` accepts any absolute non-UNC existing path and
  `registerExplorer` takes the renderer's `root` verbatim, which is a property
  of every EXISTING explorer channel; the owner's decision was accept and
  record, so it is a drift row below rather than a boundary this claims to
  hold. Electron-only. **Owed: a native `electron:dev` pass and the owner eye
  review** — nothing here has been pressed in a running app; Windows is Gate C.
  See [spec](docs/specs/2026-08-25-explorer-root-row-and-actions-design.md)
  `decided` and [plan](docs/plans/2026-08-25-explorer-root-row-and-actions.md)
  `building`.
```

- [ ] **Step 3: `AGENTS.md` — the Forks open-queue entry**

At the TOP of the open queue (newest first, matching the file's order), one entry naming every
fork-listed category this work touched and what was chosen over what:

```
- **The explorer's root row adds a DL rule, amends another, adds one IPC
  channel and one state field (2026-08-25, owner-approved by the spec's §1
  table).** Two fork-listed categories: **rules in
  `docs/DESIGN-LANGUAGE.md`** — DL-19.9 is new (a docked panel's tab hangs its
  own actions off the row that names what it is showing, sized to the row
  rather than to chrome), and DL-19.5 is amended so a dialog the USER pressed a
  control to open may use the shared `Modal` shell, which the naming modal
  needs and the rule as written forbade; and **IPC** — `create_entry` joins
  `CHANNELS` as an Electron-only flat channel beside `create_directory`, with
  the contract fixture that pins its four keys. The per-workspace
  `rootExpanded` is state, not a settings field: it is window-scoped like the
  rest of `FileSurfaceState` and is deliberately NOT persisted, so it never
  becomes the only restored explorer state. Chosen over an explorer-owned 26px
  action row (spends tree height permanently and needs a nested-scroller fix),
  over the four controls in the shared `dock-panel__header` (`DockPanel`
  deliberately knows nothing about what its tabs contain, and at DL-19.4's
  360px floor it puts eight icon buttons in one row), over reusing
  `write_file` (renames over its target, so New File would silently truncate)
  and `create_directory` (not bounded to a root, and refuses every name
  starting with `.`), and over an inline editable row in the tree (a virtual
  row inside the windowing math plus its own focus and error handling). NOT
  touched: PTY ownership, process classification, the window coordinator, tab
  materialization, layout, close/quit coordination, the settings schema, the
  keymap, any R4 seam beyond `flattenTree`'s own signature, or any sibling repo.
```

- [ ] **Step 4: `AGENTS.md` — the drift rows**

Append the spec's §15 table to `AGENTS.md`'s own "Chưa khớp thực tế" table, in its column
format. Three rows:

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| The explorer names its root and can create, refresh and collapse | `building` | unverified | Built 2026-08-25 from the spec (new DL-19.9; DL-19.5 amended). Paste the real gate figures here. **Owed: a native `electron:dev` pass and the owner eye review** — no entry has been created, no tooltip seen and no status line read in a running app; Windows is Gate C |
| An explorer channel's `root` is a workspace this window has open | `current` | **false** | `resolveRoot` accepts any absolute non-UNC existing path and `registerExplorer` takes the renderer's `root` verbatim; the guard proves containment, not authorization. Pre-existing across ALL explorer channels and not introduced by `create_entry`; **accepted by owner decision 2026-08-25** (spec §9) rather than fixed, because binding roots to the owning window changes every explorer channel's authorization and is an R6 contract move of its own. The exposure is bounded: `wx` and a non-recursive `mkdir` cannot overwrite |
| Hidden files can be shown and hidden from the UI | `decided` | backlog | `setShowHidden` has no UI control. The create flow turns it ON as a side effect of creating a hidden name and says so on the status line; there is no way back short of reopening the workspace (spec §12) |
| The explorer restores each workspace's scroll position | `current` | **false** | `FileSurfaceState.scrollTop` / `setScrollTop` are never read or written by `FileTreeView`, which keeps its own local state — so scroll leaks between workspaces when the component survives a `workspacePath` change. Made more visible by the root row and Collapse All; not fixed (spec §12) |

**The owner explicitly asked for the root-binding row to be recorded rather than fixed.** Do not
"helpfully" harden `resolveRoot` in this task — that is a different piece of work.

- [ ] **Step 5: `docs/CONTEXT.md` (D9)**

Add a dated section — `## The explorer names its root — 2026-08-25` — carrying the detail that
does not belong in `AGENTS.md`: the `openDirectories` dedupe and why it was needed, the
index-to-path focus migration and the row-refs rekeying, the Enter-on-a-button double-fire the
keyboard guard closes, why the modal mounts in `App` rather than in the panel
(`.dock-panel`'s transform), why Refresh does not reuse the coalescer, and the exact gate
figures. Anchor every behavioural claim with a relative markdown link plus an intent label
(`current` / `decided` / `building` / `deprecated`) per D6, and leave the file's existing
"Chưa khớp thực tế" section intact.

- [ ] **Step 6: `CHANGELOG.md` (D12)**

Under the unreleased section, in the file's own voice:

```
- The file explorer now shows the folder it is rooted at as the first row of
  the tree, with New File, New Folder, Refresh and Collapse All on that row.
  A new file or folder is created in the focused directory, falling back to the
  workspace root.
```

- [ ] **Step 7: Report, do not commit**

Leave all three files written and unstaged. Report the paths, the gate figures, and the two
things no gate covers (the native pass and the eye review).

---

## Self-review — spec §11 coverage

| Spec §11 requirement | Task that owns it |
| --- | --- |
| `flattenTree` with `rootExpanded` true and false; root at index 0, level 1, children at level 2; a collapsed root emitting exactly one row | Task 2, Step 1 |
| The name validator: the dot-leading accept, and every rejection in §6.3, including the Windows reserved names on macOS | Task 4, Step 1 |
| The refresh scope: the snapshot is taken before any load, and the listings map is never emptied | Task 6, Step 1 (both cases) |
| Collapse All: `expanded` empty, `rootExpanded` untouched, `refreshWatch` called once | Task 6, Step 1 |
| `create_entry` in main: EEXIST for both kinds, an existing symlink at the destination refused, a `parent` outside the named root refused | Task 5, Step 1 |
| Component: pressing a cluster control does not toggle the root row (pointer AND keyboard) | Task 9, Step 6 |
| Component: the buttons' `tabIndex` follows the roving tab stop | Task 9, Steps 1 and 6 |
| Component: focus by path survives a re-sort | Task 8, Step 1 |
| Component: the create controls are absent when the facade reports unavailable | Task 9, Steps 1 and 6 |
| Layout, in the browser: every row is still `ROW_HEIGHT`; the cluster sits inside the root row with no vertical overflow; no horizontal overflow at the 360px floor | Task 12, Step 5 |
| Gates: `npm test`, both typechecks, both builds, the design-language gate for DL-19.9 and the DL-19.5 amendment | Task 13, Step 1 (and per-task runs throughout) |
| A native `electron:dev` pass and the owner's eye review are REQUIRED before this is claimed to work | Stated in "Verification gates"; recorded as owed in Task 13 |

| Spec section | Task |
| --- | --- |
| §3.1 root in the model | 2 |
| §3.2 caret + name, no folder icon | 8 |
| §3.3 `rootExpanded`; loading/empty/error keep the root row | 2 (field), 8 (render) |
| §3.4 focus by path | 3 (policy), 8 (component) |
| §4.1 placement, always visible | 9 |
| §4.2 the 17px control, not `.iconbtn` | 9 |
| §4.3 container plus hit layer; mirrored `tabIndex`; `role="treeitem"` kept | 8 (keyboard guard), 9 |
| §4.4 DL-19.9 and the DL-19.5 amendment | 1 |
| §4.5 tooltips, name only, no native `title` | 9 |
| §4.6 `min-width: 0` / `flex-shrink: 0` | 9 |
| §5.1 create target | 3 (policy), 10 (modal states it) |
| §5.2 the modal, and `browserPanelObscured` | 10 |
| §5.3 post-create behaviour incl. the `showHidden` side effect | 7 |
| §5.4 failures to the status line | 7 (state), 11 (render) |
| §6.1 the channel | 5 |
| §6.2 why neither existing channel was reused | 5 (comment) |
| §6.3 the validator | 4 |
| §6.4 the host facade | 5 (facade), 9 (`canCreate` prop) |
| §7 Refresh | 6 |
| §8 Collapse All | 6 |
| §9 the path guard, stated rather than fixed | 13 (drift row) |
| §10 host gating is explicit | 9 |
| §12 out of scope | not built, recorded in 13 |
| §15 drift table | 13 |
