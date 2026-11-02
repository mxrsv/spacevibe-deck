# UI composition: buttons, small UI, input, type, focus and zoom

Date: 2026-11-03
Status: Decisions approved by the owner in conversation on 2026-11-03. Built on an unmerged branch,
awaiting the owner's eye review; this specification does not claim shipped behavior.
Parent: [Deck-wide shadcn and Base UI migration](2026-10-21-shadcn-base-ui-migration.md), which
keeps owning component technology. Layout stays with the
[agent-first shell layout](2026-10-22-agent-first-shell-layout.md).

## Purpose

The owner judged the app's small UI cheap whatever its colour. The cause is composition: how
buttons, chips, badges, inputs, text and focus states relate. Eye review happened on a comparison
sheet outside the repository (`~/scratch/spacevibe-deck/ui-phoi-hop-2026-11-02.html`), which is the
visual reference for this record.

## Authority

These decisions deliberately leave the upstream preset where they name it. They supersede UI-1
(keep the preset's sizing, radius and state treatment) and UI-2 (Deck Dark and Deck Light keep the
preset's values) for the items below, and only for those. The Nova controls already match the type
scale, so most of this is a narrow change on top of them.

## Requirements

### Buttons

- **CMP-1 Construction.** A primary button is filled with no edge. A secondary button has the same
  mould with a 1px frame.
- **CMP-2 Sizes.** Height 28, 32, 36 and 40. Radius 4 at 28 and 32, radius 6 at 36 and 40. Nothing
  under 28 is a button.
- **CMP-3 One filled button.** A screen shows one filled button at a time. When an agent needs the
  user, that is the answer to it; other primaries read as secondary.
- **CMP-4 Primary colour.** Ivory replaces the preset's blue: `oklch(0.93 0.025 85)` with
  `oklch(0.2 0.01 60)` text in dark, `oklch(0.24 0.012 60)` with `oklch(0.97 0.012 85)` text in
  light. Other themes publish the role from their own values.

### Small UI

- **CMP-5 Chip.** Height 24 or 20, radius 4 or 3, pressable. A quiet chip has no fill until hover.
- **CMP-6 Badge.** Height 20, a pill, read only.
- **CMP-7 Icon box.** 28, 24 or 20 square, radius 4 or 3, icon 16, 14 or 12, no fill until hover.
  An icon box of 20 appears only in dense rows and still offers a hit area of 24.

### Input

- **CMP-8 Construction.** An input uses the secondary button's frame and sits at button heights.
- **CMP-9 Focus ring.** A focused input has a 3px ring outside it, the text colour at 14%, with the
  border in the muted text colour. The border carries the 3:1 contrast; the ring is decoration.
  A container must leave room for the ring, since a clipping ancestor hides it.

### Type

- **CMP-10 Scale.** 16 for a dialog title. 14 for buttons, inputs, labels and row titles. 12 for
  chips, badges and metadata: branch, time, path, counts and group titles. Nothing below 12.
  Terminal text is out of scope.

### States

- **CMP-11 Focus.** Only inputs have a ring. Any other control shows keyboard focus the way it
  shows hover, with no ring or outline. Focus still reaches every control by Tab.
- **CMP-12 Accepted limit.** The state change in CMP-11 measures about 1.09 to 1.19:1, under the 3:1
  floor of the parent's UI-7. The owner accepts this; it is a named exception, not a defect.
- **CMP-13 Other states.** Hover changes background colour only, in 150ms. Pressed is one step
  darker. Selected is one neutral background step with no bar or border. Disabled is 50% opacity.
  A state change never shifts layout.

### Separation and spacing

- **CMP-14 No divider lines.** No horizontal rule between rows, groups or section headers. Large
  regions separate by background steps, and a line returns between two regions only if eye review
  finds they merge. Light mode needs new steps because the preset's `--card` equals `--background`.
- **CMP-15 Spacing.** A 2px step with the values 0, 2, 4, 6, 8, 10, 12, 16 and 24, assigned by role.
  Functional sizes stay outside it: hairlines, tree indent, window controls, the frame height and
  the padding of the 36 button (14).

### Zoom and size

- **CMP-16 GUI zoom.** The GUI scales by zoom only, with no size setting in Appearance. Shortcuts are
  ⌘⌥= / ⌘⌥- / ⌘⌥0 (Ctrl+Alt on Windows and Linux), with items in the View menu.
- **CMP-17 Terminal and editor font.** Size controls, ⌘= and ⌘- keep changing the font size shared
  by the terminal and the editor. GUI zoom does not change a terminal's font size or its column and
  row count.

### Language

- **CMP-18 English.** Every string in the app, and in its mocks and specimens, is English.

## Acceptance criteria

1. Each requirement is visible on the migrated surfaces in dark and light, and the owner has approved
   them by eye against the comparison sheet.
2. Tabbing through a dialog and Settings reaches every control, and focus can be followed.
3. At every zoom step, a terminal's text keeps its visual size, its PTY resizes only when its box
   really changes and at most once per zoom change, the browser tab's view stays aligned with its
   panel, and the window controls stay aligned with the frame. Columns can still change, since rail
   and dock scale with the GUI and take a different share of the window.
4. A test fails on a new chip-like control outside the sizes above and on a new font size below 12
   in the migrated surfaces. Existing use is counted as debt.
5. `docs/DESIGN-LANGUAGE.md` and the parent specification state these decisions, so neither pulls
   the app back. The layout mock follows them too.

## Out of scope

Terminal rendering and colours, the layout of rail, stage and dock, and legacy surfaces until their
region cuts over.
