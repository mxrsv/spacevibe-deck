# Redesign phases 2–5 — the full transfusion

Date: 2026-08-13 · Status: proposed, pending owner approval

**Baseline:** `redesign/phase-1-2` @ `edf660f` — PR #16, open, unreviewed. This plan assumes
PR #16 merges essentially as-is; if review changes the rail or the direction file, re-read §3
before starting. The [token-rebuild spec](../specs/2026-08-13-direction-token-rebuild-design.md)
`decided` itself still reads "proposed, pending owner approval"; approving this plan approves
that spec's landed state.

**Scope:** phases 2–5 of the [program handoff](./2026-08-13-redesign-program-handoff.md)
`current` — chrome redesign, feature toolbar, file explorer surface, usage dashboard port +
browser productization. **Out of scope:** the release cutover (Gates A/C), anything on Tauri
beyond hotfixes, and any Windows platform claim without hardware evidence.

Owner decisions already closed in the handoff §4 are not reopened here — notably: the ramp
ships rebuilt from `--bg`/`--tone`, never fixed hex; `deriveChromeColors` keeps its contrast
floors; chrome keeps following the terminal theme.

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

## 2. Owner decision queue

AGENTS.md makes every DL-rule change a stop-and-ask fork. This program hits several at once,
so they are queued here, each with a recommendation. **Nothing below is decided until the
owner says so**; the phase that needs a decision is blocked on it, not the whole program.

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

## 3. Phase 2 — the chrome transfusion

The direction is proven in the gallery across four dark themes and five states; nothing
defines how it reaches the app. Phase 2 is that definition plus its execution.

### 3.0 Step 0 — the shipping addendum (blocked on D3)

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
not an eye review). At phase end: re-read the gallery `css-audit` numbers with the owner, and
run one packaged-app screenshot pass on macOS for native rendering. Renderer-only changes
prove nothing about Tauri; the phase claims Electron only.

### 3.4 Marketing mirrors — explicit final task

`marketing/` imports nothing from `src/`; the landing hero, scroll tour and video stage are
hand-copied mirrors (`marketing/stage/appwin.js`, `direction-a.css`, `video.css`) that will
keep rendering the old chrome with no failing test. One task at phase end updates them — and
fixes the mirror comment that still cites the renamed `status-mark.tsx`. Component changes
can silently alter rendered media (AGENTS.md trap), so `npm run video:render` gets a manual
review.

## 4. Phase 3 — feature toolbar shipping pass (blocked on D6, D7)

The gallery toolbar (`FeatureToolbar`, overflow fit, tooltips) is built; shipping it means:

1. Register `toggle-browser` in the `tools` group now; `toggle-explorer` / `toggle-usage`
   arrive with phases 4/5 (per D7). New actions use `CharKeyBinding`, get `PLACEMENT` rows in
   `shortcut-groups.ts`, and the menu is regenerated (`npm run generate:menu`, R3).
2. Rebind the Windows `toggle-expand` chord (collides with `Ctrl+Shift+E`).
3. Replace `ChromeActions` with `FeatureToolbar` at both mounts (`.deck-frame` slot in
   sidebar mode, inside `TabBar` in top-tab mode) — one commit, both layouts, or it
   half-lands.
4. Write the missing DL rule for tooltips and the overflow surface — take the next free
   number above §22.
5. Close or explicitly accept the three recorded gaps: overflow menu has no arrow-key roving
   focus; the update pill only re-fits on toolbar resize; tooltip/menu are `position: fixed`
   off a measured rect.

Gates: `generate:menu:check`, the shortcut-groups test, screenshot approval in both layouts.

## 5. Phase 4 — file explorer surface

The model (`src/files/`, 9 modules), the host (`electron/fs/`, six channels), all four
dirty-exit guards, and the `SurfaceStrip` seam in `tab-manager.ts` are merged and tested.
The surface was deliberately dropped; this phase rebuilds it. Cite **DL §19** for the panel —
never DL-15 (D4).

### 5.0 Prerequisites, in order

1. **Fix the `/var` symlink test** (`electron/fs/read.test.ts:48` — compare realpaths). It is
   owned by explorer work and currently blocks any "tree passes `npm test`" claim for the
   whole program, so it lands first, as its own commit.
2. **Create the packaging path.** `electron-builder` is a dependency with no config and no
   script; Gate M requires a _packaged_ build and the repo cannot produce one. This is MVP
   T19 debt and a phase-4 prerequisite, not a footnote.
3. **Run Gate M**: a packaged build opens a file, highlights, edits, saves. Monaco workers
   load through the same `file://` resolution that bit the MVP twice, both times silently.
   Gate M failing loudly reopens the editor-engine decision (spec §9) — it does not degrade.
   Note: no CSP exists today; adding one later invalidates Gate M and requires a re-run.

### 5.1 Build list

