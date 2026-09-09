# Agent Board

> For maintainers. Using Deck? See [docs/user/](../user/).

The Board is a grid of cards, one per live agent pane, on the stage. It is the answer to
"every agent app is a sidebar": the same panes the rail lists, laid out so several can be
read at once. It **toggles against nothing** — the rail and the dock stay exactly as the
user left them, and a card press opens that agent's pane on the stage. Visual rules are in
[`DESIGN-LANGUAGE.md` §34](../DESIGN-LANGUAGE.md).

## Shape

[`agent-board-model.ts`](../../src/ui/agent-board-model.ts) is a **second pure projection
over `buildAgentRail`**, joined to `PaneView` by pane id. It is not a parallel source: the
Board and the rail cannot disagree about which panes exist, what state they are in or what
they last said, because only the layout differs.

- [`agent-board-store.ts`](../../src/ui/agent-board-store.ts) is the window state and the
  snapshot cadence; [`agent-board-actions.ts`](../../src/ui/agent-board-actions.ts) is every
  control's rule, injected rather than imported so it is testable — this repo has no `<App>`
  render harness.
- [`agent-board.tsx`](../../src/ui/agent-board.tsx) is presentational: every fact arrives in
  `view`, every effect leaves through `actions`. That is what lets the gallery mount the real
  component over a fixture.
- `AgentBoardNav` (a STATUS/PROJECTS column) and `AgentBoardPanel` (a detail column quoting
  the selected pane) still build and keep their suites, but nothing mounts them, so
  `view.selected` stays null. This is the theme-gallery retirement pattern, not dead code.

## Seams it took

The Board reaches the terminal layer only through named seams, all on `TabManager`:

| Seam                              | Why it exists                                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| `acknowledgePane`                 | Reading a card clears that pane's latched attention                |
| `serializePane` / `paneAlive`     | A card draws a snapshot of the pane's scrollback, never the live xterm |
| `restartPane`                     | Restart after the agent's process left the pane                    |
| `pty_kill_foreground`             | Stop kills the pane's foreground process, not the shell            |
| `MaterializeIntent.panePrompts`   | A persisted task prompt has to reach a pane                        |

`panePrompts` is the one widening the design did not foresee: a restored prompt must land on
a **pane**, and [`session-restore.ts`](../../src/terminal/session-restore.ts) never learns a
pane id. It mirrors `paneCommands` exactly — same map, same zip, same call site — so removing
it is deleting one field. The alternative, a `(workspace, agent)` mark a pane claims, is the
shape withdrawn from the rail's tail pairing for having no causal link to a pane.

**A card is a snapshot, never a reparented terminal.** The live xterm stays in its pane; the
Board borrows text. That is deliberate: moving the instance would make the Board a second
owner of a PTY-backed view.

## Restart resumes

[`pane-restart.ts`](../../src/terminal/pane-restart.ts) composes the pane's confirmed session
id, its launch flags and the CLI's own resume form. A null id asks for the **latest** session
rather than relaunching bare, because relaunching bare silently starts a new conversation
where the user asked to continue one.

That id has to be kept on purpose. `session-tail-store`'s `forget` empties the live pairing
at exactly the agent → shell transition after which Restart is offered, so
[`lastSessionIdFor`](../../src/terminal/session-tail-store.ts) keeps it — and **only when the
generation ends with no agent**. `isNewGeneration` is true for four transitions; an
unconditional keep would pin a freshly started agent to the previous conversation.

## Sending a reply

A card's composer places text in the pane; whether it presses Enter is a separate question.

- `autoSend` is the card's own `hasRun`, not `submitAllowed`. A fresh `claude` sitting on its
  trust-this-folder menu reads `idle` and passes every check `submitAllowed` makes — it has no
  `hasRun` input — so pressing Enter there would answer a security prompt on the user's
  behalf. A pane that has never run a turn can only be pasted into, and the card says so.
- Facts Deck cannot know are drawn as absent, never invented.

## Host scope

`hostHasAgentBoard` gates the **keystroke only**. The menu path never asks it,
`menu_registry.rs` carries View ▸ Agent Board, and the surface mounts on
`agentBoardSurfaceActive` with no host gate — so on Tauri that menu item opens a Board with
no tails and no worktree grouping. `toggle-browser` has the identical exposure, which is why
this is recorded as the repository's existing posture rather than a guard this page claims.

`agentBoardOpen` is a `WindowRecord` field and `taskPrompt` a `SessionPane` field, so the chip
and its draft survive quit and relaunch. See [session-restore.md](session-restore.md).
