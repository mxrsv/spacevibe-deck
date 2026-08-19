# Light and dark Settings implementation plan

**Spec**: [2026-08-19-light-dark-settings-design.md](../specs/2026-08-19-light-dark-settings-design.md)
**Goal**: Reduce the visible appearance choice to Light and Dark, then reshape Settings into a calm section header plus grouped rows without deleting legacy theme infrastructure.
**Architecture**: The work has a hard visual gate. A gallery-only proposal is implemented and reviewed first; shipping theme data, controls, and Settings structure change only after owner eye approval. Existing theme parsing and imported files remain intact, while canonical mode selection is a renderer-level preference carried by the existing `themeId` setting.

## 1. Expected outcomes

- The gallery shows the proposed Settings direction in wide and compact frames — verified by owner-approved screenshots from `npm run prototype:gallery`.
- Appearance exposes only Light and Dark while legacy theme infrastructure remains loadable — verified by `npm test -- theme-mode-selector themes custom-themes-store`.
- Every Settings category gains an active title, description, and grouped surface — verified by `npm test -- settings-screen settings-categories`.
- The responsive layout remains usable at the 480px application minimum — verified by the compact gallery frame and CSS contract assertions.
- Documentation matches public behavior — verified by `rg -n "Light|Dark|custom theme|Settings" README.md docs/DESIGN-LANGUAGE.md docs/CONTEXT.md docs/ARCHITECTURE.md`.

## 2. Sources of truth

**Canonical data**: [`ThemePreset`](../../src/settings/themes.ts), [`Settings.themeId`](../../src/settings/settings-schema.ts), and the semantic chrome values returned by [`deriveChromeColors`](../../src/lib/derive-colors.ts).

**Allowed sources**: the approved spec, existing Deck control primitives, existing theme derivation, and the two user-supplied visual references.

**Disallowed sources**: gallery-only CSS in shipping modules, a second theme store, raw component-local chrome colors, or OS appearance APIs for an unapproved `System` mode.

## 3. Business rules and invariants

- **Two visible modes**: Settings renders only Light and Dark — verify no theme-card/import/color override labels exist in the mounted Appearance section.
- **Non-destructive legacy support**: opening Settings performs no write and custom-theme files/parsers remain — verify with a legacy `themeId` mount test and existing custom-theme-store tests.
- **Explicit canonicalization**: clicking a mode writes its canonical id; replacing a legacy custom theme or non-empty `colorOverrides` first requires confirmation — verify with selector interaction tests.
- **Control matches value shape**: boolean → switch, 2–3 equal alternatives → segmented radio, finite technical list → select, bounded number → number input plus stepper, free-form value → validated draft, multi-field edit → explicit atomic action — verify in the gallery before production work.
- **Draft safety**: Enter/valid blur commits, Escape reverts without closing Settings, and invalid values remain editable — verify with keyboard interaction tests.
- **One theme engine**: both presets flow through `resolveTheme`, `deriveChromeColors`, and `applyThemeVars` — verify with theme and theme-vars tests.
- **Gallery isolation**: application modules never import `src/gallery/` — verify with `npm run build` and the existing gallery boundary checks.
- **Neutral Settings chrome**: no accent or semantic palette colour appears in Settings controls; focus, selection, toggles, and step icons use neutral text/hair tokens — verify with CSS contract assertions and rendered review.
- **Eye review before cutover**: no shipping UI or theme data changes before the gallery screenshots are approved.

## 4. Scope

**Build**:

- Gallery-only Settings direction at wide and compact sizes.
- Canonical Light/Dark presets and selection semantics.
- Settings section introduction, grouped surface, responsive rail, and refined rows.
- Tests and required living/public documentation.

**Do not build**:

- `System` mode or OS theme synchronization.
- Theme import removal, parser removal, file migration, or IPC changes.
- A new motion dependency or decorative effects outside current design-language rules.
- Native host verification without a separate owner request.

## 5. Risks and resolved decisions

**Resolved with risk**:

- Legacy theme ids remain untouched until the user chooses Light or Dark — risk: the selected segment can describe the legacy theme's luminance before it describes the exact canonical palette.
- Choosing a canonical mode clears hidden color overrides — risk: this explicit user action cannot restore those overrides from Settings while the advanced controls are hidden.
- The old gallery and import implementation remains in the bundle for temporary reversibility — risk: code remains maintained without a visible entry point.
- Settings introduces a scoped 24px structural heading and a binary segmented value kind — risk: both amend the currently closed DL-4.5 and DL-5/6 sets and therefore require ledger updates.

