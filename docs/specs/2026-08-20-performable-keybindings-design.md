# Performable keybindings and copy-or-interrupt — design

Status: `decided` (2026-08-20). Electron and Tauri both, renderer-only.

## Problem

`handleShortcut` ([`src/terminal/tab-manager.ts`](../../src/terminal/tab-manager.ts))
calls `preventDefault()` and `stopPropagation()` the moment `matchBinding` returns an
action, and only then calls `dispatchAction`, where `overlayBlocksAction` decides whether
the action may run at all. The key is committed before anything decides whether the
action can do anything.

Two consequences follow.

**A latent defect.** Every `scope: "pane"` action — `find`, `clear-buffer`,
`zoom-in`/`zoom-out`/`zoom-reset`, `copy-selection`, `paste`, `scroll-*`, `focus-*`,
`swap-*`, `next-tab`/`prev-tab` — is swallowed and then blocked while a file surface or
an overlay owns the stage. Monaco escapes the `isChromeTextField` early return because
with `editContext` on it focuses a plain `<div>`, never an `<input>`/`<textarea>`. So
Ctrl+Shift+C over an open document copies nothing AND denies Chromium's own copy.

**A blocked feature.** Bare Ctrl+C cannot be bound on Windows. Windows Terminal binds it
to copy and lets it fall through to the app when there is no selection; Deck cannot,
because a binding here always consumes.

## Goal

On Windows, Ctrl+C copies the terminal selection when there is one, and reaches the PTY
as an interrupt when there is not — matching Windows Terminal's default. Introduce the
mechanism that makes that safe, and apply it to the clipboard actions only.

## Non-goals

- Binding Ctrl+Insert. It becomes viable under this mechanism but is a separate decision.
- Fixing the macOS **menu** half. `find`, `clear-buffer` and `zoom-*` carry menu items, so
  Cocoa consumes their accelerators before the webview and no renderer-side reorder can
  reach them. Named as a known gap below.
- Applying the predicate to the other ~18 pane-scoped actions. The mechanism is built to
  take them later as a data change.

## Design

### The predicate

A new pure module, `src/terminal/action-performable.ts`, answers "can this action do
anything right now" from a context value rather than from live signals, so it is testable
without mounting a tab manager.

```ts
export type StageOwner = "terminal" | "surface" | "overlay";

export interface PerformableContext {
  readonly stageOwner: StageOwner;
  readonly hasSelection: boolean;
}

export function isActionPerformable(
  action: ShortcutAction,
  context: PerformableContext,
): boolean;
```

Unregistered actions answer `true`, so nothing changes for the other forty-odd actions.

### The reorder

`handleShortcut` consults the predicate **before** `preventDefault()`. False means the
binding behaves as if it did not exist and the key continues to whatever holds focus.
`dispatchAction` keeps `overlayBlocksAction` unchanged — it still guards the macOS menu
path, which never passes through `handleShortcut`.

### The two clipboard actions

| Action              | Chord                  | Stage-conditional | Selection-conditional | Clears selection |
| ------------------- | ---------------------- | ----------------- | --------------------- | ---------------- |
| `copy-selection`    | Ctrl+Shift+C (Windows) | yes               | no                    | no               |
| `copy-or-interrupt` | Ctrl+C (Windows only)  | yes               | yes                   | yes              |

`copy-or-interrupt` is a new registry action, `scope: "pane"`, no menu entry, placed in
the `text` group of `shortcut-groups.ts`.

### Where the interrupt comes from

The interrupt is **not** written by Deck. When `copy-or-interrupt` is not performable,
`handleShortcut` returns without consuming and xterm encodes the keystroke itself. This
is deliberate: writing a literal `\x03` through `pty.writePty` would hardcode one
encoding, and a terminal that has negotiated a different keyboard protocol expects a
different byte sequence. Letting xterm encode keeps Deck out of that decision.

