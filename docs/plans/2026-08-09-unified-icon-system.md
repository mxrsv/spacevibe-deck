# Unified Icon System Implementation Plan

> **Status:** Proposed for user approval. Do not implement until this plan is approved.

**Goal:** Replace the desktop app's inconsistent mix of hand-drawn SVG and action glyphs with one `lucide-preact` icon language, while making Prompt Board's Paste and Send actions visually distinct without changing its injection safety contract.

**Architecture:** Add one small `DeckIcon` presentation primitive over direct, named `lucide-preact` imports. It owns the shared stroke and accessibility defaults while each surface owns semantic icon selection, button labels and tooltips. Migrate functional icons across `src/`; keep brand marks, platform logos, keyboard/terminal notation and bespoke status visuals outside the library. No Rust, PTY, menu registry, persistence or agent-detection behavior changes.

**Tech Stack:** Preact 10, `lucide-preact` 1.30.0, TypeScript, Vitest with jsdom, CSS in `src/styles.css`, Tauri 2 for production-fidelity visual review.

## Approved Design Contract

- `lucide-preact` is the only functional icon source in the desktop app. Install it with `npm install lucide-preact@1.30.0`; `package-lock.json` remains the reproducibility boundary.
- Import named icons directly from `lucide-preact`. Do not import the catalog dynamically and do not deep-import package internals.
- `DeckIcon` owns `aria-hidden="true"`, `focusable="false"`, `fill="none"`, `stroke="currentColor"` and `strokeWidth={1.8}`. The containing button or link owns the accessible name. `1.8` is not a new value: every hand-drawn icon already uses `viewBox="0 0 24 24"` with `stroke-width="1.8"`, which is the same coordinate space Lucide draws in, so stroke weight carries over unchanged.
- Preserve the current control scale: 13px in window chrome, 16px in settings navigation, 15px for Open Board rows, and 14px for compact row actions. Do not make icons a second source of padding or button geometry.
- **CSS beats SVG presentation attributes.** Any rule that sets `width`, `height`, `stroke` or `stroke-width` on an icon element silently overrides `DeckIcon`, so the contract above is only real where such rules do not exist. Today `styles.css` sets all four on `.row__ico` and `.openfolder svg`. Where a surface must theme an icon's color, it sets `color` and lets `currentColor` resolve; it never sets `stroke` directly, and it never sets icon geometry.
- Tests identify an icon by the `lucide-<kebab-name>` class Lucide's factory emits (`class="lucide lucide-settings"`), never by path data and never by the literal glyph it replaced. That class is also what makes the red phase real: the hand-drawn icons already satisfy size, stroke and `aria-hidden`, so an assertion without it would pass before the migration.
- New component tests carry the repo's `// @vitest-environment jsdom` pragma on the first line; there is no `vitest.config.ts` and the default environment is `node`.
- Use icon-only controls only where the action is familiar and already has a visible hover tooltip. Keep text beside icons for consequential or less familiar actions such as Restore Defaults.
- Prompt Board uses `ClipboardPaste` when `autoSend` is off and `Send` when `autoSend` is on. The label and tooltip must describe the actual action. The existing triple safety gate remains authoritative: a Send request that fails the gate still degrades to paste-only.
- Do not force non-icon notation into Lucide. Keep the Deck logo, agent logos, Apple/Windows marks, keyboard legends such as `⌘` and `⏎`, terminal-output characters, selection/status dots and `WorkspaceSpinner` as explicit exceptions.
- The scope is the desktop app under `src/`. Marketing-only controls and illustrations remain outside this migration; shared app components used by the marketing video are regression surfaces and must still be verified.
- The approved dependency, bundle and design-language forks are already recorded in `AGENTS.md`. Any second icon dependency or change to the exception list is a new fork.

## Icon Mapping

Use these semantic mappings rather than choosing icons ad hoc during implementation:

