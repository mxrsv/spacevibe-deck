# Redesign phases 2–5 — the full transfusion

Date: 2026-08-13 · Status: **executing** — see §0 for where it stopped on 2026-08-14

**Execution authority:** superseded on 2026-08-14. The owner approved **all twelve** D1–D12
recommendations as written, authorized implementation on `main` (no branch, no worktree),
authorized the §6.0 pushes, and then instructed that the program run to completion **without
stopping for per-fork approval or per-step screenshot review**. A resolved fork is now
recorded in §0.3 and reported, not queued. The paragraph this replaces required the opposite,
and it is kept in the diff rather than deleted so the change of instruction is legible. The
[token-rebuild spec](../specs/2026-08-13-direction-token-rebuild-design.md) `decided` was
amended by its own §9 under that authority.

**Scope:** phases 2–5 of the [program handoff](./2026-08-13-redesign-program-handoff.md)
`current` — chrome redesign, feature toolbar, file explorer surface, usage dashboard port +
browser productization. **Out of scope:** the release cutover (Gates A/C), new Tauri product
behaviour, and any Windows platform claim without hardware evidence. The renderer and
`styles.css` are shared by Electron and Tauri, so phase 2 is a cross-host visual change unless
D9 chooses real host isolation; it may not be described or verified as Electron-only.

Owner decisions already closed in the handoff §4 are not reopened here — notably: the ramp
ships rebuilt from `--bg`/`--tone`, never fixed hex; `deriveChromeColors` keeps its contrast
floors; chrome keeps following the terminal theme.

## 0. Handoff — state at 2026-08-14, mid-phase-2

Written to stop a session and resume elsewhere. Everything below is on **`main`, local
only**: `origin/main` is still `3093074`, so a cloud continuation must either push these first
or start from a checkout that has them.

### 0.1 Landed, in order

| commit    | what                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------- |
| `3f9c928` | `/var` symlink fixture fix — §5.0.1, pulled forward because it gated `npm test` for the whole tree |
| `1fae8a6` | gallery drift: the tenth alias published, reduced motion by scope                                  |
| `f3cc0e3` | **docs** — direction spec §9 (shipping addendum) + DL §20 and §21, owner-approved before commit    |
| `d821bcc` | phase 2 step 1 — token layer                                                                       |
| `03f6d06` | phase 2 step 2 — shell restructure                                                                 |
| `9607bf0` | phase 2 step 3 — navigation                                                                        |
| `5d15861` | rail 275px, fixing a drag regression step 2 introduced                                             |
| `4014867` | phase 2 steps 4–8 — atoms, settings shell, board, popovers, imperative surfaces                    |

Also done: `feat/token-usage-dashboard` (`bf6e1dd`) and `feat/workspace-reorder` (`0972508`)
are pushed to origin, closing the §6.0 durability risk for committed work. The usage branch's
**dirty tree and its two untracked doc files are still local only** — landing them is still
owed and still needs its own content approval.

### 0.2 Known defect in this history — decide before pushing

`d821bcc` is a `feat` commit that also contains **269 lines of `docs/plans/2026-08-13-redesign-phases-2-5.md`**,
swept in by a `git add -A`. That is a D14 breach (a doc committed without its own content
approval) and a W5 breach (one commit, two things). It was disclosed, not discovered. Nothing
is pushed, so `git reset --soft 3093074` and a clean re-split is still available; the owner has
not chosen. Do not use `git add -A` in this repo.

### 0.3 Forks resolved during execution, beyond D1–D12

1. **The shell's shape, not just its colour** (blocking step 2). The reviewed direction moves
   `.deck-frame` into the navigation column and runs the stage from the top of the window,
   which contradicted DL-18.1 and DL-18.3. Put to the owner and **approved**: take the
   direction's shape. DL-18.1/18.2/18.3 rewritten; `--frame-h` stays 34px per D2.
2. **Stage row span.** The direction sheet spans the stage `1 / 4` and lets the status bar
   paint over the overlap. Implemented as `1 / 3` — same picture, without two elements
   claiming one grid cell.
3. **`--sidebar-w` 200px → 275px.** Not cosmetic: the frame's move took the window's drag
   affordance with it, leaving ~56px of non-button titlebar. Found by the native macOS run,
   invisible to any browser render.
4. **`--state-hover-bg` added to `deriveChromeColors`.** DL-21.2 needs one hover value across
   every genre. It follows `seamDivider`'s existing pattern exactly and touches neither the
   ramp nor the contrast floors, so it is inside the handoff's "`deriveChromeColors` does not
   change" in intent — but it IS an edit to that file, recorded here rather than left implicit.
