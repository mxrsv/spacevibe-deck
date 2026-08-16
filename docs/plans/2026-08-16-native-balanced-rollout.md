# Native balanced design rollout

**Contract**: [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)
**Reviewed specimens**: [treatment-direction-review.tsx](../../src/gallery/sections/treatment-direction-review.tsx), [matrix-section.tsx](../../src/gallery/sections/matrix-section.tsx), and [chrome-section.tsx](../../src/gallery/sections/chrome-section.tsx)
**Goal**: Promote the owner-selected Native balanced treatment, 8 / 6 / 4.5 text contrast ladder, and Woven Flag banner from the Gallery into Deck's shared shipping renderer.
**Architecture**: Keep the existing Preact components and make the shared design contract explicit through semantic CSS variables and `deriveChromeColors`. Do not add a base-component layer or Electron-only stylesheet: Electron and Tauri continue to consume the same renderer, while Electron is the native visual acceptance surface for this task. Gallery-only proposal code is removed only after the shipping implementation becomes its source of truth.

## 1. Expected outcomes

- Primary, muted, and faint text clear minimum contrast ratios of 8:1, 6:1, and 4.5:1 against every permitted chrome surface — verified by `npm test -- src/lib/derive-colors.test.ts`.
- Standard chrome text uses the Native balanced 14 / 12.5 / 11 / 10.5px hierarchy through named semantic variables — verified by `npm test -- scripts/design-language.test.ts` and computed-style inspection in the Gallery.
- Ordinary UI text uses sentence case without artificial tracking; glyph geometry is the only allowed non-zero `letter-spacing` exception — verified by `npm test -- scripts/design-language.test.ts`.
- `SidebarBanner` ships the Woven Flag treatment for built-in and custom artwork — verified by `npm test -- src/ui/sidebar-banner.test.tsx` and the native Electron screenshot.
- Theme changes alter colors only; geometry, typography, and component structure remain identical across all four built-in themes — verified in `npm run prototype:gallery` and by the contrast matrix.
- The final Electron renderer is visually reviewed in the real application at normal and compact widths — verified through screenshots from `npm run electron:dev`.

## 2. Sources of truth

**Canonical contract**: [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md), the semantic variables in [styles.css](../../src/styles.css), and the derived colors returned by [derive-colors.ts](../../src/lib/derive-colors.ts).

**Allowed input**: The selected Gallery specimens and their measured values: Native balanced geometry and type hierarchy, 8 / 6 / 4.5 contrast floors, and Woven Flag.

**Not allowed as shipping input**: `--gx-*` aliases or imports from `src/gallery/`; Gallery remains a dev-only review surface and cannot become a second runtime design system.

## 3. Rules and invariants

- **Shared renderer**: No host-specific CSS fork is introduced; both hosts receive the visual change from [styles.css](../../src/styles.css).
- **Theme boundary**: Themes provide colors only. Components, type roles, spacing, radii, and layout do not branch by theme.
- **Text ladder**: `--text-primary`, `--text-muted`, and `--text-faint` remain ordered and visually distinct after meeting their floors.
- **Role-based type**: Standard title, body, metadata, and microcopy sizes come from named variables rather than repeated literals.
- **No styled uppercase or tracking**: Ordinary textual selectors cannot use `text-transform: uppercase` or non-zero `letter-spacing`; the pane anchor grip may retain glyph spacing because it shapes an icon-like control, not readable copy.
- **Gallery dependency direction**: Shipping modules never import Gallery modules; the Gallery may consume shipping tokens and components.
- **Navigation structure stays stable**: This rollout changes the active navigation's treatment through shared tokens, not its information architecture, ordering, or interaction behavior.

## 4. Scope

**Included**:

- Shared text contrast derivation and tests.
- Shared Native balanced type-role variables and migration of shipping chrome text.
- Removal of styled uppercase and artificial text tracking from shipping UI.
- Woven Flag as the documented and tested `SidebarBanner` treatment.
- Gallery cleanup after the selected values become production truth.
- Electron native visual review at normal and compact widths.

**Excluded**:

- New base UI components or a component-library migration.
- Navigation model, row ordering, status semantics, or tab behavior changes.
- Terminal font, xterm canvas colors, PTY behavior, or host IPC changes.
- New themes, light-theme certification, animations, or dependency additions.
- Electron/Tauri cutover, packaging, signing, updater, or release changes.

## 5. Risks and closed decisions

**Closed decisions with risk**:

- The stylesheet is shared, so Tauri also receives the visual update even though Electron is the requested native review target. The implementation must report Tauri native appearance as unverified unless it is actually launched and reviewed.
- Raising primary and muted contrast makes supporting information more visible across every theme. The three-role hierarchy must remain ordered and distinct rather than converging toward one color.
- Removing tracking changes measured text widths. Compact-width review must catch clipping in the frame, rail, tabs, status bar, settings rows, and overlays.

**Open decisions**:

- None. The owner selected Native balanced, the 8 / 6 / 4.5 ladder, and Woven Flag in the Gallery before authorizing this rollout.

## 6. Tasks