- Window chrome: `Columns2` for vertical split, `Rows2` for horizontal split, `SquareX` for close pane, `Maximize2` for focus expand, `MessageSquareText` for Prompt Board and `Settings` for Settings.
- Settings navigation: `AppWindow` for Appearance, `Palette` for Colors, `SquareTerminal` for Terminal, `Link` for Links Editor, `Bell` for Notifications, `Download` for About/Update and `Bot` for Agents.
- Prompt Board: `ClipboardPaste`, `Send`, `Trash2`, `Plus` and `ChevronDown`.
- Generic compact controls: `X`, `Plus`, `Minus`, `RotateCcw`, `Repeat2`, `Ellipsis`, `ChevronLeft`, `ChevronRight` and `ChevronDown`.
- Open Board: `FolderOpen` for a recent-workspace row, `FolderPlus` for the `Open Folder…` action (its hand-drawn glyph is a folder with a plus, and picking a new folder is the add, not the open), `X` or `Trash2` according to whether the action dismisses or deletes, and `Plus` for a new layout.

Every export listed here was verified present in `lucide-preact@1.30.0`. If one is nevertheless unavailable at implementation time, stop and replace it with the nearest semantic Lucide icon in this plan before writing UI code; do not draw a local substitute.

`AboutIcon` maps to `Download` deliberately: the icon it replaces is an arrow landing on a baseline, documented in `settings-nav-icons.tsx` as "the update, not a generic info circle".

## Baseline and Completion Gates

- Before installing the dependency, run `npm test` and `npm run build`, then record the emitted main JS gzip size from the Vite output in the implementation notes. Measured on 2026-08-09: 96 test files / 1103 tests pass, and `dist/assets/index-*.js` is 608.34 kB raw, **gzip 170.37 kB**.
- The final main JS gzip increase must be at most 15 KiB. A larger increase means the imports or wrapper are pulling unnecessary catalog code and must be investigated before approval.
- `lucide-preact`'s only entry point is a barrel that namespace-imports all 1765 icons. Rollup tree-shakes it in the production build (`sideEffects: false`), which is exactly what the gzip gate above guards. Vitest externalizes `node_modules`, so test workers load the barrel unshaken; watch the `npm test` duration against the recorded baseline and only then consider inlining or pre-bundling the dependency for tests.
- Run focused tests after every task, then the complete `npm test` and `npm run build` gates at the end.
- Run `npm run generate:menu:check` to prove the icon-only change did not drift generated menu code.
- Launch `npm run tauri dev` and capture production-fidelity screenshots or a short recording in all four theme presets. Review the Open Board, both top-tabs and sidebar chrome, Settings and Prompt Board with both Paste and Send templates.
- Build output is not visual approval. The migration is complete only after the user eye-approves the Tauri screenshots or recording.
- Preserve the pre-existing unrelated worktree changes in `marketing/landing-prototype/src/directions/a.js`, `.claude/` and `landing-hero-windows.png`.

### Task 1: Add the icon foundation and dependency

**Files:**

- Create: `src/ui/controls/deck-icon.tsx`
- Create: `src/ui/controls/deck-icon.test.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/DESIGN-LANGUAGE.md`

**Produces:**

- `DeckIconProps` with `icon: LucideIcon`, `size?: 13 | 14 | 15 | 16`, and optional `class`.
- `DeckIcon`, the only component that sets shared Lucide presentation defaults.

- [ ] Run the baseline `npm test` and `npm run build`; save the Vite JS size from the terminal output.
- [ ] Amend the design language before any code contradicts it: DL-1.1 gains the one approved `lucide-preact` exception and DL-11.3 is rewritten around it. Task 7 still owns the general icon rule and the ledger, but the rulebook must not sit in force against the code for six tasks.
- [ ] Write a jsdom test that renders `DeckIcon` with `Settings` and asserts `width`, `height`, `stroke`, `stroke-width`, `aria-hidden`, `focusable` and the `lucide-settings` class.
- [ ] Run `npx vitest run src/ui/controls/deck-icon.test.tsx`; expect failure because the component and dependency do not exist.
- [ ] Run `npm install lucide-preact@1.30.0`.
- [ ] Implement `DeckIcon` with immutable props and no local SVG paths. Pass the Lucide component through the `icon` prop and render it with `size`, `color="currentColor"`, `strokeWidth={1.8}`, `aria-hidden="true"` and `focusable="false"`.
- [ ] Run the focused test; expect it to pass.
- [ ] Run `npm run build` and compare the new JS gzip output with the baseline. Stop if the increase exceeds 15 KiB.

