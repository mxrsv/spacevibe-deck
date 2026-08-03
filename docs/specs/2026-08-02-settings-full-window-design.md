# Spec — Full-window settings screen

- **Date:** 2026-08-02
- **Status:** Intent confirmed in interview; awaiting engineering plan
- **Scope of this spec:** MVP only — the shell and the relocation of every
  existing setting. No new capability ships in this step.
- **Target outcome:** settings becomes a full-window screen with a category
  sidebar, so later categories plug into a reviewed shell instead of extending
  a 335-line scrolling drawer

## 1. Problem

Settings is a 300px drawer pinned to the right edge
([`.panel`](../../src/styles.css), `position: absolute; width: 300px`) that
renders eleven rows in one uninterrupted scroll
([`SettingsPanel`](../../src/ui/settings-panel.tsx)). Two separate pressures
have made that shape untenable.

**It is out of room.** The `behavior` group has become the bucket for anything
that does not fit elsewhere: editor selection, tab bar position, pane bar
visibility, agent notifications and scrollback share one heading with nothing
in common. Two categories the owner has already committed to — agent CLI
configuration and keybindings — cannot be added to a flat scroll without
making that worse.

**It does not read as an application.** The drawer form communicates "a small
side utility", which is the wrong signal for a product that is otherwise a
standalone desktop app.

These are two problems, and the shell has to solve both. A wider drawer solves
neither.

## 2. Goals (MVP)

1. Opening settings covers the whole window; the terminal keeps running behind
   it, unchanged.
2. A category sidebar navigates between sections; the section area shows one
   category at a time.
3. `Escape` closes and returns focus to the pane the user was working in —
   preserving today's behavior exactly.
4. **Every setting that exists today survives, in a named category, still
   editable.** Nothing is dropped, deferred, or silently renamed.
5. `src/ui/settings-panel.tsx` is decomposed; no resulting file exceeds the
   400-line working limit.
6. Adding a category later is a registry entry plus one section component — no
   edit to the shell.

## 3. Non-goals (explicitly later, not never)

- Agent CLI configuration (`M2` — user-declared agents). Next step after this.
- Keybindings category.
- Expanding color overrides from four keys to the full 16-colour ANSI set.
- Sidebar search field.
- Per-workspace colors, global hotkey, raw config JSON, about/update section.
- Any change under `src-tauri/`.
- Fixing `opencode` failing to launch — tracked as separate work, see §9.

## 4. Current source facts