### Task 1: Amend the shared visual contract

**Files**:

- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)
- [design-language.test.ts](../../scripts/design-language.test.ts)

**Decision**: Native balanced and the 8 / 6 / 4.5 ladder become app-wide rules; readable UI copy has no styled uppercase or artificial tracking.

**Build**:

- Update the color-role and typography rules with the selected contrast floors and 14 / 12.5 / 11 / 10.5px standard hierarchy.
- Retire the uppercase/tracking exception for the usage eyebrow and document the pane anchor grip as glyph geometry rather than copy.
- Add stylesheet policy assertions rejecting uppercase transformation and non-zero tracking outside the explicit glyph exception.

**Verify**:

- `npm test -- scripts/design-language.test.ts` → all design-language policy tests pass.
- Policy test `rejects styled uppercase and text tracking` passes with only the pane-anchor glyph selector allowlisted.

---

### Task 2: Promote the contrast ladder into production derivation

**Files**:

- [derive-colors.ts](../../src/lib/derive-colors.ts)
- [derive-colors.test.ts](../../src/lib/derive-colors.test.ts)

**Dependencies**: Task 1

**Decision**: Production derives primary, muted, and faint text at 8:1, 6:1, and 4.5:1 against their permitted surfaces.

**Build**:

- Name the three floors as constants and use them in `deriveChromeColors`.
- Raise primary and muted colors toward `tone` without changing the ordering algorithm or surface set.
- Strengthen test assertions to the selected floors for presets, low-contrast overrides, and light overrides.

**Verify**:

- `npm test -- src/lib/derive-colors.test.ts` → every contrast and ladder-order case passes.
- Test `keeps the three tones visually distinct on every preset` remains green.

---

### Task 3: Establish Native balanced typography variables

**Files**:

- [styles.css](../../src/styles.css)
- [design-language.test.ts](../../scripts/design-language.test.ts)

**Dependencies**: Task 1

**Decision**: Standard chrome typography uses named title, body, metadata, and microcopy sizes of 14, 12.5, 11, and 10.5px.

**Build**:

- Add four semantic type-size variables beside `--ui-font` in `:root`.
- Add assertions that lock their values and prevent a second standard type ladder.
- Keep exceptional display figures and icon geometry outside the standard ladder only where `DESIGN-LANGUAGE.md` already names the exception.

**Verify**:

- `npm test -- scripts/design-language.test.ts` → Native balanced token assertions pass.
- `rg -n -- "--type-(title|body|meta|micro)" src/styles.css` → exactly one declaration set exists and shipping selectors consume it.

---

### Task 4: Migrate frame, tabs, panes, and status typography

**Files**:

- [styles.css](../../src/styles.css)

**Dependencies**: Task 3

**Decision**: Frame actions, tab strip, pane bar, and status bar use the shared type roles without changing their DOM or behavior.

**Build**:

- Replace standard font-size literals in the frame, tab, pane, and status selectors with the matching semantic variables.
- Remove readable-text tracking while preserving the pane anchor grip's glyph spacing.
- Preserve truncation, hit targets, focus treatment, tab states, and status marks.

**Verify**:

- `npm test -- src/ui/tab-strip.test.tsx src/ui/status-bar.test.tsx` → frame-adjacent component tests pass.
- Gallery computed styles show 12.5px body, 11px metadata, and 10.5px microcopy in the real `DesktopChrome` frame.

---

### Task 5: Migrate repository and agent navigation typography

**Files**:

- [styles.css](../../src/styles.css)

**Dependencies**: Task 3

**Decision**: Repository, worktree, and agent rows receive Native balanced typography without changing the selected navigation model.

**Build**:

- Map repository labels, row names, branches, paths, agent labels, status copy, and overflow copy to the matching type roles.
- Remove readable-text tracking while preserving row truncation and status-mark geometry.
- Preserve row ordering, pinned-state behavior, status semantics, and all callbacks.

**Verify**:

- `npm test -- src/ui/repository-rail.test.tsx src/ui/worktree-agent-stack.test.tsx` → navigation component tests pass.
- Compact Gallery window shows no clipped agent or worktree labels and no horizontal overflow.

---

### Task 6: Migrate boards, overlays, browser, and document chrome

**Files**:

- [styles.css](../../src/styles.css)

**Dependencies**: Task 3

**Decision**: Open board, quick picker, history rows, prompts, browser controls, file surface, and dialogs follow the same hierarchy and sentence-case treatment.

**Build**:

- Map standard titles, row labels, metadata, and hints to the Native balanced variables.
- Remove uppercase presentation and tracking from recents and worktree-form labels while preserving proper nouns and acronyms.
- Keep unique screen headings only where their larger size is structural rather than an accidental local default.

**Verify**:

- `npm test -- src/open-board/open-board.views.test.tsx src/prompts/prompt-popover.test.tsx src/browser/browser-panel.test.tsx` → focused surface tests pass.
- Compact Gallery window shows no clipped labels or horizontal overflow in these surfaces.

---

### Task 7: Migrate settings typography

**Files**:

- [styles.css](../../src/styles.css)

**Dependencies**: Task 3