### Task 2: Replace hand-drawn chrome and settings navigation SVGs

**Files:**

- Modify: `src/ui/chrome-actions.tsx`
- Modify: `src/ui/settings/settings-nav-icons.tsx`
- Modify: `src/ui/settings/settings-nav-icons.test.tsx`
- Create: `src/ui/chrome-actions.test.tsx`

`ChromeActions` has no test file today and no other suite renders it, so its assertions need a new home; `tab-bar.test.tsx` and `workspace-sidebar.test.tsx` prove nothing about it.

- [ ] Extend the settings icon test to cover all seven categories and assert that each semantic adapter renders the mapped `lucide-<name>` class at 16px.
- [ ] Write `chrome-actions.test.tsx`: the six accessible button names, their mapped icon classes, `aria-pressed`/`aria-expanded`/`disabled` and one click per handler. Do not test generated SVG paths.
- [ ] Run the focused tests and capture the expected failure — the icon-class assertions are what go red, since size, stroke and `aria-hidden` already match.
- [ ] Delete all six local icon functions from `chrome-actions.tsx`. Import the approved Lucide components by name and render them through `DeckIcon` at 13px.
- [ ] Retain the semantic exports in `settings-nav-icons.tsx` so `settings-categories.ts` does not learn library details. Replace their local paths with the approved Lucide mapping through `DeckIcon` at 16px.
- [ ] Preserve existing button order, shortcuts, disabled state, `aria-pressed`, `aria-expanded`, tooltips and event handlers.
- [ ] Run `npx vitest run src/ui/settings/settings-nav-icons.test.tsx src/ui/chrome-actions.test.tsx src/ui/tab-bar.test.tsx src/ui/workspace-sidebar.test.tsx`; expect pass.

### Task 3: Make Prompt Board Paste and Send immediately distinguishable

**Files:**

- Modify: `src/prompts/prompt-popover.tsx`
- Modify: `src/prompts/prompt-popover.test.tsx`
- Modify: `src/styles.css`

- [ ] Add component tests for an `autoSend: false` template and an `autoSend: true` template. Assert accessible names `Paste <label>` and `Send <label>`, distinct Lucide icon markers, and the existing `inject(..., autoSend)` boolean.
- [ ] Keep the current degraded result copy: an attempted Send that returns `pasted` still reports `Pasted — not sent`.
- [ ] Run `npx vitest run src/prompts/prompt-popover.test.tsx`; expect the new semantic assertions to fail against the shared `↩` action and the `Inject <label>` name it carries today.
- [ ] Render `ClipboardPaste` for paste-only templates and `Send` for auto-send templates through `DeckIcon` at 14px.
- [ ] Change the title to `Paste into the focused pane` or `Send to the focused pane` according to `autoSend`; change the accessible name in the same way.
- [ ] Keep the row's `auto` chip, which the new `Send` icon makes partly redundant. It stays because word and icon carry the flag at different distances: the chip is legible while scanning a list of templates, a 14px pictogram is not, and dropping it would leave the only durable signal of a template that presses Enter to a shape difference at chrome scale. Revisit it in visual review (Task 8), not by assumption here.
- [ ] Replace the template remove `×`, draft `+` and picker `▾` with `Trash2`, `Plus` and `ChevronDown`. Preserve visible text `add` while a draft is open.
- [ ] Adjust only icon alignment in the existing Prompt Board selectors; do not reshape the popover or change its injection flow.
- [ ] Run the focused Prompt Board test; expect pass.

### Task 4: Migrate reusable settings and row-control glyphs

**Files:**

