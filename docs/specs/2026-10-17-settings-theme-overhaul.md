# Settings and theme overhaul

Date: 2026-10-17
Updated: 2026-10-21

Visual/component authority: [Deck-wide shadcn / Base UI migration](2026-10-21-shadcn-base-ui-migration.md).
The owner replaced the Deck-density/Radix direction with Base UI and preset `b1a09kDGF`.
The linked spec owns appearance and compatibility; this file owns Settings product behavior.
Unshipped typography, notification, theme-editing and per-project features remain a separate
backlog and are not prerequisites for the UI migration. The source observations below describe
the original 2026-10-17 baseline, not a new audit of shipped behavior.

Status: Approved for development, 2026-10-19, except slice P1 (see
[Resolved decisions](#resolved-decisions)). The owner took decisions 1–5 on 2026-10-17 and
answered every open decision and approved the forks below on 2026-10-19. Each slice still
gets its own short plan before code; the plan needs no further approval unless it departs from
this spec.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main` at `4623445c` (2026-10-17). The primary checkout holds another session's
uncommitted `CHANGELOG.md`, `docs/DESIGN-LANGUAGE.md`, `src/styles/11-settings-*.css` and
`src/styles/12-usage.css`; this spec touches none of them.
Host: Electron only. The Tauri host was removed on 2026-10-13, so nothing here degrades
through `available`.
Related records: the audit and function table in `docs/plans/2026-10-04-settings-redesign.md`
and the Studio integration in `docs/plans/2026-10-04-settings-studio.md`. These ignored local
plans live in the owner checkout named above, not in a fresh worktree; requirements live here.

## Purpose

Bring Deck's Settings up to the standard of the desktop apps the owner studied, on four fronts: a theme system where each theme carries its own tokens; a Settings
surface that can be searched, linked into and reset by page; terminal typography and
notification options that are fixed or missing today; and feedback that tells the user what
their change did. The owner asked for one large spec; slices keep each delivery reviewable.

The studied apps are not named in repository records. Their source is under a source-available
licence, so everything below is an idea or an observed behaviour; no text, code, colour value or
asset is copied. The research notes live outside the repository.

## Decisions (owner, 2026-10-17)

1. **Explicit tokens per theme.** A theme declares the chrome tokens, the terminal colours
   (background, foreground, cursor, selection and the 16 ANSI colours) and the editor and
   syntax colours itself. Deck stops deriving chrome from the terminal theme with
   `color-mix`. Turned down: a hybrid where a theme declares only core tokens and the rest
   derives (smaller files, but no per-token control).
2. **All six existing presets go**: `deck-dark`, `deck-light`, `tokyo-night`, `dracula`,
   `one-dark`, `catppuccin-mocha`. A new built-in set is designed against the new token
   model. Turned down: keeping Deck Dark and Light and dropping only the other four.
3. **Appearance scope**: a theme picker with a swatch chip and Light and Dark groups, a
   follow-system mode with a separate light and dark theme, theme import and export with a
   starter file, and an in-app token editor with a live preview.
4. **Companion settings in scope**: Settings search and deep links, terminal typography,
   notification sound and rules, per-project overrides, and the feedback group in
   [Requirements, area E](#e-feedback-and-safety). Settings gaps not listed here stay out
   ([Out of scope](#out-of-scope)).

5. **Adopt official shadcn components on Base UI** (updated 2026-10-21). The owner
   selected preset `b1a09kDGF` and expanded migration to all Deck UI in waves. Settings moves
   first after the compatibility/foundation gate. See the [owning migration
   specification](2026-10-21-shadcn-base-ui-migration.md); the earlier Settings-only,
   Deck-token and compact-control interpretation is superseded.

Decision 3 reverses two earlier records. The 2026-08-19 decision that light and dark are the
only theme choice, and the retirement of the theme gallery, theme import and colour overrides
from Settings, stop applying when the theme slices ship. The plan's "Not proposed" line for
them is superseded by this spec.

## Requirements

Each requirement has an id used by the plan and its checks. "Today" statements were read from
the tree on 2026-10-17.

### A. Theme system

Today: `THEME_PRESETS` in [`themes.ts`](../../src/settings/themes.ts) holds six presets;
Settings offers Light or Dark; chrome tokens derive from `(background, foreground)` through
[`derive-colors.ts`](../../src/lib/derive-colors.ts) (DL-2.2); `monacoThemeFor`
([`editor-host.ts`](../../src/files/editor-host.ts)) maps the theme to Monaco; custom theme
loading, import and four colour overrides still build but are unmounted.

- **THM-1 Theme file.** A theme is one JSON document: `id` (slug), `name`, optional `author`,
  `version`, `description`, `type` (`dark` or `light`), `ui` (the chrome tokens),
  `terminal` (16 ANSI plus background, foreground, cursor, cursor accent, selection) and
  `editor` (editor and syntax colours). The renderer validates it with a schema and rejects
  unknown or malformed colours; it does not repair them. The exact token list is a plan
  deliverable: it must cover every `:root` token in DL §2 that derives today.
- **THM-2 Switching.** Selecting a theme sets every chrome, terminal and editor token with no
  component change. A theme never reads another theme's values. The first paint after launch
  uses the stored theme with no flash of a different one.
- **THM-3 Built-in set.** The new set contains at least one dark and one light theme, is
  designed against THM-1, and is reviewed by eye in the gallery before it ships (decision 2).
  The set is fixed by [decision 6](#resolved-decisions).
- **THM-4 Migration.** A stored `themeId` or `colorOverrides` that no longer resolves falls
  back to the default theme for the stored mode. Nothing is written over an unreadable
  `settings.json` (the existing write lock still applies). The retired `colorOverrides` key is
  dropped on the next write like the three keys `settings-merge.ts` already drops.
- **THM-5 Picker.** The Appearance section lists themes in Light and Dark groups, each row
  with a swatch chip of the theme's own colours and its name, plus a Custom group for
  imported themes. Keyboard: arrows move, Enter selects; the row is announced by name.
- **THM-6 Follow system.** A "System" choice applies one chosen light theme and one chosen
  dark theme and switches when the operating system's appearance changes, with no restart.
- **THM-7 Import.** Import accepts a `.json` file up to 256 KB. Outcomes are reported
  distinctly: file too large, not parseable, schema failure with the first problem named,
  id already used by a built-in (refused), id already used by an imported theme (updated, and
  the count says so). A partial success reports what was skipped.
- **THM-8 Export and starter.** The user can export any theme as a file and download a
  starter file built from the active theme.
- **THM-9 Token editor.** The user can duplicate a theme and edit its tokens with a live
  preview of chrome, terminal and editor. Built-in themes are read-only; the editor works on
  a custom copy. Each token can be reset to the value it had when the copy was made.
- **THM-10 Contrast.** DL-3.5's text floors (`--text-primary` 8:1, `--text-muted` 6:1,
  `--text-faint` 4.5:1) hold for every built-in theme and stay tested. An imported or edited
  theme that misses a floor is accepted, shows a warning naming the failing tokens, and is
  never silently altered.

### B. Settings spine, search and deep links

Today: ten categories, no search, no link to a setting, the last category is not kept across
launches ([`active-category-store.ts`](../../src/ui/settings/active-category-store.ts)).
A reference app keeps a hand-written search registry of about 100 entries; its maintenance cost
is the thing to avoid.

- **SET-1 Registry.** One renderer registry describes every setting: key, page, group, label,
  keywords, default, scope (preference, layout or data) and whether a change reaches existing
  or only new sessions. Search, change marks, page reset and deep links read it. A test fails
  when a `Settings` key has no registry entry or a registry entry has no key.
- **SET-2 Search and Command.** The selected target is Command navigation (owner decision
  2026-10-20): search reaches live setting rows, agent fields, shortcuts and areas, with page
  chips, a Frequent group, a Changed scope and per-row reset. Queries have an explicit empty
  state; arrows, Enter, Escape and scope backspace work without intercepting IME composition.
  The existing searchable category rail remains the baseline until the Command wave replaces
  it. Results read real stores/registry data, never the gallery's in-memory demo model.
- **SET-3 Deep links.** Every setting and page has an id. Code can open Settings at a page or
  scroll to and highlight a row. Entry points: the agent picker and launch page "manage
  agents" (today they set only the category), a "Settings…" link on toasts and banners that
  concern a setting, and the command surface. ⌘, reopens the last page for the session.
- **SET-4 Page anatomy.** Changed rows carry a mark. The page head shows how many rows changed
  and a "Reset page" action. The Command view keeps scope-aware reset and changed feedback.
  Appearance follows the [migration specification](2026-10-21-shadcn-base-ui-migration.md),
  not the old Studio density. The owner reviews the real-component specimen before acceptance.

### C. Terminal and editor typography

Today: the terminal has `lineHeight: 1.25`, `cursorStyle: "bar"` and `cursorBlink: true`
hard-coded ([`pane.ts`](../../src/terminal/pane.ts) lines 217–232); font family and size are
shared by terminals and the built-in editor; `minimumContrastRatio` is deliberately unset
(pane.ts lines 258–262: it flattens agent TUIs' dim text).

- **TYP-1 Terminal options.** Line height, letter spacing, font weight, cursor style
  (block, bar, underline) and cursor blink become settings with validated ranges, and apply to
  open terminals without a restart.
- **TYP-2 Separate editor typography.** The built-in editor gets its own font family, size and
  line height. Terminal zoom actions keep working on the terminal only; an editor zoom is
  decided in the plan.
- **TYP-3 Live preview.** Each surface has a preview that reflects the draft values before
  they are committed.
- **TYP-4 Missing font.** If the chosen font is not installed, a banner under the preview says
  so and names the fallback. The check does not run during typing.
- **TYP-5 Per-surface reset.** A reset appears for a surface only while it differs from its
  defaults.
- **TYP-6 Invalid input.** A numeric field out of range or off-step shows its allowed range
  and keeps the draft until fixed or discarded; it never reverts without saying so.
- Ligatures and a minimum contrast ratio are out, per [Resolved decisions](#resolved-decisions): the
  first needs a new dependency and the second reverses a recorded choice.

### D. Notifications

Today: one switch for agent notifications, which requests OS permission
([`notifications-section.tsx`](../../src/ui/settings/sections/notifications-section.tsx));
the native alert is sent from [`native-notification.ts`](../../src/lib/native-notification.ts)
through the host (`electron/ipc/register-shell.ts`).

- **NTF-1 Rules.** The user chooses when a turn-complete alert fires (never, only when Deck is
  in the background, always) and separately switches needs-input and permission alerts.
- **NTF-2 Sound.** A sound can be turned off, its volume set, and one of a small bundled set
  chosen. A "Send test" action plays and notifies with the current choice.
- **NTF-3 Permission state.** The page shows whether the OS permits notifications and, when it
  does not, says so and offers to open the operating system's notification settings.
- **NTF-4 Custom sound.** Choosing a user file (`.mp3`, `.wav` or `.ogg`, size-limited) is
  bundled sounds only, per [Resolved decisions](#resolved-decisions); a user file is out of scope.

### E. Feedback and safety

- **FBK-1 Save status.** The Settings header shows Saving, Saved or "Couldn't save" with a
  retry that re-sends the failed keys' current values, never a stale patch. Autosaved free-text
  fields report their own state.
- **FBK-2 Shortcut recording.** A chord the terminal reserves is refused with the reason. A
  chord the operating system reserves is saved with a warning. A conflict offers Reassign.
  Backspace or Delete unbinds, and the recorder says so. "Reset all" asks first.
- **FBK-3 Honest reset.** Restore defaults lists what it resets and what it keeps. It offers
  preferences and layout separately, and a page reset affects only that page's keys.
- **FBK-4 Destructive actions.** Removing an agent or a saved command, and resetting
  everything, is confirmed. The confirmation names what is lost.
- **FBK-5 Theme feedback.** A theme change applies at once and needs no toast; a failed
  import or write is reported through THM-7 and FBK-1.

### F. Per-project overrides

Today: settings are global; `workspaces.json` and `repositories.json` hold per-workspace and
per-repository state but no preferences. This area is the largest and is not yet shaped: it
cannot be planned until its two open items in [Resolved decisions](#resolved-decisions) are answered.

- **PRJ-1 Scope.** A project (repository) can override a small named set of settings; every
  other setting stays global. The override shows its inherited value and a "Reset to
  inherited" action.
- **PRJ-2 Candidate keys.** Default worktree folder, default agent and setup behaviour are the
  candidates; the owner chooses the set.
- **PRJ-3 Trust.** An override that runs a command or changes a path is not applied until the
  user has trusted that project.

### G. Base components (ownership transferred, 2026-10-21)

The [Deck-wide migration specification](2026-10-21-shadcn-base-ui-migration.md) is the sole
owner of this scope. Earlier BASE IDs remain as cross-reference aliases, not competing rules:

| Earlier ID      | Owning requirement                                                |
| --------------- | ----------------------------------------------------------------- |
| BASE-1 / BASE-2 | UI-1 / UI-4: official preset components and one shared definition |
| BASE-3          | UI-7: accessible composition and keyboard behavior                |
| BASE-4          | UI-11 / AC-3: reference specimens and owner eye review            |
| BASE-5 / BASE-6 | UI-8 / UI-9: whole-app waves, Settings first                      |
| BASE-7          | UI-2 / UI-3: independent preset tokens and controlled coexistence |
| BASE-8          | UI-5 / AC-2: Base UI through Deck's renderer and Electron         |

The old Radix spike is historical evidence only. Its "remove shadcn defaults to satisfy
Deck's styles" conclusions do not apply to this migration.

## Constraints

- **Component and visual forks.** Base UI and the selected preset are approved by the owner
  on 2026-10-21. The [owning migration spec](2026-10-21-shadcn-base-ui-migration.md#approved-forks-and-hard-stops)
  names dependency/visual-policy changes and remaining hard stops. Do not strip stock shadows,
  translucency, sizes or custom selects merely to reproduce old Deck rules.
- **Theme product work.** THM-1/2/3's custom chrome design and THM-9's chrome token editor are
  deferred while the preset migration runs; they cannot remap shadcn back to Deck tokens.
  Existing stored themes, terminal palettes and editor colors remain intact. Reconcile the
  future theme product design with the owning migration spec before implementing it.
- **Demo surface.** Every UI slice is first built as gallery specimens (the gallery already
  carries `settings-explore` explorations) and reviewed by eye before integration.
- **E2E gate.** Slices that add a user-facing flow end with the `test-deck-app` walk of the
  affected flows in the running Electron app, with an isolated `userData`.
- **No telemetry change.** Nothing here adds an event or a field to the daily snapshot.
- **English only** for strings and docs (R1). Minimal visible text; tooltips carry explanation.
- **Windows.** Every requirement states its Windows behaviour in the plan. Follow-system and
  notification permission need a Windows check before release; none is available today.
- **Security.** An imported theme is data only. Its colour strings are validated before they
  reach CSS or Monaco, and its file is never executed or fetched from a URL.
- **Main stays green.** Each slice passes the `pre-push` set. Per-project overrides touch
  persistence and worktree creation, which AGENTS.md lists as seams; they need a plan and
  cross-boundary verification.

## Out of scope

Not in this spec; candidates for a later one. Each was seen in a reference app or in the
redesign plan:

copy-on-select; file auto-save; a Permissions page; an Experimental flags page; per-agent
environment variables and resume or fork arguments; a terminal daemon session manager; global
settings export and import; a settings CLI; update channel; an in-app language setting
(Deck is English only, R1); cloud accounts, organisations, teams, billing and remote access
(Deck has no backend). Hotkey search and a layout-aware keymap are also left out.

## Resolved decisions

Owner, 2026-10-19. Numbers are the ones the earlier draft used.

1. **Built-in set (THM-3).** Two Deck-authored themes (one dark, one light) plus a short
   curated set of widely liked palettes, each designed token by token, not converted from the
   old presets. The exact palettes are chosen in the T1 plan and reviewed by eye in the gallery.
2. **Token list (THM-1).** Keep the role names of DL §2; each role becomes an explicit theme
   value. No other app's names are adopted.
3. **Derived tones (THM-1).** A theme provides the base tone. Hover and selection washes
   (DL-21) and seams stay formulas on top of it, so they cannot drift between themes.
4. **Ligatures.** Out of this spec; they need a new xterm addon dependency.
5. **Minimum contrast.** Not offered as a setting. Too-dark ANSI colours are handled inside
   theme validation (THM-10).
6. **Custom sound (NTF-4).** Out of this spec. Bundled sounds only.
7. **Per-project overrides (PRJ-1 to PRJ-3).** Stay in this spec and ship last. The two items
   still open are the key set and where overrides live (`workspaces.json`,
   `repositories.json` or a new store). They are decided at the start of P1, after the trust
   model of PRJ-3 is agreed with the owner. P1 is the only slice that may stop for a decision.
8. **Token editor depth (THM-9).** All tokens are editable, grouped by area.
9. **Settings look (updated 2026-10-21).** Official Mira preset `b1a09kDGF`; no Deck-density
   reskin. This supersedes both "keep DL §11" and the subsequent compact shadcn-shape choice.
10. **Component location.** `src/ui/controls/`, under the whole-app migration contract.
11. **Tailwind.** Independent preset tokens and isolation from legacy CSS, as UI-2/UI-3 define.
12. **Headless primitives.** Base UI, explicitly confirmed 2026-10-21. React Aria and the earlier
    Radix proposal are not selected. Preact compatibility is a gate, not an assumption.
13. **Generated dependencies.** Use what the pinned official preset requires; do not force an
    earlier helper-library restriction onto newly generated source.
14. **Settings structure.** Command, selected 2026-10-20; see SET-2. Canvas and Control center
    remain explorations. The implementation is a distinct wave after Settings controls.

Decisions 1–3 above concerning future chrome theme customization are subordinate to the
2026-10-21 migration scope until that product work is explicitly resumed.

### Fork approvals

Given by the owner on 2026-10-19. They cover the work below and nothing wider; a slice whose
plan needs more asks again.

- **DL §2 and §3.** Rewrite DL-2.2, DL-3.5 and DL-3.6 and the §2 token table for explicit
  per-theme tokens, in the same commit as T1, with `derive-colors.test.ts` and the policy
  suites updated with it.
- **Superseded component approvals.** The earlier Radix/native-select/Deck-style conditions
  are replaced by [the 2026-10-21 approved forks](2026-10-21-shadcn-base-ui-migration.md#approved-forks-and-hard-stops).
  The historical spike passed its earlier scope; it does not prove Base UI compatibility.
- **Not approved here:** per-project storage and trust (P1), bundle or signing configuration
  changes beyond the dependencies above, and any sibling repo.

## Delivery slices

This table is the Settings product backlog. The whole-app migration plan owns the active
execution order; do not start T1 or other new product features merely because this older table
says Next. B0a/B0b now refer to the migration record, and Command is its wave 3. P1 still needs
a separate data/trust decision.

| #   | Slice                                        | Covers                     | Depends on                    | Fork                                                                | Status                                                                                           |
| --- | -------------------------------------------- | -------------------------- | ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0a  | B0a Spike (throwaway branch, no merge)       | BASE-8                     | owner decision 5 (2026-10-17) | none; answers the dependency fork with measurements                 | Historical Radix spike completed 2026-10-19; Base UI gate is separate                            |
| 0b  | B0b Base components for Settings             | BASE-1–7                   | B0a passing                   | Superseded by the 2026-10-21 preset approval                        | Replaced by whole-app migration waves 0–2                                                        |
| 1   | T1 Token schema, new built-in set, migration | THM-1–4, THM-10            | none                          | DL §2/§3, approved                                                  | Next                                                                                             |
| 2   | S1 Settings registry and honest reset        | SET-1, SET-4, FBK-3        | none                          | none                                                                | Core Done 2026-10-19 (`ccf87680`); rows outside the editor and shortcuts keep no mark            |
| 3   | S2 Search and deep links                     | SET-2, SET-3               | S1                            | none                                                                | Core Done 2026-10-19 (`462433bd`); toast and banner links, command entry and ⌘, last page remain |
| 4   | T2 Picker and follow system                  | THM-5, THM-6               | T1                            | none                                                                | Waiting on T1                                                                                    |
| 5   | F1 Feedback group                            | FBK-1, FBK-2, FBK-4, FBK-5 | S1                            | none                                                                | Next                                                                                             |
| 6   | Y1 Terminal and editor typography            | TYP-1–6                    | S1                            | none                                                                | Next                                                                                             |
| 7   | N1 Notification rules and sound              | NTF-1–3                    | S1                            | none                                                                | Next                                                                                             |
| 8   | T3 Import, export, starter                   | THM-7, THM-8               | T1                            | none                                                                | Waiting on T1                                                                                    |
| 9   | T4 Token editor                              | THM-9                      | T3                            | none                                                                | Waiting on T3                                                                                    |
| 10  | P1 Per-project overrides                     | PRJ-1–3                    | decision 7 (open items)       | persistence seam; owner decides keys, storage and trust at P1 start | Last                                                                                             |

## Acceptance

The spec is accepted when every slice has met its own checks: the policy suites and the tests beside the changed
files pass; a gallery specimen has been reviewed by eye; and, for user-facing flows, the
`test-deck-app` walk is reported with each flow and its result. A merged slice is not the
acceptance of the spec; the owner's native walk is.
