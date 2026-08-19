# Light and dark settings redesign

- **Date:** 2026-08-19
- **Status:** Visual and interaction direction approved; gallery review in progress
- **Scope:** the two visible appearance modes and the full-window Settings presentation

## 1. Problem

Deck exposes four built-in terminal palettes, imported theme files, and four color overrides in Appearance. That flexibility makes the first settings category read as a theme workshop instead of a clear application preference, while the Settings content itself is a narrow run of small rows with no section introduction or grouped surface.

The owner wants a calmer product decision: Deck exposes only **Light** and **Dark** for now, and Settings adopts the hierarchy of the supplied references without copying either product's skin.

## 2. Approved direction

The signature concept is **one calm settings document**: the category rail stays, while the content side reads in three layers — section title, short explanation, then one grouped settings surface with compact rows.

- Use the spacious section hierarchy and grouped surface from reference 2.
- Keep the compact, direct row controls from reference 1.
- Appearance exposes exactly `Light` and `Dark`; there is no `System` option.
- The existing theme engine, imported files, parsers, and stored legacy theme data stay in the repository. Their controls are hidden, not deleted.
- The first implementation is a gallery-only review surface. Shipping UI changes wait for owner eye approval of rendered wide and compact screenshots.

## 3. Theme behavior

Two canonical presets become the only visible choices:

- `deck-dark`: neutral near-black chrome with cool neutral ink and a restrained blue interaction accent.
- `deck-light`: soft cool paper chrome with dark neutral ink and the same interaction accent family.

The initial prototype values are explicit review seeds, not silently accepted production values:

### Dark review seed

- background `#17181c`, foreground/cursor `#e5e7eb`, selection `#343842`
- ANSI: black `#202228`, red `#ef6b73`, green `#8ccf7e`, yellow `#e5c07b`, blue `#6f9cff`, magenta `#c792ea`, cyan `#63c5da`, white `#d8dee9`
- bright ANSI: black `#5d6470`, red `#ff7a82`, green `#9bdd8d`, yellow `#f1d18a`, blue `#86adff`, magenta `#d5a3f3`, cyan `#7bd7ea`, white `#ffffff`

### Light review seed

- background `#f5f6f8`, foreground/cursor `#25272c`, selection `#cddcff`
- ANSI: black `#25272c`, red `#b42318`, green `#067647`, yellow `#946200`, blue `#245fca`, magenta `#7a3fb0`, cyan `#087f8c`, white `#d6d9df`
- bright ANSI: black `#6b707a`, red `#d92d20`, green `#079455`, yellow `#b87900`, blue `#3578e5`, magenta `#9656c9`, cyan `#0e94a2`, white `#ffffff`

Legacy behavior is intentionally non-destructive:

- Opening Settings does not rewrite an existing legacy `themeId` or delete imported files.
- A legacy active theme is represented by the Light/Dark segment matching its resolved background luminance.
- Clicking either segment is an explicit conversion to that canonical preset. When a legacy custom theme or non-empty `colorOverrides` would be replaced, Settings confirms the conversion before clearing the hidden overrides.
- New installs default to `deck-dark`.
- Custom-theme loading remains at boot so a legacy imported selection does not break before the owner chooses a canonical mode.

## 4. Settings treatment

### Content hierarchy

- The active category supplies a title and a one-sentence description from the category registry.
- The content column has a readable maximum width and owns scrolling.
- A hairline separates the introduction from the settings surface.
- The settings surface uses one background step plus a 1px structural edge; it has no shadow or decorative blur.

### Type and spacing

- The section title is a scoped 24px structural heading, weight 650, tracking `-0.02em`, line-height `1.1`.
- The section description uses `--type-title`, normal weight, `--text-faint`, line-height `1.5`, and a maximum measure of 58 characters.
- Group labels stay on `--type-title`; row labels and descriptions keep the existing type roles.
- Standard rows gain deliberate vertical room but remain denser than the references: 10px block padding for a row without a description and 12px when a description is present.

### Controls and state