## 6. Tasks

### Task 1: Build the isolated direction specimen

**Files**:

- [settings-direction.tsx](../../src/gallery/sections/settings-direction.tsx)
- [settings-direction.css](../../src/gallery/sections/settings-direction.css)
- [section-registry.ts](../../src/gallery/section-registry.ts)
- [main.tsx](../../src/gallery/main.tsx)

**Decision**: Assemble a gallery-only Settings interaction harness from real Deck icons and config-row primitives, using the two explicit palette seeds from the spec and separate wide/compact frames.

**Build**:

- Render representative Appearance, Terminal, Agents, and Shortcuts categories plus the Reset confirmation flow.
- Exercise switch, segmented radio, select, bounded number, validated text draft, explicit multi-field action, file action, async action, and destructive confirmation treatments.
- Add Light/Dark harness switching without writing the production settings store.
- Keep every gallery interaction local and make category changes apply to both wide and compact frames for direct comparison.
- Import the gallery-only stylesheet from the gallery entry and register the new review section.
- Ensure the specimen stylesheet owns only framing/proposal treatment and cannot enter the shipping bundle.

**Verify**:

- `npm test -- settings-categories` → existing category contracts remain green.
- `npm run build` → the shipping renderer builds without importing gallery code.
- `rg -n "gallery/" src --glob '!gallery/**'` → no shipping import points at the new specimen.

---

### Task 2: Render the direction for owner eye review

**Files**:

- [settings-direction.tsx](../../src/gallery/sections/settings-direction.tsx)
- [settings-direction.css](../../src/gallery/sections/settings-direction.css)

**Depends on**: Task 1

**Decision**: The owner reviews every representative category in Light and Dark at wide and compact widths before any production Settings file changes.

**Build**:

- Ask for explicit permission before starting `npm run prototype:gallery` or opening a browser.
- Capture the full wide/compact proposal in both modes without using browser-only evidence as native-host evidence.
- Apply only owner-requested treatment adjustments to the gallery proposal and repeat the screenshots.

**Verify**:

- Owner explicitly approves the rendered direction in conversation.
- Appearance, Terminal, Agents, Shortcuts, and Reset are reviewable in Light wide, Light compact, Dark wide, and Dark compact states.

---

### Task 2A: Lock the production interaction foundation

**Files**:

- [settings-screen.tsx](../../src/ui/settings/settings-screen.tsx)
- [settings-screen.test.tsx](../../src/ui/settings/settings-screen.test.tsx)
- [config-row.tsx](../../src/ui/controls/config-row.tsx)

**Depends on**: Task 2

**Decision**: Port the approved control contracts before individual categories: contain focus in Settings, separate field Escape from screen Escape, and prevent edits while the initial settings snapshot is loading.

**Verify**:

- Keyboard tests prove focus cannot reach the obscured app, Escape reverts an active draft before it can close Settings, and loading state cannot overwrite a user edit.

---

### Task 3: Add canonical theme modes

**Files**:

- [themes.ts](../../src/settings/themes.ts)
- [themes.test.ts](../../src/settings/themes.test.ts)
- [settings-schema.ts](../../src/settings/settings-schema.ts)
- [settings-schema.test.ts](../../src/settings/settings-schema.test.ts)

**Depends on**: Task 2

**Decision**: Add `deck-light` and `deck-dark`, default new settings to `deck-dark`, and retain all legacy presets/custom preset lookup paths.

**Build**:

- Add the eye-approved palette values as immutable theme objects.
- Add a pure mode classifier based on canonical id or resolved background luminance.
- Keep legacy ids valid and preserve custom preset loading without automatic store writes.
- Change only the new-install default id.

**Verify**:

- `npm test -- themes settings-schema derive-colors theme-vars` → both canonical themes resolve, meet chrome contrast floors, and legacy ids remain readable.
- Test `validateSettings` with a legacy built-in id and imported-style id → ids survive validation unchanged.

---

### Task 4: Implement the Light/Dark control

**Files**:

- [theme-mode-selector.tsx](../../src/ui/settings/theme-mode-selector.tsx)
- [theme-mode-selector.test.tsx](../../src/ui/settings/theme-mode-selector.test.tsx)
- [appearance-section.tsx](../../src/ui/settings/sections/appearance-section.tsx)

**Depends on**: Tasks 2A and 3

**Decision**: Replace the visible gallery, import actions, theme folder, and color override rows with one accessible binary segmented radio group; leave their implementation files intact and unimported by Appearance.

