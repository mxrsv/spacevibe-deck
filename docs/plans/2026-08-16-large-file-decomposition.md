# Plan — decomposing the oversized modules

Status: **proposed, nothing implemented.** Written 2026-08-16 from a read-only survey.
Owner decision required on the forks in §7 before any code is written.

> Every line range below is a 2026-08-16 snapshot of a tree three other sessions were writing
> to during the survey — `app.tsx` moved 1705 → 1708 mid-session. Re-verify offsets before
> cutting; do not trust them blind.

## 1. Why

Maintenance cost, not aesthetics. Six shipping files and one test file are large enough that
an agent (or a person) has to read hundreds of unrelated lines to change one thing, and every
edit to them carries a wider blast radius than the change deserves.

The global standard puts the ceiling at **800 lines** (F8: 200–400 typical, 800 max), so the
scope is everything above 800, plus the two files that sit just under it and are the worst
offenders for duplication.

## 2. Scope

**In scope (owner-selected):** `src/` and `electron/` shipping code, plus large test files.

| File                               | Lines | Class                         |
| ---------------------------------- | ----- | ----------------------------- |
| `src/styles.css`                   | 6884  | shipping                      |
| `src/terminal/tab-manager.ts`      | 2324  | shipping, **R4 seam in full** |
| `src/ui/app.tsx`                   | 1708  | shipping, partly R4           |
| `electron/main.ts`                 | 1032  | shipping, partly R4           |
| `src/terminal/terminal-manager.ts` | 920   | shipping, **R4 seam in full** |
| `src/terminal/action-registry.ts`  | 906   | shipping, **not R4**          |
| `src/terminal/tab-manager.test.ts` | 4749  | test                          |
| 12 further test files 500–731      | —     | test                          |

**Out of scope, deliberately:**

- `src-tauri/**/*.rs` (`coordinator.rs` 1824, `usage/scan.rs` 1128, `links.rs` 993, `pty.rs` 870).
  Tauri is feature-frozen and dies at cutover; refactoring it spends risk on code with a
  known end date.
- `src/gallery/*.css` (1893 + 1432) and `marketing/**/*.css` (1292 + 1072). Dev-only and
  marketing surfaces; the video shares application components, so churn there can silently
  alter rendered media.
- `src/ui/repository-rail.tsx` (640). Parked in the tree as the documented one-line revert
  target until the agent rail passes its native review. See §5.4.

## 3. Rules every step in this plan obeys

- **Pure moves.** No behaviour change, no renames of exported symbols, no signature changes
  in the same commit as a move.
- **One split = one commit**, staged with `git commit -- <paths>` only. The tree carries a
  large unrelated checkpoint and other sessions write to the same checkout; `git add -A`
  would sweep their work in.
- **The Edit tool, never `sed`/`python` rewrites.** Scripted rewrites have corrupted files in
  this repo before.
- New files follow F-rules: kebab-case, named for their function (no `utils.ts`), and every
  new file is imported in the same commit that creates it.
- R6 (IPC payload shape) and R7 (gallery import direction) are untouched by every step below.

## 4. Phase 0 — non-R4 extractions (safe, mechanical)

These touch no PTY, window, tab-materialization, layout or close/quit path.

### 4.1 `action-registry.ts` → `+ src/terminal/default-keymaps.ts`

The cleanest split in the repo: pure const data, zero closure state, and the dependency runs
one way only (`KeyBindingBase.action: ActionId` is the single cross-half reference).

- Keeps in `action-registry.ts`: lines 1–551 — `OverlayTier`, `TIER_RANK`, `ActionScope`,
  `MenuSubmenu`, `ActionDefinition`, `ACTION_REGISTRY`, `ActionId`, `isActionId` (~551 lines).
- Moves to `default-keymaps.ts`: lines 553–906 — `KeyBindingBase`, the char-vs-code RULE
  doc, `CharKeyBinding`/`PhysicalKeyBinding`/`KeyBinding`, both keymaps and their
  tab-select generators (~354 lines).
- Name `default-keymaps.ts`, not `keymaps.ts` — the latter collides visually with the
  existing `keymap.ts` matcher; `active-keymap.ts` already establishes the family.
- **Zero-churn option:** re-export `MACOS_KEYMAP`/`WINDOWS_KEYMAP`/`KeyBinding` from
  `action-registry.ts` (the pattern `keymap.ts:18-24` already uses) so no consumer changes at
  all. Otherwise five files import both halves: `keymap.ts`, `lib/keybindings.ts`,
  `electron/menu.ts`, `scripts/generate-menu.ts`, `keybindings.test.ts`.