The explorer plan's §8.3 deletion list, read forward: `explorer-panel.tsx` (docked column,
DL-19 rules: stage column not overlay, `iconbtn` header, one status line, no dialogs of its
own), `file-tree-view.tsx` (22px windowing per D5), `file-icons.ts` (lucide monochrome per
D5), `file-tab-views.ts`; wiring into `tab-bar.tsx` **and** the rail (both layouts),
`status-bar.tsx` file branch, `app.tsx` mounting `createFileSurfaceController()` and passing
it as `TabManagerDeps.surfaces` — which is what turns the latent tab-close dirty guard live;
`explorerOpen`/`explorerWidth` settings with merge coverage; `toggle-explorer` + `save-file`
actions (re-verify ⌘⇧B/⌘S against the now-user-configurable keybindings; bare Ctrl+S on
Windows collides with a PTY-reserved chord), menu regen, `PLACEMENT` rows; panel CSS in the
already-restyled token language.

### 5.2 Defect burn-down on mount

The explorer plan's §7.2 lists defects that are unreachable today and awaken with the
surface. The two structural ones: **pane-scoped shortcuts fire into the hidden terminal**
(fix once at `overlayBlocksAction`, not per-shortcut — Monaco 0.56 focuses a `<div>`, so
`isChromeTextField` does not match it) and **the tree never live-updates** (watch events have
no consumer). Also: attention-rail focus bypasses `surfaces.deactivate()`, replaced preview
tabs leak documents, file tabs can outlive their workspace's terminal tabs while still
counted dirty. Host hardening in the same phase: `watch_paths` takes renderer-supplied paths
with no root guard, `realpathSync` runs per-entry on the main thread, `stat_files` /
`watch_paths` accept unbounded arrays.

### 5.3 Verification

Gate M evidence (packaged, pasted); the explorer spec's 13-item manual pass with items 7–8
(⌘W / window close / ⌘Q all ask; one dialog naming both a busy agent and unsaved files)
called out as the real dirty-exit proof — unit guards are the only coverage until then;
bundle re-measure against the recorded numbers (entry +10.92 kB gzip, lazy `editor.api`
674.50 kB — "far outside expectation is a re-decision, not a footnote").

## 6. Phase 5 — usage dashboard port + browser productization

### 6.0 Durability first — do this the day the plan is approved

`feat/token-usage-dashboard` is unpushed, dirty (AGENTS.md, CONTEXT.md), and holds its only
spec and plan as **untracked files**. `feat/workspace-reorder` is also origin-absent. Push
both; land the usage branch's dirty tree per the
[trunk-merge plan §D3](./2026-08-12-redesign-trunk-merge.md) `current`. This costs minutes
and removes the single most fragile artifact in the program.

### 6.1 The usage dashboard is a port, not a merge

The branch's merge base predates the Electron migration by 59 `main` commits; its backend is
~3,700 lines of Rust (`src-tauri/src/usage/`) with **no Electron counterpart**. Plan
accordingly:

1. Land the branch's docs and renderer work over current `main`: `src/lib/usage-*`,
   `src/usage/`, `src/ui/usage/`, the chrome/action wiring, and DL §15/§16 — whose arrival
   is exactly when the D4 citation rewrite must already be merged. The §11 generalization is
   verified benign (no rule renumbered).
2. Reimplement the scanner on the Electron host (Node port of scan/claude/codex/discover/
   reader/cache) behind `usage_*` channels — after D8, so the contract gate covers the new
   surface instead of widening its hole. The ingestion decisions are already made and
   recorded in the branch's spec (per-event deltas for Codex, contribution-map dedupe for
   Claude, 15-minute UTC buckets, six separate counter classes); port the decisions, not
   just the code.
3. **Every row of the acceptance table is unobserved** — the branch's own admission. The
   first `electron:dev` run of the dashboard on the real corpus is a scheduled task with
   pasted results, not a formality.

### 6.2 Browser productization

No spec exists — CONTEXT.md's browser section is a retrospective. First task: write the
productization spec. Candidate scope (synthesis, to be confirmed by that spec): restore the
loaded page across relaunch (today only the home URL persists), the real-compositor manual
pass CONTEXT.md lists as never done (resize, drag-to-width, hide-under-overlay), an Inspect
payload check against a real dev server, and an explicit decision to claim the panel as
Electron-only rather than implying Tauri parity. Tabs, history, bookmarks stay out unless
the owner asks.

## 7. Program sequencing and gates

```
            ┌─ phase 3 (toolbar, grows in 4 and 5)
phase 2 ────┼─ phase 4 (explorer: /var fix → packaging → Gate M → surface)
            └─ phase 5 (usage port + browser spec)   [6.0 durability: immediately]
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
| The tree passes `npm test`             | `current`  | contradicted | `electron/fs/read.test.ts` `/var` symlink case fails on macOS; fixed by phase 4 step 5.0.1 |
| PR #16 merges as-is                    | `decided`  | assumption   | PR open, unreviewed, `windows-check` red with `main`'s pre-existing Gate C failure         |
| The direction holds on any theme       | `building` | unverified   | four dark presets proven; light themes reachable via overrides, untested                   |
| The usage dashboard behaves as specced | `building` | unobserved   | the branch's acceptance table has never been run; scheduled in §6.1.3                      |