**Build**:

- Map legacy active themes to a segment by resolved background luminance without writing on mount.
- On click or Left/Right navigation, write the canonical mode id; confirm before clearing a legacy custom selection or non-empty `colorOverrides`.
- Keep labels, focus, and selected state available without color alone.
- Keep only appearance-shaped controls in Appearance; move terminal-specific font and renderer controls to Terminal during the later category port.

**Verify**:

- `npm test -- theme-mode-selector theme-gallery settings-screen` → the selector interaction cases pass and Appearance contains none of the hidden advanced-theme actions.
- Test opening with a legacy id → no `updateSettings` call until the user acts.

---

### Task 5: Add section metadata and content hierarchy

**Files**:

- [settings-categories.ts](../../src/ui/settings/settings-categories.ts)
- [settings-categories.test.ts](../../src/ui/settings/settings-categories.test.ts)
- [settings-screen.tsx](../../src/ui/settings/settings-screen.tsx)
- [settings-screen.test.tsx](../../src/ui/settings/settings-screen.test.tsx)

**Depends on**: Task 2

**Decision**: Every category registry item owns a concise description; Settings renders the active label and description above one grouped content surface.

**Build**:

- Extend category entries with English descriptions.
- Add semantic heading/description markup and a content-surface wrapper around the active section.
- Preserve loading/error, tabpanel linkage, Escape handling, focus return, and section scrolling.

**Verify**:

- `npm test -- settings-categories settings-screen` → every category renders its matching title/description and existing focus/error contracts remain green.
- Test heading association → the active tabpanel remains labelled by the active category tab.

---

### Task 6: Apply the approved Settings treatment and responsive layout

**Files**:

- [11-settings-screen.css](../../src/styles/11-settings-screen.css)
- [07-config-rows.css](../../src/styles/07-config-rows.css)

**Depends on**: Tasks 4 and 5

**Decision**: Port the approved gallery values into shipping CSS, using semantic tokens, one structural surface edge, and an icon-only rail at compact width.

**Build**:

- Apply the approved header, measure, grouped-surface, row rhythm, and segmented-control treatment.
- Add compact behavior that keeps the 480px application minimum readable.
- Preserve percentage-size box sizing and reduced-motion scope requirements.
- Keep every Settings state on the neutral text/tone/hair ladders and add no shadow; palette accent and semantic status colours remain outside this surface.

**Verify**:

- `npm test -- settings-screen theme-mode-selector` → structural class and accessibility assertions pass.
- `npm run build` → TypeScript and renderer bundle succeed.
- Compare shipping Settings against the approved gallery screenshots; record any browser/native evidence limits.

---

### Task 7: Update product and design records

**Files**:

- [README.md](../../README.md)
- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)
- [CONTEXT.md](../CONTEXT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

**Depends on**: Task 6

**Decision**: Record the two-mode public behavior, the scoped structural heading, the binary segmented value kind, the hidden legacy infrastructure, and the owner-approved fork.

**Build**:

- Replace the README's four-theme/customization claim with the Light/Dark surface and legacy-support boundary.
- Amend DL-4.5, DL-5/6, DL-11, and retire DL-24 from the visible Settings contract without deleting its historical record.
- Update current context and move the resolved design fork into the architecture ledger.
- Preserve relative code anchors and update any anchor whose behavioral claim changed.

**Verify**:

- `rg -n "Light|Dark|ThemeGallery|custom theme|segmented" README.md docs/DESIGN-LANGUAGE.md docs/CONTEXT.md docs/ARCHITECTURE.md` → current and historical claims are distinguished.
- `npm test -- design-language` → design-language contracts pass.

---

### Task 8: Run final verification and hand off visual gaps

**Files**:

- [settings-screen.test.tsx](../../src/ui/settings/settings-screen.test.tsx)
- [theme-mode-selector.test.tsx](../../src/ui/settings/theme-mode-selector.test.tsx)

**Depends on**: Task 7

**Decision**: Automated evidence covers behavior and build integrity; only owner-reviewed rendered evidence covers appearance, and no native host claim is made without native execution.

**Build**:

- Run targeted tests first, then the full suite and production build.
- Review `git diff --check`, new-file references, and the exact scoped diff without touching unrelated files.
- Report browser gallery, Electron, and Tauri evidence separately.

**Verify**:

- `npm test` → full Vitest suite passes.
- `npm run build` → shipping renderer bundle passes.
- `git diff --check` → no whitespace errors.
- `git status --short` → only task files plus the owner's pre-existing untracked files remain.