- **R3 gate:** `scripts/generate-menu.ts` generates `src-tauri/src/menu_registry.rs` from
  `ACTION_REGISTRY` + `MACOS_KEYMAP` with a drift check. This step must run
  `npm run generate:menu` and `npm run generate:menu:check`. `electron/menu.ts` reads the same
  two — check cross-host menu parity.

### 4.2 `app.tsx` tier A — three zero-risk moves (~265 lines out)

All three are already at module scope with no `App` closure state.

| New file                     | Moves                                                                                                                         | Why                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/ui/desktop-chrome.tsx`  | 178–266 (`DesktopChromeProps`, `DesktopChrome`)                                                                               | Four gallery files import `DesktopChrome` from `app.tsx`, dragging App's ~60-import graph (updater, sessions, files, browser) in to get a presentational shell. |
| `src/ui/app-policy.ts`       | 268–394 (`closeSettingsPanel`, `toggleSettingsPanel`, `livePresetOpensATab`, `bootOpensTheBoard`, `workspaceOrphanedByClose`) | Their own doc comments say they were lifted to module scope to be unit-testable. `app.test.tsx` imports them.                                                   |
| `src/ui/app-restore-deps.ts` | 396–443 (`restoreDeps`, `railResumeDeps`, `resumingWorkspaces`)                                                               | Already module scope.                                                                                                                                           |

Convention: plain modules in `src/ui/`, like the existing `attention-focus-coordinator.ts` /
`sidebar-shell.ts` / `stage-surface-strip.ts`. Do **not** invent `src/ui/hooks/` — the repo has
exactly one `use-*` file and it sits beside its feature.

### 4.3 `terminal-manager.ts` types out (~167 lines)

Move lines 49–215 (`ManagerCallbacks`, `TerminalManagerDeps`, `DetachOutcome`,
`AdoptIntoActiveTabRequest`, `TerminalManager`, plus the two `TRANSFER_FALLBACK_*` consts) to
`src/terminal/terminal-manager-types.ts`. Zero runtime beyond the two constants.

**Constraint:** `src/files/gate-m-main.tsx:65` calls `createTerminalManager(container, {…})`
with two arguments — the packaged Gate-M artifact. The factory signature must not move.

### 4.4 `tab-manager.ts` tier A (~400 lines out, no closure state touched)

| New file                            | Moves                                                                                      | Note                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/terminal/surface-strip.ts`     | 272–339 (`SurfaceStrip`, `INERT_SURFACES`)                                                 | Highest value: `src/files/file-surface-controller.ts` and `src/ui/stage-surface-strip.ts` import this type _from tab-manager_ today. A dedicated module turns the R4 seam contract into a file. |
| `src/terminal/tab-manager-types.ts` | 247–270, 341–511                                                                           | ~265 lines, zero runtime.                                                                                                                                                                       |
| `src/terminal/tab-action-scope.ts`  | 107–230 (`ACTION_SCOPE`, `DESTRUCTIVE_ACTIONS`, `COMMAND_ACTIONS`, `DISPATCHABLE_ACTIONS`) | Pure derivation from `ACTION_REGISTRY`. `DISPATCHABLE_ACTIONS` has exactly two importers, both tests — decide re-export vs. editing those two imports and say which.                            |
| fold into `src/lib/process-info.ts` | 235–245 (`explicitAgent`, `processLabel`)                                                  | Prefer folding over a new 12-line file (F5/F9).                                                                                                                                                 |

**Must land in the same commit:** `src/files/file-surface-store.test.ts:49-65` asserts
_textually, against `tab-manager.ts`'s own import statements_, that tab-manager imports nothing
from `/files/`. Code moved out of tab-manager escapes that assertion silently. Widen it to the
extracted files.

## 5. Phase 1 — larger wins with a named hazard each

### 5.1 `src/styles.css` → an `@import` index (6884 → 15 partials)

**Mechanism:** keep `src/styles.css` as an index of `@import` statements only, with partials in
`src/styles/`. Vite bundles `postcss-import` and inlines `@import` in dev and build, so the
sheet keeps producing **one** style element whose `data-vite-dev-id` ends `src/styles.css`.

Splitting into multiple `main.tsx` imports is **not** viable: `src/gallery/css-audit.ts:16,52-70`
selects the app sheet by that exact dev id, and `force-states.ts` builds the gallery's
forced-state matrix off the same rule lists.

**Cascade order is load-bearing and the file says so in prose** — `styles.css:5939-5961` and
`6420-6435` document reduced-motion blocks that only work because they repeat their scope
_after_ the last rule they must beat, with a measured before/after (shell 0.22s → 0s,
rail 0.13s → 0s). `force-states.ts:20-26` copies every rule _in source order_ for the same
reason. Therefore: **contiguous line slices only, order preserved, never regroup by theme.**

Proposed partials, imported in this exact order:

