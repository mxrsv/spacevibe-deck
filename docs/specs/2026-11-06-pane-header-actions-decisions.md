# Pane header actions: decision ledger (2026-11-06)

Source: grilling session with the owner, screenshot of an agent pane header (`Claude • Ready`) with the empty right-hand area marked and the `More` menu (Split vertically, Split horizontally, Focus expand, Close pane).
Owner approved the whole round ("ok approve"), so every row takes the recommended answer.

| ID | Decision | Owner words / status |
|----|----------|----------------------|
| PH-1 | Work in `spacevibe-deck` on `main` | (default) |
| PH-2 | A new DL entry supersedes DL-32.8 for four actions only: Split vertically, Split horizontally, Focus expand, Close pane. The Effort picker stays removed. `More` keeps all four items. `docs/internals/terminal.md` is updated | "ok approve" (Q1) |
| PH-3 | Header shows four icon buttons, one click each; tooltip = name + chord | "ok approve" (Q2a) |
| PH-4 | Buttons are always visible, dimmed (grey); full strength on header hover or when the pane is focused | "ok approve" (Q3) |
| PH-5 | When the pane is too narrow for four buttons, they collapse into one `⋯` button that opens the same menu. No action is lost and the `Ready` status is never covered. Threshold chosen at build time and reported | "ok approve" (Q4a) |
| PH-6 | Each button acts on its own header's pane, not the focused pane (reuse `src/terminal/pane-header-actions.ts`) | (default, stated in round) |
| PH-7 | Close goes through the existing close contract (`closePaneAt`), including the confirm when an agent is running | (default, stated in round) |

## Acceptance (each ID)

- PH-2: DL entry exists and says it supersedes DL-32.8 for the four actions; `terminal.md` no longer says the header draws no buttons; `More` still lists all four.
- PH-3/4: in the running dev app (W22), every agent pane header shows four icons; tooltip text and chord match the menu; resting opacity is lower than hover/focus opacity.
- PH-5: split a pane until narrow; header shows one `⋯` with the same four items; `Ready` stays readable.
- PH-6: with pane A focused, clicking Close on pane B's header closes B.
- PH-7: Close on a pane with a running agent shows the same confirm as `⌘W`.
