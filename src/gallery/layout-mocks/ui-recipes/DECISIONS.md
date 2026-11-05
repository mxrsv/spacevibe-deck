# Deck UI recipes: decisions for the mock (owner, 2026-11-04)

Source: the /kyant-intent and /grilling rounds with the owner, 2026-11-04. Every agent building this mock follows this file. If something here conflicts with a mock file, this file wins.

## Intent

- **One recipe per thing.** The whole app gets ONE recipe for each of: size, radius, spacing, row height, hover, focus, selected, pressed, disabled, borders, elevation, type and weight.
- **Each recipe is one token,** declared per theme. A ratchet test will later enforce it.
- **The mock comes first.** It becomes the visual standard. The owner approves it by eye. Then the spec is written, then the app is changed surface by surface.

## Standard

- **Sources, in order:** the spec `docs/specs/2026-11-03-ui-composition.md` (CMP-1..15) is the base. Where it is silent, this mock decides. Where `docs/DESIGN-LANGUAGE.md` and the mock disagree, the DL wins (Q1).
- **Token names (Q13):** Deck's existing names win. Reuse them:
  - states: `--state-hover-bg`, `--tab-active-bg`, `--tab-rest-bg`;
  - radius: `--radius-flat` 2, `--radius-tight` 3, `--radius-tab` 4, `--radius-control` 4, `--radius-surface` 7, plus the literal 6 for controls 36/40 high;
  - motion: `--duration` 150ms, `--ease` cubic-bezier(0.4, 0, 0.2, 1);
  - colour: `--tone` (#fff on dark, #000 on light), `--chrome-1/2/3`, `--sidebar-bg`, `--input-bg`, `--seam-raised`, `--control-frame`.

  Add new names only for what is missing: `--space-*`, `--row-24/32/44`, `--control-h-28/32/36/40`, `--elev-1/2/3`, `--state-pressed-bg`.
- **Sizes:**
  - controls 28/32/36/40, radius 4/4/6/6;
  - chip 24/20, radius 4/3;
  - badge 20 pill, read only;
  - icon box 28/24/20, holding an icon of 16/14/12 (tied to the box).
- **Type and weight:** 16 dialog title; 14 buttons, inputs, labels, row titles; 12 chips, badges, metadata. Nothing below 12, except terminal text, which is out of scale. Weights 400 and 600 only, no 500 (Q20).
- **Spacing (Q12):** the values are 0/2/4/6/8/10/12/16/24, with these roles:

  | Role | Value |
  | --- | --- |
  | icon ↔ label | 6 |
  | control horizontal padding | 8 / 12 / 14 / 16 for heights 28 / 32 / 36 / 40 |
  | row horizontal padding | 8 |
  | inside a group | 4 / 6 / 8 |
  | between groups | 12 / 16 |
  | between sections | 24 |
  | between list rows | 2 |
- **Row heights (Q10, Q19):** 24 dense list (Changes, file tree), 32 menu or one-line row, 44 two-line rail row. Live and remembered rail rows are both 44.
- **States (Q4, Q14), all derived from `--tone`, so they flip per theme:**
  - hover: 6% `--tone` (`--state-hover-bg`), background only, in `--duration`;
  - selected: `--tab-active-bg` (a full wash, no bar or border);
  - selected with keyboard focus: one step stronger (DL-21.1);
  - pressed: `--state-pressed-bg`, the surface mixed 8% toward black, in both themes;
  - disabled: 50% opacity, no hover;
  - focus: only text inputs get a ring (3px outside, `--foreground` at 14%, border turning muted); every other control shows keyboard focus as its hover;
  - a state change never shifts layout.
- **Elevation (Q8 = b, Q8.1–8.3):** three levels:

  | Token | Used on |
  | --- | --- |
  | `--elev-1` | menu, popover, tooltip |
  | `--elev-2` | floating panel: the launcher over a space, a slide-over |
  | `--elev-3` | modal |

  Flat surfaces (rail, stage, dock) get none.
  - **Dark themes:** shadow plus a 1px inset hairline.
  - **Light themes:** shadow only.
  - **Limits:** static only, never animated; written only through the tokens; only on floating elements, never on repeated rows or cells.
  - **Strength:** render 3 shadow strengths per level and theme in the Rules tab, so the owner can pick by eye (Q15).
- **Lines:** no divider lines (CMP-14). The only lines are a menu's 1px separator between its scrolling list and its fixed actions, and a floating panel's frame.
- **Keys and icons:**
  - a shortcut is ONE badge per chord, e.g. "⌘O" (Q18);
  - icons come from Hugeicons only (Q9). Use `@hugeicons/core-free-icons` SVG data, or matching inline SVGs; no Phosphor.
- **Browser parts:** scrollbars and text selection are themed in the token layer (Q22). Scrollbars are thin, with the thumb on `--tone`.
- **Themes:** dark = graphite (`src/settings/built-in-themes.ts`), light = Deck Light (same file). Take the values from there.
- **Copy:** English only. No headings, eyebrows or helper sentences in app surfaces. Review chrome (`gx-*`) may label.

## Mock structure (Q23–Q31)

- **Location:** `src/gallery/layout-mocks/ui-recipes/` in the repo, shipped with the build PR. `index.html` is the entry page that links to the tabs.
- **Files:**
  - `tokens.css` (the token layer, per theme);
  - `chrome.css` (every control and surface recipe);
  - `app.js` (Dark/Light toggle, Worst-case toggle, tab nav, shared mock data, shared render helpers);
  - one HTML per tab.

  Every file stays under 800 lines.
- **Tabs, in order:** Window, Launcher, Rail, Stage, Dock, Overlays, Settings, Notices, Rules. Every tab has Dark/Light and Worst case.
- **Window tab:** one composed Deck window of a real working moment:
  - 3 projects, with one agent needs-you, one working, one failed, plus remembered rows;
  - the stage split in 2 panes, each with a pane header;
  - the dock open on Changes with 3 diff cards;
  - a rail context menu open.
- **Per-group tabs:** show each piece in its states (hover, selected, needs-you, working, error, empty, loading, disabled, drag-over), in both themes.
- **Data:** real copy and lengths: long project names, big counts, deep paths. The "Worst case" toggle swaps in extreme data.
- **Directions:** drop B and C; their shots stay in `shots/`.

## Surfaces to draw (Q27, Q28)

- **Window frame:** traffic lights, frame row.
- **Rail:**
  - search and controls row;
  - project header and its actions;
  - agent rows in states needs-input / working / failed / unread / idle;
  - remembered rows, checkout rows (worktree);
  - archived/hidden section;
  - inline rename field;
  - footer with usage rings, history, settings, Tools.
- **Stage:**
  - tab strip and tab menu;
  - attention chip, dev-servers chip;
  - toolbar and overflow menu;
  - dock toggle, sidebar toggle;
  - pane header;
  - the launcher, in all its states (from the current direction A).
- **Dock:**
  - view icon strip (Changes, Usage, History, Files);
  - file tabs, breadcrumb row;
  - Changes as a card stack plus the list/tree pane;
  - Usage, History, Files tree;
  - the external-change bar.
- **Browser panel:** toolbar plus page area.
- **Menus:** rail row menu, checkout menu, dock file menu, launcher project menu and profile menu.
- **Popovers and tooltips:** attention popover, dev-servers popover, prompt popover, tooltip and action tooltip.
- **Modals and forms:** remove project, create file, preset editor or save preset, usage consent, worktree form, and Clone and Create workspace as stage forms.
- **Settings (Command Settings):** the frame (search, area chips, footer), plus each row pattern once:
  - toggle row;
  - select row;
  - shortcut row;
  - editable list (agents);
  - theme cards.
- **Notices:** persist-error bar, update action, launcher failure line.
- **Usage details page.**
- **Not drawn:**
  - native quit and close dialogs;
  - the Spaces bar, the browser-beside slot and the hunk queue (not live);
  - CMP-20 surfaces;
  - terminal and editor content (placeholder mono text only).

## Later (not this mock)

- The spec records the DL forks the owner approved: DL-1.3 shadows, DL-20.5 spacing tokens, a row-height scale in §20, a weight scale.
- Then the ratchet extends `src/styles/composition-rules.test.ts` and `scripts/ui-composition-gate.test.ts`.
  - **Debt:** a per-file ledger whose counts only shrink. CMP-20 surfaces are exempt, and the classes live surfaces still use move out of the exempt partials.
  - **Exceptions:** `ui-scale: <reason>`.
- Rollout: no switch; one commit per surface, in the order rail → stage bar and pane header → dock → overlays → settings. Eye review comes on gallery state sheets made from real components, then one run of the app.

## Pass decisions (final pass, 2026-11-05)

The final pass rebuilt the tab workarounds as shared recipes. These choices were made in that pass; DL and the owner's answers above still win.

- **Rail width:** `--rail-w` is Deck's real default sidebar width of 275 (`src/styles/01-tokens.css`). It is an alias of `--sidebar-w`, so the value is declared once. The rail tab's 264 is gone. `--rail-w-narrow` is 200, Deck's minimum; at that width the footer folds Tools to its icon.
- **Rail rows (DL-27):**
  - the status mark leads the row, in a 14 slot. A remembered row keeps the empty slot, so titles line up.
  - A remembered row ends in a fixed 32 cell (`--row-end-w`), where the age and the resume icon swap without moving anything. Ages print short: "yesterday" becomes "1d".
  - A remembered row is quiet: no needs tint and no failed ink.
- **Row actions** overlay the row's end on an opaque ground: the surface, with the row's own state on top of it. A long title never shows through.
  - A folded project's count steps aside on hover and focus.
  - On a remembered row, the actions sit before the age cell.
  - A checkout line ends without a `+` (DL-27.28).
- **No divider lines (CMP-14):** groups separate by spacing. Inside a menu that is `.menu-gap` (8); in a bar it is `.bar-gap` (8), the dock strip's gap. The one 1px menu line stays only between a scrolling list and its fixed actions. The rail row, checkout, dock file and profile menus moved from separators to gaps.
- **No tooltip arrow:** Deck is flat.
- **Status ink:** text in a status hue uses `--ink-need`, `--ink-fail` or `--ink-ok`: the hue mixed toward `--text-primary`, by the least amount that holds 4.5:1 on every surface and tint it sits on. Marks, dots and bars keep the pure hue.
  - On the selected and drag-over washes, fail text switches to `--ink-fail-wash`. In dark that is a 50% mix, because the 70% mix drops under 4.5:1 there; in light it is the same ink.
  - A card header folds but is never selected, so the dock state sheet marks its selected cells n/a.
- **Text on the selected and drag-over washes:** faint text steps up to muted; kbd and avatar text step up to primary. Faint ink is under 4.5:1 on those washes.
- **Resize handle:** Deck's 4px pane gutter. It paints Deck's `--ring` on hover, keyboard focus and drag, never the 8% pressed black.
- **Diff (DOCK-10), with Deck's values:**
  - a changed line is its hue mixed 20% (lab) into the card;
  - its gutter is a 15% mix, with the number in ink and a 3px bar;
  - context text is muted.
  - The card head is 24, sticky, on the opaque card ground; the card clips (`overflow: clip`) so the head can stick to the stack's scroller.
  - A card the list pane lands on flashes a 2px primary bar on its leading edge, drawn above the sticky head.
- **Panel footer:** a strip on the 3% resting wash (`--tab-rest-bg`), a step in the ground, not a line.
- **Pane header:**
  - the status is the mark plus the DL-27.2 word: Needs you, Working, Failed, Finished, Ready, Ended.
  - The default action is a single "more" (24). The full cluster (split, expand, close) is the stage variant.
- **Tabs:**
  - the minimum width is the sum of the tab's parts plus a 40 title (`--tab-title-min`), so the title is the first thing to truncate and never disappears;
  - close shows on keyboard focus as it does on hover;
  - a preview tab has an italic title.
- **Avatar:** two initials, or one glyph when the first grapheme is wide (CJK, emoji).
- **Update action:** one 28 box, capped at 200: available (primary), downloading (a framed status, meter and %, not pressable), ready (primary).
- **Stage frame:** Window, Stage and Launcher show the same toolbar: open-in-app split, more, dock toggle. The Window and Launcher frames had a "Changes" diff button, which the Stage tab's toolbar does not have.
- **Bar heights:** a bar is 36 (`.bar`), 34 when it sits in the frame row (`.bar-strip`) and 40 as a view header (`.bar-band`). Tab pages no longer set `--bar-h` themselves.
- **Command bar:** one 40 frame holding 32 controls (project chip, input, Run split). The frame takes the input focus ring.
- **Icon split:** a 28 icon and a 20-wide caret half, 2 apart.
- **Dock usage glyphs** follow `dock-usage.tsx`: coins for tokens, dollar for cost, user-group for space cost, timer for running time.

## Owner picks (2026-11-05)

- **Working mark = B, the braille spinner** (DL-27.21 frames ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏, 80ms each, opacity only, still frame ⠹). It is used everywhere a working state shows: rail row, tab, pane header. The owner picked it over A (the dot ring, Deck's current rail mark) and C (three dots, which looked like More).
  - **DL change:** DL-27.3's rail working mark changes from `WorkspaceSpinner` to the braille spinner. That is a pattern change, accepted by eye.
  - **Implementation:** reuse the app's existing braille spinner (DL-27.21). It must render from stacked frames, not depend on a host font for the glyphs, because on Windows the mono fallback may lack braille.
- **Shadow strength = mid** for all three levels (`--elev-1` menu/popover/tooltip, `--elev-2` floating panel, `--elev-3` modal). The owner picked it on the Rules tab, 2026-11-05. The `-soft` / `-strong` variants are specimen-only and drop out of the spec.

## Owner answers for the build (2026-11-05)

- **Dims use no `filter`** (DL-1.3): a remembered row's logo and an unpicked tile's logo dim by opacity 0.5 alone, and the window behind a floating launcher or modal dims under the `--scrim-bg` colour scrim. The mock's greyscale and `brightness()` dims are gone. The other five answers are recorded in `docs/plans/2026-11-05-ui-recipes-ratchet.md`.

## Parity decisions (owner, 2026-11-05)

Approved after PR #98 shipped tokens only. This ledger is binding: the app's components must match the mock tabs in structure, content, look and theme. The IDs are for spec traceability (W20).

- **P0:** the mock is the standard the app is changed to match, per surface. This restates grilling Q23. "Layout" is no longer out of scope.
- **P1:** drop "No sessions" under empty projects. Keep "No sessions match" while searching.
- **P2:** agents that are not installed stay in the launcher row as a dimmed 36 tile with a download mark. Pressing the tile installs. There is no separate framed "Install" button, so the row never wraps. Amend LCH-8 and docs/user/agents.md.
- **P3:** the dock strip always shows Files. Keep +, widen and close, as the mock's dock.js:111 does.
- **P4:** Usage empty state: icon, centred, plus the "Today" band with its info and Usage details buttons (mock dock.js:89).
- **P5:** remove the "Deck DEV" brand from the frame. Keep a dev-build marker: a small dot on the sidebar toggle. Keep the drag region and the room for the Windows caption buttons. Rewrite DL-18.9.
- **P6:** launcher: show the ⇧ key only, with the meaning in a tooltip and the accessible name. Add a + icon for "New space in" and a split icon for "Beside".
- **P7:** the launcher's Run is ivory in graphite. Scope it to the launcher's primary action only; `--primary` is unchanged. Amend spec line 386.
- **P8:** capture the composed real app with an isolated userData run to complete the parity list.
- **P9:** the launcher command bar's controls are 32 inside a 40 frame (mock launcher.js:370).
- **Noted, not decided:** the release switches still keep the new surfaces off in packaged builds, so a release looks like the mock only after the cut-over.

## Grilling ledger (owner, 2026-11-04/05; every answer = recommendation unless noted)

- **Intent:** the whole app gets one recipe per thing (size, radius, spacing, row height, hover, focus, selected, pressed, disabled, borders, elevation, type, weight), one token each, per theme. A ratchet test enforces it. Success: per-surface state sheets approved by eye in both themes, debt 0 on those surfaces, and the test blocking new off-scale values.
- **Standard and conflicts:**
  - **Q1:** the ui-composition spec is the base, and the mock fills the gaps. Where DL and the mock conflict, DL wins on radius 7 and ease. DL-20.5 changes so spacing gets tokens.
  - **Q4:** state tokens derive from `--tone`.
  - **Q12:** the spacing role table.
  - **Q13:** Deck's existing token names win.
  - **Q14:** pressed = 8% toward black.
- **The ratchet:**
  - **Q2:** it covers radius, height, spacing, focus, state backgrounds, shadow and weight, in CSS and Tailwind classes in .tsx. Colours are out.
  - **Q3:** per-file debt ledger; CMP-20 surfaces exempt.
  - **Q11:** live classes move out of the CMP-20 partials.
  - **Q16:** the Tailwind allowlist.
  - **Q17:** the `ui-scale: <reason>` exception.
- **Process:**
  - **Q5:** no switch, one commit per surface, one eye review at the end.
  - **Q6:** order rail → stage bar and pane header → dock → overlays → settings.
  - **Q7:** the review is on gallery state sheets made from real components in graphite and Deck Light, next to the mock, then one run of the real app.
- **Visual rules:**
  - **Q8 = b:** shadows are allowed.
    - **Q8.1:** three levels: menu, floating panel, modal.
    - **Q8.2:** dark = shadow + inset hairline, light = shadow only.
    - **Q8.3:** static only, token only, floating elements only.
  - **Q9:** Hugeicons; the ratchet blocks new Phosphor imports.
  - **Q10, Q19:** rows 24/32/44; rail rows 52 → 44, live and remembered.
  - **Q15:** shadow strength picked by eye; picked mid.
  - **Q18:** one badge per chord.
  - **Q20:** weights 400/600 only.
  - **Q21:** DeckIcon size typed 16/14/12.
  - **Q22:** scrollbar and selection are tokens.
- **The mock:**
  - **Q23 (a):** draw every surface in the mock. **The mock is the standard the app is changed to match.**
  - **Q24:** a composed window plus per-group state tabs, in both themes.
  - **Q25:** real data plus a Worst-case toggle.
  - **Q26:** drop directions B and C.
  - **Q27:** the surface list.
  - **Q28:** settings drawn as row patterns.
  - **Q29:** the tab order.
  - **Q30:** the composed scene.
  - **Q31:** the file split.
- **Owner picks:**
  - working mark = braille (B);
  - mock approved by eye 2026-11-05;
  - the six pending DL items approved through the cloud prompt.
- **P10 (owner, 2026-11-05, supersedes P7):** `--primary` is one ivory in every theme, light included. Switching themes only changes some background surfaces. Accent, status and focus colours stay shared.
