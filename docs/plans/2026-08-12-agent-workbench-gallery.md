# Agent Workbench Gallery — Implementation Plan

**Spec**: [2026-08-12-agent-workbench-gallery-design.md](../specs/2026-08-12-agent-workbench-gallery-design.md)
**Goal**: Replace the `window chrome` shell comparison with three gallery-only Deck-native workbench compositions at wide and compact desktop widths.
**Architecture**: A gallery-owned fixture component renders identical project, workspace, terminal, explorer, and status data through three CSS composition variants. The existing gallery section owns comparison framing while shipping components and styles remain unchanged.

## 1. Expected result

- Three composition candidates replace the two current full-window shell specimens — verify with the `Window chrome` gallery section.
- Every candidate renders the same fixture data at wide and compact widths — verify with screenshots at both specimen sizes.
- Existing component-state specimens remain below the compositions — verify `AgentAttentionMark`, `UpdateAction`, `WorkspaceSpinner`, and `PresetThumb` remain mounted.
- Gallery isolation remains intact — verify with `npm test` and `npm run build`.

## 2. Canonical data

**Canonical data**: The approved gallery spec, Deck's design-language tokens, and the existing gallery seed conventions.

**Taken from**: [`docs/DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md), [`src/gallery/seed-data.ts`](../../src/gallery/seed-data.ts), and current shipping chrome components used by existing state specimens.

**Not taken from**: Live filesystem state, user settings beyond the gallery theme fixture, Orca product data, or Electron host state.

## 3. Business rules and invariants

- **Gallery-only ownership**: Shipping modules never import the workbench fixture — verify with `scripts/gallery-entry.test.ts` through `npm test`.
- **Identical comparison data**: All compositions receive the same immutable fixture object — verify by inspection and TypeScript.
- **Terminal dominance**: The center stage remains the widest region in all wide candidates — verify from computed screenshot geometry.
- **No compact overflow**: Compact specimens do not horizontally scroll or overlay the terminal — verify in the rendered gallery.
- **Coverage preservation**: Existing component-state specimens remain unchanged below the new comparison — verify in `ChromeSection`.

## 4. Scope and exclusions

**Build**:

- A gallery-owned workbench fixture with semantic project/workspace, surface tabs, terminal panes, explorer, and status markup.
- Three composition variants and wide/compact specimen framing.
- Gallery-only CSS for layout, treatment, and compact behavior.

**Do not build**:

- Shipping chrome or feature-toolbar changes.
- Explorer filesystem behavior, Monaco, browser, Git, tasks, automations, or Electron integration.
- New runtime dependencies or animation outside Deck's allowed properties.

## 5. Tasks

### Task 1: Add immutable workbench fixture data

**File(s)**:

- [`src/gallery/seed-data.ts`](../../src/gallery/seed-data.ts)

**Decision**: One fixture object supplies every composition so only layout changes between candidates.

**Build**:

- Add typed readonly project, workspace, terminal, explorer, and status fixture data.
- Keep fixture strings English and independent from real stores or IPC.

**Verify**:

- `npx tsc --noEmit` → no type errors.
- `rg "WORKBENCH" src/gallery/seed-data.ts` → the canonical fixture is present once.

---

### Task 2: Build the gallery-owned workbench specimen

**File(s)**:

- [`src/gallery/sections/workbench-specimen.tsx`](../../src/gallery/sections/workbench-specimen.tsx)
- [`src/gallery/sections/chrome-section.tsx`](../../src/gallery/sections/chrome-section.tsx)

**Depends on**: Task 1

**Decision**: The specimen renders three named variants from one component; `ChromeSection` replaces only its two full-window shell specimens.

**Build**:

- Render navigation hierarchy, surface tabs, three terminal panes, explorer dock, and status metadata with accessible region labels.
- Mount Balanced dock, Attention rail, and Stage first at wide and compact sizes.
- Keep the existing component-state specimens below the comparison.

**Verify**:

- `npx tsc --noEmit` → no JSX or type errors.
- `rg "AgentAttentionMark|UpdateAction|WorkspaceSpinner|PresetThumb" src/gallery/sections/chrome-section.tsx` → all four retained.

---

### Task 3: Apply gallery-only composition and treatment

**File(s)**:

- [`src/gallery/gallery.css`](../../src/gallery/gallery.css)

**Depends on**: Task 2

**Decision**: Workbench styling uses `gx-` selectors, Deck theme tokens inside the specimen, and fixed gallery framing outside it.

**Build**:

- Define the three column ratios, terminal split ratios, selected states, explorer rows, and compact reductions.
- Keep the terminal stage dominant and prevent horizontal overflow.
- Add only allowed state transitions and reduced-motion handling.

**Verify**:

- `rg "^\.gx-workbench" src/gallery/gallery.css` → all new styles remain gallery-prefixed.
- Browser screenshot at wide and compact sizes → no overlap or horizontal scrolling.

---

### Task 4: Run automated and visual gates

**File(s)**:

- [`gallery.html`](../../gallery.html)
- [`src/gallery/sections/chrome-section.tsx`](../../src/gallery/sections/chrome-section.tsx)

**Depends on**: Task 3

**Decision**: Automated checks establish isolation and correctness; screenshots are presented for owner eye approval, not self-approved.

**Build**:

- Start `npm run prototype:gallery` and capture the `window chrome` section at wide and compact widths.
- Check the gallery footer for newly unhandled IPC calls.

**Verify**:

- `npm test` → all tests pass.
- `npm run build` → TypeScript and shipping renderer bundle pass.
- `npm run generate:menu:check` → generated menu is current.
- `git diff --check` → no whitespace errors.
- Screenshots show all three compositions and are handed to the owner for selection.