- Modify: `src/ui/controls/color-row.tsx`
- Modify: `src/ui/controls/font-row.tsx`
- Modify: `src/ui/controls/editor-row.tsx`
- Modify: `src/ui/controls/logo-row.tsx`
- Modify: `src/ui/settings/sections/agents-section.tsx`
- Modify: `src/ui/settings/sections/appearance-section.tsx`
- Modify: `src/ui/settings/sections/reset-section.tsx`
- Modify: `src/ui/settings/sections/terminal-section.tsx`
- Modify: existing tests beside those components
- Modify: `src/styles.css`

- [ ] Update tests to query controls by accessible name and verify their semantic Lucide icon, not literal glyph text.
- [ ] Run the focused control and settings tests; expect the new assertions to fail.
- [ ] Replace reset glyphs with `RotateCcw`, cycling `↹` hints with `Repeat2`, overflow with `Ellipsis`, dropdown disclosure with `ChevronDown`, remove with `X`, add with `Plus`, and step controls with `Plus`/`Minus`.
- [ ] Keep `reset` and Restore Defaults text visible. Icons supplement these labels rather than replacing them.
- [ ] Preserve every existing value, disabled rule, commit behavior, tooltip and focus-visible rule.
- [ ] Consolidate only repeated icon alignment declarations in `styles.css`; do not alter row geometry.
- [ ] Run the focused tests for `src/ui/controls/` and `src/ui/settings/`; expect pass.

### Task 5: Migrate app navigation and Open Board actions

**Files:**

- Modify: `src/ui/tab-bar.tsx`
- Modify: `src/ui/tab-bar.test.tsx`
- Modify: `src/ui/workspace-sidebar.tsx`
- Modify: `src/ui/workspace-sidebar.test.tsx`
- Modify: `src/open-board/open-board.tsx`
- Modify: `src/open-board/open-board.removal.test.tsx`
- Modify: other existing Open Board tests that assert literal glyphs
- Modify: `src/styles.css`

- [ ] Add semantic tests for new tab, close tab/workspace, remove recent, open folder and new layout actions. Keep existing keyboard and double-click removal tests intact.
- [ ] Run the focused tests; expect the new icon-class assertions to fail. No existing test asserts `+`, `×` or `＋`, so nothing else should go red — if something does, it is a regression, not the expected failure.
- [ ] Replace tab and sidebar add/close glyphs with `Plus` and `X` through `DeckIcon`.
- [ ] Replace the Open Board's functional folder SVGs and action glyphs with `FolderOpen`, `FolderPlus`, `X`, `Trash2` and `Plus` according to the approved mapping.
- [ ] Strip the icon geometry and `stroke`/`stroke-width` declarations from `.row__ico` and `.openfolder svg`, which currently override the SVG attributes and would silently defeat `DeckIcon`. Keep the themed colors by restating them as `color` — including the `.row.is-selected` and `.row.is-missing` overrides — so `currentColor` resolves to the same values it paints today.
- [ ] Leave the Deck brand SVG in `open-board.tsx` untouched. Leave number shortcuts, arrow-key hints, `Escape` and `Enter` legends as text.
- [ ] Preserve row hit targets, double-click suppression, selection behavior and shortcuts.
- [ ] Run `npx vitest run src/ui/tab-bar.test.tsx src/ui/workspace-sidebar.test.tsx src/open-board`; expect pass.

### Task 6: Cover the imperative terminal search bar without a second icon path

**Files:**

- Modify: `src/terminal/search-bar.ts`
- Modify: `src/terminal/search-bar.test.ts`

