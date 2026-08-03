# Full-window settings screen

**Spec**: [2026-08-02-settings-full-window-design.md](../specs/2026-08-02-settings-full-window-design.md) — MVP scope only: shell + relocation of every existing setting, no new capability, no schema change, no `src-tauri/` change.
**Goal**: Replace the 300px slide-over drawer ([`SettingsPanel`](../../src/ui/settings-panel.tsx), [`.panel`](../../src/styles.css)) with a full-window screen — a category sidebar (rail) on the left, a scrolling section area on the right — so the two future categories already committed to (agent CLI config, keybindings) have a registry entry to land in instead of a new heading in an ever-growing scroll.
**Architecture**: New module `src/ui/settings/` (shell, rail, icons, registry, a window-scoped active-category signal, six section components under `sections/`). Every row keeps its existing control (`ConfigRow`/`ToggleRow`/`ColorRow`/`FontRow`/`EditorRow`/`LogoRow` from `src/ui/controls/`, untouched) — this is a relocation, not a redesign of any control. `settings-panel.tsx` is deleted once the new screen is wired in; its two async guards (notification permission, reset confirm) move with the rows that own them.

## 1. Expected outcomes

- Settings opens as a full-window overlay over the stage (terminal keeps running underneath, unchanged) — matches spec §1 goal 1.
- A left rail lists five navigable categories (Appearance, Colors, Terminal, Links & Editor, Notifications); clicking one swaps the section area; `↑`/`↓` move between categories while the rail has focus — spec §1 goal 2, §6.2.
- `Escape` closes the screen and returns focus to the active pane, byte-for-byte the same guard behavior `settings-panel.tsx` has today (the `.xterm` check, blur-before-close) — spec §1 goal 3, §6.3.
- Every one of the 11 `Settings` fields that had a row in the old panel still has a row somewhere in the new screen, still editable, still persisted through the untouched `settings-store.ts` — spec §1 goal 4. Proved by an automated test (Task 7), not eyeballing.
- `settings-panel.tsx` (335 lines) is gone; no file this plan adds exceeds ~400 lines — spec §1 goal 5.
- Adding a category later (agent config, keybindings) is one `settings-categories.ts` entry + one file under `sections/` — no edit to `settings-screen.tsx` — spec §1 goal 6.
- `docs/DESIGN-LANGUAGE.md` gains §11 (`DL-11.1`–`DL-11.5`, verbatim from spec §7), `docs/CONTEXT.md` gains a Settings entry, `npm test` and `npm run build` are green.

## 2. Source facts (verified against the code, not the spec's prose)