The focus objection does not apply here. The predicate returns false for "no selection"
only when a terminal pane already owns the stage, which means focus is in that pane's
xterm textarea.

## Decisions

**D1. One action per conditionality, not a per-binding flag.** Ghostty expresses this as
a `performable:` prefix on the binding. That cannot work here: user overrides are stored
per action and replace an action's whole chord set
([`resolveKeymap`](../../src/lib/keybindings.ts)), so two chords of one action cannot
carry different conditionality, and a user who has rebound `copy-selection` would never
receive the new Ctrl+C. kitty's compound-action shape fits this codebase; Ghostty's
principle is kept, its mechanism is not.

**D2. Ctrl+Shift+C is stage-conditional but not selection-conditional.** Over a document
it must fall through so Chromium's copy reaches Monaco. Inside a terminal it keeps
consuming even with no selection, because nothing else wants that chord and changing it
would leak Ctrl+Shift+C into agent TUIs with unspecified behaviour.

**D3. Only `copy-or-interrupt` clears the selection.** Without clearing, a second Ctrl+C
copies again instead of interrupting — kitty shipped a second action
(`copy_and_clear_or_interrupt`) for exactly this. Ctrl+Shift+C is a plain copy and keeps
the highlight, which is also how VS Code splits `copyAndClearSelection` from
`copySelection`.

**D4. Clearing happens on the copy path, not on a clipboard callback.**
`copyTerminalSelection` returns `void` and writes the clipboard asynchronously. Clearing
inside the write's `.then` can erase a selection the user made in the meantime. The
selection is therefore cleared synchronously after the text is read, and a failed
clipboard write reports through the existing error path without restoring it.

**D5. Fail toward the PTY.** If the context cannot be resolved — no active manager, pane
not mounted — the predicate answers false and the key is not consumed. The opposite
default costs a pane its interrupt, which is strictly worse than a copy that did not
happen.

**D6. Bound by default on Windows.** An opt-in chord does not meet the goal and is not
discoverable. macOS is untouched: ⌘C stays the native Cocoa Copy role.

## Risks

- **No Windows hardware (Gate C).** The renderer half is testable on macOS and the
  predicate is unit-testable, but the Ctrl+C keystroke on Windows is not exercised. Claims
  must say renderer-verified, never Windows-verified.
- **Two presses to cancel.** After selecting output, the first Ctrl+C copies and the
  second interrupts. Inherent to the design; Windows Terminal behaves the same. It costs
  more here than in a plain shell because agent CLIs use Ctrl+C as a routine cancel.
- **Fall-through destinations are not all enumerated.** Not consuming sends the key to
  whatever holds focus. The rail, the dock and the browser view are each a possible
  target; the plan pins the ones that matter with tests rather than by assertion.
- **Browser surface ownership is unconfirmed.** `openOverlayRanks` does not mention
  `browserSurfaceActive`, and whether `surfaces.activeIndex()` already covers the browser
  tab must be established by test, not assumed.

## Known gap

macOS menu-bound actions (`find`, `find-next`, `find-previous`, `clear-buffer`,
`zoom-in`/`zoom-out`/`zoom-reset`, `split-*`, `toggle-*`) keep dying over a file surface,
because Cocoa consumes their accelerators first. Ghostty's answer is that performable
binds get no menu shortcut at all; adopting that here means dropping accelerators from
those menu items, which trades the menu's role as the place chords are learned. Out of
scope, unresolved.

## Chưa khớp thực tế

| Claim                                                | Intent    | Status  | Evidence                                                                   |
| ---------------------------------------------------- | --------- | ------- | -------------------------------------------------------------------------- |
| Ctrl+C copies or interrupts on Windows               | `decided` | unbuilt | This spec only; no implementation exists yet                               |
| The predicate reaches the other pane-scoped actions  | `decided` | backlog | Mechanism built for it, no action registered beyond the two clipboard ones |
| macOS menu-bound chords fall through over a document | `decided` | backlog | Known gap above; needs the menu-accelerator decision                       |