| Partial                  | Lines     | ~Count |
| ------------------------ | --------- | ------ |
| `01-tokens.css`          | 1–126     | 126    |
| `02-shell.css`           | 127–677   | 551    |
| `03-repository-rail.css` | 678–1022  | 345    |
| `04-agent-rail.css`      | 1023–1981 | 959    |
| `05-tab-bar-toolbar.css` | 1982–2532 | 551    |
| `06-stage-panes.css`     | 2533–3184 | 652    |
| `07-config-rows.css`     | 3185–3750 | 566    |
| `08-popovers.css`        | 3751–3958 | 208    |
| `09-open-board.css`      | 3959–4728 | 770    |
| `10-modals.css`          | 4729–5069 | 341    |
| `11-settings-screen.css` | 5070–5377 | 308    |
| `12-usage.css`           | 5378–5961 | 584    |
| `13-sessions.css`        | 5962–6435 | 474    |
| `14-dock.css`            | 6436–6783 | 348    |
| `15-rail-footer.css`     | 6784–6884 | 101    |

Non-negotiable boundaries: `01-tokens` first (an `@import` must precede all rules, so `:root`
cannot stay in the index); `07`'s global reduced-motion block (3724–3750) stays at the end of
`07`; `12` and `13` import after `07` and each keeps its trailing "applied where it can win"
block. `04` is still 959 lines and can be sub-split at its own internal banners if a 500-line
target is wanted.

**The silent failure this step must fix in the same commit.** Two DL gates read _only_
`src/styles.css`; after a split, an index of `@import`s has zero rule blocks, so both scan
nothing and pass green with the entire stylesheet unenforced:

- `scripts/design-language.test.ts:88` `styledCasingViolations()` — the DL-4.3 gate.
- `scripts/design-language.test.ts:120` `offScaleRadii()` — the DL-20.1 radius gate.

Both must be changed to read the partials in index order. Four other assertions fail _loudly_
(good) and need their paths updated: the `--radius-*`/`--type-*` "declared exactly once"
checks (`design-language.test.ts:137-181`), the `.fileview` radius check (231–238),
`agent-rail.test.tsx:605-640` (reads `src/styles.css` and indexes `"\n.asr-rail {"`), and
`scripts/gallery-entry.test.ts:120-127`.

The DL-citation walker at `design-language.test.ts:11,216` already scans `src/**/*.css`, so
partials stay covered as long as comments move verbatim.

**Extra verification:** `npm run dev`, open the gallery, confirm the CSS audit still reports
non-zero rule counts.

### 5.2 `electron/main.ts` → registrar modules (~480 lines out, 1032 → ~550)

`scripts/electron-ipc-contract.test.ts:105` walks **all** of `electron/**/*.ts` for
`ipcMain.handle(...)`, so moving registrations into new `electron/` modules keeps the R6 guard
live. Extract as `registerX(deps)` functions taking an explicit deps object
(`{ emitTo, labelOf, windows, app, stores, browserPanels, … }`), called from `main.ts` in the
same order:

| New module                          | Moves                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `electron/ipc/register-services.ts` | 441–518                                                                            |
| `electron/ipc/register-themes.ts`   | 520–530                                                                            |
| `electron/ipc/register-explorer.ts` | 532–558                                                                            |
| `electron/ipc/register-store.ts`    | 697–789                                                                            |
| `electron/ipc/register-dialogs.ts`  | 702–715, 791–827                                                                   |
| `electron/ipc/register-shell.ts`    | 901–945                                                                            |
| `electron/ipc/register-browser.ts`  | 131–160, 848–893                                                                   |
| `electron/ipc/register-updater.ts`  | 676–691                                                                            |
| `electron/menu-state.ts`            | 359–418 (`setRecording` is called from `createWindow` at 230 and 296 — pass it in) |
| `electron/settings-ipc.ts`          | 560–576                                                                            |

What stays is exactly the R4 surface: constants, singletons, `emitTo`/`labelOf`,
`createWindow`, `censusOrDeny`, PTY registration, quit/close, transfers, boot. That is a
defensible endpoint at ~550 lines.

### 5.3 `tab-manager.ts` tier B — the TDZ hazard

If more than tier A is wanted, the sub-controller pattern this file already uses
(`close-coordinator.ts`, `pane-info-poller.ts`, `agent-activity.ts`, `agent-launch.ts`) is the
right shape. Best candidates, in order: `tab-notifications.ts` (694–756, owns its own
`lastNotifiedKind`), `tab-commands.ts` (1588–1781, reads everything but owns nothing),
`tab-view-projection.ts` (609–688, reshaped as a pure compute + the signal writes left behind).

