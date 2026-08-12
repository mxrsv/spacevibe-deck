# Agent Workbench Gallery — Design

Date: 2026-08-12 · Status: approved 2026-08-12

## 1. Context

**Origin:**

- The owner supplied an Orca desktop screenshot as a reference for layout,
  density, styling, UI behavior, and feature placement.
- The owner selected the Deck-native workbench direction: learn the reference's
  layout grammar without copying its product model or visual skin.
- The owner selected `gallery.html` as the review surface and chose to replace
  the existing shell comparisons in the `window chrome` section.

**Problem:**

The current gallery proves Deck's existing top-tab and sidebar shells, but it
does not provide a full-window comparison surface for the approved three-region
workbench direction: agent/workspace navigation, a terminal-first stage, and a
contextual explorer dock. Applying this direction directly to shipping chrome
would combine composition, treatment, product behavior, and load-bearing layout
changes before the owner can judge the result by eye.

**Decisions:**

- The first change is gallery-only. It does not modify the shipping renderer,
  Electron worktree, PTY ownership, tab materialization, layout engine, or file
  explorer implementation.
- Replace only the two full-window shell specimens at the top of `window
  chrome`. Keep the component-state specimens below them so existing visual
  coverage is not lost.
- Run the review as a self-cleaning sequence: three composition candidates,
  owner selection, then one promoted treatment candidate. Losers are removed
  only after the selected composition is represented in the next round.
- Treat the Orca screenshot as a reference, not a blueprint. Labels, exact
  proportions, icon order, color palette, card geometry, and product-only
  features are not copied.

## 2. Canonical data

**Canonical:**

- [`docs/DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) owns Deck's semantic color,
  typography, icon, density, motion, and docked-panel rules.
- [`DesktopChrome`](../../src/ui/app.tsx) owns the current shipping window grid.
- [`TabBar`](../../src/ui/tab-bar.tsx),
  [`WorkspaceSidebar`](../../src/ui/workspace-sidebar.tsx), and
  [`StatusBar`](../../src/ui/status-bar.tsx) remain the real chrome references.
- [`2026-08-12-file-explorer-design.md`](2026-08-12-file-explorer-design.md)
  owns explorer behavior. This gallery design may visualize that contract but
  does not alter it.

**Not canonical:**

- Gallery fixture labels, paths, branches, agents, terminal output, file names,
  or status values.
- Candidate dimensions before owner selection.
- Any Orca-specific project, task, automation, browser, mobile, Git, or remote
  runtime behavior.

## 3. Solution architecture

**Signature concept:**

Deck reads as an agent cockpit: attention and workspace context enter from the
left, terminal work remains dominant in the center, and files appear as a
bounded contextual dock on the right.

**Compositional thesis:**

An asymmetric three-region workbench keeps the terminal stage visually and
spatially dominant while both side regions remain legible, independently
bounded, and collapsible in intent.

**Restraint map:**

- **Quiet:** window chrome, dividers, inactive tabs, file rows, metadata, and
  status bar.
- **Moderate:** selected workspace, active surface, resizers, and dock header.
- **Loud only when meaningful:** agent attention, failure, destructive action,
  keyboard focus, and active terminal ownership.

### 3.1 Round one — composition candidates

The gallery offers three deliberately different compositions using the same
fixture content. They are structural comparisons, not final visual treatment.

1. **Balanced dock:** stable project/workspace rail, dominant center stage,
   medium explorer dock. Best when navigation and file reading are equally
   frequent.
2. **Attention rail:** wider left region with explicit project → workspace →
   agent hierarchy, tighter explorer dock, and center stage biased toward
   supervision. Best when parallel agent state is the primary navigation task.
3. **Stage first:** compact left navigation, widest terminal stage, and a
   bounded explorer dock. Best when the terminal must retain maximum area while
   files remain one action away.

Each candidate renders at a wide desktop width and a compact desktop width.
Compact behavior may collapse metadata or side-region content, but it does not
overlay the terminal stage or silently reorder the information hierarchy.

### 3.2 Round two — treatment

After the owner selects one composition, the selected structure replaces the
three candidates in the same gallery section and receives one treatment pass:

- theme-derived Deck surfaces rather than fixed charcoal;
- `--ui-font` for chrome and monospace only inside terminal fixtures;
- semantic attention/status colors;
- Deck icon geometry and hairline structure;
- current chrome density unless the owner explicitly approves a changed value;
- a distinct selected-state marker rather than Orca's exact underline/card
  treatment.

Real app components are used where their current contracts fit. Missing future
surfaces use clearly gallery-owned fixtures; gallery modules never become an
input to shipping modules.

### 3.3 Supporting states retained

The existing `AgentAttentionMark`, `UpdateAction`, `WorkspaceSpinner`, and
`PresetThumb` specimens remain below the workbench comparison. Their purpose is
component-state coverage, not composition review.

## 4. Failure modes

- If a candidate makes the terminal stage secondary at either review width, it
  fails the direction even if it resembles the reference.
- If compact width causes overlap, horizontal page scrolling, or an explorer
  overlay, the candidate fails rather than hiding the defect.
- If a fixture implies an unapproved product feature, it is labeled as a
  non-interactive future surface or removed.
- If gallery CSS leaks into shipping selectors, the change fails R7.
- If a real app component makes IPC calls the gallery stub cannot answer, the
  missing call remains visible in the gallery footer and must be handled
  explicitly.
- If theme switching leaves a promoted treatment surface on fixed colors, the
  treatment fails Deck's design language.
- If reduced motion is requested, no gallery workbench transition may continue.

## 5. Done and excluded

**Done:**

- `window chrome` no longer presents the old top-tab versus left-sidebar shell
  comparison as its primary full-window content.
- Round one shows three workbench compositions using identical fixtures at wide
  and compact desktop widths.
- Every composition visibly contains project/workspace navigation, surface
  tabs, multiple terminal panes, a right explorer dock, and a status bar.
- The terminal stage remains the largest region in every candidate.
- Existing component-state specimens remain available.
- The gallery renders without horizontal overflow and its IPC footer reports no
  newly unhandled calls.
- The owner receives screenshots and selects a composition before treatment is
  considered approved.

**Not done:**

- Shipping shell, toolbar, explorer, Monaco editor, browser, Git, task,
  automation, mobile, or worktree behavior.
- Electron MVP integration or any Tauri change.
- A universal mixed-content pane tree.
- Final native macOS or Windows visual approval.
- Committing or pushing the design document or gallery changes without owner
  approval.

## 6. Open questions

- None for round one. Exact proportions and treatment values are intentionally
  selected through gallery eye review rather than guessed in this document.