| Area             | Fact                                                                                                                                                                                                                                                 | Consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell            | [`.panel`](../../src/styles.css#L1040-L1074) is `position: absolute; top/right/bottom: 8px; width: 300px`, `z-index: 20`, slides via `translateX` with a `visibility` delay trick                                                                    | Forked into a new `.settings-screen` inset `8px` on all four sides (matching [`.stage__tabs`](../../src/styles.css#L634-L639)'s own `8px` gutter) at the same `z-index: 20` — [`.persist-error-bar`](../../src/styles.css#L2461-L2477) already sits at `z-index: 25`, above the panel today, so keeping `20` introduces no new stacking conflict                                                                                                                     |
| Escape           | [`settings-panel.tsx`](../../src/ui/settings-panel.tsx#L62-L87) listens on `window`, skips when `event.target.closest(".xterm")`, blurs the focused element before calling `onClose`                                                                 | Ported verbatim into `settings-screen.tsx` — not simplified, per spec §4                                                                                                                                                                                                                                                                                                                                                                                             |
| Open/close       | [`toggleSettingsPanel`/`closeSettingsPanel`](../../src/ui/app.tsx#L100-L143) own `settingsOpen` (module signal, [`chrome/events.ts`](../../src/chrome/events.ts#L23)) and hand focus back via `tabsRef.current?.focusActive()`                       | Reused unchanged — `app.tsx` swaps only which component it mounts, `open`/`onClose` props stay the same shape                                                                                                                                                                                                                                                                                                                                                        |
| Controls         | `ConfigRow`/`ConfigGroup`/`ToggleRow` ([`config-row.tsx`](../../src/ui/controls/config-row.tsx)), `ColorRow`, `FontRow`, `EditorRow`, `LogoRow`                                                                                                      | Reused verbatim by the new sections; `src/ui/controls/` is not touched by this plan                                                                                                                                                                                                                                                                                                                                                                                  |
| Persistence      | [`settings-store.ts`](../../src/settings/settings-store.ts) — `updateSettings`, `updateColorOverride`, `resetSettings`, 300ms debounced autosave                                                                                                     | Untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Schema           | [`Settings`](../../src/settings/settings-schema.ts#L13-L28) — 11 fields; `focusExpand` has no settings row today (toggled from the tab bar only, `app.tsx`'s `onToggleExpand`)                                                                       | Untouched; `focusExpand` stays absent from every section — do not add or remove it                                                                                                                                                                                                                                                                                                                                                                                   |
| Draft-loss guard | [`CommitInput`](../../src/ui/controls/commit-input.tsx) commits on blur or Enter, never on unmount                                                                                                                                                   | Traced, not an open risk: switching category via a rail click blurs the previously-focused input (native focus-shift-before-click DOM order) before the section swaps, so any in-flight custom-font/custom-editor-command draft commits first. Switching via `↑`/`↓` never touches a `CommitInput` — the rail, not the input, holds keyboard focus when arrows are live. No new code needed for this; verified by reasoning through the DOM event order, not assumed |
| Convention       | [`color-row.tsx`](../../src/ui/controls/color-row.tsx), `font-row.tsx`, `logo-row.tsx` have **no** dedicated test file today ([`src/ui/controls/`](../../src/ui/controls/) listing) — only `config-row.tsx`, `editor-row.tsx`, `commit-input.tsx` do | Sets the bar for this plan's four static sections (Task 3): build + typecheck is adequate verification for a prop-free recomposition of already-tested controls with no new branching logic; a screen-level completeness test (Task 7) covers the behavioral gap                                                                                                                                                                                                     |
| Local idiom      | [`open-board.tsx`](../../src/open-board/open-board.tsx#L318-L353) — `moveWorkspace`/`movePreset`/`moveAgent`/the section switch all wrap with `(index + step + length) % length`                                                                     | The rail's `↑`/`↓` follows the same wrap convention, not a clamp — this is the only existing vertical roving-list precedent in the repo and it wraps                                                                                                                                                                                                                                                                                                                 |

## 3. Business rules & invariants

- **No schema change, no `src-tauri/` change, no new setting.** The same 11 `Settings` fields, same store, same three control kinds, relocated only.
- **`focusExpand` stays exactly as absent as it is today** — it is not a row in any section; do not surface it, do not reference it from `settings/`.
- **Escape/focus behavior is preserved bit-for-bit**, including the `.xterm` guard that the spec itself calls "inert once the overlay covers the window, but removing it is an unrelated risk" (spec §4 table) — this plan does not remove it.
- **The active category is a window-scoped signal, not persisted.** Reopening settings in the same session returns to the last category; a relaunch always starts at Appearance (module signal default). No `settings-store`/schema involvement.
- **Reset is not a navigable category.** It is a pinned action at the rail's foot, `--red` (DL-11.5), separate from the five-entry registry that drives category switching. `reset-section.tsx` exists as a file (per spec §8's module tree) but its component is consumed directly by `settings-nav.tsx`'s foot slot, not through the category-switch registry.
- **Category rail labels are lowercase mono** (DL-11.4), matching the group labels they replace (`appearance`, `colors`, …) even though the spec's category-map table (§5) capitalizes them for readability — the registry's `label` field holds the lowercase display string, the `CategoryId` is a separate kebab-case identifier.
- **No app.tsx render pass may lack a settings surface.** The cutover (Task 8) swaps `<SettingsPanel>` for `<SettingsScreen>` in one commit-sized step; it does not straddle a state where neither is mounted or both are.
- **`ConfigRow`/`ToggleRow`/`ColorRow`/`FontRow`/`EditorRow`/`LogoRow` are not edited.** Every visual/behavioral change lives in the new `settings-screen.tsx`/`settings-nav.tsx`/`sections/*` layer.

## 4. In scope / out of scope

**Do**:

- `src/ui/settings/` — the six new module files (`settings-screen.tsx`, `settings-nav.tsx`, `settings-nav-icons.tsx`, `settings-categories.ts`, `active-category-store.ts`) plus `sections/` (6 files), per spec §8.
- New/forked CSS: `.settings-screen*`, `.settings-nav*` in `src/styles.css`; retarget the `prefers-reduced-motion` selector list from `.panel`/`.panel *` to the new class names (DL §9.3 — scope, not an allowlist).
- Delete `src/ui/settings-panel.tsx` and `src/ui/settings-panel.test.tsx` once every test in the latter has a new home.
- Wire `src/ui/app.tsx` to mount `SettingsScreen` instead of `SettingsPanel` (same `open`/`onClose` props).
- `docs/DESIGN-LANGUAGE.md` §11 addition (verbatim from spec §7).
- `docs/CONTEXT.md` — add Settings to the Surfaces bullet.

**Do NOT**:

- Agent CLI configuration, keybindings category, 16-colour ANSI expansion, sidebar search, per-workspace colors, global hotkey, raw config JSON, about/update section — spec §3, next steps after this.
- Anything under `src-tauri/`.
- Fixing `opencode`'s launch failure — spec §9, tracked separately.
- Correcting `AGENTS.md`'s "`src/settings/` is settings UI + stores" line — spec §4.1 flags this as stale but leaves _when_ to fix it as an open, non-blocking question (spec §11); this plan does not decide it (see §9 Open questions).
- Renaming or restyling any of the six existing control components in `src/ui/controls/`.

## 5. Sequencing & cutover strategy

The app must render a working settings surface at every commit-sized step, so this plan is split into two phases:

1. **Tasks 1–7 are purely additive.** They build the entire new `src/ui/settings/` tree and test it in isolation. `app.tsx` still imports and mounts the old `SettingsPanel` the whole time — nothing about the running app changes until Task 8. `settings-panel.tsx`/`settings-panel.test.tsx` are read from (to extract rows and move tests) but not edited or deleted in these tasks.
2. **Task 9a (DL §11) runs before the cutover**, not after it. The rules have to exist before Task 8's screenshot is judged against them; a review with no written standard is just an opinion. Execution order is therefore 1–7 → 9a → 8 → 9b.
3. **Task 8 is the single cutover step.** It swaps the one line in `app.tsx` that mounts `SettingsPanel` for one that mounts `SettingsScreen`, then deletes `settings-panel.tsx` and `settings-panel.test.tsx` in the same task — by that point every test in the old test file has already been ported (Task 4 takes the agent-notifications and restore-defaults `describe` blocks, Task 7 takes the Escape/focus `describe` block), so nothing is lost and nothing is duplicated. There is no commit in between where settings is unreachable or a setting has no UI.

Old → new test-file mapping (so `settings-panel.test.tsx`'s fate is explicit, not implied):

| Old `describe` block (`settings-panel.test.tsx`)       | New home                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `SettingsPanel — Escape / focus (M2)`                  | `settings-screen.test.tsx` (Task 7), selectors updated to the new class names |
| `SettingsPanel — agent notifications toggle (Task 22)` | `sections/notifications-section.test.tsx` (Task 4)                            |
| `SettingsPanel — Restore defaults confirm`             | `sections/reset-section.test.tsx` (Task 4)                                    |

## 6. Tasks

### Task 1: `active-category-store.ts` — the session-scoped active category signal

**File(s)**: `src/ui/settings/active-category-store.ts` (new), `src/ui/settings/active-category-store.test.ts` (new)

**Depends on**: nothing.

**Decision**: A bare module signal, same idiom as `chrome/events.ts`'s `settingsOpen` (R5) — not persisted, default `"appearance"`.

**Build**:

```ts
export type CategoryId =
  | "appearance"
  | "colors"
  | "terminal"
  | "links-editor"
  | "notifications";

export const activeCategory = signal<CategoryId>("appearance");
```

**Verify**: `npm test -- active-category-store` — asserts the default value and that assigning `.value` sticks.

---

### Task 2: `settings-nav-icons.tsx` — hand-drawn category icons

**File(s)**: `src/ui/settings/settings-nav-icons.tsx` (new), `src/ui/settings/settings-nav-icons.test.tsx` (new)

**Depends on**: nothing.

**Decision**: Five inline SVG components, one per navigable category (Appearance/Colors/Terminal/Links & Editor/Notifications) — 16px, single stroke, `currentColor`, no icon library (DL-11.3). Same authoring pattern as `chrome-actions.tsx`'s `GearIcon`/`SplitRowIcon`.

**Build**: `AppearanceIcon`, `ColorsIcon`, `TerminalIcon`, `LinksEditorIcon`, `NotificationsIcon` — each a small `<svg>` function component, `aria-hidden="true"`, `width`/`height` 16, `stroke-width` 1.8.

**Verify**: `npm test -- settings-nav-icons` — renders each icon and asserts an `svg` element is present (a build pass alone does not prove the JSX renders without throwing).

---

### Task 3: Static sections — Appearance, Colors, Terminal, Links & Editor

**File(s)**:

- `src/ui/settings/sections/appearance-section.tsx` (new)
- `src/ui/settings/sections/colors-section.tsx` (new)
- `src/ui/settings/sections/terminal-section.tsx` (new)
- `src/ui/settings/sections/links-editor-section.tsx` (new)

**Depends on**: nothing (reads `settings-store`/`settings-schema`/`themes` directly, same as `settings-panel.tsx` does today).

**Decision**: Each section is a prop-free component that reads `settings.value` itself, mirroring how `settings-panel.tsx` reads `current = settings.value` today — no prop-threading from `settings-screen.tsx`. No `<ConfigGroup>` header inside any section: DL-11.4 says the rail label "matches the existing group label it replaces," i.e. the rail item _is_ the new group label, so repeating it inside the section body would duplicate it.

**Build** — move rows verbatim out of [`settings-panel.tsx`](../../src/ui/settings-panel.tsx), no logic changes:

- `AppearanceSection`: Theme (`cycleTheme` + `ConfigRow`/`cfg-swatch`), `FontRow`, Font size (`stepFontSize` + the `cfg-step` pill), `LogoRow`, Tab bar position (`cycleTabBar`), Show pane bar (`ToggleRow`). `TAB_BAR_CHOICES` constant moves with it.
- `ColorsSection`: the `COLOR_KEYS.map(<ColorRow …/>)` loop, `COLOR_LABELS` constant, `getPreset(current.themeId)` for the fallback swatch value.
- `TerminalSection`: Scrollback (`cycleScrollback` + `scrollbackLabel`).
- `LinksEditorSection`: `EditorRow`.

**Verify**: `npm run build` (typecheck) — per §2's noted convention, a dedicated test file is not required for a prop-free recomposition of already-tested controls; behavioral coverage comes from Task 7's completeness test. `rg -n "themeId|fontFamily|fontSize|logoDataUrl|tabBarPosition|showPaneBar|colorOverrides|scrollback|editorId" src/ui/settings/sections/*.tsx` — confirms every field these four sections own is referenced somewhere in the new files (a coarse but fast regression check pending Task 7's real test).

---

### Task 4: Guarded sections — Notifications, Reset

**File(s)**:

- `src/ui/settings/sections/notifications-section.tsx` (new)
- `src/ui/settings/sections/notifications-section.test.tsx` (new)
- `src/ui/settings/sections/reset-section.tsx` (new)
- `src/ui/settings/sections/reset-section.test.tsx` (new)

**Depends on**: nothing.

**Decision**: The two async guard signals (`requesting`, `resetting`) and their handlers (`handleAgentNotificationsToggle`, `handleReset`) move with the rows that own them, verbatim — spec §8. `ResetSection`'s export name matches the section-file naming convention even though `settings-nav.tsx` (Task 6), not the category registry, is what renders it — see §3 invariant on Reset not being a navigable category.

**Build**:

- `NotificationsSection`: the `agentNotifications` `ToggleRow`, `requesting` signal, `handleAgentNotificationsToggle` (unchanged: no permission request on mount, one request per click, `reportPersistError` on denial/rejection).
- `ResetSection`: the "Restore defaults" `ConfigRow` + danger button, `resetting` signal, `handleReset` (unchanged: `ask()` confirm dialog, fail-safe on dialog rejection, `resetSettings()` on confirm).

**Verify**:

- `npm test -- notifications-section` — port the six `describe("SettingsPanel — agent notifications toggle (Task 22)")` cases from `settings-panel.test.tsx` (mount-not-request, enable+granted, enable+denied, API-rejects, disable, double-click-re-entry), mounting `<NotificationsSection />` instead of the whole panel.
- `npm test -- reset-section` — port the four `describe("SettingsPanel — Restore defaults confirm")` cases, mounting `<ResetSection />`.

---

### Task 5: `settings-categories.ts` — the category registry

**File(s)**: `src/ui/settings/settings-categories.ts` (new), `src/ui/settings/settings-categories.test.ts` (new)

**Depends on**: Task 1 (`CategoryId`), Task 2 (icons), Task 3 (four sections).

**Decision**: A plain ordered array — the extension point spec §1 goal 6 requires. Exactly the five navigable categories from spec §5's table, in that order; `NotificationsSection` from Task 4 is included here (it _is_ navigable), `ResetSection` is not (§3 invariant).

**Build**:

```ts
export interface SettingsCategory {
  readonly id: CategoryId;
  /** Lowercase mono display label (DL-11.4) — distinct from `id`. */
  readonly label: string;
  readonly Icon: ComponentType;
  readonly Section: ComponentType;
}

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    label: "appearance",
    Icon: AppearanceIcon,
    Section: AppearanceSection,
  },
  { id: "colors", label: "colors", Icon: ColorsIcon, Section: ColorsSection },
  {
    id: "terminal",
    label: "terminal",
    Icon: TerminalIcon,
    Section: TerminalSection,
  },
  {
    id: "links-editor",
    label: "links & editor",
    Icon: LinksEditorIcon,
    Section: LinksEditorSection,
  },
  {
    id: "notifications",
    label: "notifications",
    Icon: NotificationsIcon,
    Section: NotificationsSection,
  },
];
```

**Verify**: `npm test -- settings-categories` — asserts the array's `id` sequence equals `["appearance","colors","terminal","links-editor","notifications"]` (order matters — it is rail display order) and that `"reset"` is not among the ids.

---

### Task 6: `settings-nav.tsx` — the rail

**File(s)**: `src/ui/settings/settings-nav.tsx` (new), `src/ui/settings/settings-nav.test.tsx` (new), CSS additions to `src/styles.css` (`.settings-nav*`)

**Depends on**: Task 4 (`ResetSection` for the foot), Task 5 (registry).

**Decision**: A vertical list of buttons above a pinned foot. Clicking a button sets `activeCategory.value` directly (module signal, no prop callback — same idiom `app.tsx` uses for `boardOpen.value = false`). `↑`/`↓` wrap (§2's noted local idiom, matching `open-board.tsx`'s `moveWorkspace`/`movePreset`), moving both the signal and DOM focus together so the visibly active item and the focused item never disagree. The foot's `ResetSection` sits outside the arrow-key roving group entirely — it is a normal tab-order stop, not part of the five-item cycle.

**Build**:

- `.settings-nav__list` — `SETTINGS_CATEGORIES.map`, each a `<button class="settings-nav__item">` with `Icon` + `label`; `is-active` class on the entry matching `activeCategory.value`.
- Active marker (DL-11.2): `.settings-nav__item.is-active` gets the same 2px left accent bar + 4% `--fg` wash recipe `.cfg-row:hover` already uses (`border-left-color: var(--accent)`, `background: color-mix(in srgb, var(--fg) 4%, transparent)`) — no shadow, no fill (DL-1.3).
- `onKeyDown` on the list container: `ArrowDown`/`ArrowUp` compute `(index + step + 5) % 5` over `SETTINGS_CATEGORIES`, set `activeCategory.value`, and call `.focus()` on the corresponding button ref.
- `.settings-nav__foot` — border-top hairline, renders `<ResetSection />` (Task 4) below the list, outside the roving-list container.

**Verify**: `npm test -- settings-nav` — clicking each item sets `activeCategory.value` to the matching id; `ArrowDown` from the last item wraps to the first (and vice versa for `ArrowUp`); the reset action renders once, is not among the five `role`-tagged nav buttons, and clicking it does not change `activeCategory`.

---

### Task 7: `settings-screen.tsx` — the shell

**File(s)**: `src/ui/settings/settings-screen.tsx` (new), `src/ui/settings/settings-screen.test.tsx` (new), CSS additions/forks in `src/styles.css` (`.settings-screen*`, retargeting the `prefers-reduced-motion` selector list)

**Depends on**: Task 5 (registry), Task 6 (`SettingsNav`).

**Decision**: Same public shape as the old `SettingsPanel` — `{ open: boolean; onClose: () => void }` — so Task 8's cutover is a near drop-in swap. Header text ("`~/deck/settings`" + "esc" button) is unchanged, not per-category (spec §6.1: "keeping the identity the current panel already established"). Mount-focus effect and the Escape handler (including the `.xterm` guard and blur-before-close) are ported verbatim from `settings-panel.tsx`, not simplified. `activeCategory` is never reset on close — reopening in the same session returns to the last category (§3 invariant).

**Build**:

- JSX: outer `.settings-screen` (was `.panel`) → `.settings-screen__head` (was `.panel__head`, same "`~/deck/settings`" + esc button, same `escRef`) → `.settings-screen__grid` (two-column: `<SettingsNav />` + `<section class="settings-screen__section">`) rendering `SETTINGS_CATEGORIES.find(c => c.id === activeCategory.value)?.Section`.
- CSS: `.settings-screen` forks `.panel`'s box (background `var(--chrome-2)`, hairline border, 12px radius, `z-index: 20`) but `inset: 8px` on all four sides instead of `top/right/bottom: 8px; width: 300px`; motion changes from the `translateX` slide to the spec §6.4 fade + 4px vertical settle (`opacity` + `transform` only, inside the DL §7 chrome motion budget, `prefers-reduced-motion` drops it). `.settings-screen__section` forks `.panel__body`'s scroll + scrollbar rules (the section area, not the rail, owns scrolling — DL-11.1). In the `@media (prefers-reduced-motion: reduce)` block ([`styles.css`](../../src/styles.css#L1362-L1370)), replace **only** the first two selectors (`.panel`, `.panel *`) with `.settings-screen`, `.settings-screen *` — scope, not an allowlist (DL §9.3). The block's three remaining selectors (`.tabbar *`, `.wsbar *`, `.status *`) belong to other surfaces and MUST stay; dropping them silently removes reduced-motion support from the tab bar, workspace sidebar and status bar. `.cfg-*` rules are untouched (still consumed by the reused controls).
- Category switching itself does not animate (spec §6.4) — no transition on `.settings-screen__section`'s content swap.

**Verify**:

- `npm test -- settings-screen` — port the four `describe("SettingsPanel — Escape / focus (M2)")` cases (mount-focus, Escape closes outside a terminal, Escape does not close inside `.xterm`, listener removed once closed), selectors updated to `.settings-screen__esc`.
- Same test file, new case — **the completeness test spec §10 requires**: mount `<SettingsScreen open onClose={vi.fn()} />`, click through all five rail items, and at each collect the rendered `cfg-row__label`/`aria-label` text; assert the union equals the fixed 13-item list every schema-backed setting maps to (Theme, Font, Font size, App logo, Tab bar position, Show pane bar, Background, Foreground, Cursor, Selection, Scrollback, Editor, agent notifications) plus Restore defaults from the rail foot.
- `npm run build`.
- No screenshot yet — the screen is not reachable through the running app until Task 8; the DL §9.6 eye-review happens there, where it is real.

---

### Task 8: Cutover — wire `app.tsx`, delete the old panel

**File(s)**: `src/ui/app.tsx`, delete `src/ui/settings-panel.tsx`, delete `src/ui/settings-panel.test.tsx`

**Depends on**: Task 7, **and Task 9a** — the eye-review below has to review against a written standard, so DL §11 must exist before the screenshot is judged, not after it.

**Decision**: One-line swap: the `SettingsPanel` import and its single call site (`<SettingsPanel open={settingsOpen.value} onClose={closePanel} />`, [`app.tsx:538`](../../src/ui/app.tsx#L538)) become `SettingsScreen`/`<SettingsScreen …/>`. Nothing else in `app.tsx` changes — `toggleSettingsPanel`, `closeSettingsPanel`, `toggleSettings`, `closePanel`, the `settingsOpen` signal, and the two `ChromeActions` mount points (sidebar toolbar + `TabBar`) are untouched, since none of them know or care which component renders behind `settingsOpen`.

**Build**: Update the import in `app.tsx`; delete `settings-panel.tsx`; delete `settings-panel.test.tsx` (every case it held has a home per the §5 table — verify this before deleting, not after).

**Verify**:

- `npm test` (full suite) — green, and specifically confirms nothing still imports the deleted files.
- `npm run build` — green.
- `rg -n "settings-panel" src` — 0 hits.
- Manual: `npm run tauri dev` (or `npm run dev`), open Settings via the gear icon and via `⌘,`, switch every category, edit one value per category, confirm it persists (reopen, value still set), close with `Escape`, confirm focus returns to the active pane — spec §10's manual checklist.
- Screenshot of the open screen, eye-reviewed against `docs/DESIGN-LANGUAGE.md` §11 (written in Task 9a, before this task runs) and the DL §9 agent checklist — this is the real DL §9.6 review the spec requires; a green build proves nothing about design.

---

### Task 9a: Design language — §11 and the §9.3 reference (runs BEFORE Task 8)

**File(s)**: `docs/DESIGN-LANGUAGE.md`

**Depends on**: Task 7 (the shell exists, so the rules describe something real).

**Decision**: The rules must be written before the cutover, because Task 8's eye-review judges the screenshot against them. Reviewing a design against a standard that does not exist yet is not a review.

Add §11 verbatim from spec §7 (`DL-11.1`–`DL-11.5`), placed after the existing §10 migration table and before the "Chưa khớp thực tế" ledger heading (which must stay last, per the repo's docs convention). No §10 migration-table row is added: nothing that was DL-compliant stops complying — `.panel`/`.panel__*` are retired cleanly, not left behind non-compliant, and every reused control (`.cfg-*`) is untouched.

**Also update DL §9.3.** That checklist item currently reads "Reduced-motion is handled **by scope** (`.panel *`), never by an allowlist" — it cites a class this plan deletes. Change the cited example to `.settings-screen *` so the checklist keeps pointing at a class that exists (R2: a DL rule that references dead code is drift, and this task is the one that creates it).

**Build**:

- `docs/DESIGN-LANGUAGE.md`: insert §11 with the five rules exactly as spec §7 states them.
- `docs/DESIGN-LANGUAGE.md` §9.3: swap the `.panel *` example for `.settings-screen *`.

**Verify**: `rg -n "DL-11" docs/DESIGN-LANGUAGE.md` → 5 matches. `rg -n '\.panel' docs/DESIGN-LANGUAGE.md` → 0 hits outside §10's migration table (which is a point-in-time record).

---

### Task 9b: `docs/CONTEXT.md` (runs AFTER Task 8)

**File(s)**: `docs/CONTEXT.md`

**Depends on**: Task 8 — this records what shipped, so it is written once the screen is actually reachable in the app.

**Build**: extend the "Surfaces:" bullet ([`CONTEXT.md:38`](../CONTEXT.md)) in the Product snapshot section to include "a full-window Settings screen with a category sidebar" (today's bullet lists layout presets, pane swap, multi-window move/join, the Open board, the agent picker, the file sidebar — Settings is absent from it).

**Verify**: `rg -n "Settings screen|category sidebar" docs/CONTEXT.md` → at least 1 match.

## 7. Final verification

Run once, after Task 9b, as the closing gate for the whole plan:

- `npm test` — full suite green.
- `npm run build` — `tsc && vite build`, green (covers typecheck; no separate lint script in this repo).
- `git status --porcelain` — the changed-file list matches the union of every task's "File(s)" above; nothing outside that set was touched.
- `rg -n "settings-panel" src docs` — 0 hits outside point-in-time records in `docs/plans/`/`docs/review/` (which are left as written per the repo's known-traps note).
- Manual walkthrough (already run once in Task 8; repeat here only if Task 9a/9b's edits touched anything code-adjacent — they do not, so this is a formality): open/close via gear icon, `⌘,`, and `Escape`; every category reachable; one edit per category persists across a close/reopen.

## 8. Open questions

| Question                                                                                                                                                                     | Owner  | Blocking?                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should `AGENTS.md`'s "`src/settings/` is settings UI + stores" line be corrected in this plan or separately?                                                                 | repo   | No — spec §11 already leaves this open and marks it non-blocking; this plan does not decide it, consistent with staying inside the spec's stated MVP scope |
| Exact pixel width of the rail, and whether `ResetSection`'s existing `ConfigRow`-shaped markup reads well at that width, or needs a more compact treatment for the foot slot | design | No — spec doesn't prescribe a width; resolved by the Task 8 eye-review (DL §9.6), not a code decision this plan can make ahead of seeing it rendered       |
| Whether this spec/plan should be logged in the workspace-level `AGENTS.md` "In flight" list (per that file's own convention for design decisions once resolved)              | repo   | No — out of this plan's file scope (this plan touches only `spacevibe-deck`); flagged for the human, not resolved here                                     |