**The hazard, and it is not visible to the compiler:** the closure is written with forward
references that work only because callers run after `init()` — `syncViews` (612) and
`callbacks.onLayoutChange` (769) reference `poller`, declared at **1504**; `commands["close-pane"]`
(1616–1625) references `close`, declared at **1482**; `notifier.isWindowFocused` (555)
references `windowFocused`, declared at **581**. Any extraction that changes initialization
order fails **at runtime with a TDZ ReferenceError**, not at build. Every tier-B move must
preserve declaration order exactly or convert the reference to a lazy getter in the same edit.

### 5.4 `agent-rail.tsx` — extract the duplicated plumbing (711 → ~220)

`agent-rail.tsx` and `repository-rail.tsx` share **~180 near-verbatim lines each**: the
favicon-scan effect, the repository-rescan effect, the logo-drop effect (only the row selector
differs), `openPopover`, the tab-options chord effect, `pickLogoFor`, `popoverTab`/
`resolvePopoverIndex`, the `<TabPopover>` block, and the trailing footer + `<SidebarBanner>`.

Extract `src/ui/rail/use-workspace-logo-drop.ts`, `use-rail-scans.ts`, `use-tab-popover.ts`,
`rail-tab-popover.tsx`, `tab-item.tsx` (100–359) and `archived-row.tsx` (361–402) — **wiring
`agent-rail.tsx` only.**

Two cautions: `asr-*` class names are frozen 1:1 to the gallery specimen and asserted by
literal string in `agent-rail.test.tsx:605-640` (moving JSX between files is safe, renaming a
class is not); and `repository-rail.tsx` stays untouched — once the agent rail passes its
native review and the parked file is deleted, this duplication disappears for free, so
**waiting may be cheaper than deduplicating.**

### 5.5 File-surface pair — two modest cuts only

`file-surface-controller.ts` (680) and `file-surface-store.ts` (538) are already well factored
and both delegate to pure siblings. Only two cuts are worth it:
`src/files/tree-refresh.ts` (constant 57–68, maps 139–142, coalescer 299–355, `parentDirectory`
70–76; ~70 lines) and `src/files/file-status.ts` (store 475–527; ~55 lines — check
`relativeToWorkspace`'s other callers first). Leave the rest: the store's premise is that this
state lives in one place, and the controller's header says it is deliberately the only module
that knows both halves.

## 6. Phase 2 — test files

`tab-manager.test.ts` is 4749 lines. Splitting tests is explicitly **not** a fork, and it is
the cheapest maintenance win available. Split along the manager's own surfaces, one file per
concern (`tab-manager.dispatch.test.ts`, `.attention.test.ts`, `.close.test.ts`,
`.materialize.test.ts`, `.strip.test.ts`, …) with the shared harness lifted into a
`tab-manager.fixtures.ts`. Twelve further test files sit at 500–731 lines; they are within a
tolerable band and only worth touching if their subject file is being split anyway.

## 7. Forks the owner must resolve before any code is written

AGENTS.md requires stopping before writing code that touches PTY ownership, window
coordination, tab materialization, layout or close/quit coordination. That covers most of
`tab-manager.ts`, all of `terminal-manager.ts`, `app.tsx`'s boot and quit-guard effects, and
`electron/main.ts`'s window/quit/transfer regions.

1. **How far do we go?** Phase 0 + phase 2 alone (safe, ~1200 lines redistributed, no R4 seam
   touched) — or phase 0 + 1 + 2, which includes the stylesheet and the Electron registrars?
2. **Anything R4 at all?** Two active plans freeze specific regions:
   `docs/plans/2026-08-16-session-history.md:58` freezes `TabManager.materialize` and the
   overlay-rank model outright; `docs/plans/2026-08-15-session-restore.md:17` names
   `tab-manager.ts`, `agent-launch.ts` and the quit flow. Recommendation: **no R4 seam moves
   in this effort at all.**
3. **Who runs verification, and when?** A pure-move refactor's only safety net is the suite.
   Per split, or once at the end? The commands that matter: `npm test`, `npm run build`,
   `npm run electron:build`, `npm run generate:menu:check`, plus `npm run dev` + gallery for
   the stylesheet step.
4. **Where does the work happen?** The tree carries 211 dirty files and other sessions write
   to the same checkout. Options: checkpoint-commit first and work on `main`, or authorize a
   branch + worktree.

## 8. Noted, not done (out of this task's scope)

- The repo has **no ESLint, no Prettier, no knip/ts-prune** — only `tsc` and `vitest`. There is
  no automated guard that would have caught these files growing past 800 lines, and nothing
  will stop the next one. A line-count guard test in `scripts/` would be cheap; it is a
  separate decision.
- `src/gallery/agent-status-rail.tsx` (603) still draws the pre-cluster rail shape, so the
  approved specimen no longer matches the shipped rail. Already recorded in AGENTS.md as owed;
  restated here because §5.4 touches the same component family.