5. **`--radius-control` for every non-shape radius.** DL-20.1 allows two roles; 53 literals
   between 3px and 12px collapsed onto the control role, with floating surfaces explicitly on
   `--radius-surface`. Small chips and scrollbar thumbs therefore got rounder. Reviewed in a
   browser render only — this is the most likely thing an eye review will want changed.
6. **Reduced-motion scope cites `DL §9` by section**, not the dotted form the earlier plan text
   used: §9's checklist items are not numbered rules, and `scripts/design-language.test.ts`
   rejects the dotted spelling — including inside a comment.

### 0.4 What phase 2 still owes

- **Step 9 — browser panel.** Restyle its chrome, then verify by hand that the
  `WebContentsView` hole still aligns pixel-exact; its measured rect positions a native view
  and padding changes misalign it silently.
- **Step 10 — orphans.** `src/files/ui/` takes the token changes so it does not restyle-rot
  before phase 4 mounts it.
- **§3.4 marketing mirrors.** `marketing/stage/appwin.js`, `direction-a.css` and `video.css`
  import nothing from `src/` and still render the pre-redesign chrome with **no failing test**.
  Also fix the mirror comment citing the renamed `status-mark.tsx`, and manually review
  `npm run video:render`.
- **`electron/main.ts` L163's `#101014` pre-paint** and `src-tauri`'s `#16161e` must follow the
  ground, per the addendum's §9.1. Decision-free, one line each, not yet done.
- **Phase-end evidence (§3.3), none of which exists yet:** the `css-audit` re-read with the
  owner, the Electron native pass over steps 4–8, and the **same pass under `npm run tauri dev`**.
  Tauri has had no run at all this program; `styles.css` is shared, so that is a real gap and
  not a formality.

### 0.5 Evidence actually obtained, and its limits

`npm test` 160 files / 1975 tests, `npm run build`, `npm run generate:menu:check`,
`npm run electron:build`, `docs-anchors.sh` — all green at `4014867`. `docs-compliance.sh`
reports 8 failures, all pre-existing in `AGENTS.md` and `docs/ARCHITECTURE.md`, none touched
by this work.

Native macOS Electron screenshots exist for **steps 1–3 only**. Measured there: frame
275×34 at the origin, rail beneath it, stage 1080×772 from `y=0`, status full width, no
overlap; `--state-hover-bg` = `rgba(255,255,255,0.06)` against `--tab-active-bg` =
`rgb(57,57,64)`, published by `applyThemeVars` rather than falling back to `:root`. The state
matrix was read across four themes and five states.

Not obtained: any Tauri run, any Windows evidence, any native look at steps 4–8, any render of
top-tab mode (step 3 changed `.tab`, which only appears there), and any render of a **populated
rail** — every screenshot so far has zero workspaces, so hover-vs-selected on `.wsitem` has
been proven by computed value, not by eye.

### 0.6 Resuming

Read this section, then §3.1 step 9 onward. The decision queue is closed — D1–D12 are approved
as written, and the standing instruction is to resolve new forks against the plan's own
recommendations and record them in §0.3 rather than stopping. Gates per change stay as §7
states them.

## 1. Corrections to the handoff

The handoff is a frozen milestone doc; it stays as written. The program proceeds from these
corrected facts instead:

