# Spaces and Mission Control

> For maintainers. Using Deck? See [docs/user/](../user/).

A **space** is a terminal tab, shown by its workspace folder. The strip draws one mark per
space, a switch between spaces slides the stage, and Mission Control (⌘⇧O) zooms the panes
out over the stage with every space on a shelf. It replaced the
[Agent Board](agent-board.md) on 2026-09-28. Visual rules are
[`DESIGN-LANGUAGE.md` §35](../DESIGN-LANGUAGE.md).

## A space is the tab, not a new owner

[`space-model.ts`](../../src/ui/spaces/space-model.ts) is a pure projection over `tabViews`.
There is no space id, no persisted field and no second grouping: a tab's `workspacePath` is
fixed for its life, which is what makes the folder a stable name, and tabs sharing one path
get a 1-based index in display order. The journal, the last-session offer and restore are
therefore untouched — they already carry every tab with its path and layout.

A space's own name is the tab's `name` override, already journaled. The launcher names a new
space through `renameTab` from the launch closure in [`app.tsx`](../../src/ui/app.tsx), after
`launchAgentAtTarget` returns its receipt, so naming never enters tab materialization; the
tab is found by `receipt.tabKey` because an index can move while the launch is in flight.

**One grouping key, from the rail.** The strip's capsules and the shelf's sets group by
`Space.group`, the rail's `RailStreamGroup.orderKey` (a repository key, or `plain:<path>`),
never by `path`: a worktree has its own path but belongs to its repository's project.
[`spaceLayoutFromRail`](../../src/ui/spaces/space-order.ts) returns the order and each tab's
group from one `buildAgentRail` call, so they cannot drift. Use `orderKey`, not `key`: `key`
carries a tier prefix and changes when a project's last tab closes. `folder N` stays per path.

The order is the strip's own, and the strip changed to make that true: every terminal tab
comes before every surface chip, each half in the merged open/manual order.
[`TabManager.stripSlots`](../../src/terminal/tab-manager.ts) partitions the same way, so
⌘1–9, cycling and the marks cannot disagree. Pins still order surfaces among themselves; a
mark cannot be pinned or dragged.

**The strip and the keymap scope to the current project together** (DL-35.3, amended
2026-10-07). The marks draw only the active repository's spaces, and
[`currentProjectSpaceOrder`](../../src/ui/spaces/space-order.ts) is the tab manager's
`visibleTabIndexes`, so ⌘1–9, cycling and the swipe count the same spaces. Scoping one
without the other sends ⌘3 to a space nothing on screen draws. Mission Control's shelf is
unscoped: it is where every project's spaces are seen at once.

## Only the current space holds a live terminal

This is the Board's rule carried over, and the reason nothing here reparents an xterm:

- **The slide** ([`space-slide.ts`](../../src/ui/spaces/space-slide.ts)) is driven through
  `TabManagerDeps.onTabSwitch`, which `selectTab` and `activateForAttention` call **before**
  `hide()` releases the outgoing tab's renderers, and whose returned function runs after the
  incoming tab's `show()`. The caller reads the outgoing panes' rects and last rows
  (`serializePane`) and paints a text **ghost** that slides out while `.stage__tabs` slides
  in. The seam observes the switch; it never changes its order. Materialize and adoption
  select the tab they just created through `showTab(index, false)`, so a new tab does not
  slide, and neither does a switch a document or the browser was covering.
- **Mission Control** ([`mission-control.tsx`](../../src/ui/mission-control/mission-control.tsx))
  draws every window from `serializePane`, including tabs that are hidden. The current tab
  stays shown under the opaque surface, so opening and closing it costs no WebGL churn.
- Never put a transform on an element a `TerminalManager` owns: it writes `style.display`
  on its container. The slide animates `App`'s `.stage__tabs` and a sibling ghost.

## How it hooks into the shell

[`use-mission-control.tsx`](../../src/ui/mission-control/use-mission-control.tsx) keeps the
feature out of `app.tsx`. `App` hands it the terminal layer and the one question only it can
answer — whether another overlay covers the stage.

- `toggle-mission-control` is scope `"always"`, like `toggle-settings`, because Mission
  Control ranks as an overlay at the Open board's tier while it is open (`openOverlayRanks`).
  A tier would let the chord open it and never close it. The open half has its own
  preflight; the performable gate only asks whether a terminal tab exists.
- **An exit switches the tab under the surface first**, then the windows fly onto the rects
  `activeSlotRects()` answers for the new tab. The `exiting` ref covers the switch until the
  zoom lands, because `useSignalEffect` sees `activeTabIndex` move about a frame later and
  would otherwise read Mission Control's own switch as an outside one and dismiss it.
- A tab switch by chord dismisses it without a zoom (`dispatchAction`), as does a strip or
  rail press and the last tab closing.
- It covers the stage, so it is in `overlayCoversPane` and the browser's native view hides.
  Dev servers' Open in Deck is the exception that dismisses it (`takeStageForOpenedPage`): the host
  shows the view on open, so leaving Mission Control up would put a visible view above it.
  The mark's hover card raises the stage overlay flag for the same reason.

## Host scope

Everything is renderer-only: no channel was added, and `electron-ipc-contract.test.ts` has
nothing new to guard. It compiles into the frozen Tauri host too, but Tauri ships only by
hand from an already-shipped tag, so no Tauri user receives it. The hover card's branch
comes from the repository scan, which only Electron answers; without it the card omits it.

## The retired Board

The Board's code still builds and keeps its suites behind
[`AGENT_BOARD_RETIRED`](../../src/ui/agent-board-store.ts) (see
[traps.md](traps.md#live-switches)). Nothing on screen raises it, and a journaled
`agentBoardOpen` is read without error and ignored on restore. Stop, Restart and the reply
composer stayed with it; the pane and the rail still offer stopping and restarting an agent.