- The mode selector is one binary segmented control with `role="radiogroup"`; each option is a radio and Left/Right arrows move the selection.
- Independent booleans use a neutral switch and save immediately.
- Two or three equal, mutually exclusive choices use a segmented radio group and save immediately.
- Finite or technical lists use a native select; file and folder pickers remain separate verb actions rather than synthetic select options.
- Bounded numeric values use a number input with step controls, while free-form strings keep a local draft and validate before commit.
- A valid text draft commits on Enter or blur; Escape restores the saved value without closing Settings.
- Multi-field creation and editing use explicit Add/Save and Cancel actions so the fields commit atomically. Invalid drafts remain visible with inline guidance.
- Destructive actions require confirmation or an Undo path. Async actions expose pending, success, and failure states in place.
- Cycle buttons are not used in Settings: the visible control must expose the available value shape before the user acts.
- The selected segment uses the existing active wash and a neutral `--hair-strong` edge; focus also stays on the neutral contrast ladder.
- Settings chrome is entirely achromatic: selected values, enabled toggles, step icons, hover, and focus-visible use the neutral `--text-*`, `--tone`, and `--hair-*` ladders. Terminal palette colours and semantic status colours do not enter this surface.
- Hover, focus-visible, disabled, and reduced-motion behavior continue to use Deck's existing neutral state tokens.
- The nav retains icons and labels at normal widths. At compact width it becomes an icon rail with accessible labels retained through `aria-label` and `title`.

### Restraint map

- Loud: the active category title and the selected Light/Dark value, through neutral contrast rather than hue.
- Quiet: descriptions, group labels, inactive navigation, and structural edges.
- No new animation library, illustration, gradient, shadow, or ornamental texture: this is application chrome, and the references derive quality from hierarchy and rhythm rather than spectacle.

## 5. Scope

### In scope

- A gallery-only wide and compact proposal using real Deck control primitives across Appearance, Terminal, Agents, Shortcuts, and Reset flows.
- Two canonical presets and a binary mode selector after eye approval.
- A category title/description registry and grouped content surface for every Settings category.
- Responsive rail/content behavior at Deck's supported narrow widths.
- Theme, settings, accessibility, design-language, and documentation coverage.

### Out of scope

- Deleting theme parsers, the native import host, imported theme files, or legacy preset data.
- Adding `System`, scheduled switching, per-workspace themes, or an automatic OS appearance listener.
- Changing terminal font, renderer, ANSI editing, or any Electron/Tauri IPC contract.
- Native Electron or Tauri launch without separate owner permission.

## 6. Failure modes

- A legacy theme is silently rewritten merely by opening Settings.
- Light/Dark displays one selection while the resolved background belongs to the other luminance class.
- Hidden `colorOverrides` continue changing a canonical mode after the user explicitly chooses it.
- Escape commits a draft or closes Settings while a field is editing.
- Keyboard focus leaves the full-window Settings surface and reaches the obscured application.
- A rejected agent edit disappears on blur or a multi-field agent is partially committed.
- Only Appearance is reviewed at compact width while denser categories remain unproven.
- The compact layout leaves the fixed 220px rail beside an unreadably narrow section.
- The prototype reaches shipping imports, or shipping modules import from `src/gallery/`.
- Typecheck/build success is treated as visual approval without rendered screenshots.

## 7. Done criteria

- Gallery renders Light and Dark at wide and compact widths using the approved treatment, and the owner approves the screenshots by eye.
- Settings exposes only Light and Dark; no theme cards, import action, folder action, or color override rows are reachable from Settings.
- Existing custom-theme files and parsing/loading code remain intact.
- Keyboard and screen-reader semantics cover the category tabs and the mode radio group.
- Theme contrast checks, targeted Settings tests, `npm test`, and `npm run build` pass after the visual gate.
- `README.md`, `docs/DESIGN-LANGUAGE.md`, `docs/CONTEXT.md`, and the resolved-fork ledger in `docs/ARCHITECTURE.md` describe the shipped behavior accurately.