- **The matrix is un-parked.** `edf660f` returned it to the
  [registry](../../src/gallery/section-registry.ts#L33) `current`. No "un-park" task exists.
- **Handoff §3.1 is fixed on this branch only.** The
  [postinstall exec-bit fix](../../scripts/fix-spawn-helper-permissions.mjs) `current` is on
  `redesign/phase-1-2`; `main` still needs the manual `chmod +x` until PR #16 merges.
- **Handoff §3.2's risk has concentrated, not vanished.** `main` and
  `parked/settings-fullbleed` are pushed. Two branches are absent from origin:
  `feat/token-usage-dashboard` (also dirty, also holding untracked spec/plan docs) and
  `feat/workspace-reorder`. See §7.0.
- **Handoff §3.3 understates itself.** `scripts/ipc-contract.test.ts` is not "red" — it is
  `--exclude`d from [`npm test`](../../package.json#L23) `current`. The only cross-boundary
  IPC gate is switched off, which is worse than failing.
- **Handoff §3.6's fix names identifiers that do not exist.** The real seam is
  [`agentProcessMatchers`](../../src/lib/agent-catalog.ts#L108) `current` with
  `BUILTIN_AGENTS` / `isBuiltinAgentId`; there is no `AGENT_BY_BINARY`.
- **Handoff §3.7a is already resolved** — AGENTS.md now says both hosts belong in this
  checkout.
- **`docs/CONTEXT.md:798` cites "§17 Docked side panels"; that section is §19.** Exactly the
  stale-citation class §3.5 warns about, in a file the citation gate never scans.

## 2. Owner decision queue — CLOSED 2026-08-14

AGENTS.md makes every DL-rule change a stop-and-ask fork. This program hits several at once,
so they were queued here, each with a recommendation. **All twelve were approved as written on
2026-08-14**, so this table is now the record of what was decided rather than a list of
blockers. Forks found after that date are in §0.3.

| #   | Decision                                                                                                                                                                                                                                                                             | Needed before                                       | Recommendation                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Selection state: full rounded wash vs DL-5.1/11.2's 2px accent bar.** The direction uses the wash (`--tab-active-bg`); the rulebook mandates the bar. The spec calls this "a real conflict, not a gap".                                                                            | phase 2 navigation restyle                          | Take the §21 fork: fill the reserved §21 stub with the wash as the app-wide selection rule, rewriting DL-5.1/DL-11.2 to match. The wash is what the owner approved in the gallery.                                                                                                                                        |
| D2  | **§20 numerics.** Direction: radius 10/16px, 150ms, 13px labels, `--frame-h: 54px`. Rulebook: one `--radius: 10px`, §7's 0.13s, DL-4.4's 10.5–12.5px scale, DL-18.2's 34px frame.                                                                                                    | phase 2 token layer                                 | Fill §20 with the direction's radii and 150ms; keep DL-4.4's type scale (13px labels were a gallery convenience, not a reviewed decision); **keep `--frame-h: 34px`** — 54px moves the macOS traffic-light centering that `hiddenInset` + `--frame-lights-w` are tuned for, and was never eye-reviewed at native density. |
| D3  | **How the direction enters the app.** The spec's scope line forbids it ("Nothing here enters `src/styles.css` or the app bundle"); no document defines the shipping path.                                                                                                            | phase 2, step 0                                     | Author a short shipping addendum to the direction spec (§3.0) and have it approved before code. Migrate _relationships and role assignments_ into `src/styles.css`; the alias layer (`--gx-chat-*`) stays gallery-only.                                                                                                   |
| D4  | **The DL-15 citation trap.** The explorer [spec](../specs/2026-08-12-file-explorer-design.md) `decided` and [plan](./2026-08-12-file-explorer.md) `current` cite `DL-15.*`, which will silently resolve to the usage branch's §15 "Read-only data tables" the moment phase 5 merges. | before phase 5's merge; naturally in phase 4 step 0 | Approve rewriting those citations to §19 as phase 4's first task, with a note that the rewrite is itself the fix the handoff deferred.                                                                                                                                                                                    |
| D5  | **Two dependency approvals** the explorer plan left open: a virtual-list library and an icon package.                                                                                                                                                                                | phase 4                                             | Neither. Fixed 22px rows make windowing arithmetic (~10 lines); `lucide-preact` is already bundled and monochrome at `--text-faint` satisfies DL-3.                                                                                                                                                                       |
| D6  | **Toolbar copy case + disabled loudness.** Tooltip labels come from `ACTION_REGISTRY` (Title Case menu labels) while chrome copy is sentence case; disabled (`--text-faint`) reads nearly identical to enabled in the dark themes.                                                   | phase 3                                             | Sentence-case the tooltip strings at the toolbar layer (registry keeps menu labels); leave the disabled token shared and accept the quiet reading — changing it moves every disabled control in the app.                                                                                                                  |
| D7  | **Phase 3 sequencing.** The toolbar's `tools` group is `toggle-explorer` / `toggle-browser` / `toggle-usage`, but explorer and usage surfaces arrive in phases 4–5.                                                                                                                  | phase 3 start                                       | Ship phase 3 right after phase 2 with `toggle-browser` as the only `tools` item; phases 4 and 5 each add their own toolbar item as part of their surface work. The alternative (toolbar last) leaves `ChromeActions` to be restyled in phase 2 and thrown away in phase 5.                                                |
| D8  | **The ipc-contract gate (R6).** The test assumes a single host and is excluded from `npm test`; every `usage_*` channel phase 5 adds widens the uncovered surface.                                                                                                                   | before phase 5 host work                            | Rewrite the gate Electron-first: keep the flat-payload shape checks, drop the requirement that every channel have a `#[tauri::command]` twin, and re-include it in `npm test`. This is the R6 decision the handoff deferred.                                                                                              |
| D9  | **Shared renderer scope.** Phase 2 changes `src/styles.css`, which both Electron and shipping Tauri load.                                                                                                                                                                            | phase 2 step 0                                      | Approve visual-only cross-host impact: no new Tauri behaviour, but both hosts receive the shared renderer restyle and both get regression evidence. If this is rejected, first design and approve a real host-scoping seam; do not hide divergence behind CSS assumptions.                                                |
| D10 | **Gate-M-only Electron packaging.** A packaged Monaco proof needs `electron-builder` config, but bundle/signing/release configuration is a stop-and-ask fork.                                                                                                                        | phase 4 packaging task                              | Approve an unsigned, local-only `electron-builder.gate-m.yml` and `electron:package:gate-m` command. It produces no installer, updater metadata, signing, notarization, publishing, release workflow, channel, or cutover change.                                                                                         |
| D11 | **Explorer contract conflict.** The explorer spec says a right column of `.window` on `Cmd/Ctrl+Shift+B`; the toolbar spec says a main-stage tool on `Cmd/Ctrl+Shift+E`; governing DL-19.1 says docked panels are stage columns.                                                     | phase 4 permanent surface                           | Use a stage column to satisfy DL-19.1 and keep the explorer spec's collision-free `B` chord. Amend both feature specs before implementation: the toolbar action focuses/toggles the dock and does not pretend Explorer is a main surface.                                                                                 |
| D12 | **Browser surface contract.** The toolbar spec says Browser is a main tab/pane; the current implementation is a docked `WebContentsView`.                                                                                                                                            | phase 3 Browser item                                | Keep Browser docked for this program and amend the toolbar spec before exposing its item. A main-surface conversion changes native-view ownership and needs its own spec/plan; it is not implied by “productization.”                                                                                                     |

## 3. Phase 2 — the chrome transfusion

The direction is proven in the gallery across four dark themes and five states; nothing
defines how it reaches the app. Phase 2 is that definition plus its execution.

### 3.0 Step 0 — the shipping addendum (blocked on D1–D3 and D9)

One or two pages amending the direction spec: which roles map to which `styles.css` regions,
what happens to the `--gx-chat-*` alias layer (stays gallery-only), and the §20/§21 outcomes
from D1/D2 written as DL rules. Reviewed and approved before any CSS moves. This closes the
gap where the spec's own non-goal was "shipping the direction into the app".

Also in step 0, three small recorded drifts from the rebuild land as one commit: the
`tokens-section` contract surface lists nine aliases but the CSS declares ten
(`--gx-chat-seam` missing), the CSS header still says "nine aliases", and the direction's
reduced-motion block is a class allowlist where DL §9.3 requires scope.

### 3.1 Order of work

Token layer first, then surfaces from highest blast radius to lowest. Each numbered step is
one reviewable commit (or a small series), gated by the matrix and by an eye review before
the next starts.

1. **Token layer** — `:root` in `styles.css` + `derive-colors.ts` + `theme-vars.ts` moved as
   one unit; the `:root` `color-mix()` fallbacks must stay a mirror of the JS math. New §20
   variables (radii, motion) land here. `deriveChromeColors` itself does not change.
2. **Frame + shell** — `.window`, `.deck-frame`, `--frame-h` / `--frame-lights-w`. Verify
   drag regions and traffic-light alignment by hand on macOS; name Windows as unverified.
3. **Navigation** — repository rail → tab bar → status bar. D1's selection rule applies
   here first. `WorkspaceSidebar` is dormant but contract-kept: restyle it along with the
   rail (it shares `.wsbar`/`.wsitem` classes) rather than retiring it in this phase.
4. **Atoms** — `.iconbtn`, `DeckIcon` sizes, the `.cfg-*` config-row family, separators.
   Highest blast radius; every later surface consumes these.
5. **Settings shell** — rail, screen, ten sections. Clears the two DL §10 `--hair-strong` →
   `--seam-raised` debts.
6. **Open board** — the largest single item (~730 CSS lines, 878-line component). Clears the
   DL-2.3 `--hair` debt. This is the surface the owner sees at every launch — the screenshot
   review here is the program's midpoint checkpoint.
7. **Popovers and dialogs** — tab popover (clears the DL-4.3 uppercase debt), prompt popover,
   preset editor, save dialog, persist-error bar.
8. **Imperative surfaces** — pane bar/anchor, split dividers, search bar (clears the DL-1.3
   blurred box-shadow debt), drag ghost/overlay, zoom overlay, file-drop target. These are
   built in `pane.ts` / `layout-engine.ts` / `search-bar.ts`, not JSX — they do not appear
   in a component sweep.
9. **Browser panel** — restyle the chrome; then verify by hand that the
   [`WebContentsView` hole](../../src/browser/browser-panel.tsx) `current` still aligns
   pixel-exact (its measured rect positions a native view; padding/border changes misalign it
   silently).
10. **Orphans** — `src/files/ui/` (file editor, external-change bar) get the token changes
    only, so they do not restyle-rot before phase 4 mounts them.

### 3.2 Standing constraints

- **Host background mismatch.** Every Electron window paints
  [`#101014`](../../electron/main.ts#L163) `current` before first render; Tauri's config says
  `#16161e`. Whatever ground the redesign lands on, both values follow it in the same change,
  or window-open and resize flash the wrong color.
- **Light themes are unverified.** All four presets are dark; a light `--bg` is reachable
  through user color overrides and inverts the text-on-`--bg` case. The floors cap at `tone`
  when unreachable — state this as a known limit, do not silently claim light support.
- **`force-states.ts` cannot parse `:is()` / `:where()` / `:not(a, b)`.** The restyle must
  not introduce them into `styles.css`, or the matrix's forced states break silently.
- **~30 test files query by class name** (`.tab-popover`, `.wsitem*`, `.cfg-*`, `.lucide-*`
  …). Renames are loud but real work; prefer keeping class names and changing their rules.
- **The z-index ladder is behavioral.** Settings-under-scrim depends on 40 > 35
  (`app.tsx:174-197`); reordering layers is a logic change, not a visual one.
- **The xterm boundary stays the user's.** `--gx-chat-pane-surface` maps to `--bg` on
  purpose; no chrome color enters the terminal canvas, and no `--mono` token is added.
- **DL §10 debts are owned here.** The four ledger rows (uppercase label, `--hair`
  boundaries, `--hair-strong` frames, search-bar shadow) are cleared by their steps above,
  and each fix updates the §10 table in the same commit (R2).

### 3.3 Verification

Per step: `npm test && npm run build && npm run generate:menu:check`, the state matrix read
across 4 themes × 5 states, and a screenshot the owner approves (DL §9.6 — a green build is
not an eye review). At phase end: re-read the gallery `css-audit` numbers with the owner, run
the Electron native screenshot pass, then run the same visual and interaction regression pass
under `npm run tauri dev`. Evidence names the two hosts separately. Neither host proves
Windows, and shared-renderer evidence is never labelled Electron-only.

### 3.4 Marketing mirrors — explicit final task

`marketing/` imports nothing from `src/`; the landing hero, scroll tour and video stage are
hand-copied mirrors (`marketing/stage/appwin.js`, `direction-a.css`, `video.css`) that will
keep rendering the old chrome with no failing test. One task at phase end updates them — and
fixes the mirror comment that still cites the renamed `status-mark.tsx`. Component changes
can silently alter rendered media (AGENTS.md trap), so `npm run video:render` gets a manual
review.

## 4. Phase 3 — feature toolbar shipping pass (D6, D7, D12 approved)

The gallery toolbar (`FeatureToolbar`, overflow fit, tooltips) is built; shipping it means:

1. **Freeze the Browser contract first.** Write and approve
   `docs/specs/2026-08-13-browser-productization-design.md`, resolving D12 before the toolbar
   exposes the action. D14 applies: review the spec before any commit. If the decision is main
   surface, STOP and replace the dock implementation plan before continuing; the existing dock
   cannot be labelled a main tab/pane.
2. Project the existing `toggle-browser` action into the `tools` group now;
   `toggle-explorer` / `toggle-usage` arrive with phases 4/5 (per D7). New actions use
   `CharKeyBinding`, get `PLACEMENT` rows in `shortcut-groups.ts`, and the menu is regenerated
   (`npm run generate:menu`, R3).
3. Rebind the Windows `toggle-expand` chord only if the approved D11 outcome gives Explorer
   `Ctrl+Shift+E`; keeping the explorer spec's `B` chord leaves `toggle-expand` unchanged.
4. Replace `ChromeActions` with `FeatureToolbar` at both mounts (`.deck-frame` slot in
   sidebar mode, inside `TabBar` in top-tab mode) — one commit, both layouts, or it
   half-lands.
5. Write the missing DL rule for tooltips and the overflow surface — take the next free
   number above §22.
6. Close or explicitly accept the three recorded gaps: overflow menu has no arrow-key roving
   focus; the update pill only re-fits on toolbar resize; tooltip/menu are `position: fixed`
   off a measured rect.

Gates: `generate:menu:check`, the shortcut-groups test, screenshot approval in both layouts.

## 5. Phase 4 — file explorer surface (D4, D5, D10, D11 approved)

The model (`src/files/`, 9 modules), the host (`electron/fs/`, six channels), all four
dirty-exit guards, and the `SurfaceStrip` seam in `tab-manager.ts` are merged and tested.
The surface was deliberately dropped; this phase rebuilds it. Cite **DL §19** for the panel —
never DL-15 (D4).

### 5.0 Prerequisites and Gate M, in order

1. **Fix the `/var` symlink test** (`electron/fs/read.test.ts:48` — compare realpaths). It is
   owned by explorer work and currently blocks any "tree passes `npm test`" claim for the
   whole program, so it lands first, as its own commit.
2. **Create a proof-only packaging path after D10.** Add
   `electron-builder.gate-m.yml`, referenced by `package.json`'s
   `electron:package:gate-m` script:

   ```text
   npm run build && npm run build:gate-m-renderer && npm run electron:build &&
   electron-builder --config electron-builder.gate-m.yml --mac --universal --dir --publish never
   ```

   The config sets `productName: Deck Gate M`, output `dist-gate-m`, and
   `extraMetadata.main: dist-electron/electron/main.cjs` (Electron Builder packages this into
   the app's `package.json`; `main` is not a top-level builder option). Its `files` list
   includes `dist/**`, `dist-gate-m-renderer/**`, every
   `dist-electron/electron/**/*.cjs`, every `dist-electron/src/**/*.cjs`, and
   `dist-electron/electron/vendor/**`; electron-builder still supplies production
   dependencies. It unpacks `node-pty`, sets the universal-build `x64ArchFiles` pattern for
   its prebuilds, and preserves executable `spawn-helper` modes.
   Add `scripts/verify-electron-gate-m-package.mjs` plus its adjacent test; the verifier fails
   unless the app contains both renderer graphs, the complete compiled host graph, react-grab,
   both native architectures, unpacked `node-pty`, executable helpers, and a packaged
   `package.json` whose `main` equals that exact CJS path. It then launches the packaged entry
   in gate mode and requires an explicit renderer-ready signal before passing. This config
   never produces an installer or update metadata and is not referenced by release workflows.

3. **Build a durable non-Explorer Gate M harness.** Add `gate-m.html`,
   `src/files/gate-m-main.tsx` and `vite.gate-m.config.mjs`; the dedicated Vite config writes
   only this graph to `dist-gate-m-renderer/`. The harness mounts the existing `FileEditor`
   against a one-file `createFileSurfaceController()` supplied by the real file host, plus an
   explicit Save button wired to `controller.savePath()`. Beside it, create one real xterm with
   `createTerminalManager`, `defaultPtyClient` and `initFresh()`; route the real output/exit
   listeners into that manager and dispose/unlisten on teardown. Named focus controls move to
   Monaco and xterm so the packaged verifier can type into both and assert which surface
   received each marker. A `DECK_GATE_M=1` branch in `electron/main.ts` loads that page and a
   fixture path instead of the application renderer. `scripts/gate-m-entry.test.ts` proves
   `gate-m-main.tsx` is absent from the normal `index.html` graph and normal builds never select
   the gate page. These are permanent verification artifacts referenced by the package script,
   not a product route or temporary repo file. No `explorer-panel.tsx`, tree, tab/rail mount or
   Explorer action is written before Gate M, preserving the approved spec's ordering.
4. **Run Gate M against the packaged artifact.** Execute
   `npm run electron:package:gate-m`, then `npm run electron:verify:gate-m`. The second script
   creates a disposable fixture outside the repo and launches the packaged executable with
   `DECK_GATE_M=1` / `DECK_GATE_M_FILE=<fixture>`; the verifier owns cleanup. Paste six
   individual results: file opens, syntax highlighting proves its worker loaded, edit marks
   dirty, save reaches disk, DevTools has no `file://` worker/asset 404, and focus moves between
   Monaco and xterm without keyboard capture. A failure reopens the editor-engine decision
   (spec §9); it never degrades to dev-only. Adding CSP later invalidates this evidence and
   requires a rerun.

### 5.1 Build list

After Gate M passes, finish the permanent surface in reviewable units:

1. **Minimum product slice:** add `explorer-panel.tsx`, `file-tree-view.tsx`,
   `file-tab-views.ts`, the `createFileSurfaceController()` mount in `app.tsx`, one file-open
   path and both layout mounts. Focused tests prove selecting a file creates the preview
   surface and supplies its editor document.
2. **Panel contract:** finish the stage-column panel using D11's approved `B` chord; add
   `explorerOpen` / `explorerWidth` settings with merge coverage and panel CSS in the
   restyled token language.
3. **Tree scale:** add 22px arithmetic windowing to `file-tree-view.tsx` and monochrome
   lucide mapping in `file-icons.ts`; tests cover empty, loading, deep, 10k-row and keyboard
   focus states.
4. **Chrome integration:** complete `file-tab-views.ts`, the `status-bar.tsx` file branch and
   both layout mounts. `app.tsx` passes the controller as `TabManagerDeps.surfaces`, turning
   the latent tab-close dirty guard live.
5. **Actions:** add `toggle-explorer` and `save-file`, then menu generation and `PLACEMENT`
   rows. Verify D11's chord and save against user-configurable bindings; bare `Ctrl+S` on
   Windows remains PTY-reserved until an explicit binding decision says otherwise.

### 5.2 Defect burn-down on mount

Treat each awakened boundary as a separate task with its own focused test:

1. **Action/focus boundary:** fix pane-scoped shortcuts once at `overlayBlocksAction`; Monaco
   focuses a `<div>`, so `isChromeTextField` is insufficient. Tests prove terminal actions do
   not fire while a file surface owns focus and that attention-rail / terminal-tab focus calls
   `surfaces.deactivate()` before returning to xterm.
2. **Document lifecycle:** tests cover preview replacement disposing the prior document,
   workspace close removing its file tabs, dirty registry cleanup, and a failed close leaving
   the document and dirty path intact.
3. **Watch authorization and bounds:** use `electron/fs/path-guard.ts` for every `stat_files`
   and `watch_paths` input before filesystem access. Put named limits beside this feature —
   `MAX_STAT_PATHS = 512`, `MAX_WATCH_DIRECTORIES = 256`,
   `MAX_WATCH_FILES = 2048` — and reject the first item over each limit with a structured IPC
   error. Tests cover outside-root paths, symlinks escaping root, malformed payloads, cap + 1,
   duplicate paths, and watcher teardown on workspace/window close.
4. **Filesystem responsiveness:** replace per-entry `realpathSync` with bounded async work
   (`MAX_REALPATH_CONCURRENCY = 32`). A 10k-entry fixture must keep the Electron event loop
   responsive (no sampled stall above 100 ms on the verification Mac) while producing the
   same sorted result. If the threshold cannot hold, stop and redesign rather than moving the
   work into an unbounded `Promise.all`.
5. **Live invalidation:** consume `fs:changed` in the controller, coalesce bursts per
   workspace, refresh only affected branches, and prove events after controller disposal are
   ignored.

### 5.3 Verification

Gate M evidence is packaged and pasted. Run the explorer spec's manual pass and explicitly
prove **all four exits**: tab close, window close, app quit and Install & Relaunch. For each,
run dirty-only and busy+dirty cases; one combined dialog names both causes, Cancel preserves
the buffer, and confirm proceeds only after settings flush. Focused tests cover
`update-controller`, `App.confirmInstall`, the dirty registry and the `app_relaunch` path.
Bundle re-measure against the recorded numbers (entry +10.92 kB gzip, lazy `editor.api`
674.50 kB — "far outside expectation is a re-decision, not a footnote").

## 6. Phase 5 — usage dashboard port + browser productization

### 6.0 Durability first — separate remote-mutation authorization required

`feat/token-usage-dashboard` is unpushed, dirty (AGENTS.md, CONTEXT.md), and holds its only
spec and plan as **untracked files**. `feat/workspace-reorder` is also origin-absent. Push
both; land the usage branch's dirty tree per the
[trunk-merge plan §D3](./2026-08-12-redesign-trunk-merge.md) `current`. This costs minutes
and removes the single most fragile artifact in the program, but plan approval does not grant
that authority. Before either action, show the exact branch/ref and file set, obtain an
explicit push/land instruction, and stage docs only after their separate D14 content approval.

### 6.1 The usage dashboard is a port, not a merge

The branch's merge base predates the Electron migration by 59 `main` commits; its backend is
~3,700 lines of Rust (`src-tauri/src/usage/`) with **no Electron counterpart**. This port is a
subprogram, not one implementation bullet. It runs after D8 and in this order:

1. **Freeze the contract and fixtures.** Land the branch's approved docs and renderer work
   over current `main`: `src/lib/usage-*`, `src/usage/`, `src/ui/usage/`, chrome/action wiring
   and DL §15/§16, after D4 has removed the citation trap. Keep `UsageSnapshot` and its six
   counter classes in `src/lib/usage-snapshot.ts` as the single shared serialized contract.
   Copy representative Claude/Codex JSONL cases into `electron/usage/fixtures/` with content
   redacted but ids/timestamps/counters preserved; check in Rust-produced golden snapshots so
   every Node parser test has an independent expected result.
2. **Bounded reader and discovery:** port `reader.rs` / `discover.rs` to
   `electron/usage/reader.ts` and `electron/usage/discover.ts`. Adjacent tests cover missing
   roots, unreadable files, symlink loops, depth and line/identity-byte caps, malformed UTF-8,
   oversized/partial final lines and deterministic path ordering. File discovery never reads
   conversation bodies beyond the bounded parser input.
3. **Agent parsers:** port `claude.rs` and `codex.rs` to
   `electron/usage/claude.ts` / `electron/usage/codex.ts`. Golden-fixture tests prove Claude
   contribution-map last-wins dedupe, Codex cumulative-to-delta conversion and model backfill,
   15-minute UTC buckets, saturating counters, unknown-model preservation and all malformed
   lines counted in-band rather than thrown.
4. **Cache:** port `cache.rs` to `electron/usage/cache.ts`, stored under Electron's app data
   as `usage-cache.json`, versioned independently from the Rust cache because cutover is a
   clean install. Tests cover atomic temp-file rename, corrupt/version-mismatched cache,
   resume offsets, replacement/truncation/deletion, 48-hour compaction, unchanged polls doing
   zero JSONL reads and failed writes leaving the previous cache valid. Cache records may hold
   paths, ids, timestamps, models and counters only — never prompts or responses.
5. **Scanner orchestration:** port `scan.rs` / `mod.rs` to
   `electron/usage/scan.ts` and `electron/usage/service.ts`. One in-flight promise serializes
   scans; filesystem work stays off the renderer and yields between bounded batches so PTY and
   window IPC remain responsive. Tests cover concurrent callers, partial source failure,
   permission loss, cache recovery and cold/warm result stability.
6. **IPC and client:** add `usageSnapshot` to `electron/ipc/channels.ts`, a thin handler in
   `electron/main.ts`, add `src/host/usage-host.ts` on the existing bridge, and switch
   `src/usage/usage-client.ts` to that facade rather than a direct Tauri import.
   `scripts/electron-ipc-contract.test.ts` gets an explicit zero-payload fixture for
   `usage_snapshot`; handler failures expose a user-safe message while detailed path/error
   context stays in main-process logs.
7. **Parity gate:** run focused Vitest for all six modules, the Electron IPC contract and the
   retained Rust usage tests against the same golden fixtures. Node output must deep-equal the
   Rust-produced snapshot for every fixture before the real corpus is touched.
8. **Real-corpus acceptance:** fingerprint the corpus by source/file counts without recording
   content, compare totals to an independent sample oracle, record cold/warm duration and peak
   RSS, prove unchanged polling reads zero JSONL bytes, and exercise missing/unreadable/stale
   sources. The dashboard must remain interactive during the scan. Paste every acceptance row;
   Windows remains unverified.

### 6.2 Browser productization

The Browser productization spec was authored and approved before phase 3 because D12 controls
what the toolbar opens. Phase 5 implements that approved contract: restore the loaded page
across relaunch (today only the home URL persists), run the real-compositor manual pass
CONTEXT.md lists as never done (resize, drag-to-width, hide-under-overlay), check an Inspect
payload against a real dev server, and label the native view Electron-only. Tabs, history and
bookmarks remain out unless the approved spec explicitly adds them.

## 7. Program sequencing and gates

```
            ┌─ phase 3 (Browser spec → toolbar; toolbar grows in 4 and 5)
phase 2 ────┼─ phase 4 (/var fix → proof package + harness → Gate M → minimal surface → finish)
            └─ phase 5 (usage port + approved Browser productization)

6.0 durability is independent and runs only after explicit remote-mutation authorization.
```

- Minimum gate per change: `npm test && npm run build && npm run generate:menu:check`;
  `electron/` changes add `electron:build`; IPC-touching changes run the contract test
  explicitly until D8 re-includes it.
- Rendered UI changes require screenshot/recording approval — native evidence, per platform,
  named honestly (macOS verified, Windows unverified until Gate C hardware exists).
- Phases end by updating `docs/CONTEXT.md` (D9) and moving their resolved forks from
  AGENTS.md's queue into `docs/ARCHITECTURE.md`.

## Chưa khớp thực tế

| Claim                                  | Intent     | Status       | Evidence                                                                                   |
| -------------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------ |
| The tree passes `npm test`             | `current`  | holds        | fixed at `3f9c928`; 160 files / 1975 tests green at `4014867`                               |
| Phase 2 is verified on both hosts      | `current`  | contradicted | native macOS covers steps 1-3 only; steps 4-8 and every Tauri run are unobserved — §0.5   |
| The direction holds on any theme       | `building` | unverified   | four dark presets proven; light themes reachable via overrides, untested                   |
| The usage dashboard behaves as specced | `building` | unobserved   | the branch's acceptance table has never been run; scheduled in §6.1.3                      |