- [ ] Give `barButton` an explicit `aria-label` first. Its buttons are named by their text content today, so replacing that text with an `aria-hidden` icon would silently demote the accessible name to the `title` string (`Previous match (⇧↩)`), and a test asking for `Previous` could never pass.
- [ ] Add tests that open the search bar and find Previous, Next and Close by accessible name without asserting the literal `‹`, `›` or `×` text.
- [ ] Run `npx vitest run src/terminal/search-bar.test.ts`; expect the new icon assertions to fail.
- [ ] Keep `search-bar.ts` as the lifecycle owner. Use Preact's programmatic `h`/`render` with `DeckIcon` to mount `ChevronLeft`, `ChevronRight` and `X` inside the existing DOM buttons; do not add a DOM icon package or copy Lucide paths.
- [ ] On disposal, unmount the rendered icon nodes before removing the bar so the imperative surface does not leave Preact roots behind. There are two disposal paths — the normal close and the pane-disposal drop — and both must unmount.
- [ ] Preserve search state, input focus, Escape handling and result navigation.
- [ ] Run the focused search-bar tests; expect pass.

### Task 7: Add a drift guard and update living documentation

**Files:**

- Create: `scripts/icon-system.test.ts`
- Modify: `docs/DESIGN-LANGUAGE.md`
- Modify: `docs/CONTEXT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `AGENTS.md`

- [ ] Add a filesystem test that scans `src/**/*.{tsx,ts}` for literal `<svg` authorship and permits exactly one Deck brand SVG in `open-board.tsx` and one bespoke status SVG in `workspace-spinner.tsx`. It scans `.ts` as well as `.tsx` because `search-bar.ts` proves an imperative surface can author markup outside a component file. The test checks both paths and counts, and reports every unexpected occurrence so a future hand-drawn functional icon cannot hide in an allowed file.
- [ ] Run `npx vitest run scripts/icon-system.test.ts`; if it fails, classify each survivor as a missed functional icon or a documented exception. Do not silently expand the allowlist.
- [ ] Add the general icon rule to `docs/DESIGN-LANGUAGE.md` covering source, sizes, stroke, accessibility, icon-only usage, the CSS-precedence trap and the exception list. DL-1.1 and DL-11.3 were already amended in Task 1.
- [ ] Update the design-language drift ledger if the migration resolves or creates any recorded mismatch.
- [ ] Record the shipped dependency, shared primitive, scope exceptions and Paste/Send semantics in `docs/CONTEXT.md` with relative code anchors and intent labels.
- [ ] Add the icon foundation to `docs/ARCHITECTURE.md` with relative anchors and an entry in its `Chưa khớp thực tế` section if anything remains incomplete.
- [ ] Once implementation and visual approval are complete, move the AGENTS in-flight decision into `docs/ARCHITECTURE.md`; until then, update its status without deleting it.
- [ ] Run `npm test`, `npm run build` and `npm run generate:menu:check`; paste the complete command outputs as completion evidence.

### Task 8: Production-fidelity visual approval

**Files:** No source edits are expected. If review finds a defect, return to the owning task and update its test before changing code.

- [ ] Run `npm run tauri dev` on macOS.
- [ ] Capture the Open Board, top-tabs chrome, sidebar chrome, Settings navigation, one expanded Prompt Board paste-only template and one expanded auto-send template.
- [ ] Repeat the representative chrome, Settings and Prompt Board captures in all four theme presets, checking 13px/14px legibility, stroke consistency, hover/focus/disabled contrast and alignment at native scale.
- [ ] Exercise Prompt Board once in paste-only mode and once in auto-send mode. Confirm the distinct icons communicate intent while the existing safety gate and degraded `Pasted — not sent` behavior remain intact.
- [ ] Run `npm run video:render` and require exit code 0 to verify the shared app stage still renders; do not modify marketing-only icon art in this task.
- [ ] Present the screenshots or recording to the user. Stop until the user explicitly eye-approves them.

## Out of Scope

- Prompt Board layout, template information architecture, editing flow or injection policy beyond the Paste/Send icon semantics.
- Rust, PTY, coordinator, menu binding, persistence, updater, signing, release and version changes.
- Agent and Deck brand assets, OS logos, terminal content, keyboard notation, status dots, `WorkspaceSpinner` and marketing-only illustration/control SVG.
- Adding another icon package, copying Lucide path data, or authoring replacement SVG paths locally.
- Committing this plan or its future implementation without separate user authorization.