| Area            | Source fact                                                                                                                               | Consequence for this work                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Shell           | [`.panel`](../../src/styles.css) is `absolute`, 300px wide, slides in on `translateX`                                                     | Geometry and the open/close transition both change                                                                       |
| Escape          | [`SettingsPanel`](../../src/ui/settings-panel.tsx) listens on `window`, skips when the event targets `.xterm`                             | Behavior is kept as-is; the guard becomes inert once the overlay covers the window, but removing it is an unrelated risk |
| Open/close      | [`toggleSettingsPanel` / `closeSettingsPanel`](../../src/ui/app.tsx) own the `settingsOpen` signal and hand focus back to the active pane | The shell reuses these unchanged                                                                                         |
| Controls        | [`ConfigRow` / `ConfigGroup` / `ToggleRow`](../../src/ui/controls/config-row.tsx) are the one control (`DL-5`)                            | Sections reuse them verbatim; no new control kind                                                                        |
| Persistence     | [`settings-store.ts`](../../src/settings/settings-store.ts) autosaves to `settings.json` with a 300 ms debounce                           | Untouched — this is a presentation change                                                                                |
| Schema          | [`Settings`](../../src/settings/settings-schema.ts) holds 11 fields, validated field by field                                             | Untouched in the MVP                                                                                                     |
| Design language | [`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) defines the config row (§5–6) but has **no rule for navigation or a full-window surface**   | Needs a new section — see §7                                                                                             |

### 4.1 Two facts worth flagging

- **`focusExpand` is a stored setting with no settings UI.** It lives in the
  schema and is toggled from the tab bar
  ([`App`](../../src/ui/app.tsx), `onToggleExpand`). The MVP leaves this as it
  is — surfacing it is a product decision, not a relocation.
- **`AGENTS.md` describes `src/settings/` as "settings UI + stores"**, but the
  UI actually lives in `src/ui/`. The layout section is out of date; it should
  be corrected when this lands.

## 5. Category map

Every row rendered today, and where it goes. Six categories, chosen so that the
deferred work has an obvious home rather than a new heading later.

| Category           | Contents today                                                           | Source                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Appearance**     | theme, font family, font size, app logo, tab bar position, show pane bar | `themeId`, `fontFamily`, `fontSize`, [`logo-store`](../../src/settings/logo-store.ts), `tabBarPosition`, `showPaneBar` |
| **Colors**         | background, foreground, cursor, selection                                | `colorOverrides` (`COLOR_KEYS`)                                                                                        |
| **Terminal**       | scrollback                                                               | `scrollback`                                                                                                           |
| **Links & Editor** | editor, custom command                                                   | `editorId`, `editorCommand`                                                                                            |
| **Notifications**  | agent notifications                                                      | `agentNotifications`                                                                                                   |
| **Reset**          | restore defaults                                                         | `resetSettings()`                                                                                                      |

`Terminal` and `Notifications` hold a single row each at MVP. **That thinness is
deliberate**, not an oversight: they are the landing sites for the deferred
work, and inventing filler rows to balance them would be building features to
decorate a sidebar. `Reset` sits pinned at the sidebar's foot, separated from
the navigable categories, because it is an action rather than a place.

`Agents` and `Keybindings` are absent by design — they arrive with their
features, not as empty rooms.

## 6. Design

### 6.1 Shell

The overlay covers the window inset by the existing chrome gutter, over the
terminal area. The terminal is not unmounted: panes keep running, and closing
returns to exactly the prior state.

Layout is a two-column grid: a fixed-width nav rail on the left, a scrolling
section area on the right. The section area scrolls; the rail does not. The
existing header (`~/deck/settings` and the `esc` button) spans the top, keeping
the identity the current panel already established.

### 6.2 Navigation

- Clicking a category switches the section area; the rail marks the active one.
- `↑`/`↓` move between categories while the rail has focus; `Tab` moves into
  the section content.
- The active category is remembered for the session in a window-scoped module
  signal (`R5`), **not** persisted to `settings.json` — reopening settings in
  the same session returns to where the user was, and a relaunch starts at
  Appearance. Persisting it would mean touching the schema for a preference
  nobody asked for.

### 6.3 Escape and focus

Unchanged from today: focus moves into the screen on open so `Escape` reaches
the handler; a focused text field blurs first so `CommitInput` drafts are not
dropped; closing hands focus back to the active pane via the existing
`closeSettingsPanel`.

### 6.4 Motion

Open/close becomes a fade with a 4px vertical settle, replacing the horizontal
slide (a 300px drawer slides; a full-window surface does not). Only `opacity`
and `transform` animate (`DL-1.2`), the duration stays inside the chrome motion
budget (`DL-7`), and `prefers-reduced-motion` drops it entirely (`DL-1.5`).
Switching category does not animate.

## 7. Design-language addition — §11 Settings shell

`DESIGN-LANGUAGE.md` has no rule covering a navigation rail or a full-window
surface, so this work adds one. Approved as a fork on 2026-08-02.

- **DL-11.1** The settings shell is a two-column surface: fixed nav rail, and a
  section area that owns all scrolling.
- **DL-11.2** The active category is marked by a 2px left accent bar plus a 4%
  `--fg` wash — the same signifier as config row hover (`DL-5.1`), so "active"
  reads consistently across the app. No shadow, no fill (`DL-1.3`).
- **DL-11.3** Category icons are hand-drawn inline SVG, 16px, single stroke,
  `currentColor`. **No icon library** — `DL-1.1` forbids new runtime
  dependencies for chrome UI, and this rule exists so the constraint is not
  quietly re-litigated per icon.
- **DL-11.4** Category labels are lowercase mono (`DL-4.2`, `DL-4.3`), matching
  the existing group labels they replace.
- **DL-11.5** Destructive actions do not sit among navigable categories; they
  are pinned to the rail's foot and marked `--red` (`DL-3.2`).

## 8. Module structure

```
src/ui/settings/
├─ settings-screen.tsx        # shell: overlay, header, rail + section grid
├─ settings-nav.tsx           # the rail: list, keyboard nav, active marker
├─ settings-nav-icons.tsx     # inline SVG, one per category (DL-11.3)
├─ settings-categories.ts     # registry: id, label, icon, section component
├─ active-category-store.ts   # window-scoped signal (R5)
└─ sections/
   ├─ appearance-section.tsx
   ├─ colors-section.tsx
   ├─ terminal-section.tsx
   ├─ links-editor-section.tsx
   ├─ notifications-section.tsx
   └─ reset-section.tsx
```

`src/ui/settings-panel.tsx` is deleted; its JSX moves into the sections
unchanged, and its two async guards (the notification permission prompt and the
reset confirmation) move with the rows that own them. `src/ui/controls/` is
untouched.

The registry is the extension point: a new category is one entry plus one file
under `sections/`. `settings-screen.tsx` never learns category names.

## 9. Related work, deliberately separate

**`opencode` does not launch.** Typing `opencode` in a Deck pane returns no
output and no new prompt — the binary exists (no `command not found`), but
nothing renders. `TERM` is ruled out: [`pty.rs`](../../src-tauri/src/pty.rs)
sets `xterm-256color` and `COLORTERM=truecolor` correctly.

This is a PTY/render defect and settings cannot fix it. It matters to sequencing
because the next step after this spec is `M2` (user-declared agents), and `M2`
would otherwise ship a path that lets the user declare `opencode`, select it,
and still watch it fail. **Diagnose the launch failure before `M2` ships.**

## 10. Verification

- `npm test` — green, including a new test that every schema-backed setting
  reachable in the old panel is reachable in a section.
- `npm run build` — green (this is `tsc && vite build`, so it covers typecheck).
- Screenshot of the open screen reviewed by eye against `DESIGN-LANGUAGE.md`
  §11 and the migration table in §10 of that document.
- Manual: open, switch every category, edit one value per category, close with
  `Escape`, confirm focus lands back in the active pane and the value persisted.

## 11. Open questions

| Question                                                                           | Owner   | Blocking?                       |
| ---------------------------------------------------------------------------------- | ------- | ------------------------------- |
| Should `focusExpand` gain a row in Appearance, or stay tab-bar-only?               | product | no — MVP keeps today's behavior |
| Does the 16-colour ANSI expansion belong in Colors, or a separate theme editor?    | product | no — deferred past MVP          |
| Correct the `src/settings/` description in `AGENTS.md` in this task or separately? | repo    | no                              |