**Decision**: Settings rows, navigation, values, descriptions, and headings use the shared Native balanced hierarchy.

**Build**:

- Map config labels, descriptions, values, category labels, and screen titles to semantic type variables.
- Remove ordinary tracking while retaining tabular numerals for values and shortcut chords.
- Preserve control geometry, focus behavior, error presentation, and settings category behavior.

**Verify**:

- `npm test -- src/ui/settings/settings-screen.test.tsx src/ui/settings/settings-categories.test.ts` → settings tests pass.
- Settings Gallery specimen shows the four type roles without clipped values or descriptions.

---

### Task 8: Migrate usage typography and sentence case

**Files**:

- [styles.css](../../src/styles.css)
- [overview-section.tsx](../../src/ui/usage/sections/overview-section.tsx)
- [overview-section.test.tsx](../../src/ui/usage/sections/overview-section.test.tsx)

**Dependencies**: Task 3

**Decision**: Usage uses the shared hierarchy; the former uppercase/tracked usage eyebrow becomes sentence-case microcopy.

**Build**:

- Map usage table titles, headers, rows, and metadata to the matching semantic type variables.
- Change `RAW TOKEN COST` to `Raw token cost` and remove the eyebrow tracking exception.
- Preserve the 40px display figure and tabular numerals as documented display/data exceptions.

**Verify**:

- `npm test -- src/ui/usage/usage-screen.test.tsx src/ui/usage/sections/overview-section.test.tsx` → usage tests pass.
- `rg -n "text-transform:\\s*uppercase|letter-spacing:" src/styles.css` → only the documented pane-anchor glyph exception remains.

---

### Task 9: Make Woven Flag the durable banner treatment

**Files**:

- [sidebar-banner.tsx](../../src/ui/sidebar-banner.tsx)
- [sidebar-banner.test.tsx](../../src/ui/sidebar-banner.test.tsx)
- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md)

**Dependencies**: Task 1

**Decision**: Built-in and custom sidebar artwork share the Woven Flag texture, shallow fold light, matte color, and existing fade into the rail.

**Build**:

- Keep one banner component and one treatment class; do not introduce theme-specific banner variants.
- Record the treatment in the design contract and ensure both preset and custom-image branches retain the class.

**Verify**:

- `npm test -- src/ui/sidebar-banner.test.tsx` → disabled, preset, and custom-image cases pass with the Woven Flag class.
- Native Electron screenshot shows the banner fading into the live rail without obscuring navigation.

---

### Task 10: Retire Gallery-only proposal logic after promotion

**Files**:

- [matrix-section.tsx](../../src/gallery/sections/matrix-section.tsx)
- [muted-contrast-candidate.tsx](../../src/gallery/muted-contrast-candidate.tsx)
- [gallery-entry.test.ts](../../scripts/gallery-entry.test.ts)

**Dependencies**: Tasks 2 through 9

**Decision**: The Gallery reads production-derived colors and type tokens directly; it does not keep a second implementation of the selected design.

**Build**:

- Remove the candidate contrast scope and calculate matrix evidence from production `deriveChromeColors` output.
- Read the Native balanced type scale from shipping CSS variables in the real-component specimen rather than restating numeric values in Gallery code.
- Delete the now-redundant candidate module and keep Gallery imports one-way.

**Verify**:

- `npm test -- scripts/gallery-entry.test.ts src/lib/derive-colors.test.ts` → Gallery boundary and production contrast tests pass.
- `npm run prototype:gallery` → the contrast matrix reports 8 / 6 / 4.5 floors for all four built-in themes.

---

### Task 11: Record the completed rollout

**Files**:

- [CONTEXT.md](../CONTEXT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)

**Dependencies**: Task 10

**Decision**: Living docs distinguish shared-renderer implementation evidence from Electron native eye review and unverified Tauri native appearance.

**Build**:

- Add current-code anchors for the type tokens, contrast derivation, and banner treatment.
- Record Electron evidence and explicitly state whether Tauri native review ran.
- Update the mismatch ledger without claiming Windows or packaged-runtime evidence.

**Verify**:

- `bash ~/.claude/scripts/docs-anchors.sh` → all living-document anchors resolve.
- `git diff --check` → documentation and code diffs contain no whitespace errors.

---

### Task 12: Run automated and visual acceptance gates

**Files**:

- No source files; verification only.

**Dependencies**: Task 11

**Decision**: Automated checks establish correctness; Gallery and Electron screenshots establish the visual review surface.

**Build**:

- Run the full minimum completion gate and Electron build.
- Capture Gallery screenshots for the contrast matrix, Native balanced type hierarchy, and Woven Flag.
- Launch Electron with isolated development data and capture normal-width and compact-width screenshots covering navigation, terminal stage, settings, usage, Open board, and overlays.

**Verify**:

- `npm test && npm run build && npm run generate:menu:check && npm run electron:build` → all commands exit 0.
- Screenshots show no clipped copy, accidental uppercase/tracking, hierarchy inversion, banner overlap, or theme-dependent geometry.
- Owner eye review is requested before the visual rollout is called complete.
